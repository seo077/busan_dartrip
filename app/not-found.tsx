/**
 * 루트 「없는 주소」 안내 (2026-08-17 신설 · `AL-1`).
 *
 * 설계 정본: ② `화면구성도.md` §12.2(이 화면의 자리 판단) · §2.1(하단 출처 표기) · §2.4(공통 상태 처리)
 *            `D-61-3`(밝은 화면 고정) · `D-61-1`(팔레트 「감천」)
 *
 * 어떤 주소가 여기로 오는가
 * -------------------------
 * 라우트에 없는 주소 전부입니다 — 오타(`/mypage`), 옛 공유 링크, 만들어 낸 경로.
 * 세그먼트 안에서 `notFound()` 로 떨어지는 두 자리(`/result/[throwId]` · `/place/[placeId]`)는
 * 각자 자기 `not-found.tsx` 가 받으므로 여기로 오지 않습니다.
 *
 * 왜 이 파일을 만들었는가
 * -----------------------
 * 이 파일이 없으면 Next.js **기본 404 화면**이 나갑니다. 그 화면은 우리 규약 셋 중 어느
 * 것에도 걸리지 않았습니다 — 자기 인라인 스타일에
 *
 *   `@media (prefers-color-scheme: dark){ body{ color:#fff; background:#000 } }`
 *
 * 를 얹어 **다크 선호 기기에서 검은 바탕**이 되고(`D-61-3` 「밝은 화면 고정」과 반대),
 * 본문이 **영문 한 줄**이며, **데이터 출처 표기가 0건**이고, 돌아갈 링크도 없습니다.
 * 루트 레이아웃(`app/layout.tsx`)은 적용돼 `<html lang="ko">` 까지는 붙지만, 프레임워크가
 * 자기 스타일을 나중에 얹으므로 레이아웃만으로는 밝은 쪽이 되지 않습니다.
 *
 * **우리가 만든 화면 한 장을 두면 그 인라인 스타일 자체가 나가지 않습니다.** 바탕은
 * `globals.css` 의 `--canvas`(`#FFF8F0`), 글자는 `--ink` 이고 `color-scheme: light` 가
 * 그대로 걸립니다.
 *
 * 화면으로 세지 않습니다 (② §12.2)
 * --------------------------------
 * 번호(`S1`~)를 붙이지 않는 판단과 그 근거는 ② §12.2에 적었습니다 — `/offline`(§12.1)과 같은
 * 자리입니다. **다만 하단 데이터 출처 표기는 붙입니다**: 화면 단위 규약이 원리적으로 걸리지
 * 않더라도 **사용자가 실제로 보는 공개 화면**인 것은 같습니다.
 */

import type { Metadata } from "next";

import { DataSources } from "@/components/DataSources";
import { ResultNotice } from "@/components/result/ResultNotice";

export const metadata: Metadata = {
  title: "없는 주소예요 — 부산 Dartrip",
  description: "찾으시는 주소가 없습니다. 처음 화면에서 다시 시작해 주세요.",
};

export default function NotFound() {
  return (
    <main className="mx-auto min-h-screen w-full max-w-lg bg-canvas text-ink">
      <ResultNotice
        title="없는 주소예요"
        body="주소가 바뀌었거나 잘못 입력됐을 수 있어요. 처음 화면에서 다시 던져 보시겠어요?"
        actionLabel="처음 화면으로"
        actionHref="/"
      />
      <DataSources />
    </main>
  );
}
