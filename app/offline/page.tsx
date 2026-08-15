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
 */

import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "연결이 끊겼어요 — 부산 Dartrip",
  description: "인터넷 연결이 끊겨 화면을 불러오지 못했습니다.",
};

export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-lg flex-col items-center justify-center bg-canvas px-8 text-center text-ink">
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
    </main>
  );
}
