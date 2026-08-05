/**
 * S3 결과 화면이 주고받는 값의 모양.
 *
 * 설계 정본: `화면구성도.md` §5.3(구성 요소) / `API데이터설계.md` §5.3(`throws`) · §7.4("이 근처")
 *
 * `lib/dart.ts` 의 `PlaceCard`·`NearbyItem` 과 **같은 모양**이지만 일부러 여기에 따로 둡니다.
 * `lib/dart.ts` 는 `server-only` 가 붙은 서버 전용 모듈이라, 브라우저에서 도는 컴포넌트가
 * 그 파일을 (타입만이라도) 가리키지 않게 하려는 것입니다. 서버 쪽 값은 구조가 같으므로
 * 그대로 넘겨집니다.
 */

import type { ThemeKey } from "@/lib/theme";

/** 다트가 꽂힌 한 곳 (§5.3-1~4) */
export interface PlaceView {
  id: string;
  name: string;
  theme: ThemeKey | null;
  sigunguCode: string;
  sigunguName: string;
  lat: number;
  lng: number;
  address: string | null;
  image: string | null;
  isHiddenGem: boolean;
  isGoodRestaurant: boolean;
}

/** "이 근처" 한 줄 (§5.3-7·8·9). **거리 외의 순서 값이 없습니다** (D-10·D-11·D-12) */
export interface NearbyView {
  id: string;
  name: string;
  theme: ThemeKey | null;
  image: string | null;
  distanceM: number;
  isHiddenGem: boolean;
  isGoodRestaurant: boolean;
}
