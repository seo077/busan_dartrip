-- ============================================================================
-- 부산 Dartrip — 행 수준 보안(RLS)
--
-- 설계 정본: `API데이터설계.md` §5.8
--
-- anon 키는 브라우저에 공개되므로, 무엇을 읽을 수 있는지는 이 파일이 정합니다.
-- **쓰기는 전부 API Route(서버, service_role 키)를 거칩니다.** 사용자 등록·후기에는
-- 서버측 검증(부산 경계 · 길이 제한 · 중복 · 이미지 검사)이 필요하고, 브라우저에서
-- 직접 쓰게 두면 그 검증을 우회할 수 있기 때문입니다.
--
-- RLS 를 켜고 정책을 만들지 않은 테이블은 anon 에게 전면 차단됩니다.
-- service_role 키는 RLS 를 통과하므로 서버 경로에는 영향이 없습니다.
-- ============================================================================

alter table sigungu          enable row level security;
alter table theme_map        enable row level security;
alter table places           enable row level security;
alter table dart_pool_stats  enable row level security;
alter table place_enrichment enable row level security;
alter table courses          enable row level security;
alter table reviews          enable row level security;
alter table throws           enable row level security;
alter table sync_runs        enable row level security;

-- ── places — 공개된 장소만 읽기 ──────────────────────────────────────────────
-- 설계 §5.8 은 status='published' 만 적고 있으나, 삭제 표시된 행(deleted_at)은
-- 다트 풀·근처 조회에서도 모두 빠지므로 공개 읽기에서도 함께 제외합니다.
drop policy if exists places_read_published on places;
create policy places_read_published on places
  for select to anon, authenticated
  using (status = 'published' and deleted_at is null);

-- ── dart_pool_stats · sigungu — 전체 읽기 ────────────────────────────────────
-- S1 이 0건 조합의 던지기 버튼을 미리 비활성화하려면 이 두 표가 필요합니다 (§7.2).
drop policy if exists dart_pool_stats_read on dart_pool_stats;
create policy dart_pool_stats_read on dart_pool_stats
  for select to anon, authenticated
  using (true);

drop policy if exists sigungu_read on sigungu;
create policy sigungu_read on sigungu
  for select to anon, authenticated
  using (true);

-- ── reviews — 전체 읽기 ──────────────────────────────────────────────────────
drop policy if exists reviews_read on reviews;
create policy reviews_read on reviews
  for select to anon, authenticated
  using (true);

-- ── throws — 만료 전 결과만 읽기 ─────────────────────────────────────────────
drop policy if exists throws_read_unexpired on throws;
create policy throws_read_unexpired on throws
  for select to anon, authenticated
  using (expires_at > now());

-- ── 그 외 (theme_map · place_enrichment · courses · sync_runs) ───────────────
-- 정책을 만들지 않습니다. RLS 가 켜져 있으므로 anon 은 읽기·쓰기 모두 차단됩니다.
-- 서버(service_role)만 접근합니다.
