/**
 * 좌표 계산 — 거리와 사각 범위.
 *
 * 설계 정본: `API데이터설계.md` §7.4("이 근처" 조회) · §7.5(반경 3km)
 *
 * DB 에는 PostGIS 가 있고 §7.4 는 `ST_DWithin` · `ST_Distance` 로 적혀 있습니다.
 * 다만 그 쿼리를 그대로 쓰려면 SQL 함수가 하나 더 필요한데, 이번 회차의 작업 범위가
 * `app/` · `lib/` · `components/` 로 한정돼 있어 마이그레이션을 추가하지 않았습니다.
 * 대신 **위·경도 사각 범위로 1차로 좁힌 뒤 정확한 거리를 여기서 계산**합니다.
 *
 * 결과가 달라지지 않는 이유:
 *   - 사각 범위는 반경 3km 원을 완전히 감싸므로 후보를 빠뜨리지 않습니다(포함 관계).
 *   - 최종 걸러내기와 정렬은 아래 하버사인 거리 하나로만 합니다.
 *
 * **정렬 키는 거리 하나뿐입니다.** 평점·인기·조회수는 스키마에 컬럼 자체가 없습니다
 * (`ARCHITECTURE.md` AD-6 · D-10 · D-11 · D-12).
 */

/** 지구 평균 반지름 (m) */
const EARTH_RADIUS_M = 6_371_008.8;

export interface LatLng {
  lat: number;
  lng: number;
}

/** 두 좌표 사이 직선거리 (m). 하버사인. */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface BoundingBox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

/**
 * 부산 대략 경계 상자. 행정 경계 폴리곤(U-10)이 아니라 넉넉히 잡은 사각형이며,
 * **판정 기준이 아니라 오적재 감지용 눈금**입니다 — `mapx`(경도)와 `mapy`(위도)를 뒤바꾸면
 * 위도가 129 대가 되어 한 번에 벗어납니다. 가덕도(남서)와 기장군 북단까지 들어옵니다.
 *
 * 백필(`scripts/lib/busan.ts`)과 증분 동기화(`lib/sync.ts`)가 **같은 눈금**을 써야 해서
 * 여기 둡니다. 두 곳이 다른 상자를 쓰면 백필로 들어온 장소가 동기화에서 밀려나는
 * (또는 그 반대의) 조용한 어긋남이 생깁니다.
 */
export const BUSAN_BBOX: BoundingBox = {
  minLat: 34.8,
  maxLat: 35.45,
  minLng: 128.7,
  maxLng: 129.4,
};

export function isInBusanBox(lat: number | null, lng: number | null): boolean {
  if (lat === null || lng === null) return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  return (
    lat >= BUSAN_BBOX.minLat &&
    lat <= BUSAN_BBOX.maxLat &&
    lng >= BUSAN_BBOX.minLng &&
    lng <= BUSAN_BBOX.maxLng
  );
}

/**
 * 중심에서 반경 `radiusM` 인 원을 **완전히 감싸는** 위·경도 사각 범위.
 * 경도 폭은 위도가 높을수록 넓어지므로 `cos(lat)` 으로 나눕니다.
 */
export function boundingBox(center: LatLng, radiusM: number): BoundingBox {
  const latDelta = (radiusM / EARTH_RADIUS_M) * (180 / Math.PI);
  const cos = Math.cos((center.lat * Math.PI) / 180);
  // 극 근처에서 0 으로 나누는 것을 막습니다. 부산 위도(35°)에서는 영향이 없습니다.
  const lngDelta = latDelta / Math.max(0.01, Math.abs(cos));

  return {
    minLat: center.lat - latDelta,
    maxLat: center.lat + latDelta,
    minLng: center.lng - lngDelta,
    maxLng: center.lng + lngDelta,
  };
}
