"use client";

/**
 * 루트 「처리되지 않은 오류」 안내 (2026-08-17 신설 · `AL-1`).
 *
 * 설계 정본: ② `화면구성도.md` §12.2(이 화면의 자리 판단) · §2.1(하단 출처 표기) · §2.4(공통 상태 처리)
 *            `D-61-3`(밝은 화면 고정)
 *
 * 어떤 오류가 여기로 오는가
 * -------------------------
 * 루트 레이아웃 **아래** 에서 난, 아무도 받지 않은 오류입니다. 화면·서버 컴포넌트가 던진
 * 예외가 모두 해당합니다. 레이아웃 **자신**이 무너진 경우는 여기까지 오지 못하고
 * `app/global-error.tsx` 가 받습니다.
 *
 * 이 파일이 없으면 `not-found.tsx` 와 같은 자리로 떨어졌습니다 — Next.js 기본 오류 화면이며
 * 다크 선호 기기에서 검은 바탕에 영문이 뜨고, 출처 표기도 복귀 링크도 없습니다(`D-61-3` 반대).
 *
 * §2.4 가 요구하는 두 가지
 * ------------------------
 *   1) 원인을 사용자 문장으로 적습니다 — **기술 메시지·오류 코드는 화면에 두지 않습니다.**
 *      `error.message` 를 그대로 띄우지 않는 이유이며, 되짚을 값은 `error.digest` 로 서버
 *      로그에 남습니다(화면에는 적지 않습니다).
 *   2) **다음 행동을 항상 함께** 둡니다 — 여기서는 둘입니다. `reset()` 은 이 구간만 다시
 *      그려 보는 것이고(새로고침이 아니라 그 자리에서의 재시도), 그래도 안 되면 처음 화면.
 *
 * 자체 마크업인 이유 — 공용 `ResultNotice` 는 「링크 하나」만 받습니다. 여기는 **버튼(재시도)
 * 과 링크(처음 화면)가 함께** 필요해 같은 생김새를 이 파일 안에 폈습니다. 색·간격 값은
 * 전부 토큰(`bg-canvas`·`text-ink`·`bg-brand-deep`)이라 팔레트를 고치면 함께 움직입니다.
 */

import Link from "next/link";

import { DataSources } from "@/components/DataSources";

export default function ErrorScreen({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto min-h-screen w-full max-w-lg bg-canvas text-ink">
      <section className="flex min-h-[70svh] flex-col items-center justify-center px-8 text-center">
        <p className="mb-5 text-4xl" aria-hidden>
          🎯
        </p>
        <h1 className="text-xl font-bold break-keep text-ink">화면을 불러오지 못했어요</h1>
        <p className="mt-3 text-sm leading-relaxed break-keep text-ink-muted">
          잠깐 문제가 생겼어요. 다시 시도해 보시고, 계속 같으면 잠시 뒤에 열어 주세요.
        </p>

        <button
          type="button"
          onClick={reset}
          className="mt-8 flex min-h-12 items-center justify-center rounded-2xl bg-brand-deep px-8 text-sm font-semibold text-white"
        >
          다시 시도
        </button>
        <Link href="/" className="mt-4 text-sm underline underline-offset-4 text-ink-muted">
          처음 화면으로
        </Link>
      </section>
      <DataSources />
    </main>
  );
}
