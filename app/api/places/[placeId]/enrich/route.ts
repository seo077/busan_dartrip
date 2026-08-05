/**
 * GET /api/places/:id/enrich — 사진·소개·연관·코스 (S4).
 *
 * 설계 정본: `API데이터설계.md` §8(Route 목록 — 외부 호출 있음 / 캐시 7일)
 *            §3.2~§3.4(외부 3종) · §5.3(`place_enrichment`)
 *
 * **내부 경로 중 외부 API 를 부르는 곳은 여기와 크론 둘뿐입니다** (§8). 화면(S4)은 서버
 * 컴포넌트라 같은 함수(`loadEnrichment`)를 직접 부르므로 이 Route 를 거치지 않습니다.
 * 그래도 두는 이유는 두 가지입니다.
 *
 *   1) §8 이 정한 경로라서 — 설계와 구현이 어긋나 있지 않게.
 *   2) **어떤 외부 서비스에 무엇을 물어 무엇이 왔는지 눈으로 확인할 창구**가 필요해서.
 *      응답의 `specs` 에 서비스 경로 · 통한 오퍼레이션명 · 응답 봉투 경로 · 첫 행의 필드
 *      이름이 그대로 담깁니다. 설계 §3.2~§3.4 가 `[미확정]` 으로 남긴 부분을 사실로 바꾸는
 *      근거가 이 응답입니다.
 *
 * 실패해도 500 이 아닙니다. 외부가 죽는 것은 이 서비스의 정상 상태 중 하나이고(SC-6),
 * 화면은 해당 블록만 감춰야 하므로 "무엇이 비었는지" 를 200 으로 알려 줍니다.
 */

import { NextResponse } from "next/server";

import { loadEnrichment } from "@/lib/enrich";
import { PlaceError, loadPlaceDetail } from "@/lib/place";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ placeId: string }> },
) {
  const { placeId } = await context.params;

  let place;
  try {
    place = await loadPlaceDetail(placeId);
  } catch (e) {
    if (e instanceof PlaceError) {
      return NextResponse.json(
        { ok: false, reason: e.reason, message: e.message, detail: e.detail },
        { status: e.reason === "missing_config" ? 200 : 502, headers: { "Cache-Control": "no-store" } },
      );
    }
    return NextResponse.json(
      { ok: false, reason: "unknown", message: e instanceof Error ? e.message : "알 수 없는 오류입니다." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (!place) {
    return NextResponse.json(
      { ok: false, reason: "not_found", message: "찾을 수 없는 장소입니다." },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }

  const enrichment = await loadEnrichment(place);

  return NextResponse.json(
    {
      ok: true,
      placeId: place.id,
      name: place.name,
      photo: {
        count: enrichment.photo.photos.length,
        photos: enrichment.photo.photos,
      },
      // 소개·전화·홈페이지. `places.overview` 가 이미 있으면 외부를 부르지 않아 null 입니다.
      detail: enrichment.detail.detail,
      related: { count: enrichment.related.items.length, items: enrichment.related.items },
      course: { count: enrichment.course.courses.length, courses: enrichment.course.courses },
      // 규격 확인용 — 어떤 서비스에 무엇으로 물었고 무엇이 왔는지
      specs: [
        ...enrichment.photo.specs,
        ...enrichment.detail.specs,
        enrichment.related.spec,
        enrichment.course.spec,
      ],
    },
    {
      headers: {
        // §8 — 7일. 실제 수명은 `place_enrichment` 가 들고 있고, 여기서는 CDN 쪽만 정합니다.
        "Cache-Control": "public, max-age=0, s-maxage=604800, stale-while-revalidate=86400",
      },
    },
  );
}
