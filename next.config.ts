import type { NextConfig } from "next";

/**
 * 보안 응답 헤더 (`D-59-5`).
 *
 * 실측으로 있던 것은 `Strict-Transport-Security` 하나뿐이었습니다(Vercel 기본값). 여기서
 * 나머지를 채웁니다. `vercel.json` 이 아니라 이 파일에 두는 이유는 **한자리로 모으기** 입니다 —
 * 두 곳에 나뉘면 나중에 한쪽만 고치는 경로가 생깁니다.
 *
 * ── `Content-Security-Policy` 를 두 겹으로 나눈 이유 ────────────────────────────
 * 이 앱은 **카카오맵 JS SDK 라는 외부 스크립트** 위에 서 있습니다
 * (`components/home/BusanMap.tsx` — `https://dapi.kakao.com/v2/maps/sdk.js`). SDK 는 받아
 * 온 뒤 스스로 다음 스크립트·지도 타일 이미지·좌표 요청을 여러 도메인으로 더 냅니다.
 * 그 목록을 **문서가 아니라 실제 브라우저에서 확인하기 전에** `script-src`·`img-src`·
 * `connect-src` 를 강제로 걸면, 지도가 통째로 안 뜨고 `S1` 다트 조준과 `S5` 장소 등록이
 * 함께 죽습니다. 게다가 그 실패는 **로컬이 아니라 배포본에서만** 드러나는 종류입니다.
 *
 * 그래서 이렇게 나눴습니다.
 *
 *   1. **강제(enforce)** — 지도의 자원 로딩과 **원리적으로 무관한 지시어만** 넣습니다.
 *      `frame-ancestors`(클릭재킹) · `base-uri` · `form-action` · `object-src` 넷은
 *      스크립트·이미지·XHR 의 출처를 판단하지 않으므로, 이 넷으로는 지도가 막히지 않습니다.
 *   2. **보고 전용(Report-Only)** — 스크립트·이미지·연결까지 좁힌 완전판을 **차단하지 않는
 *      모드로** 함께 보냅니다. 브라우저가 위반을 콘솔에 적기만 하고 요청은 그대로 통과시키므로
 *      **지도를 깨뜨리지 않으면서** 실제로 필요한 출처 목록이 드러납니다. 그 목록을 확인한
 *      다음 회차에 강제로 올리는 것이 순서입니다.
 *
 * `Cross-Origin-Embedder-Policy` 는 **넣지 않았습니다** — 걸면 교차출처 지도 타일이 전부
 * 막힙니다. `camera` 도 `Permissions-Policy` 에서 뺐습니다(`S5` 사진 등록 경로 보호).
 */

/** 지도 SDK 가 실제로 쓰는 출처들. 보고 전용 정책에만 씁니다. */
const KAKAO_ORIGINS = [
  "https://dapi.kakao.com",
  "https://*.daumcdn.net",
  "https://*.daum.net",
  "https://*.kakao.com",
].join(" ");

/**
 * 강제로 거는 최소 정책 — 어느 지시어도 스크립트·이미지·연결의 **출처를 판단하지 않습니다.**
 * 그래서 이 목록으로는 지도가 막힐 수 없습니다.
 *
 * `upgrade-insecure-requests` 는 **막는 지시어가 아니라 바꾸는 지시어**입니다 (2026-08-17 추가).
 * 페이지가 내는 `http://` 자원 요청을 브라우저가 보내기 전에 `https://` 로 올려 줍니다 —
 * 걸러 내는 목록이 없으므로 위 넷과 같은 성질이고, 이것 때문에 무엇이 막히지는 않습니다.
 * 넣은 이유는 아래 `CSP_REPORT_ONLY` 의 2026-08-17 실측 항목에 적었습니다.
 */
const CSP_ENFORCED = [
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");

/**
 * 차단하지 않고 위반만 알리는 완전판. 여기 적힌 출처가 맞는지 실제 화면에서 확인한 뒤 승격합니다.
 *
 * ── 2026-08-16 실측으로 드러난 것 (헤드리스 브라우저로 `/` 를 열어 위반 기록을 읽음) ──
 * 이 정책을 **강제로 걸었다면 지도가 죽었을 자리가 셋** 있었습니다. 보고 전용이라 지도는
 * 그대로 떴고, 대신 목록이 손에 들어왔습니다.
 *
 *   1. **`'unsafe-eval'` 이 필요합니다.** 카카오맵 SDK 가 문자열을 자바스크립트로 평가합니다
 *      (`Evaluating a string as JavaScript violates …`). 이 한 줄이 없으면 SDK 초기화가
 *      멈춥니다. 아래에 반영했습니다 — **완화이며, 외부 SDK 를 쓰는 값입니다.**
 *   2. SDK 는 자기 본체를 `t1.daumcdn.net`, 지도 타일을 `mts.daumcdn.net` 에서 더 받습니다.
 *      둘 다 `*.daumcdn.net` 안이라 출처 목록은 맞았습니다.
 *   3. 실측 때 그 주소들이 **`http://` 로 나갔습니다.** 확인을 `http://localhost` 에서 했기
 *      때문으로 보이며(SDK 가 현재 프로토콜을 따라갑니다), 배포본은 `https` 라 같은 값이
 *      `https://` 로 나갈 것으로 봅니다. **다만 이는 추정이고 배포본에서 다시 봐야 확정됩니다** —
 *      `img-src`·`script-src` 에 `http:` 를 넣지 않은 채로 두고 보고 기록으로 판별합니다.
 *
 * ── 2026-08-17 배포본 실측 — 위 3번의 추정은 **틀렸습니다** ────────────────────
 * 배포본(`https`)에서도 **지도 타일이 `http://` 로 나갑니다.** 사용자가 배포본 콘솔에서 읽은
 * 기록이 근거입니다 — `Mixed Content: ... was loaded over HTTPS, but requested an insecure
 * element ... This request was automatically upgraded to HTTPS` 와
 * `Loading the image ... violates ... "img-src 'self' data: blob: https:"` 두 줄이며,
 * 건수는 화면마다 누적(결과 24 · 상세 16 · `S5`·`S6-2` 100+)이고 **지도가 없는 화면은 `No Issues`**
 * 라 출처가 지도임이 대조로 드러났습니다. **오류(빨강)는 0건**이고 **`script-src` 위반도 0건**
 * 입니다 — SDK 본체는 `https` 로 나갔고, `http` 로 나가는 것은 **타일 이미지뿐**입니다.
 *
 * **지금 화면은 정상입니다.** 이 정책은 차단하지 않는 모드이고, 브라우저가 그 요청을 스스로
 * `https` 로 올려 주기 때문입니다(위 첫 줄이 그 말입니다). **문제는 승격 시점**입니다 —
 * 완전판을 이대로 강제로 올리면 `img-src` 에 `http:` 가 없어 **지도 타일이 통째로 막힙니다.**
 *
 * **처방 (2026-08-17, `D-62` 회차) — 두 자리를 손봤고 승격은 하지 않았습니다.**
 *   ㉠ **강제 층에 `upgrade-insecure-requests` 추가.** 요청이 나가기 전에 `http://` 를
 *      `https://` 로 올려 두면, 나중에 완전판을 강제해도 **판정 대상이 이미 `https`** 입니다.
 *      출처를 판단하지 않는 지시어라 **지금 무엇을 막지도 않습니다.** 브라우저의 자동 승격은
 *      이미지에만 걸리는 안전망이지만 이쪽은 **정책으로 못박는 것**이라 종류를 가리지 않습니다.
 *   ㉡ **보고 전용 `img-src` 에 `http://*.daumcdn.net` 추가.** 위반 기록은 **승격 전 주소**로
 *      남으므로, ㉠ 을 걸어도 이 목록에 `http` 자리가 없으면 **보고는 계속 쌓입니다.** 그러면
 *      *"보고가 비면 승격한다"* 는 판별 자체가 성립하지 않습니다. 호스트를 카카오 CDN 하나로
 *      좁혀 열어 두면 **보고가 다시 판별 수단이 되고**, 승격했을 때 타일이 막히지 않는다는
 *      보장도 함께 얻습니다. 실제 요청은 ㉠ 때문에 `https` 로 나가므로 이 허용으로 평문 통신이
 *      늘어나지는 않습니다. **`script-src` 에는 넣지 않았습니다** — 위반이 0건이었고, 스크립트를
 *      평문으로 여는 것은 이미지와 무게가 다릅니다.
 *   ㉢ **승격은 이번 회차에 하지 않습니다.** 지도가 죽는 사고는 배포본에서만 나므로, 위 둘을
 *      건 판을 먼저 배포해 콘솔을 다시 읽고 그다음 회차에 정합니다(`PROGRESS.md` §남은 작업 52번).
 */
const CSP_REPORT_ONLY = [
  "default-src 'self'",
  // `'unsafe-inline'` = Next.js 부트스트랩 인라인 스크립트. `'unsafe-eval'` = 카카오맵 SDK (위 실측 1).
  `script-src 'self' 'unsafe-inline' 'unsafe-eval' ${KAKAO_ORIGINS}`,
  "style-src 'self' 'unsafe-inline'",
  // 장소 사진은 공공 API 가 주는 외부 주소이고, 지도 타일도 이미지입니다.
  // `http://*.daumcdn.net` = 지도 타일이 평문으로 나가는 실측분 (2026-08-17 ㉡ — 실제 요청은
  // `upgrade-insecure-requests` 로 `https` 가 됩니다).
  "img-src 'self' data: blob: https: http://*.daumcdn.net",
  "font-src 'self' data:",
  `connect-src 'self' ${KAKAO_ORIGINS} https://*.supabase.co wss://*.supabase.co`,
  "worker-src 'self'",
  "manifest-src 'self'",
  "media-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-DNS-Prefetch-Control", value: "on" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  {
    // 위치 기능 미도입(`D-59-4`)이 코드 부재만이 아니라 **헤더로도** 서게 됩니다.
    key: "Permissions-Policy",
    value: [
      "geolocation=()",
      "microphone=()",
      "payment=()",
      "usb=()",
      "serial=()",
      "bluetooth=()",
      "midi=()",
      "magnetometer=()",
      "gyroscope=()",
      "accelerometer=()",
    ].join(", "),
  },
  { key: "Content-Security-Policy", value: CSP_ENFORCED },
  { key: "Content-Security-Policy-Report-Only", value: CSP_REPORT_ONLY },
];

const nextConfig: NextConfig = {
  // 프레임워크를 그대로 알리는 `X-Powered-By: Next.js` 를 끕니다 (정보 노출).
  poweredByHeader: false,

  async headers() {
    return [
      {
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
      {
        // 서비스워커는 **캐시되면 갱신이 막힙니다** — 새 판을 내려받을 통로가 여기입니다.
        source: "/sw.js",
        headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }],
      },
    ];
  },
};

export default nextConfig;
