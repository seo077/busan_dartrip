/**
 * 증분 동기화 — 매일 1회 (D-6 · D-15).
 *
 * 설계 정본: `API데이터설계.md` §6.3(파이프라인 ①~⑦) · §6.4(실행 시간 대비 U-7)
 *            §5.3(`sync_runs`) · §5.5(집계 트리거) · §5.7(보존 정책) · §11(DF-1·DF-2)
 *            `ARCHITECTURE.md` AD-3 · AD-4 · AD-15
 *
 * 이 파일이 존재하는 진짜 이유
 * ----------------------------
 * 데이터 최신화보다 **`D-15`(Supabase 무료 티어 7일 무활동 정지 방어)** 가 먼저입니다.
 * 개발이 끝나고 2026-10 심사까지 공백이 생기면 심사위원이 열었을 때 서비스가 죽어 있습니다.
 * 그래서 **변경분이 0건이어도 `sync_runs` 에는 반드시 행이 남습니다** (DF-1).
 * `sync_runs` INSERT 를 파이프라인 맨 앞에 둔 것도 같은 이유입니다 — 뒤에서 무엇이
 * 실패하더라도 "오늘 DB 에 썼다" 는 사실은 이미 만들어져 있습니다.
 *
 * `modifiedtime` 은 "그 날 하루" 입니다
 * -------------------------------------
 * `areaBasedSyncList2` 의 `modifiedtime` 은 **이후가 아니라 그 날짜** 를 뜻합니다
 * (2026-08-05 실측 — `lib/tourapi.core.ts` 의 같은 주제 주석 참조). 그래서 "마지막 실행
 * 이후 전부" 를 한 번에 받을 수 없고, **날짜를 하루씩 짚어** 부릅니다. 하루치는 보통 몇
 * 건이라 한 호출로 끝나며, 크론이 며칠 쉬었으면 그만큼 날짜가 늘어납니다.
 *
 * 실행 시간 (U-7 · §6.4 1순위)
 * ----------------------------
 * 남은 날짜를 무한정 따라가지 않습니다. 시간 예산을 넘거나 날짜 상한에 닿으면 **그 자리에서
 * 멈추고 마지막으로 끝낸 날짜를 `sync_runs.cursor` 에 남깁니다.** 다음 실행이 그 날짜부터
 * 이어받으므로, 밀린 날짜는 며칠에 걸쳐 저절로 따라잡힙니다.
 *
 * 이 파일은 백필이 아닙니다
 * -------------------------
 * 전량 수집은 `scripts/backfill/` 의 몫입니다(§6.2 · AD-3). 커서가 없는 첫 실행도 최근
 * 며칠만 봅니다 — 크론이 전량을 긁으면 그 순간 §6.4 가 막으려던 실행 시간 문제가 그대로
 * 돌아옵니다.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getServiceClient, supabaseStatus } from "@/lib/supabase";
import { sendAlert } from "@/lib/alert";
import {
  CONSECUTIVE_FAILURE_THRESHOLD,
  STALE_AFTER_HOURS,
  readSyncHealth,
} from "@/lib/health";
import { isInBusanBox } from "@/lib/geo";
import {
  fetchAreaBasedSyncList,
  type TourSyncItem,
} from "@/lib/tourapi.core";
import {
  THEME_KEYS,
  classify,
  toPlaceColumns,
  type MatchKind,
  type PlaceSource,
  type ThemeKey,
  type ThemeRule,
} from "@/lib/theme";

/** 이 동기화가 다루는 출처. `sync_runs.source` 는 `place_source` 열거형입니다 */
const SOURCE: PlaceSource = "tourapi";

/** 한 번의 실행이 쓸 수 있는 시간. Vercel Hobby 함수 상한(60초)보다 넉넉히 짧게 둡니다 */
const DEFAULT_BUDGET_MS = 40_000;

/** 한 실행이 따라갈 최대 날짜 수. 밀린 날짜는 다음 실행이 이어받습니다 */
const DEFAULT_MAX_DATES = 7;

/** 커서가 없는 첫 실행이 되짚어 보는 날짜 수. 백필 대용이 아닙니다 */
const DEFAULT_LOOKBACK_DAYS = 3;

/** 포털 상한이 100 입니다 */
const PAGE_SIZE = 100;

/** 하루치가 이보다 많으면 무언가 잘못된 것입니다. 한도를 태우지 않게 끊습니다 */
const MAX_PAGES_PER_DATE = 20;

/** 페이지 사이 대기(ms) */
const PAGE_DELAY_MS = 150;

/** `place_enrichment` 보존 (§5.7 — 7일 TTL) */
const ENRICHMENT_TTL_DAYS = 7;

/** `sync_runs` 보존 (§5.7 — 90일) */
const SYNC_RUN_RETENTION_DAYS = 90;

/**
 * `rate_limits` 보존 (DF-4 — 2일).
 * 가장 긴 창이 하루라 지난 창은 다시 볼 일이 없습니다. 사용자 데이터가 아니므로 짧게 둡니다.
 */
const RATE_LIMIT_RETENTION_DAYS = 2;

// ── 날짜 (KST) ───────────────────────────────────────────────────────────────
//
// 서버 시간대는 UTC 입니다. 관광공사 `modifiedtime` 은 한국 시각 기준이라, 그대로 쓰면
// 매일 09시 이전에 도는 크론이 **하루 앞 날짜**를 조회합니다. 여기서 KST 로 맞춥니다.

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function toKst(date: Date): Date {
  return new Date(date.getTime() + KST_OFFSET_MS);
}

/** `YYYYMMDD` (KST) */
export function kstDateKey(date: Date = new Date()): string {
  const k = toKst(date);
  const y = k.getUTCFullYear();
  const m = String(k.getUTCMonth() + 1).padStart(2, "0");
  const d = String(k.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

/** 0 = 일요일 … 1 = 월요일 (KST) */
export function kstDayOfWeek(date: Date = new Date()): number {
  return toKst(date).getUTCDay();
}

function parseDateKey(key: string): Date | null {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(key);
  if (!m) return null;
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(date.getTime()) ? null : date;
}

function shiftDateKey(key: string, days: number): string {
  const date = parseDateKey(key);
  if (!date) return key;
  date.setUTCDate(date.getUTCDate() + days);
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

/** `from` 부터 `to` 까지(양끝 포함) 날짜 목록. 최대 `max` 개 */
function dateRange(from: string, to: string, max: number): string[] {
  const out: string[] = [];
  let cur = from;
  for (let i = 0; i < max; i += 1) {
    out.push(cur);
    if (cur >= to) break;
    cur = shiftDateKey(cur, 1);
  }
  return out;
}

// ── 결과 모양 ────────────────────────────────────────────────────────────────

export interface SyncCounts {
  /** 응답에 담겨 온 건수 */
  fetched: number;
  /** `places` 에 넣거나 갱신한 건수 */
  upserted: number;
  /** 응답에 `showflag='0'` 으로 온 건수 (AD-15 · §6.3 ②) */
  hiddenSeen: number;
  /**
   * 그중 실제로 삭제 표시가 걸린 건수.
   * `hiddenSeen` 보다 작은 것이 정상입니다 — 처음부터 `showflag='0'` 이라 `places` 에
   * 넣은 적이 없는 장소는 내릴 것이 없습니다. 두 수를 함께 남겨야 "받았는데 아무 일도
   * 안 일어났다" 와 "받은 게 없다" 가 구분됩니다.
   */
  hidden: number;
  /** 좌표·구·군을 알 수 없어 건너뛴 건수 */
  skipped: number;
  /** 실제 외부 호출 수 — 한도 대조용 */
  calls: number;
}

export interface CleanupCounts {
  throws: number;
  enrichment: number;
  syncRuns: number;
  /** 지난 창의 상한 카운터 (DF-4). 표가 아직 없으면 0 입니다 */
  rateLimits: number;
}

export interface AuditResult {
  /** 대조한 조합 수 (구·군 × 테마) */
  compared: number;
  /** 집계표와 실계수가 어긋난 조합 수 */
  mismatched: number;
  /** 다시 집계한 조합 수 */
  repaired: number;
  /** 어긋난 조합 표본 */
  samples: string[];
}

export interface SyncOutcome {
  runId: number | null;
  status: "ok" | "error";
  startedAt: string;
  finishedAt: string;
  elapsedMs: number;
  /** 이번 실행이 조회한 날짜들 (`YYYYMMDD`) */
  dates: string[];
  /** 아직 못 따라간 날짜가 남았는지 — 다음 실행이 이어받습니다 */
  pending: boolean;
  /** 다음 실행이 시작할 날짜 */
  cursor: string | null;
  counts: SyncCounts;
  cleanup: CleanupCounts;
  /** 주 1회(월요일) 집계표 대조 결과. 안 돈 날은 null (§6.3 ⑥) */
  audit: AuditResult | null;
  /** 사람이 읽는 한 줄. `sync_runs.error_message` 에도 같은 값이 들어갑니다 */
  note: string | null;
}

export class SyncError extends Error {
  readonly reason: "missing_config" | "db_error" | "api_error";

  constructor(reason: SyncError["reason"], message: string) {
    super(message);
    this.name = "SyncError";
    this.reason = reason;
  }
}

// ── 준비물 (DB) ──────────────────────────────────────────────────────────────

/** 관광공사 숫자 코드 → 내부 구·군 코드 (`scripts/lib/places.ts` 와 같은 대응) */
async function loadSigunguIndex(db: SupabaseClient): Promise<Map<string, string>> {
  const { data, error } = await db.from("sigungu").select("code, tour_api_sigungu_code");
  if (error) throw new SyncError("db_error", `sigungu 조회에 실패했습니다: ${error.message}`);

  const index = new Map<string, string>();
  for (const row of data ?? []) {
    const tourCode = (row as { tour_api_sigungu_code: string | null }).tour_api_sigungu_code;
    if (tourCode) index.set(String(tourCode).trim(), (row as { code: string }).code);
  }
  return index;
}

/**
 * 테마 규칙의 정본은 DB 의 `theme_map` 입니다 (AD-2).
 * 규칙이 한 줄도 없으면 들어오는 장소가 전건 미분류가 되므로 그 자리에서 멈춥니다.
 */
async function loadThemeRules(db: SupabaseClient): Promise<ThemeRule[]> {
  const { data, error } = await db
    .from("theme_map")
    .select("source, match_kind, match_value, theme, priority")
    .eq("source", SOURCE);
  if (error) throw new SyncError("db_error", `theme_map 조회에 실패했습니다: ${error.message}`);

  const rules = (data ?? []).map((row) => {
    const r = row as {
      source: string;
      match_kind: string;
      match_value: string;
      theme: string;
      priority: number;
    };
    return {
      source: r.source as PlaceSource,
      matchKind: r.match_kind as MatchKind,
      matchValue: r.match_value,
      theme: r.theme as ThemeKey,
      priority: r.priority,
    };
  });

  if (rules.length === 0) {
    throw new SyncError(
      "db_error",
      `theme_map 에 source='${SOURCE}' 규칙이 없습니다. 마이그레이션이 반영됐는지 확인해 주세요.`,
    );
  }
  return rules;
}

/**
 * 마지막으로 성공한 증분 실행의 커서.
 * 없으면 null — 호출측이 최근 며칠만 보는 기본값으로 시작합니다.
 */
async function readCursor(db: SupabaseClient): Promise<string | null> {
  const { data, error } = await db
    .from("sync_runs")
    .select("cursor")
    .eq("mode", "incremental")
    .eq("status", "ok")
    .not("cursor", "is", null)
    .order("id", { ascending: false })
    .limit(1);

  if (error || !data || data.length === 0) return null;

  const raw = (data[0] as { cursor: string | null }).cursor;
  if (!raw) return null;
  return parseDateKey(raw.trim()) ? raw.trim() : null;
}

// ── ① sync_runs 시작 기록 (DF-1) ─────────────────────────────────────────────

async function startRun(db: SupabaseClient): Promise<number> {
  const { data, error } = await db
    .from("sync_runs")
    .insert({ source: SOURCE, mode: "incremental", status: "running" })
    .select("id")
    .single();

  if (error) {
    // 여기서 실패하면 DF-1(매일 DB 쓰기)이 성립하지 않습니다. 조용히 넘기지 않습니다.
    throw new SyncError("db_error", `sync_runs 기록에 실패했습니다: ${error.message}`);
  }
  return (data as { id: number }).id;
}

async function finishRun(
  db: SupabaseClient,
  id: number | null,
  patch: {
    status: "ok" | "error";
    fetched?: number;
    upserted?: number;
    skipped?: number;
    cursor?: string | null;
    note?: string | null;
  },
): Promise<void> {
  if (id === null) return;
  await db
    .from("sync_runs")
    .update({
      status: patch.status,
      fetched: patch.fetched ?? 0,
      upserted: patch.upserted ?? 0,
      skipped: patch.skipped ?? 0,
      cursor: patch.cursor ?? null,
      error_message: patch.note ?? null,
      finished_at: new Date().toISOString(),
    })
    .eq("id", id);
}

// ── ①-b 실패 알림 (§6.5 · DF-2) ──────────────────────────────────────────────
//
// `sync_runs` 를 남기는 것(DF-1)은 "나중에 볼 수 있게 해 두는 일" 이고, 여기는 **아무도
// 안 보고 있을 때 사람을 부르는 일** 입니다. 심사 기간에 이 둘의 차이가 곧 서비스가 며칠
// 죽어 있느냐 하루 만에 살아나느냐의 차이입니다.
//
// 판정 시점을 `finishRun` **앞**에 둔 이유
// ---------------------------------------
// 이번 실행의 결과는 아직 DB 에 없고 코드가 들고 있습니다. 이전 이력만 DB 에서 읽어
// 여기서 얹으면 조회가 한 번, 쓰기도 한 번으로 끝납니다. 뒤에 두면 `finishRun` 으로 쓴 것을
// 다시 읽고 알림 결과를 적으려고 또 쓰게 됩니다.
//
// `readSyncHealth()` 는 `running` 행을 건너뛰므로, 진행 중인 이번 실행의 행이 이전 이력
// 계산에 섞이지 않습니다.
//
// **여기서 잡히지 않는 경우가 하나 있습니다** — 크론이 아예 안 도는 경우입니다. 이 함수도
// 크론 안에 있어서 함께 안 돕니다. 그쪽은 `GET /api/health` 와 외부 감시가 맡습니다(§6.5 3행).
//
// 실패한 실행에서만 부릅니다 — 성공하면 연속 실패는 0 이 되고 마지막 성공은 방금이 되므로
// §6.5 의 두 조건이 모두 성립하지 않습니다. 성공 경로에서 부르면 답이 정해진 조회만 늘어납니다.

async function notifyOnFailure(db: SupabaseClient, detail: string | null): Promise<string | null> {
  const prior = await readSyncHealth(db);
  // 이력을 못 읽는 상태에서 알림을 지어내지 않습니다. 그 상황 자체는 상태 경로가 503 으로 잡습니다.
  if (!prior.known) return null;

  const consecutive = prior.consecutiveFailures + 1;
  const stale = prior.stale;

  let title: string | null = null;
  const lines: string[] = [];

  if (consecutive >= CONSECUTIVE_FAILURE_THRESHOLD) {
    // §6.5 2행
    title = `증분 동기화가 ${consecutive}회 연속 실패했습니다`;
    if (detail) lines.push(`마지막 오류: ${detail}`);
    lines.push(
      prior.lastSuccessAt
        ? `마지막 성공: ${prior.lastSuccessAt} (${prior.hoursSinceSuccess}시간 전)`
        : "마지막 성공: 기록 없음",
    );
  } else if (stale) {
    // §6.5 3행의 앱 안쪽 몫 — 크론이 며칠 쉬었다가 돌아온 경우가 여기서 잡힙니다.
    title = `마지막 동기화 성공이 ${STALE_AFTER_HOURS}시간을 넘었습니다`;
    lines.push(
      prior.lastSuccessAt
        ? `마지막 성공: ${prior.lastSuccessAt} (${prior.hoursSinceSuccess}시간 전)`
        : "마지막 성공: 기록 없음 — 크론이 한 번도 성공한 적이 없습니다",
    );
    if (detail) lines.push(`이번 실행: ${detail}`);
  }

  if (!title) return null;

  lines.push("상태 경로: /api/health");

  const outcome = await sendAlert(title, lines);
  // 보냈든 못 보냈든 `sync_runs` 에 남깁니다 — "알렸어야 했는데 못 알렸다" 가 사라지면
  // 나중에 왜 아무도 몰랐는지를 되짚을 수 없습니다.
  if (outcome === "sent") return `알림 발송 — ${title}`;
  if (outcome === "skipped") return `알림 조건 충족(${title}) — ALERT_WEBHOOK_URL 미설정으로 미발송`;
  return `알림 조건 충족(${title}) — 발송 실패`;
}

// ── ② 변경분 → places ────────────────────────────────────────────────────────

interface PlaceUpsertRow {
  source: PlaceSource;
  source_id: string;
  name: string;
  theme: ThemeKey | null;
  sigungu_code: string;
  lat: number;
  lng: number;
  address: string | null;
  tel: string | null;
  first_image: string | null;
  first_image_thumb: string | null;
  content_type_id: string | null;
  cat1: string | null;
  cat2: string | null;
  cat3: string | null;
  status: "published" | "unclassified";
  source_modified_at: string | null;
  synced_at: string;
  /**
   * 되살아난 장소를 다시 보이게 합니다.
   * `showflag` 가 `'0'` → `'1'` 로 돌아온 행은 `deleted_at` 을 비워야 다트 풀에 다시 듭니다.
   */
  deleted_at: null;
}

function toUpsertRow(
  item: TourSyncItem,
  sigunguCode: string,
  rules: readonly ThemeRule[],
  now: string,
): PlaceUpsertRow {
  const verdict = classify(
    {
      source: SOURCE,
      cat1: item.cat1,
      cat2: item.cat2,
      cat3: item.cat3,
      contentTypeId: item.contentTypeId,
      name: item.name,
    },
    rules,
  );
  const { theme, status } = toPlaceColumns(verdict);

  return {
    source: SOURCE,
    source_id: item.sourceId,
    name: item.name,
    theme,
    sigungu_code: sigunguCode,
    lat: item.lat as number,
    lng: item.lng as number,
    address: item.address,
    tel: item.tel,
    first_image: item.firstImage,
    first_image_thumb: item.firstImageThumb,
    content_type_id: item.contentTypeId,
    cat1: item.cat1,
    cat2: item.cat2,
    cat3: item.cat3,
    status,
    source_modified_at: item.sourceModifiedAt,
    synced_at: now,
    deleted_at: null,
  };
}

/**
 * `showflag` 가 `'1'` 이 아닌 행 = 제공기관이 내린 것. 삭제 표시만 하고 행은 지우지 않습니다
 * (§6.3 ②단계). `deleted_at` 이 채워지면 `places_pool_idx` 조건에서 빠지고, 행 트리거가
 * 집계표를 함께 줄입니다(§5.5) — 우리가 집계표를 직접 건드릴 일은 없습니다.
 */
async function markHidden(db: SupabaseClient, sourceIds: string[]): Promise<number> {
  if (sourceIds.length === 0) return 0;

  const { data, error } = await db
    .from("places")
    .update({ deleted_at: new Date().toISOString() })
    .eq("source", SOURCE)
    .in("source_id", sourceIds)
    .is("deleted_at", null)
    .select("id");

  if (error) throw new SyncError("db_error", `삭제 표시에 실패했습니다: ${error.message}`);
  return (data ?? []).length;
}

async function upsertPlaces(db: SupabaseClient, rows: PlaceUpsertRow[]): Promise<number> {
  if (rows.length === 0) return 0;

  // 하루치는 보통 수십 건입니다. 그래도 한 번에 보내는 양은 묶어 둡니다.
  let done = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const part = rows.slice(i, i + 100);
    const { error } = await db.from("places").upsert(part, { onConflict: "source,source_id" });
    if (error) throw new SyncError("db_error", `places 적재에 실패했습니다: ${error.message}`);
    done += part.length;
  }
  return done;
}

// ── ④ 만료 정리 (§5.7) ───────────────────────────────────────────────────────

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

async function cleanup(db: SupabaseClient): Promise<CleanupCounts> {
  const counts: CleanupCounts = { throws: 0, enrichment: 0, syncRuns: 0, rateLimits: 0 };

  // 다트 결과 스냅샷 — 30일 (`throws.expires_at` 이 기본값으로 들고 있습니다)
  const expiredThrows = await db
    .from("throws")
    .delete()
    .lt("expires_at", new Date().toISOString())
    .select("id");
  counts.throws = (expiredThrows.data ?? []).length;

  // 외부 응답 캐시 — 7일
  const staleEnrichment = await db
    .from("place_enrichment")
    .delete()
    .lt("fetched_at", daysAgoIso(ENRICHMENT_TTL_DAYS))
    .select("place_id");
  counts.enrichment = (staleEnrichment.data ?? []).length;

  // 실행 로그 — 90일
  const oldRuns = await db
    .from("sync_runs")
    .delete()
    .lt("started_at", daysAgoIso(SYNC_RUN_RETENTION_DAYS))
    .select("id");
  counts.syncRuns = (oldRuns.data ?? []).length;

  // 상한 카운터 — 2일 (DF-4). 마이그레이션 전이면 표가 없어 오류가 오는데, 위 정리들과 같은
  // 방식으로 결과만 받고 넘어갑니다 — 청소가 안 됐다고 동기화를 세울 이유가 없습니다.
  const oldLimits = await db
    .from("rate_limits")
    .delete()
    .lt("window_start", daysAgoIso(RATE_LIMIT_RETENTION_DAYS))
    .select("bucket");
  counts.rateLimits = (oldLimits.data ?? []).length;

  return counts;
}

// ── ⑥ 집계표 ↔ 실계수 대조 (주 1회, §6.3 ⑥ · §7.3) ──────────────────────────
//
// 집계표가 실제보다 **작아지는** 상태는 오류를 내지 않고 결과도 정상으로 보이지만,
// 초과분 장소가 영구히 안 뽑혀 "밀도 무관 균등" 이 조용히 깨집니다. 추출 시점에는
// 감지할 수 없으므로 주기적 대조가 유일한 관측 수단입니다.

async function auditPoolStats(db: SupabaseClient): Promise<AuditResult> {
  // 실계수 — 풀 조건(§7.1)과 같은 조건으로 셉니다. 장소가 1천 건 안팎이라 전건을 읽습니다.
  const actual = new Map<string, number>();
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await db
      .from("places")
      .select("sigungu_code, theme")
      .eq("status", "published")
      .is("deleted_at", null)
      .range(from, from + pageSize - 1);
    if (error) throw new SyncError("db_error", `대조용 조회에 실패했습니다: ${error.message}`);

    const batch = (data ?? []) as { sigungu_code: string; theme: ThemeKey | null }[];
    for (const row of batch) {
      if (!row.theme) continue;
      const key = `${row.sigungu_code}|${row.theme}`;
      actual.set(key, (actual.get(key) ?? 0) + 1);
    }
    if (batch.length < pageSize) break;
  }

  // 집계표
  const { data: statRows, error: statError } = await db
    .from("dart_pool_stats")
    .select("sigungu_code, theme, place_count");
  if (statError) {
    throw new SyncError("db_error", `집계표 조회에 실패했습니다: ${statError.message}`);
  }

  const stats = new Map<string, number>();
  for (const row of (statRows ?? []) as {
    sigungu_code: string;
    theme: ThemeKey;
    place_count: number;
  }[]) {
    stats.set(`${row.sigungu_code}|${row.theme}`, row.place_count);
  }

  const keys = new Set<string>([...actual.keys(), ...stats.keys()]);
  const mismatched: string[] = [];
  for (const key of keys) {
    if ((actual.get(key) ?? 0) !== (stats.get(key) ?? 0)) mismatched.push(key);
  }

  // 어긋난 조합만 다시 집계합니다 (§5.5 `refresh_pool_stat`).
  let repaired = 0;
  for (const key of mismatched) {
    const [sigungu, theme] = key.split("|");
    if (!THEME_KEYS.includes(theme as ThemeKey)) continue;
    const { error } = await db.rpc("refresh_pool_stat", {
      p_sigungu: sigungu,
      p_theme: theme,
    });
    if (!error) repaired += 1;
  }

  return {
    compared: keys.size,
    mismatched: mismatched.length,
    repaired,
    samples: mismatched.slice(0, 5),
  };
}

// ── 진입점 ───────────────────────────────────────────────────────────────────

export interface SyncOptions {
  /** 시간 예산(ms). 넘으면 남은 날짜를 커서에 남기고 멈춥니다 */
  budgetMs?: number;
  /** 한 실행이 따라갈 최대 날짜 수 */
  maxDates?: number;
  /** 커서를 무시하고 이 날짜부터 봅니다 (`YYYYMMDD`) — 수동 확인용 */
  from?: string;
  /** 주 1회 대조를 이번 실행에서 강제로 돌립니다 — 수동 확인용 */
  forceAudit?: boolean;
  /** 외부 호출·쓰기 없이 무엇을 할지만 계산합니다 */
  dryRun?: boolean;
}

/**
 * §6.3 파이프라인을 순서대로 실행합니다.
 *
 * 어느 단계에서 실패해도 `sync_runs` 에는 결과가 남습니다 — 실행 자체가 멈춘 것과
 * 실행 중 오류가 난 것을 나중에 구분할 수 있어야 하기 때문입니다 (§6.5 · DF-2).
 */
export async function runIncrementalSync(options: SyncOptions = {}): Promise<SyncOutcome> {
  const status = supabaseStatus();
  if (!status.hasUrl || !status.hasServiceKey) {
    throw new SyncError(
      "missing_config",
      "Supabase 설정이 없습니다. NEXT_PUBLIC_SUPABASE_URL · SUPABASE_SERVICE_ROLE_KEY 를 확인해 주세요.",
    );
  }

  const budgetMs = options.budgetMs ?? DEFAULT_BUDGET_MS;
  const maxDates = Math.max(1, options.maxDates ?? DEFAULT_MAX_DATES);
  const startedAt = new Date();
  const deadline = startedAt.getTime() + budgetMs;

  const db = getServiceClient();

  // ① sync_runs INSERT — 파이프라인에서 가장 먼저 (DF-1)
  const runId = options.dryRun ? null : await startRun(db);

  const counts: SyncCounts = {
    fetched: 0,
    upserted: 0,
    hiddenSeen: 0,
    hidden: 0,
    skipped: 0,
    calls: 0,
  };
  let cleanupCounts: CleanupCounts = { throws: 0, enrichment: 0, syncRuns: 0, rateLimits: 0 };
  let audit: AuditResult | null = null;
  const done: string[] = [];
  let pending = false;
  let cursor: string | null = null;

  try {
    const today = kstDateKey(startedAt);
    const saved = options.from ?? (await readCursor(db));
    // 커서가 가리키는 날짜부터 **다시** 봅니다 — 같은 날 늦게 들어온 수정분을 놓치지
    // 않기 위해서입니다. upsert 라 중복은 쌓이지 않습니다.
    const from = saved && parseDateKey(saved) ? saved : shiftDateKey(today, -DEFAULT_LOOKBACK_DAYS);
    const dates = dateRange(from > today ? today : from, today, maxDates);

    const [index, rules] = await Promise.all([loadSigunguIndex(db), loadThemeRules(db)]);
    if (index.size === 0) {
      throw new SyncError(
        "db_error",
        "sigungu 표가 비어 있습니다. `npm run backfill:sigungu` 를 먼저 실행해 주세요.",
      );
    }

    const now = new Date().toISOString();

    for (const date of dates) {
      if (Date.now() > deadline) {
        pending = true;
        break;
      }

      const rows: PlaceUpsertRow[] = [];
      const hiddenIds: string[] = [];
      let dateDone = true;

      for (let pageNo = 1; pageNo <= MAX_PAGES_PER_DATE; pageNo += 1) {
        const page = await fetchAreaBasedSyncList({
          modifiedDate: date,
          pageNo,
          numOfRows: PAGE_SIZE,
        });
        counts.calls += 1;
        counts.fetched += page.fetched;

        for (const item of page.items) {
          if (!item.sourceId) {
            counts.skipped += 1;
            continue;
          }
          // AD-15 — 제공기관이 내린 데이터는 적재하지 않고 이미 있던 것은 내립니다.
          if (item.showflag !== null && item.showflag !== "1") {
            counts.hiddenSeen += 1;
            hiddenIds.push(item.sourceId);
            continue;
          }
          if (!isInBusanBox(item.lat, item.lng) || item.sigunguCode === null) {
            counts.skipped += 1;
            continue;
          }
          const sigunguCode = index.get(String(item.sigunguCode).trim());
          if (!sigunguCode) {
            counts.skipped += 1;
            continue;
          }
          rows.push(toUpsertRow(item, sigunguCode, rules, now));
        }

        if (page.fetched === 0) break;
        if (pageNo * PAGE_SIZE >= page.totalCount) break;
        if (pageNo === MAX_PAGES_PER_DATE) {
          dateDone = false;
          break;
        }
        if (Date.now() > deadline) {
          dateDone = false;
          break;
        }
        if (PAGE_DELAY_MS > 0) await new Promise((r) => setTimeout(r, PAGE_DELAY_MS));
      }

      if (!options.dryRun) {
        // ②·③ — upsert 와 삭제 표시. 집계표는 행 트리거가 함께 갱신합니다 (§5.5)
        counts.upserted += await upsertPlaces(db, rows);
        counts.hidden += await markHidden(db, hiddenIds);
      }

      if (dateDone) done.push(date);
      else {
        pending = true;
        break;
      }
    }

    // 다음 실행이 시작할 자리. 끝낸 날짜가 없으면 이번에 보려던 첫 날짜를 그대로 둡니다.
    cursor = done.length > 0 ? done[done.length - 1] : (dates[0] ?? today);
    if (pending && done.length > 0) cursor = done[done.length - 1];
    if (!pending && dates.length > 0 && dates[dates.length - 1] < today) pending = true;

    if (!options.dryRun) {
      // ④ 만료 정리 (§5.7)
      cleanupCounts = await cleanup(db);

      // ⑥ 주 1회(월요일) 집계표 대조 — 전수 집계라 매일 돌리지 않습니다
      const isMonday = kstDayOfWeek(startedAt) === 1;
      if ((options.forceAudit || isMonday) && Date.now() < deadline) {
        audit = await auditPoolStats(db);
      }
    }

    const notes: string[] = [];
    if (pending) notes.push(`밀린 날짜 남음 — 다음 실행이 ${cursor} 부터 이어받습니다`);
    if (audit && audit.mismatched > 0) {
      notes.push(`집계표 불일치 ${audit.mismatched}조합 (재집계 ${audit.repaired})`);
    }
    const note = notes.length > 0 ? notes.join(" / ") : null;

    const finishedAt = new Date();
    if (!options.dryRun) {
      await finishRun(db, runId, {
        status: "ok",
        fetched: counts.fetched,
        upserted: counts.upserted + counts.hidden,
        skipped: counts.skipped,
        cursor,
        note,
      });
    }

    return {
      runId,
      status: "ok",
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      elapsedMs: finishedAt.getTime() - startedAt.getTime(),
      dates: done,
      pending,
      cursor,
      counts,
      cleanup: cleanupCounts,
      audit,
      note,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);

    // ①-b DF-2 — 이번 실패를 이전 이력에 얹어 §6.5 의 알림 조건을 봅니다. `finishRun` 앞이라
    // 진행 중인 이 실행의 행은 아직 `running` 이고, 판정에서 건너뛰어집니다.
    let alerted: string | null = null;
    if (!options.dryRun) {
      alerted = await notifyOnFailure(db, message.slice(0, 300));
    }
    const errorNote = alerted ? `${message.slice(0, 300)} / ${alerted}` : message.slice(0, 500);

    // 실패해도 ① 단계의 INSERT 는 이미 일어났습니다 — DF-1 은 지켜집니다.
    await finishRun(db, runId, {
      status: "error",
      fetched: counts.fetched,
      upserted: counts.upserted + counts.hidden,
      skipped: counts.skipped,
      cursor: null,
      note: errorNote,
    });

    const finishedAt = new Date();
    return {
      runId,
      status: "error",
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      elapsedMs: finishedAt.getTime() - startedAt.getTime(),
      dates: done,
      pending: true,
      cursor: null,
      counts,
      cleanup: cleanupCounts,
      audit,
      note: errorNote,
    };
  }
}
