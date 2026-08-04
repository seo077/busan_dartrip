/**
 * 한국관광공사 국문 관광정보 서비스(KorService2) 호출 모듈 — 서버 전용.
 *
 * 설계 정본: `API데이터설계.md` §3.1 · §2
 *
 * 지켜야 하는 것
 *  - 서비스 경로는 `KorService2` 입니다. `KorService1` 은 발급 키로 호출하면 HTTP 500 입니다 (D-23).
 *  - `arrange` · `listYN` 파라미터를 넣지 않습니다. 넣으면 INVALID_REQUEST_PARAMETER_ERROR 입니다 (D-23).
 *  - `MobileApp` 값은 `BusanDartrip` 고정입니다. 공공데이터포털 운영계정 승인요건 ② 입니다.
 *  - `showflag` 가 '1' 인 행만 씁니다 (SYNC-4 / AD-15).
 *  - `mapx` 가 경도, `mapy` 가 위도입니다 (SYNC-2 실측).
 *  - 서비스키는 서버에서만 읽습니다. 브라우저로 나가는 경로가 없어야 합니다 (§2).
 */

import "server-only";

export const TOUR_API_BASE = "https://apis.data.go.kr/B551011/KorService2";

/** 운영계정 승인요건 ②(MobileApp = 서비스 고유명)를 충족하는 값. 바꾸지 마십시오. */
export const MOBILE_APP = "BusanDartrip";

/**
 * 부산 지역코드. 설계상 `[미확정]` 이며 `areaCode2` 응답으로 확정할 항목입니다(U-1).
 * 값이 다르면 환경변수 `TOUR_API_AREA_CODE` 로 덮어씁니다.
 */
export const BUSAN_AREA_CODE = process.env.TOUR_API_AREA_CODE ?? "6";

/** 호출이 실패한 이유. 화면이 상황에 맞는 안내를 고르는 데 씁니다. */
export type TourApiFailure =
  | "missing_key" // 서비스키 미설정 — 사용자가 .env.local 을 채우면 해소
  | "network" // 네트워크 실패 · 타임아웃
  | "http" // 2xx 가 아닌 응답
  | "not_json" // 본문이 JSON 이 아님 (포털 오류는 XML 로 오는 경우가 있음)
  | "api_error"; // 응답은 왔으나 resultCode 가 0000 이 아님

export class TourApiError extends Error {
  readonly reason: TourApiFailure;
  readonly detail?: string;

  constructor(reason: TourApiFailure, message: string, detail?: string) {
    super(message);
    this.name = "TourApiError";
    this.reason = reason;
    this.detail = detail;
  }
}

/** 응답에서 취하는 원본 필드 (`API데이터설계.md` §3.1 "응답에서 취하는 필드"). */
export interface TourApiRawItem {
  contentid?: string;
  contenttypeid?: string;
  cat1?: string;
  cat2?: string;
  cat3?: string;
  title?: string;
  mapx?: string; // 경도
  mapy?: string; // 위도
  addr1?: string;
  addr2?: string;
  sigungucode?: string;
  showflag?: string; // '1' 인 행만 사용
  firstimage?: string;
  firstimage2?: string;
  tel?: string;
  modifiedtime?: string;
}

/** 내부에서 쓰는 형태로 옮긴 장소 1건. `places` 컬럼명과 맞춰 두었습니다. */
export interface TourPlace {
  sourceId: string;
  name: string;
  contentTypeId: string | null;
  cat1: string | null;
  cat2: string | null;
  cat3: string | null;
  lat: number | null; // ← mapy
  lng: number | null; // ← mapx
  address: string | null;
  sigunguCode: string | null;
  firstImage: string | null;
  firstImageThumb: string | null;
  tel: string | null;
  sourceModifiedAt: string | null;
}

export interface AreaBasedListResult {
  /** 부산 전체 등록 건수. 실측 기준값은 1,628 입니다 (SYNC-3). */
  totalCount: number;
  pageNo: number;
  numOfRows: number;
  /** 응답에 담겨 온 건수 (필터 전) */
  fetched: number;
  /** showflag 가 '1' 이 아니어서 걸러낸 건수 (SYNC-4 / AD-15) */
  filteredOut: number;
  items: TourPlace[];
}

/**
 * 공공데이터포털 서비스키는 인코딩된 형태와 아닌 형태가 함께 배포됩니다.
 * URLSearchParams 가 다시 인코딩하면 `%2B` 가 `%252B` 가 되어 인증이 깨지므로,
 * 이미 인코딩된 값으로 보이면 한 번 되돌린 뒤 넘깁니다.
 */
function normalizeServiceKey(raw: string): string {
  if (!raw.includes("%")) return raw;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function readServiceKey(): string {
  const raw = process.env.DATA_GO_KR_KEY?.trim();
  if (!raw) {
    throw new TourApiError(
      "missing_key",
      "공공데이터포털 서비스키(DATA_GO_KR_KEY)가 설정되지 않았습니다.",
    );
  }
  return normalizeServiceKey(raw);
}

/** 서비스키 설정 여부만 확인합니다. 값 자체는 반환하지 않습니다. */
export function hasServiceKey(): boolean {
  return Boolean(process.env.DATA_GO_KR_KEY?.trim());
}

function toNumber(value: string | undefined): number | null {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function emptyToNull(value: string | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * `modifiedtime` 은 `20240115103000` 형태입니다. 그대로 두면 DB 의 timestamptz 에 들어가지 않아
 * ISO 문자열로 옮겨 둡니다. 형식이 다르면 원문을 그대로 돌려줍니다.
 */
function toIsoFromCompact(value: string | undefined): string | null {
  const raw = emptyToNull(value);
  if (!raw) return null;
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?$/.exec(raw);
  if (!m) return raw;
  const [, y, mo, d, h = "00", mi = "00", s = "00"] = m;
  return `${y}-${mo}-${d}T${h}:${mi}:${s}+09:00`;
}

export function mapRawItem(raw: TourApiRawItem): TourPlace {
  return {
    sourceId: String(raw.contentid ?? ""),
    name: emptyToNull(raw.title) ?? "(이름 없음)",
    contentTypeId: emptyToNull(raw.contenttypeid),
    cat1: emptyToNull(raw.cat1),
    cat2: emptyToNull(raw.cat2),
    cat3: emptyToNull(raw.cat3),
    lat: toNumber(raw.mapy), // mapy = 위도 (SYNC-2)
    lng: toNumber(raw.mapx), // mapx = 경도 (SYNC-2)
    address: emptyToNull([raw.addr1, raw.addr2].filter(Boolean).join(" ")),
    sigunguCode: emptyToNull(raw.sigungucode),
    firstImage: emptyToNull(raw.firstimage),
    firstImageThumb: emptyToNull(raw.firstimage2),
    tel: emptyToNull(raw.tel),
    sourceModifiedAt: toIsoFromCompact(raw.modifiedtime),
  };
}

/** `showflag` 가 '1' 인 행만 통과시킵니다 (SYNC-4 / AD-15). */
export function isVisible(raw: TourApiRawItem): boolean {
  const flag = emptyToNull(raw.showflag);
  // 필드가 아예 없는 경우는 보수적으로 통과시킵니다. 값이 있으면 '1' 만 통과합니다.
  return flag === null ? true : flag === "1";
}

/** 응답의 `items` 는 배열 · 단건 객체 · 빈 문자열 세 형태로 옵니다. */
function readItems(body: unknown): TourApiRawItem[] {
  if (!body || typeof body !== "object") return [];
  const items = (body as { items?: unknown }).items;
  if (!items || typeof items !== "object") return [];
  const item = (items as { item?: unknown }).item;
  if (Array.isArray(item)) return item as TourApiRawItem[];
  if (item && typeof item === "object") return [item as TourApiRawItem];
  return [];
}

async function callKorService2(
  operation: string,
  params: Record<string, string | number | undefined>,
): Promise<Record<string, unknown>> {
  const serviceKey = readServiceKey();

  const search = new URLSearchParams();
  search.set("serviceKey", serviceKey);
  search.set("MobileOS", "ETC");
  search.set("MobileApp", MOBILE_APP);
  search.set("_type", "json");
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === "") continue;
    // arrange · listYN 은 이 서비스가 거부합니다 (D-23). 실수로 들어오면 버립니다.
    if (k === "arrange" || k === "listYN") continue;
    search.set(k, String(v));
  }

  const url = `${TOUR_API_BASE}/${operation}?${search.toString()}`;

  let res: Response;
  try {
    res = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
      headers: { Accept: "application/json" },
    });
  } catch (e) {
    throw new TourApiError(
      "network",
      "공공데이터포털에 연결하지 못했습니다.",
      e instanceof Error ? e.message : String(e),
    );
  }

  const text = await res.text();

  let json: Record<string, unknown> | null = null;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    json = null; // 포털 오류는 XML 로 오는 경우가 있습니다. 아래에서 처리합니다.
  }

  // 서비스키가 등록되지 않았거나 한도를 넘으면 포털 공통 게이트웨이가 다른 봉투로 답합니다.
  // HTTP 상태(403 등)보다 이 메시지가 원인을 훨씬 정확히 알려 주므로 먼저 봅니다.
  // 이 봉투에는 response.header 가 아예 없어, 확인하지 않으면 "0건" 으로 조용히 넘어갑니다.
  const gateway = (json as { OpenAPI_ServiceResponse?: Record<string, unknown> } | null)
    ?.OpenAPI_ServiceResponse;
  if (gateway) {
    const cmm = (gateway.cmmMsgHeader ?? {}) as {
      errMsg?: string;
      returnAuthMsg?: string;
      returnReasonCode?: string;
    };
    throw new TourApiError(
      "api_error",
      `공공데이터포털 오류: ${cmm.returnAuthMsg ?? cmm.errMsg ?? "알 수 없는 오류"}` +
        (cmm.returnReasonCode ? ` (코드 ${cmm.returnReasonCode})` : ""),
      text.slice(0, 300),
    );
  }

  if (!res.ok) {
    throw new TourApiError(
      "http",
      `공공데이터포털이 ${res.status} 로 응답했습니다.`,
      text.slice(0, 300),
    );
  }

  if (json === null) {
    // 키가 틀렸거나 트래픽 한도를 넘으면 JSON 대신 XML 오류 문서가 옵니다.
    throw new TourApiError(
      "not_json",
      "응답이 JSON 이 아닙니다. 서비스키 또는 호출 한도를 확인해 주세요.",
      text.slice(0, 300),
    );
  }

  const response = (json as { response?: Record<string, unknown> }).response;

  if (!response) {
    throw new TourApiError(
      "api_error",
      "응답 형식이 예상과 다릅니다. 서비스 경로와 파라미터를 확인해 주세요.",
      text.slice(0, 300),
    );
  }

  const header = (response.header ?? {}) as {
    resultCode?: string;
    resultMsg?: string;
  };

  if (header.resultCode !== undefined && header.resultCode !== "0000") {
    throw new TourApiError(
      "api_error",
      `공공데이터포털 오류: ${header.resultMsg ?? "알 수 없는 오류"} (${header.resultCode})`,
      text.slice(0, 300),
    );
  }

  return (response.body ?? {}) as Record<string, unknown>;
}

export interface AreaBasedListOptions {
  pageNo?: number;
  numOfRows?: number;
  /** 구·군 코드. 비우면 부산 전역입니다. */
  sigunguCode?: string;
  /** 12 관광지 / 14 문화시설 / 28 레포츠 / 39 음식점 등 */
  contentTypeId?: string;
}

/**
 * `areaBasedList2` — 부산 전체 장소 목록.
 * 백필(§6.2)과 뼈대 배포 화면이 같은 경로를 씁니다.
 */
export async function fetchAreaBasedList(
  options: AreaBasedListOptions = {},
): Promise<AreaBasedListResult> {
  const pageNo = options.pageNo ?? 1;
  const numOfRows = options.numOfRows ?? 12;

  const body = await callKorService2("areaBasedList2", {
    areaCode: BUSAN_AREA_CODE,
    sigunguCode: options.sigunguCode,
    contentTypeId: options.contentTypeId,
    numOfRows,
    pageNo,
    // arrange · listYN 은 넣지 않습니다 (D-23).
  });

  const raws = readItems(body);
  const visible = raws.filter(isVisible);

  return {
    totalCount: Number(body.totalCount ?? 0) || 0,
    pageNo: Number(body.pageNo ?? pageNo) || pageNo,
    numOfRows: Number(body.numOfRows ?? numOfRows) || numOfRows,
    fetched: raws.length,
    filteredOut: raws.length - visible.length,
    items: visible.map(mapRawItem),
  };
}
