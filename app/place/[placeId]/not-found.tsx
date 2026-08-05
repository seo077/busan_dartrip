/**
 * S4 — "찾을 수 없는 장소" (§6.4).
 *
 * 설계 정본: `화면구성도.md` §6.4("미존재" · "미승인") · §2.4(공통 상태 처리 원칙)
 *
 * 두 경우가 여기로 옵니다.
 *   · 없는 `placeId` — 주소를 잘못 옮겨 적었거나 만들어 낸 주소
 *   · 아직 승인되지 않았거나 미분류로 보관 중인 장소 — 등록자 본인이 열어도 같습니다
 *
 * 사용자에게 둘은 같은 일이라 화면을 나누지 않습니다. 대신 다음 행동을 함께 둡니다.
 */

import { DataSources } from "@/components/DataSources";
import { ResultNotice } from "@/components/result/ResultNotice";

export default function PlaceNotFound() {
  return (
    <main className="mx-auto min-h-screen w-full max-w-lg bg-[#0E1116] text-[#F2F4F7]">
      <ResultNotice
        title="찾을 수 없는 장소예요"
        body="주소가 바뀌었거나 아직 공개되지 않은 곳일 수 있어요. 대신 한 번 던져 보시겠어요?"
        actionLabel="다트 던지러 가기"
        actionHref="/"
      />
      <DataSources />
    </main>
  );
}
