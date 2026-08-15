/**
 * 방문 기록 — 스탬프판(S8)과 여행 아카이빙(S9)의 재료.
 *
 * 설계 정본: `ARCHITECTURE.md` `AD-21`(표를 새로 만들지 않는다) · `AD-20`(작성자 식별값)
 *            `API데이터설계.md` §5.3.1(`reviews` 가 방문을 겸하는 방식) · §5.8
 *            `화면구성도.md` §15(스탬프판) · §16(아카이빙)
 *            `D-46-6`(다녀왔어요 · 후기 작성 시 자동 인정) · `D-46-9`(아카이빙 = 방문 전부)
 *
 * 표가 하나입니다
 * --------------
 * **방문 기록 표를 만들지 않았습니다.** `reviews` 한 행이 곧 방문 1건이고, `body`·`photo_path`
 * 가 **둘 다 비면 "다녀왔어요만"**, 하나라도 있으면 후기입니다(`AD-21`). 표를 새로 만들면 같은
 * 사실이 두 곳에 생겨 후기와 방문이 어긋나는 경로가 열립니다.
 *
 * **"한 사람이 한 장소에 최대 1행" 이 곧 사양입니다** — 기존 부분 유니크 인덱스
 * (`reviews_place_author_uidx`)가 이미 그 제약이며, 방문은 있거나 없거나이지 여러 번 세는
 * 값이 아닙니다. 그래서 후기 중복 방어와 방문 중복 방어가 **같은 장치**로 성립합니다.
 *
 * 익명 행은 세지 않습니다
 * ----------------------
 * `anon:*` 는 브라우저 로컬값이라 **본인 것이라는 증명이 없고**, 같은 기기를 쓴 다른 사람의
 * 기록이 섞입니다(`AD-20` 미승계). 후기 목록에는 종전대로 보이지만 스탬프·아카이빙 어디에도
 * 들어오지 않습니다 — 이 파일은 **`user:` 로 시작하는 식별값만** 받습니다.
 *
 * 서버 전용입니다.
 */

import "server-only";

import { getServiceClient, supabaseStatus } from "@/lib/supabase";
import { THEME_LABELS, isThemeKey, type ThemeKey } from "@/lib/theme";

export class VisitError extends Error {
  readonly reason: "missing_config" | "db_error";
  readonly detail?: string;

  constructor(reason: VisitError["reason"], message: string, detail?: string) {
    super(message);
    this.name = "VisitError";
    this.reason = reason;
    this.detail = detail;
  }
}

function requireConfig(): void {
  const status = supabaseStatus();
  if (!status.hasUrl || !status.hasServiceKey) {
    throw new VisitError("missing_config", "데이터베이스 설정이 아직 없습니다.");
  }
}

/** 로그인 사용자의 식별값인가. 익명 행을 걸러 내는 유일한 관문입니다 (`AD-20`) */
export function isUserRef(authorRef: string): boolean {
  return /^user:[A-Za-z0-9._:-]{1,128}$/.test(authorRef);
}

// ── 스탬프판의 16칸 (§15.1 · §15.3-2) ────────────────────────────────────────

/**
 * 격자 순서 — **부산시 행정 순 고정**입니다.
 *
 * §15.3-2 가 *"위치가 매번 같아야 자기 판을 기억할 수 있다"* 고 정해 둔 자리라, 이름순·방문순
 * 같은 **가변 정렬을 쓰지 않습니다.** 값은 `scripts/lib/busan.ts` 의 slug 와 같지만, 그쪽은
 * Next 런타임이 import 하지 않는 폴더라 여기 따로 둡니다(`lib/geo.ts` 가 경계 상자를 들고
 * 있는 것과 같은 이유).
 */
export const SIGUNGU_GRID: readonly string[] = [
  "jung", "seo", "dong", "yeongdo",
  "busanjin", "dongnae", "nam", "buk",
  "haeundae", "saha", "geumjeong", "gangseo",
  "yeonje", "suyeong", "sasang", "gijang",
];

/** 부산 구·군 수 (§15.1 `● N / 16`) */
export const STAMP_TOTAL = SIGUNGU_GRID.length;

export interface StampCell {
  code: string;
  name: string;
  /** 이 구·군에 방문이 1건이라도 있는가. **횟수는 세지 않습니다** (§15.1) */
  filled: boolean;
  /**
   * 채운 칸에 입힐 테마 (`D-61-1` — "채워진 칸은 그 방문의 테마 색").
   *
   * 한 구·군에 방문이 여럿이면 **가장 최근 방문**의 테마를 씁니다. 횟수를 세지 않는다는 §15.1
   * 과 어긋나지 않습니다 — 색은 세는 값이 아니라 **마지막으로 무엇을 하러 갔는지**의 표시입니다.
   * 빈 칸이거나 그 장소가 미분류면 null 이고, 화면은 그때 포인트 색으로 떨어집니다.
   */
  theme: ThemeKey | null;
}

export interface StampBoard {
  cells: StampCell[];
  filledCount: number;
  /** 아직 비어 있고 **다트 풀이 0건이 아닌** 구·군 (§15.2) */
  emptyWithPool: string[];
}

/**
 * 스탬프판 한 장.
 *
 * 빈 칸 후보에서 **다트 풀이 0건인 조합을 뺍니다** — §15.2 가 ④ §7.2("빈 조합은 후보에서
 * 뺀다")와 같은 규칙을 쓰라고 정해 둔 자리입니다. 안 그러면 "빈 곳으로 던지기" 가 아무것도
 * 못 뽑는 구·군으로 데려갑니다.
 */
export async function loadStampBoard(authorRef: string): Promise<StampBoard> {
  requireConfig();
  const db = getServiceClient();

  const [sigunguRes, visitRes, poolRes] = await Promise.all([
    db.from("sigungu").select("code,name"),
    db
      .from("reviews")
      .select("place_id,created_at,places!inner(sigungu_code,theme)")
      .eq("author_ref", authorRef)
      // 최신순으로 받아 **구·군마다 첫 행**이 곧 가장 최근 방문이 됩니다 (칸 색의 근거).
      .order("created_at", { ascending: false }),
    db.from("dart_pool_stats").select("sigungu_code,place_count").gt("place_count", 0),
  ]);

  if (sigunguRes.error) {
    throw new VisitError("db_error", "구·군 목록을 불러오지 못했습니다.", sigunguRes.error.message);
  }
  if (visitRes.error) {
    throw new VisitError("db_error", "스탬프를 불러오지 못했어요.", visitRes.error.message);
  }

  const nameByCode = new Map<string, string>();
  for (const row of sigunguRes.data ?? []) {
    nameByCode.set(row.code as string, row.name as string);
  }

  const visited = new Set<string>();
  /** 구·군 → 가장 최근 방문의 테마 (`D-61-1` 칸 색) */
  const themeByCode = new Map<string, ThemeKey | null>();
  type VisitRow = {
    places:
      | { sigungu_code: string; theme: string | null }
      | { sigungu_code: string; theme: string | null }[]
      | null;
  };
  for (const row of (visitRes.data ?? []) as unknown as VisitRow[]) {
    const place = Array.isArray(row.places) ? row.places[0] : row.places;
    const code = place?.sigungu_code;
    if (!code) continue;
    // 최신순이므로 **처음 만난 행만** 채택합니다.
    if (!visited.has(code)) {
      themeByCode.set(code, isThemeKey(place?.theme) ? place.theme : null);
    }
    visited.add(code);
  }

  // 풀 조회가 실패하면 후보를 좁히지 않습니다 — 그 실패로 스탬프판까지 멈출 이유가 없고,
  // 최악이라도 빈 조합으로 보내는 것뿐이며 그쪽은 S1 이 "다른 조합" 안내로 받습니다(④ §7.2).
  const withPool = new Set<string>(
    (poolRes.data ?? []).map((row) => row.sigungu_code as string),
  );

  const cells: StampCell[] = SIGUNGU_GRID.map((code) => ({
    code,
    name: nameByCode.get(code) ?? code,
    filled: visited.has(code),
    theme: themeByCode.get(code) ?? null,
  }));

  return {
    cells,
    filledCount: cells.filter((c) => c.filled).length,
    emptyWithPool: SIGUNGU_GRID.filter(
      (code) => !visited.has(code) && (poolRes.error ? true : withPool.has(code)),
    ),
  };
}

/**
 * 빈 구·군 하나를 **같은 확률로** 고릅니다 (§15.2).
 *
 * *"가장 가까운 곳"* 이나 *"인기 있는 곳"* 을 고르는 순간 그것이 추천이 되어 `SC-3`(밀도 무관
 * 균등)과 서비스 원칙이 함께 깨집니다.
 */
export function pickEmptySigungu(board: StampBoard): string | null {
  const pool = board.emptyWithPool;
  if (pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

// ── 아카이빙 (§16) ───────────────────────────────────────────────────────────

export interface VisitEntry {
  reviewId: string;
  placeId: string;
  placeName: string;
  sigunguCode: string;
  sigunguName: string;
  theme: ThemeKey | null;
  themeLabel: string | null;
  visitedAt: string;
  /** 후기를 함께 남겼으면 그 한 줄. "다녀왔어요만" 이면 null */
  body: string | null;
  photoPath: string | null;
}

export interface Archive {
  entries: VisitEntry[];
  /** 방문한 구·군만 (§16.3-2 — 안 간 곳까지 칩으로 내지 않습니다) */
  sigungu: { code: string; name: string }[];
  total: number;
}

interface ArchiveRow {
  id: string;
  place_id: string;
  body: string | null;
  photo_path: string | null;
  created_at: string;
  places:
    | { name: string; theme: string | null; sigungu_code: string; sigungu: { name: string } | { name: string }[] | null }
    | { name: string; theme: string | null; sigungu_code: string; sigungu: { name: string } | { name: string }[] | null }[]
    | null;
}

/**
 * 내 방문 전부 (§16.2).
 *
 * **다트로 만난 곳인지 아닌지를 구분하지 않습니다**(`D-46-9`) — 다트 경유 표시는 `throws` 에만
 * 남고 30일 만료라, 구분하면 *"예전에 던져서 갔는데 안 잡히는"* 경로가 반드시 생깁니다.
 * 후기를 쓴 방문과 "다녀왔어요" 만 누른 방문도 **둘 다** 담습니다(`D-46-6`).
 *
 * **정렬은 최신순 고정입니다** — 정렬 선택지를 두면 그 순간 순위 감각이 들어오고, 이 서비스는
 * 장소에 순서를 매기지 않는 것이 원칙입니다(`SC-3`·`D-10`).
 */
export async function loadArchive(
  authorRef: string,
  options: { sigungu?: string | null; limit?: number } = {},
): Promise<Archive> {
  requireConfig();
  const db = getServiceClient();

  const { data, error } = await db
    .from("reviews")
    .select("id,place_id,body,photo_path,created_at,places!inner(name,theme,sigungu_code,sigungu(name))")
    .eq("author_ref", authorRef)
    .order("created_at", { ascending: false })
    .limit(options.limit ?? 300);

  if (error) {
    throw new VisitError("db_error", "기록을 불러오지 못했어요.", error.message);
  }

  const all: VisitEntry[] = [];
  for (const raw of (data ?? []) as unknown as ArchiveRow[]) {
    const place = Array.isArray(raw.places) ? raw.places[0] : raw.places;
    if (!place) continue;

    const sigungu = Array.isArray(place.sigungu) ? place.sigungu[0] : place.sigungu;
    const theme = isThemeKey(place.theme) ? place.theme : null;

    all.push({
      reviewId: raw.id,
      placeId: raw.place_id,
      placeName: place.name,
      sigunguCode: place.sigungu_code,
      sigunguName: sigungu?.name ?? place.sigungu_code,
      theme,
      themeLabel: theme ? THEME_LABELS[theme] : null,
      visitedAt: raw.created_at,
      body: raw.body,
      photoPath: raw.photo_path,
    });
  }

  // 칩은 **거른 뒤가 아니라 전체 기준**으로 만듭니다. 필터를 건 상태에서도 다른 구·군으로
  // 옮겨 갈 수 있어야 하고, 그래서 §16.4 의 "필터 결과 0건" 이 원리적으로 안 나옵니다.
  const chips = new Map<string, string>();
  for (const entry of all) chips.set(entry.sigunguCode, entry.sigunguName);

  const filtered = options.sigungu ? all.filter((e) => e.sigunguCode === options.sigungu) : all;

  return {
    entries: filtered,
    sigungu: [...chips.entries()].map(([code, name]) => ({ code, name })),
    total: all.length,
  };
}

// ── 방문 1건 남기기 (§14.6 · `D-46-6`) ───────────────────────────────────────

export type RecordVisitOutcome =
  | { kind: "created" }
  /** 이미 방문(또는 후기)이 있는 경우. **오류가 아닙니다** — ④ §8 "이미 있으면 그대로 두고 성공" */
  | { kind: "already" }
  | { kind: "not_found" };

const UNIQUE_VIOLATION = "23505";
const UNIQUE_INDEX = "reviews_place_author_uidx";

/**
 * "다녀왔어요" 한 번 = `body`·`photo_path` 가 둘 다 빈 행 하나 (`AD-21`).
 *
 * **이미 행이 있으면 손대지 않습니다.** 후기를 먼저 쓴 사람의 행을 여기서 비우면 그 사람의
 * 후기가 사라집니다. 방문 시각(`created_at`)도 처음 남긴 때로 유지됩니다(④ §5.3.1).
 *
 * 조회를 통과하고도 인덱스에 걸릴 수 있습니다 — 같은 사람의 요청 두 건이 동시에 오는
 * 경우입니다(`lib/review.ts` 와 같은 구조). 그 삽입 실패도 **같은 `already`** 로 받습니다.
 */
export async function recordVisit(
  placeId: string,
  authorRef: string,
): Promise<RecordVisitOutcome> {
  requireConfig();
  const db = getServiceClient();

  const { data: place, error: placeError } = await db
    .from("places")
    .select("id")
    .eq("id", placeId)
    .eq("status", "published")
    .is("deleted_at", null)
    .maybeSingle();

  if (placeError) {
    throw new VisitError("db_error", "장소를 확인하지 못했습니다.", placeError.message);
  }
  if (!place) return { kind: "not_found" };

  const { data: existing, error: existingError } = await db
    .from("reviews")
    .select("id")
    .eq("place_id", placeId)
    .eq("author_ref", authorRef)
    .limit(1)
    .maybeSingle();

  if (existingError) {
    throw new VisitError("db_error", "이전 기록을 확인하지 못했습니다.", existingError.message);
  }
  if (existing) return { kind: "already" };

  const { error } = await db
    .from("reviews")
    .insert({ place_id: placeId, author_ref: authorRef, body: null, photo_path: null });

  if (error) {
    const both = `${error.message ?? ""} ${error.details ?? ""}`;
    if (error.code === UNIQUE_VIOLATION && both.includes(UNIQUE_INDEX)) {
      return { kind: "already" };
    }
    throw new VisitError("db_error", "기록하지 못했어요.", error.message);
  }

  return { kind: "created" };
}

/** 이 사람이 이 장소에 이미 방문(또는 후기)을 남겼는가 — 화면이 버튼 모양을 고를 때 씁니다 */
export async function hasVisit(placeId: string, authorRef: string): Promise<boolean> {
  requireConfig();

  const { data, error } = await getServiceClient()
    .from("reviews")
    .select("id")
    .eq("place_id", placeId)
    .eq("author_ref", authorRef)
    .limit(1)
    .maybeSingle();

  if (error) throw new VisitError("db_error", "이전 기록을 확인하지 못했습니다.", error.message);
  return data !== null;
}
