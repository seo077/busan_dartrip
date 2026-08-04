-- ============================================================================
-- 부산 Dartrip — 초기 스키마
--
-- 설계 정본: `API데이터설계.md` §5.3(DDL) · §5.5(집계표 트리거) · §7.3(추출 함수)
--            `ARCHITECTURE.md` §5 · AD-1 · AD-2 · AD-6 · AD-13
--
-- 실행 방법은 저장소 `README.md` §DB 마이그레이션 을 보십시오.
-- 이 파일은 한 번에 통째로 실행되며, 같은 파일을 다시 실행해도 되도록
-- 만들 수 있는 것은 `if not exists` · `or replace` 로 두었습니다.
-- ============================================================================

-- ── 확장 ─────────────────────────────────────────────────────────────────────
create extension if not exists postgis;   -- 좌표·거리 계산 (§7.4)
create extension if not exists pgcrypto;  -- gen_random_uuid()
create extension if not exists pg_trgm;   -- 이름 유사도 (F4 차집합 판정, §6.6)

-- ── 열거형 3종 ───────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_type where typname = 'place_source') then
    create type place_source as enum
      ('tourapi', 'busan_attraction', 'heritage', 'seed', 'user');
  end if;

  -- 'unclassified' = 테마 매칭 실패분(미분류 보관함, §4.2 · AD-13).
  -- 다트 풀 조건이 모두 status='published' 이므로 이 상태만으로 풀에서 자동 제외됩니다.
  if not exists (select 1 from pg_type where typname = 'place_status') then
    create type place_status as enum
      ('published', 'pending', 'rejected', 'unclassified');
  end if;

  if not exists (select 1 from pg_type where typname = 'theme_key') then
    create type theme_key as enum ('food', 'nature', 'culture', 'activity');
  end if;
end $$;

-- ── 1. sigungu — 부산 16개 구·군 마스터 ──────────────────────────────────────
-- 코드는 하드코딩하지 않습니다. `areaCode2` 응답으로 적재합니다 (백필 01-sigungu.ts).
create table if not exists sigungu (
  code                   text primary key,          -- 내부 코드 예: 'yeongdo'
  name                   text not null,             -- '영도구'
  tour_api_area_code     text,                      -- 확인 대상 (U-1)
  tour_api_sigungu_code  text,                      -- 확인 대상 (U-1)
  center_lat             double precision not null,
  center_lng             double precision not null,
  is_low_visit           boolean not null default false,  -- 데이터랩 저방문 (D-7)
  boundary               geography(MultiPolygon, 4326)    -- 없어도 동작 (U-10)
);

-- ── 2. theme_map — 원본 분류 → 4테마 매핑 규칙 (AD-2) ────────────────────────
-- 매핑을 코드가 아니라 데이터로 두는 이유는 §4.1 입니다.
-- 코드값이 예상과 달라도 SQL 한 줄로 흡수되고 재배포가 필요 없습니다.
create table if not exists theme_map (
  id           bigserial primary key,
  source       place_source not null,
  match_kind   text not null
               check (match_kind in ('content_type','cat1','cat2','cat3','keyword')),
  match_value  text not null,
  theme        theme_key not null,
  priority     int  not null default 100,   -- 작을수록 우선 (cat3=10 … keyword=90)
  note         text,
  unique (source, match_kind, match_value)
);

-- ── 3. places — 통합 장소 테이블 (AD-1) ──────────────────────────────────────
-- 관광공사 · 부산명소 · 국가유산 · 시드 발굴 · 사용자 등록이 모두 같은 테이블의 행입니다.
-- 출처는 source 컬럼으로만 구분하며, 출처별 가중치가 들어갈 자리가 구조적으로 없습니다.
-- 평점 · 인기 · 조회수 컬럼은 두지 않습니다 (AD-6 · D-10 · D-11 · D-12).
create table if not exists places (
  id                 uuid primary key default gen_random_uuid(),
  source             place_source not null,
  source_id          text,                       -- 사용자 등록은 null
  name               text not null,
  theme              theme_key,                  -- 미분류 보관함은 null (§4.2, 아래 check)
  sigungu_code       text not null references sigungu(code),
  lat                double precision not null,
  lng                double precision not null,
  geom               geography(Point, 4326)
                     generated always as
                     (ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography) stored,
  address            text,
  road_address       text,
  tel                text,
  homepage           text,
  overview           text,
  first_image        text,
  first_image_thumb  text,
  content_type_id    text,
  cat1               text,
  cat2               text,
  cat3               text,
  is_hidden_gem      boolean not null default false,  -- 시드·사용자 등록 표식
  is_good_restaurant boolean not null default false,  -- 모범음식점 배지 (D-11, 정렬 키 아님)
  status             place_status not null default 'published',
  submitted_by       text,        -- 출처 무관 문자열 (D-9) 'anon:<uuid>' | 'kakao:<id>'
  submitted_note     text,        -- 등록자 한 줄 소개
  source_modified_at timestamptz, -- 증분 동기화 기준
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  synced_at          timestamptz,
  deleted_at         timestamptz,
  unique (source, source_id),

  -- 미분류 보관함의 정의 (§4.2 · AD-13)
  -- 테마가 빈 것과 미분류 상태인 것은 항상 같은 집합입니다.
  --   ㉠ theme 이 null 인데 status 가 published        → 거부 (테마 없는 행이 풀에 드는 것을 차단)
  --   ㉡ status 가 unclassified 인데 theme 이 채워짐   → 거부 (분류했으면 상태도 바꾸도록 강제)
  constraint places_unclassified_ck
    check ((status = 'unclassified') = (theme is null))
);

create index if not exists places_geom_idx on places using gist (geom);

create index if not exists places_pool_idx on places (sigungu_code, theme)
  where status = 'published' and deleted_at is null;

-- 미분류 보관함 조회용 (출처별 · 수집 최신순) — 09-report.ts 가 사용
create index if not exists places_unclassified_idx on places (source, created_at desc)
  where status = 'unclassified';

-- ── 4. dart_pool_stats — 구·군 × 테마 건수 집계표 (D-6) ──────────────────────
-- 다트가 참조하는 유일한 표입니다. 다트 실행 경로에 외부 API 호출이 없는 근거(SC-1).
create table if not exists dart_pool_stats (
  sigungu_code text not null references sigungu(code),
  theme        theme_key not null,
  place_count  int not null default 0,
  updated_at   timestamptz not null default now(),
  primary key (sigungu_code, theme)
);

-- 테마 '전체'용 뷰
create or replace view dart_pool_all
with (security_invoker = true) as
  select sigungu_code, sum(place_count)::int as place_count
  from dart_pool_stats group by sigungu_code;

-- ── 5. place_enrichment — 외부 API 응답 캐시 (AD-7, TTL 7일) ─────────────────
create table if not exists place_enrichment (
  place_id   uuid not null references places(id) on delete cascade,
  kind       text not null check (kind in ('related','course','photo')),
  payload    jsonb not null,
  fetched_at timestamptz not null default now(),
  primary key (place_id, kind)
);

-- ── 6. courses — 두루누비 부산 코스 (사전 적재) ──────────────────────────────
create table if not exists courses (
  id          text primary key,
  name        text not null,
  distance_km numeric,
  kind        text,                       -- 도보 / 자전거
  start_lat   double precision,
  start_lng   double precision,
  start_geom  geography(Point, 4326)
              generated always as
              (ST_SetSRID(ST_MakePoint(start_lng, start_lat), 4326)::geography) stored,
  detail      jsonb,
  synced_at   timestamptz not null default now()
);
create index if not exists courses_geom_idx on courses using gist (start_geom);

-- ── 7. reviews — 후기 (D-12) ─────────────────────────────────────────────────
-- 평점 컬럼이 존재하지 않습니다. 정렬에 쓰지 않겠다는 약속을 스키마로 고정한 것입니다 (§5.4).
create table if not exists reviews (
  id         uuid primary key default gen_random_uuid(),
  place_id   uuid not null references places(id) on delete cascade,
  author_ref text not null,                              -- 출처 무관 문자열 (D-9)
  body       text check (char_length(body) <= 60),       -- 선택
  photo_path text,                                       -- 선택
  created_at timestamptz not null default now()
);
create index if not exists reviews_place_idx on reviews (place_id, created_at desc);

-- ── 8. throws — 다트 결과 스냅샷 (공유 링크, D-18) ───────────────────────────
create table if not exists throws (
  id                  text primary key,          -- 짧은 공유 ID
  scope_sigungu_code  text references sigungu(code),   -- null = 부산 전체
  theme               theme_key,                       -- null = 전체
  result_sigungu_code text not null references sigungu(code),
  result_place_id     uuid not null references places(id),
  nearby_snapshot     jsonb not null,
  created_at          timestamptz not null default now(),
  expires_at          timestamptz not null default (now() + interval '30 days')
);

-- ── 9. sync_runs — 동기화 실행 로그 (DF-1 활성 유지 + DF-2 실패 감지) ────────
create table if not exists sync_runs (
  id            bigserial primary key,
  source        place_source not null,
  mode          text not null check (mode in ('backfill','incremental')),
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  status        text not null default 'running'
                check (status in ('running','ok','error')),
  fetched       int default 0,
  upserted      int default 0,
  skipped       int default 0,
  cursor        text,
  error_message text
);

-- ============================================================================
-- 집계표 갱신 (§5.5)
--
-- 집계표를 크론으로 하루 1회만 갱신하면, 사용자 등록 장소를 승인한 직후부터
-- 다음 크론까지 집계표와 실제가 어긋납니다(D-8 승인은 수시로 일어남).
-- 그 사이 다트가 어긋난 건수로 추출하면 결과가 빕니다. 그래서 행 트리거를 둡니다 (AD-4).
-- ============================================================================

create or replace function refresh_pool_stat(p_sigungu text, p_theme theme_key)
returns void
language plpgsql
set search_path = public
as $$
begin
  insert into dart_pool_stats (sigungu_code, theme, place_count, updated_at)
  select p_sigungu, p_theme, count(*), now()
    from places
   where sigungu_code = p_sigungu and theme = p_theme
     and status = 'published' and deleted_at is null
  on conflict (sigungu_code, theme)
  do update set place_count = excluded.place_count, updated_at = now();
end $$;

create or replace function places_stat_sync() returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- theme 이 null 인 행(미분류 보관함, §4.2)은 집계 대상이 아닙니다.
  -- dart_pool_stats.theme 이 not null 이라 null 로 호출하면 적재가 실패합니다.
  if TG_OP in ('INSERT','UPDATE') and NEW.theme is not null then
    perform refresh_pool_stat(NEW.sigungu_code, NEW.theme);
  end if;
  if TG_OP in ('UPDATE','DELETE') and OLD.theme is not null then
    perform refresh_pool_stat(OLD.sigungu_code, OLD.theme);
  end if;
  return null;
end $$;

drop trigger if exists trg_places_stat on places;
create trigger trg_places_stat
after insert or update or delete on places
for each row execute function places_stat_sync();

-- 백필처럼 수만 행을 한 번에 넣을 때는 트리거를 잠시 끄고, 완료 후 전체 재집계를 1회 실행합니다.
--   alter table places disable trigger trg_places_stat;
--   ... 대량 적재 ...
--   alter table places enable trigger trg_places_stat;
--   그 다음 08-recount.ts (재집계 + 대조).
-- 이 구간이 집계표 과소 계상의 발생 경로입니다. 재집계를 빠뜨려도 오류가 나지 않으므로
-- 08-recount.ts 가 재집계 직후 실계수와 대조까지 수행합니다 (§7.3).

-- ============================================================================
-- 다트 추출 (§7.3 · D-3)
--
-- ① 후보 구·군 = 해당 테마 건수 > 0 인 구·군
-- ② 후보 중 균등 랜덤 → 구·군 확정        ★ 밀도 무관 (D-3 1단계)
-- ③ 그 구·군 + 테마의 장소 중 균등 랜덤    → 장소 확정 (D-3 2단계)
--
-- 2단계에 order by random() 을 쓰지 않은 이유는 한 구·군의 장소가 많을 때
-- 매번 전체 정렬이 발생하기 때문입니다. 집계표 건수로 offset 을 잡으면
-- 인덱스 범위 스캔으로 끝납니다 (AD-5).
-- ============================================================================

create or replace function throw_dart(
  p_scope text default null,        -- null = 부산 전체
  p_theme theme_key default null    -- null = 전체 테마
) returns table (sigungu_code text, place_id uuid)
language plpgsql
set search_path = public
as $$
declare
  v_sigungu text;
  v_count   int;
begin
  -- ①·②단계 — 후보 구·군 중 균등 랜덤 (16행 이하라 전체 스캔이 저렴하고 정확히 균등)
  select s.sigungu_code into v_sigungu
  from (
    select d.sigungu_code, sum(d.place_count) as c
    from dart_pool_stats d
    where (p_theme is null or d.theme = p_theme)
      and (p_scope is null or d.sigungu_code = p_scope)
    group by d.sigungu_code
    having sum(d.place_count) > 0
  ) s
  order by random()
  limit 1;

  if v_sigungu is null then
    return;                          -- 빈 조합 — 호출측이 안내 화면으로 전환 (AD-10)
  end if;

  -- ③단계 — 해당 구·군 + 테마의 장소 중 균등 랜덤
  select coalesce(sum(dps.place_count), 0) into v_count
  from dart_pool_stats dps
  where dps.sigungu_code = v_sigungu
    and (p_theme is null or dps.theme = p_theme);

  return query
  select v_sigungu, p.id
  from places p
  where p.sigungu_code = v_sigungu
    and (p_theme is null or p.theme = p_theme)
    and p.status = 'published' and p.deleted_at is null
  offset floor(random() * v_count)
  limit 1;
end $$;

-- ============================================================================
-- theme_map 초기값 (§4.3)
--
-- 확인 열이 "실측"인 값은 실제 응답에서 직접 본 값이고(SYNC-5),
-- "추정"인 값은 `categoryCode2` 응답과 대조해 확정할 시드값입니다.
--
-- cat1 = 'A04'(쇼핑) 과 'B01' 은 **일부러 규칙을 넣지 않았습니다.**
-- 테마 4종 어디에도 들어가지 않아 미분류 보관함으로 가야 하는 값입니다 (AD-12 · AD-13).
-- 규칙을 넣으면 그 순간 다트 풀에 섞입니다.
-- ============================================================================

insert into theme_map (source, match_kind, match_value, theme, priority, note) values
  ('tourapi', 'cat1', 'A01', 'nature',   50, '실측 (SYNC-5) — 자연'),
  ('tourapi', 'cat1', 'A02', 'culture',  50, '실측 (SYNC-5) — 인문(문화/예술/역사)'),
  ('tourapi', 'cat1', 'A05', 'food',     50, '실측 (SYNC-5) — 음식. contenttypeid=39 와 함께 나타남'),
  ('tourapi', 'cat1', 'A03', 'activity', 50, '추정 — 표본에 없었음. categoryCode2 확인 시 최우선 대조 항목. 이 값이 틀리면 액티비티 테마의 모든 조합이 0건이 됨'),
  ('tourapi', 'content_type', '39', 'food', 70, '추정 — 음식점 유형. cat1 규칙이 먼저 적용되고 남는 경우의 보조'),
  ('busan_attraction', 'keyword', '해수욕장', 'nature',  90, '추정 — 백필 후 09-report.ts 결과로 조정'),
  ('busan_attraction', 'keyword', '공원',     'nature',  90, '추정'),
  ('busan_attraction', 'keyword', '산',       'nature',  90, '추정'),
  ('busan_attraction', 'keyword', '계곡',     'nature',  90, '추정'),
  ('busan_attraction', 'keyword', '박물관',   'culture', 90, '추정'),
  ('busan_attraction', 'keyword', '미술관',   'culture', 90, '추정'),
  ('busan_attraction', 'keyword', '마을',     'culture', 90, '추정'),
  ('busan_attraction', 'keyword', '거리',     'culture', 90, '추정')
on conflict (source, match_kind, match_value) do nothing;

-- 국가유산(source='heritage')은 §4.3 에서 "전건 → culture" 입니다.
-- 특정 값에 거는 규칙이 아니라 출처 전체에 거는 판정이라 theme_map 행으로 두지 않고
-- 백필 스크립트(05-heritage.ts)에서 지정합니다. 예외가 나타나면 그때 규칙을 추가합니다.
