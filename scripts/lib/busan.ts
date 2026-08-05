/**
 * 부산 관련 상수 — 좌표 점검 범위와 구·군 내부 코드 규칙.
 *
 * 여기 있는 값들은 **판정 기준이 아니라 오적재 감지용 눈금**입니다.
 * 예를 들어 `mapx`(경도)와 `mapy`(위도)를 뒤바꿔 적재하면 위도가 129 대가 되어
 * 아래 범위를 한 번에 벗어나므로, 리포트에서 바로 눈에 띕니다.
 */

/**
 * 부산 경계 상자는 **`lib/geo.ts` 가 단일 출처**입니다.
 * 증분 동기화(`lib/sync.ts`)가 같은 눈금을 써야 하는데, 그쪽은 Next 런타임이라
 * `scripts/` 를 import 하지 않습니다. 그래서 상자를 `lib/` 로 올리고 여기서는 다시 내보내
 * 기존 백필 스크립트의 import 경로를 그대로 둡니다.
 */
export { BUSAN_BBOX, isInBusanBox } from "../../lib/geo";

/**
 * 구·군 마스터의 임시 중심 좌표.
 *
 * `sigungu.center_lat` · `center_lng` 는 not null 인데 `areaCode2` 응답에는 좌표가 없습니다.
 * 그래서 처음에는 부산 기준점 하나를 넣어 두고, 장소가 적재된 뒤
 * `01-sigungu.ts --recenter` 가 그 구·군에 속한 장소들의 평균 좌표로 덮어씁니다.
 * 이 값이 화면에 그대로 쓰이는 곳은 아직 없습니다(지도 중심은 Phase 3 이후).
 */
export const BUSAN_REFERENCE_POINT = { lat: 35.1796, lng: 129.0756 } as const;

/**
 * 구·군 이름 → 내부 코드(slug).
 *
 * `places.sigungu_code` 가 참조하는 값이며, 관광공사 코드가 아니라 **내부 식별자**입니다
 * (스키마 §5.3 — 관광공사 코드는 `sigungu.tour_api_sigungu_code` 에 따로 둡니다).
 * 출처가 여러 개라 소스별 코드를 그대로 쓰면 부산명소·국가유산이 같은 구를 다른 키로
 * 가리키게 되므로, 이름을 사람이 읽는 slug 하나로 모읍니다.
 *
 * 목록에 없는 이름이 오면 `bs-<관광공사코드>` 로 떨어집니다 — 값을 지어내지 않습니다.
 */
export const SIGUNGU_SLUG_BY_NAME: Record<string, string> = {
  중구: "jung",
  서구: "seo",
  동구: "dong",
  영도구: "yeongdo",
  부산진구: "busanjin",
  동래구: "dongnae",
  남구: "nam",
  북구: "buk",
  해운대구: "haeundae",
  사하구: "saha",
  금정구: "geumjeong",
  강서구: "gangseo",
  연제구: "yeonje",
  수영구: "suyeong",
  사상구: "sasang",
  기장군: "gijang",
};

export function slugForSigungu(name: string, tourApiCode: string): string {
  const trimmed = name.trim();
  return SIGUNGU_SLUG_BY_NAME[trimmed] ?? `bs-${tourApiCode}`;
}

/** 부산 구·군 수. 표의 행 수가 이 값과 다르면 마스터 적재가 덜 된 것입니다. */
export const BUSAN_SIGUNGU_COUNT = 16;

/**
 * 부산시 오픈API 의 `MAIN_TITLE` 꼬리에 붙은 언어 표기를 뗍니다 (BUSAN-2).
 *
 *   `국립해양박물관(한,영,중간,중번,일)` → `국립해양박물관`
 *   `초량이바구길 (한,영,중간,중번,일)`  → `초량이바구길`
 *
 * 언어 표기로 보이는 괄호만 떼며, 그 밖의 괄호는 이름의 일부일 수 있어 남깁니다.
 * 명소는 `PLACE` 가 깨끗해서 이 함수가 거의 안 쓰이지만, 도보여행은 `PLACE` 가
 * 경유지 나열이라 `MAIN_TITLE` 을 정제해 코스 이름으로 씁니다.
 */
export function stripLanguageTags(raw: string): string {
  return raw
    .replace(/\s*[(（]\s*(?:한|영|중간|중번|일)(?:\s*,\s*(?:한|영|중간|중번|일))*\s*[)）]\s*$/u, "")
    .trim();
}
