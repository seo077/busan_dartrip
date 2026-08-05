/**
 * S5 장소 등록 — 서버 쪽 본체 (검증 · 소속 구·군 판정 · 중복 확인 · 적재).
 *
 * 설계 정본: `화면구성도.md` §7.3(입력 규칙 · 중복 등록 · 작성자 식별) · §7.4(상태)
 *            `API데이터설계.md` §5.2(단일 `places`) · §5.3(DDL) · §5.8(RLS) · §8(Route)
 *            `ARCHITECTURE.md` AD-1 · AD-11 / `D-8`(간이판) · `D-9`(로그인 없음)
 *
 * 이 파일이 지키는 것 하나
 * -----------------------
 * **들어오는 행은 예외 없이 `source='user'` · `status='pending'` 입니다.** 상태 값은 호출측이
 * 고르는 값이 아니라 이 파일이 상수로 박아 둔 값입니다. 승인은 사람이 Supabase 콘솔에서
 * `status` 를 `published` 로 바꾸는 것으로만 일어납니다(`D-8` — v1 에 승인 화면은 없습니다).
 *
 * 그래서 등록된 장소는 승인 전까지 다트에 나오지 않습니다. 막는 코드를 따로 두지 않았고,
 * 이미 있는 조건들이 그대로 막습니다.
 *   - `throw_dart()` 의 3단계 조회가 `status = 'published'` 만 봅니다.
 *   - 집계표 갱신 함수 `refresh_pool_stat()` 도 `status = 'published'` 만 셉니다.
 *     그래서 `pending` 행이 들어와 트리거가 돌아도 `dart_pool_stats` 의 건수는 그대로입니다.
 *   - 공개 읽기 정책(`places_read_published`)과 S4 조회(`loadPlaceDetail`)도 같은 조건입니다.
 *
 * 서버 전용입니다. `server-only` 가 붙어 있어 클라이언트 컴포넌트가 import 하면 빌드가
 * 그 자리에서 멈춥니다(service_role 키 유출 차단).
 */

import "server-only";

import { getServiceClient, supabaseStatus } from "@/lib/supabase";
import { BUSAN_BBOX, distanceMeters, isInBusanBox } from "@/lib/geo";
import { looksBusan, reverseGeocode } from "@/lib/kakao";
import { isThemeKey, type ThemeKey } from "@/lib/theme";

// ── 입력 규칙 (§7.3) ─────────────────────────────────────────────────────────

export const NAME_MAX = 40;
export const NOTE_MAX = 60;

/** 중복 의심 반경 (§7.3 "제출 좌표 반경 100m 안에 같은 이름") */
export const DUPLICATE_RADIUS_M = 100;

/** 작성자 식별자 — 출처 무관 문자열 (`D-9` · AD-11). 값만 바뀌고 스키마는 그대로입니다. */
const SUBMITTER_PATTERN = /^[a-z]{1,16}:[A-Za-z0-9._:-]{1,128}$/;

/** 사진 URL 로 받아들이는 자리 — 우리 Storage 공개 경로 하나뿐입니다. */
const PHOTO_URL_PREFIX = "/storage/v1/object/public/place-photos/";

export class SubmitError extends Error {
  readonly reason: "missing_config" | "db_error";
  readonly detail?: string;

  constructor(reason: "missing_config" | "db_error", message: string, detail?: string) {
    super(message);
    this.name = "SubmitError";
    this.reason = reason;
    this.detail = detail;
  }
}

function requireConfig(): void {
  const status = supabaseStatus();
  if (!status.hasUrl || !status.hasServiceKey) {
    throw new SubmitError(
      "missing_config",
      "데이터베이스 설정이 아직 없습니다.",
      "`.env.local` 의 NEXT_PUBLIC_SUPABASE_URL · SUPABASE_SERVICE_ROLE_KEY 를 채워 주세요.",
    );
  }
}

// ── 입력 다듬기 · 검증 ───────────────────────────────────────────────────────

export interface SubmitInput {
  name: string;
  theme: ThemeKey;
  lat: number;
  lng: number;
  note: string | null;
  photoUrl: string | null;
  submittedBy: string | null;
  /** 중복 안내를 보고도 등록하겠다고 한 경우 (§7.3 — 자동 차단하지 않습니다) */
  allowDuplicate: boolean;
}

export type ValidationField = "name" | "theme" | "location" | "note" | "photo";

export type ParseResult =
  | { ok: true; input: SubmitInput }
  | { ok: false; field: ValidationField; message: string };

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * 요청 본문을 규칙(§7.3)에 맞춰 다듬습니다.
 *
 * 화면도 같은 규칙으로 등록 버튼을 잠그지만(§7.4 "미충족"), 화면의 판정을 믿지 않습니다.
 * 브라우저를 거치지 않고 이 경로로 바로 들어오는 요청이 있을 수 있기 때문입니다.
 */
export function parseSubmission(body: unknown): ParseResult {
  const raw = (body ?? {}) as Record<string, unknown>;

  const name = asString(raw.name);
  if (name === "") return { ok: false, field: "name", message: "이름을 입력해 주세요." };
  if (name.length > NAME_MAX) {
    return { ok: false, field: "name", message: `이름은 ${NAME_MAX}자까지 쓸 수 있어요.` };
  }

  const theme = raw.theme;
  if (!isThemeKey(theme)) {
    return { ok: false, field: "theme", message: "테마를 하나 골라 주세요." };
  }

  const lat = Number(raw.lat);
  const lng = Number(raw.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { ok: false, field: "location", message: "지도에서 위치를 정해 주세요." };
  }
  if (!isInBusanBox(lat, lng)) {
    return { ok: false, field: "location", message: "부산 안의 장소만 등록할 수 있어요." };
  }

  const noteRaw = asString(raw.note);
  if (noteRaw.length > NOTE_MAX) {
    return { ok: false, field: "note", message: `한 줄 소개는 ${NOTE_MAX}자까지예요.` };
  }

  const photoRaw = asString(raw.photoUrl);
  if (photoRaw !== "" && !isOwnPhotoUrl(photoRaw)) {
    return { ok: false, field: "photo", message: "사진을 다시 올려 주세요." };
  }

  const submitterRaw = asString(raw.submittedBy);
  const submittedBy = SUBMITTER_PATTERN.test(submitterRaw) ? submitterRaw : null;

  return {
    ok: true,
    input: {
      name,
      theme,
      lat,
      lng,
      note: noteRaw === "" ? null : noteRaw,
      photoUrl: photoRaw === "" ? null : photoRaw,
      submittedBy,
      allowDuplicate: raw.allowDuplicate === true,
    },
  };
}

/**
 * 사진 URL 이 우리 Storage 의 공개 경로인지.
 *
 * 아무 URL 이나 받으면 `places.first_image` 가 외부 주소를 그대로 들고 다니게 됩니다.
 * 그 값은 S3·S4 가 이미지로 그리는 자리라, 받아들이는 자리를 우리 버킷 하나로 좁힙니다.
 */
export function isOwnPhotoUrl(url: string): boolean {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/+$/, "");
  if (!base) return false;
  return url.startsWith(`${base}${PHOTO_URL_PREFIX}`);
}

// ── 소속 구·군 판정 ──────────────────────────────────────────────────────────

export interface SigunguRow {
  code: string;
  name: string;
  centerLat: number;
  centerLng: number;
}

export async function loadSigungu(): Promise<SigunguRow[]> {
  requireConfig();
  const db = getServiceClient();
  const { data, error } = await db
    .from("sigungu")
    .select("code,name,center_lat,center_lng")
    .order("code");

  if (error) {
    throw new SubmitError("db_error", "구·군 목록을 불러오지 못했습니다.", error.message);
  }

  return (data ?? []).map((row) => ({
    code: row.code as string,
    name: row.name as string,
    centerLat: Number(row.center_lat),
    centerLng: Number(row.center_lng),
  }));
}

export interface ResolvedLocation {
  sigunguCode: string;
  sigunguName: string;
  /** 무엇으로 정했는지 — `region` 이면 역지오코딩, `nearest` 면 구·군 중심 거리 */
  by: "region" | "nearest";
  address: string | null;
  roadAddress: string | null;
  /** 역지오코딩이 부산이 아니라고 답한 경우 (호출이 안 되면 false) */
  outsideBusan: boolean;
}

/**
 * 핀 좌표의 소속 구·군을 정합니다.
 *
 * 1순위는 역지오코딩이 돌려준 구·군 이름입니다. 부산의 중·동·서구는 서로 붙어 있고 작아서,
 * 중심 좌표 거리로 고르면 한 칸씩 어긋나기 쉽습니다. 이 값이 어긋나면 구·군 균등 추출(`D-3`)의
 * 칸이 틀어지므로 정확한 쪽을 먼저 봅니다.
 *
 * 2순위는 **가장 가까운 구·군 중심**입니다. 키가 없거나 카카오가 답하지 않는 상황에서도
 * 등록이 막히지 않게 하는 자리입니다. 행정경계 폴리곤(U-10)은 아직 없어 이 이상은 못 합니다.
 * 어느 쪽이든 값은 `sigungu` 표에 실재하는 코드로만 정해집니다.
 *
 * 승인 전 사람이 한 번 보는 구조(`D-8`)라, 2순위로 떨어진 건이 어긋나면 승인 시점에 고칩니다.
 */
export async function resolveLocation(
  lat: number,
  lng: number,
  sigungu: SigunguRow[],
): Promise<ResolvedLocation> {
  const geo = await reverseGeocode(lat, lng);

  if (geo?.region2) {
    const hit = sigungu.find((s) => s.name === geo.region2);
    if (hit) {
      return {
        sigunguCode: hit.code,
        sigunguName: hit.name,
        by: "region",
        address: geo.address,
        roadAddress: geo.roadAddress,
        outsideBusan: geo.region1 !== null && !looksBusan(geo.region1),
      };
    }
  }

  let nearest = sigungu[0];
  let best = Number.POSITIVE_INFINITY;
  for (const s of sigungu) {
    const d = distanceMeters({ lat, lng }, { lat: s.centerLat, lng: s.centerLng });
    if (d < best) {
      best = d;
      nearest = s;
    }
  }

  return {
    sigunguCode: nearest.code,
    sigunguName: nearest.name,
    by: "nearest",
    address: geo?.address ?? null,
    roadAddress: geo?.roadAddress ?? null,
    outsideBusan: geo?.region1 ? !looksBusan(geo.region1) : false,
  };
}

// ── 중복 확인 (§7.3) ─────────────────────────────────────────────────────────

export interface DuplicateHit {
  /** 이미 공개된 장소만 id 를 돌려줍니다 — 승인 전 장소로는 화면을 열 수 없기 때문입니다 */
  id: string | null;
  name: string;
  distanceM: number;
  /** 아직 승인 대기 중인 등록인지 */
  pending: boolean;
}

/** 표기 흔들림(공백·괄호)을 지우고 비교합니다. '흰여울 문화마을' 과 '흰여울문화마을' 은 같습니다. */
function normalizeName(value: string): string {
  return value.replace(/[\s()[\]{}·・.,'"-]/g, "").toLowerCase();
}

/**
 * 제출 좌표 반경 100m 안에 **같은 이름**의 장소가 있는지 (§7.3).
 *
 * 자동으로 막지 않습니다 — 같은 건물의 다른 가게가 있기 때문입니다. 화면이 안내를 띄우고
 * 사용자가 그래도 등록하겠다고 하면 그대로 들어갑니다.
 */
export async function findDuplicates(
  lat: number,
  lng: number,
  name: string,
): Promise<DuplicateHit[]> {
  requireConfig();
  const db = getServiceClient();

  // 100m 는 위·경도로 0.001도 남짓입니다. 사각으로 넉넉히 좁힌 뒤 정확한 거리로 거릅니다.
  const pad = 0.002;
  const { data, error } = await db
    .from("places")
    .select("id,name,lat,lng,status")
    .gte("lat", lat - pad)
    .lte("lat", lat + pad)
    .gte("lng", lng - pad)
    .lte("lng", lng + pad)
    .in("status", ["published", "pending"])
    .is("deleted_at", null)
    .limit(200);

  if (error) {
    throw new SubmitError("db_error", "주변 장소를 확인하지 못했습니다.", error.message);
  }

  const target = normalizeName(name);
  if (target === "") return [];

  return (data ?? [])
    .map((row) => ({
      id: row.status === "published" ? (row.id as string) : null,
      name: row.name as string,
      distanceM: distanceMeters({ lat, lng }, { lat: Number(row.lat), lng: Number(row.lng) }),
      pending: row.status === "pending",
    }))
    .filter((hit) => hit.distanceM <= DUPLICATE_RADIUS_M && normalizeName(hit.name) === target)
    .sort((a, b) => a.distanceM - b.distanceM)
    .slice(0, 3);
}

// ── 적재 ─────────────────────────────────────────────────────────────────────

export interface SubmitAccepted {
  kind: "accepted";
  placeId: string;
  sigunguName: string;
}

export interface SubmitDuplicate {
  kind: "duplicate";
  duplicates: DuplicateHit[];
}

export interface SubmitRejected {
  kind: "rejected";
  field: ValidationField;
  message: string;
}

export type SubmitOutcome = SubmitAccepted | SubmitDuplicate | SubmitRejected;

/**
 * 등록 1건. 성공하면 `pending` 행 하나가 생깁니다.
 *
 * 넣는 값 가운데 호출측이 정할 수 없는 것
 *   `source`  = 'user'      — 출처는 등록 경로가 정합니다
 *   `status`  = 'pending'   — 승인은 사람이 콘솔에서 (`D-8`)
 *   `source_id` = null      — 사용자 등록은 원본 식별자가 없습니다 (④ §5.3)
 *   `is_hidden_gem` = true  — 시드·사용자 등록 표식 (④ §5.3)
 *
 * `theme` 은 사용자가 고른 값을 그대로 씁니다. `theme_map` 매칭 대상이 아닙니다 —
 * 매핑표는 외부 분류코드를 옮기는 자리이고, 여기에는 옮길 원본 분류가 없습니다.
 */
export async function submitPlace(input: SubmitInput): Promise<SubmitOutcome> {
  requireConfig();

  const sigungu = await loadSigungu();
  if (sigungu.length === 0) {
    throw new SubmitError(
      "db_error",
      "구·군 정보가 아직 없습니다.",
      "`npm run backfill:sigungu` 로 구·군 마스터를 먼저 채워 주세요.",
    );
  }

  const located = await resolveLocation(input.lat, input.lng, sigungu);
  if (located.outsideBusan) {
    return {
      kind: "rejected",
      field: "location",
      message: "부산 안의 장소만 등록할 수 있어요.",
    };
  }

  if (!input.allowDuplicate) {
    const duplicates = await findDuplicates(input.lat, input.lng, input.name);
    if (duplicates.length > 0) return { kind: "duplicate", duplicates };
  }

  const db = getServiceClient();
  const { data, error } = await db
    .from("places")
    .insert({
      source: "user",
      source_id: null,
      name: input.name,
      theme: input.theme,
      sigungu_code: located.sigunguCode,
      lat: input.lat,
      lng: input.lng,
      address: located.address,
      road_address: located.roadAddress,
      first_image: input.photoUrl,
      is_hidden_gem: true,
      status: "pending",
      submitted_by: input.submittedBy,
      submitted_note: input.note,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new SubmitError(
      "db_error",
      "등록하지 못했어요.",
      error?.message ?? "적재 결과가 비어 있습니다.",
    );
  }

  return {
    kind: "accepted",
    placeId: data.id as string,
    sigunguName: located.sigunguName,
  };
}

/** 화면이 지도 초기 위치·경계 안내에 쓰는 값입니다. */
export const BUSAN_BOUNDS = BUSAN_BBOX;
