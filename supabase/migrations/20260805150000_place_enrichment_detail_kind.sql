-- ============================================================================
-- 부산 Dartrip — place_enrichment.kind 에 'detail' 추가
--
-- 설계 정본: `API데이터설계.md` §5.3(DDL) · §3.1(`detailCommon2`)
--            `ARCHITECTURE.md` AD-7(외부 응답 캐시, TTL 7일)
--
-- 무엇을 바꾸는가
-- --------------
-- 초기 스키마(20260804120000)는 캐시 종류를 `('related','course','photo')` 셋으로
-- 못박아 두었습니다. 그런데 S4 가 실제로 부르는 것은 넷입니다 —
--
--   detailImage2  이 장소의 사진 여러 장        → 사진 캐러셀
--   detailCommon2 이 장소의 소개 · 전화 · 홈페이지 → 소개 · 정보 블록
--   TarRlteTarService1  연관 관광지            → 함께 가볼 만한 곳
--   Durunubi            도보 코스              → 주변 도보 코스
--
-- 담을 자리가 셋뿐이라 소개·전화·홈페이지를 **사진 행에 얹어** 두었습니다.
-- 성격이 다른 두 응답이 한 행에 묶여 있으면 ㉠ 한쪽만 실패해도 둘 다 다시 받아야 하고
-- ㉡ 백필이 소개만 미리 채워 두는 것이 불가능합니다. 그래서 자리를 하나 늘립니다.
--
-- **초기 스키마 파일을 고치지 않습니다.** 이미 실행된 마이그레이션을 뒤에서 바꾸면
-- 다시 처음부터 적용했을 때와 결과가 달라집니다. 항상 새 파일로 덧씌웁니다.
--
-- 실행 방법
-- ---------
--   Supabase 대시보드 > SQL Editor 에 본 파일 내용을 붙여넣고 Run.
--   여러 번 실행해도 결과가 같습니다.
-- ============================================================================

begin;

-- ── 1. kind 허용 값에 'detail' 추가 ─────────────────────────────────────────
-- 제약 이름은 초기 스키마에서 인라인 check 로 만들어져 Postgres 가 자동으로
-- `place_enrichment_kind_check` 를 붙였습니다. 이름을 가정하지 않고 찾아서 지웁니다.
do $$
declare
  c record;
begin
  for c in
    select con.conname
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace ns on ns.oid = rel.relnamespace
     where rel.relname = 'place_enrichment'
       and ns.nspname  = 'public'
       and con.contype = 'c'
       and pg_get_constraintdef(con.oid) ilike '%kind%'
  loop
    execute format('alter table public.place_enrichment drop constraint %I', c.conname);
  end loop;
end $$;

alter table place_enrichment
  add constraint place_enrichment_kind_check
  check (kind in ('related', 'course', 'photo', 'detail'));

comment on column place_enrichment.kind is
  '캐시 종류 — photo(detailImage2 + 관광사진) · detail(detailCommon2 소개·전화·홈페이지) · related(연관관광지) · course(두루누비)';

-- ── 2. 사진 행에 얹혀 있던 소개를 떼어냅니다 ────────────────────────────────
-- 앞선 회차에서 `kind='photo'` 의 payload 안에 `detail` 키로 담아 두었습니다.
-- 그 값을 그대로 새 행으로 옮기고, 사진 행에서는 지웁니다.
-- payload 의 `v`(캐시 세대)는 붙이지 않습니다 — 세대가 다르면 앱이 알아서 다시 받습니다.
insert into place_enrichment (place_id, kind, payload, fetched_at)
select
  pe.place_id,
  'detail',
  jsonb_build_object(
    'ok',     (pe.payload -> 'detail') is not null and pe.payload -> 'detail' <> 'null'::jsonb,
    'detail', pe.payload -> 'detail',
    'specs',  coalesce(pe.payload -> 'specs', '[]'::jsonb)
  ),
  pe.fetched_at
from place_enrichment pe
where pe.kind = 'photo'
  and pe.payload ? 'detail'
on conflict (place_id, kind) do nothing;

update place_enrichment
   set payload = payload - 'detail'
 where kind = 'photo'
   and payload ? 'detail';

commit;
