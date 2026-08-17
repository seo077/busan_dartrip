"use client";

/**
 * 서비스워커 등록 (범위 확대 【1】 PWA).
 *
 * 그리는 것이 없는 컴포넌트입니다 — 화면에 한 칸도 차지하지 않고, 첫 그리기가 끝난 뒤에
 * 조용히 `/sw.js` 를 등록합니다.
 *
 * **개발 중에는 등록하지 않습니다.** 로컬에서 캐시가 남으면 고친 화면이 안 보이는 채로
 * 원인을 찾게 됩니다. 실패해도 아무것도 하지 않습니다 — 서비스워커는 곁다리이고,
 * 없다고 해서 앱이 못 도는 자리가 하나도 없습니다.
 *
 * 등록 주소에 배포 식별값을 실어 보냅니다 (2026-08-17)
 * ---------------------------------------------------
 * `/sw.js?v=<커밋 7자>` 로 등록합니다. **두 가지가 여기에 달려 있습니다** — ㉠ 주소가
 * 배포마다 달라지므로 브라우저가 서비스워커를 **다시 설치**하고(옛 껍데기가 사용자 기기에
 * 남지 않습니다) ㉡ `public/sw.js` 가 그 값을 읽어 **캐시 이름**을 만들어, 옛 캐시가
 * `activate` 에서 지워집니다. 값의 출처는 `app/layout.tsx` 이며 로컬에서는 `dev` 입니다.
 */

import { useEffect } from "react";

export function ServiceWorkerRegistrar({ build }: { build: string }) {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    const register = () => {
      navigator.serviceWorker.register(`/sw.js?v=${encodeURIComponent(build)}`).catch(() => {
        // 등록 실패는 조용히 넘깁니다 (사설 인증서·시크릿 창 등).
      });
    };

    if (document.readyState === "complete") {
      register();
      return;
    }
    window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  }, [build]);

  return null;
}

export default ServiceWorkerRegistrar;
