/**
 * GET /api/geo/search?q= — 주소·장소 이름으로 좌표 찾기.
 *
 * 설계 정본: `화면구성도.md` §7.4("지도 로드 실패 — 주소 직접 입력 폴백")
 *            `API데이터설계.md` §2(키 관리)
 *
 * 지도가 뜨지 않는 사람이 등록을 포기하지 않게 하는 **한 갈래뿐인 우회로**입니다. 카카오
 * SDK 는 광고 차단기·회사망·구형 브라우저에서 심심찮게 막히는데, 그때 §7.4 가 정해 둔 대로
 * 주소를 직접 적어 위치를 정합니다.
 *
 * 결과는 부산 상자 안으로만 좁혀 돌려줍니다. 지도 없이 목록에서 고르는 자리라, 서울 주소가
 * 섞여 있으면 사용자가 그것을 고른 뒤 마지막 단계에서 막히게 됩니다.
 *
 * 응답
 *   { ok: true, hits: [{ label, detail, lat, lng }] }
 *   { ok: false, reason: "bad_request" | "unavailable" }
 */

import { NextResponse } from "next/server";

import { isInBusanBox } from "@/lib/geo";
import { hasKakaoRestKey, searchPlaces } from "@/lib/kakao";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const q = (new URL(request.url).searchParams.get("q") ?? "").trim();

  if (q === "" || q.length > 80) {
    return NextResponse.json(
      { ok: false, reason: "bad_request", message: "찾을 주소나 장소 이름을 적어 주세요." },
      { status: 400, headers: NO_STORE },
    );
  }

  if (!hasKakaoRestKey()) {
    return NextResponse.json(
      { ok: false, reason: "unavailable", message: "주소 검색을 쓸 수 없습니다." },
      { status: 200, headers: NO_STORE },
    );
  }

  const hits = (await searchPlaces(q, 8)).filter((hit) => isInBusanBox(hit.lat, hit.lng));

  return NextResponse.json({ ok: true, hits: hits.slice(0, 5) }, { status: 200, headers: NO_STORE });
}
