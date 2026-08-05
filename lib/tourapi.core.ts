/**
 * 한국관광공사 국문 관광정보 서비스(KorService2) 호출 모듈 — 본체.
 *
 * 설계 정본: `API데이터설계.md` §3.1 · §2
 *
 * **이 파일에는 `server-only` 를 붙이지 않습니다.** 백필·리포트 스크립트(`scripts/`)가
 * Next 런타임 밖에서 같은 코드를 써야 하기 때문입니다. `server-only` 는 순수 Node 에서
 * import 하는 순간 예외를 던지므로, 웹 코드가 쓰는 창구인 `lib/tourapi.ts` 쪽에만 붙여
 * 두었습니다. 브라우저 번들 보호는 그 파일이 그대로 담당합니다.
 *
 * 지켜야 하는 것
 *  - 서비스 경로는 `KorService2` 입니다. `KorService1` 은 발급 키로 호출하면 HTTP 500 입니다 (D-23).
 *  - `arrange` · `listYN` 파라미터를 넣지 않습니다. 넣으면 INVALID_REQUEST_PARAMETER_ERROR 입니다 (D-23).
 *  - `MobileApp` 값은 `BusanDartrip` 고정입니다. 공공데이터포털 운영계정 승인요건 ② 입니다.
 *  - `showflag` 가 '1' 인 행만 씁니다 (SYNC-4 / AD-15).
 *  - `mapx` 가 경도, `mapy` 가 위도입니다 (SYNC-2 실측).
 *  - 서비스키는 서버·스크립트에서만 읽습니다. 브라우저로 나가는 경로가 없어야 합니다 (§2).
 */

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
  /**
   * 이 오퍼레이션이 세는 부산 전체 건수.
   * 2026-08-04 실측값은 **725** 입니다 (SYNC-6).
   *
   * `areaBasedSyncList2` 의 1,628 과 다른 값이며 정상입니다 — 두 오퍼레이션이 세는 대상이
   * 다릅니다. `areaBasedSyncList2` 는 삭제·미노출 이력을 포함하고, `areaBasedList2` 는
   * 현재 노출 대상만 돌려줍니다. 자세한 내용은 `API데이터설계.md` §3.1 을 보십시오.
   */
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

/** 페이지 순회 진행 상황. 스크립트가 콘솔에 찍는 데 씁니다. */
export interface PageProgress {
  pageNo: number;
  totalPages: number;
  totalCount: number;
  fetched: number;
  filteredOut: number;
  accumulated: number;
}

export interface IterateOptions extends Omit<AreaBasedListOptions, "pageNo"> {
  /** 한 번에 받는 건수. 포털 상한이 100 입니다. */
  pageSize?: number;
  /** 안전장치 — 이 페이지 수를 넘으면 멈춥니다. 무한 순회로 한도를 태우지 않기 위한 것입니다. */
  maxPages?: number;
  /** 페이지 사이 대기(ms). 포털 쪽 순간 부하를 낮춥니다. */
  delayMs?: number;
  onPage?: (progress: PageProgress) => void;
}

export interface IterateResult {
  totalCount: number;
  /** 실제로 호출한 횟수 — 한도 대조용 */
  calls: number;
  /** 응답에 담겨 온 누적 건수 (showflag 필터 전) */
  fetched: number;
  /** showflag 로 걸러낸 누적 건수 */
  filteredOut: number;
  items: TourPlace[];
  /** maxPages 에 걸려 중단됐는지 */
  truncated: boolean;
}

/**
 * `areaBasedList2` 를 첫 페이지부터 끝까지 순회합니다.
 *
 * 호출 수는 `ceil(totalCount / pageSize)` 입니다. 2026-08-04 실측 기준 부산 전역
 * `totalCount` 가 725 이므로 `pageSize=100` 이면 **8회**입니다 (SYNC-6).
 * 관광공사 개발계정 한도는 1,000회/일 입니다.
 */
export async function iterateAreaBasedList(
  options: IterateOptions = {},
): Promise<IterateResult> {
  const pageSize = Math.min(Math.max(options.pageSize ?? 100, 1), 100);
  const maxPages = options.maxPages ?? 60;
  const delayMs = options.delayMs ?? 200;

  const items: TourPlace[] = [];
  let totalCount = 0;
  let calls = 0;
  let fetched = 0;
  let filteredOut = 0;
  let truncated = false;

  for (let pageNo = 1; pageNo <= maxPages; pageNo += 1) {
    const page = await fetchAreaBasedList({
      pageNo,
      numOfRows: pageSize,
      sigunguCode: options.sigunguCode,
      contentTypeId: options.contentTypeId,
    });
    calls += 1;
    totalCount = page.totalCount || totalCount;
    fetched += page.fetched;
    filteredOut += page.filteredOut;
    items.push(...page.items);

    const totalPages = totalCount > 0 ? Math.ceil(totalCount / pageSize) : pageNo;
    options.onPage?.({
      pageNo,
      totalPages,
      totalCount,
      fetched: page.fetched,
      filteredOut: page.filteredOut,
      accumulated: items.length,
    });

    if (page.fetched === 0) break;
    if (fetched >= totalCount) break;
    if (pageNo === maxPages) {
      truncated = fetched < totalCount;
      break;
    }
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
  }

  return { totalCount, calls, fetched, filteredOut, items, truncated };
}

// ── 장소 1건 상세 (S4) ───────────────────────────────────────────────────────
//
// 아래 두 오퍼레이션은 **2026-08-05 실호출로 확인**했습니다. 설계 ④ §3.1 오퍼레이션 표에서
// `detailCommon2` 가 `[미확정]` 이었고, `detailImage2` 는 표에 없던 것입니다.
//
//   detailCommon2  contentId 1개 → 소개(overview) · 전화 · 홈페이지 · 분류 · 좌표
//   detailImage2   contentId 1개 → 이 장소의 사진 여러 장 (originimgurl · smallimageurl)
//
// **사진 캐러셀(화면구성도 §6.3-1)의 실제 재료가 `detailImage2` 입니다.** 설계는 그 자리를
// 관광사진 정보 서비스(④ §3.4)로 적었는데, 그 서비스는 장소 단위가 아니라 키워드 단위이고
// 결손이 잦습니다. 같은 장소의 사진을 정확히 주는 것은 이쪽입니다. 관광사진 서비스는
// `lib/photo.ts` 에서 보강용으로 따로 부릅니다 — 둘을 합쳐 캐러셀 한 줄이 됩니다.

/** `detailCommon2` 가 돌려주는 것 중 S4 가 쓰는 값. */
export interface TourPlaceDetail {
  contentId: string;
  title: string | null;
  overview: string | null;
  tel: string | null;
  homepage: string | null;
  address: string | null;
  firstImage: string | null;
  /** 공공누리 유형 코드(예: `Type3`). 사진 출처 표기 판단에 씁니다 */
  copyrightCode: string | null;
}

/** `detailImage2` 한 장. */
export interface TourPlaceImage {
  url: string;
  thumbUrl: string | null;
  name: string | null;
  /** 공공누리 유형 코드. `Type3` 계열은 출처 표기 의무가 있습니다 */
  copyrightCode: string | null;
}

/**
 * `homepage` 는 `<a href="...">...</a>` 형태로 옵니다(실측). 그대로 화면에 쓰면 태그가
 * 글자로 보이므로 주소만 뽑습니다. 태그가 없으면 원문을 그대로 씁니다.
 */
export function extractHomepageUrl(raw: string | null | undefined): string | null {
  const value = emptyToNull(raw ?? undefined);
  if (!value) return null;
  const href = /href\s*=\s*["']([^"']+)["']/i.exec(value);
  if (href) return href[1];
  const bare = /https?:\/\/[^\s"'<>]+/i.exec(value);
  return bare ? bare[0] : value.replace(/<[^>]*>/g, "").trim() || null;
}

/** `overview` 에는 `<br>` 같은 태그가 섞여 옵니다. 줄바꿈만 남기고 걷어냅니다. */
export function stripHtml(raw: string | null | undefined): string | null {
  const value = emptyToNull(raw ?? undefined);
  if (!value) return null;
  const text = value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text === "" ? null : text;
}

/** `detailCommon2` — 장소 1건의 소개·연락처. */
export async function fetchPlaceDetail(contentId: string): Promise<TourPlaceDetail | null> {
  const body = await callKorService2("detailCommon2", { contentId });
  const raws = readItems(body) as unknown as Array<Record<string, string | undefined>>;
  const raw = raws[0];
  if (!raw) return null;

  return {
    contentId: String(raw.contentid ?? contentId),
    title: emptyToNull(raw.title),
    overview: stripHtml(raw.overview),
    tel: emptyToNull(raw.tel),
    homepage: extractHomepageUrl(raw.homepage),
    address: emptyToNull([raw.addr1, raw.addr2].filter(Boolean).join(" ")),
    firstImage: emptyToNull(raw.firstimage),
    copyrightCode: emptyToNull(raw.cpyrhtDivCd),
  };
}

/** `detailImage2` — 장소 1건의 사진 목록. */
export async function fetchPlaceImages(contentId: string): Promise<TourPlaceImage[]> {
  const body = await callKorService2("detailImage2", { contentId, imageYN: "Y", numOfRows: 20, pageNo: 1 });
  const raws = readItems(body) as unknown as Array<Record<string, string | undefined>>;

  const seen = new Set<string>();
  const out: TourPlaceImage[] = [];
  for (const raw of raws) {
    const url = emptyToNull(raw.originimgurl) ?? emptyToNull(raw.smallimageurl);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({
      url,
      thumbUrl: emptyToNull(raw.smallimageurl),
      name: emptyToNull(raw.imgname),
      copyrightCode: emptyToNull(raw.cpyrhtDivCd),
    });
  }
  return out;
}

// ── 증분 동기화 목록 (`areaBasedSyncList2`, §6.3) ────────────────────────────
//
// **`modifiedtime` 은 "그 날짜 하루" 를 뜻합니다 — "그 날짜 이후" 가 아닙니다.**
// 2026-08-05 실호출로 확인했습니다.
//
//   modifiedtime 없음        totalCount 1,620   (삭제·미노출 이력 포함 누적)
//   modifiedtime=20250318    totalCount     5   (그 날 수정된 것만)
//   modifiedtime=20250101    totalCount     0   ← ">= 20250101" 이었다면 1,620 이 나왔어야 합니다
//   modifiedtime=20250318220404 (14자리)  totalCount 0   ← 8자리만 받습니다
//
// 이 사실이 §6.3 증분 경로의 모양을 정합니다. "마지막 실행 이후 전부" 를 한 번에 받을 수
// 없으므로, **날짜를 하루씩 짚어 가며** 부릅니다. 하루치는 보통 수 건이라 한 호출로 끝납니다.
// 크론이 며칠 쉬었다면 그만큼 날짜가 늘어나므로, 호출측이 한 실행의 날짜 수를 제한하고
// 남은 날짜를 커서에 남깁니다 (§6.4 1순위).
//
// `showflag` 파라미터는 **넣지 않습니다.** 넣으면 그 값인 행만 오는데, 증분 경로는
//   · `showflag='1'` → 적재·갱신
//   · `showflag='0'` → 내려간 것으로 보고 삭제 표시 (§6.3 ②단계)
// 두 가지를 **같은 응답에서** 갈라야 하기 때문입니다. 실측에서 파라미터 없이 부르면
// 두 값이 함께 옵니다(1,620 = 노출분 + `showflag='0'` 903).

/** `areaBasedSyncList2` 한 행. `showflag` 를 버리지 않고 그대로 들고 옵니다. */
export interface TourSyncItem extends TourPlace {
  /** `'1'` 노출 / `'0'` 제공기관이 내림. 값이 없으면 null */
  showflag: string | null;
}

export interface AreaBasedSyncResult {
  totalCount: number;
  pageNo: number;
  numOfRows: number;
  /** 응답에 담겨 온 건수 (거르지 않은 값) */
  fetched: number;
  items: TourSyncItem[];
}

export interface AreaBasedSyncOptions {
  /** `YYYYMMDD` 8자리. **그 날 하루**에 수정된 것만 옵니다 */
  modifiedDate: string;
  pageNo?: number;
  numOfRows?: number;
  sigunguCode?: string;
  contentTypeId?: string;
}

/** `areaBasedSyncList2` — 하루치 변경분 목록 (§6.3 ②단계). */
export async function fetchAreaBasedSyncList(
  options: AreaBasedSyncOptions,
): Promise<AreaBasedSyncResult> {
  const pageNo = options.pageNo ?? 1;
  const numOfRows = options.numOfRows ?? 100;

  const body = await callKorService2("areaBasedSyncList2", {
    areaCode: BUSAN_AREA_CODE,
    sigunguCode: options.sigunguCode,
    contentTypeId: options.contentTypeId,
    modifiedtime: options.modifiedDate,
    numOfRows,
    pageNo,
    // showflag 는 넣지 않습니다 — 위 주석 참조.
    // arrange · listYN 도 넣지 않습니다 (D-23).
  });

  const raws = readItems(body);

  return {
    totalCount: Number(body.totalCount ?? 0) || 0,
    pageNo: Number(body.pageNo ?? pageNo) || pageNo,
    numOfRows: Number(body.numOfRows ?? numOfRows) || numOfRows,
    fetched: raws.length,
    items: raws.map((raw) => ({ ...mapRawItem(raw), showflag: emptyToNull(raw.showflag) })),
  };
}

/** `areaCode2` 응답 1행 — 구·군 코드와 이름. */
export interface AreaCodeItem {
  code: string;
  name: string;
}

/**
 * `areaCode2` — 부산의 구·군 코드 목록.
 *
 * 이 오퍼레이션은 설계상 아직 `[미확정]` 입니다(④ §3.1 오퍼레이션 표 · U-1).
 * 응답 형태가 예상과 다르면 호출측이 그 사실을 그대로 보고하도록, 여기서는 값을 지어내지
 * 않고 빈 배열 또는 예외를 그대로 올립니다.
 */
export async function fetchAreaCodeList(areaCode?: string): Promise<AreaCodeItem[]> {
  const body = await callKorService2("areaCode2", {
    areaCode: areaCode ?? BUSAN_AREA_CODE,
    numOfRows: 100,
    pageNo: 1,
  });

  const raws = readItems(body) as unknown as Array<{ code?: string; name?: string }>;
  return raws
    .map((r) => ({ code: emptyToNull(r.code) ?? "", name: emptyToNull(r.name) ?? "" }))
    .filter((r) => r.code !== "" && r.name !== "");
}
