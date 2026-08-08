/**
 * S4 장소 상세 — DB 에서 읽는 부분.
 *
 * 설계 정본: `API데이터설계.md` §5.3(`places`·`courses`·`reviews`) · §8(Route 목록)
 *            `화면구성도.md` §6.3(구성 요소) · §6.4(상태)
 *
 * **이 파일에는 외부 호출이 없습니다.** 화면의 기본 정보는 전부 DB 한 번으로 그려지고,
 * 외부 3종은 `lib/enrich.ts` 가 따로 맡습니다. 그래서 외부가 통째로 죽어도 S4 는 뜹니다
 * (`화면구성도.md` §6.4 "부분 결손" · SC-6).
 *
 * 서버 전용입니다. `server-only` 가 붙어 있어 클라이언트 컴포넌트가 import 하면 빌드가
 * 그 자리에서 멈춥니다(service_role 키 유출 차단).
 */

import "server-only";

import { getServiceClient, supabaseStatus } from "@/lib/supabase";
import { boundingBox, distanceMeters } from "@/lib/geo";
import type { PlaceSource, ThemeKey } from "@/lib/theme";

/** "주변 도보 코스" 를 찾는 반경. 걸어서 갈 만한 거리로 둡니다. */
export const COURSE_RADIUS_M = 5000;

/** 한 화면에 두는 코스 수 (§6.1 와이어프레임은 목록 형태입니다) */
export const COURSE_LIMIT = 3;

export class PlaceError extends Error {
  readonly reason: "missing_config" | "db_error";
  readonly detail?: string;

  constructor(reason: "missing_config" | "db_error", message: string, detail?: string) {
    super(message);
    this.name = "PlaceError";
    this.reason = reason;
    this.detail = detail;
  }
}

function requireConfig(): void {
  const status = supabaseStatus();
  if (!status.hasUrl || !status.hasServiceKey) {
    throw new PlaceError(
      "missing_config",
      "데이터베이스 설정이 아직 없습니다.",
      "`.env.local` 의 NEXT_PUBLIC_SUPABASE_URL · SUPABASE_SERVICE_ROLE_KEY 를 채워 주세요.",
    );
  }
}

/**
 * `places.id` 는 uuid 입니다. 아무 문자열이나 그대로 조회로 보내면 Postgres 가 형식 오류를
 * 내고, 그 오류가 "없는 장소" 가 아니라 "서버 오류" 로 보입니다. 미리 걸러 둡니다.
 */
export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export interface PlaceDetail {
  id: string;
  name: string;
  theme: ThemeKey | null;
  source: PlaceSource;
  /** 관광공사 `contentid`. 외부 상세·사진 조회의 열쇠입니다. 사용자 등록 장소는 null */
  sourceId: string | null;
  contentTypeId: string | null;
  sigunguCode: string;
  sigunguName: string;
  lat: number;
  lng: number;
  address: string | null;
  roadAddress: string | null;
  tel: string | null;
  homepage: string | null;
  overview: string | null;
  /** 등록자가 남긴 한 줄 (§6.4 "최소 정보" 상태에서 소개 자리에 놓입니다) */
  submittedNote: string | null;
  image: string | null;
  isHiddenGem: boolean;
  /** 모범음식점 배지 (D-11). **표시 전용** — 정렬·필터·배제에 쓰지 않습니다 */
  isGoodRestaurant: boolean;
}

const DETAIL_COLUMNS = [
  "id",
  "name",
  "theme",
  "source",
  "source_id",
  "content_type_id",
  "sigungu_code",
  "lat",
  "lng",
  "address",
  "road_address",
  "tel",
  "homepage",
  "overview",
  "submitted_note",
  "first_image",
  "first_image_thumb",
  "is_hidden_gem",
  "is_good_restaurant",
].join(",");

interface DetailRow {
  id: string;
  name: string;
  theme: ThemeKey | null;
  source: PlaceSource;
  source_id: string | null;
  content_type_id: string | null;
  sigungu_code: string;
  lat: number;
  lng: number;
  address: string | null;
  road_address: string | null;
  tel: string | null;
  homepage: string | null;
  overview: string | null;
  submitted_note: string | null;
  first_image: string | null;
  first_image_thumb: string | null;
  is_hidden_gem: boolean;
  is_good_restaurant: boolean;
  sigungu: { name: string } | { name: string }[] | null;
}

/**
 * 장소 1건. 없으면 null 입니다.
 *
 * `status = 'published'` 인 행만 돌려줍니다. 승인 대기(`pending`)·미분류(`unclassified`)를
 * 직접 주소로 열어도 **없는 장소와 같게** 다룹니다 (§6.4 "미승인" 행 — 등록자 본인 포함).
 */
export async function loadPlaceDetail(placeId: string): Promise<PlaceDetail | null> {
  requireConfig();
  if (!isUuid(placeId)) return null;

  const db = getServiceClient();
  const { data, error } = await db
    .from("places")
    .select(`${DETAIL_COLUMNS},sigungu(name)`)
    .eq("id", placeId)
    .eq("status", "published")
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    throw new PlaceError("db_error", "장소 정보를 불러오지 못했습니다.", error.message);
  }
  if (!data) return null;

  const row = data as unknown as DetailRow;
  const sigungu = Array.isArray(row.sigungu) ? row.sigungu[0] : row.sigungu;

  return {
    id: row.id,
    name: row.name,
    theme: row.theme,
    source: row.source,
    sourceId: row.source_id,
    contentTypeId: row.content_type_id,
    sigunguCode: row.sigungu_code,
    sigunguName: sigungu?.name ?? row.sigungu_code,
    lat: row.lat,
    lng: row.lng,
    address: row.address,
    roadAddress: row.road_address,
    tel: row.tel,
    homepage: row.homepage,
    overview: row.overview,
    submittedNote: row.submitted_note,
    image: row.first_image ?? row.first_image_thumb ?? null,
    isHiddenGem: row.is_hidden_gem,
    isGoodRestaurant: row.is_good_restaurant,
  };
}

// ── 주변 도보 코스 — 좌표가 있는 쪽(DB) ──────────────────────────────────────

export interface NearbyCourse {
  id: string;
  name: string;
  /** 이 장소에서 코스 시작점까지의 직선거리(m). 좌표를 아는 코스만 값이 있습니다 */
  distanceM: number | null;
  /** 코스 길이(km) */
  lengthKm: number | null;
  kind: string | null;
  region: string | null;
  /** 어디서 온 코스인지 — 화면에 출처를 밝히는 데 씁니다 */
  origin: "db" | "durunubi";
}

/**
 * `courses` 표에서 반경 안의 코스를 거리순으로 가져옵니다.
 * 정렬 키는 거리 하나뿐입니다 — 이 화면에도 인기·평점 개념이 없습니다.
 */
export async function loadNearbyCourses(
  place: { id: string; lat: number; lng: number },
  options: { radiusM?: number; limit?: number } = {},
): Promise<NearbyCourse[]> {
  requireConfig();
  const radiusM = options.radiusM ?? COURSE_RADIUS_M;
  const limit = options.limit ?? COURSE_LIMIT;

  const db = getServiceClient();
  const box = boundingBox(place, radiusM);

  const { data, error } = await db
    .from("courses")
    .select("id,name,distance_km,kind,start_lat,start_lng")
    .not("start_lat", "is", null)
    .not("start_lng", "is", null)
    .gte("start_lat", box.minLat)
    .lte("start_lat", box.maxLat)
    .gte("start_lng", box.minLng)
    .lte("start_lng", box.maxLng)
    .limit(200);

  if (error) {
    throw new PlaceError("db_error", "주변 코스를 불러오지 못했습니다.", error.message);
  }

  return (data ?? [])
    .map((row) => ({
      id: row.id as string,
      name: row.name as string,
      distanceM: distanceMeters(place, {
        lat: row.start_lat as number,
        lng: row.start_lng as number,
      }),
      lengthKm: row.distance_km === null ? null : Number(row.distance_km),
      kind: (row.kind as string | null) ?? null,
      region: null,
      origin: "db" as const,
    }))
    .filter((c) => (c.distanceM ?? Infinity) <= radiusM)
    .sort((a, b) => (a.distanceM ?? 0) - (b.distanceM ?? 0))
    .slice(0, limit);
}

// ── 후기 (D-12) ──────────────────────────────────────────────────────────────

export interface PlaceReview {
  id: string;
  body: string | null;
  photoPath: string | null;
  createdAt: string;
}

/**
 * 후기 목록 (§6.3-9). **별점은 없습니다** — `reviews` 에 컬럼 자체가 없습니다(AD-6).
 *
 * 정렬 키는 작성 시각 하나뿐입니다(최신순). 추천 수·조회수로 줄 세울 값이 애초에 없습니다.
 * 작성은 `lib/review.ts` 가 맡습니다 — 읽기와 쓰기를 나눠, 화면(서버 컴포넌트)이 쓰기 경로를
 * 지나가지 않게 합니다.
 */
export async function loadPlaceReviews(
  placeId: string,
  options: { limit?: number } = {},
): Promise<PlaceReview[]> {
  requireConfig();
  if (!isUuid(placeId)) return [];

  const db = getServiceClient();
  const { data, error } = await db
    .from("reviews")
    .select("id,body,photo_path,created_at")
    .eq("place_id", placeId)
    // r12 이후 이 표는 **방문 기록을 겸합니다**(`AD-21`). "다녀왔어요" 만 누른 행은 본문·사진이
    // 둘 다 비어 있고, 목록에 내면 **빈 카드가 줄줄이 서는 자리**가 됩니다 — 보여 줄 내용이
    // 없고, 남이 다녀갔다는 사실만 나열해도 목록이 무의미해집니다(④ §5.3.1).
    // 스탬프·아카이빙은 반대로 두 종류를 구분하지 않고 전부 셉니다(`lib/visit.ts`).
    .or("body.not.is.null,photo_path.not.is.null")
    .order("created_at", { ascending: false })
    .limit(options.limit ?? 10);

  if (error) {
    throw new PlaceError("db_error", "후기를 불러오지 못했습니다.", error.message);
  }

  return (data ?? []).map((row) => ({
    id: row.id as string,
    body: (row.body as string | null) ?? null,
    photoPath: (row.photo_path as string | null) ?? null,
    createdAt: row.created_at as string,
  }));
}

// ── 연관 장소를 우리 장소와 잇기 (§6.5 "연관 장소 탭 → S4") ──────────────────

/**
 * 이름이 같은 장소가 우리 `places` 에 있으면 그 id 를 돌려줍니다.
 * 있는 것만 S4 로 잇고, 없는 것은 링크 없는 카드로 둡니다 — 없는 주소로 보내지 않기 위해서입니다.
 */
export async function findPlaceIdsByName(
  names: readonly string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = [...new Set(names.map((n) => n.trim()).filter((n) => n !== ""))];
  if (unique.length === 0) return out;

  requireConfig();
  const db = getServiceClient();
  const { data, error } = await db
    .from("places")
    .select("id,name")
    .in("name", unique)
    .eq("status", "published")
    .is("deleted_at", null);

  if (error) return out; // 링크를 못 거는 것이 화면을 막을 이유는 아닙니다.

  for (const row of data ?? []) {
    const name = row.name as string;
    if (!out.has(name)) out.set(name, row.id as string);
  }
  return out;
}
