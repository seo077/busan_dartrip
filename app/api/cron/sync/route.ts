/**
 * GET /api/cron/sync — 증분 동기화 (매일 1회, D-6 · D-15).
 *
 * 설계 정본: `API데이터설계.md` §6.3(파이프라인) · §6.4(실행 시간 U-7) · §6.5(실패 알림 DF-2)
 *            §2(키 관리) · §11(DF-1)
 *
 * 이 경로가 하는 일은 `lib/sync.ts` 에 있습니다. 여기서는 **누가 불렀는지 확인하는 일**과
 * **어떤 경우에도 크론 스케줄러에게 답을 돌려주는 일** 두 가지만 맡습니다.
 *
 * 왜 보호하는가
 * -------------
 * 이 경로는 외부 API 를 호출하고 DB 에 씁니다. 열려 있으면 아무나 반복 호출해
 * 관광공사 일 한도(1,000회)를 태우고 무료 티어를 압박할 수 있습니다. Vercel Cron 은
 * `Authorization: Bearer {CRON_SECRET}` 헤더를 붙여 부르므로, 그 값과 대조합니다.
 *
 * 비교는 `timingSafeEqual` 로 합니다. 문자열 `===` 는 앞에서부터 다른 글자가 나오면 즉시
 * 끝나서 응답 시간이 정답에 가까울수록 길어지고, 그 차이가 값을 한 글자씩 알려 줍니다.
 *
 * 응답 코드
 * ---------
 *   200  동기화 완료 (변경분 0건도 정상입니다 — `sync_runs` 에는 행이 남습니다)
 *   401  인증 실패
 *   500  `CRON_SECRET` 미설정 · 동기화 중 오류
 *
 * 500 을 돌려주는 이유 — Vercel 크론 로그에 실패로 남아야 §6.5 의 "2일 연속 실패" 를
 * 사람이 알아챌 수 있습니다. 200 으로 감싸면 실패가 로그에서 사라집니다.
 */

import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { SyncError, runIncrementalSync } from "@/lib/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Vercel Hobby 플랜의 함수 실행 상한이 60초입니다 (U-7).
 * `lib/sync.ts` 의 시간 예산은 이보다 짧은 40초라, 예산이 먼저 걸려 **커서를 남기고
 * 정상 종료**합니다. 상한에 그냥 잘리면 `sync_runs` 가 `running` 인 채로 남습니다.
 */
export const maxDuration = 60;

function equals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  // 길이가 다르면 timingSafeEqual 이 예외를 던집니다. 길이 자체는 비밀이 아닙니다.
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function authorize(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;

  const header = request.headers.get("authorization") ?? "";
  const bearer = /^Bearer\s+(.+)$/i.exec(header)?.[1]?.trim();
  if (bearer && equals(bearer, secret)) return true;

  // 손으로 확인할 때 쓰는 창구. 쿼리스트링은 받지 않습니다 — 주소가 로그·기록에 남습니다.
  const direct = request.headers.get("x-cron-secret")?.trim();
  return Boolean(direct && equals(direct, secret));
}

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET?.trim()) {
    return NextResponse.json(
      {
        ok: false,
        reason: "missing_secret",
        message: "CRON_SECRET 이 설정되지 않아 크론 경로를 열 수 없습니다.",
      },
      { status: 500, headers: NO_STORE },
    );
  }

  if (!authorize(request)) {
    // 무엇이 틀렸는지 알려 주지 않습니다.
    return NextResponse.json(
      { ok: false, reason: "unauthorized" },
      { status: 401, headers: NO_STORE },
    );
  }

  // 수동 확인용 스위치. 크론이 붙이지 않는 값들이며, 인증을 통과한 뒤에만 읽습니다.
  const params = new URL(request.url).searchParams;
  const dryRun = params.get("dryRun") === "1";
  const forceAudit = params.get("audit") === "1";
  const from = params.get("from") ?? undefined;

  try {
    const outcome = await runIncrementalSync({ dryRun, forceAudit, from });

    return NextResponse.json(
      { ok: outcome.status === "ok", ...outcome },
      { status: outcome.status === "ok" ? 200 : 500, headers: NO_STORE },
    );
  } catch (e) {
    if (e instanceof SyncError) {
      return NextResponse.json(
        { ok: false, reason: e.reason, message: e.message },
        { status: 500, headers: NO_STORE },
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
