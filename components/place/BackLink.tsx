"use client";

/**
 * S4 — 뒤로 (§6.5 "뒤로 → S3 (직접 진입 시 S1)").
 *
 * 전이표가 도착지를 두 가지로 적어 둔 이유는 하나입니다. 이 화면은 **공유 가능한 주소**라
 * (§6 머리말) 결과 화면을 거치지 않고 바로 열리는 경우가 있고, 그때 S3 로 보내면 사용자가
 * 본 적 없는 화면이 나옵니다.
 *
 * 그래서 브라우저에 되돌아갈 기록이 있으면 그대로 뒤로 가고(= 대개 S3), 없으면 홈(S1)으로
 * 보냅니다. 어느 쪽이든 막다른 곳에 두지 않습니다 (§2.4).
 */

import { useRouter } from "next/navigation";

export function BackLink() {
  const router = useRouter();

  return (
    <button
      type="button"
      aria-label="뒤로"
      onClick={() => {
        if (typeof window !== "undefined" && window.history.length > 1) router.back();
        else router.push("/");
      }}
      className="flex h-11 w-11 items-center justify-center rounded-full text-xl text-ink"
    >
      <span aria-hidden>←</span>
    </button>
  );
}

export default BackLink;
