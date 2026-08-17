import type { Metadata, Viewport } from "next";
import "./globals.css";

import { ServiceWorkerRegistrar } from "@/components/pwa/ServiceWorkerRegistrar";

export const metadata: Metadata = {
  title: "부산 Dartrip",
  description:
    "부산 지도에 다트를 던져 갈 곳을 우연으로 정하는 서비스. 공공데이터 기반 관광 정보를 제공합니다.",
  applicationName: "부산 Dartrip",
  appleWebApp: {
    capable: true,
    title: "Dartrip",
    // 상단 상태 표시줄을 바탕색에 맞춥니다 (iOS 홈 화면에서 열었을 때).
    statusBarStyle: "default",
  },
  icons: {
    icon: [{ url: "/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

/**
 * 화면은 **밝은 쪽 하나로 고정**입니다 (`D-61-3`).
 *
 * `colorScheme: "light"` 는 `<meta name="color-scheme">` 로 나가고, `globals.css` 의
 * `color-scheme: light` 와 짝을 이룹니다. 둘을 같이 두는 이유는 **CSS 가 오기 전**(첫 그리기
 * 직전)에도 브라우저가 밝은 쪽으로 정하게 하기 위해서입니다 — 안 그러면 OS 가 다크인 기기에서
 * 한 번 깜빡 어두웠다가 밝아집니다.
 *
 * `themeColor` 는 매니페스트와 **같은 값**이어야 합니다(`app/manifest.ts`). 어긋나면 홈 화면
 * 실행과 브라우저 실행의 주소 표시줄 색이 갈립니다.
 */
export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#FFF8F0",
};

/**
 * 글꼴은 시스템 글꼴을 씁니다.
 * 템플릿 기본값(next/font/google)은 빌드 시점에 외부 요청이 필요하고, 한글 본문에는
 * 어차피 적용되지 않습니다. 디자인 토큰 확정은 구간 ⑦ 작업입니다.
 */
/**
 * 서비스워커에 실어 보내는 배포 식별값 (`X-52` 대응 — 2026-08-17).
 *
 * Vercel 이 빌드 때 넣어 주는 커밋 해시 앞 7자입니다(`lib/version.ts` 와 같은 출처).
 * 없으면 `dev` — 로컬 빌드에서는 서비스워커를 등록하지 않으므로 쓰이지 않습니다.
 * 이 값이 `/sw.js?v=…` 로 나가고, `public/sw.js` 가 그것으로 **캐시 이름**을 만듭니다.
 */
const BUILD = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className="antialiased">
        {children}
        <ServiceWorkerRegistrar build={BUILD} />
      </body>
    </html>
  );
}
