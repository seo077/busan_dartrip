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

/**
 * 아주 짧은 진동 — 다트가 꽂히는 순간의 타격감입니다.
 *
 * 세 겹으로 막아 둡니다.
 *   1. `navigator.vibrate` 가 없는 기기(대부분의 데스크톱·iOS)는 아무 일도 하지 않습니다.
 *   2. 모션 최소화 설정이면 하지 않습니다 — 진동도 사용자가 줄이고 싶어 하는 자극입니다.
 *   3. 길이를 20ms 안쪽으로 묶어 "울리는" 느낌이 되지 않게 합니다.
 *
 * 새 의존성 없이 브라우저 기본 기능만 씁니다.
 */
export function tapFeedback(ms = 12): void {
  if (typeof window === "undefined" || typeof navigator === "undefined") return;
  if (typeof navigator.vibrate !== "function") return;
  if (window.matchMedia?.(QUERY).matches) return;
  try {
    navigator.vibrate(Math.max(1, Math.min(20, Math.round(ms))));
  } catch {
    // 사용자 제스처 없이 부르면 막는 브라우저가 있습니다. 타격감은 없어도 그만입니다.
  }
}
