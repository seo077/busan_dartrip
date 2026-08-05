"use client";

/**
 * 다트를 잡아 당겼다 놓는 자리 + 단계 캡션.
 *
 * 설계 정본: `화면구성도.md` §4.1(캡션·원칙 문구) · §4.2(구성 요소 2·3, 모션 최소화) · §4.3(상태)
 *            `AI 논의사항.md` Round 1 §D-36(다트 조준)
 *
 * 화면에 놓인 다트는 **집을 수 있다는 것이 먼저 보여야** 합니다. 그래서 가만히 있을 때
 * 살짝 흔들리고(`.dart-bob`), 바로 위에 "당겼다 놓으세요" 한 줄을 둡니다.
 * 당기는 동안에는 셋이 함께 움직입니다 — 다트가 손을 따라오고, 힘 게이지가 차고,
 * **위쪽 지도에 조준점이 따라다닙니다**(`AimReticle`).
 *
 * ── 캡션이 하는 일 (D-36) ───────────────────────────────────────────────────
 * 조준 중에는 **놓기 전에** 겨눈 구·군 이름이 여기 큰 글자로 나옵니다. 던진 뒤에는
 * "겨냥한 영도구!" 로 이어 붙여, 손으로 한 일과 나온 결과가 같다는 것을 글자가 확인해 줍니다.
 * 조준을 끈 상태에서는 종전대로 "16개 구·군 중 균등 추첨" 이 원칙 문구입니다(D-3 1단계).
 * 두 모드가 서로 다른 말을 하고, 어느 쪽도 상대의 문구를 빌려 쓰지 않습니다.
 *
 * 대체 경로 두 가지 — 조준이 어려운 환경에서도 던질 수 있어야 합니다:
 *   - 모션 최소화(`prefers-reduced-motion`) 설정이면 제스처 없이 **버튼 하나**로 던집니다(§4.2).
 *   - 드래그를 못 하는 경우를 위해 다트 자체가 초점을 받고 **Enter·Space** 로 던져집니다.
 *     이 두 길은 조준을 쓰지 않으므로 **균등 추첨**이고, 그 사실을 화면이 그대로 적습니다.
 */

import type { RefObject } from "react";

import { DartGlyph } from "@/components/home/DartGlyph";
import type { DartSequence } from "@/components/home/useDartSequence";
import type { AimState } from "@/lib/aim";
import { DEFAULT_POWER, MIN_THROW_POWER, dartScale } from "@/lib/gesture";

const PRINCIPLE_UNIFORM = "16개 구·군 중 균등 추첨";
const PRINCIPLE_AIMED = "겨눈 구·군 안에서 균등 추첨";

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
  /** 조준을 쓸 수 있는 상태인지 */
  aimActive: boolean;
  /** 지금 겨누고 있는 곳 (당기는 중에만) */
  aimPreview: AimState | null;
  /** 테마 이름 — 0곳 안내 문구에 씁니다 */
  themeName: string;
}

export function DartThrowZone({
  sequence,
  dartRef,
  enabled,
  notReadyReason,
  reducedMotion,
  districtName,
  aimActive,
  aimPreview,
  themeName,
}: Props) {
  const { stage, pull, power, tiltDeg, hint, busy, aim } = sequence;
  const strongEnough = power >= MIN_THROW_POWER;

  /** 이번 던지기가 조준으로 이뤄졌는지 — 캡션이 "겨냥한" 을 붙일 근거 */
  const aimedThrow = aim !== null;
  const principle = aimActive ? PRINCIPLE_AIMED : PRINCIPLE_UNIFORM;

  // 단계별 큰 글자 (§4.1 캡션)
  const caption = (() => {
    switch (stage) {
      case "pulling":
        if (aimPreview) {
          if (aimPreview.target.count === 0) return `${aimPreview.target.name} — 여긴 없어요`;
          return strongEnough ? `${aimPreview.target.name}` : `${aimPreview.target.name} · 더 당겨요`;
        }
        return strongEnough ? "놓으면 날아갑니다" : "조금 더 당겨 보세요";
      case "flying":
      case "waiting":
        return aim ? `${aim.target.name}으로!` : "던지는 중…";
      case "district":
        if (!districtName) return "던지는 중…";
        return aimedThrow ? `겨냥한 ${districtName}!` : `${districtName}!`;
      case "pinned":
        return aimedThrow ? "겨냥한 곳에 꽂혔습니다" : "꽂혔습니다";
      case "short":
        return "다트가 못 미쳤어요";
      case "blocked":
        return aim ? `${aim.target.name}에는 ${themeName} 장소가 없어요` : "여기엔 없어요";
      case "missed":
        return "다트를 놓쳤어요";
      default:
        return enabled
          ? aimActive
            ? "다트를 잡아 당겨 지도를 겨누세요"
            : "다트를 잡아 아래로 당겼다 놓으세요"
          : (notReadyReason ?? "지금은 던질 수 없어요");
    }
  })();

  // 작은 글자 — 쉬는 동안에는 원칙, 연출 중에는 §4.1 의 원칙 문구가 같은 자리에 옵니다.
  const subCaption = (() => {
    if (stage === "district" || stage === "pinned") return principle;
    if (stage === "blocked") return "다른 구·군을 겨누거나 테마를 바꿔 보세요";
    if (stage === "idle") {
      if (hint) return hint;
      // 조준의 규칙을 한 줄로 — 세게 당기면 멀리(북쪽), 옆으로 눕히면 당긴 쪽으로.
      return aimActive
        ? "세게 당길수록 멀리, 옆으로 눕히면 당긴 쪽으로"
        : `어디로 당겨도 ${principle}이에요`;
    }
    if (stage === "pulling") {
      if (aimPreview?.borderline && aimPreview.target.count > 0) return "구·군 경계 근처예요";
      if (aimPreview) return `${principle} · 놓으면 확정`;
      return "당긴 세기는 날아가는 속도만 바꿔요";
    }
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
          {stage === "district"
            ? PRINCIPLE_UNIFORM
            : `${PRINCIPLE_UNIFORM}으로 한 곳을 뽑아요`}
        </p>
      </div>
    );
  }

  // ── 제스처 ────────────────────────────────────────────────────────────────
  return (
    <div className="relative mt-6 flex min-h-60 flex-col items-center">
      <p
        aria-live="polite"
        className={`min-h-7 text-center text-base font-semibold break-keep ${
          stage === "blocked"
            ? "text-[#FFC9C9]"
            : stage === "district" || stage === "pinned"
              ? "text-[#FF9B9B]"
              : "text-[#F2F4F7]"
        }`}
      >
        {caption}
      </p>

      <p className="min-h-5 text-center text-xs break-keep text-[#98A2B3]">{subCaption}</p>

      {/* 드래그가 어려운 경우를 위한 빠져나갈 길 — 헛던졌을 때만 조용히 나옵니다. */}
      {stage === "idle" && hint ? (
        <button
          type="button"
          onClick={() => sequence.throwWithDefaultPower(DEFAULT_POWER)}
          disabled={!enabled || busy}
          className="mt-1 text-xs text-[#98A2B3] underline underline-offset-2 disabled:opacity-40"
        >
          조준 없이 버튼으로 던지기
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

      {/*
        세기 표시 — 화살표 세 개가 차오릅니다.
        겨눈 방향은 위 지도의 조준점이 답하므로, 여기서는 방향을 말하지 않습니다.
      */}
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
        aria-label={
          aimActive
            ? "다트. 잡아서 당기면 위 지도를 겨눌 수 있습니다. 세게 당길수록 지도 위쪽, 옆으로 눕히면 당긴 쪽을 겨눕니다. 놓으면 겨눈 구·군으로 날아갑니다. 키보드에서는 Enter 또는 Space 로 조준 없이 던지며 16개 구·군 중 균등 추첨이 됩니다."
            : "다트. 잡아서 아래로 당겼다 놓으면 날아갑니다. 키보드에서는 Enter 또는 Space 로 던집니다."
        }
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
