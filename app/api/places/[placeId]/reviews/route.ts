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
 *        200 { ok: true, reviews: [...], mine: boolean }   ← `?author=` 를 준 경우
 *   POST 200 { ok: true, review: {...} }
 *        400 { ok: false, reason: "invalid" | "bad_request", field?, message }
 *        404 { ok: false, reason: "not_found", message }
 *        409 { ok: false, reason: "duplicate", message }
 *        429 { ok: false, reason: "rate_limited", message, detail, retryAfter }   ← ④ §11.3
 *        200 { ok: false, reason: "missing_config", ... } / 502 { ok: false, reason: "db_error", ... }
 *
 * 실패는 화면이 §6.4 의 "후기 등록 실패 — 시트 유지 + 다시 시도(입력 보존)" 로 받습니다.
 * 그래서 어떤 실패에서도 사용자가 쓴 내용은 서버가 아니라 화면이 들고 있습니다.
 *
 * `409 duplicate` 만 예외입니다 — 다시 시도해도 결과가 같은 유일한 실패라서, 화면은 시트를
 * 닫고 "이미 남기셨다" 는 안내로 바꿉니다(`lib/review.ts` §"한 기기는 한 장소에 한 번").
 */

import { NextResponse } from "next/server";

import { PlaceError, isUuid, loadPlaceReviews } from "@/lib/place";
import { consume, limitHeaders, limitResponseBody } from "@/lib/ratelimit";
import { ReviewError, createReview, hasDeviceReview, parseReview } from "@/lib/review";

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
  request: Request,
  context: { params: Promise<{ placeId: string }> },
) {
  const { placeId } = await context.params;

  if (!isUuid(placeId)) {
    return NextResponse.json(
      { ok: false, reason: "not_found", message: "찾을 수 없는 장소입니다." },
      { status: 404, headers: NO_STORE },
    );
  }

  // `?author=` 는 "이 기기가 이미 남겼는가" 를 묻는 자리입니다. 기기마다 답이 다르므로
  // 이때만 캐시를 끕니다 — 목록만 달라고 한 요청은 지금까지처럼 1분 캐시를 씁니다.
  const author = new URL(request.url).searchParams.get("author");

  try {
    const reviews = await loadPlaceReviews(placeId);

    if (author === null) {
      return NextResponse.json({ ok: true, reviews }, { status: 200, headers: LIST_CACHE });
    }

    const mine = await hasDeviceReview(placeId, author);
    return NextResponse.json({ ok: true, reviews, mine }, { status: 200, headers: NO_STORE });
  } catch (e) {
    return failure(e);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ placeId: string }> },
) {
  const { placeId } = await context.params;

  // 후기 행은 보존 정책(④ §5.7)의 만료 대상이 **아닙니다** — 한 번 쌓이면 사람이 지워야
  // 하는, `places` `pending` 행과 같은 성격의 자원입니다. 유일한 방어이던 부분 유니크
  // 인덱스는 `author_ref` 가 브라우저 생성 값이라 값을 바꾸면 통과하므로, 주소 단위
  // 상한을 함께 겁니다(④ §11.3 `DF-4` · `R-15`).
  const limit = await consume("review", request);
  if (!limit.allowed) {
    return NextResponse.json(limitResponseBody(limit), {
      status: 429,
      headers: { ...NO_STORE, ...limitHeaders(limit) },
    });
  }

  if (!isUuid(placeId)) {
    return NextResponse.json(
      { ok: false, reason: "not_found", message: "찾을 수 없는 장소예요." },
      { status: 404, headers: { ...NO_STORE, ...limitHeaders(limit) } },
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
      { status: 400, headers: { ...NO_STORE, ...limitHeaders(limit) } },
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

    if (outcome.kind === "duplicate") {
      return NextResponse.json(
        {
          ok: false,
          reason: "duplicate",
          message: "이미 이 장소에 기록을 남기셨어요.",
          detail: "한 장소에는 한 번만 남길 수 있어요.",
        },
        { status: 409, headers: NO_STORE },
      );
    }

    return NextResponse.json(
      { ok: true, review: outcome.review },
      { status: 200, headers: { ...NO_STORE, ...limitHeaders(limit) } },
    );
  } catch (e) {
    return failure(e);
  }
}
