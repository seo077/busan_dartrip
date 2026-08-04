/**
 * 백필 공통 — `sigungu` 색인과 `places` 적재.
 *
 * 설계 정본: `API데이터설계.md` §5.3 · §6.2 / `ARCHITECTURE.md` AD-1 · AD-13
 *
 * 소스가 여러 개인데 **구·군을 가리키는 방식이 제각각**입니다.
 *   - 관광공사   `sigungucode` = 숫자 코드 ('14')
 *   - 부산시     `GUGUN_NM`    = 한글 이름 ('영도구')            ← BUSAN-3
 *   - 도보여행   구·군 필드 자체가 없음
 *
 * 이 셋을 같은 구로 모으지 못하면 한 구가 두 행으로 갈라져 다트 §7.1 ①단계의
 * 후보 수가 어긋납니다. 그래서 `sigungu` 표를 한 번 읽어 **숫자 코드 → 내부 코드**,
 * **한글 이름 → 내부 코드** 두 색인을 만들어 두고 모든 백필이 이것만 씁니다.
 *
 * 찾지 못한 값은 **지어내지 않고 건너뛰며, 무엇을 건너뛰었는지 집계해 돌려줍니다.**
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlaceStatus, ThemeKey } from "../../lib/theme";
import { SIGUNGU_SLUG_BY_NAME } from "./busan";
import { selectAll, upsertInChunks } from "./db";

/* ── 구·군 색인 ──────────────────────────────────────────────────────────── */

export interface SigunguIndex {
  /** 관광공사 숫자 코드 → 내부 코드 */
  byTourCode: Map<string, string>;
  /** 한글 이름 → 내부 코드 */
  byName: Map<string, string>;
  /** 내부 코드 → 한글 이름 */
  nameOf: Map<string, string>;
  size: number;
}

export async function loadSigunguIndex(client: SupabaseClient): Promise<SigunguIndex> {
  const rows = await selectAll<{
    code: string;
    name: string;
    tour_api_sigungu_code: string | null;
  }>(client, "sigungu", "code, name, tour_api_sigungu_code");

  const byTourCode = new Map<string, string>();
  const byName = new Map<string, string>();
  const nameOf = new Map<string, string>();

  for (const r of rows) {
    nameOf.set(r.code, r.name);
    byName.set(r.name.trim(), r.code);
    if (r.tour_api_sigungu_code) byTourCode.set(String(r.tour_api_sigungu_code).trim(), r.code);
  }

  // 저장소에 고정해 둔 이름↔slug 표도 보조로 넣습니다.
  // DB 의 이름 표기가 조금 다를 때(공백 등) 여기서 걸립니다.
  for (const [name, slug] of Object.entries(SIGUNGU_SLUG_BY_NAME)) {
    if (!byName.has(name) && nameOf.has(slug)) byName.set(name, slug);
  }

  return { byTourCode, byName, nameOf, size: rows.length };
}

/** 한글 구·군 이름을 내부 코드로. 찾지 못하면 null — 값을 지어내지 않습니다. */
export function codeByName(index: SigunguIndex, raw: string | null | undefined): string | null {
  if (!raw) return null;
  const name = String(raw).trim();
  if (name === "") return null;
  return index.byName.get(name) ?? null;
}

/** 관광공사 숫자 코드를 내부 코드로. */
export function codeByTourCode(
  index: SigunguIndex,
  raw: string | null | undefined,
): string | null {
  if (!raw) return null;
  const code = String(raw).trim();
  if (code === "") return null;
  return index.byTourCode.get(code) ?? null;
}

/* ── places 행 ───────────────────────────────────────────────────────────── */

/** `places` 한 행. 컬럼명은 §5.3 DDL 과 같습니다. */
export interface PlaceRow {
  source: string;
  source_id: string;
  name: string;
  theme: ThemeKey | null;
  sigungu_code: string;
  lat: number;
  lng: number;
  address: string | null;
  tel: string | null;
  homepage: string | null;
  overview: string | null;
  first_image: string | null;
  first_image_thumb: string | null;
  content_type_id: string | null;
  cat1: string | null;
  cat2: string | null;
  cat3: string | null;
  status: Extract<PlaceStatus, "published" | "unclassified">;
  source_modified_at: string | null;
  synced_at: string;
  [key: string]: unknown;
}

/**
 * `places` 적재. `unique (source, source_id)` 로 충돌을 잡아 재실행해도 중복이 안 쌓입니다.
 *
 * 트리거(`trg_places_stat`)를 끄지 않습니다. 한 번에 넣는 양이 수백~천 행이라
 * 행 트리거 비용이 문제가 되지 않고, 트리거를 끄면 §5.5 가 경고한 **집계표 과소 계상**
 * 구간이 생기기 때문입니다. 끄지 않으면 `dart_pool_stats` 가 적재와 함께 맞춰집니다.
 */
export async function upsertPlaces(
  client: SupabaseClient,
  rows: PlaceRow[],
  onProgress?: (done: number, total: number) => void,
): Promise<number> {
  if (rows.length === 0) return 0;
  return upsertInChunks(client, "places", rows, "source,source_id", {
    size: 200,
    onProgress,
  });
}

/* ── 건너뛴 이유 집계 ────────────────────────────────────────────────────── */

export const SKIP_REASONS = [
  "좌표 없음",
  "구·군 값 없음",
  "구·군 대응 실패",
  "부산 범위 밖 좌표",
  "이름 없음",
  "식별자 없음",
] as const;

export type SkipReason = (typeof SKIP_REASONS)[number];

export class SkipLog {
  private counts = new Map<SkipReason, number>();
  private samples = new Map<SkipReason, string[]>();

  add(reason: SkipReason, sample: string): void {
    this.counts.set(reason, (this.counts.get(reason) ?? 0) + 1);
    const list = this.samples.get(reason) ?? [];
    if (list.length < 5) list.push(sample);
    this.samples.set(reason, list);
  }

  get total(): number {
    let n = 0;
    for (const v of this.counts.values()) n += v;
    return n;
  }

  /** [이유, 건수, 표본] 행으로 — 콘솔 표에 그대로 넣습니다. */
  rows(): string[][] {
    return SKIP_REASONS.filter((r) => (this.counts.get(r) ?? 0) > 0).map((r) => [
      r,
      String(this.counts.get(r) ?? 0),
      (this.samples.get(r) ?? []).join(" · "),
    ]);
  }
}
