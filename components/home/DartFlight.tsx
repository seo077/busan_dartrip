"use client";

/**
 * 날아가는 다트 — 화면 위에 떠 있는 한 겹입니다.
 *
 * 설계 정본: `화면구성도.md` §4.1(1단계 "던짐") · §4.2-1(CSS transform 기반, 저사양 대응)
 *
 * 손을 놓는 순간 다트가 있던 자리(`fromX`·`fromY`)에서 시작해 **지도 상자 한가운데**로 갑니다.
 * 도착 지점은 `FlightSpec` 이 이미 정해서 넘겨 준 값 하나뿐이라, 이 부품에는 방향을 고르는
 * 코드가 없습니다. 세기는 `durationMs`(빠르기)와 잔상 개수로만 나타납니다.
 *
 * 움직이는 속성은 `transform`·`opacity` 둘뿐이라 배치 계산이 다시 일어나지 않습니다.
 * 잔상은 같은 도형을 늦게 출발시켜(`transition-delay`) 흐리게 지우는 방식이라 비용이 거의 없습니다.
 */

import { useEffect, useState } from "react";

import { DartGlyph } from "@/components/home/DartGlyph";
import { trailCount } from "@/lib/gesture";
import type { FlightSpec } from "@/components/home/useDartSequence";

type Phase = "start" | "end" | "fall";

export function DartFlight({ flight }: { flight: FlightSpec | null }) {
  const [phase, setPhase] = useState<Phase>("start");

  useEffect(() => {
    if (!flight) {
      setPhase("start");
      return;
    }
    setPhase("start");

    // 한 프레임 뒤에 목표 위치를 넣어야 전환이 걸립니다.
    const raf = window.requestAnimationFrame(() => setPhase("end"));
    let fallTimer: number | undefined;
    if (flight.kind === "short") {
      fallTimer = window.setTimeout(() => setPhase("fall"), flight.durationMs);
    }

    return () => {
      window.cancelAnimationFrame(raf);
      if (fallTimer) window.clearTimeout(fallTimer);
    };
  }, [flight]);

  if (!flight) return null;

  const trails = trailCount(flight.power);

  /** 단계별 변형 — 도착 지점은 `flight.dx`·`flight.dy` 하나로 고정입니다. */
  const transformFor = (p: Phase): string => {
    if (p === "start") {
      return `translate3d(0px, 0px, 0) rotate(${flight.tiltDeg}deg) scale(1)`;
    }
    if (p === "end") {
      return flight.kind === "throw"
        ? `translate3d(${flight.dx}px, ${flight.dy}px, 0) rotate(0deg) scale(0.42)`
        : `translate3d(${flight.dx}px, ${flight.dy}px, 0) rotate(-10deg) scale(0.78)`;
    }
    // 못 미친 다트가 아래로 떨어지는 마지막 구간
    return `translate3d(${flight.dx}px, ${flight.dy + 170}px, 0) rotate(140deg) scale(0.66)`;
  };

  const durationFor = (p: Phase): number =>
    p === "fall" ? 420 : flight.durationMs;

  const easingFor = (p: Phase): string =>
    p === "fall" ? "cubic-bezier(0.4, 0, 1, 1)" : "cubic-bezier(0.22, 0.7, 0.3, 1)";

  return (
    <div className="pointer-events-none fixed inset-0 z-40" aria-hidden>
      {/* 잔상 — 같은 길을 조금 늦게 따라가며 사라집니다. */}
      {Array.from({ length: trails }).map((_, i) => (
        <div
          key={i}
          style={{
            position: "fixed",
            left: flight.fromX,
            top: flight.fromY,
            width: flight.size,
            height: flight.size,
            transformOrigin: "50% 0%",
            transform: transformFor(phase),
            opacity: phase === "start" ? 0.34 - i * 0.09 : 0,
            transition: `transform ${durationFor(phase)}ms ${easingFor(phase)} ${(i + 1) * 45}ms, opacity ${durationFor(phase)}ms linear ${(i + 1) * 45}ms`,
          }}
        >
          <DartGlyph size={flight.size} />
        </div>
      ))}

      {/* 본체 */}
      <div
        style={{
          position: "fixed",
          left: flight.fromX,
          top: flight.fromY,
          width: flight.size,
          height: flight.size,
          transformOrigin: "50% 0%",
          transform: transformFor(phase),
          opacity: phase === "fall" ? 0 : 1,
          transition: `transform ${durationFor(phase)}ms ${easingFor(phase)}, opacity ${durationFor(phase)}ms linear`,
        }}
      >
        <DartGlyph size={flight.size} glow />
      </div>
    </div>
  );
}

export default DartFlight;
