"use client";

/**
 * S1 홈 — 다트 설정 + 던지기 제스처 + S2 연출.
 *
 * 설계 정본: `화면구성도.md` §3.1(와이어프레임) · §3.2(구성 요소) · §3.3(상태) · §3.4(전이)
 *            `화면구성도.md` §4.1(3단계 시퀀스) · §4.2(구성 요소) · §4.3(상태)
 *            `API데이터설계.md` §7.2(빈 조합 처리) · §8(Route)
 *
 * 사용자 입력을 **범위·테마 둘**로 줄이고 던지기로 연결하는 화면입니다(D-4 로 반경·기준점
 * 입력이 제거됐습니다). 후보 건수는 `/api/pool/stats` 한 번으로 받아 두고,
 * **0건 조합은 던지기 전에 막습니다**(§7.2 — 화면과 서버 양쪽에 같은 판정을 둡니다).
 *
 * 구·군별 건수를 보조 색으로 작게 두는 이유는 §3.2 주석에 있습니다 — 0건을 고르고 던졌을 때의
 * 빈손이 더 나쁜 경험이라 표기하되, "많은 곳을 고르자" 는 유인은 최소화합니다.
 *
 * ── 던지기가 하나의 손동작이 된 뒤의 구조 ──────────────────────────────────
 * 던지기 버튼 자리에 **잡아 당겼다 놓는 다트**가 들어왔고, S2 연출은 화면을 옮기지 않고
 * 이 화면 위에서 이어집니다(다트가 이 화면의 지도에 꽂히므로 손동작이 끊기지 않습니다).
 * 연출 진행은 `useDartSequence`, 손에 잡히는 부분은 `DartThrowZone`,
 * 날아가는 다트는 `DartFlight` 가 맡습니다.
 *
 * **조준은 성립하지 않습니다.** 서버로 보내는 것은 예전과 같이 범위·테마 둘뿐이고
 * (`requestThrow` 는 인자가 없습니다), 다트가 도착하는 화면 좌표는 **지도 상자 한가운데로
 * 고정**입니다. 어느 쪽으로 당겼든 지도가 서버가 정한 구·군으로 움직여 그 자리를 밝힙니다.
 * 범위를 좁히고 싶은 사용자를 위한 자리는 D-4(범위 선택)에 이미 있습니다.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { BusanMap, type MapFocus } from "@/components/home/BusanMap";
import { DartFlight } from "@/components/home/DartFlight";
import { DartGlyph } from "@/components/home/DartGlyph";
import { DartThrowZone } from "@/components/home/DartThrowZone";
import { useDartSequence, type DartHit, type DartOutcome } from "@/components/home/useDartSequence";
import { recordThrow, todayThrowCount } from "@/lib/device";
import { themeIcon, themeLabel } from "@/lib/format";
import { usePrefersReducedMotion } from "@/lib/motion";
import { THEME_KEYS, type ThemeKey } from "@/lib/theme";

// ── 서버 응답 모양 (`/api/pool/stats`) ───────────────────────────────────────

type ThemeCounts = Record<ThemeKey | "all", number>;

interface SigunguPool {
  code: string;
  name: string;
  centerLat: number;
  centerLng: number;
  isLowVisit: boolean;
  counts: ThemeCounts;
}

interface PoolStats {
  sigungu: SigunguPool[];
  totals: ThemeCounts;
  updatedAt: string | null;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; stats: PoolStats }
  | { kind: "missing_config"; message: string; detail?: string }
  | { kind: "error"; message: string };

/** 테마 버튼 5종 (§2.3 · §3.2-4). 첫 칸은 '전체' = 테마 미선택입니다. */
const THEME_CHOICES: (ThemeKey | null)[] = [null, ...THEME_KEYS];

/** 구·군 확정 단계의 확대 단계 — 구·군 하나가 화면에 차게 (§4.1 2단계) */
const LEVEL_DISTRICT_REVEAL = 7;
/** 좌표 확정 단계 — 꽂힌 자리로 한 단계 더 (§4.1 3단계) */
const LEVEL_PIN_REVEAL = 4;

export function DartSetup() {
  const router = useRouter();
  const reducedMotion = usePrefersReducedMotion();

  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  const [scope, setScope] = useState<string | null>(null); // null = 부산 전체
  const [theme, setTheme] = useState<ThemeKey | null>(null); // null = 전체
  const [sheetOpen, setSheetOpen] = useState(false);
  const [throwError, setThrowError] = useState<string | null>(null);
  const [emptyNotice, setEmptyNotice] = useState(false);
  const [todayCount, setTodayCount] = useState(0);
  const [offline, setOffline] = useState(false);

  // 다트가 출발하는 자리와 꽂히는 자리 — 비행 궤적을 재는 두 지점입니다.
  const dartRef = useRef<HTMLDivElement | null>(null);
  const mapBoxRef = useRef<HTMLDivElement | null>(null);

  // ── 집계표 조회 ────────────────────────────────────────────────────────────
  const fetchStats = useCallback(async () => {
    setLoad({ kind: "loading" });
    try {
      const res = await fetch("/api/pool/stats", { cache: "no-store" });
      const body = await res.json();

      if (body?.ok) {
        setLoad({ kind: "ready", stats: body as PoolStats });
        return;
      }
      if (body?.reason === "missing_config") {
        setLoad({ kind: "missing_config", message: body.message, detail: body.detail });
        return;
      }
      setLoad({ kind: "error", message: "후보를 불러오지 못했습니다." });
    } catch {
      setLoad({ kind: "error", message: "후보를 불러오지 못했습니다." });
    }
  }, []);

  useEffect(() => {
    void fetchStats();
  }, [fetchStats]);

  // 오늘 던진 횟수는 브라우저 저장소에 있으므로 마운트 후에 읽습니다(서버 렌더와 어긋나지 않게).
  useEffect(() => {
    setTodayCount(todayThrowCount());
  }, []);

  // 오프라인 배너 (§2.4)
  useEffect(() => {
    const sync = () => setOffline(!navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  // ── 파생값 ────────────────────────────────────────────────────────────────
  const stats = load.kind === "ready" ? load.stats : null;

  const selectedSigungu = useMemo(
    () => (scope ? (stats?.sigungu.find((s) => s.code === scope) ?? null) : null),
    [scope, stats],
  );

  const themeSlot: ThemeKey | "all" = theme ?? "all";

  /** 현재 조합(범위 × 테마)의 후보 건수. 이 값이 0이면 던지기를 막습니다. */
  const currentCount = useMemo(() => {
    if (!stats) return null;
    return scope
      ? (selectedSigungu?.counts[themeSlot] ?? 0)
      : stats.totals[themeSlot];
  }, [stats, scope, selectedSigungu, themeSlot]);

  const scopeLabel = selectedSigungu?.name ?? "부산 전체";

  const blockedByCombination = currentCount !== null && currentCount === 0;
  const canThrow = load.kind === "ready" && !blockedByCombination && !offline;

  /**
   * 던질 수 없을 때 다트 옆에 붙는 한 줄.
   * 0건 조합의 **이유와 다음 행동**은 아래 §3.3 안내 상자가 그대로 맡습니다
   * (여기서는 "왜 다트가 흐린가" 만 답합니다 — 두 자리가 서로를 대신하지 않습니다).
   */
  const notReadyReason = canThrow
    ? null
    : offline
      ? "연결이 끊겨 지금은 던질 수 없어요"
      : blockedByCombination
        ? "이 조합에는 던질 곳이 없어요"
        : load.kind === "loading"
          ? "다트를 준비하는 중…"
          : "지금은 던질 수 없어요";

  // ── 던지기 ────────────────────────────────────────────────────────────────

  /**
   * 서버 던지기. **인자가 없습니다** — 제스처에서 나온 값(세기·방향)이 결과로 갈 통로를
   * 두지 않기 위해서입니다. 서버로 가는 것은 예전과 같이 범위·테마 둘뿐이고,
   * 구·군 균등 추첨은 그대로 서버가 합니다(D-3).
   */
  const requestThrow = useCallback(async (): Promise<DartOutcome> => {
    setThrowError(null);
    setEmptyNotice(false);
    try {
      const res = await fetch("/api/throw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope, theme }),
      });
      const body = await res.json();

      // 빈 조합은 오류가 아니라 안내입니다 (AD-10). 화면을 연 사이 데이터가 바뀐 경우입니다.
      if (body?.ok && body.empty) return { kind: "empty" };
      if (!body?.ok || !body.throwId) return { kind: "error" };

      return {
        kind: "hit",
        throwId: String(body.throwId),
        sigunguCode: String(body.sigungu?.code ?? ""),
        sigunguName: String(body.sigungu?.name ?? ""),
        lat: Number(body.place?.lat ?? 0),
        lng: Number(body.place?.lng ?? 0),
      };
    } catch {
      return { kind: "error" };
    }
  }, [scope, theme]);

  const onHit = useCallback(
    (hit: DartHit) => {
      setTodayCount(recordThrow());
      router.push(`/result/${hit.throwId}`);
    },
    [router],
  );

  const onEmpty = useCallback(() => {
    setEmptyNotice(true);
    void fetchStats();
  }, [fetchStats]);

  const onError = useCallback(() => {
    setThrowError("다트를 놓쳤어요. 다시 던져 볼까요?");
  }, []);

  const sequence = useDartSequence({
    enabled: canThrow,
    reducedMotion,
    dartRef,
    targetRef: mapBoxRef,
    requestThrow,
    onHit,
    onEmpty,
    onError,
  });

  const { stage } = sequence;
  /** 연출이 도는 동안에는 설정을 만지지 못하게 하고 시선을 지도에 둡니다. */
  const inSequence =
    stage === "flying" || stage === "waiting" || stage === "district" || stage === "pinned";
  /** 다트가 지도에 꽂혀 있는 구간 */
  const dartLanded = stage === "waiting" || stage === "district" || stage === "pinned";
  const revealing = stage === "district" || stage === "pinned";
  const dimmed = inSequence || stage === "pulling" || stage === "short";

  // 지도 카메라 — 평소에는 선택한 범위, 연출 중에는 서버가 정한 구·군 → 좌표 (§4.1 2·3단계)
  const hit = sequence.hit;
  const hitSigungu = hit ? (stats?.sigungu.find((s) => s.code === hit.sigunguCode) ?? null) : null;

  const mapFocus: MapFocus | null = useMemo(() => {
    if (hit && stage === "district") {
      return {
        name: hit.sigunguName,
        lat: hitSigungu?.centerLat ?? hit.lat,
        lng: hitSigungu?.centerLng ?? hit.lng,
        level: LEVEL_DISTRICT_REVEAL,
      };
    }
    if (hit && stage === "pinned") {
      return { name: hit.sigunguName, lat: hit.lat, lng: hit.lng, level: LEVEL_PIN_REVEAL };
    }
    return selectedSigungu
      ? {
          name: selectedSigungu.name,
          lat: selectedSigungu.centerLat,
          lng: selectedSigungu.centerLng,
        }
      : null;
  }, [hit, hitSigungu, stage, selectedSigungu]);

  // ── 화면 ──────────────────────────────────────────────────────────────────

  if (load.kind === "missing_config") {
    return (
      <section className="mx-5 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-5 text-sm leading-relaxed text-[#F2F4F7]">
        <h2 className="mb-2 text-base font-semibold">데이터베이스 설정이 아직 없습니다</h2>
        <p>{load.message}</p>
        {load.detail ? <p className="mt-2 text-xs text-[#98A2B3]">{load.detail}</p> : null}
      </section>
    );
  }

  return (
    <section className="px-5 pb-10">
      {offline ? (
        <div className="mb-4 rounded-xl bg-[#FF4D4D]/15 px-4 py-2 text-center text-sm text-[#FF9B9B]">
          연결이 끊겼습니다
        </div>
      ) : null}

      {load.kind === "error" ? (
        <div className="rounded-2xl border border-white/10 bg-[#171B22] p-6 text-center">
          <p className="text-sm text-[#F2F4F7]">{load.message}</p>
          <button
            type="button"
            onClick={() => void fetchStats()}
            className="mt-4 min-h-11 rounded-2xl bg-[#FF4D4D] px-6 text-sm font-semibold text-white"
          >
            다시 시도
          </button>
        </div>
      ) : (
        <>
          {/* 다트가 꽂히는 판 — 이 상자의 한가운데가 유일한 도착 지점입니다. */}
          <div ref={mapBoxRef} className="relative">
            <BusanMap focus={mapFocus} />

            {/* 구·군만 밝게, 나머지는 어둡게 (§4.1 2단계) */}
            {revealing ? (
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 rounded-2xl transition-opacity duration-300"
                style={{
                  background:
                    "radial-gradient(circle at 50% 50%, rgba(0,0,0,0) 16%, rgba(0,0,0,0.38) 42%, rgba(0,0,0,0.78) 72%)",
                }}
              />
            ) : null}

            {/* 꽂힌 자국 */}
            {dartLanded ? (
              <div
                aria-hidden
                className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
              >
                <span className="block h-9 w-9 animate-ping rounded-full border-2 border-[#FF4D4D]/70" />
              </div>
            ) : null}
            {dartLanded ? (
              <div
                aria-hidden
                className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2"
              >
                <DartGlyph size={28} glow />
              </div>
            ) : null}

            {/* 건너뛰기 (§4.2-4) */}
            {inSequence ? (
              <button
                type="button"
                onClick={sequence.skip}
                className="absolute right-3 top-3 z-10 min-h-9 rounded-full bg-black/60 px-4 text-xs text-white"
              >
                건너뛰기
              </button>
            ) : null}
          </div>

          <div
            className={`transition-opacity duration-300 ${
              dimmed ? "pointer-events-none opacity-35" : "opacity-100"
            }`}
          >
            {/* 범위 (§3.2-3) */}
            <h2 className="mt-7 mb-2 text-sm font-semibold text-[#98A2B3]">범위</h2>
            {load.kind === "loading" ? (
              <div className="h-12 w-full animate-pulse rounded-2xl bg-white/5" />
            ) : (
              <button
                type="button"
                onClick={() => setSheetOpen(true)}
                className="flex min-h-12 w-full items-center justify-between rounded-2xl border border-white/10 bg-[#171B22] px-4 text-left text-[#F2F4F7]"
              >
                <span className="font-medium">{scopeLabel}</span>
                <span className="text-[#98A2B3]">
                  {currentCount !== null ? `${currentCount.toLocaleString("ko-KR")}곳 ` : ""}▾
                </span>
              </button>
            )}

            {/* 테마 (§3.2-4) */}
            <h2 className="mt-6 mb-2 text-sm font-semibold text-[#98A2B3]">테마</h2>
            {load.kind === "loading" ? (
              <div className="grid grid-cols-5 gap-2">
                {THEME_CHOICES.map((_, i) => (
                  <div key={i} className="h-20 animate-pulse rounded-2xl bg-white/5" />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-5 gap-2">
                {THEME_CHOICES.map((choice) => {
                  const key = choice ?? "all";
                  const selected = theme === choice;
                  const count = scope
                    ? (selectedSigungu?.counts[key] ?? 0)
                    : (stats?.totals[key] ?? 0);
                  return (
                    <button
                      key={key}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => {
                        setTheme(choice);
                        setEmptyNotice(false);
                      }}
                      className={`flex min-h-20 flex-col items-center justify-center gap-1 rounded-2xl border px-1 py-2 text-center transition ${
                        selected
                          ? "border-[#FF4D4D] bg-[#FF4D4D]/15 text-[#F2F4F7]"
                          : "border-white/10 bg-[#171B22] text-[#98A2B3]"
                      } ${count === 0 ? "opacity-45" : ""}`}
                    >
                      <span aria-hidden className="text-lg leading-none">
                        {themeIcon(choice)}
                      </span>
                      <span className="text-[11px] leading-tight break-keep">
                        {themeLabel(choice)}
                      </span>
                      <span className="text-[10px] leading-none text-[#98A2B3]">{count}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* 0건 조합 안내 (§3.3 "조합 빈값") */}
            {blockedByCombination || emptyNotice ? (
              <div className="mt-5 rounded-2xl border border-white/10 bg-[#171B22] p-4 text-center">
                <p className="text-sm text-[#F2F4F7]">
                  {scope
                    ? `${scopeLabel}에는 아직 ${themeLabel(theme)} 장소가 없어요`
                    : "이 조합에는 아직 등록된 장소가 없어요"}
                </p>
                {theme !== null ? (
                  <button
                    type="button"
                    onClick={() => {
                      setTheme(null);
                      setEmptyNotice(false);
                    }}
                    className="mt-3 min-h-11 rounded-2xl border border-white/20 px-5 text-sm text-[#F2F4F7]"
                  >
                    테마를 전체로
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setScope(null);
                      setEmptyNotice(false);
                    }}
                    className="mt-3 min-h-11 rounded-2xl border border-white/20 px-5 text-sm text-[#F2F4F7]"
                  >
                    범위를 부산 전체로
                  </button>
                )}
              </div>
            ) : null}
          </div>

          {/* 던지기 (§3.2-5 → §4.1 1단계) — 버튼이 아니라 잡아 당겼다 놓는 다트입니다. */}
          <DartThrowZone
            sequence={sequence}
            dartRef={dartRef}
            enabled={canThrow}
            notReadyReason={notReadyReason}
            reducedMotion={reducedMotion}
            districtName={hit?.sigunguName ?? null}
          />

          {throwError ? (
            <p className="mt-1 text-center text-sm text-[#FF9B9B]">{throwError}</p>
          ) : null}

          <div
            className={`transition-opacity duration-300 ${
              dimmed ? "pointer-events-none opacity-35" : "opacity-100"
            }`}
          >
            {/* 오늘 N번째 (§3.2-6 · D-16) */}
            <p className="mt-4 text-center text-sm text-[#98A2B3]">
              {todayCount > 0 ? `오늘 ${todayCount}번째 다트` : "오늘의 첫 다트"}
            </p>

            {/* 장소 등록 (§3.2-7). S5 는 이후 구간 작업이라 지금은 안내만 둡니다. */}
            <div className="mt-6 border-t border-white/10 pt-5 text-center text-sm text-[#98A2B3]">
              숨은 곳을 아시나요? 장소 등록은 곧 열립니다
            </div>

            {/*
              공공데이터 연동 확인 화면(AD-14). 이용자에게 크게 보일 이유는 없지만,
              공공데이터포털 운영계정 승인요건 ③ 을 확인하는 사람이 찾을 수 있어야 합니다.
            */}
            <p className="mt-3 text-center text-xs text-[#98A2B3]/70">
              <Link href="/data" className="underline underline-offset-2">
                공공데이터 연동 확인
              </Link>
            </p>
          </div>
        </>
      )}

      {/* 날아가는 다트 — 화면 위 한 겹 (§4.1 1단계) */}
      <DartFlight flight={sequence.flight} />

      {/* 구·군 시트 (§3.2-3) — 0건은 흐리게 + 선택 불가 */}
      {sheetOpen && stats ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60"
          role="dialog"
          aria-modal="true"
          aria-label="범위 선택"
          onClick={() => setSheetOpen(false)}
        >
          <div
            className="max-h-[75vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-[#171B22] p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-semibold text-[#F2F4F7]">범위 선택</h3>
              <span className="text-xs text-[#98A2B3]">{themeLabel(theme)} 기준</span>
            </div>

            <ul className="space-y-1">
              <li>
                <button
                  type="button"
                  onClick={() => {
                    setScope(null);
                    setSheetOpen(false);
                    setEmptyNotice(false);
                  }}
                  className={`flex min-h-12 w-full items-center justify-between rounded-xl px-4 text-left ${
                    scope === null ? "bg-[#FF4D4D]/15 text-[#F2F4F7]" : "text-[#F2F4F7]"
                  }`}
                >
                  <span>부산 전체</span>
                  <span className="text-xs text-[#98A2B3]">
                    {stats.totals[themeSlot].toLocaleString("ko-KR")}곳
                  </span>
                </button>
              </li>

              {stats.sigungu.map((s) => {
                const count = s.counts[themeSlot] ?? 0;
                const disabled = count === 0;
                return (
                  <li key={s.code}>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => {
                        setScope(s.code);
                        setSheetOpen(false);
                        setEmptyNotice(false);
                      }}
                      className={`flex min-h-12 w-full items-center justify-between rounded-xl px-4 text-left ${
                        disabled
                          ? "cursor-not-allowed text-[#98A2B3] opacity-40"
                          : scope === s.code
                            ? "bg-[#FF4D4D]/15 text-[#F2F4F7]"
                            : "text-[#F2F4F7]"
                      }`}
                    >
                      <span>{s.name}</span>
                      <span className="text-xs text-[#98A2B3]">
                        {disabled ? "0곳" : `${count.toLocaleString("ko-KR")}곳`}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>

            <button
              type="button"
              onClick={() => setSheetOpen(false)}
              className="mt-4 min-h-12 w-full rounded-2xl border border-white/15 text-sm text-[#F2F4F7]"
            >
              닫기
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

export default DartSetup;
