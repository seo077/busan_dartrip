/**
 * S4 장소 상세 — 외부 API 3종과 그 캐시.
 *
 * 설계 정본: `API데이터설계.md` §3.1~§3.4 · §5.3(`place_enrichment`) · §8(캐시 7일)
 *            `ARCHITECTURE.md` AD-7(캐시) · AD-8(결손 블록은 통째로 감춤)
 *            `화면구성도.md` §6.3(구성 요소) · §6.4(부분 결손 · 로딩)
 *
 * 이 파일이 지키는 세 가지
 * ------------------------
 * 1. **다트 경로에는 관여하지 않습니다.** 외부 호출이 있는 곳은 여기와 크론뿐이고(§8),
 *    `/api/throw` 는 이 파일을 import 하지 않습니다 (D-6 · OG-1 · SC-1).
 * 2. **같은 장소를 다시 열면 외부로 나가지 않습니다.** 결과를 `place_enrichment` 에 담고
 *    7일 동안 그대로 씁니다 (AD-7). 실패는 1시간만 기억해 두었다가 다시 시도합니다 —
 *    키 등록·장애 복구가 하루 안에 화면에 반영되게 하려는 것입니다.
 * 3. **한 곳이 죽어도 나머지는 그립니다.** 세 블록을 따로 부르고 따로 캐시하며, 실패는
 *    예외로 올리지 않고 "이 블록은 비었다" 는 사실로 바꿔 돌려줍니다 (SC-6 · §6.4).
 *
 * 캐시 `kind` 에 대하여
 * ---------------------
 * `place_enrichment.kind` 는 `('related','course','photo','detail')` 네 값을 허용합니다
 * (마이그레이션 `20260805150000_place_enrichment_detail_kind.sql`). 사진(`detailImage2` +
 * 관광사진)과 소개(`detailCommon2`)는 **서로 다른 행**입니다. 앞 회차에는 담을 자리가
 * 셋뿐이라 소개를 사진 행에 얹어 두었는데, 그러면 한쪽만 실패해도 둘 다 다시 받아야 하고
 * 백필이 소개만 미리 채워 두는 것도 불가능했습니다.
 *
 * 소개는 DB 가 먼저입니다
 * -----------------------
 * `places.overview` 가 채워져 있으면 **`detailCommon2` 를 부르지 않습니다**
 * (`scripts/backfill/05-detail.ts` 가 미리 채웁니다). 화면이 어차피 DB 값을 먼저 쓰므로,
 * 부르면 쓰이지도 않을 응답으로 한도만 축나기 때문입니다.
 */

import "server-only";

import { getServiceClient, supabaseStatus } from "@/lib/supabase";
import {
  PortalError,
  failureNote,
  hasPortalKey,
  type PortalFailure,
} from "@/lib/dataportal.core";
import {
  TourApiError,
  fetchPlaceDetail,
  fetchPlaceImages,
  type TourPlaceDetail,
  type TourPlaceImage,
} from "@/lib/tourapi.core";
import { fetchRelatedPlaces, RELATED_SERVICE, type RelatedPlace } from "@/lib/related";
import { lawSignguCd } from "@/lib/lawdong";
import {
  DURUNUBI_SERVICE,
  fetchBusanCourses,
  selectForSigungu,
  type DuruCourse,
} from "@/lib/durunubi";
import { PHOTO_SERVICE, fetchGalleryPhotos, type GalleryPhoto } from "@/lib/photo";
import type { PlaceDetail } from "@/lib/place";

/** 성공한 응답을 다시 쓰는 기간 (AD-7 · §8) */
const OK_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** 실패를 기억해 두는 기간. 짧게 둬야 복구가 화면에 빨리 반영됩니다 */
const FAIL_TTL_MS = 60 * 60 * 1000;

/**
 * 캐시에 담긴 값의 세대.
 *
 * 호출 규격이나 담는 모양을 바꾸면 **이 숫자를 올립니다.** 그러면 예전 세대로 담긴 행은
 * 아직 7일이 안 지났어도 낡은 것으로 보고 다시 받아 옵니다. 올리지 않으면 규격을 고쳐도
 * 최대 일주일 동안 옛 결과가 화면에 그대로 남습니다.
 *
 *   1 → 2  연관관광지 호출에 지역 코드(`areaCd`·`signguCd`)를 넣도록 고침 (2026-08-05)
 *   2 → 3  사진 행에서 소개를 떼어 `kind='detail'` 로 분리 (2026-08-05)
 */
const PAYLOAD_VERSION = 3;

type Kind = "photo" | "detail" | "related" | "course";

/**
 * 한 블록이 어디서 무엇을 받아 왔는지. 설계 §3.2~§3.4 가 `[미확정]` 으로 남긴 부분을
 * **화면·응답에 사실 그대로 남기기 위한** 기록입니다. 사용자 화면에는 나오지 않습니다.
 */
export interface EnrichSpec {
  service: string;
  operation: string | null;
  envelopePath: string | null;
  fieldsSeen: string[];
  ok: boolean;
  /** 어긋났을 때의 이유. 화면은 이 값을 글로 옮기지 않고 블록을 감춥니다 */
  reason: PortalFailure | "db" | null;
  note: string | null;
}

function okSpec(
  service: string,
  operation: string | null,
  envelopePath: string | null,
  fieldsSeen: string[],
): EnrichSpec {
  return { service, operation, envelopePath, fieldsSeen, ok: true, reason: null, note: null };
}

function failSpec(service: string, e: unknown): EnrichSpec {
  if (e instanceof PortalError) {
    return {
      service,
      operation: e.operation,
      envelopePath: null,
      fieldsSeen: [],
      ok: false,
      reason: e.reason,
      note: `${failureNote(e.reason)} ${e.message}`,
    };
  }
  if (e instanceof TourApiError) {
    return {
      service,
      operation: null,
      envelopePath: null,
      fieldsSeen: [],
      ok: false,
      reason: e.reason === "missing_key" ? "missing_key" : "api_error",
      note: e.message,
    };
  }
  return {
    service,
    operation: null,
    envelopePath: null,
    fieldsSeen: [],
    ok: false,
    reason: "api_error",
    note: e instanceof Error ? e.message : String(e),
  };
}

// ── 화면이 받는 모양 ─────────────────────────────────────────────────────────

export interface CarouselPhoto {
  url: string;
  /** 대체 텍스트로 쓸 만한 이름 */
  label: string | null;
  /** 표기할 제공자·촬영자. 있으면 캐러셀 아래에 적습니다 (§3.4) */
  credit: string | null;
}

export interface PhotoBlock {
  photos: CarouselPhoto[];
  specs: EnrichSpec[];
}

/** `detailCommon2` 로 받아 온 소개·연락처. 화면의 소개/정보 블록이 씁니다 */
export interface DetailBlock {
  detail: {
    overview: string | null;
    tel: string | null;
    homepage: string | null;
  } | null;
  specs: EnrichSpec[];
}

export interface RelatedBlock {
  items: RelatedPlace[];
  spec: EnrichSpec;
}

export interface CourseBlock {
  courses: DuruCourse[];
  spec: EnrichSpec;
}

export interface Enrichment {
  photo: PhotoBlock;
  detail: DetailBlock;
  related: RelatedBlock;
  course: CourseBlock;
}

// ── 캐시 ─────────────────────────────────────────────────────────────────────

interface CacheRow {
  payload: Record<string, unknown>;
  fetchedAt: string;
}

function cacheReady(): boolean {
  const s = supabaseStatus();
  return s.hasUrl && s.hasServiceKey;
}

async function readCache(placeId: string, kind: Kind): Promise<CacheRow | null> {
  if (!cacheReady()) return null;
  try {
    const db = getServiceClient();
    const { data, error } = await db
      .from("place_enrichment")
      .select("payload,fetched_at")
      .eq("place_id", placeId)
      .eq("kind", kind)
      .maybeSingle();
    if (error || !data) return null;
    return {
      payload: (data.payload ?? {}) as Record<string, unknown>,
      fetchedAt: data.fetched_at as string,
    };
  } catch {
    // 캐시를 못 읽는 것이 화면을 막을 이유는 아닙니다. 외부를 한 번 더 부르면 됩니다.
    return null;
  }
}

async function writeCache(
  placeId: string,
  kind: Kind,
  payload: Record<string, unknown>,
): Promise<void> {
  if (!cacheReady()) return;
  try {
    const db = getServiceClient();
    await db
      .from("place_enrichment")
      .upsert(
        {
          place_id: placeId,
          kind,
          payload: { ...payload, v: PAYLOAD_VERSION },
          fetched_at: new Date().toISOString(),
        },
        { onConflict: "place_id,kind" },
      );
  } catch {
    // 캐시에 못 쓰는 것도 화면을 막을 이유는 아닙니다.
  }
}

/** 성공한 값은 7일, 실패한 값은 1시간 씁니다. 세대가 다르면 나이와 무관하게 다시 받습니다. */
function isFresh(row: CacheRow): boolean {
  if (row.payload.v !== PAYLOAD_VERSION) return false;
  const ok = row.payload.ok === true;
  const age = Date.now() - new Date(row.fetchedAt).getTime();
  return age < (ok ? OK_TTL_MS : FAIL_TTL_MS);
}

/**
 * 캐시를 먼저 보고, 없거나 낡았으면 `build` 를 돌려 그 결과를 담아 둡니다.
 * `build` 가 던지는 예외는 여기서 잡아 "실패" 로 담습니다 — 화면까지 올라가지 않습니다.
 */
async function cached<T extends Record<string, unknown>>(
  placeId: string,
  kind: Kind,
  build: () => Promise<T>,
  onError: (e: unknown) => T,
): Promise<T> {
  const row = await readCache(placeId, kind);
  if (row && isFresh(row)) return row.payload as unknown as T;

  let payload: T;
  try {
    payload = await build();
  } catch (e) {
    payload = onError(e);
  }
  await writeCache(placeId, kind, payload);
  return payload;
}

// ── 1. 사진 캐러셀 (관광공사 국문 관광정보 + 관광사진) ───────────────────────

const TOUR_SERVICE = "B551011/KorService2";

interface PhotoPayload extends Record<string, unknown> {
  ok: boolean;
  images: TourPlaceImage[];
  gallery: GalleryPhoto[];
  specs: EnrichSpec[];
}

async function buildPhoto(place: PlaceDetail): Promise<PhotoPayload> {
  const specs: EnrichSpec[] = [];
  let images: TourPlaceImage[] = [];
  let gallery: GalleryPhoto[] = [];

  // ① 국문 관광정보 — 이 장소의 사진. contentid 가 있는 관광공사 출처만 부릅니다.
  const contentId = place.source === "tourapi" ? place.sourceId : null;
  if (contentId) {
    try {
      images = await fetchPlaceImages(contentId);
      specs.push(okSpec(TOUR_SERVICE, "detailImage2", "response.body.items.item", [
        "contentid",
        "originimgurl",
        "smallimageurl",
        "imgname",
        "cpyrhtDivCd",
      ]));
    } catch (e) {
      specs.push(failSpec(TOUR_SERVICE, e));
    }
  }

  // ② 관광사진 — 키워드로 걸리는 것을 더 얹습니다(§3.4). 못 맞히는 것이 정상 범위입니다.
  try {
    const result = await fetchGalleryPhotos(place.name, { limit: 6 });
    gallery = result.photos;
    specs.push(
      okSpec(PHOTO_SERVICE, result.operation, result.envelopePath, result.fieldsSeen),
    );
  } catch (e) {
    specs.push(failSpec(PHOTO_SERVICE, e));
  }

  return { ok: specs.some((s) => s.ok), images, gallery, specs };
}

// ── 2. 소개 · 전화 · 홈페이지 (`detailCommon2`) ──────────────────────────────

interface DetailPayload extends Record<string, unknown> {
  ok: boolean;
  detail: TourPlaceDetail | null;
  specs: EnrichSpec[];
}

async function buildDetail(place: PlaceDetail): Promise<DetailPayload> {
  const contentId = place.source === "tourapi" ? place.sourceId : null;
  if (!contentId) return { ok: true, detail: null, specs: [] };

  const detail = await fetchPlaceDetail(contentId);
  return {
    ok: true,
    detail,
    specs: [
      okSpec(TOUR_SERVICE, "detailCommon2", "response.body.items.item", [
        "contentid",
        "overview",
        "tel",
        "homepage",
        "cpyrhtDivCd",
      ]),
    ],
  };
}

function toDetailBlock(payload: DetailPayload): DetailBlock {
  return {
    detail: payload.detail
      ? {
          overview: payload.detail.overview,
          tel: payload.detail.tel,
          homepage: payload.detail.homepage,
        }
      : null,
    specs: payload.specs ?? [],
  };
}

function toPhotoBlock(payload: PhotoPayload, place: PlaceDetail): PhotoBlock {
  const photos: CarouselPhoto[] = [];
  const seen = new Set<string>();

  const push = (url: string | null, label: string | null, credit: string | null) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    photos.push({ url, label, credit });
  };

  // 대표 이미지가 맨 앞입니다 — 결과 화면에서 보던 그 사진이 상세 첫 장이어야 흐름이 이어집니다.
  push(place.image, place.name, null);
  for (const img of payload.images ?? []) push(img.url, img.name ?? place.name, null);
  for (const g of payload.gallery ?? []) push(g.url, g.title ?? place.name, g.photographer);

  return { photos, specs: payload.specs ?? [] };
}

// ── 3. 함께 가볼 만한 곳 (연관관광지) ────────────────────────────────────────

interface RelatedPayload extends Record<string, unknown> {
  ok: boolean;
  items: RelatedPlace[];
  spec: EnrichSpec;
}

async function buildRelated(place: PlaceDetail): Promise<RelatedPayload> {
  // 이 서비스는 **법정동 코드**를 씁니다 — 국문 관광정보의 지역코드와 다른 체계입니다
  // (`lib/lawdong.ts`). 넣지 않으면 오류 없이 0건이 돌아옵니다.
  const signguCd = lawSignguCd(place.sigunguCode, place.sigunguName);
  const result = await fetchRelatedPlaces(place.name, { signguCd, limit: 12 });
  return {
    ok: true,
    items: result.items,
    spec: okSpec(RELATED_SERVICE, result.operation, result.envelopePath, result.fieldsSeen),
  };
}

// ── 4. 주변 도보 코스 (두루누비) ─────────────────────────────────────────────

interface CoursePayload extends Record<string, unknown> {
  ok: boolean;
  courses: DuruCourse[];
  spec: EnrichSpec;
}

async function buildCourse(place: PlaceDetail): Promise<CoursePayload> {
  const result = await fetchBusanCourses();
  const picked = selectForSigungu(result.courses, place.sigunguName, 3);
  return {
    ok: true,
    courses: picked,
    spec: okSpec(
      DURUNUBI_SERVICE,
      result.operation,
      result.envelopePath,
      result.fieldsSeen,
    ),
  };
}

// ── 진입점 ───────────────────────────────────────────────────────────────────

/**
 * 네 블록을 한꺼번에 준비합니다. **어떤 경우에도 예외를 던지지 않습니다** —
 * 화면이 이 함수 때문에 멈추면 §6.4 "부분 결손" 이 성립하지 않습니다.
 */
export async function loadEnrichment(place: PlaceDetail): Promise<Enrichment> {
  const keyMissing = !hasPortalKey();

  // 소개가 DB 에 이미 있으면 `detailCommon2` 를 부르지 않습니다. 화면이 DB 값을 먼저
  // 쓰므로 불러 봐야 쓰이지 않고, 백필(`05-detail.ts`)이 채워 둔 값이 곧 이 값입니다.
  const detailInDb = place.overview !== null && place.overview.trim() !== "";

  const [photo, detail, related, course] = await Promise.all([
    cached<PhotoPayload>(
      place.id,
      "photo",
      () => buildPhoto(place),
      (e) => ({ ok: false, images: [], gallery: [], specs: [failSpec(TOUR_SERVICE, e)] }),
    ),
    keyMissing || detailInDb
      ? Promise.resolve<DetailPayload>({ ok: true, detail: null, specs: [] })
      : cached<DetailPayload>(
          place.id,
          "detail",
          () => buildDetail(place),
          (e) => ({ ok: false, detail: null, specs: [failSpec(TOUR_SERVICE, e)] }),
        ),
    keyMissing
      ? Promise.resolve<RelatedPayload>({
          ok: false,
          items: [],
          spec: failSpec(RELATED_SERVICE, new PortalError("missing_key", RELATED_SERVICE, "", "서비스키가 없습니다.")),
        })
      : cached<RelatedPayload>(
          place.id,
          "related",
          () => buildRelated(place),
          (e) => ({ ok: false, items: [], spec: failSpec(RELATED_SERVICE, e) }),
        ),
    keyMissing
      ? Promise.resolve<CoursePayload>({
          ok: false,
          courses: [],
          spec: failSpec(DURUNUBI_SERVICE, new PortalError("missing_key", DURUNUBI_SERVICE, "", "서비스키가 없습니다.")),
        })
      : cached<CoursePayload>(
          place.id,
          "course",
          () => buildCourse(place),
          (e) => ({ ok: false, courses: [], spec: failSpec(DURUNUBI_SERVICE, e) }),
        ),
  ]);

  return {
    photo: toPhotoBlock(photo, place),
    detail: toDetailBlock(detail),
    related: { items: related.items ?? [], spec: related.spec },
    course: { courses: course.courses ?? [], spec: course.spec },
  };
}
