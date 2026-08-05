"use client";

/**
 * S3 결과 — 공유 (§5.3-10 · §5.5).
 *
 * 설계 정본: `화면구성도.md` §5.3-10(우상단 ⤴, OS 공유 시트로 URL 전달) · §5.5(전이)
 *            D-18(결과 공유 = v1 범위)
 *
 * 공유하는 것은 **지금 보고 있는 주소 하나**입니다(`/result/:throwId`). 결과는 서버 스냅샷으로
 * 남아 있고 화면은 그 주소만으로 복원되므로, 받은 사람은 던진 사람과 같은 화면을 봅니다.
 *
 * 경로가 둘입니다.
 *   1) OS 공유 시트(`navigator.share`) — 모바일 브라우저 대부분. 설계가 말한 그 자리입니다.
 *   2) 링크 복사(`navigator.clipboard`) — 공유 시트가 없는 환경(주로 데스크톱 브라우저).
 * 둘 다 막힌 환경에서는 "주소를 직접 복사해 주세요" 로 물러섭니다. 어느 경우에도 버튼이
 * 아무 반응 없이 끝나지 않게 합니다.
 *
 * 사용자가 공유 시트를 그냥 닫은 것(AbortError)은 실패가 아니므로 아무 말도 하지 않습니다.
 */

import { useCallback, useEffect, useRef, useState } from "react";

type Notice = "copied" | "manual" | null;

export function ShareButton({ title, text }: { title: string; text: string }) {
  const [notice, setNotice] = useState<Notice>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  const flash = useCallback((value: Exclude<Notice, null>) => {
    setNotice(value);
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setNotice(null), 2400);
  }, []);

  const share = useCallback(async () => {
    const url = window.location.href;

    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title, text, url });
        return;
      } catch (e) {
        // 사용자가 닫은 것은 실패가 아닙니다.
        if (e instanceof DOMException && e.name === "AbortError") return;
        // 그 밖의 실패는 복사로 이어서 시도합니다.
      }
    }

    try {
      await navigator.clipboard.writeText(url);
      flash("copied");
    } catch {
      flash("manual");
    }
  }, [flash, text, title]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => void share()}
        aria-label="이 결과 공유하기"
        className="flex h-11 w-11 items-center justify-center rounded-full text-xl text-[#F2F4F7]"
      >
        <span aria-hidden>⤴</span>
      </button>

      <span aria-live="polite" className="sr-only">
        {notice === "copied" ? "링크를 복사했습니다" : ""}
      </span>

      {notice ? (
        <p className="absolute top-12 right-1 w-max max-w-[70vw] rounded-xl bg-black/75 px-3 py-2 text-xs break-keep text-[#F2F4F7] backdrop-blur-sm">
          {notice === "copied"
            ? "링크를 복사했어요"
            : "주소창의 주소를 복사해 공유해 주세요"}
        </p>
      ) : null}
    </div>
  );
}

export default ShareButton;
