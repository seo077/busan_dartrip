/**
 * 첫 화면 — 뼈대 배포판 (AD-14).
 *
 * 목적은 두 가지입니다.
 *  1. 공공데이터포털 운영계정 승인요건 ③("앱/웹에서 OpenAPI 적용 확인")을 충족할
 *     공개 URL 을 확보한다.
 *  2. 공공누리 출처표시 의무를 첫날부터 지킨다 (`API데이터설계.md` §10).
 *
 * 이 화면은 최종 S1(홈 — 다트 설정)이 아닙니다. S1 은 구간 ④ 작업입니다.
 *
 * 서버 컴포넌트에서 `lib/tourapi.ts` 를 직접 부릅니다. `/api/tour` 도 같은 함수를 쓰며,
 * 자기 자신을 HTTP 로 다시 부르지 않습니다(배포 환경에서 절대 URL 이 필요해지고 왕복이 한 번 늡니다).
 */

import { fetchAreaBasedList, TourApiError, type TourPlace } from "@/lib/tourapi";

export const dynamic = "force-dynamic";

const DATA_SOURCES = [
  "한국관광공사 — 국문 관광정보 서비스",
  "한국관광공사 — 관광지별 연관관광지 정보",
  "한국관광공사 — 두루누비 정보 서비스",
  "한국관광공사 — 관광사진 정보",
  "부산광역시 — 부산명소정보",
  "국가유산청 — 국가유산 공간정보",
  "행정안전부 — 전국모범음식점표준데이터",
  "카카오 — 카카오맵",
];

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
    <section className="rounded-lg border border-amber-300 bg-amber-50 p-5 text-sm leading-relaxed dark:border-amber-700/60 dark:bg-amber-950/30">
      <h2 className="mb-2 text-base font-semibold">환경변수가 아직 비어 있습니다</h2>
      <p className="mb-3">
        공공데이터포털 서비스키가 설정되지 않아 관광 정보를 불러오지 못했습니다. 아래
        두 단계면 이 화면에 실제 데이터가 뜹니다.
      </p>
      <ol className="ml-5 list-decimal space-y-1">
        <li>
          저장소 루트의 <code className="rounded bg-black/10 px-1">.env.example</code> 을{" "}
          <code className="rounded bg-black/10 px-1">.env.local</code> 로 복사합니다.
        </li>
        <li>
          <code className="rounded bg-black/10 px-1">DATA_GO_KR_KEY</code> 에 공공데이터포털
          일반 인증키를 넣고 개발 서버를 다시 시작합니다.
        </li>
      </ol>
      <p className="mt-3 text-xs opacity-80">
        배포 환경에서는 Vercel 프로젝트 설정 &gt; Environment Variables 에 같은 이름으로
        등록합니다. 서비스키는 서버에서만 읽히며 브라우저로 전달되지 않습니다.
      </p>
    </section>
  );
}

function ErrorPanel({ message, detail }: { message: string; detail?: string }) {
  return (
    <section className="rounded-lg border border-rose-300 bg-rose-50 p-5 text-sm leading-relaxed dark:border-rose-800/60 dark:bg-rose-950/30">
      <h2 className="mb-2 text-base font-semibold">관광 정보를 불러오지 못했습니다</h2>
      <p>{message}</p>
      {detail ? (
        <pre className="mt-3 overflow-x-auto rounded bg-black/10 p-3 text-xs whitespace-pre-wrap">
          {detail}
        </pre>
      ) : null}
      <p className="mt-3 text-xs opacity-80">
        서비스키가 맞는지, 하루 호출 한도를 넘지 않았는지 확인해 주세요.
      </p>
    </section>
  );
}

function PlaceCard({ place }: { place: TourPlace }) {
  return (
    <li className="overflow-hidden rounded-lg border border-black/10 dark:border-white/15">
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
        <div className="flex h-40 w-full items-center justify-center bg-black/5 text-xs opacity-60 dark:bg-white/5">
          이미지 없음
        </div>
      )}
      <div className="space-y-1 p-4">
        <h3 className="font-semibold">{place.name}</h3>
        <p className="text-sm opacity-75">{place.address ?? "주소 정보 없음"}</p>
        <p className="text-xs opacity-60">
          위도 {place.lat ?? "—"} · 경도 {place.lng ?? "—"}
          {place.cat1 ? ` · 분류 ${place.cat1}` : ""}
        </p>
      </div>
    </li>
  );
}

export default async function Home() {
  const state = await load();

  return (
    <div className="mx-auto min-h-screen w-full max-w-5xl px-5 py-10">
      <header className="mb-8">
        <p className="text-xs tracking-wide opacity-60">뼈대 배포판</p>
        <h1 className="mt-1 text-3xl font-bold">부산 Dartrip</h1>
        <p className="mt-2 text-sm leading-relaxed opacity-80">
          부산 지도에 다트를 던져 갈 곳을 우연으로 정하는 서비스입니다. 이 페이지는 공공
          데이터 연동을 확인하기 위한 초기 화면이며, 다트 기능은 이후 단계에서 붙습니다.
        </p>
      </header>

      {state.kind === "missing_key" ? <SetupGuide /> : null}
      {state.kind === "error" ? (
        <ErrorPanel message={state.message} detail={state.detail} />
      ) : null}

      {state.kind === "ok" ? (
        <>
          <section className="mb-6 rounded-lg border border-black/10 p-4 text-sm dark:border-white/15">
            <p>
              한국관광공사 국문 관광정보 서비스가 부산 지역에 대해 현재 제공하는 장소는 총{" "}
              <strong>{state.totalCount.toLocaleString("ko-KR")}건</strong>입니다.
            </p>
            <p className="mt-1 text-xs opacity-70">
              아래는 그중 {state.items.length}건입니다.
              {state.filteredOut > 0
                ? ` 제공기관이 비노출로 표시한 ${state.filteredOut}건은 목록에서 제외했습니다.`
                : ""}
            </p>
            <p className="mt-1 text-xs opacity-70">
              이 수는 <code>areaBasedList2</code> 가 돌려주는 <strong>현재 노출 대상</strong>
              입니다. 동기화용 <code>areaBasedSyncList2</code> 는 삭제·미노출 이력까지 포함해
              더 큰 수를 돌려주며, 두 값이 다른 것은 정상입니다.
            </p>
          </section>

          {state.items.length > 0 ? (
            <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {state.items.map((place) => (
                <PlaceCard key={place.sourceId} place={place} />
              ))}
            </ul>
          ) : (
            <p className="text-sm opacity-70">표시할 장소가 없습니다.</p>
          )}
        </>
      ) : null}

      <footer className="mt-12 border-t border-black/10 pt-6 text-xs leading-relaxed opacity-80 dark:border-white/15">
        <h2 className="mb-2 text-sm font-semibold opacity-100">데이터 출처</h2>
        <p className="mb-2">본 서비스는 아래 기관이 제공하는 공공데이터를 활용합니다.</p>
        <ul className="mb-3 space-y-0.5">
          {DATA_SOURCES.map((source) => (
            <li key={source}>· {source}</li>
          ))}
        </ul>
        <p>
          위 데이터는 공공누리 이용허락 조건에 따라 출처를 표시하여 사용합니다. 데이터의
          최신성·정확성은 각 제공기관의 갱신 주기를 따르며, 실제 운영 정보는 방문 전
          확인해 주세요.
        </p>
      </footer>
    </div>
  );
}
