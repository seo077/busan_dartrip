/**
 * 다트 코어 — 후보 집계 조회 · 다트 실행 · 결과 재현.
 *
 * 설계 정본: `API데이터설계.md` §7.1(알고리즘) · §7.2(빈 조합) · §7.3(추출 함수)
 *            §7.4("이 근처") · §8(내부 API Route) / `ARCHITECTURE.md` AD-1 · AD-5 · AD-10
 *
 * **이 파일의 어떤 경로도 외부 API 를 부르지 않습니다** (D-6 · OG-1 · SC-1).
 * 다트가 보는 것은 `dart_pool_stats` · `places` · `sigungu` · `throws` 네 표뿐입니다.
 *
 * 서버 전용입니다. `server-only` 가 붙어 있어 클라이언트 컴포넌트가 import 하면
 * 빌드가 그 자리에서 멈춥니다(service_role 키 유출 차단).
 */

import "server-only";
import { randomBytes, randomInt } from "node:crypto";

import { getServiceClient, supabaseStatus } from "@/lib/supabase";
import { THEME_KEYS, type ThemeKey } from "@/lib/theme";
import { boundingBox, distanceMeters } from "@/lib/geo";

// ── 상수 ─────────────────────────────────────────────────────────────────────

/** "이 근처" 반경 (§7.5). 실측 건수를 보고 조정할 수 있도록 환경변수로 둡니다. */
export const NEARBY_RADIUS_M = Number(process.env.DART_NEARBY_RADIUS_M) || 3000;

/** "이 근처" 최대 건수 (§7.4) */
export const NEARBY_LIMIT = 20;

/** 사각 범위 1차 조회 상한. 이 값을 넘길 만큼 조밀한 구역은 부산에 없습니다. */
const NEARBY_SCAN_LIMIT = 500;

// ── 타입 ─────────────────────────────────────────────────────────────────────

/** 다트 범위. null = 부산 전체 (§7.1) */
export type DartScope = string | null;
/** 다트 테마. null = 전체 (§7.1) */
export type DartTheme = ThemeKey | null;

export type ThemeCounts = Record<ThemeKey | "all", number>;

export interface SigunguPool {
  code: string;
  name: string;
  centerLat: number;
  centerLng: number;
  isLowVisit: boolean;
  counts: ThemeCounts;
}

export interface PoolStats {
  sigungu: SigunguPool[];
  /** 부산 전체 기준 테마별 합계 */
  totals: ThemeCounts;
  /** 집계표에서 가장 늦게 갱신된 시각 */
  updatedAt: string | null;
}

export interface PlaceCard {
  id: string;
  name: string;
  theme: ThemeKey | null;
  sigunguCode: string;
  sigunguName: string;
  lat: number;
  lng: number;
  address: string | null;
  image: string | null;
  isHiddenGem: boolean;
  isGoodRestaurant: boolean;
}

export interface NearbyItem {
  id: string;
  name: string;
  theme: ThemeKey | null;
  image: string | null;
  distanceM: number;
  isHiddenGem: boolean;
  isGoodRestaurant: boolean;
}

export type ThrowOutcome =
  | { empty: true; reason: "no_place_in_combination" }
  | {
      empty: false;
      throwId: string;
      scope: DartScope;
      theme: DartTheme;
      sigungu: { code: string; name: string };
      place: PlaceCard;
      nearby: NearbyItem[];
    };

export type ThrowLookup =
  | { kind: "ok"; result: Extract<ThrowOutcome, { empty: false }> }
  | { kind: "gone" };

/** 설정이 덜 된 상태와 실제 장애를 화면이 구분할 수 있게 이유를 붙입니다. */
export class DartError extends Error {
  readonly reason: "missing_config" | "db_error";
  readonly detail?: string;

  constructor(reason: "missing_config" | "db_error", message: string, detail?: string) {
    super(message);
    this.name = "DartError";
    this.reason = reason;
    this.detail = detail;
  }
}

// ── 내부 도우미 ──────────────────────────────────────────────────────────────

const PLACE_COLUMNS =
  "id,name,theme,sigungu_code,lat,lng,address,first_image,first_image_thumb,is_hidden_gem,is_good_restaurant";

interface PlaceRow {
  id: string;
  name: string;
  theme: ThemeKey | null;
  sigungu_code: string;
  lat: number;
  lng: number;
  address: string | null;
  first_image: string | null;
  first_image_thumb: string | null;
  is_hidden_gem: boolean;
  is_good_restaurant: boolean;
}

function requireConfig(): void {
  const status = supabaseStatus();
  if (!status.hasUrl || !status.hasServiceKey) {
    throw new DartError(
      "missing_config",
      "데이터베이스 설정이 아직 없습니다.",
      "`.env.local` 의 NEXT_PUBLIC_SUPABASE_URL · SUPABASE_SERVICE_ROLE_KEY 를 채워 주세요.",
    );
  }
}

function emptyCounts(): ThemeCounts {
  return { food: 0, nature: 0, culture: 0, activity: 0, all: 0 };
}

/** 공유 링크에 쓰는 짧은 ID. 대소문자·숫자 62자에서 10자리. */
function shortId(length = 10): string {
  const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i += 1) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

// ── 1. 집계 조회 — S1 이 0건 조합을 미리 막는 근거 (§7.2) ────────────────────

export async function loadPoolStats(): Promise<PoolStats> {
  requireConfig();
  const db = getServiceClient();

  const [sigunguRes, statsRes] = await Promise.all([
    db.from("sigungu").select("code,name,center_lat,center_lng,is_low_visit").order("name"),
    db.from("dart_pool_stats").select("sigungu_code,theme,place_count,updated_at"),
  ]);

  if (sigunguRes.error) throw new DartError("db_error", "구·군 목록을 불러오지 못했습니다.", sigunguRes.error.message);
  if (statsRes.error) throw new DartError("db_error", "다트 후보 건수를 불러오지 못했습니다.", statsRes.error.message);

  const totals = emptyCounts();
  let updatedAt: string | null = null;

  const byCode = new Map<string, SigunguPool>();
  for (const row of sigunguRes.data ?? []) {
    byCode.set(row.code as string, {
      code: row.code as string,
      name: row.name as string,
      centerLat: row.center_lat as number,
      centerLng: row.center_lng as number,
      isLowVisit: Boolean(row.is_low_visit),
      counts: emptyCounts(),
    });
  }

  for (const row of statsRes.data ?? []) {
    const entry = byCode.get(row.sigungu_code as string);
    const theme = row.theme as ThemeKey;
    const count = Number(row.place_count) || 0;
    if (entry && (THEME_KEYS as readonly string[]).includes(theme)) {
      entry.counts[theme] = count;
      entry.counts.all += count;
    }
    totals[theme] = (totals[theme] ?? 0) + count;
    totals.all += count;

    const at = row.updated_at as string | null;
    if (at && (updatedAt === null || at > updatedAt)) updatedAt = at;
  }

  return { sigungu: [...byCode.values()], totals, updatedAt };
}

// ── 2. 다트 실행 (§7.1) ──────────────────────────────────────────────────────

/**
 * ①~⑤단계를 수행합니다.
 *
 *   ① · ② 후보 구·군 중 **밀도 무관 균등** 1개 (D-3 1단계)
 *   ③     그 구·군 + 테마의 장소 중 균등 1건 (D-3 2단계)
 *   ④     반경 3km 거리순 최대 20건 (D-10)
 *   ⑤     `throws` 스냅샷 저장 → 공유 가능한 ID
 *
 * ①~③은 DB 함수 `throw_dart()` 가 정본입니다. 이 함수는 그 결과를 받아 쓰되,
 * §7.3 이 예고한 **집계표 과대 계상 시 0행** 경우에만 같은 알고리즘으로 한 번 더 시도합니다.
 */
export async function throwDart(input: {
  scope: DartScope;
  theme: DartTheme;
}): Promise<ThrowOutcome> {
  requireConfig();
  const db = getServiceClient();
  const { scope, theme } = input;

  // 빈 조합인지 먼저 확정합니다. `throw_dart()` 는 빈 조합과 offset 초과를 모두
  // "0행" 으로 돌려주므로, 둘을 구분하려면 후보 목록이 필요합니다 (§7.3).
  const candidates = await candidateSigungu(scope, theme);
  if (candidates.length === 0) {
    return { empty: true, reason: "no_place_in_combination" };
  }

  let sigunguCode: string | null = null;
  let placeId: string | null = null;

  const rpc = await db.rpc("throw_dart", { p_scope: scope, p_theme: theme });
  if (rpc.error) {
    throw new DartError("db_error", "다트를 던지지 못했습니다.", rpc.error.message);
  }

  const row = Array.isArray(rpc.data) ? rpc.data[0] : null;
  if (row && row.place_id) {
    sigunguCode = row.sigungu_code as string;
    placeId = row.place_id as string;
  } else {
    // §7.3 폴백 — 집계표가 실제보다 크면 offset 이 범위를 넘어 0행이 됩니다.
    // 결과가 비는 것보다 한 번 더 조회하는 편이 낫습니다.
    const retry = await drawWithoutStats(candidates, theme);
    if (!retry) return { empty: true, reason: "no_place_in_combination" };
    sigunguCode = retry.sigunguCode;
    placeId = retry.placeId;
  }

  const place = await loadPlaceCard(placeId);
  if (!place) {
    // 뽑힌 직후 그 행이 사라지는 경우(삭제·비공개 전환)까지 대비합니다.
    return { empty: true, reason: "no_place_in_combination" };
  }

  const nearby = await loadNearby(place);
  const throwId = await saveThrow({
    scope,
    theme,
    resultSigunguCode: sigunguCode ?? place.sigunguCode,
    place,
    nearby,
  });

  return {
    empty: false,
    throwId,
    scope,
    theme,
    sigungu: { code: place.sigunguCode, name: place.sigunguName },
    place,
    nearby,
  };
}

/** ①단계 — 해당 조합에서 건수가 1 이상인 구·군 목록 */
async function candidateSigungu(scope: DartScope, theme: DartTheme): Promise<string[]> {
  const db = getServiceClient();
  let query = db.from("dart_pool_stats").select("sigungu_code,place_count").gt("place_count", 0);
  if (scope) query = query.eq("sigungu_code", scope);
  if (theme) query = query.eq("theme", theme);

  const { data, error } = await query;
  if (error) {
    throw new DartError("db_error", "다트 후보를 확인하지 못했습니다.", error.message);
  }
  return [...new Set((data ?? []).map((r) => r.sigungu_code as string))];
}

/**
 * 집계표를 믿지 않는 재시도 경로. 후보 구·군을 균등하게 하나 고르고,
 * 그 구·군의 실제 행에서 균등하게 하나를 고릅니다(§7.3 의 `order by random()` 재시도에 해당).
 */
async function drawWithoutStats(
  candidates: string[],
  theme: DartTheme,
): Promise<{ sigunguCode: string; placeId: string } | null> {
  const db = getServiceClient();
  const pool = [...candidates];

  while (pool.length > 0) {
    const picked = pool.splice(randomInt(pool.length), 1)[0];

    let query = db
      .from("places")
      .select("id")
      .eq("sigungu_code", picked)
      .eq("status", "published")
      .is("deleted_at", null);
    if (theme) query = query.eq("theme", theme);

    const { data, error } = await query;
    if (error) {
      throw new DartError("db_error", "다트를 던지지 못했습니다.", error.message);
    }
    if (data && data.length > 0) {
      return { sigunguCode: picked, placeId: data[randomInt(data.length)].id as string };
    }
    // 이 구·군은 집계표만 그랬고 실제로는 비어 있습니다 — 다음 후보로 넘어갑니다.
  }
  return null;
}

async function loadPlaceCard(placeId: string): Promise<PlaceCard | null> {
  const db = getServiceClient();
  const { data, error } = await db
    .from("places")
    .select(`${PLACE_COLUMNS},sigungu(name)`)
    .eq("id", placeId)
    .eq("status", "published")
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    throw new DartError("db_error", "장소 정보를 불러오지 못했습니다.", error.message);
  }
  if (!data) return null;

  const row = data as unknown as PlaceRow & { sigungu: { name: string } | { name: string }[] | null };
  const sigungu = Array.isArray(row.sigungu) ? row.sigungu[0] : row.sigungu;

  return {
    id: row.id,
    name: row.name,
    theme: row.theme,
    sigunguCode: row.sigungu_code,
    sigunguName: sigungu?.name ?? row.sigungu_code,
    lat: row.lat,
    lng: row.lng,
    address: row.address,
    image: row.first_image ?? row.first_image_thumb ?? null,
    isHiddenGem: row.is_hidden_gem,
    isGoodRestaurant: row.is_good_restaurant,
  };
}

/**
 * ④단계 "이 근처" (§7.4) — 반경 3km 안을 **거리순으로만** 최대 20건.
 * 정렬 키가 거리 하나뿐인 것이 D-10·D-11·D-12 의 결론입니다.
 */
async function loadNearby(origin: PlaceCard): Promise<NearbyItem[]> {
  const db = getServiceClient();
  const box = boundingBox(origin, NEARBY_RADIUS_M);

  const { data, error } = await db
    .from("places")
    .select("id,name,theme,lat,lng,first_image_thumb,first_image,is_hidden_gem,is_good_restaurant")
    .eq("status", "published")
    .is("deleted_at", null)
    .neq("id", origin.id)
    .gte("lat", box.minLat)
    .lte("lat", box.maxLat)
    .gte("lng", box.minLng)
    .lte("lng", box.maxLng)
    .limit(NEARBY_SCAN_LIMIT);

  if (error) {
    throw new DartError("db_error", "근처 장소를 불러오지 못했습니다.", error.message);
  }

  return (data ?? [])
    .map((row) => ({
      id: row.id as string,
      name: row.name as string,
      theme: (row.theme as ThemeKey | null) ?? null,
      image: (row.first_image_thumb as string | null) ?? (row.first_image as string | null) ?? null,
      distanceM: distanceMeters(origin, { lat: row.lat as number, lng: row.lng as number }),
      isHiddenGem: Boolean(row.is_hidden_gem),
      isGoodRestaurant: Boolean(row.is_good_restaurant),
    }))
    .filter((item) => item.distanceM <= NEARBY_RADIUS_M)
    .sort((a, b) => a.distanceM - b.distanceM) // 거리 외의 정렬 키가 존재하지 않습니다
    .slice(0, NEARBY_LIMIT);
}

/** ⑤단계 — 결과 스냅샷 저장. 공유 링크가 같은 결과를 그대로 재현하는 근거입니다(D-18). */
async function saveThrow(input: {
  scope: DartScope;
  theme: DartTheme;
  resultSigunguCode: string;
  place: PlaceCard;
  nearby: NearbyItem[];
}): Promise<string> {
  const db = getServiceClient();

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const id = shortId();
    const { error } = await db.from("throws").insert({
      id,
      scope_sigungu_code: input.scope,
      theme: input.theme,
      result_sigungu_code: input.resultSigunguCode,
      result_place_id: input.place.id,
      nearby_snapshot: input.nearby,
    });

    if (!error) return id;
    // 23505 = 중복 키. 아주 드물지만 났다면 새 ID 로 다시 시도합니다.
    if (error.code !== "23505") {
      throw new DartError("db_error", "결과를 저장하지 못했습니다.", error.message);
    }
  }
  throw new DartError("db_error", "결과 ID 를 만들지 못했습니다.");
}

// ── 3. 결과 재현 (§8 `GET /api/throw/:id` · S3 공유 링크) ────────────────────

export async function loadThrowResult(throwId: string): Promise<ThrowLookup> {
  requireConfig();
  const db = getServiceClient();

  const { data, error } = await db
    .from("throws")
    .select(
      "id,scope_sigungu_code,theme,result_sigungu_code,result_place_id,nearby_snapshot,expires_at",
    )
    .eq("id", throwId)
    .maybeSingle();

  if (error) {
    throw new DartError("db_error", "결과를 불러오지 못했습니다.", error.message);
  }
  if (!data) return { kind: "gone" };

  const expiresAt = data.expires_at as string | null;
  if (expiresAt && new Date(expiresAt).getTime() <= Date.now()) {
    return { kind: "gone" };
  }

  const place = await loadPlaceCard(data.result_place_id as string);
  if (!place) return { kind: "gone" };

  const nearby = Array.isArray(data.nearby_snapshot)
    ? (data.nearby_snapshot as NearbyItem[])
    : [];

  return {
    kind: "ok",
    result: {
      empty: false,
      throwId: data.id as string,
      scope: (data.scope_sigungu_code as string | null) ?? null,
      theme: (data.theme as ThemeKey | null) ?? null,
      sigungu: { code: place.sigunguCode, name: place.sigunguName },
      place,
      nearby,
    },
  };
}
