/**
 * 한국관광공사 — 두루누비 정보 서비스 (S4 "주변 도보 코스" 보강).
 *
 * 설계 정본: `API데이터설계.md` §3.3 · §5.3(`courses`) / `화면구성도.md` §6.1 · §6.3-8
 *
 * `courses` 테이블과 어떻게 나눠 쓰는가 (A 자체 결정)
 * ---------------------------------------------------
 * 설계 §3.3 은 "코스 목록을 부산분만 사전 적재한 뒤, 상세 화면에서는 좌표 근접 계산으로 매칭"
 * 이라고 정해 두었습니다. 그 사전 적재 자리에 지금 들어 있는 것은 **부산시 부산도보여행정보
 * 56건**(`courses`, id 접두어 `busan-walking-`)이고, 이쪽에는 시작 좌표가 있어 **거리를 실제로
 * 잴 수 있습니다**. 그래서 역할을 이렇게 나눕니다.
 *
 *   1순위 `courses` 테이블 — 좌표가 있으므로 "여기서 몇 km" 를 말할 수 있습니다. 외부 호출 0회.
 *   2순위 두루누비 API    — 이 서비스의 코스 목록에는 좌표가 없고 지역명(`sigun`)만 있습니다.
 *                           그래서 거리는 못 재고, 같은 시·군의 코스를 **보강**으로 덧붙입니다.
 *
 * 순서를 이렇게 둔 이유는 하나입니다. **외부가 죽어도 이 블록이 살아 있어야 합니다.** 1순위가
 * DB 라서, 두루누비가 응답하지 않아도 주변 코스는 그대로 나옵니다(SC-6).
 *
 * 목록을 장소마다 받지 않습니다
 * -----------------------------
 * 이 API 는 좌표 조회가 없어 "이 장소 주변" 을 서버가 골라 줄 수 없습니다. 장소마다 전체 목록을
 * 받으면 같은 응답을 사람 수만큼 받게 되므로, **부산 코스 목록은 프로세스 안에서 한 번만**
 * 받아 두고(아래 메모리 캐시) 장소별 선별은 그 목록 위에서 합니다.
 */

import { callPortalAny, pick, pickNumber, type PortalCallResult } from "@/lib/dataportal.core";

/** 서비스 경로. 2026-08-05 확인 — 설계 §3.3 의 잠정 경로가 맞았습니다. */
export const DURUNUBI_SERVICE = "B551011/Durunubi";

/**
 * 오퍼레이션명 — 2026-08-05 실호출로 **존재 여부만** 확인했습니다(코드 30 = 있음 / 12 = 없음).
 *
 *   실재  `courseList` · `routeList`
 *   없음  `themeList` · `gpxList` · `courseList1` · `DurunubiList`
 */
const OPERATIONS = ["courseList", "routeList"] as const;

/** 메모리 캐시 수명. 코스는 거의 변하지 않습니다(§3.3). */
const MEMORY_TTL_MS = 6 * 60 * 60 * 1000;

export interface DuruCourse {
  id: string;
  name: string;
  /** 코스 길이(km). 장소로부터의 거리가 아닙니다 */
  lengthKm: number | null;
  /** 소요 시간 표기 */
  duration: string | null;
  /** 난이도 표기 */
  level: string | null;
  /** 지역 표기(`sigun`). 이 값으로 부산분을 가려냅니다 */
  region: string | null;
  summary: string | null;
}

export interface DuruResult {
  courses: DuruCourse[];
  operation: string;
  envelopePath: string | null;
  fieldsSeen: string[];
  /** 응답이 알려 준 전체 건수 */
  totalCount: number | null;
  /** 부산으로 걸러 내기 전 받은 건수 */
  fetched: number;
}

const NAME_KEYS = ["crsKorNm", "crsNm", "routeNm", "crsName"] as const;
const ID_KEYS = ["crsIdx", "routeIdx", "crsId"] as const;
const LENGTH_KEYS = ["crsDstnc", "crsDstance", "routeDstnc"] as const;
const DURATION_KEYS = ["crsTotlRqrmHour", "crsRqrmHour", "totlRqrmHour"] as const;
const LEVEL_KEYS = ["crsLevel", "crsLevelNm", "level"] as const;
const REGION_KEYS = ["sigun", "sigunNm", "areaNm", "signguNm"] as const;
const SUMMARY_KEYS = ["crsSummary", "crsContents", "crsTourInfo"] as const;

function toCourses(result: PortalCallResult): DuruResult {
  const seen = new Set<string>();
  const courses: DuruCourse[] = [];

  for (const raw of result.items) {
    const name = pick(raw, NAME_KEYS);
    if (!name) continue;
    const id = pick(raw, ID_KEYS) ?? name;
    if (seen.has(id)) continue;
    seen.add(id);

    courses.push({
      id: `durunubi-${id}`,
      name,
      lengthKm: pickNumber(raw, LENGTH_KEYS),
      duration: pick(raw, DURATION_KEYS),
      level: pick(raw, LEVEL_KEYS),
      region: pick(raw, REGION_KEYS),
      summary: pick(raw, SUMMARY_KEYS),
    });
  }

  return {
    courses,
    operation: result.operation,
    envelopePath: result.envelopePath,
    fieldsSeen: result.fieldsSeen,
    totalCount: result.totalCount,
    fetched: result.items.length,
  };
}

let memo: { at: number; value: DuruResult } | null = null;
let inflight: Promise<DuruResult> | null = null;

/** 부산 코스만 남깁니다. 지역 표기가 아예 없는 응답이면 거르지 않고 그대로 둡니다. */
function keepBusan(result: DuruResult): DuruResult {
  const hasRegion = result.courses.some((c) => c.region !== null);
  if (!hasRegion) return result;
  return {
    ...result,
    courses: result.courses.filter((c) => (c.region ?? "").includes("부산")),
  };
}

/**
 * 부산 도보 코스 목록. 프로세스 안에서 한 번만 실제로 부릅니다.
 * 실패는 예외로 올라가고 기억해 두지 않습니다 — 다음 요청에서 다시 시도합니다.
 */
export async function fetchBusanCourses(): Promise<DuruResult> {
  if (memo && Date.now() - memo.at < MEMORY_TTL_MS) return memo.value;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const result = await callPortalAny(DURUNUBI_SERVICE, OPERATIONS, {
        numOfRows: 100,
        pageNo: 1,
        brdDiv: "DNWW",
      });
      const value = keepBusan(toCourses(result));
      memo = { at: Date.now(), value };
      return value;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

/**
 * 어떤 구·군의 코스인지로 추립니다. 좌표가 없어 거리로는 못 고릅니다.
 * 구·군 이름이 걸리는 코스를 먼저, 그다음 부산 전체 코스를 채웁니다.
 */
export function selectForSigungu(
  courses: readonly DuruCourse[],
  sigunguName: string,
  limit: number,
): DuruCourse[] {
  const exact = courses.filter((c) => (c.region ?? "").includes(sigunguName));
  if (exact.length >= limit) return exact.slice(0, limit);
  const rest = courses.filter((c) => !exact.includes(c));
  return [...exact, ...rest].slice(0, limit);
}
