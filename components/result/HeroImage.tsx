"use client";

/**
 * 히어로 사진 — 실패하면 스스로 사라집니다.
 *
 * 설계 정본: `화면구성도.md` §5.4("사진 로드 실패" → 기본 이미지로 폴백)
 *
 * 뒤에는 언제나 테마별 그라데이션이 깔려 있습니다(`lib/format.ts` `themeGradient`).
 * 그래서 이 사진이 사라지면 그 자리가 그대로 "사진 없음" 화면이 됩니다 —
 * 폴백을 위해 따로 준비하는 것이 없습니다.
 *
 * `next/image` 를 쓰지 않는 이유는 `/data` 화면과 같습니다. 외부 이미지 호스트가
 * 제공기관마다 다르고, 무료 티어의 이미지 최적화 사용량을 아껴야 합니다.
 */

import { useState } from "react";

export function HeroImage({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      onError={() => setFailed(true)}
      className="absolute inset-0 h-full w-full object-cover"
    />
  );
}

export default HeroImage;
