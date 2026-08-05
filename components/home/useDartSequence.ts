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
 *
 * **조준이 성립하지 않게 두는 지점 — 이 파일에서 지켜야 하는 성질입니다.**
 *   1. `requestThrow` 는 **인자가 없습니다.** 세기·방향을 서버로 보낼 통로 자체가 없습니다.
 *   2. 다트가 도착하는 화면 좌표는 `targetRef`(지도 상자)의 **한가운데로 고정**입니다.
 *      당긴 방향이 도착 지점을 1px 도 바꾸지 않습니다.
 *   3. 구·군은 서버 응답이 온 뒤에야 지도가 그쪽으로 움직여 밝아집니다(2단계). 던지기 전에는
 *      화면 어디에도 "여기를 겨누면 여기" 라는 대응이 없습니다.
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

export type DartStage =
  | "idle" // 다트가 놓여 있음
  | "pulling" // 잡아 당기는 중
  | "flying" // 날아가는 중
  | "waiting" // 꽂혔고 서버 응답을 기다리는 중 (§4.3 응답 지연 = 1단계 캡션 유지)
  | "district" // 구·군 확정 (§4.1 2단계)
  | "pinned" // 좌표 확정 (§4.1 3단계)
  | "short" // 못 미쳐 떨어짐 (서버 미호출)
  | "missed"; // 서버 오류로 빗나감 (§4.3 실패)

export interface DartHit {
  kind: "hit";
  throwId: string;
  sigunguCode: string;
  sigunguName: string;
  lat: number;
  lng: number;
}

export type DartOutcome = DartHit | { kind: "empty" } | { kind: "error" };

export interface FlightSpec {
  /** 출발 지점 — 화면(뷰포트) 좌표 */
  fromX: number;
  fromY: number;
  /** 도착까지의 이동량. 지도 상자 한가운데로 고정됩니다. */
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
  /** 다트가 꽂힐 곳 — 지도 상자. 여기 한가운데가 유일한 도착 지점입니다. */
  targetRef: RefObject<HTMLElement | null>;
  /** 서버 던지기. 인자가 없습니다 — 제스처 값이 결과로 새어 나갈 통로를 두지 않습니다. */
  requestThrow: () => Promise<DartOutcome>;
  onHit: (hit: DartHit) => void;
  onEmpty: () => void;
  onError: () => void;
}

export interface DartSequence {
  stage: DartStage;
  /** 지금 당긴 벡터(px) — 화면에 다트를 옮겨 그리는 데만 씁니다. */
  pull: Point;
  power: number;
  tiltDeg: number;
  flight: FlightSpec | null;
  hit: DartHit | null;
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

export function useDartSequence(options: Options): DartSequence {
  const { enabled, reducedMotion, dartRef, targetRef, requestThrow, onHit, onEmpty, onError } =
    options;

  const [stage, setStage] = useState<DartStage>("idle");
  const [pull, setPull] = useState<Point>(ZERO);
  const [flight, setFlight] = useState<FlightSpec | null>(null);
  const [hit, setHit] = useState<DartHit | null>(null);
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
   * 도착 지점은 **지도 상자 한가운데 하나뿐**이며, 세기는 걸리는 시간에만 들어갑니다.
   */
  const buildFlight = useCallback(
    (power: number, kind: "throw" | "short"): FlightSpec | null => {
      const dart = dartRef.current;
      const target = targetRef.current;
      if (!dart || !target) return null;

      const d = dart.getBoundingClientRect();
      const t = target.getBoundingClientRect();
      const size = DART_SIZE;

      // 회전 때문에 커진 외곽 상자 대신 가운데를 기준으로 다시 잡습니다.
      const fromX = d.left + d.width / 2 - size / 2;
      const fromY = d.top + (d.height - size) / 2;

      const fullDx = t.left + t.width / 2 - (fromX + size / 2);
      const fullDy = t.top + t.height / 2 - fromY;
      const reach = kind === "throw" ? 1 : shortFlightReach(power);

      return {
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
    async (power: number) => {
      setBusyBoth(true);
      const spec = buildFlight(power, "short");
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

  /** 정상 던지기 — 연출과 서버 호출이 함께 시작되고, 늦는 쪽을 기다립니다(§4.3). */
  const runThrow = useCallback(
    async (power: number) => {
      if (busyRef.current || !enabled) return;

      setBusyBoth(true);
      skipRef.current = false;
      doneRef.current = false;
      hitRef.current = null;
      setHit(null);
      setHint(null);

      const startedAt = Date.now();
      const pending = requestThrow();

      if (reducedMotion) {
        setStage("waiting");
      } else {
        const spec = buildFlight(power, "throw");
        setFlight(spec);
        setStage("flying");
        await wait(spec?.durationMs ?? FLIGHT_FALLBACK_MS);
        if (!aliveRef.current) return;
        setFlight(null);
        setStage("waiting");
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
        setBusyBoth(false);
        onEmpty();
        return;
      }

      if (outcome.kind === "error") {
        setStage("missed");
        onError();
        await wait(MISS_MS);
        if (!aliveRef.current) return;
        setStage("idle");
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
    [buildFlight, enabled, finish, onEmpty, onError, reducedMotion, requestThrow, setBusyBoth, wait],
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

      // 다트는 손에서 놓는 순간 제자리로 돌아오고, 날아가는 것은 비행 레이어가 맡습니다.
      pullRef.current = ZERO;
      setPull(ZERO);

      if (cancelled || distance < TAP_SLOP_PX) {
        setStage("idle");
        setHint("다트를 잡아 아래로 당겼다 놓으세요");
        return;
      }

      if (power < MIN_THROW_POWER) {
        void playShort(power);
        return;
      }

      void runThrow(power);
    },
    [playShort, runThrow],
  );

  const onPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => endPull(e, false),
    [endPull],
  );
  const onPointerCancel = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => endPull(e, true),
    [endPull],
  );

  // ── 키보드 (드래그를 못 하는 경로) ────────────────────────────────────────
  const throwWithDefaultPower = useCallback(
    (power: number) => {
      if (!enabled || busyRef.current) return;
      void runThrow(power);
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
