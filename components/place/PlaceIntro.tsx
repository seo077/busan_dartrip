"use client";

/**
 * S4 — 소개 (§6.1 "── 소개 ──" · §6.3-4).
 *
 * 설계 정본: `화면구성도.md` §6.1(더보기 접힘 4줄) · §6.3-4("없을 때: 블록 생략")
 *
 * 글이 없으면 이 컴포넌트 자체가 그려지지 않습니다 — 부르는 쪽에서 걸러 냅니다.
 * "소개 없음" 같은 빈 껍데기를 남기지 않는 것이 규칙입니다 (AD-8).
 *
 * 접는 기준을 글자 수가 아니라 **줄 수(4줄)** 로 둔 것은 설계 그대로입니다. 소개문 길이가
 * 장소마다 크게 달라서(수십 자 ~ 수천 자) 글자 수로 자르면 어떤 장소는 문장 중간이 잘립니다.
 */

import { useState } from "react";

export function PlaceIntro({ text, source }: { text: string; source?: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <section className="border-t border-line px-5 py-6">
      <h2 className="mb-3 text-sm font-semibold text-ink-muted">소개</h2>

      <p
        className={`text-sm leading-relaxed break-keep whitespace-pre-line text-ink ${
          expanded ? "" : "line-clamp-4"
        }`}
      >
        {text}
      </p>

      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="mt-2 min-h-11 text-sm text-ink-muted underline underline-offset-4"
      >
        {expanded ? "접기" : "더보기"}
      </button>

      {source ? <p className="mt-1 text-[11px] text-ink-muted">{source}</p> : null}
    </section>
  );
}

export default PlaceIntro;
