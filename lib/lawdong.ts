/**
 * 법정동 코드(행정표준코드) — 부산 시·도 코드와 16개 구·군 코드.
 *
 * 설계 정본: `API데이터설계.md` §3.2(연관관광지)
 *
 * 왜 이 표가 따로 필요한가
 * ------------------------
 * 관광공사 서비스라고 다 같은 지역 코드를 쓰지 않습니다. **두 체계가 따로 돕니다.**
 *
 *   국문 관광정보(KorService2)   `areaCode=6` · `sigunguCode=1~16`   ← 관광공사 자체 코드
 *   연관관광지(TarRlteTarService1) `areaCd=26` · `signguCd=26260`     ← 법정동 코드
 *
 * 두 체계를 섞으면 호출이 조용히 0건으로 돌아옵니다(오류도 안 납니다). 그래서 이 파일은
 * **연관관광지 계열 전용**이며, `sigungu.tour_api_sigungu_code`(관광공사 코드)와 절대
 * 같은 자리에 쓰지 않습니다.
 *
 * 값의 근거
 * ---------
 * 2026-08-05, 16개 코드를 각각 `areaBasedList1(areaCd=26, signguCd=<코드>)` 로 한 번씩
 * 호출해 응답의 `signguNm` 이 아래 이름과 일치하는 것을 확인했습니다. 추정값이 아닙니다.
 *
 * `places` 에는 이 값을 담을 컬럼이 없습니다 — `areaBasedList2` 응답의 `lDongRegnCd`·
 * `lDongSignguCd` 는 적재 대상이 아니었고(④ §3.1 "미사용" 행), `showflag='0'` 인 행에서는
 * 공란이라 신뢰할 수 있는 출처도 아니었습니다. 그래서 구·군 마스터의 내부 코드(slug)와
 * 이름을 열쇠로 삼는 **고정 대응표**를 둡니다. 부산 구·군은 16개로 고정이고 법정동 코드는
 * 국가 표준이라, 값이 바뀌면 그것 자체가 사건입니다.
 */

/** 부산광역시 법정동 시·도 코드. `areaCd` 자리에 들어갑니다. */
export const BUSAN_AREA_CD = "26";

/** 내부 구·군 코드(slug) → 법정동 시군구 코드. */
export const LAW_SIGNGU_CD_BY_SLUG: Readonly<Record<string, string>> = {
  jung: "26110", // 중구
  seo: "26140", // 서구
  dong: "26170", // 동구
  yeongdo: "26200", // 영도구
  busanjin: "26230", // 부산진구
  dongnae: "26260", // 동래구
  nam: "26290", // 남구
  buk: "26320", // 북구
  haeundae: "26350", // 해운대구
  saha: "26380", // 사하구
  geumjeong: "26410", // 금정구
  gangseo: "26440", // 강서구
  yeonje: "26470", // 연제구
  suyeong: "26500", // 수영구
  sasang: "26530", // 사상구
  gijang: "26710", // 기장군
};

/** 구·군 한글 이름 → 법정동 시군구 코드. slug 가 규칙과 다를 때의 보조 열쇠입니다. */
export const LAW_SIGNGU_CD_BY_NAME: Readonly<Record<string, string>> = {
  중구: "26110",
  서구: "26140",
  동구: "26170",
  영도구: "26200",
  부산진구: "26230",
  동래구: "26260",
  남구: "26290",
  북구: "26320",
  해운대구: "26350",
  사하구: "26380",
  금정구: "26410",
  강서구: "26440",
  연제구: "26470",
  수영구: "26500",
  사상구: "26530",
  기장군: "26710",
};

/**
 * 내부 코드 또는 구·군 이름을 법정동 시군구 코드로 옮깁니다.
 * **찾지 못하면 null 입니다** — 값을 지어내지 않습니다. 부르는 쪽은 호출을 건너뜁니다.
 */
export function lawSignguCd(...keys: (string | null | undefined)[]): string | null {
  for (const key of keys) {
    if (!key) continue;
    const k = String(key).trim();
    if (k === "") continue;
    const hit = LAW_SIGNGU_CD_BY_SLUG[k] ?? LAW_SIGNGU_CD_BY_NAME[k];
    if (hit) return hit;
    // 이미 법정동 코드 형태로 들어온 경우 (26 + 3자리)
    if (/^26\d{3}$/.test(k)) return k;
  }
  return null;
}
