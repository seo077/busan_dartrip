"use client";

/**
 * S8 상단 바의 `⋮` — 로그아웃 (§15.1 · §15.3-7 · §15.5).
 *
 * 설계 정본: `화면구성도.md` §14.5(로그아웃을 상단 바가 아니라 여기 두는 이유) · §15.5(전이)
 *
 * **로그아웃이 S1 상단 바에 없는 이유**는 §14.5 에 있습니다 — 거기 두면 로그인 상태를 늘
 * 드러내야 하는데, 이 서비스에서 계정은 곁다리 기능이라 첫 화면이 그것을 계속 말할 이유가
 * 없습니다. 그래서 계정과 관련된 자리(스탬프판) 안에 둡니다.
 */

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";

export function LogoutMenu() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const logout = useCallback(async () => {
    setBusy(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // 나가는 길을 막지 않습니다 — 서버도 같은 원칙입니다(`app/api/auth/logout`).
    }
    // §15.5 — 로그아웃하면 S1 입니다.
    router.replace("/");
    router.refresh();
  }, [router]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="메뉴"
        aria-expanded={open}
        className="flex h-11 w-11 items-center justify-center rounded-full text-lg text-[#98A2B3]"
      >
        ⋮
      </button>

      {open ? (
        <>
          {/* 바깥을 눌러도 닫힙니다 — 막다른 곳을 두지 않습니다 (§2.4) */}
          <button
            type="button"
            aria-label="메뉴 닫기"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-10 cursor-default"
          />
          <div className="absolute right-0 z-20 mt-1 w-36 overflow-hidden rounded-2xl border border-white/10 bg-[#171B22]">
            <button
              type="button"
              disabled={busy}
              onClick={() => void logout()}
              className="min-h-12 w-full px-4 text-left text-sm text-[#F2F4F7] disabled:text-[#98A2B3]"
            >
              {busy ? "나가는 중…" : "로그아웃"}
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

export default LogoutMenu;
