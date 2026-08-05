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
 * 이 서비스의 응답에는 연관 순위(`rlteRank` 계열)가 들어 있습니다. **읽지도, 보여주지도,
 * 정렬에 쓰지도 않습니다.** 관광 빅데이터에서 뽑은 순위는 결국 "많이 간 곳" 이고, 그 숫자를
 * 화면에 올리는 순간 D-10·D-11·D-12 가 없애려 한 서열이 다시 생깁니다. 응답이 준 순서를
 * 그대로 가로로 늘어놓고, 번호도 매기지 않습니다.
 *
 * 결손이 잦습니다 — 등재된 주요 관광지에만 데이터가 있습니다. 비면 블록을 통째로 감춥니다
 * (`ARCHITECTURE.md` AD-8 · 화면구성도 §6.3 주석).
 */

import { callPortalAny, pick, type PortalCallResult } from "@/lib/dataportal.core";

/** 서비스 경로. 2026-08-05 확인 — 설계 §3.2 의 잠정 경로가 맞았습니다. */
export const RELATED_SERVICE = "B551011/TarRlteTarService1";

/**
 * 오퍼레이션명 — 2026-08-05 실호출로 **존재 여부만** 확인했습니다(코드 30 = 있음 / 12 = 없음).
 *
 *   실재  `searchKeyword1` · `areaBasedList1`
 *   없음  `searchKeyword` · `areaBasedList` · `locationBasedList1`
 *
 * 좌표 조회(`locationBasedList1`)가 **없다는 것**도 함께 확인됐습니다 — 설계 §3.2 가 "좌표로
 * 조회할 수 없어 다트 1단계에는 사용 불가" 라고 적어 둔 근거가 사실로 확인된 셈입니다.
 */
const OPERATIONS = ["searchKeyword1", "areaBasedList1"] as const;

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
}

/**
 * 통계 기준 연월 후보.
 *
 * 관광 빅데이터는 집계가 몇 달 늦게 붙습니다. 최근 달로 부르면 0건이 정상적으로 나오므로,
 * **호출 자체가 성공했는데 0건일 때만** 한 칸 더 과거로 물러나며 최대 3회까지 봅니다.
 * 호출이 실패한 경우에는 물러나지 않습니다 — 될 리 없는 호출로 한도를 태우지 않습니다.
 */
function baseYmCandidates(now = new Date()): string[] {
  const out: string[] = [];
  for (const back of [4, 10, 16]) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
    out.push(`${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

const NAME_KEYS = ["rlteTatsNm", "rlteTatsNM", "rlteTatsName", "tatsNm", "title"] as const;
const REGION_KEYS = ["rlteSignguNm", "rlteRegnNm", "signguNm", "areaNm"] as const;
const CATEGORY_KEYS = ["rlteCtgrySclsNm", "rlteCtgryMclsNm", "rlteCtgryLclsNm", "cat3Nm"] as const;
const ADDRESS_KEYS = ["rlteBsicAdres", "rlteAdres", "addr1", "adres"] as const;

function toRelated(result: PortalCallResult, baseYm: string): RelatedResult {
  const seen = new Set<string>();
  const items: RelatedPlace[] = [];

  for (const raw of result.items) {
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
    baseYm,
  };
}

/**
 * 기준 장소 이름으로 연관 관광지를 찾습니다.
 * 실패는 예외로 올립니다 — 부르는 쪽(`lib/enrich.ts`)이 이유별로 캐시 수명을 다르게 잡습니다.
 */
export async function fetchRelatedPlaces(
  placeName: string,
  options: { limit?: number } = {},
): Promise<RelatedResult> {
  const limit = options.limit ?? 12;
  const candidates = baseYmCandidates();

  let last: RelatedResult | null = null;

  for (const baseYm of candidates) {
    const result = await callPortalAny(RELATED_SERVICE, OPERATIONS, {
      keyword: placeName,
      baseYm,
      numOfRows: 30,
      pageNo: 1,
    });
    const mapped = toRelated(result, baseYm);
    last = mapped;
    if (mapped.items.length > 0) {
      return { ...mapped, items: mapped.items.slice(0, limit) };
    }
  }

  return last ?? { items: [], operation: OPERATIONS[0], envelopePath: null, fieldsSeen: [], baseYm: candidates[0] };
}
