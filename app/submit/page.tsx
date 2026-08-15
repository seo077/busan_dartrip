/**
 * S5 — 장소 등록.
 *
 * 설계 정본: `화면구성도.md` §7 / `API데이터설계.md` §8(`POST /api/places`)
 *            `D-8`(간이판 — 등록 폼만, 승인은 Supabase 콘솔 수동) · `D-9`(익명 기기 ID)
 *
 * 상단 바만 서버에서 그리고, 폼은 브라우저 컴포넌트입니다 — 지도·사진 줄이기·단계별 상태가
 * 전부 브라우저에서 일어나기 때문입니다(`components/submit/SubmitForm.tsx`).
 *
 * **관리자 승인 화면은 v1 에 없습니다**(`D-8` · `서비스기획서.md` §4.2 "등록 검수 화면" 제외).
 * 승인은 Supabase 콘솔에서 `places.status` 를 `published` 로 바꾸는 것으로 끝나며,
 * 그 방법은 `README.md` §6.1 에 적어 두었습니다.
 *
 * 하단 출처 표기는 **다른 화면과 같은 컴포넌트**입니다
 * ---------------------------------------------------
 * ④ §10 이 "전 화면 하단 공통 표기" 로 규정한 자리이며, 이 화면만 예외로 둘 이유가
 * 없습니다 — 폼이 세로로 이어지는 문서형 화면이라 아래에 고정 막대가 없고, 다른 다섯
 * 화면과 레이아웃 조건이 같습니다. 공공누리 출처표시는 화면 단위 의무라 **화면이
 * 늘어날 때마다 이 한 줄을 함께 넣습니다.**
 */

import { BackLink } from "@/components/place/BackLink";
import { DataSources } from "@/components/DataSources";
import { SubmitForm } from "@/components/submit/SubmitForm";

export const metadata = {
  title: "장소 등록 — 부산 Dartrip",
  description: "공공데이터에 없는 부산의 장소를 알려주세요.",
};

export default function SubmitPage() {
  return (
    <main className="mx-auto min-h-screen w-full max-w-lg bg-canvas text-ink">
      {/* 상단 바 (§7.1) — 뒤로는 직전 화면, 기록이 없으면 S1 (§7.5) */}
      <header className="flex h-14 items-center gap-1 px-2">
        <BackLink />
        <h1 className="text-lg font-bold">장소 등록</h1>
      </header>

      <SubmitForm />

      {/* 하단 공통 출처 표기 (④ §10 · ② §8) — 전 화면 공통이며 S5 도 예외가 아닙니다 */}
      <DataSources />
    </main>
  );
}
