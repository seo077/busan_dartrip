/**
 * S4 — 장소 상세.
 *
 * 설계 정본: `화면구성도.md` §6(전체) / `API데이터설계.md` §3.1~§3.4 · §5.3 · §8
 *
 * 화면을 두 겹으로 나눠 그립니다 (§6.4 "로딩" 행)
 * ------------------------------------------------
 *   즉시   장소 이름 · 배지 · 길찾기 · 주소 · 지도 · 후기 — 전부 DB 한 번으로 나옵니다.
 *   나중   사진 캐러셀 · 소개 · 함께 가볼 만한 곳 · 주변 도보 코스 — 외부 3종이 붙는 자리.
 *
 * 아래쪽은 `<Suspense>` 로 감싸 **먼저 뜬 화면을 붙잡아 두지 않게** 했습니다. 외부가 늦거나
 * 죽어도 사용자는 이미 장소를 보고 있고, 길찾기를 누를 수 있습니다. 이것이 §6.4 의
 * "부분 결손 — 해당 블록만 생략. 나머지는 정상" 이 실제로 성립하는 방식입니다 (SC-6).
 *
 * 외부 호출은 전부 서버에서 일어납니다. 서비스키가 브라우저 번들에 실릴 경로가 없습니다
 * (④ §2) — 호출부인 `lib/enrich.ts` 에 `server-only` 가 붙어 있어, 클라이언트 컴포넌트가
 * 실수로 가리키면 빌드가 그 자리에서 멈춥니다.
 *
 * **다트 실행 경로와는 무관합니다.** 외부 호출이 있는 내부 경로는 이 화면과 크론뿐입니다
 * (④ §8 · D-6 · OG-1).
 */

import { Suspense, cache } from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { DataSources } from "@/components/DataSources";
import { ShareButton } from "@/components/result/ShareButton";
import { ResultNotice } from "@/components/result/ResultNotice";
import { BackLink } from "@/components/place/BackLink";
import { CourseList } from "@/components/place/CourseList";
import { PhotoCarousel } from "@/components/place/PhotoCarousel";
import { PlaceInfoList } from "@/components/place/PlaceInfoList";
import { PlaceIntro } from "@/components/place/PlaceIntro";
import { PlaceMap } from "@/components/place/PlaceMap";
import { PlaceTitle } from "@/components/place/PlaceTitle";
import { RelatedPlaces } from "@/components/place/RelatedPlaces";
import { ReviewSection } from "@/components/place/ReviewSection";
import type {
  CourseView,
  PhotoView,
  PlaceDetailView,
  RelatedView,
  ReviewView,
} from "@/components/place/types";
import { loadEnrichment } from "@/lib/enrich";
import {
  PlaceError,
  findPlaceIdsByName,
  loadNearbyCourses,
  loadPlaceDetail,
  loadPlaceReviews,
  type PlaceDetail,
} from "@/lib/place";
import { themeLabel } from "@/lib/format";

/**
 * 캐시는 `place_enrichment` 가 이미 맡고 있고(7일), 후기·코스는 바뀔 수 있습니다.
 * 화면 자체를 굳혀 두면 새 후기가 반영되지 않으므로 요청마다 그립니다.
 */
export const dynamic = "force-dynamic";

/** 한 요청 안에서 여러 번 불러도 조회는 한 번만 나가게 묶습니다. */
const readPlace = cache((placeId: string) => loadPlaceDetail(placeId));

const readEnrichment = cache(async (placeId: string) => {
  const place = await readPlace(placeId);
  return place ? loadEnrichment(place) : null;
});

function toView(place: PlaceDetail): PlaceDetailView {
  return {
    id: place.id,
    name: place.name,
    theme: place.theme,
    sigunguName: place.sigunguName,
    lat: place.lat,
    lng: place.lng,
    address: place.address ?? place.roadAddress,
    tel: place.tel,
    homepage: place.homepage,
    image: place.image,
    isHiddenGem: place.isHiddenGem,
    isGoodRestaurant: place.isGoodRestaurant,
  };
}

// ── 공유 미리보기 ────────────────────────────────────────────────────────────

export async function generateMetadata({
  params,
}: {
  params: Promise<{ placeId: string }>;
}): Promise<Metadata> {
  const fallback: Metadata = {
    title: "장소 — 부산 Dartrip",
    description: "부산 지도에 다트를 던져 갈 곳을 우연으로 정하는 서비스.",
  };

  try {
    const { placeId } = await params;
    const place = await readPlace(placeId);
    if (!place) return fallback;

    const title = `${place.name} — 부산 Dartrip`;
    const description = `${place.sigunguName}의 ${themeLabel(place.theme)} 한 곳.`;

    return {
      title,
      description,
      openGraph: {
        type: "website",
        title,
        description,
        images: place.image ? [place.image] : undefined,
      },
      twitter: { card: place.image ? "summary_large_image" : "summary", title, description },
    };
  } catch {
    return fallback;
  }
}

// ── 나중에 붙는 블록들 ───────────────────────────────────────────────────────

/** 사진 캐러셀 — 외부에서 받은 사진을 대표 이미지 뒤에 이어 붙입니다 (§6.3-1). */
async function CarouselSection({ place }: { place: PlaceDetail }) {
  const enrichment = await readEnrichment(place.id);
  const photos: PhotoView[] = enrichment?.photo.photos ?? [];
  return (
    <PhotoCarousel
      photos={photos.length > 0 ? photos : baseline(place)}
      theme={place.theme}
      placeName={place.name}
    />
  );
}

/** 소개 + 정보 — DB 값이 먼저, 빈 칸만 외부 응답으로 채웁니다 (§6.3-4·5). */
async function DetailSection({ place }: { place: PlaceDetail }) {
  const enrichment = await readEnrichment(place.id);
  const detail = enrichment?.detail.detail ?? null;

  // 사용자 등록 장소는 소개가 없고 등록자의 한 줄만 있습니다 (§6.4 "최소 정보")
  const overview = place.overview ?? detail?.overview ?? place.submittedNote ?? null;
  const tel = place.tel ?? detail?.tel ?? null;
  const homepage = place.homepage ?? detail?.homepage ?? null;

  return (
    <>
      {overview ? (
        <PlaceIntro
          text={overview}
          source={place.submittedNote && !place.overview && !detail?.overview ? "등록자가 남긴 소개예요." : undefined}
        />
      ) : null}
      <PlaceInfoList address={place.address ?? place.roadAddress} tel={tel} homepage={homepage} />
    </>
  );
}

/** 함께 가볼 만한 곳 — 우리 목록에도 있는 장소만 S4 로 잇습니다 (§6.5). */
async function RelatedSection({ place }: { place: PlaceDetail }) {
  const enrichment = await readEnrichment(place.id);
  const items = enrichment?.related.items ?? [];
  if (items.length === 0) return null;

  const linked = await findPlaceIdsByName(items.map((i) => i.name));

  const views: RelatedView[] = items
    // 자기 자신은 빼고 보여 줍니다.
    .filter((i) => i.name !== place.name)
    .map((i) => ({
      name: i.name,
      region: i.region,
      category: i.category,
      placeId: linked.get(i.name) ?? null,
    }));

  return <RelatedPlaces items={views} />;
}

/** 주변 도보 코스 — `courses` 표(좌표 있음)가 먼저, 두루누비 응답이 뒤에 (§6.3-8). */
async function CourseSection({ place }: { place: PlaceDetail }) {
  const [dbCourses, enrichment] = await Promise.all([
    loadNearbyCourses(place).catch(() => []),
    readEnrichment(place.id),
  ]);

  const views: CourseView[] = dbCourses.map((c) => ({
    id: c.id,
    name: c.name,
    distanceM: c.distanceM,
    lengthKm: c.lengthKm,
    kind: c.kind,
    region: c.region,
    origin: "db",
  }));

  const seen = new Set(views.map((v) => v.name));
  for (const c of enrichment?.course.courses ?? []) {
    if (seen.has(c.name) || views.length >= 5) continue;
    seen.add(c.name);
    views.push({
      id: c.id,
      name: c.name,
      distanceM: null,
      lengthKm: c.lengthKm,
      kind: c.level ?? null,
      region: c.region,
      origin: "durunubi",
    });
  }

  return <CourseList courses={views} />;
}

/** 외부를 기다리는 동안의 자리 (§6.4 "로딩" — 기본 정보는 이미 떠 있습니다). */
function BlockSkeleton() {
  return (
    <div className="border-t border-white/10 px-5 py-6">
      <div className="h-4 w-28 animate-pulse rounded bg-white/5" />
      <div className="mt-3 h-16 w-full animate-pulse rounded-2xl bg-white/5" />
    </div>
  );
}

/** 외부가 붙기 전에도 캐러셀 자리가 비지 않게, 대표 이미지 한 장으로 시작합니다. */
function baseline(place: PlaceDetail): PhotoView[] {
  return place.image ? [{ url: place.image, label: place.name, credit: null }] : [];
}

// ── 화면 ─────────────────────────────────────────────────────────────────────

export default async function PlacePage({
  params,
}: {
  params: Promise<{ placeId: string }>;
}) {
  const { placeId } = await params;

  let place: PlaceDetail | null;
  try {
    place = await readPlace(placeId);
  } catch (e) {
    // 조회 실패 (§2.4) — 같은 주소를 다시 여는 것이 곧 [다시 시도] 입니다.
    const message =
      e instanceof PlaceError && e.reason === "missing_config"
        ? "아직 준비가 끝나지 않았어요. 잠시 후 다시 열어 주세요."
        : "장소를 불러오지 못했어요.";
    return (
      <main className="mx-auto min-h-screen w-full max-w-lg bg-[#0E1116] text-[#F2F4F7]">
        <ResultNotice
          title={message}
          body="잠깐의 문제일 수 있어요. 다시 시도해 보시고, 그래도 안 되면 새로 던져 보세요."
          actionLabel="다시 시도"
          actionHref={`/place/${encodeURIComponent(placeId)}`}
        />
        <DataSources />
      </main>
    );
  }

  // 미존재·미승인 — 사용자에게는 같은 일입니다 (§6.4)
  if (!place) notFound();

  const view = toView(place);
  const reviews: ReviewView[] = await loadPlaceReviews(place.id).catch(() => []);

  return (
    <main className="mx-auto min-h-screen w-full max-w-lg bg-[#0E1116] text-[#F2F4F7]">
      <header className="sticky top-0 z-20 flex h-14 items-center justify-between bg-[#0E1116]/85 px-2 backdrop-blur">
        <BackLink />
        <ShareButton
          title={`${place.name} — 부산 Dartrip`}
          text={`${place.sigunguName} ${place.name}`}
        />
      </header>

      <Suspense
        fallback={
          <PhotoCarousel
            photos={baseline(place)}
            theme={place.theme}
            placeName={place.name}
            loading
          />
        }
      >
        <CarouselSection place={place} />
      </Suspense>

      <PlaceTitle place={view} />

      <Suspense
        fallback={
          <PlaceInfoList
            address={place.address ?? place.roadAddress}
            tel={place.tel}
            homepage={place.homepage}
          />
        }
      >
        <DetailSection place={place} />
      </Suspense>

      <PlaceMap lat={place.lat} lng={place.lng} name={place.name} />

      <Suspense fallback={<BlockSkeleton />}>
        <RelatedSection place={place} />
      </Suspense>

      <Suspense fallback={<BlockSkeleton />}>
        <CourseSection place={place} />
      </Suspense>

      <ReviewSection reviews={reviews} />

      <DataSources />
    </main>
  );
}
