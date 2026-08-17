"use client";

/**
 * 다트 제스처 + S2 연출의 진행 담당.
 *
 * 설계 정본: `화면구성도.md` §4.1(3단계 시퀀스) · §4.2(구성 요소·모션 최소화) · §4.3(상태)
 *            `API데이터설계.md` §7.2(빈 조합) / D-3(구·군 균등 2단) · D-16(횟수 제한 없음)
 *
 * 한 번의 던지기가 지나가는 자리:
 *
 *   idle ──(잡아 당김)──▶ pulling ──(놓음, 세기 충분)──▶ flying ──▶ waiting
 *     ▲                      │                                        │
 *     │                      └(세기 부족)─▶ short ─┐                   ├─(정상)─▶ district ─▶ pinned ─▶ 결과 화면
 *     └──────────────────────────────────────────┘                   ├─(빈 조합)─▶ idle + 안내
 *                                                                    └─(오류)───▶ missed ─▶ idle
 *
 * 세기가 모자란 던지기는 **서버를 부르지 않습니다**(`short`). 헛던진 것을 결과로 세지 않기 위해서입니다.
 * 겨눈 구·군에 그 테마 장소가 하나도 없을 때도 서버를 부르지 않습니다(`blocked`).
 *
 * **조준이 성립하는 방식 — 이 파일에서 지켜야 하는 성질입니다(D-36).**
 *   1. 놓는 순간의 당김 벡터를 `resolveAim` 에 그대로 넘겨 구·군을 정하고, **그 값이 그대로**
 *      `requestThrow` 로 갑니다. 중간에서 손보지 않습니다.
 *   2. 다트가 도착하는 화면 좌표는 조준점입니다.
 *   3. 화면이 당기는 내내 보여 준 이름과 서버로 보낸 값이 같습니다. 궤적을 몰래 휘게 하거나
 *      결과를 다시 뽑는 자리가 없습니다.
 *   4. 조준이 없는 경로(키보드·모션 최소화·조준 끔)는 `resolveAim` 이 null 을 돌려주고
 *      서버가 종전대로 16개 구·군 균등 추첨을 합니다(D-3 1단계).
 *
 * **겨누지 않고 던졌을 때 어디에 꽂히는가 (D-62, 2026-08-17 개정).**
 * 앞 판본은 위 2번이 *"조준을 쓰지 않을 때만 지도 상자 한가운데입니다"* 였습니다. 그래서
 * **어느 구·군이 뽑히든 다트는 늘 같은 자리에 꽂혔고**, 꽂힌 자리와 결과가 어긋나 보였습니다
 * (2026-08-17 사용자 관측). 이제 조준을 쓰지 않는 경로도 **뽑힌 구·군 자리**로 갑니다.
 *
 *   · **던지기 전에 아는 경우**(범위를 특정 구·군으로 이미 고름) — 그 자리를 바로 도착점으로 씁니다.
 *   · **응답으로 아는 경우**(조준 끔·키보드 — `D-3` 1단계 균등) — 구·군은 **서버가 답한 뒤에야**
 *     알 수 있습니다. 그래서 다트는 종전처럼 즉시 출발하고, 응답이 **아직 나는 중에** 오면
 *     도착 지점을 그 구·군으로 **이어 답니다**(`RETARGET_MIN_MS` 이상 남았을 때만).
 *     **이미 꽂힌 뒤에 오면 그대로 둡니다** — 꽂힌 다트가 미끄러져 옮겨 가는 그림이 되기 때문입니다.
 *
 * **추첨은 한 줄도 바뀌지 않았습니다** — 구·군을 고르는 일은 여전히 서버이고(`D-3` 1단계),
 * 이 파일이 정하는 것은 **이미 정해진 결과를 어디에 그릴지**뿐입니다(`D-62-3` 단서).
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";

import type { AimState, AimTarget } from "@/lib/aim";
import {
  DART_SIZE,
  DEFAULT_POWER,
  MIN_THROW_POWER,
  TAP_SLOP_PX,
  clampPull,
  dartTiltDeg,
  flightDurationMs,
  pullPower,
  shortFlightDurationMs,
  shortFlightReach,
  type Point,
} from "@/lib/gesture";
import { tapFeedback } from "@/lib/motion";

// ── 시간표 (§4.1) ────────────────────────────────────────────────────────────
/** 던짐(0.0s) → 구·군 확정(1.0s) */
const DISTRICT_AT_MS = 1000;
/** 구·군 확정 → 좌표 확정(2.0s) */
const DISTRICT_HOLD_MS = 1000;
/** 좌표 확정 → 전이(2.5s) */
const PINNED_HOLD_MS = 500;
/** 모션 최소화 시 캡션만 보여 주는 시간 (§4.2) */
const REDUCED_CAPTION_MS = 800;
/** 빗나감 연출 시간 (§4.3 "실패") */
const MISS_MS = 900;
/** 지도 상자를 못 찾았을 때 쓰는 비행 시간 */
const FLIGHT_FALLBACK_MS = 420;
/** 못 미친 다트가 바닥으로 떨어지는 시간 */
const SHORT_FALL_MS = 420;
/** 겨눈 구·군에 그 테마 장소가 없어 되돌아오기까지의 시간 */
const BLOCKED_MS = 1100;
/**
 * 비행 중에 도착 지점을 이어 달 때 **남아 있어야 하는 최소 시간**(ms) — `D-62`.
 * 이보다 덜 남았으면 손대지 않습니다. 남은 길이 짧을수록 방향 전환이 급해져, 궤적을 잇는 것이
 * 아니라 **꺾이는 것처럼** 보입니다. 그때는 종전대로 지도 상자 한가운데에 꽂힙니다.
 */
const RETARGET_MIN_MS = 120;
/**
 * 꽂힐 자리를 **모르는 채 출발할 때** 비행에 얹는 여유(ms) — `D-62`.
 *
 * 겨누지 않은 던지기는 구·군을 서버가 답한 뒤에야 압니다. 그런데 기본 세기의 비행은 380ms 라,
 * 응답이 그보다 늦으면 다트가 이미 꽂힌 뒤가 되어 **한가운데로 떨어집니다.**
 * **실측이 그 자리에 걸쳐 있었습니다** — 로컬 배포 빌드에서 `POST /api/throw` 가
 * **230·253·278ms**(2026-08-17, 브라우저 자원 타이밍)였고, 셋 중 하나만 제때 닿았습니다.
 *
 * 그래서 **자리를 모를 때만** 비행을 이만큼 늘립니다. 늘어난 값(기본 세기 380 → 580ms)도
 * 구·군 확정 시점(1.0s)보다 앞이라 연출 시간표는 그대로입니다. 겨누고 던지거나 범위를 미리
 * 고른 경로는 자리를 알고 출발하므로 **한 틱도 늘어나지 않습니다.**
 */
const LANDING_WAIT_MS = 200;

export type DartStage =
  | "idle" // 다트가 놓여 있음
  | "pulling" // 잡아 당기는 중 (= 겨누는 중)
  | "flying" // 날아가는 중
  | "waiting" // 꽂혔고 서버 응답을 기다리는 중 (§4.3 응답 지연 = 1단계 캡션 유지)
  | "district" // 구·군 확정 (§4.1 2단계)
  | "pinned" // 좌표 확정 (§4.1 3단계)
  | "short" // 못 미쳐 떨어짐 (서버 미호출)
  | "blocked" // 겨눈 구·군에 그 테마 장소가 없음 (서버 미호출, §7.2)
  | "missed"; // 서버 오류로 빗나감 (§4.3 실패)

export interface DartHit {
  kind: "hit";
  throwId: string;
  sigunguCode: string;
  sigunguName: string;
  lat: number;
  lng: number;
}

/**
 * `error` 의 `message` 는 **화면에 그대로 띄울 문구**입니다.
 *
 * 없으면 화면이 기본 문구("다트를 놓쳤어요")를 씁니다. 상한에 걸린 경우처럼 **다시 던져도
 * 결과가 같은 실패**는 서버가 사람이 읽는 문구를 함께 주므로 그것을 씁니다 — 기다려야 하는
 * 상황에 "다시 던져 볼까요?" 라고 권하면 사실과 다릅니다.
 */
export type DartOutcome = DartHit | { kind: "empty" } | { kind: "error"; message?: string };

export interface FlightSpec {
  /**
   * 이 던지기의 일련번호. **도착 지점을 이어 달아도(`D-62`) 값이 바뀌지 않습니다** —
   * 비행 레이어가 "새 던지기"와 "같은 던지기의 도착 지점 변경"을 가르는 기준입니다.
   */
  id: number;
  /** 출발 지점 — 화면(뷰포트) 좌표 */
  fromX: number;
  fromY: number;
  /** 도착까지의 이동량. 겨눈 자리 또는 뽑힌 구·군 자리이고, 둘 다 없을 때만 지도 상자 한가운데입니다. */
  dx: number;
  dy: number;
  durationMs: number;
  power: number;
  tiltDeg: number;
  size: number;
  kind: "throw" | "short";
}

interface Options {
  /** 던질 수 있는 상태인지 — 집계표 준비 + 0건 조합 아님 + 오프라인 아님 */
  enabled: boolean;
  reducedMotion: boolean;
  dartRef: RefObject<HTMLElement | null>;
  /** 다트가 꽂힐 판 — 지도 상자. 조준점은 이 상자 안의 좌표입니다. */
  targetRef: RefObject<HTMLElement | null>;
  /**
   * 조준 판정 (D-36). 놓는 순간의 당김 벡터를 받아 겨눈 구·군을 돌려줍니다.
   * 조준을 쓰지 않는 경로면 없거나 null 을 돌려주고, 그때는 서버가 균등 추첨을 합니다.
   */
  resolveAim?: (pull: Point) => AimState | null;
  /**
   * 뽑힌 구·군이 지도 상자 안에서 놓이는 자리 (`D-62`). **조준을 쓰지 않는 경로의 착지 지점**이며,
   * 지도가 없거나 모르는 구·군이면 null 을 돌려줍니다(그때는 지도 상자 한가운데).
   * **추첨에 관여하지 않습니다** — 이미 정해진 구·군을 화면 좌표로 옮기기만 합니다.
   */
  resolveLanding?: (sigunguCode: string) => Point | null;
  /**
   * 던지기 전에 이미 결과 구·군을 아는 경로(범위를 특정 구·군으로 고름)의 착지 지점 (`D-62`).
   * 있으면 응답을 기다리지 않고 처음부터 그 자리로 날아갑니다.
   */
  presetLanding?: Point | null;
  /** 서버 던지기. 조준 결과를 **그대로** 넘깁니다(중간에서 손보지 않습니다). */
  requestThrow: (aimed: AimTarget | null) => Promise<DartOutcome>;
  onHit: (hit: DartHit) => void;
  onEmpty: () => void;
  /** 서버가 사람이 읽는 문구를 준 경우 그대로 넘어옵니다 (없으면 화면 기본 문구) */
  onError: (message?: string) => void;
  /** 겨눈 구·군에 그 테마 장소가 없을 때 — 서버를 부르지 않고 이유만 알립니다. */
  onBlocked?: (target: AimTarget) => void;
}

export interface DartSequence {
  stage: DartStage;
  /** 지금 당긴 벡터(px) — 다트를 옮겨 그리는 데와 조준점을 잡는 데 씁니다. */
  pull: Point;
  power: number;
  tiltDeg: number;
  flight: FlightSpec | null;
  hit: DartHit | null;
  /** 이번 던지기에 확정된 조준(놓는 순간 잠깁니다). 조준을 안 썼으면 null */
  aim: AimState | null;
  /**
   * 다트가 꽂힌 자리 — 지도 상자 기준 px (`D-62`). 조준이면 겨눈 점, 아니면 뽑힌 구·군 자리이며,
   * 아직 모르면 null 입니다(그때 화면은 지도 상자 한가운데를 씁니다).
   */
  landing: Point | null;
  /** 톡 건드리거나 약하게 놓았을 때의 한 줄 안내 */
  hint: string | null;
  /** 던지는 중(중복 입력 차단 구간) */
  busy: boolean;
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => void;
  onKeyDown: (e: ReactKeyboardEvent<HTMLElement>) => void;
  /** 기본 세기로 즉시 던지기 — 키보드·모션 최소화 경로 */
  throwWithDefaultPower: (power: number) => void;
  /** 건너뛰기 (§4.2-4) */
  skip: () => void;
}

const ZERO: Point = { x: 0, y: 0 };

/**
 * 같은 던지기의 **도착 지점만** 바꿉니다 (`D-62`).
 * 출발 자리·세기·기울기·일련번호는 그대로 두고 이동량과 남은 시간만 다시 잽니다 —
 * 그래야 비행 레이어가 처음부터 다시 날리지 않고 **가던 길에서 이어** 갑니다.
 */
function retargetFlight(
  spec: FlightSpec,
  point: Point,
  box: DOMRect,
  durationMs: number,
): FlightSpec {
  const toX = box.left + point.x;
  const toY = box.top + point.y;
  return {
    ...spec,
    dx: toX - (spec.fromX + spec.size / 2),
    dy: toY - spec.fromY,
    durationMs,
  };
}

export function useDartSequence(options: Options): DartSequence {
  const {
    enabled,
    reducedMotion,
    dartRef,
    targetRef,
    resolveAim,
    resolveLanding,
    presetLanding,
    requestThrow,
    onHit,
    onEmpty,
    onError,
    onBlocked,
  } = options;

  const [stage, setStage] = useState<DartStage>("idle");
  const [pull, setPull] = useState<Point>(ZERO);
  const [flight, setFlight] = useState<FlightSpec | null>(null);
  const [hit, setHit] = useState<DartHit | null>(null);
  const [aim, setAim] = useState<AimState | null>(null);
  const [landing, setLanding] = useState<Point | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 이벤트 안에서 즉시 읽어야 하는 값들은 ref 로 둡니다(렌더 사이의 낡은 값 방지).
  const pullingRef = useRef(false);
  const busyRef = useRef(false);
  const pointerIdRef = useRef<number | null>(null);
  const originRef = useRef<Point>(ZERO);
  const pullRef = useRef<Point>(ZERO);
  const hitRef = useRef<DartHit | null>(null);
  const skipRef = useRef(false);
  const doneRef = useRef(false);
  const aliveRef = useRef(true);
  const timersRef = useRef<number[]>([]);
  /** 던지기 일련번호 — 도착 지점을 이어 달 때 "같은 던지기인지" 를 가릅니다(`D-62`). */
  const flightSeqRef = useRef(0);

  useEffect(() => {
    aliveRef.current = true;
    const timers = timersRef.current;
    return () => {
      aliveRef.current = false;
      timers.forEach((id) => window.clearTimeout(id));
      timers.length = 0;
    };
  }, []);

  const wait = useCallback(
    (ms: number) =>
      new Promise<void>((resolve) => {
        const id = window.setTimeout(resolve, ms);
        timersRef.current.push(id);
      }),
    [],
  );

  const setBusyBoth = useCallback((value: boolean) => {
    busyRef.current = value;
    setBusy(value);
  }, []);

  const finish = useCallback(
    (h: DartHit) => {
      if (doneRef.current) return;
      doneRef.current = true;
      onHit(h);
    },
    [onHit],
  );

  /**
   * 비행 궤적을 만듭니다.
   * 도착 지점은 **겨눈 자리** 또는 **뽑힌 구·군 자리**(`D-62`)이고, 둘 다 아직 모를 때만
   * 지도 상자 한가운데로 갑니다. 세기는 걸리는 시간과 잔상에만 들어갑니다.
   */
  const buildFlight = useCallback(
    (power: number, kind: "throw" | "short", aimPoint: Point | null): FlightSpec | null => {
      const dart = dartRef.current;
      const target = targetRef.current;
      if (!dart || !target) return null;

      const d = dart.getBoundingClientRect();
      const t = target.getBoundingClientRect();
      const size = DART_SIZE;

      // 회전 때문에 커진 외곽 상자 대신 가운데를 기준으로 다시 잡습니다.
      const fromX = d.left + d.width / 2 - size / 2;
      const fromY = d.top + (d.height - size) / 2;

      const toX = t.left + (aimPoint ? aimPoint.x : t.width / 2);
      const toY = t.top + (aimPoint ? aimPoint.y : t.height / 2);

      const fullDx = toX - (fromX + size / 2);
      const fullDy = toY - fromY;
      const reach = kind === "throw" ? 1 : shortFlightReach(power);

      return {
        id: ++flightSeqRef.current,
        fromX,
        fromY,
        dx: fullDx * reach,
        dy: fullDy * reach,
        durationMs:
          kind === "throw" ? flightDurationMs(power) : shortFlightDurationMs(power),
        power,
        tiltDeg: dartTiltDeg(pullRef.current),
        size,
        kind,
      };
    },
    [dartRef, targetRef],
  );

  /** 세기가 모자란 던지기 — 서버를 부르지 않고 되돌립니다. */
  const playShort = useCallback(
    async (power: number, aimPoint: Point | null) => {
      setBusyBoth(true);
      const spec = buildFlight(power, "short", aimPoint);
      setFlight(spec);
      setStage("short");

      await wait((spec?.durationMs ?? FLIGHT_FALLBACK_MS) + SHORT_FALL_MS);
      if (!aliveRef.current) return;

      setFlight(null);
      setStage("idle");
      setHint("조금 더 세게 당겼다 놓아 보세요");
      setBusyBoth(false);
    },
    [buildFlight, setBusyBoth, wait],
  );

  /**
   * 겨눈 구·군에 그 테마 장소가 없는 경우 (§7.2).
   * 다트는 겨눈 자리까지 그대로 날아가고(눈속임 없이 겨눈 대로 갑니다), 거기서 이유를 답합니다.
   * **서버를 부르지 않고 결과로도 세지 않습니다.**
   */
  const playBlocked = useCallback(
    async (power: number, state: AimState) => {
      setBusyBoth(true);
      setAim(state);
      setLanding(state.point);
      setHint(null);

      const spec = buildFlight(power, "throw", state.point);
      setFlight(spec);
      setStage("flying");
      await wait(spec?.durationMs ?? FLIGHT_FALLBACK_MS);
      if (!aliveRef.current) return;

      setFlight(null);
      setStage("blocked");
      onBlocked?.(state.target);

      await wait(BLOCKED_MS);
      if (!aliveRef.current) return;

      setStage("idle");
      setAim(null);
      setLanding(null);
      setBusyBoth(false);
    },
    [buildFlight, onBlocked, setBusyBoth, wait],
  );

  /** 정상 던지기 — 연출과 서버 호출이 함께 시작되고, 늦는 쪽을 기다립니다(§4.3). */
  const runThrow = useCallback(
    async (power: number, state: AimState | null) => {
      if (busyRef.current || !enabled) return;

      setBusyBoth(true);
      skipRef.current = false;
      doneRef.current = false;
      hitRef.current = null;
      setHit(null);
      setAim(state);
      setHint(null);

      /*
       * 꽂힐 자리 (`D-62`). 겨눴으면 겨눈 점이고, 겨누지 않았어도 **결과 구·군을 이미 아는
       * 경로**(범위를 직접 고름)면 그 자리입니다. 둘 다 아니면 아직 모르는 상태(null)로 두고,
       * 서버가 답한 뒤에 아래에서 이어 답니다.
       */
      const startLanding = state?.point ?? presetLanding ?? null;
      setLanding(startLanding);

      const startedAt = Date.now();
      // 겨눈 구·군이 그대로 서버로 갑니다. 여기서 바꾸지 않습니다(D-36).
      const pending = requestThrow(state?.target ?? null);

      if (reducedMotion) {
        setStage("waiting");
      } else {
        /** 꽂힐 자리를 모르면 응답이 닿을 여유를 얹습니다 (`D-62` — `LANDING_WAIT_MS`). */
        const waitsForLanding = !startLanding && Boolean(resolveLanding);
        const base = buildFlight(power, "throw", startLanding);
        const spec =
          base && waitsForLanding
            ? { ...base, durationMs: base.durationMs + LANDING_WAIT_MS }
            : base;
        setFlight(spec);
        setStage("flying");

        /*
         * 균등 경로(`D-3` 1단계)는 **서버가 답한 뒤에야** 구·군을 압니다. 다트는 이미 떠났으므로,
         * 응답이 비행 중에 오면 도착 지점을 뽑힌 구·군으로 **이어 답니다**(`D-62`).
         * 남은 시간이 얼마 없으면 손대지 않습니다 — 급히 꺾이거나, 이미 꽂힌 다트가 미끄러져
         * 옮겨 가는 그림이 됩니다. 그때는 종전대로 지도 상자 한가운데입니다.
         */
        if (spec && waitsForLanding && resolveLanding) {
          const flewAt = Date.now();
          void pending
            .then((outcome) => {
              if (!aliveRef.current || outcome.kind !== "hit") return;
              const box = targetRef.current;
              if (!box) return;
              const left = spec.durationMs - (Date.now() - flewAt);
              if (left < RETARGET_MIN_MS) return;
              const point = resolveLanding(outcome.sigunguCode);
              if (!point) return;
              setLanding(point);
              setFlight((prev) =>
                prev && prev.id === spec.id
                  ? retargetFlight(prev, point, box.getBoundingClientRect(), left)
                  : prev,
              );
            })
            .catch(() => {
              // 응답 실패는 아래 `await pending` 이 그대로 받습니다.
            });
        }

        await wait(spec?.durationMs ?? FLIGHT_FALLBACK_MS);
        if (!aliveRef.current) return;
        setFlight(null);
        setStage("waiting");
        // 꽂히는 순간의 짧은 진동 — 기기가 지원할 때만, 모션 최소화면 하지 않습니다.
        tapFeedback(14);
      }

      let outcome: DartOutcome;
      try {
        outcome = await pending;
      } catch {
        outcome = { kind: "error" };
      }
      if (!aliveRef.current) return;

      // 빈 조합은 오류가 아니라 안내입니다 (AD-10 · §4.3). 연출을 멈추고 화면에 맡깁니다.
      if (outcome.kind === "empty") {
        setStage("idle");
        setAim(null);
        setLanding(null);
        setBusyBoth(false);
        onEmpty();
        return;
      }

      if (outcome.kind === "error") {
        setStage("missed");
        onError(outcome.message);
        await wait(MISS_MS);
        if (!aliveRef.current) return;
        setStage("idle");
        setAim(null);
        setLanding(null);
        setBusyBoth(false);
        return;
      }

      hitRef.current = outcome;
      setHit(outcome);

      if (skipRef.current) {
        finish(outcome);
        return;
      }

      if (reducedMotion) {
        setStage("district");
        await wait(REDUCED_CAPTION_MS);
        if (!aliveRef.current) return;
        finish(outcome);
        return;
      }

      const rest = DISTRICT_AT_MS - (Date.now() - startedAt);
      if (rest > 0) await wait(rest);
      if (!aliveRef.current) return;
      if (skipRef.current) {
        finish(outcome);
        return;
      }

      setStage("district");
      await wait(DISTRICT_HOLD_MS);
      if (!aliveRef.current) return;
      if (skipRef.current) {
        finish(outcome);
        return;
      }

      setStage("pinned");
      await wait(PINNED_HOLD_MS);
      if (!aliveRef.current) return;

      finish(outcome);
    },
    [
      buildFlight,
      enabled,
      finish,
      onEmpty,
      onError,
      presetLanding,
      reducedMotion,
      requestThrow,
      resolveLanding,
      setBusyBoth,
      targetRef,
      wait,
    ],
  );

  // ── 포인터 (마우스·터치·펜 한 경로) ────────────────────────────────────────
  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (!enabled || busyRef.current || reducedMotion) return;
      const el = e.currentTarget;
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // 캡처를 못 잡아도 이동·놓기는 그대로 받습니다.
      }
      pointerIdRef.current = e.pointerId;
      pullingRef.current = true;
      originRef.current = { x: e.clientX, y: e.clientY };
      pullRef.current = ZERO;
      setPull(ZERO);
      setHint(null);
      setStage("pulling");
    },
    [enabled, reducedMotion],
  );

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    if (!pullingRef.current || e.pointerId !== pointerIdRef.current) return;
    const origin = originRef.current;
    const next = clampPull(e.clientX - origin.x, e.clientY - origin.y);
    pullRef.current = next;
    setPull(next);
  }, []);

  const endPull = useCallback(
    (e: ReactPointerEvent<HTMLElement>, cancelled: boolean) => {
      if (!pullingRef.current || e.pointerId !== pointerIdRef.current) return;
      pullingRef.current = false;
      pointerIdRef.current = null;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // 이미 풀렸으면 그만입니다.
      }

      const released = pullRef.current;
      const distance = Math.hypot(released.x, released.y);
      const power = pullPower(released);

      // 놓는 순간의 당김으로 겨눈 곳을 확정합니다. 이 값이 그대로 서버로 갑니다(D-36).
      const aimed = resolveAim?.(released) ?? null;

      // 다트는 손에서 놓는 순간 제자리로 돌아오고, 날아가는 것은 비행 레이어가 맡습니다.
      pullRef.current = ZERO;
      setPull(ZERO);

      if (cancelled || distance < TAP_SLOP_PX) {
        setStage("idle");
        setHint("다트를 잡아 당겼다 놓으세요");
        return;
      }

      if (power < MIN_THROW_POWER) {
        // 못 미친 던지기도 가려던 쪽으로 떨어집니다 — 결과 구·군을 미리 아는 경로면 그 방향입니다.
        void playShort(power, aimed?.point ?? presetLanding ?? null);
        return;
      }

      // 겨눈 구·군에 그 테마 장소가 없으면 던지되 서버는 부르지 않습니다 (§7.2).
      if (aimed && aimed.target.count === 0) {
        void playBlocked(power, aimed);
        return;
      }

      void runThrow(power, aimed);
    },
    [playBlocked, playShort, presetLanding, resolveAim, runThrow],
  );

  const onPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => endPull(e, false),
    [endPull],
  );
  const onPointerCancel = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => endPull(e, true),
    [endPull],
  );

  // ── 키보드·버튼 (드래그를 못 하는 경로) ───────────────────────────────────
  /**
   * 조준 없이 던집니다 — 서버가 16개 구·군 균등 추첨을 합니다(D-3 1단계).
   * 겨누기 어려운 환경에서도 서비스가 그대로 성립해야 하므로 이 길은 항상 열려 있습니다.
   * 특정 구·군을 원하면 §3.2-3 의 범위 선택이 같은 일을 합니다(D-4).
   */
  const throwWithDefaultPower = useCallback(
    (power: number) => {
      if (!enabled || busyRef.current) return;
      void runThrow(power, null);
    },
    [enabled, runThrow],
  );

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLElement>) => {
      if (e.key !== "Enter" && e.key !== " " && e.key !== "Spacebar") return;
      e.preventDefault();
      throwWithDefaultPower(DEFAULT_POWER);
    },
    [throwWithDefaultPower],
  );

  // ── 건너뛰기 (§4.2-4) ────────────────────────────────────────────────────
  const skip = useCallback(() => {
    skipRef.current = true;
    const current = hitRef.current;
    if (current) finish(current);
    // 아직 응답 전이면 도착하는 즉시 넘어갑니다(runThrow 가 skipRef 를 봅니다).
  }, [finish]);

  return {
    stage,
    pull,
    power: pullPower(pull),
    tiltDeg: dartTiltDeg(pull),
    flight,
    hit,
    aim,
    landing,
    hint,
    busy,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onKeyDown,
    throwWithDefaultPower,
    skip,
  };
}
