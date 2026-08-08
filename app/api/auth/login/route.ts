/**
 * POST /api/auth/login — 로그인 (`AD-19`).
 *
 * 설계 정본: `API데이터설계.md` §8 · §11.4(`DF-5` — 주소 + 아이디 두 축) · `화면구성도.md` §14.7
 *
 * 어느 쪽이 틀렸는지 말하지 않습니다
 * ---------------------------------
 * 아이디가 없든 비밀번호가 틀렸든 **같은 401 · 같은 문구**입니다(§14.7). 구분해서 알려 주면
 * 그 자리가 곧 **"이 아이디가 있는지" 를 알려 주는 창구**가 됩니다. 형식이 어긋난 입력도
 * 같은 답으로 묶습니다 — 형식 오류만 다르게 답하면 그 차이로 다시 아이디의 존재를 떠볼 수
 * 있습니다.
 *
 * 두 축으로 세는 이유 (④ §11.4)
 * -----------------------------
 * 주소만 세면 **한 아이디를 여러 주소에서 두드리는 경로**가 남고, 아이디만 세면 **한 주소가
 * 여러 아이디를 훑는 경로**가 남습니다. 표도 함수도 같고 열쇠 문자열만 다릅니다.
 *
 * **상한은 비밀번호 검사 앞에 서는 문턱일 뿐입니다** — 통과했다는 것이 로그인 성공을 뜻하지
 * 않고, 상한이 서지 않아도(fail open) 틀린 비밀번호는 그대로 틀립니다.
 *
 * 응답
 *   200 { ok: true }
 *   401 { ok: false, reason: "invalid_credentials", message }
 *   429 { ok: false, reason: "rate_limited", ... }   ← §14.7 "상한 도달" — 틀린 비밀번호와 구분해 보입니다
 *   200 { ok: false, reason: "unavailable", message }
 */

import { NextResponse } from "next/server";

import { ID_PATTERN, authReady, getSessionClient, toAuthEmail } from "@/lib/auth";
import { consume, limitHeaders, limitResponseBody } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

const WRONG = {
  ok: false as const,
  reason: "invalid_credentials" as const,
  message: "아이디나 비밀번호가 맞지 않아요.",
};

export async function POST(request: Request) {
  const byAddress = await consume("auth_login", request);
  if (!byAddress.allowed) {
    return NextResponse.json(limitResponseBody(byAddress), {
      status: 429,
      headers: { ...NO_STORE, ...limitHeaders(byAddress) },
    });
  }

  if (!authReady()) {
    return NextResponse.json(
      { ok: false, reason: "unavailable", message: "로그인을 준비 중이에요." },
      { status: 200, headers: NO_STORE },
    );
  }

  let payload: Record<string, unknown> = {};
  try {
    const text = await request.text();
    payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    return NextResponse.json({ ...WRONG }, { status: 401, headers: NO_STORE });
  }

  const username = typeof payload.username === "string" ? payload.username.trim() : "";
  const password = typeof payload.password === "string" ? payload.password : "";

  // 형식이 어긋난 입력도 같은 답입니다 (위 머리말). 다만 **아이디 축을 세기 전에** 걸러
  // 냅니다 — 아무 문자열이나 카운터의 열쇠가 되면 표가 쓸데없이 부풉니다.
  if (!ID_PATTERN.test(username) || password === "" || password.length > 200) {
    return NextResponse.json({ ...WRONG }, { status: 401, headers: NO_STORE });
  }

  // 아이디 축은 값이 다릅니다 — 시간당 10 · 하루 50 (④ §11.4).
  const byId = await consume("auth_login_id", request, `id:${username.toLowerCase()}`);
  if (!byId.allowed) {
    return NextResponse.json(limitResponseBody(byId), {
      status: 429,
      headers: { ...NO_STORE, ...limitHeaders(byId) },
    });
  }

  try {
    const supabase = await getSessionClient();
    const { data, error } = await supabase.auth.signInWithPassword({
      email: toAuthEmail(username),
      password,
    });

    if (error || !data.session) {
      return NextResponse.json({ ...WRONG }, { status: 401, headers: NO_STORE });
    }

    return NextResponse.json(
      { ok: true },
      { status: 200, headers: { ...NO_STORE, ...limitHeaders(byAddress) } },
    );
  } catch {
    return NextResponse.json(
      { ok: false, reason: "unavailable", message: "로그인하지 못했어요. 잠시 뒤 다시 시도해 주세요." },
      { status: 200, headers: NO_STORE },
    );
  }
}
