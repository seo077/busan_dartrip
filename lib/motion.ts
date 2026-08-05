/**
 * 모션 최소화 설정 읽기.
 *
 * 설계 정본: `화면구성도.md` §4.2 — "`prefers-reduced-motion` 설정 시 애니메이션 없이
 * 결과 캡션만 0.8초 표시 후 전이합니다."
 *
 * 브라우저 설정이라 서버에서는 알 수 없습니다. 서버 렌더와 첫 그리기가 어긋나지 않도록
 * `false` 로 시작하고 마운트 뒤에 실제 값으로 맞춥니다. 설정을 도중에 바꾸면 그때도 따라갑니다.
 */

import { useEffect, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia(QUERY);
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  return reduced;
}
