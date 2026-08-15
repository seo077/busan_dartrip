/**
 * S3 결과 — "잘못된 링크" (§5.4).
 *
 * 설계 정본: `화면구성도.md` §5.4 · §5.4 주석("공유 링크 보존 기간") / `API데이터설계.md` §5.3
 *
 * 두 경우가 여기로 옵니다.
 *   · 없는 `throwId` — 주소를 잘못 옮겨 적었거나 만들어 낸 주소
 *   · 만료된 `throwId` — 결과 스냅샷은 30일만 보관합니다(`throws.expires_at`)
 *
 * 사용자에게 둘은 같은 일("이제 볼 수 없다")이므로 화면을 나누지 않습니다. 대신 §2.4 대로
 * **다음 행동**을 함께 둡니다 — 여기서 끝나지 않고 자기 다트를 던지러 갈 수 있게.
 */

import { DataSources } from "@/components/DataSources";
import { ResultNotice } from "@/components/result/ResultNotice";

export default function ResultNotFound() {
  return (
    <main className="mx-auto min-h-screen w-full max-w-lg bg-canvas text-ink">
      <ResultNotice
        title="이 다트 결과는 더 이상 볼 수 없어요"
        body="공유된 결과는 30일 동안만 남아 있어요. 대신 직접 한 번 던져 보시겠어요?"
        actionLabel="새로 던지기"
        actionHref="/"
      />
      <DataSources />
    </main>
  );
}
