import type { MetadataRoute } from "next";

/**
 * 홈 화면에 추가 — 웹 앱 매니페스트 (범위 확대 【1】 PWA).
 *
 * Next.js 파일 규약이라 `/manifest.webmanifest` 로 나갑니다. `app/layout.tsx` 가 링크를
 * 자동으로 넣으므로 따로 `<link rel="manifest">` 를 적지 않습니다.
 *
 * **색은 `D-61` 팔레트와 같은 값입니다.** 어긋나면 홈 화면에서 열었을 때 주소 표시줄·시작
 * 화면만 다른 색이 되어 화면이 갈립니다 — 바탕 `#FFF8F0` 하나로 맞춥니다.
 *
 * `display: "standalone"` — 주소 표시줄 없이 앱처럼 뜹니다. 그래도 우리 화면 안에 뒤로가기가
 * 다 있어(`화면구성도.md` §2.1 상단 바) 막다른 자리가 생기지 않습니다.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "부산 Dartrip",
    short_name: "Dartrip",
    description:
      "부산 지도에 다트를 던져 갈 곳을 우연으로 정하는 서비스. 공공데이터 기반 관광 정보를 제공합니다.",
    lang: "ko",
    dir: "ltr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#FFF8F0",
    theme_color: "#FFF8F0",
    categories: ["travel", "lifestyle"],
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        // 기기가 아이콘을 원·사각 등으로 잘라 낼 때 쓰는 판 — 그림을 안전 영역 안에 두었습니다.
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
