/**
 * GET /api/cron/sync — 증분 동기화 (매일 1회, D-6 · D-15).
 *
 * 설계 정본: `API데이터설계.md` §6.3(파이프라인) · §6.4(실행 시간 U-7) · §6.5(실패 알림 DF-2)
 *            §2(키 관리) · §11(DF-1)
 *
 * 이 경로가 하는 일은 `lib/sync.ts` 에 있습니다. 여기서는 **누가 불렀는지 확인하는 일**과
 * **어떤 경우에도 크론 스케줄러에게 답을 돌려주는 일** 두 가지만 맡습니다.
 *
 * 실행 시각 — 왜 `0 20 * * *` 인가 (D-44)
 * ---------------------------------------
 * **공사 콘텐츠 동기화가 04:00 에 돌므로 04:30 이후에 호출합니다** (`D-44`,
 * `tourapi@knto.or.kr` 회신 2026-08-06 — "국문 관광정보는 오전 4:30 이후 동기화 가능").
 * 그 전에 부르면 **그 날 갱신분이 빠진 데이터를 받습니다.**
 *
 * **다만 그것이 영구 누락은 아닙니다 (2026-08-06 정정).** 앞선 회차 주석은 "커서가 지나간
 * 날짜를 다시 짚지 않으므로 빠진 분이 따라오지 않는다" 고 적었는데 **틀렸습니다.**
 * `lib/sync.ts` 의 `dateRange(from, today)` 가 **커서 날짜를 포함**하므로 다음 실행이 같은
 * 날짜를 다시 짚습니다 — **최대 하루 지연이지 유실이 아닙니다.**
 *
 * **그럼에도 이 시각 결정(`D-44-3`)은 그대로 유효합니다.** 틀린 것은 위험의 크기이지 시각
 * 판단이 아닙니다 — 05시대로 두면 그 날 것이 그 날 담기고, 04시대면 하루 늦게 담깁니다.
 * 심사 기간에 하루 낡은 데이터로 서 있을 이유가 없습니다.
 *
 * **분이 아니라 시(hour)를 옮긴 이유** — Hobby 플랜의 크론은 **지정 시각이 든 한 시간 안
 * 어디선가** 발화하고 분 단위는 지켜지지 않습니다(`README` §크론 표 · `U-7`). 그래서
 * `40 19 * * *`(04:40 KST) 로 적어도 실제 창은 **04:00~05:00 KST** 여서 04:30 이전 발화가
 * 그대로 남습니다. `0 20 * * *` 은 창이 **05:00~06:00 KST** 라 04:30 이후가 보장됩니다.
 *
 * **이 값을 되돌리지 마십시오.** 앞선 값 `0 19 * * *`(창 04:00~05:00 KST)는 공사 안내를 모르고
 * 잡은 것이며, 관측된 성공(2026-08-06 04:31:26 KST)은 그 창 안에서 우연히 04:30 을 넘긴 것이지
 * 스케줄이 보장한 값이 아니었습니다. 본 시각은 **로컬 서버 저장 신청서의 「동기화 계획」에
 * 그대로 기재**되므로 신청서와 어긋나면 승인 뒤에 문제가 됩니다. 정본 = ④ `API데이터설계.md`
 * §6.3.
 *
 * 하루가 늦춰지는 대가는 없습니다 — 하루 1회 증분이라 05시대 수집이나 04시대 수집이나
 * 그 날 안에 반영되는 것은 같습니다.
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
