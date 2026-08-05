-- ============================================================================
-- 부산 Dartrip — 등록 사진 보관함 (Storage 버킷)
--
-- 설계 정본: `API데이터설계.md` §5.6(스토리지) · §5.8(RLS) / `화면구성도.md` §7.3
--
-- S5(장소 등록)에서 올라오는 사진 1장을 담는 자리입니다. 후기 사진도 같은 버킷을 씁니다
-- (§5.6 제목이 "후기·등록 사진" 입니다).
--
-- 공개 읽기로 두는 이유
--   장소 사진은 `places.first_image` 에 URL 로 들어가고, 그 URL 은 S3·S4 가 그대로 씁니다.
--   관광공사 대표 이미지(외부 공개 URL)와 같은 방식으로 다루기 위해 공개 버킷입니다.
--
-- 쓰기 정책을 만들지 않는 이유
--   업로드는 전부 `POST /api/upload`(서버, service_role) 를 거칩니다(§5.8). service_role 은
--   스토리지 RLS 를 통과하므로 정책이 필요 없고, anon 정책이 없으니 브라우저에서 직접
--   올리는 통로도 없습니다 — 서버측 검사(크기·실제 이미지 여부)를 우회할 자리를 두지
--   않는다는 §5.8 의 원칙 그대로입니다.
--
-- 용량 상한 1MB 는 §5.6 의 "서버 검증 — 최대 1MB" 를 스토리지 쪽에도 같은 값으로 둔 것입니다.
-- 브라우저가 먼저 장변 1280px · WebP · 200KB 목표로 줄이므로 평상시에는 이 상한에 닿지 않습니다.
--
-- 여러 번 실행해도 결과가 같습니다.
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('place-photos', 'place-photos', true)
on conflict (id) do update set public = true;

-- 아래 두 컬럼은 Storage 버전에 따라 없을 수 있어, 있을 때만 채웁니다.
-- (없다고 해서 업로드가 막히지는 않습니다 — 크기·형식 검사는 `POST /api/upload` 가 합니다.)
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'storage' and table_name = 'buckets'
       and column_name = 'file_size_limit'
  ) then
    execute 'update storage.buckets set file_size_limit = 1048576 where id = ''place-photos''';
  end if;

  if exists (
    select 1 from information_schema.columns
     where table_schema = 'storage' and table_name = 'buckets'
       and column_name = 'allowed_mime_types'
  ) then
    execute 'update storage.buckets set allowed_mime_types = array[''image/webp'',''image/jpeg'',''image/png''] where id = ''place-photos''';
  end if;
end $$;
