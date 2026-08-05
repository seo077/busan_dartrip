/**
 * `/api/places/:id/reviews` — 후기 목록(GET) · 후기 작성(POST).
 *
 * 설계 정본: `API데이터설계.md` §8(Route 목록 — GET 캐시 1분 / POST 캐시 없음) · §5.8(RLS)
 *            `화면구성도.md` §6.2(작성 시트) · §6.4("후기 등록 실패" 상태)
 *            `D-12`(별점 없음) · `D-9`(로그인 없음)
 *
 * 브라우저가 Supabase 에 직접 쓰지 않는 이유는 §5.8 에 있습니다 — 길이·사진 출처 검사가
 * 서버에 있어야 우회되지 않기 때문입니다. `reviews` 의 RLS 에 쓰기 정책이 없는 것과
 * 이 Route 가 service_role 로 쓰는 것이 한 쌍입니다.
 *
 * 응답
 *   GET  200 { ok: true, reviews: [...] }
 *   POST 200 { ok: true, review: {...} }
 *        400 { ok: false, reason: "invalid" | "bad_request", field?, message }
 *        404 { ok: false, reason: "not_found", message }
 *        200 { ok: false, reason: "missing_config", ... } / 502 { ok: false, reason: "db_error", ... }
 *
 * 실패는 화면이 §6.4 의 "후기 등록 실패 — 시트 유지 + 다시 시도(입력 보존)" 로 받습니다.
 * 그래서 어떤 실패에서도 사용자가 쓴 내용은 서버가 아니라 화면이 들고 있습니다.
 */

import { NextResponse } from "next/server";

import { PlaceError, isUuid, loadPlaceReviews } from "@/lib/place";
import { ReviewError, createReview, parseReview } from "@/lib/review";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/** §8 — 목록은 1분. 새 후기가 1분 안에 보이는 것으로 충분한 자리입니다. */
const LIST_CACHE = { "Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=60" };

function failure(e: unknown) {
  if (e instanceof ReviewError || e instanceof PlaceError) {
    // 설정 미완은 서버 장애가 아닙니다. 화면이 안내를 띄울 수 있게 200 으로 돌려줍니다.
    const status = e.reason === "missing_config" ? 200 : 502;
    return NextResponse.json(
      { ok: false, reason: e.reason, message: e.message, detail: e.detail },
      { status, headers: NO_STORE },
    );
  }
  return NextResponse.json(
    {
      ok: false,
      reason: "unknown",
      message: e instanceof Error ? e.message : "알 수 없는 오류입니다.",
    },
    { status: 500, headers: NO_STORE },
  );
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ placeId: string }> },
) {
  const { placeId } = await context.params;

  if (!isUuid(placeId)) {
    return NextResponse.json(
      { ok: false, reason: "not_found", message: "찾을 수 없는 장소입니다." },
      { status: 404, headers: NO_STORE },
    );
  }

  try {
    const reviews = await loadPlaceReviews(placeId);
    return NextResponse.json({ ok: true, reviews }, { status: 200, headers: LIST_CACHE });
  } catch (e) {
    return failure(e);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ placeId: string }> },
) {
  const { placeId } = await context.params;

  if (!isUuid(placeId)) {
    return NextResponse.json(
      { ok: false, reason: "not_found", message: "찾을 수 없는 장소예요." },
      { status: 404, headers: NO_STORE },
    );
  }

  let payload: unknown = {};
  try {
    const text = await request.text();
    payload = text ? JSON.parse(text) : {};
  } catch {
    return NextResponse.json(
      { ok: false, reason: "bad_request", message: "요청 형식이 올바르지 않습니다." },
      { status: 400, headers: NO_STORE },
    );
  }

  const parsed = parseReview(payload);
  if (!parsed.ok) {
    return NextResponse.json(
      { ok: false, reason: "invalid", field: parsed.field, message: parsed.message },
      { status: 400, headers: NO_STORE },
    );
  }

  try {
    const outcome = await createReview(placeId, parsed.input);

    if (outcome.kind === "not_found") {
      return NextResponse.json(
        { ok: false, reason: "not_found", message: "찾을 수 없는 장소예요." },
        { status: 404, headers: NO_STORE },
      );
    }

    return NextResponse.json(
      { ok: true, review: outcome.review },
      { status: 200, headers: NO_STORE },
    );
  } catch (e) {
    return failure(e);
  }
}
