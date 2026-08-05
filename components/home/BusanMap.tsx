"use client";

/**
 * S1 부산 지도 — 카카오맵 JS SDK.
 *
 * 설계 정본: `화면구성도.md` §3.2-2 · §3.3("지도 로드 실패" 상태)
 *
 * 이 지도는 **과녁**입니다(D-36). 다트를 당기면 이 상자 위에 조준점이 따라다니고,
 * 놓으면 겨눈 지점의 구·군이 정해집니다. 그래서 지금 지도가 어느 범위를 비추고 있는지를
 * 바깥(`DartSetup`)에 알려 줘야 합니다 — `onViewport` 가 그 통로입니다.
 * 조준점을 그리는 일과 구·군을 고르는 일은 이 파일이 하지 않습니다(`lib/aim.ts`).
 *
 *   - 확대·이동 제스처 비활성 (`setDraggable(false)` · `setZoomable(false)`)
 *   - 마커 없음 (결과를 미리 노출하지 않습니다 — 조준 표식은 이 위에 덧그리는 층입니다)
 *   - 범위가 특정 구·군이면 그 중심으로 카메라 이동
 *
 * **지도가 없어도 던지기는 그대로 됩니다.** 다트는 DB 집계표에서만 돌기 때문입니다(D-6).
 * 그래서 SDK 로드 실패·키 미설정은 오류 화면이 아니라 대체 패널로 처리하고,
 * 그때는 `onViewport(null)` 로 **조준이 불가능함**을 알려 균등 추첨으로 되돌립니다.
 *
 * 앱키는 `NEXT_PUBLIC_KAKAO_JS_KEY` 입니다. 브라우저에 공개되는 값이며,
 * 서버 전용 키(REST 키·service_role)는 이 파일에 들어오지 않습니다.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import type { MapViewport } from "@/lib/aim";

/** 부산 시청 부근 — 부산 전체를 볼 때의 중심 */
const BUSAN_CENTER = { lat: 35.1798, lng: 129.0750 };
const LEVEL_CITY = 9;
const LEVEL_DISTRICT = 6;
const SDK_TIMEOUT_MS = 8000;
const SCRIPT_ID = "kakao-maps-sdk";

// SDK 가 실제로 쓰는 부분만 좁게 선언합니다. 전역 any 를 두지 않기 위해서입니다.
interface KakaoLatLng {
  getLat(): number;
  getLng(): number;
}
interface KakaoLatLngBounds {
  getSouthWest(): KakaoLatLng;
  getNorthEast(): KakaoLatLng;
}
interface KakaoMap {
  setCenter(latlng: KakaoLatLng): void;
  setLevel(level: number): void;
  panTo(latlng: KakaoLatLng): void;
  setDraggable(draggable: boolean): void;
  setZoomable(zoomable: boolean): void;
  relayout(): void;
  getBounds(): KakaoLatLngBounds;
}
interface KakaoEventBus {
  addListener(target: KakaoMap, type: string, handler: () => void): void;
  removeListener(target: KakaoMap, type: string, handler: () => void): void;
}
interface KakaoMaps {
  load(callback: () => void): void;
  LatLng: new (lat: number, lng: number) => KakaoLatLng;
  Map: new (
    container: HTMLElement,
    options: { center: KakaoLatLng; level: number },
  ) => KakaoMap;
  event: KakaoEventBus;
}
declare global {
  interface Window {
    kakao?: { maps?: KakaoMaps };
  }
}

type MapState = "loading" | "ready" | "unavailable";

function loadSdk(appKey: string): Promise<KakaoMaps> {
  return new Promise((resolve, reject) => {
    if (window.kakao?.maps?.Map) {
      resolve(window.kakao.maps);
      return;
    }

    const timer = window.setTimeout(
      () => reject(new Error("카카오맵 SDK 응답이 없습니다.")),
      SDK_TIMEOUT_MS,
    );

    const finish = () => {
      const maps = window.kakao?.maps;
      if (!maps) {
        window.clearTimeout(timer);
        reject(new Error("카카오맵 SDK 를 읽지 못했습니다."));
        return;
      }
      maps.load(() => {
        window.clearTimeout(timer);
        resolve(maps);
      });
    };

    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", finish, { once: true });
      existing.addEventListener(
        "error",
        () => {
          window.clearTimeout(timer);
          reject(new Error("카카오맵 SDK 를 내려받지 못했습니다."));
        },
        { once: true },
      );
      return;
    }

    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.async = true;
    // autoload=false 로 받아 두고 maps.load() 로 초기화 시점을 우리가 정합니다.
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(appKey)}&autoload=false`;
    script.onload = finish;
    script.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error("카카오맵 SDK 를 내려받지 못했습니다."));
    };
    document.head.appendChild(script);
  });
}

export interface MapFocus {
  name: string;
  lat: number;
  lng: number;
  /**
   * 확대 단계. 비우면 구·군 보기(`LEVEL_DISTRICT`)입니다.
   * S2 연출이 구·군 확정 → 좌표 확정으로 넘어갈 때 한 단계 더 당겨 보기 위해 씁니다
   * (`화면구성도.md` §4.1 2·3단계).
   */
  level?: number;
}

export function BusanMap({
  focus,
  onViewport,
}: {
  focus: MapFocus | null;
  /**
   * 지금 비추는 범위를 알립니다(조준용). 지도를 못 쓰면 `null` 이 갑니다.
   * 카메라가 멈출 때마다(`idle`) 다시 보냅니다.
   */
  onViewport?: (viewport: MapViewport | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<KakaoMap | null>(null);
  const mapsRef = useRef<KakaoMaps | null>(null);
  const [state, setState] = useState<MapState>("loading");

  const appKey = process.env.NEXT_PUBLIC_KAKAO_JS_KEY ?? "";

  // 콜백이 매 렌더 새로 와도 지도를 다시 만들지 않도록 ref 로 받아 둡니다.
  const onViewportRef = useRef(onViewport);
  useEffect(() => {
    onViewportRef.current = onViewport;
  }, [onViewport]);

  const report = useCallback(() => {
    const map = mapRef.current;
    const el = containerRef.current;
    const notify = onViewportRef.current;
    if (!notify) return;
    if (!map || !el) {
      notify(null);
      return;
    }
    try {
      const bounds = map.getBounds();
      const sw = bounds.getSouthWest();
      const ne = bounds.getNorthEast();
      notify({
        swLat: sw.getLat(),
        swLng: sw.getLng(),
        neLat: ne.getLat(),
        neLng: ne.getLng(),
        width: el.clientWidth,
        height: el.clientHeight,
      });
    } catch {
      notify(null);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (!appKey) {
      setState("unavailable");
      onViewportRef.current?.(null);
      return;
    }

    loadSdk(appKey)
      .then((maps) => {
        if (cancelled || !containerRef.current) return;
        const map = new maps.Map(containerRef.current, {
          center: new maps.LatLng(BUSAN_CENTER.lat, BUSAN_CENTER.lng),
          level: LEVEL_CITY,
        });
        // 확대·이동 제스처는 막습니다 (§3.2-2). 이 상자 위에서 도는 손동작은 조준 하나뿐입니다.
        map.setDraggable(false);
        map.setZoomable(false);
        mapRef.current = map;
        mapsRef.current = maps;
        maps.event.addListener(map, "idle", report);
        setState("ready");
        report();
      })
      .catch(() => {
        if (cancelled) return;
        setState("unavailable");
        onViewportRef.current?.(null);
      });

    return () => {
      cancelled = true;
      const map = mapRef.current;
      const maps = mapsRef.current;
      if (map && maps) {
        try {
          maps.event.removeListener(map, "idle", report);
        } catch {
          // 이미 정리됐으면 그만입니다.
        }
      }
    };
  }, [appKey, report]);

  // 범위가 바뀌면 카메라만 옮깁니다. 마커는 두지 않습니다.
  useEffect(() => {
    const map = mapRef.current;
    const maps = mapsRef.current;
    if (!map || !maps || state !== "ready") return;

    if (focus) {
      map.setLevel(focus.level ?? LEVEL_DISTRICT);
      map.panTo(new maps.LatLng(focus.lat, focus.lng));
    } else {
      map.setLevel(LEVEL_CITY);
      map.panTo(new maps.LatLng(BUSAN_CENTER.lat, BUSAN_CENTER.lng));
    }
    // 카메라가 멈추면 `idle` 이 다시 알려 줍니다.
  }, [focus, state]);

  // 화면 크기가 바뀌면 상자도 비추는 범위도 달라집니다.
  useEffect(() => {
    if (state !== "ready") return;
    const onResize = () => {
      mapRef.current?.relayout();
      report();
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [state, report]);

  return (
    <div className="relative h-56 w-full overflow-hidden rounded-2xl border border-white/10 bg-[#171B22] sm:h-72">
      <div ref={containerRef} className="h-full w-full" aria-hidden />

      {state !== "ready" ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#171B22] px-6 text-center">
          {state === "loading" ? (
            <>
              <div className="h-24 w-40 animate-pulse rounded-xl bg-white/5" />
              <p className="text-xs text-[#98A2B3]">지도를 불러오는 중…</p>
            </>
          ) : (
            <>
              <div
                aria-hidden
                className="flex h-24 w-40 items-center justify-center rounded-xl bg-gradient-to-br from-[#0D2E3D] to-[#17677A] text-lg font-semibold tracking-[0.3em] text-white/70"
              >
                부산
              </div>
              <p className="text-xs text-[#98A2B3]">
                지도를 불러오지 못했습니다. 다트는 그대로 던질 수 있어요.
              </p>
            </>
          )}
        </div>
      ) : null}

      {state === "ready" && focus ? (
        <div className="pointer-events-none absolute left-3 top-3 rounded-full bg-black/55 px-3 py-1 text-xs text-white">
          {focus.name}
        </div>
      ) : null}
    </div>
  );
}

export default BusanMap;
