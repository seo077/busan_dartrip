/**
 * 배포본이 자기 신원을 밝히는 자리 — 어느 커밋이 지금 서 있는가 (D-48-2 · X-42).
 *
 * 설계 정본: `ARCHITECTURE.md` §3 `AD-18` · `API데이터설계.md` §8(Route 목록)
 *
 * 왜 필요한가
 * -----------
 * 검증 기준 `LV-11`(필수)은 **"판정한 코드가 곧 배포본인가"** 를 묻습니다. 그런데 배포본이
 * 자기 커밋을 밝히지 않으면 그 대응을 **밖에서 추론**할 수밖에 없습니다. 직전 회차는 로컬
 * 빌드 산출물과 배포본 청크를 **바이트로 대조**해 세웠는데, 그 방법에는 구멍이 둘 있습니다 —
 *
 *   ① **컴파일에서 사라지는 변경**(주석만 고친 커밋)은 산출물이 같아 구분되지 않습니다.
 *   ② **번들 밖 설정**(`vercel.json` 의 크론 스케줄)은 애초에 청크에 들어가지 않습니다.
 *
 * 실제로 크론 시각을 `0 19` → `0 20` 으로 옮긴 커밋의 배포 반영을 그 방법으로는 확인하지
 * 못했습니다. 그래서 **필수 항목이 매 회차 판정 불가가 되는 것**이 문제였고, 이 모듈이
 * 그 자리를 메웁니다.
 *
 * 무엇을 밝히고 무엇을 감추는가 (노출 범위 판단)
 * ---------------------------------------------
 * 밝히는 것 = **커밋 해시 · 브랜치 · 배포 식별자 · 환경 · 등록된 크론 스케줄**.
 * 감추는 것 = **커밋 메시지 · 작성자 이름·계정**. 앞의 것들은 "무엇이 서 있는가" 를 가리는 데
 * 필요하지만, 뒤의 것들은 필요가 없고 사람에 관한 값입니다. 커밋 해시 자체는 저장소 내용을
 * 알려 주지 않고, 배포 식별자는 이미 Vercel 응답 헤더로 밖에 나가 있습니다.
 *
 * **크론 스케줄을 함께 싣는 것이 이 모듈의 실질입니다** — 위 구멍 ②를 덮는 유일한 값이며,
 * 크론 경로 자체는 `CRON_SECRET` 으로 막혀 있어 시각을 안다고 부를 수 있는 것이 아닙니다.
 *
 * 값의 출처
 * ---------
 * Vercel 이 빌드·실행 때 자동으로 넣어 주는 시스템 환경변수를 읽습니다(우리가 설정할 것이
 * 없습니다). 크론 스케줄만은 환경변수가 아니라 **배포본에 실린 `vercel.json` 을 그대로
 * 읽습니다** — Vercel 이 크론을 등록할 때 본 파일과 같은 파일이라, 이 값이 곧 "이 배포에
 * 등록된 스케줄" 입니다.
 *
 * 로컬(`npm run dev`)에서는 그 환경변수가 없으므로 `source: "local"` 로 답하고 커밋은
 * `null` 입니다. **모르는 것을 아는 척하지 않습니다** — 값이 비어 있다는 사실 자체가
 * "이건 배포본이 아니다" 라는 답입니다.
 *
 * 빌드 시각은 일부러 담지 않습니다 — 같은 커밋을 다시 빌드하면 값이 달라져, 위에서 말한
 * **바이트 대조라는 보조 수단을 우리 손으로 깨뜨리게** 됩니다. 두 수단을 함께 남깁니다.
 */

import vercelConfig from "@/vercel.json";

export type CronEntry = {
  path: string;
  schedule: string;
};

export type BuildInfo = {
  /** `vercel` 이면 배포본, `local` 이면 개발 기기에서 돌고 있는 것입니다 */
  source: "vercel" | "local";
  /** 40자 커밋 해시. 로컬에서는 `null` */
  commit: string | null;
  /** 사람이 눈으로 대조하기 위한 7자 */
  commitShort: string | null;
  /** 브랜치 이름 */
  ref: string | null;
  /** Vercel 배포 식별자 (`dpl_…`) */
  deploymentId: string | null;
  /** `production` / `preview` / `development` */
  env: string | null;
  /** 이 배포에 등록된 크론. `vercel.json` 원본 그대로입니다 */
  crons: CronEntry[];
};

function clean(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** `vercel.json` 의 `crons` 를 읽습니다. 없으면 빈 배열입니다(크론을 두지 않은 배포). */
function readCrons(): CronEntry[] {
  const crons = (vercelConfig as { crons?: CronEntry[] }).crons;
  if (!Array.isArray(crons)) return [];
  return crons.map((c) => ({ path: c.path, schedule: c.schedule }));
}

export function readBuildInfo(): BuildInfo {
  // `APP_COMMIT_SHA` 는 Vercel 이 아닌 곳에 올릴 때를 위한 뒷문입니다. 지금은 쓰지 않습니다.
  const commit = clean(process.env.VERCEL_GIT_COMMIT_SHA) ?? clean(process.env.APP_COMMIT_SHA);

  return {
    source: clean(process.env.VERCEL) ? "vercel" : "local",
    commit,
    commitShort: commit ? commit.slice(0, 7) : null,
    ref: clean(process.env.VERCEL_GIT_COMMIT_REF),
    deploymentId: clean(process.env.VERCEL_DEPLOYMENT_ID),
    env: clean(process.env.VERCEL_ENV),
    crons: readCrons(),
  };
}
