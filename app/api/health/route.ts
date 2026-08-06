/**
 * GET /api/health — 밖에서 볼 수 있는 상태 경로 (DF-2 3행).
 *
 * 설계 정본: `API데이터설계.md` §6.5(실패 알림 — "크론 자체가 미실행") · §8(Route 목록)
 *            §11(DF-2) · §11.2(심사 기간 점검 — "`sync_runs` 최근 성공이 48시간 이내인가")
 *            `ARCHITECTURE.md` `R-4` · `SC-7`
 *
 * 이 경로가 있는 이유 — 앱은 자기가 멈춘 것을 못 봅니다
 * -----------------------------------------------------
 * §6.5 의 3행("크론 자체가 미실행")은 **앱 안 코드로는 원리적으로 잡히지 않습니다.** 크론이
 * 안 돌면 그 안에 넣어 둔 감시 코드도 함께 안 돕니다. 밖에서 주기적으로 찌르는 무언가가
 * 있어야 하고, 그 무언가가 볼 창구가 이 경로입니다.
 *
 * **판정을 감시 도구에 맡기지 않고 여기서 냅니다.** 무료 uptime 감시 서비스는 대개 "응답
 * 코드가 200 이 아니면 알린다" 한 가지만 할 줄 압니다. 그래서 마지막 성공이 48시간을 넘으면
 * 이 경로가 **503** 을 돌려줍니다 — 서비스는 살아 있지만 동기화가 멈춘 상태를, 도구가 아는
 * 유일한 언어로 번역해 주는 자리입니다.
 *
 * 응답 코드
 * ---------
 *   200  마지막 성공이 48시간 이내
 *   503  성공 이력이 48시간을 넘었거나 아예 없음 / 설정 미완 / DB 조회 실패
 *
 * **모르는 상태를 200 으로 돌려주지 않습니다.** 감시가 조용해지는 쪽이 헛알림보다 나쁩니다.
 *
 * 부수 효과 하나 — 이 경로는 `sync_runs` 를 읽습니다. 밖에서 주기적으로 찌르면 그만큼
 * DB 에 접근이 일어나므로 `D-15`(7일 무활동 정지) 방어에 겹이 하나 더 붙습니다. 노린 것은
 * 아니지만 방향이 같습니다.
 *
 * 이 경로는 비밀을 담지 않습니다 — 인증을 걸지 않는 것이 목적입니다. 감시 서비스에 자격증명을
 * 넣게 하면 그 자체가 새 관리 대상이 됩니다.
 */

import { NextResponse } from "next/server";

import { hasAlertChannel } from "@/lib/alert";
import { STALE_AFTER_HOURS, readSyncHealth } from "@/lib/health";
import { readBuildInfo } from "@/lib/version";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET() {
  const health = await readSyncHealth();
  const healthy = health.known && !health.stale;
  const info = readBuildInfo();

  return NextResponse.json(
    {
      ok: healthy,
      // 어느 커밋이 답하고 있는지 (D-48-2 · X-42). 여기는 감시 경로라 7자만 싣고,
      // 크론 스케줄까지 필요하면 `/api/version` 을 봅니다.
      build: { commit: info.commitShort, ref: info.ref, source: info.source },
      // 무엇을 보고 판정했는지 그대로 드러냅니다 — 알림을 받은 사람이 다음 행동을 고르는 자리입니다.
      check: "sync_runs 마지막 성공 시각",
      staleAfterHours: STALE_AFTER_HOURS,
      sync: {
        known: health.known,
        reason: health.reason,
        lastSuccessAt: health.lastSuccessAt,
        hoursSinceSuccess: health.hoursSinceSuccess,
        stale: health.stale,
        consecutiveFailures: health.consecutiveFailures,
        lastRunAt: health.lastRunAt,
        lastRunStatus: health.lastRunStatus,
        lastRunNote: health.lastRunNote,
      },
      // 알림 주소가 비어 있으면 크론 쪽 겹(2일 연속 실패)이 서 있지 않다는 뜻입니다.
      alertChannel: hasAlertChannel(),
      message: healthy
        ? "동기화가 정상 범위입니다."
        : health.known
          ? `동기화 마지막 성공이 ${STALE_AFTER_HOURS}시간을 넘었습니다.`
          : "동기화 상태를 확인할 수 없습니다.",
    },
    { status: healthy ? 200 : 503, headers: NO_STORE },
  );
}
