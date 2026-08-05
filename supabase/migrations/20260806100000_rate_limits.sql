-- ============================================================================
-- 부산 Dartrip — 익명 공개 경로의 소모형 자원 상한 (DF-4)
--
-- 설계 정본: `API데이터설계.md` §11(무료 티어 방어 DF-1~DF-4) · §5.6(스토리지) · §5.8(RLS)
--            `ARCHITECTURE.md` §8 `R-7`(Storage 1GB) · `R-4`(무료 티어 정지)
--            `lib/ratelimit.ts` (본 표를 쓰는 유일한 자리)
--
-- 무엇을 막는가
-- -------------
-- 배포 URL 은 1차 심사 제출 항목이라 **주소가 공개된 채로 심사 기간을 보냅니다.** v1 에는
-- 로그인이 없어(`D-9`) 쓰기 경로가 전부 익명이고, 그중 둘은 **한 번 쓰면 되돌아오지 않는
-- 자원**을 씁니다 — 사진 보관함 1GB 와 DB 행입니다. 외부 API 일 한도는 하루가 지나면
-- 회복되지만 이 둘은 회복되지 않습니다.
--
-- 그래서 방어를 두 갈래로 나눴습니다. 회복되는 자원은 응답 캐시로 흡수하고(코드 쪽),
-- **회복되지 않는 자원만 이 표로 정밀하게 셉니다.**
--
-- 왜 애플리케이션 메모리가 아니라 DB 인가
-- --------------------------------------
-- 서버리스라 함수 인스턴스가 여러 개 뜹니다. 인스턴스 안에 카운터를 두면 요청이 어느
-- 인스턴스로 가느냐에 따라 셈이 갈려 상한이 사실상 인스턴스 수만큼 곱해집니다.
-- **후기 중복을 애플리케이션 층 하나로 못 막아 DB 인덱스를 덮었던 것과 같은 이유**입니다
-- (`20260805210000_reviews_unique_author.sql`). 마지막 판정은 한 곳에서 나야 합니다.
--
-- 창(window) 을 값으로 들고 있는 이유
-- -----------------------------------
-- 같은 경로에 **시간당 상한과 일 누적 상한**을 함께 겁니다. 짧은 창만 두면 하루 종일
-- 상한선에 붙어 있는 완만한 남용을 못 잡고, 긴 창만 두면 순간적인 몰아치기를 못 잡습니다.
-- 두 창을 각각 행으로 두고 기본키에 `window_seconds` 를 포함시켜 서로 섞이지 않게 합니다.
--
-- 창 경계는 고정입니다(sliding window 가 아닙니다) — `epoch` 를 창 길이로 내림합니다.
-- 경계 직전·직후에 몰면 짧은 시간에 상한의 두 배까지 통과할 수 있으나, 그 값도 자원을
-- 지키는 데 충분히 낮게 잡혀 있고 구조가 훨씬 단순합니다.
--
-- 이 표는 사용자 데이터가 아닙니다
-- -------------------------------
-- 지워도 서비스 기능은 그대로이고 상한 카운터만 초기화됩니다. 보존 정책(§5.7)에 맞춰
-- 증분 크론이 오래된 행을 함께 치웁니다(`lib/sync.ts` cleanup).
--
-- 실행 방법
-- ---------
--   Supabase 대시보드 > SQL Editor 에 본 파일 내용을 붙여넣고 Run.
--   여러 번 실행해도 결과가 같습니다.
--
--   **실행 전에는 상한이 서지 않습니다.** 앱은 이 함수가 없으면 요청을 막지 않고 통과시킵니다
--   (`lib/ratelimit.ts` — 방어 장치가 서비스를 세우는 쪽이 더 나쁘기 때문입니다).
-- ============================================================================

begin;

-- ── 1. 카운터 표 ────────────────────────────────────────────────────────────
create table if not exists public.rate_limits (
  -- 어느 경로 몫인가 (`upload` · `place_submit` · `enrich`)
  bucket          text        not null,
  -- 누구를 세는가. `ip:<주소>` 형태입니다 (`lib/ratelimit.ts`)
  subject         text        not null,
  -- 창 길이(초). 3600 = 시간당 / 86400 = 일 누적
  window_seconds  integer     not null,
  -- 창의 시작 시각. epoch 를 창 길이로 내림한 값이라 같은 창이면 항상 같습니다
  window_start    timestamptz not null,
  hits            integer     not null default 0,
  primary key (bucket, subject, window_seconds, window_start)
);

comment on table public.rate_limits is
  '익명 공개 경로의 소모형 자원 상한 카운터 (DF-4). 사용자 데이터가 아니며 지워도 기능에 영향이 없습니다.';

-- 청소용. 오래된 창부터 지웁니다
create index if not exists rate_limits_window_start_idx
  on public.rate_limits (window_start);

-- ── 2. RLS — anon 전면 차단 ─────────────────────────────────────────────────
-- 정책을 만들지 않습니다. 서버(service_role)만 접근합니다 (§5.8 의 다른 표들과 같은 처리).
alter table public.rate_limits enable row level security;

-- ── 3. 세면서 판정하는 함수 ─────────────────────────────────────────────────
-- 읽고 나서 쓰면 그 사이에 다른 요청이 끼어듭니다. `insert … on conflict do update` 한
-- 문장으로 **증가와 판정을 같은 순간에** 끝냅니다.
--
-- `security definer` 를 쓰지 않습니다 — 부르는 쪽이 service_role 이라 필요 없고, definer 로
-- 두면 anon 키로도 부를 수 있게 되어 카운터를 밖에서 태울 수 있습니다.
create or replace function public.consume_rate_limit(
  p_bucket          text,
  p_subject         text,
  p_window_seconds  integer,
  p_limit           integer
)
returns table (
  is_allowed          boolean,
  hit_count           integer,
  retry_after_seconds integer
)
language plpgsql
as $$
declare
  v_start timestamptz;
  v_hits  integer;
begin
  v_start := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
  );

  insert into public.rate_limits as rl (bucket, subject, window_seconds, window_start, hits)
  values (p_bucket, p_subject, p_window_seconds, v_start, 1)
  on conflict (bucket, subject, window_seconds, window_start)
  do update set hits = rl.hits + 1
  returning rl.hits into v_hits;

  is_allowed := v_hits <= p_limit;
  hit_count  := v_hits;
  -- 이 창이 끝나기까지 남은 시간. 429 응답의 Retry-After 로 그대로 나갑니다.
  retry_after_seconds := greatest(
    1,
    ceil(extract(epoch from (v_start + make_interval(secs => p_window_seconds)) - now()))::integer
  );
  return next;
end;
$$;

comment on function public.consume_rate_limit(text, text, integer, integer) is
  '한 문장으로 증가와 판정을 함께 합니다 (DF-4). 서버(service_role) 전용 — anon 실행 권한을 주지 않습니다.';

-- 공개 키로는 부를 수 없게 합니다.
-- PostgreSQL 은 새 함수의 실행 권한을 `public` 에 자동으로 줍니다. 그대로 두면 브라우저에
-- 나가 있는 anon 키로도 이 함수를 부를 수 있어, 남의 카운터를 대신 태워 **상한 자체를
-- 공격 수단으로 쓸 수 있습니다.**
revoke execute on function public.consume_rate_limit(text, text, integer, integer) from public;
revoke execute on function public.consume_rate_limit(text, text, integer, integer) from anon;
revoke execute on function public.consume_rate_limit(text, text, integer, integer) from authenticated;

-- 서버가 쓰는 키에는 **명시적으로** 돌려줍니다.
-- 위에서 `public` 을 걷어내면 소유자가 아닌 `service_role` 도 함께 잃습니다. 여기서 다시
-- 주지 않으면 서버 호출이 권한 오류로 떨어지고, 앱은 그것을 "판정 불가" 로 보아 요청을
-- 통과시킵니다(`lib/ratelimit.ts` fail open) — **상한이 조용히 서지 않는 상태**가 됩니다.
grant execute on function public.consume_rate_limit(text, text, integer, integer) to service_role;

commit;
