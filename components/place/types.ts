/**
 * S4 장소 상세 화면이 주고받는 값의 모양.
 *
 * 설계 정본: `화면구성도.md` §6.3(구성 요소)
 *
 * `lib/place.ts`·`lib/enrich.ts` 는 `server-only` 가 붙은 서버 전용 모듈이라, 브라우저에서 도는
 * 컴포넌트가 그 파일을 (타입만이라도) 가리키지 않게 여기에 따로 둡니다.
 * `components/result/types.ts` 와 같은 이유·같은 방식입니다.
 */

import type { ThemeKey } from "@/lib/theme";

/** 장소 1건 (§6.3-2·3·5) */
export interface PlaceDetailView {
  id: string;
  name: string;
  theme: ThemeKey | null;
  sigunguName: string;
  lat: number;
  lng: number;
  address: string | null;
  tel: string | null;
  homepage: string | null;
  image: string | null;
  isHiddenGem: boolean;
  /** 모범음식점 배지 (D-11). **표시 전용** — 이 값이 순서·노출을 바꾸는 곳이 없습니다 */
  isGoodRestaurant: boolean;
}

/** 캐러셀 사진 한 장 (§6.3-1) */
export interface PhotoView {
  url: string;
  label: string | null;
  /** 촬영자·제공자 표기. 있으면 캐러셀 아래에 적습니다 */
  credit: string | null;
}

/** 함께 가볼 만한 곳 한 칸 (§6.3-7 · §6.5) */
export interface RelatedView {
  name: string;
  region: string | null;
  category: string | null;
  /** 우리 `places` 에도 있는 장소면 그 id — 있을 때만 S4 로 잇습니다 */
  placeId: string | null;
}

/** 주변 도보 코스 한 줄 (§6.3-8) */
export interface CourseView {
  id: string;
  name: string;
  /** 이 장소에서 코스 시작점까지의 거리(m). 좌표를 아는 코스만 값이 있습니다 */
  distanceM: number | null;
  /** 코스 길이(km) */
  lengthKm: number | null;
  kind: string | null;
  region: string | null;
  /** `db` = 사전 적재분(좌표 있음) · `durunubi` = 두루누비 응답(좌표 없음) */
  origin: "db" | "durunubi";
}

/** 다녀온 사람들 한 줄 (§6.3-9). **별점 항목이 없습니다** (D-12 · AD-6) */
export interface ReviewView {
  id: string;
  body: string | null;
  photoPath: string | null;
  createdAt: string;
}
