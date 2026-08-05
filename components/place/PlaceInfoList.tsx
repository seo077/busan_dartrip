"use client";

/**
 * S4 — 정보 (§6.1 "── 정보 ──" · §6.3-5).
 *
 * 설계 정본: `화면구성도.md` §6.1(주소 탭→복사 / 전화 탭→전화 / 홈페이지 탭→새 탭)
 *            §6.3-5("있는 항목만 표시")
 *
 * 세 줄 모두 **값이 있을 때만** 나옵니다. 세 줄이 다 없으면 부르는 쪽에서 블록을 생략합니다.
 *
 * 주소 복사가 막힌 환경(권한 거부·비보안 컨텍스트)에서도 버튼이 아무 반응 없이 끝나지 않게,
 * 실패하면 "직접 복사해 주세요" 로 물러섭니다 — `ShareButton` 과 같은 방식입니다.
 */

import { useCallback, useEffect, useRef, useState } from "react";

type Notice = "copied" | "manual" | null;

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-4 border-b border-white/5 py-3 last:border-0">
      <span className="w-16 shrink-0 text-sm text-[#98A2B3]">{label}</span>
      <div className="min-w-0 flex-1 text-sm break-keep text-[#F2F4F7]">{children}</div>
    </div>
  );
}

export function PlaceInfoList({
  address,
  tel,
  homepage,
}: {
  address: string | null;
  tel: string | null;
  homepage: string | null;
}) {
  const [notice, setNotice] = useState<Notice>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  const copy = useCallback(async (value: string) => {
    let ok = false;
    try {
      await navigator.clipboard.writeText(value);
      ok = true;
    } catch {
      ok = false;
    }
    setNotice(ok ? "copied" : "manual");
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setNotice(null), 2400);
  }, []);

  if (!address && !tel && !homepage) return null;

  return (
    <section className="border-t border-white/10 px-5 py-6">
      <h2 className="mb-1 text-sm font-semibold text-[#98A2B3]">정보</h2>

      <div>
        {address ? (
          <Row label="주소">
            <button
              type="button"
              onClick={() => void copy(address)}
              className="min-h-11 text-left break-keep underline-offset-4 hover:underline"
            >
              {address}
            </button>
          </Row>
        ) : null}

        {tel ? (
          <Row label="전화">
            <a href={`tel:${tel.replace(/[^0-9+]/g, "")}`} className="min-h-11 underline-offset-4 hover:underline">
              {tel}
            </a>
          </Row>
        ) : null}

        {homepage ? (
          <Row label="홈페이지">
            <a
              href={homepage}
              target="_blank"
              rel="noreferrer noopener"
              className="block min-h-11 truncate underline-offset-4 hover:underline"
            >
              {homepage.replace(/^https?:\/\//, "")}
            </a>
          </Row>
        ) : null}
      </div>

      <span aria-live="polite" className="sr-only">
        {notice === "copied" ? "주소를 복사했습니다" : ""}
      </span>
      {notice ? (
        <p className="mt-2 text-xs text-[#98A2B3]">
          {notice === "copied" ? "주소를 복사했어요" : "주소를 직접 선택해 복사해 주세요"}
        </p>
      ) : null}
    </section>
  );
}

export default PlaceInfoList;
