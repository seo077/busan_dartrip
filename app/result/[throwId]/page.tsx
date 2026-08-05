/**
 * S3 — 결과.
 *
 * 설계 정본: `화면구성도.md` §5 / `API데이터설계.md` §5.3(`throws`) · §7.4("이 근처") · §8
 *
 * **이 화면은 서버에서 그려집니다.** `throwId` 하나만 있으면 DB 의 결과 스냅샷으로 화면 전체가
 * 복원되므로, 공유 링크를 처음 받은 사람도 던진 사람과 같은 화면을 봅니다(D-18).
 * 브라우저에 남아 있는 값(직전 던지기 결과·설정)에 기대는 곳이 한 군데도 없습니다.
 *
 * 조회를 `/api/throw/:id` 를 거치지 않고 서버에서 바로 하는 이유는 §8 의 그 Route 와 하는 일이
 * 같은데(같은 `loadThrowResult`), 화면이 서버 컴포넌트라 자기 서버로 한 번 더 나갔다 오는
 * 왕복이 순수한 낭비이기 때문입니다. 브라우저가 결과를 직접 받아야 할 곳이 생기면 그때 Route 를
 * 세웁니다 — 조회 본체는 이미 `lib/dart.ts` 에 나뉘어 있어 그 작업이 함수 하나 호출입니다.
 *
 * 만료·미존재는 `notFound()` 로 보냅니다(§5.4 "잘못된 링크"). 화면은 같은 폴더의
 * `not-found.tsx` 이고, 응답 코드도 404 가 되어 링크를 긁어 가는 쪽에도 사실대로 알려집니다.
 */

import { cache } from "react";
import { notFound } from "next/navigation";

import { DataSources } from "@/components/DataSources";
import { ResultHero } from "@/components/result/ResultHero";
import { ResultNotice } from "@/components/result/ResultNotice";
import { DartError, loadThrowResult } from "@/lib/dart";

/**
 * 만료 시각을 요청 시점마다 다시 봐야 하므로 이 화면은 캐시하지 않습니다.
 * (스냅샷 자체는 안 바뀌지만, "아직 볼 수 있는가" 는 시간에 따라 바뀝니다)
 */
export const dynamic = "force-dynamic";

/** 한 요청 안에서 두 번 이상 부르게 되어도 DB 조회는 한 번만 나가게 묶어 둡니다. */
const readResult = cache((throwId: string) => loadThrowResult(throwId));

/** 던졌을 때의 범위·테마를 그대로 달고 S1 로 돌아가는 주소 (§5.3-6 "동일 설정 유지") */
function rethrowHref(scope: string | null, theme: string | null): string {
  const query = new URLSearchParams();
  if (scope) query.set("scope", scope);
  if (theme) query.set("theme", theme);
  const q = query.toString();
  return q ? `/?${q}` : "/";
}

export default async function ResultPage({
  params,
}: {
  params: Promise<{ throwId: string }>;
}) {
  const { throwId } = await params;

  let lookup: Awaited<ReturnType<typeof loadThrowResult>>;
  try {
    lookup = await readResult(throwId);
  } catch (e) {
    // 조회 실패 (§5.4 "오류"). 같은 주소를 다시 여는 것이 곧 [다시 시도] 입니다.
    const message =
      e instanceof DartError && e.reason === "missing_config"
        ? "아직 준비가 끝나지 않았어요. 잠시 후 다시 열어 주세요."
        : "결과를 불러오지 못했어요.";
    return (
      <main className="mx-auto min-h-screen w-full max-w-lg bg-[#0E1116] text-[#F2F4F7]">
        <ResultNotice
          title={message}
          body="잠깐의 문제일 수 있어요. 다시 시도해 보시고, 그래도 안 되면 새로 던져 보세요."
          actionLabel="다시 시도"
          actionHref={`/result/${encodeURIComponent(throwId)}`}
        />
        <DataSources />
      </main>
    );
  }

  // 미존재·만료 — 두 경우가 사용자에게는 같은 일입니다 (§5.4 "잘못된 링크")
  if (lookup.kind !== "ok") notFound();

  const { place, sigungu, nearby, scope, theme } = lookup.result;
  const backToSetup = rethrowHref(scope, theme);

  return (
    <main className="mx-auto min-h-screen w-full max-w-lg bg-[#0E1116] text-[#F2F4F7]">
      <ResultHero
        place={place}
        sigunguName={sigungu.name}
        nearbyCount={nearby.length}
        rethrowHref={backToSetup}
      />

      <DataSources />
    </main>
  );
}
