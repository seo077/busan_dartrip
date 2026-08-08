/**
 * POST /api/places/:id/visit — "다녀왔어요" 한 번 (`AD-21` · `D-46-6`).
 *
 * 설계 정본: `API데이터설계.md` §8(Route 목록) · §5.3.1(방문 겸용) · §5.8(값을 정하는 자리는 서버)
 *            `화면구성도.md` §14.6(S4 시트의 변화) · §15(스탬프판)
 *
 * 신원을 브라우저에서 받지 않습니다
 * -------------------------------
 * `author_ref` 는 **세션에서 읽습니다**(④ §5.8 r12). 브라우저가 보낸 값을 그대로 믿으면
 * 아무나 남의 계정으로 방문을 남길 수 있습니다. 그래서 이 경로에는 `authorRef` 입력 자체가
 * 없습니다 — 받을 자리를 두지 않는 것이 가장 확실합니다.
 *
 * 이미 있으면 성공입니다
 * ---------------------
 * 방문은 있거나 없거나이지 여러 번 세는 값이 아닙니다(`AD-21`). 이미 행이 있으면 **손대지
 * 않고 `ok: true`** 로 답합니다 — 후기를 먼저 쓴 사람의 행을 여기서 비우면 그 후기가
 * 사라지고, 사용자 입장에서도 "이미 눌렸다" 는 실패가 아닙니다.
 *
 * 상한은 후기와 **같은 카운터**를 씁니다 (④ §8 — "`POST …/reviews` 와 같은 값").
 * 값이 같아서가 아니라 **만드는 행이 같은 표의 같은 성격**이기 때문입니다.
 *
 * 응답
 *   200 { ok: true, created: boolean }
 *   401 { ok: false, reason: "unauthorized", message }
 *   404 { ok: false, reason: "not_found", message }
 *   429 { ok: false, reason: "rate_limited", ... }
 *   200 { ok: false, reason: "missing_config", ... } / 502 { ok: false, reason: "db_error", ... }
 */

import { NextResponse } from "next/server";

import { readCurrentUser } from "@/lib/auth";
import { isUuid } from "@/lib/place";
import { consume, limitHeaders, limitResponseBody } from "@/lib/ratelimit";
import { VisitError, recordVisit } from "@/lib/visit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(
  request: Request,
  context: { params: Promise<{ placeId: string }> },
) {
  const user = await readCurrentUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, reason: "unauthorized", message: "로그인하면 다녀온 곳이 스탬프로 모여요." },
      { status: 401, headers: NO_STORE },
    );
  }

  const limit = await consume("review", request);
  if (!limit.allowed) {
    return NextResponse.json(limitResponseBody(limit), {
      status: 429,
      headers: { ...NO_STORE, ...limitHeaders(limit) },
    });
  }

  const { placeId } = await context.params;
  if (!isUuid(placeId)) {
    return NextResponse.json(
      { ok: false, reason: "not_found", message: "찾을 수 없는 장소예요." },
      { status: 404, headers: NO_STORE },
    );
  }

  try {
    const outcome = await recordVisit(placeId, user.authorRef);

    if (outcome.kind === "not_found") {
      return NextResponse.json(
        { ok: false, reason: "not_found", message: "찾을 수 없는 장소예요." },
        { status: 404, headers: NO_STORE },
      );
    }

    return NextResponse.json(
      { ok: true, created: outcome.kind === "created" },
      { status: 200, headers: { ...NO_STORE, ...limitHeaders(limit) } },
    );
  } catch (e) {
    if (e instanceof VisitError) {
      const status = e.reason === "missing_config" ? 200 : 502;
      return NextResponse.json(
        { ok: false, reason: e.reason, message: e.message, detail: e.detail },
        { status, headers: NO_STORE },
      );
    }
    return NextResponse.json(
      { ok: false, reason: "unknown", message: "기록하지 못했어요." },
      { status: 500, headers: NO_STORE },
    );
  }
}
