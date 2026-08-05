/**
 * 알림 발송 — 웹훅 한 갈래 (DF-2).
 *
 * 설계 정본: `API데이터설계.md` §6.5(실패 알림 — "메일 또는 메신저 웹훅") · §2(키 관리)
 *            `ARCHITECTURE.md` `R-4` · `SC-7`
 *
 * 메일이 아니라 웹훅인 이유
 * ------------------------
 * §6.5 는 "메일 또는 메신저 웹훅" 으로 열어 두었습니다. 메일은 발송 서비스 계정과 도메인
 * 인증이 따라붙는데, 그 둘 다 무료 티어에서 심사 기간까지 유지된다는 보장이 없습니다.
 * 웹훅은 받는 쪽(디스코드·슬랙)에서 주소 하나를 만들면 끝이고 서버는 POST 한 번만 합니다.
 *
 * 한 번에 두 서비스 모양으로 보냅니다
 * ----------------------------------
 * 디스코드는 `content`, 슬랙은 `text` 를 읽습니다. 둘 다 모르는 키는 무시하므로 **같은 본문을
 * 두 키에 담아** 한 번만 보냅니다. 받는 쪽이 어느 쪽이든 주소만 넣으면 동작합니다.
 *
 * 주소가 없으면 조용히 넘어갑니다
 * ------------------------------
 * `ALERT_WEBHOOK_URL` 이 비어 있으면 발송을 건너뛰고 `skipped` 를 돌려줍니다. **동기화
 * 자체를 실패시키지 않습니다** — 알림은 관측 수단이지 파이프라인의 일부가 아니고, 여기서
 * 예외를 던지면 알림이 없다는 이유로 DF-1(매일 DB 쓰기)까지 무너집니다.
 *
 * 같은 이유로 발송 실패도 삼킵니다. 다만 무슨 일이 있었는지는 `sync_runs.error_message` 의
 * 한 줄에 함께 남으므로(`lib/sync.ts`), "알림을 보냈어야 했는데 못 보냈다" 가 기록에서
 * 사라지지는 않습니다.
 */

import "server-only";

/** 발송이 오래 매달리지 않게 합니다. 크론 시간 예산(§6.4) 안에서 도는 코드입니다 */
const TIMEOUT_MS = 5_000;

export type AlertOutcome = "sent" | "skipped" | "failed";

function webhookUrl(): string | null {
  const raw = process.env.ALERT_WEBHOOK_URL?.trim();
  if (!raw) return null;
  return /^https:\/\//i.test(raw) ? raw : null;
}

/** 주소가 채워져 있는지. 상태 경로가 "알림이 설정돼 있는가" 를 함께 알려 줄 때 씁니다 */
export function hasAlertChannel(): boolean {
  return webhookUrl() !== null;
}

/**
 * 한 건 보냅니다. 제목 한 줄 + 본문 여러 줄.
 *
 * 어떤 경우에도 예외를 던지지 않습니다 — 호출측이 try 로 감쌀 필요가 없게 합니다.
 */
export async function sendAlert(title: string, lines: string[] = []): Promise<AlertOutcome> {
  const url = webhookUrl();
  if (!url) return "skipped";

  const body = [`**부산 Dartrip — ${title}**`, ...lines].join("\n");

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // 디스코드는 content, 슬랙은 text 를 읽습니다. 모르는 키는 서로 무시합니다.
      body: JSON.stringify({ content: body, text: body }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));

    return response.ok ? "sent" : "failed";
  } catch {
    return "failed";
  }
}
