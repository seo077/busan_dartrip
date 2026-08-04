/**
 * GET /api/tour — 한국관광공사 국문 관광정보 서비스(KorService2) `areaBasedList2` 조회.
 *
 * 뼈대 배포(AD-14)에서 공공데이터포털 운영계정 승인요건 ③("앱/웹에서 OpenAPI 적용 확인")을
 * 충족시키는 지점입니다. 실제 호출은 `lib/tourapi.ts` 한 곳에서만 일어나며,
 * 첫 화면(`app/page.tsx`)도 같은 함수를 씁니다.
 *
 * 서비스키는 서버에서만 읽습니다. 응답 어디에도 키가 들어가지 않습니다.
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
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    if (e instanceof TourApiError) {
      // 서비스키 미설정은 서버 장애가 아니라 설정이 덜 된 상태입니다.
      // 화면이 안내를 띄울 수 있도록 200 으로 돌려주고 reason 으로 구분합니다.
      const status = e.reason === "missing_key" ? 200 : 502;
      return NextResponse.json(
        { ok: false, reason: e.reason, message: e.message, detail: e.detail },
        { status, headers: { "Cache-Control": "no-store" } },
      );
    }

    return NextResponse.json(
      {
        ok: false,
        reason: "unknown",
        message: e instanceof Error ? e.message : "알 수 없는 오류입니다.",
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
