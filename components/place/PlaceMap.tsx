"use client";

/**
 * S4 — 지도 (§6.1 "── 지도 ──" · §6.3-6).
 *
 * 설계 정본: `화면구성도.md` §6.1 · §6.3-6("없을 때: 정적 이미지 폴백") · §2.5(위치 정보)
 *
 * S1 의 지도(`components/home/BusanMap.tsx`)와 성격이 다릅니다. 거기서는 결과를 미리 흘리지
 * 않으려고 마커를 두지 않았지만, **여기서는 마커가 요점**입니다 — 이미 뽑힌 한 곳이 어디인지
 * 보여 주는 자리입니다.
 *
 * 지도가 없어도 화면은 그대로 돕니다. SDK 로드 실패·앱키 미설정은 오류가 아니라 **좌표와
 * 카카오맵 링크가 있는 패널**로 물러섭니다. 설계가 말한 "정적 이미지 폴백" 의 자리인데,
 * 정적 지도 이미지를 부르려면 서버 키가 브라우저로 나가야 해서 그 방식은 쓰지 않았습니다
 * (④ §2 — `NEXT_PUBLIC_` 이 붙지 않은 값은 브라우저로 내보내지 않습니다).
 *
 * 브라우저 위치 권한은 요청하지 않습니다 (AD-9 · §2.5). 지도는 장소를 보여 줄 뿐
 * 사용자가 어디 있는지 묻지 않습니다.
 */

import { useEffect, useRef, useState } from "react";

const SDK_TIMEOUT_MS = 8000;
const SCRIPT_ID = "kakao-maps-sdk";
const LEVEL_PLACE = 4;

// SDK 가운데 이 화면이 실제로 쓰는 부분만 좁게 선언합니다.
// `window.kakao` 를 전역으로 다시 선언하지 않는 이유는, S1 지도(`components/home/BusanMap.tsx`)가
// 이미 자기 화면에 필요한 모양으로 같은 전역을 선언해 두었기 때문입니다. 같은 이름을 두 번
// 선언하면 서로 다른 모양이라 충돌합니다. 그래서 여기서는 읽는 시점에만 좁게 봅니다.
interface KakaoLatLng {
  readonly __brand?: "LatLng";
}
interface KakaoMarker {
  setMap(map: unknown): void;
}
interface PlaceKakaoMap {
  setDraggable(draggable: boolean): void;
  setZoomable(zoomable: boolean): void;
}
interface PlaceKakaoMaps {
  load(callback: () => void): void;
  LatLng: new (lat: number, lng: number) => KakaoLatLng;
  Map: new (
    container: HTMLElement,
    options: { center: KakaoLatLng; level: number },
  ) => PlaceKakaoMap;
  Marker: new (options: { position: KakaoLatLng; map?: PlaceKakaoMap }) => KakaoMarker;
}

/** 전역에 실려 있는 SDK 를 이 화면이 쓰는 모양으로만 좁혀 읽습니다. */
function readMaps(): PlaceKakaoMaps | null {
  if (typeof window === "undefined") return null;
  const maps = (window as unknown as { kakao?: { maps?: PlaceKakaoMaps } }).kakao?.maps;
  return maps ?? null;
}

type MapState = "loading" | "ready" | "unavailable";

function loadSdk(appKey: string): Promise<PlaceKakaoMaps> {
  return new Promise((resolve, reject) => {
    const loaded = readMaps();
    if (loaded?.Map) {
      resolve(loaded);
      return;
    }

    const finish = () => {
      const maps = readMaps();
      if (!maps) {
        reject(new Error("SDK 를 불러왔지만 maps 가 없습니다."));
        return;
      }
      maps.load(() => resolve(maps));
    };

    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", finish, { once: true });
      existing.addEventListener("error", () => reject(new Error("SDK 로드 실패")), { once: true });
      // 이미 로드가 끝난 뒤 붙는 경우
      if (readMaps()) finish();
      return;
    }

    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.async = true;
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(appKey)}&autoload=false`;
    script.addEventListener("load", finish, { once: true });
    script.addEventListener("error", () => reject(new Error("SDK 로드 실패")), { once: true });
    document.head.appendChild(script);

    window.setTimeout(() => reject(new Error("SDK 로드 시간 초과")), SDK_TIMEOUT_MS);
  });
}

export function PlaceMap({
  lat,
  lng,
  name,
}: {
  lat: number;
  lng: number;
  name: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<MapState>("loading");

  const appKey = process.env.NEXT_PUBLIC_KAKAO_JS_KEY ?? "";
  const mapLink = `https://map.kakao.com/link/map/${encodeURIComponent(name)},${lat},${lng}`;

  useEffect(() => {
    let cancelled = false;

    if (!appKey) {
      setState("unavailable");
      return;
    }

    loadSdk(appKey)
      .then((maps) => {
        if (cancelled || !containerRef.current) return;
        const center = new maps.LatLng(lat, lng);
        const map = new maps.Map(containerRef.current, { center, level: LEVEL_PLACE });
        map.setDraggable(false);
        map.setZoomable(false);
        new maps.Marker({ position: center, map });
        setState("ready");
      })
      .catch(() => {
        if (!cancelled) setState("unavailable");
      });

    return () => {
      cancelled = true;
    };
  }, [appKey, lat, lng]);

  return (
    <section className="border-t border-white/10 px-5 py-6">
      <h2 className="mb-3 text-sm font-semibold text-[#98A2B3]">지도</h2>

      <a
        href={mapLink}
        target="_blank"
        rel="noreferrer noopener"
        className="relative block h-48 w-full overflow-hidden rounded-2xl border border-white/10 bg-[#171B22]"
      >
        <div ref={containerRef} className="h-full w-full" aria-hidden />

        {state !== "ready" ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#171B22] px-6 text-center">
            {state === "loading" ? (
              <div className="h-20 w-32 animate-pulse rounded-xl bg-white/5" />
            ) : (
              <>
                <span aria-hidden className="text-2xl">
                  📍
                </span>
                <p className="text-xs break-keep text-[#98A2B3]">
                  {lat.toFixed(5)}, {lng.toFixed(5)}
                  <br />
                  카카오맵에서 열어 보기
                </p>
              </>
            )}
          </div>
        ) : null}
      </a>
    </section>
  );
}

export default PlaceMap;
