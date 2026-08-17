/**
 * 오프라인 껍데기 (범위 확대 【1】 PWA).
 *
 * 연결이 끊긴 채로 화면을 열면 서비스워커가 **이 페이지를 대신 내줍니다**
 * (`public/sw.js` — 이동 요청이 실패했을 때의 대체물).
 *
 * 브라우저 자바스크립트가 필요 없는 **정적 화면**입니다. 오프라인에서 스크립트가 안 받아져도
 * 글자가 그대로 보여야 하므로 상태·효과를 두지 않았습니다.
 *
 * 다트를 여기서 던지게 하지 않습니다 — 다트는 DB 집계표를 봐야 하므로(D-6) 연결이 없으면
 * 결과가 나올 수 없고, 되는 척하는 화면은 상태 안내 원칙(`화면구성도.md` §2.4)에 어긋납니다.
 *
 * 이 페이지는 「화면」으로 세지 않습니다 (2026-08-17 · ② §12.1)
 * ----------------------------------------------------------
 * 공개 주소로 200을 돌려주지만 **화면 정본(② `화면구성도.md`)의 `S1~S9`·`S6-2` 밖**입니다.
 * 번호·와이어프레임·상태·전이를 두지 않는 이유는 **사용자가 스스로 찾아가는 자리가 아니고**
 * (서비스워커가 이동 실패 때 대신 내주는 껍데기입니다) **상태가 하나뿐**이라, 화면으로
 * 세면 정본에 빈 절이 하나 늘 뿐이기 때문입니다. 그 판단과 사유는 ② §12.1에 적었습니다.
 *
 * **다만 데이터 출처 표기는 붙입니다** — 화면 단위 규약이 이 자리에 원리적으로 걸리지
 * 않더라도, **사용자가 실제로 보는 공개 화면**이라는 사실은 같습니다. 공공누리 출처표시는
 * 많을수록 안전한 쪽이라 규약 적용 여부와 무관하게 답니다.
 */

import Link from "next/link";
import type { Metadata } from "next";

import { DataSources } from "@/components/DataSources";

export const metadata: Metadata = {
  title: "연결이 끊겼어요 — 부산 Dartrip",
  description: "인터넷 연결이 끊겨 화면을 불러오지 못했습니다.",
};

export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-lg flex-col bg-canvas text-ink">
      <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
        <p className="mb-5 text-4xl" aria-hidden>
          🎯
        </p>
        <h1 className="text-xl font-bold break-keep">연결이 끊겼어요</h1>
        <p className="mt-3 text-sm leading-relaxed break-keep text-ink-muted">
          인터넷에 닿지 않아 화면을 불러오지 못했습니다. 연결을 확인한 뒤 다시 열어 주세요.
        </p>
        <p className="mt-2 text-xs leading-relaxed break-keep text-ink-muted">
          다트는 부산 장소 목록을 받아 와야 던질 수 있어요.
        </p>

        <Link
          href="/"
          className="mt-8 flex min-h-12 items-center justify-center rounded-2xl bg-brand-deep px-8 text-sm font-semibold text-white"
        >
          다시 시도
        </Link>
      </div>

      <DataSources />
    </main>
  );
}
