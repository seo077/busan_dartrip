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
 */

import { useEffect } from "react";

export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // 등록 실패는 조용히 넘깁니다 (사설 인증서·시크릿 창 등).
      });
    };

    if (document.readyState === "complete") {
      register();
      return;
    }
    window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}

export default ServiceWorkerRegistrar;
