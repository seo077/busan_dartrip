/**
 * 행정안전부 모범음식점정보 조회서비스 호출 + 배지 매칭 규칙 — 본체.
 *
 * 설계 정본: `API데이터설계.md` §3.7 / `AI 논의사항.md` §D-11 · §D-26
 *
 * 이 파일이 하는 일은 두 가지입니다.
 *   1. 포털에서 모범음식점 원본을 받아 우리 쪽 모양(`GoodRestaurant`)으로 읽어냅니다.
 *   2. `places` 한 행에 배지를 붙일지 말지를 **순수 함수**로 판정합니다(`matchBadge`).
 *
 * **배지는 표시 전용입니다** (`D-11`). 이 파일이 만들어 내는 값은 `places.is_good_restaurant`
 * 하나뿐이고, 그 값은 다트 추출·정렬·필터 어디에도 들어가지 않습니다. `D-26` 이 배지에
 * 위생·안전 관점의 설명을 더했지만 역할은 "걸러내기"가 아니라 **"알려주기"** 이며,
 * `D-11`(배제·정렬 미사용)은 그대로입니다.
 *
 * 실측으로 확인한 규격 (2026-08-05, 활용신청 완료 후)
 * --------------------------------------------------
 *   경로        `apis.data.go.kr/1741000/excellent_restaurant_info/info`
 *   형식        `type=json`  ← 관광공사의 `_type` 도, 부산시의 `resultType` 도 아닙니다
 *   성공 판정   `response.header.resultCode = "0"`  ← `"0000"`·`"00"` 이 아닙니다
 *   봉투        `response.body.items.item[]`
 *   페이지 상한 **numOfRows 는 100 이 상한**입니다. 1000 을 넣어도 100 건만 옵니다
 *   전국 건수   65,426 → 100건 단위로 **655 회 호출**
 *   지역 필터   **없습니다.** `ctprvnNm`·`siDoNm` 등 후보 10종을 넣어 봤으나 전부 무시되고
 *              같은 1페이지가 돌아옵니다. 그래서 전국을 받아 주소 문자열로 부산을 가려냅니다
 *
 * 좌표 필드가 없습니다
 * --------------------
 * 응답에 위·경도가 없어 §3.7 의 "좌표 50m 이내" 규칙을 원본만으로는 쓸 수 없습니다.
 * 좌표는 **호출측이 도로명주소를 지오코딩해 채워 넣습니다**(`scripts/lib/kakao.ts`).
 * 이 파일은 좌표를 어디서 얻었는지 모릅니다 — `matchBadge` 는 좌표가 채워진 뒤에만 부릅니다.
 */

export const GOODFOOD_SERVICE = "1741000/excellent_restaurant_info";
export const GOODFOOD_OPERATION = "info";
export const GOODFOOD_URL = `https://apis.data.go.kr/${GOODFOOD_SERVICE}/${GOODFOOD_OPERATION}`;

/** 실측 상한. 이 값을 넘겨도 100 건만 옵니다. */
export const GOODFOOD_MAX_ROWS = 100;

/** §3.7 매칭 반경. 실측으로 이 값을 넓혀도 붙는 건수가 늘지 않았습니다(§아래 주석). */
export const MATCH_RADIUS_M = 50;

export type GoodFoodFailure =
  | "missing_key"
  | "not_registered"
  | "network"
  | "http"
  | "not_json"
  | "api_error";

export class GoodFoodError extends Error {
  readonly reason: GoodFoodFailure;
  readonly detail?: string;

  constructor(reason: GoodFoodFailure, message: string, detail?: string) {
    super(message);
    this.name = "GoodFoodError";
    this.reason = reason;
    this.detail = detail;
  }
}

/* ── 원본 한 행 ──────────────────────────────────────────────────────────── */

/**
 * 응답 한 행. 원본 컬럼명이 축약형이라(`BSNSSP_NM` 등) 읽는 자리에서 한 번만 풀어 둡니다.
 *
 * 쓰지 않는 원본 필드: `APLY_YMD`(신청일) · `DAT_UPDT_PNT`/`DAT_UPDT_SE`(적재 이력) ·
 * `LAST_MDFCN_PNT` · `LCPMT_NO`(인허가번호) · `OPN_ATMY_GRP_CD`(개방자치단체코드) ·
 * `RE_DSGN_YMD`(재지정일) · `IMPS_YMD`/`IMPS_RSN`(부산 전건이 빈 값이라 판정에 못 씁니다).
 */
export interface GoodRestaurant {
  /** `MNG_NO` — 인허가 관리번호. 부산 2,960건에서 중복 0 이라 식별자로 씁니다 */
  mngNo: string;
  /** `BSNSSP_NM` — 업소명 */
  name: string;
  /** `ROAD_NM_ADDR` — 도로명주소 */
  roadAddress: string | null;
  /** `LCTN_ADDR` — 소재지(지번)주소 */
  lotAddress: string | null;
  /** `TELNO` */
  tel: string | null;
  /** `PRINC_FD_KND` — 주된 음식 종류 */
  foodKind: string | null;
  /** `DSGN_YMD` — 지정일자 */
  designatedOn: string | null;
  /** `DSGN_RTRCN_YMD` — 지정 철회일자. 값이 있으면 **지금은 모범음식점이 아닙니다** */
  revokedOn: string | null;
  /** `DSGN_RTRCN_RSN` — 철회 사유 */
  revokeReason: string | null;
  /** `CLSBIZ_YMD` — 폐업일자 */
  closedOn: string | null;
  /** `SALS_STTS_NM` — 영업상태 (`영업` · `폐업` 2종만 확인됨) */
  salesStatus: string | null;
  /** 도로명주소를 지오코딩해 채웁니다. 원본에는 없습니다 */
  lat: number | null;
  lng: number | null;
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

export function readGoodRestaurant(raw: Record<string, unknown>): GoodRestaurant | null {
  const mngNo = str(raw.MNG_NO);
  const name = str(raw.BSNSSP_NM);
  if (!mngNo || !name) return null;

  return {
    mngNo,
    name,
    roadAddress: str(raw.ROAD_NM_ADDR),
    lotAddress: str(raw.LCTN_ADDR),
    tel: str(raw.TELNO),
    foodKind: str(raw.PRINC_FD_KND),
    designatedOn: str(raw.DSGN_YMD),
    revokedOn: str(raw.DSGN_RTRCN_YMD),
    revokeReason: str(raw.DSGN_RTRCN_RSN),
    closedOn: str(raw.CLSBIZ_YMD),
    salesStatus: str(raw.SALS_STTS_NM),
    lat: null,
    lng: null,
  };
}

/**
 * **지금 유효한 지정인가.** 세 조건을 모두 만족해야 합니다.
 *
 * 원본은 지정이 풀린 곳과 폐업한 곳을 **지우지 않고 그대로 담고 있습니다.**
 * 부산 2,960건의 실제 조합은 이렇습니다.
 *
 *   철회X · 폐업X · 영업   **342**  ← 여기만 지금 모범음식점입니다
 *   철회O · 폐업X · 영업     936
 *   철회O · 폐업O · 폐업   1,664
 *   철회X · 폐업O · 폐업      17
 *   철회X · 폐업X · 폐업       1
 *
 * 이 걸러내기를 빼면 **없는 인증을 표시하게 됩니다** — 2,960건 중 88%가 지금은 아닙니다.
 */
export function isActiveDesignation(g: GoodRestaurant): boolean {
  return g.revokedOn === null && g.closedOn === null && g.salesStatus === "영업";
}

/** 주소 문자열에 부산이 들어 있는가. 지역 필터 파라미터가 없어 여기서 가려냅니다. */
export function isBusanAddress(g: GoodRestaurant): boolean {
  return `${g.roadAddress ?? ""} ${g.lotAddress ?? ""}`.includes("부산");
}

/* ── 호출 ────────────────────────────────────────────────────────────────── */

function normalizeServiceKey(raw: string): string {
  if (!raw.includes("%")) return raw;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export function hasServiceKey(): boolean {
  return Boolean(process.env.DATA_GO_KR_KEY?.trim());
}

export interface GoodFoodPage {
  pageNo: number;
  numOfRows: number | null;
  totalCount: number;
  items: Record<string, unknown>[];
}

/** 한 페이지 호출. 실패는 예외로 올립니다 — 호출측이 이유에 맞는 안내를 고릅니다. */
export async function fetchGoodFoodPage(
  pageNo: number,
  numOfRows = GOODFOOD_MAX_ROWS,
  timeoutMs = 20_000,
): Promise<GoodFoodPage> {
  const key = process.env.DATA_GO_KR_KEY?.trim();
  if (!key) {
    throw new GoodFoodError(
      "missing_key",
      "공공데이터포털 서비스키(DATA_GO_KR_KEY)가 설정되지 않았습니다.",
    );
  }

  const search = new URLSearchParams();
  search.set("serviceKey", normalizeServiceKey(key));
  search.set("pageNo", String(pageNo));
  search.set("numOfRows", String(Math.min(numOfRows, GOODFOOD_MAX_ROWS)));
  search.set("type", "json");

  let res: Response;
  try {
    res = await fetch(`${GOODFOOD_URL}?${search.toString()}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Accept: "application/json" },
    });
  } catch (e) {
    throw new GoodFoodError(
      "network",
      "공공데이터포털에 연결하지 못했습니다.",
      e instanceof Error ? e.message : String(e),
    );
  }

  const text = await res.text();

  let json: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = JSON.parse(text);
    json = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    json = null;
  }

  // 키 미등록·한도 초과는 `response` 가 아예 없는 다른 봉투로 옵니다.
  const gateway = (json as { OpenAPI_ServiceResponse?: Record<string, unknown> } | null)
    ?.OpenAPI_ServiceResponse;
  if (gateway) {
    const cmm = (gateway.cmmMsgHeader ?? {}) as {
      errMsg?: string;
      returnAuthMsg?: string;
      returnReasonCode?: string;
    };
    throw new GoodFoodError(
      cmm.returnReasonCode === "30" ? "not_registered" : "api_error",
      `공공데이터포털 오류: ${cmm.returnAuthMsg ?? cmm.errMsg ?? "알 수 없는 오류"}` +
        (cmm.returnReasonCode ? ` (코드 ${cmm.returnReasonCode})` : "") +
        (cmm.returnReasonCode === "30"
          ? " — data.go.kr 15155052 활용신청 상태를 확인해 주세요."
          : ""),
      text.slice(0, 300),
    );
  }

  if (!res.ok) {
    throw new GoodFoodError(
      "http",
      `공공데이터포털이 ${res.status} 로 응답했습니다.`,
      text.slice(0, 300),
    );
  }
  if (json === null) {
    throw new GoodFoodError("not_json", "응답이 JSON 이 아닙니다.", text.slice(0, 300));
  }

  const response = (json.response ?? {}) as {
    header?: { resultCode?: string; resultMsg?: string };
    body?: {
      totalCount?: unknown;
      numOfRows?: unknown;
      items?: { item?: unknown };
    };
  };

  // 이 서비스의 정상 코드는 `"0"` 입니다. 관광공사(`"0000"`)·부산시(`"00"`)와 다릅니다.
  const code = response.header?.resultCode;
  if (code !== undefined && code !== "0" && code !== "00" && code !== "0000") {
    throw new GoodFoodError(
      "api_error",
      `모범음식점 조회서비스 오류: ${response.header?.resultMsg ?? "알 수 없는 오류"} (코드 ${code})`,
      text.slice(0, 300),
    );
  }

  const rawItems = response.body?.items?.item;
  const items = Array.isArray(rawItems)
    ? (rawItems.filter((x) => x && typeof x === "object") as Record<string, unknown>[])
    : rawItems && typeof rawItems === "object"
      ? [rawItems as Record<string, unknown>]
      : [];

  const total = Number(response.body?.totalCount);
  const rows = Number(response.body?.numOfRows);

  return {
    pageNo,
    numOfRows: Number.isFinite(rows) ? rows : null,
    totalCount: Number.isFinite(total) ? total : 0,
    items,
  };
}

/* ── 정규화 ──────────────────────────────────────────────────────────────── */

/**
 * 상호명 정규화 (§3.7 "상호명 정규화 일치").
 *
 *   `(주)사미헌`   → `사미헌`
 *   `동백섬 횟집`  → `동백섬횟집`
 *   `가야할매 밀면` → `가야할매밀면`
 *
 * 괄호 안은 통째로 뗍니다 — `(주)`·`(유)` 같은 법인격 표기가 한쪽에만 붙기 때문입니다.
 * 숫자는 **건드리지 않습니다.** `1번가`↔`일번가` 같은 표기 차이를 잡으려고 숫자를 지우면
 * `본가1호점`과 `본가2호점`이 같은 이름이 되어 버립니다.
 */
export function normalizeShopName(raw: string | null | undefined): string {
  return String(raw ?? "")
    .replace(/\([^)]*\)/g, "")
    .replace(/[\s·.,'"`\-_/()[\]&+]/g, "")
    .toLowerCase();
}

/**
 * 도로명주소 정규화. 괄호(법정동·건물명)와 쉼표 뒤 상세주소를 떼고 공백을 고릅니다.
 *
 *   `부산광역시 중구 광복중앙로 31 (신창동1가, 중앙아파트)` → `부산광역시 중구 광복중앙로 31`
 *   `부산광역시 서초구 서래로 50, 한영빌딩 1층 (반포동)`   → `부산광역시 서초구 서래로 50`
 *
 * 층·호수까지 남기면 같은 건물이 서로 다른 주소가 됩니다. 반대로 건물 단위로 자르면
 * **한 건물 안 여러 가게가 같은 주소**가 되므로, 주소만으로 붙이지 않고 이름 조건을 함께 겁니다.
 */
export function normalizeRoadAddress(raw: string | null | undefined): string {
  return String(raw ?? "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/,.*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/* ── 매칭 ────────────────────────────────────────────────────────────────── */

/** 배지를 붙인 근거. 실행 로그에 그대로 남겨 나중에 되짚을 수 있게 합니다. */
export type MatchKind =
  /** 50m 이내 + 상호명 정규화 완전 일치 (§3.7 원래 규칙) */
  | "name"
  /** 50m 이내 + 도로명주소 정규화 일치 + 한쪽 이름이 다른 쪽을 포함 (지점 표기 차이) */
  | "branch";

export interface MatchTarget {
  name: string;
  lat: number;
  lng: number;
  /** 도로명 기반 주소. 관광공사 `addr1` 이 여기 들어옵니다 */
  address: string | null;
}

export interface MatchResult {
  kind: MatchKind;
  good: GoodRestaurant;
  distanceM: number;
}

const EARTH_RADIUS_M = 6_371_008.8;

/** 두 좌표 사이 직선거리 (m). `lib/geo.ts` 와 같은 하버사인입니다 */
function distanceMeters(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * 장소 한 곳에 붙일 모범음식점을 고릅니다. 없으면 `null` — **지어내지 않습니다.**
 *
 * 두 갈래 중 하나에 걸려야 붙습니다.
 *
 *   ① `name`   반경 50m + 상호명 완전 일치            — §3.7 원래 규칙
 *   ② `branch` 반경 50m + 도로명주소 일치 + 이름 포함  — `이재모피자 본점` ↔ `이재모피자`
 *
 * ②를 "거리가 가깝다"가 아니라 **"도로명주소가 글자 그대로 같다"** 로 건 이유 — 같은 건물에
 * 다른 가게가 나란히 있는 경우가 실제로 있습니다(`솥이랑 서면점` 5m 옆에 `아웃백…서면점`).
 * 거리만으로 이름이 겹치는 쪽을 붙이면 그런 자리에서 **없는 인증이 표시됩니다.**
 * 주소가 같아도 이름이 서로를 포함하지 않으면 붙이지 않습니다(`금수복국 해운대본점` ↔
 * `금수복국 본점` 은 같은 가게로 보이지만 이 규칙에서는 실패로 남습니다).
 *
 * 반경을 넓혀도 붙는 건수가 늘지 않습니다 — 50 · 100 · 200 · 300m 로 넓혀 본 실측에서
 * 이름이 걸린 건수는 **24 로 같았고** 반경 안 후보만 50 → 143 으로 늘었습니다.
 * §3.7 의 50m 가 느슨한 값이 아니라는 뜻입니다.
 */
export function matchBadge(
  place: MatchTarget,
  candidates: GoodRestaurant[],
  radiusM = MATCH_RADIUS_M,
): MatchResult | null {
  const near: { good: GoodRestaurant; distanceM: number }[] = [];
  for (const g of candidates) {
    if (g.lat === null || g.lng === null) continue;
    const d = distanceMeters(place.lat, place.lng, g.lat, g.lng);
    if (d <= radiusM) near.push({ good: g, distanceM: d });
  }
  if (near.length === 0) return null;
  near.sort((a, b) => a.distanceM - b.distanceM);

  const placeName = normalizeShopName(place.name);
  const placeAddr = normalizeRoadAddress(place.address);

  const byName = near.find((c) => normalizeShopName(c.good.name) === placeName);
  if (byName) return { kind: "name", ...byName };

  const byBranch = near.find((c) => {
    if (placeAddr === "" || normalizeRoadAddress(c.good.roadAddress) !== placeAddr) return false;
    const goodName = normalizeShopName(c.good.name);
    if (placeName.length < 2 || goodName.length < 2) return false;
    return placeName.includes(goodName) || goodName.includes(placeName);
  });
  if (byBranch) return { kind: "branch", ...byBranch };

  return null;
}
