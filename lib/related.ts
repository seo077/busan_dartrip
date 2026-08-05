/**
 * 한국관광공사 — 관광지별 연관관광지 정보 (S4 "함께 가볼 만한 곳").
 *
 * 설계 정본: `API데이터설계.md` §3.2 / `화면구성도.md` §6.1 · §6.3-7 · §6.5
 *
 * 이 API 는 **기준 관광지가 이미 정해져 있어야 동작**합니다(§3.2). 좌표로는 부를 수 없으므로
 * 다트 1단계에는 쓸 수 없고, 장소가 확정된 뒤인 S4 에서만 의미가 있습니다.
 *
 * 순위를 쓰지 않습니다
 * --------------------
 * 이 서비스의 응답에는 연관 순위(`rlteRank`)가 들어 있습니다. **읽지도, 보여주지도,
 * 정렬에 쓰지도 않습니다.** 관광 빅데이터에서 뽑은 순위는 결국 "많이 간 곳" 이고, 그 숫자를
 * 화면에 올리는 순간 D-10·D-11·D-12 가 없애려 한 서열이 다시 생깁니다. 응답이 준 순서를
 * 그대로 가로로 늘어놓고, 번호도 매기지 않습니다.
 *
 * 결손이 잦습니다 — 등재된 주요 관광지에만 데이터가 있습니다. 비면 블록을 통째로 감춥니다
 * (`ARCHITECTURE.md` AD-8 · 화면구성도 §6.3 주석).
 *
 * 2026-08-05 실호출로 확인한 것
 * -----------------------------
 * 1. **지역 코드가 필수입니다.** `keyword` + `baseYm` 만으로는 한 건도 오지 않습니다.
 *    `areaCd` 와 `signguCd` 를 **둘 다** 넣어야 응답이 옵니다(`areaCd` 만 넣어도 0건).
 *    코드 체계는 **법정동 코드**로, 국문 관광정보의 `areaCode=6`·`sigunguCode=1~16` 과
 *    다릅니다 — 표는 `lib/lawdong.ts`.
 * 2. **`keyword` 는 기준 관광지 이름의 부분 일치**입니다. 다만 **공백이 들어가면 0건**이
 *    되고(`"롯데월드 어드벤처 부산"` → 0 / `"롯데월드"` → 50), `&`·`/` 가 들어가면 응답
 *    봉투 자체가 깨집니다. 그래서 장소 이름을 그대로 보내지 않고 **가장 긴 낱말 한 개**만
 *    보낸 뒤, 받은 행 중에서 기준 관광지 이름(`tAtsNm`)이 우리 장소와 같은 것만 씁니다.
 * 3. **집계는 두 달쯤 늦게 붙습니다** (2026-08 시점 최신 = `202606`). 그래서 최신 연월을
 *    한 번 찾아 두고 프로세스 안에서 재사용합니다.
 * 4. 부산 16개 구·군의 기준 관광지는 **184곳**이고, 그중 우리 `places` 와 이름이 겹치는
 *    것은 **76곳**입니다. 나머지 장소에서는 이 블록이 비는 것이 정상입니다.
 */

import { callPortal, pick, type PortalCallResult } from "@/lib/dataportal.core";
import { BUSAN_AREA_CD } from "@/lib/lawdong";

/** 서비스 경로. 2026-08-05 확인 — 설계 §3.2 의 잠정 경로가 맞았습니다. */
export const RELATED_SERVICE = "B551011/TarRlteTarService1";

/**
 * 오퍼레이션명 — 2026-08-05 실호출로 확인했습니다.
 *
 *   실재  `searchKeyword1`(기준 관광지 이름으로) · `areaBasedList1`(구·군 전체)
 *   없음  `searchKeyword` · `areaBasedList` · `locationBasedList1`
 *
 * 좌표 조회(`locationBasedList1`)가 **없다는 것**도 함께 확인됐습니다 — 설계 §3.2 가 "좌표로
 * 조회할 수 없어 다트 1단계에는 사용 불가" 라고 적어 둔 근거가 사실로 확인된 셈입니다.
 */
const OP_SEARCH = "searchKeyword1";
const OP_AREA = "areaBasedList1";

/** 한 번에 받는 행 수. 포털 상한이 100 입니다. */
const PAGE_SIZE = 100;

/** 기준 관광지를 찾느라 넘겨 보는 페이지 수 상한. 한도를 태우지 않기 위한 뚜껑입니다. */
const MAX_PAGES = 3;

export interface RelatedPlace {
  name: string;
  /** 시·군·구 등 지역 표기. 없을 수 있습니다 */
  region: string | null;
  /** 분류 표기(대/중/소 중 잡히는 것). 없을 수 있습니다 */
  category: string | null;
  address: string | null;
}

export interface RelatedResult {
  items: RelatedPlace[];
  /** 실제로 통한 오퍼레이션명 — 문서의 `[미확정]` 을 사실로 바꾸는 근거입니다 */
  operation: string;
  envelopePath: string | null;
  fieldsSeen: string[];
  /** 통계 기준 연월. 이 값에 따라 결과가 있고 없고가 갈립니다 */
  baseYm: string;
  /** 실제로 보낸 법정동 시군구 코드 */
  signguCd: string | null;
  /** 실제로 보낸 검색어 (장소 이름에서 뽑은 낱말) */
  keyword: string | null;
  /** 응답에서 우리 장소와 같다고 판단한 기준 관광지 이름. 못 찾았으면 null */
  baseName: string | null;
}

const NAME_KEYS = ["rlteTatsNm", "rlteTatsNM", "rlteTatsName", "tatsNm", "title"] as const;
const REGION_KEYS = ["rlteSignguNm", "rlteRegnNm", "signguNm", "areaNm"] as const;
const CATEGORY_KEYS = ["rlteCtgrySclsNm", "rlteCtgryMclsNm", "rlteCtgryLclsNm", "cat3Nm"] as const;
const ADDRESS_KEYS = ["rlteBsicAdres", "rlteAdres", "addr1", "adres"] as const;
const BASE_NAME_KEYS = ["tAtsNm", "tAtsNM", "tatsNm"] as const;

/**
 * 이름 대조용 정규화 — 공백·괄호·가운뎃점·`/`·`&` 를 걷어내고 소문자로 맞춥니다.
 *
 * 우리 `places` 와 이 서비스의 표기가 자잘하게 다릅니다
 * (`구포 어린이교통공원` ↔ `구포어린이교통공원` · `KT&G상상마당/부산`). 그대로 비교하면
 * 실제로 데이터가 있는 장소를 놓칩니다.
 */
export function normalizeName(raw: string): string {
  return raw.replace(/[^0-9A-Za-z가-힣ㄱ-ㅎㅏ-ㅣ]/g, "").toLowerCase();
}

/**
 * 장소 이름에서 **검색어로 보낼 낱말 하나**를 고릅니다.
 *
 * 공백·`&`·`/` 가 섞이면 이 서비스의 `keyword` 는 0건을 돌려주므로, 이름을 낱말로 끊어
 * **가장 긴 것**을 씁니다. 가장 긴 낱말이 가장 덜 흔해서, 돌려받는 기준 관광지 수가 적습니다.
 * 뽑을 낱말이 없으면 null 이고, 그러면 호출 자체를 하지 않습니다.
 */
export function searchToken(name: string): string | null {
  const tokens = name
    .split(/[^0-9A-Za-z가-힣ㄱ-ㅎㅏ-ㅣ]+/)
    .map((t) => t.trim())
    .filter((t) => t !== "");
  if (tokens.length === 0) return null;
  return tokens.reduce((best, t) => (t.length > best.length ? t : best), tokens[0]);
}

/** 통계 기준 연월 후보 — 오늘에서 2·3·4·5개월 뒤로. 집계가 두 달쯤 늦게 붙습니다. */
function baseYmCandidates(now = new Date()): string[] {
  return [2, 3, 4, 5].map((back) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
    return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

/**
 * 쓸 수 있는 최신 기준 연월을 한 번 찾아 프로세스 안에서 재사용합니다.
 * 장소마다 다시 찾으면 없는 달을 계속 두드리게 되어 호출 한도만 축납니다.
 */
let resolvedBaseYm: string | null = null;

async function resolveBaseYm(signguCd: string): Promise<string> {
  if (resolvedBaseYm) return resolvedBaseYm;

  const candidates = baseYmCandidates();
  for (const baseYm of candidates) {
    const probe = await callPortal(RELATED_SERVICE, OP_AREA, {
      areaCd: BUSAN_AREA_CD,
      signguCd,
      baseYm,
      numOfRows: 1,
      pageNo: 1,
    });
    if (probe.items.length > 0) {
      resolvedBaseYm = baseYm;
      return baseYm;
    }
  }

  // 어느 달에도 없으면 가장 최근 후보를 그대로 씁니다. 결과는 빈 블록이 됩니다.
  resolvedBaseYm = candidates[0];
  return resolvedBaseYm;
}

function toRelated(
  result: PortalCallResult,
  rows: Record<string, unknown>[],
  meta: Omit<RelatedResult, "items" | "operation" | "envelopePath" | "fieldsSeen">,
): RelatedResult {
  const seen = new Set<string>();
  const items: RelatedPlace[] = [];

  for (const raw of rows) {
    const name = pick(raw, NAME_KEYS);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    items.push({
      name,
      region: pick(raw, REGION_KEYS),
      category: pick(raw, CATEGORY_KEYS),
      address: pick(raw, ADDRESS_KEYS),
    });
  }

  return {
    items,
    operation: result.operation,
    envelopePath: result.envelopePath,
    fieldsSeen: result.fieldsSeen,
    ...meta,
  };
}

export interface RelatedOptions {
  /** 법정동 시군구 코드(`lib/lawdong.ts`). **없으면 호출하지 않습니다** */
  signguCd: string | null;
  limit?: number;
}

/**
 * 기준 장소로 연관 관광지를 찾습니다.
 *
 * 실패는 예외로 올립니다 — 부르는 쪽(`lib/enrich.ts`)이 이유별로 캐시 수명을 다르게 잡습니다.
 * "데이터가 없다" 는 실패가 아니라 **빈 목록**으로 돌아옵니다.
 */
export async function fetchRelatedPlaces(
  placeName: string,
  options: RelatedOptions,
): Promise<RelatedResult> {
  const limit = options.limit ?? 12;
  const signguCd = options.signguCd;
  const keyword = searchToken(placeName);
  const wanted = normalizeName(placeName);

  const empty = (baseYm: string, operation: string): RelatedResult => ({
    items: [],
    operation,
    envelopePath: null,
    fieldsSeen: [],
    baseYm,
    signguCd,
    keyword,
    baseName: null,
  });

  // 구·군을 모르거나 이름에서 낱말을 못 뽑으면 부를 수 없습니다. 지어내지 않습니다.
  if (!signguCd || !keyword) return empty(baseYmCandidates()[0], OP_SEARCH);

  const baseYm = await resolveBaseYm(signguCd);

  let last: PortalCallResult | null = null;
  let fetched = 0;

  for (let pageNo = 1; pageNo <= MAX_PAGES; pageNo += 1) {
    const result = await callPortal(RELATED_SERVICE, OP_SEARCH, {
      keyword,
      areaCd: BUSAN_AREA_CD,
      signguCd,
      baseYm,
      numOfRows: PAGE_SIZE,
      pageNo,
    });
    last = result;
    fetched += result.items.length;

    // 이 페이지에서 우리 장소가 기준 관광지로 잡혔는가 — 이름이 같은 행만 취합니다.
    // 이름이 다른 기준 관광지의 연관 목록을 우리 장소 것처럼 보여 주지 않기 위해서입니다.
    const mine = result.items.filter(
      (row) => normalizeName(pick(row, BASE_NAME_KEYS) ?? "") === wanted,
    );
    if (mine.length > 0) {
      const baseName = pick(mine[0], BASE_NAME_KEYS);
      const mapped = toRelated(result, mine, {
        baseYm,
        signguCd,
        keyword,
        baseName,
      });
      return { ...mapped, items: mapped.items.slice(0, limit) };
    }

    if (result.items.length < PAGE_SIZE) break;
    if (result.totalCount !== null && fetched >= result.totalCount) break;
  }

  return last
    ? {
        ...toRelated(last, [], { baseYm, signguCd, keyword, baseName: null }),
        items: [],
      }
    : empty(baseYm, OP_SEARCH);
}
