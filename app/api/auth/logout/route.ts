/**
 * POST /api/auth/logout — 세션 쿠키 파기.
 *
 * 설계 정본: `API데이터설계.md` §8 · `화면구성도.md` §14.5(로그아웃은 §15 안에) · §15.5
 *
 * 상한을 걸지 않습니다 — **자기 세션만 지우는 일**이라 소모되는 자원이 없습니다(④ §8 상한 열 `—`).
 * 실패해도 `ok: true` 로 답합니다: 사용자가 나가겠다고 한 자리에서 "못 나갔다" 는 답은
 * 아무 쓸모가 없고, 화면은 어차피 S1 로 갑니다(§15.5).
 */

import { NextResponse } from "next/server";

import { authReady, getSessionClient } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST() {
  if (authReady()) {
    try {
      const supabase = await getSessionClient();
      await supabase.auth.signOut();
    } catch {
      // 위 머리말 — 나가는 길을 막지 않습니다.
    }
  }
  return NextResponse.json({ ok: true }, { status: 200, headers: NO_STORE });
}
