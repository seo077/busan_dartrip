/**
 * GET /api/version — 이 배포본이 어느 커밋인지 (D-48-2 · X-42).
 *
 * 설계 정본: `API데이터설계.md` §8(Route 목록) · `ARCHITECTURE.md` §3 `AD-18`
 *            판단 근거·노출 범위는 `lib/version.ts` 머리말에 있습니다.
 *
 * 쓰는 법
 * -------
 *   curl -s {배포주소}/api/version
 *   → 로컬 저장소의 `git rev-parse HEAD` 와 `commit` 을 맞춰 보면 끝입니다.
 *
 * `/api/health` 와 나눠 둔 이유 — health 는 **밖에서 5~15분마다 찌르는 감시 경로**라 몸집을
 * 작게 유지해야 하고, 판정도 "동기화가 살아 있는가" 하나만 냅니다. 여기는 대조용이라 크론
 * 스케줄까지 다 폅니다. 대신 health 에도 커밋 7자만 얹어 두었으므로, 감시 화면만 보고 있어도
 * "지금 뭐가 서 있는지" 는 보입니다.
 *
 * **이 경로는 판정하지 않습니다.** 무엇이 서 있는지 사실만 돌려주고 200 으로 끝냅니다 —
 * 로컬에서 부르면 `source: "local"` · `commit: null` 이 정상 응답입니다.
 *
 * 인증을 걸지 않는 이유는 `/api/health` 와 같습니다 — 이 경로는 비밀을 담지 않고, 대조하는
 * 쪽에 자격증명을 쥐여 주면 그것 자체가 새 관리 대상이 됩니다.
 */

import { NextResponse } from "next/server";

import { readBuildInfo } from "@/lib/version";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const build = readBuildInfo();

  return NextResponse.json(
    {
      ok: true,
      ...build,
      // 무엇을 보고 답한 값인지 함께 적습니다 — 대조하는 사람이 다음에 뭘 볼지 고르는 자리입니다.
      note:
        build.source === "vercel"
          ? "Vercel 시스템 환경변수 + 배포본에 실린 vercel.json 입니다."
          : "배포본이 아닙니다(로컬 실행). 커밋 값은 배포 환경에서만 채워집니다.",
    },
    {
      status: 200,
      // 배포마다 값이 달라지므로 캐시하지 않습니다. 낡은 답이 돌아오면 대조가 무의미해집니다.
      headers: { "Cache-Control": "no-store" },
    },
  );
}
