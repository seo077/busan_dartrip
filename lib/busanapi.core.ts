/**
 * 부산광역시 공공데이터 서비스(기관코드 6260000) 호출 모듈 — 본체.
 *
 * 설계 정본: `API데이터설계.md` §3.5 / `AI 논의사항.md` §"부산명소정보 API 실측 확인"(BUSAN-1~5)
 *
 * **관광공사(`lib/tourapi.core.ts`)와 규격이 다릅니다.** 재사용할 수 없어 따로 둡니다.
 *
 *   | 항목        | 관광공사 KorService2      | 부산시 6260000            |
 *   |-------------|---------------------------|---------------------------|
 *   | 형식 파라미터 | `_type=json`              | **`resultType=json`**     |
 *   | 성공 판정    | `response.header.resultCode = "0000"` | **`header.code = "00"`(`NORMAL_CODE`)** |
 *   | 응답 루트    | `response.body.items.item[]` | **`{오퍼레이션명}.item[]`** |
 *   | 필수 파라미터 | `MobileOS` · `MobileApp` 요구 | 요구하지 않음            |
 *
 * `server-only` 를 붙이지 않는 이유는 `lib/tourapi.core.ts` 와 같습니다 — `scripts/` 가
 * Next 런타임 밖에서 같은 코드를 씁니다.
 *
 * 응답 구조를 **추측해서 고정하지 않았습니다.** 오퍼레이션마다 봉투가 조금씩 다를 수 있어,
 * `item` · `totalCount` · `header` 를 응답 트리에서 찾아내고 **어느 경로에서 찾았는지까지
 * 함께 돌려줍니다**(`itemPath` 등). 정찰 스크립트가 그 경로를 그대로 출력하므로,
 * 규격이 예상과 다르면 값을 지어내는 대신 다르다는 사실이 화면에 남습니다.
 */

export const BUSAN_API_BASE = "https://apis.data.go.kr/6260000";

/** 부산시 오픈API 한 종의 명세. 경로는 사용자가 활용신청을 마친 6종입니다. */
export interface BusanServiceSpec {
  /** 내부 식별자 (CLI 인자로 씁니다) */
  key: string;
  /** 사람이 읽는 이름 */
  label: string;
  /** `{서비스}/{오퍼레이션}` — 기관코드 뒤에 붙는 경로 */
  path: string;
  /** 확인된 건수·비고 (호출 전 안내용) */
  note?: string;
}

export const BUSAN_SERVICES: BusanServiceSpec[] = [
  {
    key: "attraction",
    label: "부산명소정보",
    path: "AttractionService/getAttractionKr",
    note: "totalCount 213 확인 (BUSAN-5)",
  },
  {
    key: "walking",
    label: "부산도보여행정보",
    path: "WalkingService/getWalkingKr",
    note: "문서 예시 기준 약 26건",
  },
  {
    key: "food",
    label: "부산맛집정보",
    path: "FoodService/getFoodKr",
    note: "건수 미확인",
  },
  {
    key: "festival",
    label: "부산축제정보",
    path: "FestivalService/getFestivalKr",
    note: "건수 미확인",
  },
  {
    key: "shopping",
    label: "부산쇼핑정보",
    path: "ShoppingService/getShoppingKr",
    note: "건수 미확인",
  },
  {
    key: "visitorstat",
    label: "관광실태조사 통계",
    path: "BusanTourStaticService2/getVisitorStatInfo2",
    note: "건수 미확인 · 장소가 아니라 통계",
  },
];

export function findService(key: string): BusanServiceSpec | undefined {
  return BUSAN_SERVICES.find((s) => s.key === key.toLowerCase());
}

/** 호출이 실패한 이유. 화면·스크립트가 상황에 맞는 안내를 고르는 데 씁니다. */
export type BusanApiFailure =
  | "missing_key"
  | "network"
  | "http"
  | "not_json"
  | "api_error";

export class BusanApiError extends Error {
  readonly reason: BusanApiFailure;
  readonly detail?: string;

  constructor(reason: BusanApiFailure, message: string, detail?: string) {
    super(message);
    this.name = "BusanApiError";
    this.reason = reason;
    this.detail = detail;
  }
}

/**
 * 공공데이터포털 서비스키는 인코딩된 형태와 아닌 형태가 함께 배포됩니다.
 * `URLSearchParams` 가 다시 인코딩하면 `%2B` 가 `%252B` 가 되어 인증이 깨집니다.
 * (`lib/tourapi.core.ts` 와 같은 처리 — 키가 같은 포털이라 규칙도 같습니다.)
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
    throw new BusanApiError(
      "missing_key",
      "공공데이터포털 서비스키(DATA_GO_KR_KEY)가 설정되지 않았습니다.",
    );
  }
  return normalizeServiceKey(raw);
}

export function hasServiceKey(): boolean {
  return Boolean(process.env.DATA_GO_KR_KEY?.trim());
}

/* ────────────────────────────────────────────────────────────────────────────
 * 응답 트리 탐색
 *
 * 봉투 모양을 상수로 박지 않고 찾아냅니다. 찾은 경로를 함께 돌려주므로,
 * 규격이 예상과 다르면 그 사실이 그대로 드러납니다.
 * ──────────────────────────────────────────────────────────────────────────── */

type Json = Record<string, unknown>;

function isObject(v: unknown): v is Json {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

interface Found<T> {
  value: T;
  path: string;
}

/** 너비 우선으로 조건에 맞는 첫 노드를 찾습니다. 얕은 곳을 먼저 봅니다. */
function bfsFind(
  root: unknown,
  match: (key: string, value: unknown) => boolean,
  maxDepth = 6,
): Found<unknown> | null {
  const queue: Array<{ node: unknown; path: string; depth: number }> = [
    { node: root, path: "", depth: 0 },
  ];

  while (queue.length > 0) {
    const { node, path, depth } = queue.shift()!;
    if (depth > maxDepth || !isObject(node)) continue;

    for (const [key, value] of Object.entries(node)) {
      if (match(key, value)) {
        return { value, path: path === "" ? key : `${path}.${key}` };
      }
    }
    for (const [key, value] of Object.entries(node)) {
      queue.push({
        node: value,
        path: path === "" ? key : `${path}.${key}`,
        depth: depth + 1,
      });
    }
  }
  return null;
}

/** 부산시 API 응답 한 건을 읽어낸 결과. */
export interface BusanEnvelope {
  /** 응답 루트 키 (보통 오퍼레이션명) */
  rootKey: string | null;
  headerCode: string | null;
  headerMessage: string | null;
  headerPath: string | null;
  totalCount: number | null;
  totalCountPath: string | null;
  numOfRows: number | null;
  pageNo: number | null;
  items: Json[];
  itemPath: string | null;
  /** 파싱한 JSON 원본 — 정찰 스크립트가 구조를 그리는 데 씁니다. */
  json: Json;
}

function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toStr(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

export function readEnvelope(json: Json): BusanEnvelope {
  const topKeys = Object.keys(json);
  const rootKey = topKeys.length > 0 ? topKeys[0] : null;

  // header — `{ code, message }` 또는 `{ resultCode, resultMsg }` 둘 다 받습니다.
  const headerNode = bfsFind(json, (k, v) => k === "header" && isObject(v));
  let headerCode: string | null = null;
  let headerMessage: string | null = null;
  if (headerNode && isObject(headerNode.value)) {
    const h = headerNode.value;
    headerCode = toStr(h.code ?? h.resultCode ?? h.resultCd);
    headerMessage = toStr(h.message ?? h.resultMsg ?? h.resultMessage);
  }

  const totalNode = bfsFind(json, (k, v) => k === "totalCount" && toNum(v) !== null);
  const rowsNode = bfsFind(json, (k, v) => k === "numOfRows" && toNum(v) !== null);
  const pageNode = bfsFind(json, (k, v) => k === "pageNo" && toNum(v) !== null);

  // item — 배열이거나 단건 객체입니다 (건수가 1이면 객체로 오는 경우가 있습니다).
  const itemNode = bfsFind(
    json,
    (k, v) => k === "item" && (Array.isArray(v) || isObject(v)),
  );

  let items: Json[] = [];
  if (itemNode) {
    if (Array.isArray(itemNode.value)) {
      items = itemNode.value.filter(isObject);
    } else if (isObject(itemNode.value)) {
      items = [itemNode.value];
    }
  }

  return {
    rootKey,
    headerCode,
    headerMessage,
    headerPath: headerNode?.path ?? null,
    totalCount: totalNode ? toNum(totalNode.value) : null,
    totalCountPath: totalNode?.path ?? null,
    numOfRows: rowsNode ? toNum(rowsNode.value) : null,
    pageNo: pageNode ? toNum(pageNode.value) : null,
    items,
    itemPath: itemNode?.path ?? null,
    json,
  };
}

/** 정상 코드로 볼 값. 부산시는 `"00"` + `NORMAL_CODE` 입니다. */
const OK_CODES = new Set(["00", "0", "000", "0000"]);

export function isNormalCode(code: string | null): boolean {
  if (code === null) return true; // 코드가 아예 없으면 판정 보류 — 값을 지어내지 않습니다.
  return OK_CODES.has(code);
}

export interface BusanCallOptions {
  pageNo?: number;
  numOfRows?: number;
  /** 오퍼레이션별 추가 파라미터 (통계 서비스의 연도 등) */
  extra?: Record<string, string | number | undefined>;
  timeoutMs?: number;
}

/**
 * 부산시 오픈API 한 번 호출.
 *
 * 실패는 예외(`BusanApiError`)로 올립니다. 호출측이 이유(`reason`)에 맞는 안내를 고릅니다.
 */
export async function callBusanService(
  spec: BusanServiceSpec,
  options: BusanCallOptions = {},
): Promise<BusanEnvelope> {
  const serviceKey = readServiceKey();

  const search = new URLSearchParams();
  search.set("serviceKey", serviceKey);
  search.set("pageNo", String(options.pageNo ?? 1));
  search.set("numOfRows", String(options.numOfRows ?? 10));
  search.set("resultType", "json"); // ← 관광공사의 `_type` 이 아닙니다
  for (const [k, v] of Object.entries(options.extra ?? {})) {
    if (v === undefined || v === "") continue;
    search.set(k, String(v));
  }

  const url = `${BUSAN_API_BASE}/${spec.path}?${search.toString()}`;

  let res: Response;
  try {
    res = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
      headers: { Accept: "application/json" },
    });
  } catch (e) {
    throw new BusanApiError(
      "network",
      "부산시 오픈API 에 연결하지 못했습니다.",
      e instanceof Error ? e.message : String(e),
    );
  }

  const text = await res.text();

  let json: Json | null = null;
  try {
    const parsed: unknown = JSON.parse(text);
    json = isObject(parsed) ? parsed : null;
  } catch {
    json = null;
  }

  // 포털 공통 게이트웨이 오류(키 미등록·한도 초과)는 다른 봉투로 옵니다.
  // HTTP 상태보다 이 메시지가 원인을 정확히 알려 주므로 먼저 봅니다.
  const gateway = (json as { OpenAPI_ServiceResponse?: Json } | null)
    ?.OpenAPI_ServiceResponse;
  if (gateway) {
    const cmm = (gateway.cmmMsgHeader ?? {}) as {
      errMsg?: string;
      returnAuthMsg?: string;
      returnReasonCode?: string;
    };
    throw new BusanApiError(
      "api_error",
      `공공데이터포털 오류: ${cmm.returnAuthMsg ?? cmm.errMsg ?? "알 수 없는 오류"}` +
        (cmm.returnReasonCode ? ` (코드 ${cmm.returnReasonCode})` : ""),
      text.slice(0, 300),
    );
  }

  if (!res.ok) {
    throw new BusanApiError(
      "http",
      `부산시 오픈API 가 ${res.status} 로 응답했습니다.`,
      text.slice(0, 300),
    );
  }

  if (json === null) {
    throw new BusanApiError(
      "not_json",
      "응답이 JSON 이 아닙니다. `resultType=json` 을 지원하는지, 서비스키가 이 서비스에 활용신청돼 있는지 확인해 주세요.",
      text.slice(0, 300),
    );
  }

  const envelope = readEnvelope(json);

  if (!isNormalCode(envelope.headerCode)) {
    throw new BusanApiError(
      "api_error",
      `부산시 오픈API 오류: ${envelope.headerMessage ?? "알 수 없는 오류"} (코드 ${envelope.headerCode})`,
      text.slice(0, 300),
    );
  }

  return envelope;
}

/**
 * 한 오퍼레이션을 첫 페이지부터 끝까지 순회합니다.
 * 부산시 한도는 10,000회/일이라 100건 단위 순회가 부담이 되지 않습니다.
 */
export interface BusanIterateOptions extends BusanCallOptions {
  pageSize?: number;
  maxPages?: number;
  delayMs?: number;
  onPage?: (p: {
    pageNo: number;
    totalPages: number;
    totalCount: number;
    fetched: number;
    accumulated: number;
  }) => void;
}

export interface BusanIterateResult {
  totalCount: number;
  calls: number;
  items: Json[];
  truncated: boolean;
  /** 첫 페이지의 봉투 — 응답 경로를 리포트에 남기는 데 씁니다. */
  first: BusanEnvelope | null;
}

export async function iterateBusanService(
  spec: BusanServiceSpec,
  options: BusanIterateOptions = {},
): Promise<BusanIterateResult> {
  const pageSize = Math.min(Math.max(options.pageSize ?? 100, 1), 1000);
  const maxPages = options.maxPages ?? 30;
  const delayMs = options.delayMs ?? 200;

  const items: Json[] = [];
  let totalCount = 0;
  let calls = 0;
  let truncated = false;
  let first: BusanEnvelope | null = null;

  for (let pageNo = 1; pageNo <= maxPages; pageNo += 1) {
    const page = await callBusanService(spec, {
      pageNo,
      numOfRows: pageSize,
      extra: options.extra,
    });
    calls += 1;
    if (first === null) first = page;
    totalCount = page.totalCount ?? totalCount;
    items.push(...page.items);

    const totalPages = totalCount > 0 ? Math.ceil(totalCount / pageSize) : pageNo;
    options.onPage?.({
      pageNo,
      totalPages,
      totalCount,
      fetched: page.items.length,
      accumulated: items.length,
    });

    if (page.items.length === 0) break;
    if (totalCount > 0 && items.length >= totalCount) break;
    if (pageNo === maxPages) {
      truncated = totalCount > 0 && items.length < totalCount;
      break;
    }
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
  }

  return { totalCount, calls, items, truncated, first };
}
