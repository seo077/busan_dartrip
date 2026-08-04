/**
 * `/data` — 공공데이터 연동 확인 화면.
 *
 * 설계 정본: `ARCHITECTURE.md` AD-14 / `API데이터설계.md` §3.1(국문 관광정보 서비스) · §10(출처 표기)
 *
 * 이 화면의 목적은 하나입니다. 공공데이터포털 **운영계정 승인요건 ③("앱/웹에서 OpenAPI
 * 적용 확인")** 의 증거를 배포된 URL 위에 남기는 것입니다. 심사자가 이 주소를 열면
 * 서비스가 한국관광공사 OpenAPI 를 실제로 호출해 받은 결과를 눈으로 확인할 수 있습니다.
 *
 * 원래는 첫 화면(`app/page.tsx`)에 있던 뼈대 배포판이며, 그 자리에 S1 홈이 들어오면서
 * 이 경로로 옮겼습니다. 내용은 옮기기 전과 같습니다.
 *
 * 서버 컴포넌트에서 `lib/tourapi.ts` 를 직접 부릅니다. `/api/tour` 도 **같은 함수**를 쓰며,
 * 자기 자신을 HTTP 로 다시 부르지 않습니다(배포 환경에서 절대 URL 이 필요해지고 왕복이 한 번 늡니다).
 * 응답 원문을 그대로 보고 싶으면 `/api/tour` 를 열면 됩니다.
 *
 * 서비스키는 서버에서만 읽습니다. 이 화면의 어떤 출력에도 키가 들어가지 않습니다.
 */

import Link from "next/link";

import { DataSources } from "@/components/DataSources";
import { fetchAreaBasedList, TourApiError, type TourPlace } from "@/lib/tourapi";

export const dynamic = "force-dynamic";

type LoadState =
  | { kind: "ok"; totalCount: number; fetched: number; filteredOut: number; items: TourPlace[] }
  | { kind: "missing_key" }
  | { kind: "error"; message: string; detail?: string };

async function load(): Promise<LoadState> {
  try {
    const result = await fetchAreaBasedList({ numOfRows: 12, pageNo: 1 });
    return {
      kind: "ok",
      totalCount: result.totalCount,
      fetched: result.fetched,
      filteredOut: result.filteredOut,
      items: result.items,
    };
  } catch (e) {
    if (e instanceof TourApiError) {
      if (e.reason === "missing_key") return { kind: "missing_key" };
      return { kind: "error", message: e.message, detail: e.detail };
    }
    return {
      kind: "error",
      message: e instanceof Error ? e.message : "알 수 없는 오류입니다.",
    };
  }
}

function SetupGuide() {
  return (
    <section className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-5 text-sm leading-relaxed">
      <h2 className="mb-2 text-base font-semibold">환경변수가 아직 비어 있습니다</h2>
      <p className="mb-3">
        공공데이터포털 서비스키가 설정되지 않아 관광 정보를 불러오지 못했습니다. 아래 두
        단계면 이 화면에 실제 데이터가 뜹니다.
      </p>
      <ol className="ml-5 list-decimal space-y-1">
        <li>
          저장소 루트의 <code className="rounded bg-white/10 px-1">.env.example</code> 을{" "}
          <code className="rounded bg-white/10 px-1">.env.local</code> 로 복사합니다.
        </li>
        <li>
          <code className="rounded bg-white/10 px-1">DATA_GO_KR_KEY</code> 에 공공데이터포털
          일반 인증키를 넣고 개발 서버를 다시 시작합니다.
        </li>
      </ol>
      <p className="mt-3 text-xs text-[#98A2B3]">
        배포 환경에서는 Vercel 프로젝트 설정 &gt; Environment Variables 에 같은 이름으로
        등록합니다. 서비스키는 서버에서만 읽히며 브라우저로 전달되지 않습니다.
      </p>
    </section>
  );
}

function ErrorPanel({ message, detail }: { message: string; detail?: string }) {
  return (
    <section className="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-5 text-sm leading-relaxed">
      <h2 className="mb-2 text-base font-semibold">관광 정보를 불러오지 못했습니다</h2>
      <p>{message}</p>
      {detail ? (
        <pre className="mt-3 overflow-x-auto rounded bg-white/10 p-3 text-xs whitespace-pre-wrap">
          {detail}
        </pre>
      ) : null}
      <p className="mt-3 text-xs text-[#98A2B3]">
        서비스키가 맞는지, 하루 호출 한도를 넘지 않았는지 확인해 주세요.
      </p>
    </section>
  );
}

function PlaceCard({ place }: { place: TourPlace }) {
  return (
    <li className="overflow-hidden rounded-2xl border border-white/10 bg-[#171B22]">
      {place.firstImage ? (
        // 무료 티어의 이미지 최적화 사용량을 아끼기 위해 원본을 그대로 씁니다.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={place.firstImage}
          alt=""
          className="h-40 w-full object-cover"
          loading="lazy"
        />
      ) : (
        <div className="flex h-40 w-full items-center justify-center bg-white/5 text-xs text-[#98A2B3]">
          이미지 없음
        </div>
      )}
      <div className="space-y-1 p-4">
        <h3 className="font-semibold">{place.name}</h3>
        <p className="text-sm text-[#98A2B3]">{place.address ?? "주소 정보 없음"}</p>
        <p className="text-xs text-[#98A2B3]">
          위도 {place.lat ?? "—"} · 경도 {place.lng ?? "—"}
          {place.cat1 ? ` · 분류 ${place.cat1}` : ""}
        </p>
      </div>
    </li>
  );
}

export default async function DataCheckPage() {
  const state = await load();

  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl bg-[#0E1116] text-[#F2F4F7]">
      <div className="px-5 py-10">
        <header className="mb-8">
          <p className="text-xs tracking-wide text-[#98A2B3]">공공데이터 연동 확인</p>
          <h1 className="mt-1 text-3xl font-bold">부산 Dartrip</h1>
          <p className="mt-3 text-sm leading-relaxed text-[#98A2B3]">
            아래 목록은 <strong className="text-[#F2F4F7]">한국관광공사 국문 관광정보 서비스
            (KorService2 / areaBasedList2)</strong> OpenAPI 를 서버에서 호출해 받은 실제
            응답입니다. 화면에 그려 두기만 한 값이 아니라 페이지를 열 때마다 새로 호출합니다.
          </p>
          <p className="mt-2 text-sm leading-relaxed text-[#98A2B3]">
            응답 원문은{" "}
            <Link href="/api/tour" className="text-[#FF4D4D] underline underline-offset-2">
              /api/tour
            </Link>{" "}
            에서 그대로 확인할 수 있습니다. 서비스키는 서버에서만 읽으며 응답 어디에도 들어가지
            않습니다.
          </p>
          <p className="mt-4 text-sm">
            <Link href="/" className="text-[#98A2B3] underline underline-offset-2">
              ← 서비스 첫 화면으로
            </Link>
          </p>
        </header>

        {state.kind === "missing_key" ? <SetupGuide /> : null}
        {state.kind === "error" ? (
          <ErrorPanel message={state.message} detail={state.detail} />
        ) : null}

        {state.kind === "ok" ? (
          <>
            <section className="mb-6 rounded-2xl border border-white/10 bg-[#171B22] p-4 text-sm">
              <p>
                한국관광공사 국문 관광정보 서비스가 부산 지역에 대해 현재 제공하는 장소는 총{" "}
                <strong>{state.totalCount.toLocaleString("ko-KR")}건</strong>입니다.
              </p>
              <p className="mt-1 text-xs text-[#98A2B3]">
                아래는 그중 {state.items.length}건입니다.
                {state.filteredOut > 0
                  ? ` 제공기관이 비노출로 표시한 ${state.filteredOut}건은 목록에서 제외했습니다.`
                  : ""}
              </p>
              <p className="mt-1 text-xs text-[#98A2B3]">
                이 수는 <code>areaBasedList2</code> 가 돌려주는{" "}
                <strong className="text-[#F2F4F7]">현재 노출 대상</strong>입니다. 동기화용{" "}
                <code>areaBasedSyncList2</code> 는 삭제·미노출 이력까지 포함해 더 큰 수를
                돌려주며, 두 값이 다른 것은 정상입니다.
              </p>
            </section>

            {state.items.length > 0 ? (
              <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {state.items.map((place) => (
                  <PlaceCard key={place.sourceId} place={place} />
                ))}
              </ul>
            ) : (
              <p className="text-sm text-[#98A2B3]">표시할 장소가 없습니다.</p>
            )}
          </>
        ) : null}
      </div>

      <DataSources />
    </main>
  );
}
