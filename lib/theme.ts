/**
 * 테마 4종과 원본 분류 → 테마 매핑 규칙 적용기.
 *
 * 설계 정본: `API데이터설계.md` §4.1 · §4.2 · §4.3 / `ARCHITECTURE.md` AD-2 · AD-13
 *
 * **매핑 값 자체는 이 파일에 두지 않습니다.** 관광공사 분류코드 실값이 아직 전부 확인되지
 * 않았고(U-1), 코드에 박아 두면 값이 바뀔 때마다 재배포·재분류가 필요합니다(AD-2).
 * 값은 DB 의 `theme_map` 테이블에 있고, 이 파일은 그 규칙을 우선순위대로 적용하는 부분만 맡습니다.
 * 초기값은 마이그레이션(`supabase/migrations/*_init_schema.sql`)의 insert 로 들어갑니다.
 *
 * 매칭에 실패한 장소는 버리지 않고 `places.status = 'unclassified'` 로 보관합니다(AD-13).
 * 다트 풀 조건이 모두 `status = 'published'` 라 미분류는 자동으로 빠집니다.
 */

/** 4테마 (D-5). DB enum `theme_key` 와 값이 같아야 합니다. */
export const THEME_KEYS = ["food", "nature", "culture", "activity"] as const;

export type ThemeKey = (typeof THEME_KEYS)[number];

export const THEME_LABELS: Record<ThemeKey, string> = {
  food: "식도락",
  nature: "자연",
  culture: "문화·예술",
  activity: "액티비티",
};

export function isThemeKey(value: unknown): value is ThemeKey {
  return typeof value === "string" && (THEME_KEYS as readonly string[]).includes(value);
}

/** 장소의 출처 (DB enum `place_source`). */
export const PLACE_SOURCES = [
  "tourapi",
  "busan_attraction",
  "heritage",
  "seed",
  "user",
] as const;

export type PlaceSource = (typeof PLACE_SOURCES)[number];

/** 장소의 상태 (DB enum `place_status`). `unclassified` = 미분류 보관함 (AD-13). */
export const PLACE_STATUSES = [
  "published",
  "pending",
  "rejected",
  "unclassified",
] as const;

export type PlaceStatus = (typeof PLACE_STATUSES)[number];

/** 매칭 종류. 앞에 있을수록 먼저 봅니다 (§4.2 우선순위). */
export const MATCH_KINDS = [
  "cat3",
  "cat2",
  "cat1",
  "content_type",
  "keyword",
] as const;

export type MatchKind = (typeof MATCH_KINDS)[number];

/** `theme_map` 테이블 한 행. */
export interface ThemeRule {
  source: PlaceSource;
  matchKind: MatchKind;
  matchValue: string;
  theme: ThemeKey;
  /** 작을수록 우선 (cat3=10 … keyword=90) */
  priority: number;
}

/** 분류를 판정할 대상. 값이 없는 필드는 비워 둡니다. */
export interface ClassifiableInput {
  source: PlaceSource;
  cat1?: string | null;
  cat2?: string | null;
  cat3?: string | null;
  contentTypeId?: string | null;
  /** keyword 매칭에 쓰는 문자열 (보통 장소명). 부산명소·국가유산이 여기에 기댑니다. */
  name?: string | null;
}

export interface ClassifyResult {
  theme: ThemeKey | null;
  /** 어떤 규칙이 맞았는지. 미분류 원인을 추적할 때 씁니다. */
  matchedBy: MatchKind | null;
  matchedValue: string | null;
}

/** 미분류 결과. `places` 에는 `theme = null` · `status = 'unclassified'` 로 들어갑니다. */
export const UNCLASSIFIED: ClassifyResult = {
  theme: null,
  matchedBy: null,
  matchedValue: null,
};

function valueFor(input: ClassifiableInput, kind: MatchKind): string | null {
  switch (kind) {
    case "cat1":
      return input.cat1 ?? null;
    case "cat2":
      return input.cat2 ?? null;
    case "cat3":
      return input.cat3 ?? null;
    case "content_type":
      return input.contentTypeId ?? null;
    case "keyword":
      return input.name ?? null;
  }
}

/**
 * 규칙을 우선순위대로 적용해 테마를 정합니다.
 *
 *  - `cat3 > cat2 > cat1 > content_type > keyword` 순으로 보고, 같은 종류 안에서는 `priority` 오름차순.
 *  - `keyword` 는 부분 일치, 나머지는 완전 일치입니다.
 *  - 아무 규칙도 맞지 않으면 미분류입니다. 실패는 오류가 아니라 정상 결과의 한 형태입니다.
 */
export function classify(
  input: ClassifiableInput,
  rules: readonly ThemeRule[],
): ClassifyResult {
  const applicable = rules
    .filter((r) => r.source === input.source)
    .slice()
    .sort((a, b) => {
      const ka = MATCH_KINDS.indexOf(a.matchKind);
      const kb = MATCH_KINDS.indexOf(b.matchKind);
      if (ka !== kb) return ka - kb;
      return a.priority - b.priority;
    });

  for (const rule of applicable) {
    const value = valueFor(input, rule.matchKind);
    if (!value) continue;

    const hit =
      rule.matchKind === "keyword"
        ? value.includes(rule.matchValue)
        : value === rule.matchValue;

    if (hit) {
      return {
        theme: rule.theme,
        matchedBy: rule.matchKind,
        matchedValue: rule.matchValue,
      };
    }
  }

  return UNCLASSIFIED;
}

/**
 * 분류 결과를 `places` 의 두 컬럼으로 옮깁니다.
 * `places_unclassified_ck` 제약이 "테마가 빈 것 = 미분류 상태" 를 양방향으로 강제하므로,
 * 두 값은 반드시 함께 정해야 합니다.
 */
export function toPlaceColumns(result: ClassifyResult): {
  theme: ThemeKey | null;
  status: Extract<PlaceStatus, "published" | "unclassified">;
} {
  return result.theme === null
    ? { theme: null, status: "unclassified" }
    : { theme: result.theme, status: "published" };
}
