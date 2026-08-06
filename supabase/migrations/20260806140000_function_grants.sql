-- ============================================================================
-- 부산 Dartrip — 함수 실행 권한을 서버 키로 좁힘 (`X-37`)
--
-- 설계 정본: `API데이터설계.md` §5.8(RLS) · §11.3(익명 공개 경로 방어 DF-4)
--            `ARCHITECTURE.md` §8 `R-15` · `AD-17`
--            `20260806100000_rate_limits.sql` (같은 처리를 먼저 한 선례)
--
-- 무엇을 고치는가
-- ---------------
-- PostgreSQL 은 **새 함수의 실행 권한을 `public` 에 자동으로 줍니다.** 그래서 초기 스키마가
-- 만든 함수 둘은 브라우저에 나가 있는 anon 키로도 부를 수 있는 상태입니다.
--
--   · `throw_dart(text, theme_key)`          — 다트 추출
--   · `refresh_pool_stat(text, theme_key)`   — 집계표 재계산
--
-- **지금 당장 새는 것은 없습니다.** 둘 다 서버(`service_role`)를 거쳐서만 불리고
-- (`lib/dart.ts` · `lib/sync.ts`), `throw_dart` 는 읽기만 하며 `refresh_pool_stat` 이
-- 건드리는 집계표는 RLS 로 쓰기가 막혀 있습니다.
--
-- 고치는 이유는 **다음에 쓰기 함수를 하나 더 만들 때**입니다. 자동 부여가 기본값이라
-- `revoke` 를 빠뜨리는 쪽이 정상 경로가 되고, 그 순간 공개 경로가 하나 열립니다.
-- 상한 함수(`consume_rate_limit`)는 이미 이렇게 좁혀 두었으므로, **남은 둘을 같은 모양으로
-- 맞춰 "함수를 만들면 권한도 함께 적는다" 가 이 저장소의 규칙이 되게 합니다.**
--
-- `places_stat_sync()` 는 여기 없습니다
-- ------------------------------------
-- 반환형이 `trigger` 라 **SQL 로 직접 부를 수 없습니다**(`trigger functions can only be
-- called as triggers`). 부를 수 없는 것에는 막을 자리도 없습니다. 트리거는 지금처럼
-- `places` 에 대한 쓰기가 일어날 때 DB 가 스스로 부릅니다.
--
-- 실행 방법
-- ---------
--   Supabase 대시보드 > SQL Editor 에 본 파일 내용을 붙여넣고 Run.
--   여러 번 실행해도 결과가 같습니다.
--
--   **실행해도 서비스 동작은 달라지지 않습니다** — 다트도 크론도 서버 키로 부르기
--   때문입니다. 달라지는 것은 "anon 키로도 부를 수 있었다" 는 사실 하나입니다.
-- ============================================================================

begin;

-- ── 1. 다트 추출 ────────────────────────────────────────────────────────────
-- 읽기 전용이지만 익명이 직접 부를 이유가 없습니다. 결과는 `throws` 에 남아야 의미가 있고
-- 그 기록은 서버가 남깁니다(`lib/dart.ts`).
revoke execute on function public.throw_dart(text, theme_key) from public;
revoke execute on function public.throw_dart(text, theme_key) from anon;
revoke execute on function public.throw_dart(text, theme_key) from authenticated;
grant  execute on function public.throw_dart(text, theme_key) to service_role;

-- ── 2. 집계표 재계산 ────────────────────────────────────────────────────────
-- 이쪽은 쓰기입니다. 부르는 자리는 행 트리거(`places_stat_sync`)와 크론의 주 1회
-- 대조(`lib/sync.ts` `auditPoolStats()`) 둘뿐입니다.
revoke execute on function public.refresh_pool_stat(text, theme_key) from public;
revoke execute on function public.refresh_pool_stat(text, theme_key) from anon;
revoke execute on function public.refresh_pool_stat(text, theme_key) from authenticated;
grant  execute on function public.refresh_pool_stat(text, theme_key) to service_role;

-- 트리거 안에서 부르는 경로는 이 권한 변경의 영향을 받지 않습니다 — 실행 권한 검사는
-- 트리거를 **만들 때** 이뤄지고 발화 시점에는 다시 보지 않습니다.

commit;

-- ── 실행 후 확인 (선택) ─────────────────────────────────────────────────────
-- anon 이 실행 권한을 갖고 있는지 한 줄로 봅니다. 세 함수 모두 false 여야 합니다.
--
--   select p.proname,
--          has_function_privilege('anon', p.oid, 'execute') as anon_can_execute
--     from pg_proc p
--     join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.proname in ('throw_dart', 'refresh_pool_stat', 'consume_rate_limit');
