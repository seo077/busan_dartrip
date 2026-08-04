"use client";

/**
 * S1 홈 — 다트 설정.
 *
 * 설계 정본: `화면구성도.md` §3.1(와이어프레임) · §3.2(구성 요소) · §3.3(상태) · §3.4(전이)
 *            `API데이터설계.md` §7.2(빈 조합 처리) · §8(Route)
 *
 * 사용자 입력을 **범위·테마 둘**로 줄이고 던지기로 연결하는 화면입니다(D-4 로 반경·기준점
 * 입력이 제거됐습니다). 후보 건수는 `/api/pool/stats` 한 번으로 받아 두고,
 * **0건 조합은 던지기 전에 막습니다**(§7.2 — 화면과 서버 양쪽에 같은 판정을 둡니다).
 *
 * 구·군별 건수를 보조 색으로 작게 두는 이유는 §3.2 주석에 있습니다 — 0건을 고르고 던졌을 때의
 * 빈손이 더 나쁜 경험이라 표기하되, "많은 곳을 고르자" 는 유인은 최소화합니다.
 *
 * S2 다트 연출은 다음 구간 작업이라, 지금은 던지면 결과 화면으로 바로 갑니다.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { BusanMap, type MapFocus } from "@/components/home/BusanMap";
import { recordThrow, todayThrowCount } from "@/lib/device";
import { themeIcon, themeLabel } from "@/lib/format";
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

export function DartSetup() {
  const router = useRouter();

  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  const [scope, setScope] = useState<string | null>(null); // null = 부산 전체
  const [theme, setTheme] = useState<ThemeKey | null>(null); // null = 전체
  const [sheetOpen, setSheetOpen] = useState(false);
  const [throwing, setThrowing] = useState(false);
  const [throwError, setThrowError] = useState<string | null>(null);
  const [emptyNotice, setEmptyNotice] = useState(false);
  const [todayCount, setTodayCount] = useState(0);
  const [offline, setOffline] = useState(false);

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

  const mapFocus: MapFocus | null = selectedSigungu
    ? { name: selectedSigungu.name, lat: selectedSigungu.centerLat, lng: selectedSigungu.centerLng }
    : null;

  const blockedByCombination = currentCount !== null && currentCount === 0;
  const canThrow =
    load.kind === "ready" && !blockedByCombination && !throwing && !offline;

  // ── 던지기 ────────────────────────────────────────────────────────────────
  const onThrow = useCallback(async () => {
    if (!canThrow) return;
    setThrowing(true);
    setThrowError(null);
    setEmptyNotice(false);

    try {
      const res = await fetch("/api/throw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope, theme }),
      });
      const body = await res.json();

      if (body?.ok && body.empty) {
        // 빈 조합은 오류가 아니라 안내입니다 (AD-10). 화면을 연 사이 데이터가 바뀐 경우입니다.
        setEmptyNotice(true);
        void fetchStats();
        return;
      }
      if (!body?.ok || !body.throwId) {
        setThrowError("다트를 놓쳤어요. 다시 던져 볼까요?");
        return;
      }

      setTodayCount(recordThrow());
      router.push(`/result/${body.throwId}`);
    } catch {
      setThrowError("다트를 놓쳤어요. 다시 던져 볼까요?");
    } finally {
      setThrowing(false);
    }
  }, [canThrow, scope, theme, router, fetchStats]);

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
          <BusanMap focus={mapFocus} />

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

          {/* 던지기 (§3.2-5) */}
          <button
            type="button"
            onClick={() => void onThrow()}
            disabled={!canThrow}
            className={`mt-7 flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl text-base font-semibold transition ${
              canThrow
                ? "bg-[#FF4D4D] text-white"
                : "cursor-not-allowed bg-white/10 text-[#98A2B3]"
            }`}
          >
            <span aria-hidden>🎯</span>
            {throwing ? "던지는 중…" : "다트 던지기"}
          </button>

          {throwError ? (
            <p className="mt-3 text-center text-sm text-[#FF9B9B]">{throwError}</p>
          ) : null}

          {/* 오늘 N번째 (§3.2-6 · D-16) */}
          <p className="mt-5 text-center text-sm text-[#98A2B3]">
            {todayCount > 0 ? `오늘 ${todayCount}번째 다트` : "오늘의 첫 다트"}
          </p>

          {/* 장소 등록 (§3.2-7). S5 는 이후 구간 작업이라 지금은 안내만 둡니다. */}
          <div className="mt-6 border-t border-white/10 pt-5 text-center text-sm text-[#98A2B3]">
            숨은 곳을 아시나요? 장소 등록은 곧 열립니다
          </div>
        </>
      )}

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
