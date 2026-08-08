"use client";

/**
 * S5 — 위치 고르기 (§7.1 "지도 이동 → 중앙 고정 핀").
 *
 * 설계 정본: `화면구성도.md` §7.1(와이어프레임) · §7.3(위치 = 부산 내부) · §7.4(지도 로드 실패)
 *
 * 핀이 지도 위를 움직이지 않습니다
 * -------------------------------
 * 핀은 상자 한가운데에 **고정**돼 있고 지도가 그 아래에서 움직입니다. 마커를 끌게 하지 않은
 * 이유는 손가락이 마커를 가려 정확히 놓기 어렵고, 화면 밖으로 나간 마커를 다시 찾아야 하는
 * 상태가 생기기 때문입니다. 고정 핀은 언제나 화면 한가운데에 있습니다.
 *
 * 좌표는 지도가 **멈춘 뒤에만** 올려보냅니다(`idle` 이벤트). 끄는 동안 매 프레임 올리면
 * 역지오코딩이 초당 수십 번 나갑니다.
 *
 * 검색은 정상 경로입니다 (`D-53`)
 * -------------------------------
 * **검색창은 지도가 뜨든 안 뜨든 항상 같은 자리에 있습니다**(`D-53-3`). 이전에는 지도 로드
 * 실패(§7.4) 분기 안에만 있어서, 지도가 정상일 때는 검색이라는 수단이 **존재하지 않는
 * 것처럼 보였습니다.** 접거나 버튼 뒤에 두지 않은 것도 같은 이유입니다 — 있는 줄 모르고
 * 지나치면 없는 것과 같습니다.
 *
 * **고른 결과가 최종 좌표는 아닙니다**(`D-53-1`). 검색은 지도를 그 근처로 데려다주고,
 * 최종 좌표는 종전대로 **화면 한가운데 고정 핀**이 정합니다. 건물 입구처럼 사용자만 아는
 * 자리로 미세 조정할 여지를 남기고, 기존 핀 로직을 한 줄도 바꾸지 않습니다.
 *
 * **그래서 결과를 고르면 지도도 함께 옮깁니다** — `panTo` 가 빠지면 지도는 원래 자리에
 * 그대로 있고, 그 상태에서 지도가 멈출 때 나오는 `idle` 이 **검색으로 넣은 좌표를 도로
 * 덮어씁니다.** 지도가 없던 폴백 시절에는 드러나지 않던 자리입니다.
 *
 * 검색은 우리 Route(`/api/geo/search`)를 거칩니다 — 카카오 REST 키는 서버 전용이라
 * 브라우저가 직접 부를 수 없고(④ §2), 그 Route 가 **부산 경계 밖을 이미 걸러 냅니다.**
 *
 * 지도가 없을 때 (§7.4)
 * --------------------
 * SDK 가 막히거나 앱키가 없으면 지도 자리를 빼고 검색만 남깁니다. 등록 자체를 포기하게
 * 두지 않는 자리이며, 이때는 **고른 결과가 곧 최종 좌표**입니다 — 옮길 지도가 없습니다.
 *
 * S1·S4 의 지도와 마찬가지로 브라우저 위치 권한은 요청하지 않습니다 (AD-9 · §2.5).
 */

import { useCallback, useEffect, useRef, useState } from "react";

const SDK_TIMEOUT_MS = 8000;
const SCRIPT_ID = "kakao-maps-sdk";

/** 부산 시청 부근 — 처음 열었을 때의 중심 */
export const START_CENTER = { lat: 35.1798, lng: 129.075 };
/** 처음 확대 단계. 동네가 보이는 정도로 시작해 사용자가 바로 좁힐 수 있게 합니다 */
const START_LEVEL = 6;

/**
 * 검색 결과로 옮겨 갈 때의 확대 단계 (`M-IMP11-1`).
 *
 * 옮기기만 하고 확대 단계를 그대로 두면, 동네가 보이는 배율에서 핀이 건물 하나를 가리키지
 * 못합니다. **다만 사용자가 이미 더 좁혀 둔 상태면 넓히지 않습니다** — 검색이 사용자의 조작을
 * 되돌리는 쪽으로 움직이면 안 됩니다.
 */
const PICK_LEVEL = 3;

// SDK 가운데 이 화면이 쓰는 부분만 좁게 봅니다. `window.kakao` 전역은 S1 지도가 이미
// 자기 모양으로 선언해 두었으므로 여기서 다시 선언하지 않습니다(같은 이름 재선언 충돌 방지).
interface KakaoLatLng {
  getLat(): number;
  getLng(): number;
}
interface PinKakaoMap {
  getCenter(): KakaoLatLng;
  setCenter(latlng: KakaoLatLng): void;
  panTo(latlng: KakaoLatLng): void;
  getLevel(): number;
  setLevel(level: number): void;
  relayout(): void;
}
interface KakaoEvent {
  addListener(target: unknown, type: string, handler: () => void): void;
  removeListener(target: unknown, type: string, handler: () => void): void;
}
interface PinKakaoMaps {
  load(callback: () => void): void;
  LatLng: new (lat: number, lng: number) => KakaoLatLng;
  Map: new (
    container: HTMLElement,
    options: { center: KakaoLatLng; level: number },
  ) => PinKakaoMap;
  event: KakaoEvent;
}

function readMaps(): PinKakaoMaps | null {
  if (typeof window === "undefined") return null;
  const maps = (window as unknown as { kakao?: { maps?: PinKakaoMaps } }).kakao?.maps;
  return maps ?? null;
}

function loadSdk(appKey: string): Promise<PinKakaoMaps> {
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

type MapState = "loading" | "ready" | "unavailable";

export interface SearchHit {
  label: string;
  detail: string | null;
  lat: number;
  lng: number;
}

export function PinMap({
  onMove,
  onPick,
  outsideBusan,
}: {
  /** 지도가 멈출 때마다 한가운데 좌표를 올려보냅니다 */
  onMove: (lat: number, lng: number) => void;
  /** 검색 결과를 골랐을 때 (`D-53-2` — 이름 자동 채움의 재료) */
  onPick?: (hit: SearchHit) => void;
  /** 부산 밖이면 상자 테두리와 경고를 바꿉니다 (§7.4 "부산 밖") */
  outsideBusan: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<PinKakaoMap | null>(null);
  const mapsRef = useRef<PinKakaoMaps | null>(null);
  const [state, setState] = useState<MapState>("loading");
  const [dragging, setDragging] = useState(false);

  // 검색 (§7.1 · `D-53-3` — 지도 상태와 무관하게 항상 있습니다)
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [picked, setPicked] = useState<SearchHit | null>(null);

  const appKey = process.env.NEXT_PUBLIC_KAKAO_JS_KEY ?? "";

  // 부모가 리렌더될 때마다 리스너를 다시 걸지 않도록 최신 콜백만 담아 둡니다.
  const onMoveRef = useRef(onMove);
  useEffect(() => {
    onMoveRef.current = onMove;
  }, [onMove]);

  const onPickRef = useRef(onPick);
  useEffect(() => {
    onPickRef.current = onPick;
  }, [onPick]);

  useEffect(() => {
    let cancelled = false;

    if (!appKey) {
      setState("unavailable");
      return;
    }

    loadSdk(appKey)
      .then((maps) => {
        if (cancelled || !containerRef.current) return;

        const map = new maps.Map(containerRef.current, {
          center: new maps.LatLng(START_CENTER.lat, START_CENTER.lng),
          level: START_LEVEL,
        });
        mapRef.current = map;
        mapsRef.current = maps;
        setState("ready");

        const settle = () => {
          setDragging(false);
          const center = map.getCenter();
          onMoveRef.current(center.getLat(), center.getLng());
        };
        const start = () => setDragging(true);

        maps.event.addListener(map, "idle", settle);
        maps.event.addListener(map, "dragstart", start);
        maps.event.addListener(map, "zoom_start", start);

        // 처음 한 번은 시작 좌표를 그대로 알려 줍니다.
        settle();
      })
      .catch(() => {
        if (!cancelled) setState("unavailable");
      });

    return () => {
      cancelled = true;
    };
  }, [appKey]);

  // ── 폴백 — 주소로 찾기 (§7.4) ──────────────────────────────────────────────
  const search = useCallback(async () => {
    const q = query.trim();
    if (q === "") return;

    setSearching(true);
    setSearchError(null);
    setHits(null);
    try {
      const res = await fetch(`/api/geo/search?q=${encodeURIComponent(q)}`, { cache: "no-store" });
      const body = await res.json();
      if (!body?.ok) {
        setSearchError(
          body?.reason === "unavailable"
            ? "주소 검색을 쓸 수 없습니다. 잠시 뒤 다시 시도해 주세요."
            : "찾지 못했어요.",
        );
        return;
      }
      const found = (body.hits ?? []) as SearchHit[];
      setHits(found);
      if (found.length === 0) setSearchError("부산에서 그 이름의 장소를 찾지 못했어요.");
    } catch {
      setSearchError("찾지 못했어요. 연결을 확인해 주세요.");
    } finally {
      setSearching(false);
    }
  }, [query]);

  /**
   * 결과 하나를 고릅니다 (`D-53-1`·`D-53-2`).
   *
   * **★ 지도가 떠 있으면 지도도 함께 옮겨야 합니다.** 핀은 화면 한가운데 고정이라, 좌표만
   * 올려보내고 지도를 그대로 두면 **지도가 멈출 때 나오는 `idle` 이 원래 중심 좌표로 도로
   * 덮어씁니다.** 지도가 없던 폴백 시절에는 드러나지 않던 자리입니다.
   */
  const pick = useCallback((hit: SearchHit) => {
    setPicked(hit);
    setHits(null);

    const map = mapRef.current;
    const maps = mapsRef.current;
    if (map && maps) {
      if (map.getLevel() > PICK_LEVEL) map.setLevel(PICK_LEVEL);
      map.panTo(new maps.LatLng(hit.lat, hit.lng));
    }

    // 지도가 있으면 뒤따르는 `idle` 이 같은 좌표를 한 번 더 알려 주고, 없으면 이것이 유일한
    // 통지입니다. 어느 쪽이든 값이 같아 부모가 두 경로를 구분할 필요가 없습니다.
    onMoveRef.current(hit.lat, hit.lng);
    onPickRef.current?.(hit);
  }, []);

  // ── 화면 ──────────────────────────────────────────────────────────────────
  //
  // 검색은 **지도 상태와 무관하게 늘 같은 자리**에 있습니다 (`D-53-3`). 지도 위쪽에 두고
  // 지도 안에 겹치지 않은 이유는, 겹치면 손가락이 지도를 끄는 동작과 부딪히고 좁은 화면에서
  // 지도의 절반을 가리기 때문입니다. 자리만 다르고 있고 없고가 갈리지 않습니다.

  const searchBox = (
    <div className="mb-2">
      <div className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void search();
            }
          }}
          placeholder="장소 이름이나 주소로 찾기"
          aria-label="장소 이름이나 주소로 찾기"
          maxLength={80}
          className="min-h-12 w-full rounded-xl border border-white/10 bg-[#171B22] px-4 text-sm text-[#F2F4F7] placeholder:text-[#98A2B3]/60"
        />
        <button
          type="button"
          onClick={() => void search()}
          disabled={searching || query.trim() === ""}
          className="min-h-12 shrink-0 rounded-xl bg-white/10 px-4 text-sm text-[#F2F4F7] disabled:opacity-40"
        >
          {searching ? "찾는 중" : "찾기"}
        </button>
      </div>

      {searchError ? <p className="mt-2 text-xs text-[#FF9B9B]">{searchError}</p> : null}

      {hits && hits.length > 0 ? (
        <ul className="mt-2 space-y-1 rounded-xl border border-white/10 bg-[#171B22] p-1">
          {hits.map((hit) => (
            <li key={`${hit.label}-${hit.lat}-${hit.lng}`}>
              <button
                type="button"
                onClick={() => pick(hit)}
                className="w-full rounded-lg px-3 py-2 text-left text-sm text-[#F2F4F7] hover:bg-white/5"
              >
                <span className="block">{hit.label}</span>
                {hit.detail ? (
                  <span className="block text-xs text-[#98A2B3]">{hit.detail}</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );

  if (state === "unavailable") {
    return (
      <div>
        {searchBox}
        <div className="rounded-2xl border border-white/10 bg-[#171B22] p-4">
          <p className="text-sm break-keep text-[#98A2B3]">
            지도를 불러오지 못했어요. 위 검색으로 위치를 정할 수 있습니다.
          </p>
          {picked ? (
            <p className="mt-3 rounded-xl bg-white/5 px-3 py-2 text-sm text-[#F2F4F7]">
              선택: {picked.label}
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div>
      {searchBox}
      <div
        className={`relative h-60 w-full overflow-hidden rounded-2xl border bg-[#171B22] sm:h-72 ${
          outsideBusan ? "border-[#FF4D4D]/60" : "border-white/10"
        }`}
      >
        <div ref={containerRef} className="h-full w-full" />

        {state === "loading" ? (
          <div className="absolute inset-0 flex items-center justify-center bg-[#171B22]">
            <div className="h-24 w-40 animate-pulse rounded-xl bg-white/5" />
          </div>
        ) : null}

        {/* 한가운데 고정 핀 — 지도가 이 아래에서 움직입니다 (§7.1) */}
        {state === "ready" ? (
          <div
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-full"
          >
            <span
              className={`block text-3xl drop-shadow-[0_2px_4px_rgba(0,0,0,0.6)] transition-transform ${
                dragging ? "-translate-y-1.5" : ""
              }`}
            >
              📍
            </span>
          </div>
        ) : null}

        {state === "ready" ? (
          <p className="pointer-events-none absolute inset-x-0 bottom-2 text-center text-[11px] text-white/70">
            {picked ? "핀을 옮겨 더 정확히 맞출 수 있어요" : "지도를 움직여 핀을 장소에 맞춰 주세요"}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export default PinMap;
