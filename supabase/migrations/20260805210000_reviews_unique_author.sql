-- ============================================================================
-- 부산 Dartrip — 후기 중복을 DB 에서 막습니다 (부분 유니크 인덱스)
--
-- 설계 정본: `API데이터설계.md` §5.3(`reviews` DDL) · §5.8(RLS — 쓰기는 API Route 경유)
--            `화면구성도.md` §6.2(작성 시트) · §6.4("후기 등록 실패")
--            `D-12`(다녀왔어요 + 한 줄 + 사진, 별점 없음) · `D-9`(로그인 없음) · AD-11
--            `lib/review.ts` §"한 기기는 한 장소에 한 번"
--
-- 무엇을 바꾸는가
-- --------------
-- "한 기기는 한 장소에 한 번" 규칙은 지금까지 **애플리케이션 층 검사** 하나였습니다 —
-- `createReview()` 가 먼저 조회해 보고 있으면 `409 duplicate` 를 돌려주는 방식입니다.
--
-- 그 사이에 틈이 있습니다. 읽는 순간과 쓰는 순간이 떨어져 있어서, 같은 기기의 POST 두 건이
-- 동시에 들어오면 **둘 다 "없다" 를 읽고 둘 다 씁니다.** 더블탭 한 번으로 실제로 일어나는
-- 일입니다. 조회로는 막을 수 없는 종류의 틈이라, 마지막 판정을 DB 로 내립니다.
--
-- 왜 부분(partial) 인가 — `anon:unknown` 제외
-- -------------------------------------------
-- `anon:unknown` 은 **기기 하나를 가리키는 값이 아닙니다.** 저장소를 못 쓰는 브라우저
-- (시크릿 모드 일부 · 차단 설정)가 모두 같이 쓰는 값이라, 여기에까지 1회 제한을 걸면
-- 서로 남남인 사용자들이 서로의 기록을 막습니다. 기록의 문턱을 낮춘다는 §6.2 의 결정과
-- 반대 방향이라 제외합니다 (`lib/review.ts` 의 `isIdentifiable()` 과 **같은 경계**입니다 —
-- 한쪽만 고치면 화면·서버·DB 의 답이 갈립니다).
--
-- 이 값을 흉내 내면 제한을 피할 수 있지만, 기기 식별값 자체가 지우면 초기화되는 값이라
-- 어차피 완전한 차단이 아니라 문턱입니다. 그 이상은 v1 범위 밖입니다.
--
-- 애플리케이션 검사는 그대로 둡니다
-- --------------------------------
-- 인덱스가 생겨도 `createReview()` 의 사전 조회를 지우지 않습니다. 사전 조회는 흔한 경우
-- (이미 남긴 사람이 버튼을 다시 누름)를 **오류 경로를 타지 않고** 처리하고, 인덱스는 드문
-- 경합만 잡습니다. 두 층의 답은 같습니다 — 어느 쪽에 걸려도 `409 duplicate` 입니다.
--
-- **기존 마이그레이션 파일을 고치지 않습니다.** 이미 실행된 파일을 뒤에서 바꾸면 처음부터
-- 다시 적용했을 때와 결과가 달라집니다. 항상 새 파일로 덧씌웁니다.
--
-- 실행 방법
-- ---------
--   Supabase 대시보드 > SQL Editor 에 본 파일 내용을 붙여넣고 Run.
--   여러 번 실행해도 결과가 같습니다.
-- ============================================================================

begin;

-- ── 1. 인덱스를 만들기 전에 걸림돌을 치웁니다 ───────────────────────────────
-- 애플리케이션 검사가 붙기 전(또는 위 경합으로) 쌓인 중복이 남아 있으면 유니크 인덱스가
-- 생성 자체에서 실패합니다. 같은 (장소 · 작성자) 묶음에서 **가장 먼저 남긴 한 건만 남기고**
-- 뒤엣것을 지웁니다 — 먼저 쓴 쪽이 이기고 뒤엣것이 409 를 받는 애플리케이션 층의 순서와
-- 같은 결과입니다. 지운 건수는 아래 raise notice 로 보고합니다.
do $$
declare
  removed bigint;
begin
  with ranked as (
    select id,
           row_number() over (
             partition by place_id, author_ref
             order by created_at asc, id asc
           ) as rn
      from public.reviews
     where author_ref <> 'anon:unknown'
  )
  delete from public.reviews r
   using ranked
   where r.id = ranked.id
     and ranked.rn > 1;

  get diagnostics removed = row_count;

  if removed > 0 then
    raise notice '중복 후기 %건을 지웠습니다 (같은 장소·같은 작성자에서 먼저 남긴 한 건만 남김).', removed;
  else
    raise notice '중복 후기가 없었습니다. 지운 행 없음.';
  end if;
end $$;

-- ── 2. 부분 유니크 인덱스 ───────────────────────────────────────────────────
-- `author_ref <> 'anon:unknown'` 인 행만 대상입니다. 제외된 행끼리는 몇 건이든 들어갑니다.
create unique index if not exists reviews_place_author_uidx
  on public.reviews (place_id, author_ref)
  where author_ref <> 'anon:unknown';

comment on index public.reviews_place_author_uidx is
  '한 기기는 한 장소에 한 번 (D-12). anon:unknown 은 여러 브라우저가 공유하는 값이라 제외 — lib/review.ts 의 isIdentifiable() 과 같은 경계.';

commit;
