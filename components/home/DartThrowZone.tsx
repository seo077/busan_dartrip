"use client";

/**
 * 다트를 잡아 당겼다 놓는 자리 + 단계 캡션.
 *
 * 설계 정본: `화면구성도.md` §4.1(캡션·원칙 문구) · §4.2(구성 요소 2·3, 모션 최소화) · §4.3(상태)
 *
 * 화면에 놓인 다트는 **집을 수 있다는 것이 먼저 보여야** 합니다. 그래서 가만히 있을 때
 * 살짝 흔들리고(`.dart-bob`), 바로 위에 "당겼다 놓으세요" 한 줄을 둡니다.
 * 당기는 동안에는 세 가지가 함께 움직입니다 — 다트가 손을 따라오고, 힘 게이지가 차고,
 * 위쪽 궤적 표시가 밝아집니다.
 *
 * **궤적 표시는 늘 위(지도 쪽)만 가리킵니다.** 좌우로 당겨도 방향이 바뀌지 않습니다.
 * 당긴 방향이 결과를 바꾸지 않는다는 것을 화면이 먼저 말하게 하려는 것입니다(D-3 균등 추첨).
 * 같은 이유로 쉬는 동안에도 "어디로 당겨도 16개 구·군 중 균등 추첨" 을 한 줄 띄웁니다.
 *
 * 대체 경로 두 가지:
 *   - 모션 최소화(`prefers-reduced-motion`) 설정이면 제스처 없이 **버튼 하나**로 던집니다(§4.2).
 *   - 드래그를 못 하는 경우를 위해 다트 자체가 초점을 받고 **Enter·Space** 로 던져집니다.
 *     이 경로는 늘 같은 기본 세기를 씁니다.
 */

import type { RefObject } from "react";

import { DartGlyph } from "@/components/home/DartGlyph";
import type { DartSequence } from "@/components/home/useDartSequence";
import { DEFAULT_POWER, MIN_THROW_POWER, dartScale } from "@/lib/gesture";

const PRINCIPLE = "16개 구·군 중 균등 추첨";

interface Props {
  sequence: DartSequence;
  dartRef: RefObject<HTMLDivElement | null>;
  /** 던질 수 있는 상태인지 — 0건 조합·오프라인·로딩이면 false */
  enabled: boolean;
  /** 던질 수 없을 때 그 이유 한 줄 (`enabled` 가 false 일 때만 씁니다) */
  notReadyReason: string | null;
  reducedMotion: boolean;
  /** 구·군 확정 단계에서 보여 줄 이름 */
  districtName: string | null;
}

export function DartThrowZone({
  sequence,
  dartRef,
  enabled,
  notReadyReason,
  reducedMotion,
  districtName,
}: Props) {
  const { stage, pull, power, tiltDeg, hint, busy } = sequence;
  const strongEnough = power >= MIN_THROW_POWER;

  // 단계별 큰 글자 (§4.1 캡션)
  const caption = (() => {
    switch (stage) {
      case "pulling":
        return strongEnough ? "놓으면 날아갑니다" : "조금 더 당겨 보세요";
      case "flying":
      case "waiting":
        return "던지는 중…";
      case "district":
        return districtName ? `${districtName}!` : "던지는 중…";
      case "pinned":
        return "꽂혔습니다";
      case "short":
        return "다트가 못 미쳤어요";
      case "missed":
        return "다트를 놓쳤어요";
      default:
        return enabled
          ? "다트를 잡아 아래로 당겼다 놓으세요"
          : (notReadyReason ?? "지금은 던질 수 없어요");
    }
  })();

  // 작은 글자 — 쉬는 동안에는 원칙, 연출 중에는 §4.1 의 원칙 문구가 같은 자리에 옵니다.
  const subCaption = (() => {
    if (stage === "district") return PRINCIPLE;
    if (stage === "idle") return hint ?? `어디로 당겨도 ${PRINCIPLE}이에요`;
    if (stage === "pulling") return `당긴 세기는 날아가는 속도만 바꿔요`;
    return "";
  })();

  const dartVisible = stage === "idle" || stage === "pulling";

  // ── 모션 최소화 — 제스처 없이 버튼 하나 (§4.2) ─────────────────────────────
  if (reducedMotion) {
    return (
      <div className="mt-7">
        <button
          type="button"
          onClick={() => sequence.throwWithDefaultPower(DEFAULT_POWER)}
          disabled={!enabled || busy}
          className={`flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl text-base font-semibold transition ${
            enabled && !busy
              ? "bg-[#FF4D4D] text-white"
              : "cursor-not-allowed bg-white/10 text-[#98A2B3]"
          }`}
        >
          <span aria-hidden>🎯</span>
          {busy ? "던지는 중…" : "다트 던지기"}
        </button>
        <p aria-live="polite" className="mt-3 min-h-6 text-center text-sm text-[#F2F4F7]">
          {stage === "idle" ? "" : caption}
        </p>
        <p className="min-h-5 text-center text-xs text-[#98A2B3]">
          {stage === "district" ? PRINCIPLE : `${PRINCIPLE}으로 한 곳을 뽑아요`}
        </p>
      </div>
    );
  }

  // ── 제스처 ────────────────────────────────────────────────────────────────
  return (
    <div className="relative mt-6 flex min-h-60 flex-col items-center">
      <p
        aria-live="polite"
        className={`min-h-7 text-center text-base font-semibold ${
          stage === "district" || stage === "pinned" ? "text-[#FF9B9B]" : "text-[#F2F4F7]"
        }`}
      >
        {caption}
      </p>

      <p className="min-h-5 text-center text-xs text-[#98A2B3]">{subCaption}</p>

      {/* 드래그가 어려운 경우를 위한 빠져나갈 길 — 헛던졌을 때만 조용히 나옵니다. */}
      {stage === "idle" && hint ? (
        <button
          type="button"
          onClick={() => sequence.throwWithDefaultPower(DEFAULT_POWER)}
          disabled={!enabled || busy}
          className="mt-1 text-xs text-[#98A2B3] underline underline-offset-2 disabled:opacity-40"
        >
          버튼으로 던지기
        </button>
      ) : null}

      {/* 힘 게이지 (§4.2 — 당길수록 차오르는 시각 피드백) */}
      <div
        className="mt-3 h-1.5 w-44 rounded-full bg-white/10 transition-opacity duration-150"
        style={{ opacity: stage === "pulling" ? 1 : 0 }}
        aria-hidden
      >
        <div className="relative h-full w-full">
          <div
            className="h-full rounded-full"
            style={{
              width: `${Math.round(power * 100)}%`,
              background: strongEnough ? "#FF4D4D" : "rgba(255,255,255,0.35)",
            }}
          />
          {/* 여기를 넘겨야 날아갑니다 */}
          <div
            className="absolute -top-1 h-3.5 w-px bg-white/45"
            style={{ left: `${MIN_THROW_POWER * 100}%` }}
          />
        </div>
      </div>

      {/* 궤적 표시 — 방향은 늘 위(지도) 하나입니다. */}
      <div className="mt-3 flex h-9 flex-col items-center justify-end gap-1.5" aria-hidden>
        {[2, 1, 0].map((i) => {
          const lit = power > (i + 1) / 4;
          return (
            <div
              key={i}
              className="h-2.5 w-2.5 rotate-45 border-t-2 border-l-2 border-[#FF4D4D] transition-opacity duration-100"
              style={{ opacity: stage === "pulling" ? (lit ? 0.9 - i * 0.18 : 0.12) : 0.08 }}
            />
          );
        })}
      </div>

      {/* 다트 본체 */}
      <div
        ref={dartRef}
        role="button"
        tabIndex={enabled && !busy ? 0 : -1}
        aria-disabled={!enabled}
        aria-label="다트. 잡아서 아래로 당겼다 놓으면 날아갑니다. 키보드에서는 Enter 또는 Space 로 던집니다."
        onPointerDown={sequence.onPointerDown}
        onPointerMove={sequence.onPointerMove}
        onPointerUp={sequence.onPointerUp}
        onPointerCancel={sequence.onPointerCancel}
        onKeyDown={sequence.onKeyDown}
        className="mt-1 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-[#FF4D4D]"
        style={{
          touchAction: "none",
          userSelect: "none",
          WebkitUserSelect: "none",
          WebkitTapHighlightColor: "transparent",
          cursor: !enabled ? "not-allowed" : stage === "pulling" ? "grabbing" : "grab",
          opacity: dartVisible ? (enabled ? 1 : 0.35) : 0,
          transform: `translate3d(${pull.x}px, ${pull.y}px, 0) rotate(${tiltDeg}deg) scale(${dartScale(power)})`,
          // 당기는 동안에는 손을 그대로 따라오고, 놓으면 제자리로 돌아옵니다.
          transition:
            stage === "pulling" ? "none" : "transform 280ms cubic-bezier(0.2, 0.8, 0.3, 1)",
        }}
      >
        <div className={stage === "idle" && enabled ? "dart-bob" : undefined}>
          <DartGlyph />
        </div>
      </div>
    </div>
  );
}

export default DartThrowZone;
