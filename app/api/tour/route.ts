/**
 * GET /api/tour — 한국관광공사 국문 관광정보 서비스(KorService2) `areaBasedList2` 조회.
 *
 * 뼈대 배포(AD-14)에서 공공데이터포털 운영계정 승인요건 ③("앱/웹에서 OpenAPI 적용 확인")을
 * 충족시키는 지점입니다. 실제 호출은 `lib/tourapi.ts` 한 곳에서만 일어나며,
 * 첫 화면(`app/page.tsx`)도 같은 함수를 씁니다.
 *
 * 서비스키는 서버에서만 읽습니다. 응답 어디에도 키가 들어가지 않습니다.
 *
 * 왜 응답을 캐시하는가 (DF-4)
 * ---------------------------
 * 이 경로는 **인증 없이 열려 있고 부를 때마다 관광공사로 나갑니다.** 개발계정 일 한도는
 * 1,000회이고 배포 주소는 1차 심사 제출 항목이라 공개된 채로 심사 기간을 보냅니다. 주소를
 * 아는 사람이 새로고침을 반복하는 것만으로 그날의 한도가 사라지고, 그러면 **운영계정
 * 승인요건 ③의 증거 화면(`/data`) 자체가 빈 화면**이 됩니다.
 *
 * 상한을 걸지 않고 캐시를 택한 이유 — 이 경로는 DB 를 전혀 쓰지 않습니다. 카운터를 두면
 * 외부 호출을 아끼려고 DB 쓰기를 새로 만드는 셈이 되어 지키려던 무료 티어를 다른 쪽에서
 * 깎습니다. 같은 질의는 같은 답이 오므로 **CDN 이 질의별로 5분간 들고 있으면** 반복 호출이
 * 외부까지 닿지 않습니다.
 *
 * 5분인 이유 — 이 화면은 "OpenAPI 가 붙어 있다" 를 보여 주는 확인 창구입니다. 5분 늦은
 * 값으로도 그 사실은 그대로 보이고, 원본 데이터 자체가 하루 단위로 갱신됩니다.
 * 오류 응답은 캐시하지 않습니다 — 키를 고치자마자 화면이 살아나야 합니다.
 *
 * 질의 파라미터
 *   pageNo        기본 1
 *   numOfRows     기본 12 (최대 100)
 *   sigunguCode   구·군 코드 (선택)
 *   contentTypeId 12 관광지 / 14 문화시설 / 28 레포츠 / 39 음식점 등 (선택)
 */

import { NextResponse } from "next/server";
import { fetchAreaBasedList, TourApiError } from "@/lib/tourapi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** DF-4 — 같은 질의는 CDN 이 5분간 들고 있습니다. 그동안 외부 호출은 0 입니다 */
const CACHE = {
  "Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=600",
};
const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;

  const pageNo = clamp(Number(params.get("pageNo")) || 1, 1, 10_000);
  const numOfRows = clamp(Number(params.get("numOfRows")) || 12, 1, 100);
  const sigunguCode = params.get("sigunguCode") ?? undefined;
  const contentTypeId = params.get("contentTypeId") ?? undefined;

  try {
    const result = await fetchAreaBasedList({
      pageNo,
      numOfRows,
      sigunguCode,
      contentTypeId,
    });

    return NextResponse.json(
      {
        ok: true,
        source: "한국관광공사 국문 관광정보 서비스 (KorService2 / areaBasedList2)",
        totalCount: result.totalCount,
        pageNo: result.pageNo,
        numOfRows: result.numOfRows,
        fetched: result.fetched,
        filteredOut: result.filteredOut,
        items: result.items,
      },
      { headers: CACHE },
    );
  } catch (e) {
    if (e instanceof TourApiError) {
      // 서비스키 미설정은 서버 장애가 아니라 설정이 덜 된 상태입니다.
      // 화면이 안내를 띄울 수 있도록 200 으로 돌려주고 reason 으로 구분합니다.
      const status = e.reason === "missing_key" ? 200 : 502;
      return NextResponse.json(
        { ok: false, reason: e.reason, message: e.message, detail: e.detail },
        { status, headers: NO_STORE },
      );
    }

    return NextResponse.json(
      {
        ok: false,
        reason: "unknown",
        message: e instanceof Error ? e.message : "알 수 없는 오류입니다.",
      },
      { status: 500, headers: NO_STORE },
    );
  }
}
