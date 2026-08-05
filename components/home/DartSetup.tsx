"use client";

/**
 * S1 홈 — 다트 설정 + 조준 + 던지기 제스처 + S2 연출.
 *
 * 설계 정본: `화면구성도.md` §3.1(와이어프레임) · §3.2(구성 요소) · §3.3(상태) · §3.4(전이)
 *            `화면구성도.md` §4.1(3단계 시퀀스) · §4.2(구성 요소) · §4.3(상태)
 *            `API데이터설계.md` §7.2(빈 조합 처리) · §8(Route)
 *            `AI 논의사항.md` Round 1 §D-36(다트 조준)
 *
 * 사용자 입력을 **범위·테마 둘**로 줄이고 던지기로 연결하는 화면입니다(D-4 로 반경·기준점
 * 입력이 제거됐습니다). 후보 건수는 `/api/pool/stats` 한 번으로 받아 두고,
 * **0건 조합은 던지기 전에 막습니다**(§7.2 — 화면과 서버 양쪽에 같은 판정을 둡니다).
 *
 * ── 화면 차례 (D-36) ────────────────────────────────────────────────────────
 * **범위 → 테마 → 지도 → 다트.** 지도가 과녁이 되었으므로 다트 바로 위에 둡니다.
 * 손이 아래에서 위로 한 번에 흐릅니다 — 무엇을 고를지 정하고, 겨눌 판을 보고, 당깁니다.
 *
 * ── 조준 (D-36) ────────────────────────────────────────────────────────────
 * 다트를 당기면 지도 위에 조준점이 따라다니고, 놓으면 **겨눈 지점의 구·군이 확정**됩니다.
 * 그 구·군 코드가 그대로 `/api/throw` 의 `scope` 로 나가므로, 서버는 예전과 똑같이
 * "정해진 구·군 안에서 장소를 균등 추출" 합니다(D-3 2단계 불변 · `throw_dart()` 미변경).
 * **눈속임이 없습니다** — 조준 중에 화면이 보여 준 이름이 서버로 가는 값이고 결과의 구·군입니다.
 *
 * 조준을 끄면(또는 범위를 특정 구·군으로 이미 정했으면·키보드로 던지면·모션 최소화면)
 * 종전대로입니다. 특히 **"부산 전체 · 조준 끔" 은 16개 구·군 균등 추첨**입니다(D-3 1단계).
 * 두 모드가 화면 위에 나란히 보이고, 지금 어느 쪽인지를 문구가 그대로 말합니다.
 *
 * ── 던지기가 하나의 손동작이 된 뒤의 구조 ──────────────────────────────────
 * 던지기 버튼 자리에 **잡아 당겼다 놓는 다트**가 들어왔고, S2 연출은 화면을 옮기지 않고
 * 이 화면 위에서 이어집니다. 연출 진행은 `useDartSequence`, 손에 잡히는 부분은 `DartThrowZone`,
 * 날아가는 다트는 `DartFlight`, 조준 표식은 `AimReticle`, 판정 셈은 `lib/aim.ts` 가 맡습니다.
 *
 * ── 주소로 들어오는 초기 설정 (`?scope=`·`?theme=`) ──────────────────────────
 * S3 의 [다시 던지기] 가 **던졌을 때의 범위·테마를 그대로 달고** 이 화면으로 돌아옵니다
 * (`화면구성도.md` §5.3-6 "동일 설정 유지"). 값이 이상하면 조용히 기본값으로 떨어집니다.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { AimReticle } from "@/components/home/AimReticle";
import { BusanMap, type FitBounds, type MapFocus } from "@/components/home/BusanMap";
import { DartFlight } from "@/components/home/DartFlight";
import { DartGlyph } from "@/components/home/DartGlyph";
import { DartThrowZone } from "@/components/home/DartThrowZone";
import { useDartSequence, type DartHit, type DartOutcome } from "@/components/home/useDartSequence";
import {
  projectTargets,
  resolveAim as resolveAimState,
  type AimCandidate,
  type AimTarget,
  type MapViewport,
} from "@/lib/aim";
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

export function DartSetup({
  initialScope = null,
  initialTheme = null,
}: {
  /** S3 [다시 던지기] 가 돌려주는 직전 범위 (§5.3-6). 없으면 부산 전체입니다. */
  initialScope?: string | null;
  /** 직전 테마. 없으면 전체입니다. */
  initialTheme?: ThemeKey | null;
} = {}) {
  const router = useRouter();
  const reducedMotion = usePrefersReducedMotion();

  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  const [scope, setScope] = useState<string | null>(initialScope); // null = 부산 전체
  const [theme, setTheme] = useState<ThemeKey | null>(initialTheme); // null = 전체
  const [sheetOpen, setSheetOpen] = useState(false);
  const [throwError, setThrowError] = useState<string | null>(null);
  const [emptyNotice, setEmptyNotice] = useState(false);
  const [todayCount, setTodayCount] = useState(0);
  const [offline, setOffline] = useState(false);

  /** 조준 켬·끔 (D-36). 기본은 켬 — 겨누는 것이 이 서비스의 손맛입니다. */
  const [aimOn, setAimOn] = useState(true);
  /** 지도가 지금 비추는 범위. 없으면 조준이 성립하지 않습니다. */
  const [viewport, setViewport] = useState<MapViewport | null>(null);
  /** 겨눴는데 그 구·군에 그 테마 장소가 없었던 경우의 안내 */
  const [aimBlock, setAimBlock] = useState<AimTarget | null>(null);

  // 다트가 출발하는 자리와 꽂히는 자리 — 비행 궤적을 재는 두 지점입니다.
  const dartRef = useRef<HTMLDivElement | null>(null);
  const mapBoxRef = useRef<HTMLDivElement | null>(null);
  /** 이번 던지기가 조준으로 이뤄졌는지 — 결과 화면에 그대로 이어 적기 위해 남깁니다. */
  const aimedRef = useRef(false);

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

  /**
   * 주소로 받은 범위가 실제로 있는 구·군인지 확인합니다.
   * 없는 코드를 그대로 들고 있으면 후보 건수가 0으로 잡혀 던지기가 막히는데, 사용자는
   * 이유를 알 수 없습니다. 조용히 부산 전체로 되돌리는 편이 낫습니다.
   */
  useEffect(() => {
    if (load.kind !== "ready" || scope === null) return;
    if (!load.stats.sigungu.some((s) => s.code === scope)) setScope(null);
  }, [load, scope]);

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
    return scope ? (selectedSigungu?.counts[themeSlot] ?? 0) : stats.totals[themeSlot];
  }, [stats, scope, selectedSigungu, themeSlot]);

  const scopeLabel = selectedSigungu?.name ?? "부산 전체";
  const themeName = themeLabel(theme);

  const blockedByCombination = currentCount !== null && currentCount === 0;
  const canThrow = load.kind === "ready" && !blockedByCombination && !offline;

  /**
   * 조준이 성립하는 조건.
   * 범위를 이미 특정 구·군으로 골랐으면 겨눌 것이 없고(D-4 가 같은 일을 이미 했습니다),
   * 지도를 못 불러왔으면 겨눌 판이 없으며, 모션 최소화 설정이면 제스처 자체를 쓰지 않습니다.
   */
  const aimActive =
    aimOn && scope === null && !reducedMotion && viewport !== null && stats !== null && canThrow;

  /** 조준 대상 16개 — 구·군 중심점과 지금 테마의 후보 건수 */
  const aimCandidates = useMemo<AimCandidate[]>(
    () =>
      (stats?.sigungu ?? []).map((s) => ({
        code: s.code,
        name: s.name,
        lat: s.centerLat,
        lng: s.centerLng,
        count: s.counts[themeSlot] ?? 0,
      })),
    [stats, themeSlot],
  );

  const aimTargets = useMemo<AimTarget[]>(
    () => (viewport ? projectTargets(aimCandidates, viewport) : []),
    [aimCandidates, viewport],
  );

  /**
   * 지도가 쉴 때 비춰야 하는 범위 — **조준 대상 16곳을 모두 감싸는 상자**입니다.
   *
   * 고정 확대 단계로 두면 상자 크기에 따라 부산의 일부가 화면 밖으로 밀려납니다. 밀려난
   * 구·군은 표식이 그려지지 않는데 판정에는 남아 있어, **보이지도 않는 곳이 결과로 나오고
   * 어떤 구·군은 아예 겨눌 수 없게** 됩니다. 대상에서 직접 범위를 만들면 그 어긋남이 없습니다.
   */
  const aimBounds = useMemo<FitBounds | null>(() => {
    // 테마와 무관하게 **구·군 좌표**로만 잡습니다 — 테마를 바꿀 때마다 카메라가 흔들리지 않게.
    const list = stats?.sigungu ?? [];
    if (list.length === 0) return null;
    const lats = list.map((s) => s.centerLat);
    const lngs = list.map((s) => s.centerLng);
    return {
      swLat: Math.min(...lats),
      swLng: Math.min(...lngs),
      neLat: Math.max(...lats),
      neLng: Math.max(...lngs),
    };
  }, [stats]);

  /**
   * 놓는 순간의 판정. 화면에 그리는 미리보기와 **같은 함수**를 씁니다 —
   * 보여 준 것과 보내는 것이 어긋날 자리를 두지 않기 위해서입니다.
   */
  const resolveAim = useCallback(
    (pull: { x: number; y: number }) => {
      if (!aimActive || !viewport) return null;
      return resolveAimState(pull, { width: viewport.width, height: viewport.height }, aimTargets);
    },
    [aimActive, viewport, aimTargets],
  );

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
   * 서버 던지기. **겨눈 구·군을 그대로 `scope` 로 보냅니다**(D-36).
   * 조준을 쓰지 않았으면 예전과 같이 선택한 범위를 보내고, 그것도 없으면 부산 전체입니다.
   * 어느 경우에도 서버의 추출 로직은 같습니다 — 구·군이 정해진 뒤의 장소 균등 추출(D-3 2단계).
   */
  const requestThrow = useCallback(
    async (aimed: AimTarget | null): Promise<DartOutcome> => {
      setThrowError(null);
      setEmptyNotice(false);
      setAimBlock(null);
      aimedRef.current = aimed !== null;

      const scopeToSend = aimed ? aimed.code : scope;

      try {
        const res = await fetch("/api/throw", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scope: scopeToSend, theme }),
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
    },
    [scope, theme],
  );

  const onHit = useCallback(
    (hit: DartHit) => {
      setTodayCount(recordThrow());
      // 조준으로 얻은 결과라는 사실을 결과 화면까지 이어 줍니다(공유 링크에는 붙지 않습니다 —
      // 링크를 받은 사람은 겨눈 적이 없으니까요).
      router.push(`/result/${hit.throwId}${aimedRef.current ? "?aimed=1" : ""}`);
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

  /** 겨눈 구·군에 그 테마 장소가 없었던 경우 (§7.2) — 서버를 부르지 않은 채로 이유만 남깁니다. */
  const onBlocked = useCallback((target: AimTarget) => {
    setAimBlock(target);
  }, []);

  const sequence = useDartSequence({
    enabled: canThrow,
    reducedMotion,
    dartRef,
    targetRef: mapBoxRef,
    resolveAim,
    requestThrow,
    onHit,
    onEmpty,
    onError,
    onBlocked,
  });

  const { stage } = sequence;
  /** 연출이 도는 동안에는 설정을 만지지 못하게 하고 시선을 지도에 둡니다. */
  const inSequence =
    stage === "flying" || stage === "waiting" || stage === "district" || stage === "pinned";
  /** 다트가 지도에 꽂혀 있는 구간 */
  const dartLanded =
    stage === "waiting" || stage === "district" || stage === "pinned" || stage === "blocked";
  const revealing = stage === "district" || stage === "pinned";
  const dimmed = inSequence || stage === "pulling" || stage === "short" || stage === "blocked";

  /** 당기는 동안 지도에 그릴 조준 미리보기 */
  const aimPreview = useMemo(
    () => (stage === "pulling" && aimActive ? resolveAim(sequence.pull) : null),
    [stage, aimActive, resolveAim, sequence.pull],
  );

  /**
   * 꽂힌 자국의 자리 — 겨눈 지점입니다(지도 상자 한가운데 기준의 어긋남).
   * 구·군 확정 단계에서 지도가 그 구·군을 한가운데로 끌어오므로, 자국도 한가운데로 따라갑니다
   * (다트가 꽂힌 채 지도가 움직이는 그림입니다).
   */
  const landOffset = useMemo(() => {
    const point = sequence.aim?.point;
    if (!point || !viewport) return { dx: 0, dy: 0 };
    return { dx: point.x - viewport.width / 2, dy: point.y - viewport.height / 2 };
  }, [sequence.aim, viewport]);
  const markDx = revealing ? 0 : landOffset.dx;
  const markDy = revealing ? 0 : landOffset.dy;

  // 지도 카메라 — 평소에는 선택한 범위, 연출 중에는 확정된 구·군 → 좌표 (§4.1 2·3단계)
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

  /** 조준 칸 아래 한 줄 — 지금 어느 모드인지 사실대로 적습니다. */
  const aimNote = (() => {
    if (scope !== null) return `범위를 ${scopeLabel}으로 정해 두어 조준을 쓰지 않아요`;
    if (reducedMotion) return "모션 최소화 설정이라 버튼으로 던지고, 16개 구·군 균등 추첨이에요";
    if (!aimOn) return "조준을 끄면 16개 구·군 중 균등 추첨이에요";
    if (viewport === null) return "지도를 불러오지 못해 겨눌 수 없어요 — 균등 추첨으로 던집니다";
    return "다트를 당기면 겨눈 구·군이 여기 표시돼요";
  })();

  const aimToggleDisabled = scope !== null || reducedMotion;

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
          {/* ① 범위 · ② 테마 (§3.2-3 · §3.2-4) — 무엇을 고를지 먼저 정합니다 */}
          <div
            className={`transition-opacity duration-300 ${
              dimmed ? "pointer-events-none opacity-35" : "opacity-100"
            }`}
          >
            <h2 className="mt-1 mb-2 text-sm font-semibold text-[#98A2B3]">범위</h2>
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
                        setAimBlock(null);
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

            {/* 0건 조합 안내 (§3.3 "조합 빈값") — 겨눈 구·군이 비었을 때도 같은 자리에서 답합니다 */}
            {blockedByCombination || emptyNotice || aimBlock ? (
              <div className="mt-5 rounded-2xl border border-white/10 bg-[#171B22] p-4 text-center">
                <p className="text-sm break-keep text-[#F2F4F7]">
                  {aimBlock
                    ? `${aimBlock.name}에는 아직 ${themeName} 장소가 없어요`
                    : scope
                      ? `${scopeLabel}에는 아직 ${themeName} 장소가 없어요`
                      : "이 조합에는 아직 등록된 장소가 없어요"}
                </p>
                {theme !== null ? (
                  <button
                    type="button"
                    onClick={() => {
                      setTheme(null);
                      setEmptyNotice(false);
                      setAimBlock(null);
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
                      setAimBlock(null);
                    }}
                    className="mt-3 min-h-11 rounded-2xl border border-white/20 px-5 text-sm text-[#F2F4F7]"
                  >
                    범위를 부산 전체로
                  </button>
                )}
              </div>
            ) : null}
          </div>

          {/* ③ 지도 = 과녁 (§3.2-2 · D-36) — 다트 바로 위입니다 */}
          <div className="mt-7">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-[#98A2B3]">지도</h2>
              <button
                type="button"
                role="switch"
                aria-checked={aimActive}
                disabled={aimToggleDisabled}
                onClick={() => setAimOn((v) => !v)}
                className={`flex min-h-9 items-center gap-2 rounded-full border px-3 text-xs transition ${
                  aimToggleDisabled
                    ? "cursor-not-allowed border-white/10 text-[#98A2B3] opacity-50"
                    : aimOn
                      ? "border-[#FF4D4D] bg-[#FF4D4D]/15 text-[#F2F4F7]"
                      : "border-white/15 text-[#98A2B3]"
                }`}
              >
                <span aria-hidden>🎯</span>
                {aimOn ? "조준 켬" : "조준 끔"}
              </button>
            </div>

            {/* 다트가 꽂히는 판 */}
            <div ref={mapBoxRef} className="relative">
              <BusanMap focus={mapFocus} fitBounds={aimBounds} onViewport={setViewport} />

              {/* 조준 층 — 판정 기준(구·군 표식)과 조준점을 그대로 보여 줍니다 */}
              <AimReticle
                aim={aimPreview}
                targets={aimTargets}
                active={aimActive}
                idle={stage === "idle"}
                themeName={themeName}
              />

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

              {/* 꽂힌 자국 — 겨눈 자리에 생기고, 지도가 움직이면 함께 따라갑니다 */}
              {dartLanded ? (
                <div
                  aria-hidden
                  className="pointer-events-none absolute left-1/2 top-1/2"
                  style={{
                    transform: `translate(calc(-50% + ${markDx}px), calc(-50% + ${markDy}px))`,
                    transition: "transform 620ms cubic-bezier(0.2, 0.8, 0.3, 1)",
                  }}
                >
                  {stage !== "blocked" ? (
                    <>
                      <span className="dart-impact-ring absolute left-1/2 top-1/2 block h-9 w-9 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#FF4D4D]/70" />
                      <span
                        className="dart-impact-ring absolute left-1/2 top-1/2 block h-9 w-9 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#FF4D4D]/45"
                        style={{ animationDelay: "160ms" }}
                      />
                    </>
                  ) : (
                    <span className="absolute left-1/2 top-1/2 block h-9 w-9 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-dashed border-[#98A2B3]/70" />
                  )}
                </div>
              ) : null}
              {dartLanded ? (
                <div
                  aria-hidden
                  className="pointer-events-none absolute left-1/2 top-1/2"
                  style={{
                    transform: `translate(calc(-50% + ${markDx}px), calc(-50% + ${markDy}px))`,
                    transition: "transform 620ms cubic-bezier(0.2, 0.8, 0.3, 1)",
                    opacity: stage === "blocked" ? 0.5 : 1,
                  }}
                >
                  <div className="dart-impact">
                    <DartGlyph size={28} glow={stage !== "blocked"} />
                  </div>
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

            <p className="mt-2 min-h-5 text-center text-xs break-keep text-[#98A2B3]">{aimNote}</p>
          </div>

          {/* ④ 다트 (§3.2-5 → §4.1 1단계) — 버튼이 아니라 잡아 당겼다 놓는 다트입니다 */}
          <DartThrowZone
            sequence={sequence}
            dartRef={dartRef}
            enabled={canThrow}
            notReadyReason={notReadyReason}
            reducedMotion={reducedMotion}
            districtName={hit?.sigunguName ?? null}
            aimActive={aimActive}
            aimPreview={aimPreview}
            themeName={themeName}
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

            {/* 장소 등록 (§3.2-7) → S5 */}
            <div className="mt-6 border-t border-white/10 pt-5 text-center text-sm text-[#98A2B3]">
              숨은 곳을 아시나요?{" "}
              <Link href="/submit" className="text-[#F2F4F7] underline underline-offset-2">
                장소 등록하기
              </Link>
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
              <span className="text-xs text-[#98A2B3]">{themeName} 기준</span>
            </div>

            <p className="mb-3 text-xs break-keep text-[#98A2B3]">
              부산 전체를 고르면 다트로 겨눠서 구·군을 정할 수 있어요. 여기서 구·군을 직접 고르면
              조준 없이 그 구·군 안에서 뽑습니다.
            </p>

            <ul className="space-y-1">
              <li>
                <button
                  type="button"
                  onClick={() => {
                    setScope(null);
                    setSheetOpen(false);
                    setEmptyNotice(false);
                    setAimBlock(null);
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
                        setAimBlock(null);
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
