import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "부산 Dartrip",
  description:
    "부산 지도에 다트를 던져 갈 곳을 우연으로 정하는 서비스. 공공데이터 기반 관광 정보를 제공합니다.",
};

/**
 * 글꼴은 시스템 글꼴을 씁니다.
 * 템플릿 기본값(next/font/google)은 빌드 시점에 외부 요청이 필요하고, 한글 본문에는
 * 어차피 적용되지 않습니다. 디자인 토큰 확정은 구간 ⑦ 작업입니다.
 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className="antialiased">{children}</body>
    </html>
  );
}
