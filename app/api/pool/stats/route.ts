/**
 * GET /api/pool/stats — 구·군 × 테마 후보 건수 (S1).
 *
 * 설계 정본: `API데이터설계.md` §8(Route 목록, 캐시 5분) · §7.2(빈 조합 처리)
 *            `화면구성도.md` §3.2-3·§3.2-4
 *
 * S1 이 **0건 조합의 던지기 버튼을 미리 비활성**하는 데 쓰는 유일한 입력입니다.
 * 외부 API 호출은 없습니다(D-6).
 *
 * 응답
 *   { ok: true, sigungu: [...], totals: {...}, updatedAt }
 *   { ok: false, reason: "missing_config" | "db_error", message }
 */

import { NextResponse } from "next/server";
import { DartError, loadPoolStats } from "@/lib/dart";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const stats = await loadPoolStats();
    return NextResponse.json(
      { ok: true, ...stats },
      {
        headers: {
          // §8 — 5분. 집계표는 트리거로 갱신되므로 짧게 둡니다.
          "Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=60",
        },
      },
    );
  } catch (e) {
    if (e instanceof DartError) {
      // 설정 미완은 서버 장애가 아닙니다. 화면이 안내를 띄울 수 있게 200 으로 돌려줍니다.
      const status = e.reason === "missing_config" ? 200 : 502;
      return NextResponse.json(
        { ok: false, reason: e.reason, message: e.message, detail: e.detail },
        { status, headers: { "Cache-Control": "no-store" } },
      );
    }
    return NextResponse.json(
      {
        ok: false,
        reason: "unknown",
        message: e instanceof Error ? e.message : "알 수 없는 오류입니다.",
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
