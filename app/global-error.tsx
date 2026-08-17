"use client";

/**
 * 루트 레이아웃 자체가 무너졌을 때의 마지막 화면 (2026-08-17 신설 · `AL-1`).
 *
 * 설계 정본: ② `화면구성도.md` §12.2(이 화면의 자리 판단) · §2.1(하단 출처 표기)
 *            `D-61-3`(밝은 화면 고정) · `D-61-1`(팔레트 「감천」)
 *
 * `error.tsx` 와 무엇이 다른가
 * ---------------------------
 * `app/error.tsx` 는 **루트 레이아웃 안**에서 난 오류를 받습니다. 여기는 그 **레이아웃
 * 자신**이 무너진 경우이므로 레이아웃이 통째로 대체됩니다 — 그래서 이 파일은 `<html>` 과
 * `<body>` 를 **직접** 그려야 합니다. `app/layout.tsx` 가 걸어 두는 `lang="ko"` 와
 * `color-scheme: light`(`D-61-3`)도 여기서 다시 걸지 않으면 사라집니다.
 *
 * 색을 두 겹으로 적은 이유
 * ------------------------
 * 이 화면이 뜨는 상황은 **스타일시트가 오지 않았을 수도 있는 상황**입니다. 그래서
 *   · `globals.css` 를 여기서도 불러 토큰(`--canvas`·`--ink`)이 살아 있게 하고,
 *   · 그마저 없을 때를 대비해 `var(--canvas, #FFF8F0)` 처럼 **되돌아갈 값**을 함께 적습니다.
 * 값을 화면에 직접 적지 않는다는 `D-61-1` 의 취지와 어긋나 보이지만, 토큰이 **먼저**이고
 * 리터럴은 토큰이 없을 때만 쓰이는 자리라 단일 출처(`app/globals.css`)는 그대로입니다.
 * Tailwind 유틸리티를 쓰지 않은 것도 같은 이유입니다 — 그 클래스들도 CSS 가 와야 삽니다.
 *
 * 하단 데이터 출처 표기는 여기에도 답니다(② §2.1 · §12.2) — 사용자가 실제로 보는 공개
 * 화면인 것은 같습니다. 스타일이 오지 않았다면 글자만 남지만, 표기 자체는 남습니다.
 */

import "./globals.css";

import { DataSources } from "@/components/DataSources";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="ko" style={{ colorScheme: "light" }}>
      <body
        style={{
          margin: 0,
          background: "var(--canvas, #FFF8F0)",
          color: "var(--ink, #2E2A33)",
          minHeight: "100vh",
        }}
      >
        <main
          style={{
            margin: "0 auto",
            maxWidth: "32rem",
            padding: "0 2rem",
            display: "flex",
            minHeight: "70svh",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
          }}
        >
          <p style={{ fontSize: "2.25rem", marginBottom: "1.25rem" }} aria-hidden>
            🎯
          </p>
          <h1 style={{ fontSize: "1.25rem", fontWeight: 700, wordBreak: "keep-all" }}>
            화면을 열지 못했어요
          </h1>
          <p
            style={{
              marginTop: "0.75rem",
              fontSize: "0.875rem",
              lineHeight: 1.7,
              wordBreak: "keep-all",
              color: "var(--ink-muted, #6B6472)",
            }}
          >
            잠깐 문제가 생겼어요. 다시 시도해 보시고, 계속 같으면 잠시 뒤에 열어 주세요.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: "2rem",
              minHeight: "3rem",
              padding: "0 2rem",
              borderRadius: "1rem",
              border: "none",
              background: "var(--brand-deep, #C2334D)",
              color: "#FFFFFF",
              fontSize: "0.875rem",
              fontWeight: 600,
            }}
          >
            다시 시도
          </button>
          {/*
            여기만 `next/link` 가 아니라 보통 `<a>` 입니다 — 루트 레이아웃이 무너진 상태라
            앱 안에서 부드럽게 옮겨 가면 **같은 무너진 나무로 되돌아갑니다.** 주소창을 다시
            태워 **판을 통째로 새로 받는 것**이 이 자리의 목적이라 규칙을 한 줄만 끕니다.
          */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a
            href="/"
            style={{
              marginTop: "1rem",
              fontSize: "0.875rem",
              color: "var(--ink-muted, #6B6472)",
            }}
          >
            처음 화면으로
          </a>
        </main>
        <DataSources />
      </body>
    </html>
  );
}
