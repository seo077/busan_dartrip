/**
 * 공공데이터포털(apis.data.go.kr) 공통 호출기 — S4 가 쓰는 관광공사 3종의 밑단.
 *
 * 설계 정본: `API데이터설계.md` §2(키 관리) · §3.2(연관관광지) · §3.3(두루누비) · §3.4(관광사진)
 *
 * 왜 `lib/tourapi.core.ts` 와 따로 두는가
 * ---------------------------------------
 * `tourapi.core.ts` 의 호출부는 `KorService2` 경로에 붙박이로 묶여 있고, **백필 스크립트
 * 4종이 이미 그 파일을 쓰고 있습니다**. 이번 화면을 위해 그 함수를 일반화하면 데이터
 * 파이프라인 전체가 같은 변경의 사정권에 들어옵니다. 얻는 것(중복 제거)보다 잃을 수 있는
 * 것(적재 경로 회귀)이 커서, 새 서비스 3종은 이 파일에서 따로 부릅니다.
 *
 * 규격을 상수로 못박지 않습니다
 * -----------------------------
 * 설계 §3.2~§3.4 는 경로·파라미터·응답 필드가 아직 `[미확정]` 이라고 적어 두었습니다.
 * 그래서 이 파일은 **응답 봉투를 뒤져서 `items` 를 찾고, 찾은 경로와 첫 행의 필드 이름을
 * 그대로 함께 돌려줍니다**(`envelopePath` · `fieldsSeen`). 규격이 예상과 다르면 그 사실이
 * 화면·응답에 사실대로 남습니다. `lib/busanapi.core.ts` 가 부산시 6종에 쓴 방식과 같습니다.
 *
 * 지켜야 하는 것
 *  - `MobileApp` 값은 `BusanDartrip` 고정입니다 (운영계정 승인요건 ②).
 *  - 서비스키는 서버에서만 읽습니다. 이 파일을 클라이언트 컴포넌트가 import 하는 경로가
 *    없어야 합니다 — 실제 진입점인 `lib/enrich.ts` 에 `server-only` 가 붙어 있습니다.
 *  - **다트 실행 경로(`/api/throw`)는 이 파일을 쓰지 않습니다** (D-6 · OG-1).
 */

export const PORTAL_BASE = "https://apis.data.go.kr";

/** 운영계정 승인요건 ②(MobileApp = 서비스 고유명)를 충족하는 값. 바꾸지 마십시오. */
export const MOBILE_APP = "BusanDartrip";

/** 호출이 어긋난 이유. 화면이 "무엇 때문에 비었는지" 를 구분하는 데 씁니다. */
export type PortalFailure =
  | "missing_key" // 서비스키 미설정
  | "not_registered" // 이 서비스에 대해 키가 활용신청되지 않음 (포털 코드 30)
  | "no_service" // 경로가 없거나 폐기됨 (코드 12)
  | "denied" // 접근 거부·기한 만료 (코드 20·31 등)
  | "quota" // 호출 한도 초과 (코드 22)
  | "network" // 연결 실패·타임아웃
  | "http" // 2xx 아님
  | "not_json" // 본문이 JSON 이 아님
  | "api_error"; // 응답은 왔으나 resultCode 가 정상이 아님

export class PortalError extends Error {
  readonly reason: PortalFailure;
  readonly service: string;
  readonly operation: string;
  readonly detail?: string;

  constructor(
    reason: PortalFailure,
    service: string,
    operation: string,
    message: string,
    detail?: string,
  ) {
    super(message);
    this.name = "PortalError";
    this.reason = reason;
    this.service = service;
    this.operation = operation;
    this.detail = detail;
  }
}

/** 다시 불러 볼 필요가 없는 실패인가 — 같은 요청 안에서 다른 오퍼레이션을 더 시도할지 판단합니다. */
export function isTerminal(reason: PortalFailure): boolean {
  return (
    reason === "missing_key" ||
    reason === "not_registered" ||
    reason === "denied" ||
    reason === "quota"
  );
}

/** 사람이 읽는 한 줄. 화면에는 내보내지 않고 서버 로그·진단 응답에만 씁니다. */
export function failureNote(reason: PortalFailure): string {
  switch (reason) {
    case "missing_key":
      return "서비스키가 설정되지 않았습니다.";
    case "not_registered":
      return "이 서비스에 대해 서비스키가 활용신청되지 않았습니다.";
    case "no_service":
      return "요청한 서비스 경로가 없거나 폐기됐습니다.";
    case "denied":
      return "서비스 접근이 거부됐거나 활용기한이 지났습니다.";
    case "quota":
      return "호출 한도를 넘었습니다.";
    case "network":
      return "포털에 연결하지 못했습니다.";
    case "http":
      return "포털이 정상 상태코드로 답하지 않았습니다.";
    case "not_json":
      return "응답이 JSON 이 아닙니다.";
    case "api_error":
      return "포털이 오류 코드를 돌려줬습니다.";
  }
}

/**
 * 서비스키는 인코딩된 형태와 아닌 형태가 함께 배포됩니다. `URLSearchParams` 가 다시
 * 인코딩하면 `%2B` 가 `%252B` 가 되어 인증이 깨지므로 한 번 되돌린 뒤 넘깁니다.
 * (`lib/tourapi.core.ts` 와 같은 처리입니다)
 */
function normalizeServiceKey(raw: string): string {
  if (!raw.includes("%")) return raw;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export function hasPortalKey(): boolean {
  return Boolean(process.env.DATA_GO_KR_KEY?.trim());
}

/** 포털 게이트웨이 오류 코드 → 우리 쪽 이유. 숫자는 포털 공통 코드표입니다. */
function reasonFromGatewayCode(code: string | undefined): PortalFailure {
  switch (code) {
    case "30":
      return "not_registered";
    case "12":
      return "no_service";
    case "22":
      return "quota";
    case "20":
    case "31":
      return "denied";
    default:
      return "api_error";
  }
}

export interface PortalCallResult {
  service: string;
  operation: string;
  /** 응답이 알려 준 전체 건수. 없으면 null */
  totalCount: number | null;
  /** 목록을 찾아낸 자리 (예: `response.body.items.item`). 규격 대조용입니다 */
  envelopePath: string | null;
  /** 첫 행의 필드 이름들. 문서가 `[미확정]` 으로 둔 부분을 사실로 바꾸는 근거입니다 */
  fieldsSeen: string[];
  items: Record<string, unknown>[];
}

/** 응답 트리에서 `items.item` 처럼 생긴 자리를 찾습니다. 봉투 모양을 상수로 고정하지 않습니다. */
function findItems(
  node: unknown,
  path: string,
  depth = 0,
): { items: Record<string, unknown>[]; path: string } | null {
  if (depth > 6 || !node || typeof node !== "object") return null;

  const obj = node as Record<string, unknown>;

  // ① 표준형 — { items: { item: [...] } } · { items: [...] }
  const items = obj.items;
  if (items !== undefined) {
    const inner = (items as Record<string, unknown>)?.item;
    if (Array.isArray(inner)) {
      return { items: inner as Record<string, unknown>[], path: `${path}.items.item` };
    }
    if (inner && typeof inner === "object") {
      return { items: [inner as Record<string, unknown>], path: `${path}.items.item` };
    }
    if (Array.isArray(items)) {
      return { items: items as Record<string, unknown>[], path: `${path}.items` };
    }
    // items 가 빈 문자열인 경우 = 0건. 이것도 정상 응답입니다.
    if (typeof items === "string") return { items: [], path: `${path}.items` };
  }

  // ② 한 단계 아래에 { item: [...] } 만 있는 형태
  const item = obj.item;
  if (Array.isArray(item)) {
    return { items: item as Record<string, unknown>[], path: `${path}.item` };
  }

  for (const [key, value] of Object.entries(obj)) {
    if (!value || typeof value !== "object") continue;
    const found = findItems(value, path ? `${path}.${key}` : key, depth + 1);
    if (found) return found;
  }
  return null;
}

/** 트리 어딘가의 `totalCount` 를 찾습니다. */
function findTotalCount(node: unknown, depth = 0): number | null {
  if (depth > 6 || !node || typeof node !== "object") return null;
  const obj = node as Record<string, unknown>;
  if (obj.totalCount !== undefined) {
    const n = Number(obj.totalCount);
    if (Number.isFinite(n)) return n;
  }
  for (const value of Object.values(obj)) {
    if (value && typeof value === "object") {
      const found = findTotalCount(value, depth + 1);
      if (found !== null) return found;
    }
  }
  return null;
}

export interface PortalCallOptions {
  /** 기본 8초. 상세 화면은 사용자를 기다리게 하므로 짧게 둡니다. */
  timeoutMs?: number;
}

/**
 * 포털 서비스 하나를 한 번 호출합니다.
 *
 * @param service `B551011/Durunubi` 처럼 기관코드/서비스명
 * @param operation `courseList` 처럼 오퍼레이션명
 */
export async function callPortal(
  service: string,
  operation: string,
  params: Record<string, string | number | undefined>,
  options: PortalCallOptions = {},
): Promise<PortalCallResult> {
  const raw = process.env.DATA_GO_KR_KEY?.trim();
  if (!raw) {
    throw new PortalError(
      "missing_key",
      service,
      operation,
      "공공데이터포털 서비스키(DATA_GO_KR_KEY)가 설정되지 않았습니다.",
    );
  }

  const search = new URLSearchParams();
  search.set("serviceKey", normalizeServiceKey(raw));
  search.set("MobileOS", "ETC");
  search.set("MobileApp", MOBILE_APP);
  search.set("_type", "json");
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === "") continue;
    search.set(k, String(v));
  }

  const url = `${PORTAL_BASE}/${service}/${operation}?${search.toString()}`;

  let res: Response;
  try {
    res = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(options.timeoutMs ?? 8_000),
      headers: { Accept: "application/json" },
    });
  } catch (e) {
    throw new PortalError(
      "network",
      service,
      operation,
      "공공데이터포털에 연결하지 못했습니다.",
      e instanceof Error ? e.message : String(e),
    );
  }

  const text = await res.text();

  let json: Record<string, unknown> | null = null;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    json = null;
  }

  // 키 미등록·한도 초과는 `response.header` 가 아예 없는 다른 봉투로 옵니다.
  // 먼저 보지 않으면 "0건" 으로 조용히 넘어가 원인을 못 찾습니다.
  const gateway = (json as { OpenAPI_ServiceResponse?: Record<string, unknown> } | null)
    ?.OpenAPI_ServiceResponse;
  if (gateway) {
    const cmm = (gateway.cmmMsgHeader ?? {}) as {
      errMsg?: string;
      returnAuthMsg?: string;
      returnReasonCode?: string;
    };
    const reason = reasonFromGatewayCode(cmm.returnReasonCode);
    throw new PortalError(
      reason,
      service,
      operation,
      `공공데이터포털 오류: ${cmm.returnAuthMsg ?? cmm.errMsg ?? "알 수 없는 오류"}` +
        (cmm.returnReasonCode ? ` (코드 ${cmm.returnReasonCode})` : ""),
      text.slice(0, 300),
    );
  }

  if (json === null) {
    throw new PortalError(
      res.ok ? "not_json" : "http",
      service,
      operation,
      res.ok
        ? "응답이 JSON 이 아닙니다. 서비스키 또는 호출 한도를 확인해 주세요."
        : `공공데이터포털이 ${res.status} 로 응답했습니다.`,
      text.slice(0, 300),
    );
  }

  if (!res.ok) {
    throw new PortalError(
      "http",
      service,
      operation,
      `공공데이터포털이 ${res.status} 로 응답했습니다.`,
      text.slice(0, 300),
    );
  }

  // 관광공사 계열은 `response.header.resultCode`, 그 밖은 `header.code` 를 씁니다(§3.5 대조표).
  const header = ((json as { response?: { header?: unknown } }).response?.header ??
    (json as { header?: unknown }).header ??
    {}) as { resultCode?: string; resultMsg?: string; code?: string; message?: string };

  const okCode =
    header.resultCode === undefined || header.resultCode === "0000" || header.resultCode === "00";
  const okAlt = header.code === undefined || header.code === "00" || header.code === "0000";

  if (!okCode || !okAlt) {
    throw new PortalError(
      "api_error",
      service,
      operation,
      `공공데이터포털 오류: ${header.resultMsg ?? header.message ?? "알 수 없는 오류"}` +
        ` (${header.resultCode ?? header.code})`,
      text.slice(0, 300),
    );
  }

  const found = findItems(json, "");
  const items = found?.items ?? [];

  return {
    service,
    operation,
    totalCount: findTotalCount(json),
    envelopePath: found?.path ?? null,
    fieldsSeen: items.length > 0 ? Object.keys(items[0]) : [],
    items,
  };
}

/**
 * 오퍼레이션 이름이 여러 후보로 갈릴 때, 되는 것을 찾아 씁니다.
 *
 * 설계 §3.2~§3.4 가 오퍼레이션명까지는 확정하지 못한 상태라 둔 장치입니다. 다만 키 미등록·
 * 한도 초과처럼 **다른 이름으로 불러도 결과가 같은 실패**는 첫 번째에서 바로 멈춥니다
 * (`isTerminal`) — 될 리 없는 호출로 한도를 태우지 않기 위해서입니다.
 */
export async function callPortalAny(
  service: string,
  operations: readonly string[],
  params: Record<string, string | number | undefined>,
  options: PortalCallOptions = {},
): Promise<PortalCallResult> {
  let first: PortalError | null = null;

  for (const operation of operations) {
    try {
      return await callPortal(service, operation, params, options);
    } catch (e) {
      if (!(e instanceof PortalError)) throw e;
      first ??= e;
      if (isTerminal(e.reason)) throw e;
    }
  }
  throw (
    first ??
    new PortalError("api_error", service, operations[0] ?? "", "호출할 오퍼레이션이 없습니다.")
  );
}

// ── 응답 필드 읽기 도우미 ────────────────────────────────────────────────────

/** 후보 키를 순서대로 훑어 처음 값이 있는 것을 씁니다. 대소문자는 가리지 않습니다. */
export function pick(
  item: Record<string, unknown>,
  candidates: readonly string[],
): string | null {
  for (const key of candidates) {
    const direct = item[key];
    const value = direct === undefined ? undefined : direct;
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  const lower = new Map(Object.keys(item).map((k) => [k.toLowerCase(), k]));
  for (const key of candidates) {
    const actual = lower.get(key.toLowerCase());
    if (!actual) continue;
    const value = item[actual];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return null;
}

export function pickNumber(
  item: Record<string, unknown>,
  candidates: readonly string[],
): number | null {
  const raw = pick(item, candidates);
  if (raw === null) return null;
  const n = Number(raw.replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}
