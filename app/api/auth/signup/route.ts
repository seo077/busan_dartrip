/**
 * POST /api/auth/signup — 가입 (`AD-19` · `D-46-4`).
 *
 * 설계 정본: `API데이터설계.md` §8(Route 목록) · §11.4(`DF-5` 상한) · `화면구성도.md` §14.3·§14.7
 *            `ARCHITECTURE.md` `AD-19`·`R-18`
 *
 * 화면은 아이디만 보내고, `lib/auth.ts` 가 고정 도메인을 붙여 Supabase Auth 로 넘깁니다.
 * **사용자 눈에 이메일은 없고 메일도 0통**입니다.
 *
 * 상한을 `place_submit` 보다 조인 이유 — `auth.users` 행은 보존 정책(④ §5.7)의 만료 대상이
 * **아니어서 회복되지 않습니다.** 정상 이용자가 한 시간에 계정을 다섯 개 만들 이유도 없습니다.
 *
 * 가입 직후 바로 로그인시킵니다
 * ----------------------------
 * Supabase 설정에 따라 `signUp` 이 세션을 주기도 하고 안 주기도 합니다(확인 메일 여부).
 * **어느 쪽이든 화면은 §14.8 대로 스탬프판으로 가야 하므로**, 가입 뒤 같은 자격으로 한 번
 * 더 로그인해 세션을 확실히 만듭니다. 그래도 세션이 안 서면 그 사실을 그대로 답합니다 —
 * 지어내지 않습니다.
 *
 * 응답
 *   200 { ok: true }
 *   400 { ok: false, reason: "invalid", field, message }
 *   409 { ok: false, reason: "duplicate", message }
 *   429 { ok: false, reason: "rate_limited", ... }
 *   200 { ok: false, reason: "unavailable" | "needs_confirmation", message }
 */

import { NextResponse } from "next/server";

import { authReady, checkCredentials, getSessionClient, toAuthEmail } from "@/lib/auth";
import { consume, limitHeaders, limitResponseBody } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/** Supabase 가 "이미 있는 계정" 을 알리는 방식이 판본마다 조금씩 다릅니다 */
function isAlreadyRegistered(message: string, code?: string): boolean {
  if (code === "user_already_exists" || code === "email_exists") return true;
  const lower = message.toLowerCase();
  return lower.includes("already registered") || lower.includes("already been registered");
}

export async function POST(request: Request) {
  const limit = await consume("auth_signup", request);
  if (!limit.allowed) {
    return NextResponse.json(limitResponseBody(limit), {
      status: 429,
      headers: { ...NO_STORE, ...limitHeaders(limit) },
    });
  }

  if (!authReady()) {
    return NextResponse.json(
      { ok: false, reason: "unavailable", message: "로그인을 준비 중이에요." },
      { status: 200, headers: NO_STORE },
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

  const checked = checkCredentials(payload, { withConfirm: true });
  if (!checked.ok) {
    return NextResponse.json(
      { ok: false, reason: "invalid", field: checked.field, message: checked.message },
      { status: 400, headers: { ...NO_STORE, ...limitHeaders(limit) } },
    );
  }

  const email = toAuthEmail(checked.username);

  try {
    const supabase = await getSessionClient();

    const { error } = await supabase.auth.signUp({
      email,
      password: checked.password,
      // 화면에 보이는 아이디를 그대로 들고 있습니다. 합성 이메일에서 잘라 쓰면
      // 대소문자가 접힌 값만 남습니다(`lib/auth.ts` `toAuthEmail`).
      options: { data: { username: checked.username } },
    });

    if (error) {
      if (isAlreadyRegistered(error.message, error.code)) {
        return NextResponse.json(
          { ok: false, reason: "duplicate", message: "이미 쓰는 아이디예요." },
          { status: 409, headers: { ...NO_STORE, ...limitHeaders(limit) } },
        );
      }
      return NextResponse.json(
        { ok: false, reason: "unavailable", message: "가입하지 못했어요. 잠시 뒤 다시 시도해 주세요." },
        { status: 200, headers: NO_STORE },
      );
    }

    // 세션을 확실히 세웁니다 (위 머리말).
    const signedIn = await supabase.auth.signInWithPassword({ email, password: checked.password });
    if (signedIn.error || !signedIn.data.session) {
      return NextResponse.json(
        {
          ok: false,
          reason: "needs_confirmation",
          message: "계정은 만들어졌는데 바로 들어가지 못했어요. 로그인 화면에서 다시 시도해 주세요.",
        },
        { status: 200, headers: NO_STORE },
      );
    }

    return NextResponse.json(
      { ok: true },
      { status: 200, headers: { ...NO_STORE, ...limitHeaders(limit) } },
    );
  } catch {
    return NextResponse.json(
      { ok: false, reason: "unavailable", message: "가입하지 못했어요. 잠시 뒤 다시 시도해 주세요." },
      { status: 200, headers: NO_STORE },
    );
  }
}
