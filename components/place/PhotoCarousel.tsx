"use client";

/**
 * S4 — 사진 캐러셀 (§6.1 상단 · §6.3-1).
 *
 * 설계 정본: `화면구성도.md` §6.1 · §6.3-1("없을 때: 테마 기본 이미지 1장") · §6.4
 *
 * 재료가 세 갈래로 들어옵니다 — 대표 이미지 · 국문 관광정보 `detailImage2` · 관광사진 서비스.
 * 어느 것이 몇 장 붙느냐는 장소마다 다르고, **한 장뿐인 것도 정상 상태**입니다(§13 U-6).
 * 그래서 장수에 따라 화면을 나누지 않고, 점 표시와 좌우 넘김만 장수에 맞춰 켜고 끕니다.
 *
 * 사진이 하나도 없으면 **테마 그라데이션 한 칸**이 그 자리를 대신합니다. 빈 상자를 남기지
 * 않는 것이 이 화면의 규칙입니다 (AD-8).
 *
 * 깨진 사진은 스스로 빠집니다. 외부 이미지 호스트가 제공기관마다 달라 개별 실패가 흔한데,
 * 실패한 장을 남겨 두면 캐러셀 중간에 회색 칸이 생깁니다.
 */

import { useMemo, useRef, useState } from "react";

import type { PhotoView } from "@/components/place/types";
import { themeGradient, themeIcon } from "@/lib/format";
import type { ThemeKey } from "@/lib/theme";

export function PhotoCarousel({
  photos,
  theme,
  placeName,
  loading = false,
}: {
  photos: PhotoView[];
  theme: ThemeKey | null;
  placeName: string;
  /** 외부 응답을 기다리는 중인지 (§6.4 "로딩" — 기본 정보는 이미 떠 있습니다) */
  loading?: boolean;
}) {
  const [failed, setFailed] = useState<string[]>([]);
  const [active, setActive] = useState(0);
  const trackRef = useRef<HTMLDivElement | null>(null);

  const visible = useMemo(
    () => photos.filter((p) => !failed.includes(p.url)),
    [photos, failed],
  );

  const credits = useMemo(
    () => [...new Set(visible.map((p) => p.credit).filter((c): c is string => Boolean(c)))],
    [visible],
  );

  const onScroll = () => {
    const el = trackRef.current;
    if (!el || el.clientWidth === 0) return;
    setActive(Math.round(el.scrollLeft / el.clientWidth));
  };

  // 사진 0장 — 테마 배경이 그 자리를 대신합니다 (§6.3-1)
  if (visible.length === 0) {
    return (
      <div
        className="relative flex h-64 w-full items-center justify-center sm:h-80"
        style={{ background: themeGradient(theme) }}
      >
        <span aria-hidden className="text-5xl opacity-60">
          {themeIcon(theme)}
        </span>
        {loading ? (
          <span className="absolute bottom-3 text-xs text-white/60">사진을 찾는 중…</span>
        ) : null}
      </div>
    );
  }

  return (
    <div className="relative">
      <div
        ref={trackRef}
        onScroll={onScroll}
        className="flex h-64 w-full snap-x snap-mandatory overflow-x-auto sm:h-80"
        style={{ background: themeGradient(theme) }}
      >
        {visible.map((photo) => (
          <div key={photo.url} className="h-full w-full shrink-0 snap-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photo.url}
              alt={photo.label ?? placeName}
              loading="lazy"
              onError={() => setFailed((prev) => [...prev, photo.url])}
              className="h-full w-full object-cover"
            />
          </div>
        ))}
      </div>

      {/* 점 표시 — 두 장 이상일 때만 (§6.1 `● ○ ○`) */}
      {visible.length > 1 ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center gap-1.5">
          {visible.map((photo, i) => (
            <span
              key={photo.url}
              aria-hidden
              className={`h-1.5 rounded-full transition-all ${
                i === active ? "w-4 bg-white" : "w-1.5 bg-white/50"
              }`}
            />
          ))}
        </div>
      ) : null}

      {visible.length > 1 ? (
        <p className="sr-only" aria-live="polite">
          사진 {active + 1} / {visible.length}
        </p>
      ) : null}

      {/* 저작권 표기 (④ §3.4 — 표기 의무가 있으면 캐러셀 하단에) */}
      {credits.length > 0 ? (
        <p className="bg-[#0E1116] px-5 pt-2 text-[11px] text-[#98A2B3]">
          사진 제공 · {credits.join(" / ")}
        </p>
      ) : null}
    </div>
  );
}

export default PhotoCarousel;
