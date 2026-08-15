/**
 * S1 — 홈 · 다트 설정.
 *
 * 설계 정본: `화면구성도.md` §3 / `API데이터설계.md` §7.2 · §8
 *
 * 상단 바의 ⓘ 는 S6 정보 화면(`/about`)으로 갑니다 (§3.4 전이표 "ⓘ → S6").
 *
 * 상단 바 · 설정 영역 · 데이터 출처 세 조각으로 되어 있고, 가운데 설정 영역만
 * 브라우저에서 도는 컴포넌트입니다(`components/home/DartSetup.tsx`).
 * 집계표를 **화면에서 직접 받아** 로딩·오류·다시 시도 상태를 §3.3 대로 두기 위해서입니다.
 *
 * 이 자리에 있던 뼈대 배포판(AD-14 — 공공데이터 적용 확인용 목록 화면)은 걷어냈습니다.
 * 같은 공공데이터 호출 경로는 `/api/tour` 에 그대로 남아 있습니다.
 *
 * ── 주소로 들어오는 초기 설정 (`?scope=`·`?theme=`) ──────────────────────────
 * S3 의 [다시 던지기] 가 **던졌을 때의 범위·테마를 그대로 달고** 이 화면으로 돌아옵니다
 * (`화면구성도.md` §5.3-6 "동일 설정 유지"). 값을 여기 서버 쪽에서 받아 넘기므로,
 * 브라우저 저장소나 이전 화면의 상태에 기대는 통로를 만들지 않습니다.
 * 값이 이상하면 조용히 기본값(부산 전체 · 전체 테마)으로 떨어집니다.
 */

import Link from "next/link";

import { DartSetup } from "@/components/home/DartSetup";
import { DataSources } from "@/components/DataSources";
import { readCurrentUser } from "@/lib/auth";
import { isThemeKey } from "@/lib/theme";

export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;

  const scopeRaw = params.scope;
  const scope =
    typeof scopeRaw === "string" && scopeRaw !== "" && scopeRaw.length <= 40 ? scopeRaw : null;

  const themeRaw = params.theme;
  const theme = isThemeKey(themeRaw) ? themeRaw : null;

  // §14.5 — `👤` 는 로그인 전이면 `/login`, 로그인 후면 스탬프판(내 기록의 첫 화면)입니다.
  // **로그인 여부를 이 표식 말고 다른 곳에서는 드러내지 않습니다** — 계정은 곁다리 기능이라
  // 첫 화면이 그것을 계속 말할 이유가 없고, 로그아웃도 스탬프판 안에 둡니다(§14.5).
  const user = await readCurrentUser();

  return (
    <main className="mx-auto min-h-screen w-full max-w-lg bg-canvas text-ink">
      {/* 상단 바 (§2.1 · §3.2-1) — ⓘ → S6 정보 (§3.4 전이표) · 👤 → S7/S8 (§14.5) */}
      <header className="flex h-14 items-center justify-between px-5">
        <h1 className="text-lg font-bold">부산 Dartrip</h1>
        <div className="flex items-center">
          <Link
            href={user ? "/stamps" : "/login"}
            aria-label={user ? "내 스탬프" : "로그인"}
            className="flex h-11 w-11 items-center justify-center rounded-full text-lg text-ink-muted"
          >
            👤
          </Link>
          <Link
            href="/about"
            aria-label="정보"
            className="flex h-11 w-11 items-center justify-center rounded-full text-lg text-ink-muted"
          >
            ⓘ
          </Link>
        </div>
      </header>

      <DartSetup initialScope={scope} initialTheme={theme} />

      <DataSources />
    </main>
  );
}
