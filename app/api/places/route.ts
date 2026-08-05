/**
 * POST /api/places — 장소 등록 (S5).
 *
 * 설계 정본: `API데이터설계.md` §8(Route 목록 — "장소 등록(S5), 역지오코딩") · §5.8(RLS)
 *            `화면구성도.md` §7.3(입력 규칙) · §7.4(상태) / `D-8`(간이판) · `D-9`(로그인 없음)
 *
 * 이 경로로 들어온 행은 예외 없이 `source='user'` · `status='pending'` 입니다. 상태는 요청이
 * 고를 수 있는 값이 아니라 `lib/submit.ts` 가 상수로 넣는 값입니다. 승인은 사람이 Supabase
 * 콘솔에서 `status` 를 바꾸는 것으로만 일어납니다(`D-8` — v1 에 승인 화면은 없습니다).
 *
 * 브라우저가 Supabase 에 직접 쓰지 않는 이유는 §5.8 에 있습니다 — 부산 경계·길이·중복·이미지
 * 검사가 서버에 있어야 우회되지 않기 때문입니다. RLS 에 `places` 쓰기 정책이 없는 것과
 * 이 Route 가 service_role 로 쓰는 것이 한 쌍입니다.
 *
 * 요청
 *   { name, theme, lat, lng, note?, photoUrl?, submittedBy?, allowDuplicate? }
 * 몇 건까지 받는가 (DF-4)
 * -----------------------
 * 이 경로로 들어온 행은 사람이 콘솔에서 승인할 때까지 `pending` 으로 남습니다(`D-8`). 승인
 * 전이라 다트에는 안 나오지만 **DB 행은 이미 만들어졌고 지우려면 사람이 지워야 합니다.**
 * 되돌아오지 않는 자원이라 주소 단위 상한을 겁니다(`lib/ratelimit.ts`).
 *
 * 응답
 *   200 { ok: true,  placeId, sigunguName }
 *   200 { ok: false, reason: "duplicate", duplicates: [...] }   ← 안내 (§7.3, 자동 차단 아님)
 *   400 { ok: false, reason: "invalid", field, message }
 *   429 { ok: false, reason: "rate_limited", retryAfter }
 *   200 { ok: false, reason: "missing_config", ... } / 502 { ok: false, reason: "db_error", ... }
 */

import { NextResponse } from "next/server";

import { consume, limitHeaders, limitResponseBody } from "@/lib/ratelimit";
import { parseSubmission, submitPlace, SubmitError } from "@/lib/submit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  // DF-4 — 본문을 읽기 전에 봅니다.
  const limit = await consume("place_submit", request);
  if (!limit.allowed) {
    return NextResponse.json(limitResponseBody(limit), {
      status: 429,
      headers: { ...NO_STORE, ...limitHeaders(limit) },
    });
  }

  let body: unknown = {};
  try {
    const text = await request.text();
    body = text ? JSON.parse(text) : {};
  } catch {
    return NextResponse.json(
      { ok: false, reason: "bad_request", message: "요청 형식이 올바르지 않습니다." },
      { status: 400, headers: NO_STORE },
    );
  }

  const parsed = parseSubmission(body);
  if (!parsed.ok) {
    return NextResponse.json(
      { ok: false, reason: "invalid", field: parsed.field, message: parsed.message },
      // 상한 판정이 실제로 섰는지를 여기서도 드러냅니다 — 형식 오류 한 번으로 확인할 수
      // 있으면 "조용히 뚫려 있는 상태"를 부작용 없이 점검할 수 있습니다.
      { status: 400, headers: { ...NO_STORE, ...limitHeaders(limit) } },
    );
  }

  try {
    const outcome = await submitPlace(parsed.input);

    if (outcome.kind === "duplicate") {
      return NextResponse.json(
        { ok: false, reason: "duplicate", duplicates: outcome.duplicates },
        { status: 200, headers: NO_STORE },
      );
    }

    if (outcome.kind === "rejected") {
      return NextResponse.json(
        { ok: false, reason: "invalid", field: outcome.field, message: outcome.message },
        { status: 400, headers: NO_STORE },
      );
    }

    return NextResponse.json(
      { ok: true, placeId: outcome.placeId, sigunguName: outcome.sigunguName },
      { status: 200, headers: { ...NO_STORE, ...limitHeaders(limit) } },
    );
  } catch (e) {
    if (e instanceof SubmitError) {
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
}
