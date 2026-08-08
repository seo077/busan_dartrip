/**
 * GET /api/geo/search?q= — 주소·장소 이름으로 좌표 찾기.
 *
 * 설계 정본: `화면구성도.md` §7.1(검색창 상시 표시) · §7.3(입력 규칙) · §7.4(지도 로드 실패)
 *            `API데이터설계.md` §2(키 관리) · `D-53`
 *
 * **본 경로는 폴백이 아니라 정상 경로입니다 (`D-53`, 2026-08-08).** 처음에는 지도가 뜨지
 * 않는 사람의 우회로였고 화면도 그 분기 안에만 검색을 두었는데, **지도가 정상일 때 검색이
 * 아예 없는 것처럼 보이는 것**이 문제였습니다. 이제 검색창은 지도 상태와 무관하게 늘
 * 있습니다(`components/submit/PinMap.tsx`). **서버 쪽은 바뀐 것이 없습니다** — 같은 Route,
 * 같은 부산 필터를 그대로 씁니다.
 *
 * 결과는 부산 상자 안으로만 좁혀 돌려줍니다. 목록에서 고르는 자리라, 서울 주소가 섞여
 * 있으면 사용자가 그것을 고른 뒤 마지막 단계에서 막히게 됩니다.
 *
 * 같은 말로 물으면 같은 답이 옵니다 (DF-4)
 * ----------------------------------------
 * 이 경로는 인증이 없고 부를 때마다 카카오로 나가므로, 주소를 아는 사람이 한 줄짜리 반복
 * 호출로 일 한도를 태울 수 있습니다. 다행히 **질의 문자열이 곧 캐시 열쇠**라서 CDN 이
 * 그대로 걸러 냅니다 — 장소 이름·주소는 시시각각 바뀌는 값이 아니라 한 시간을 둡니다.
 *
 * 상한(카운터)이 아니라 캐시를 택한 이유는 `lib/ratelimit.ts` 머리말과 같습니다 —
 * 이 경로는 DB 를 전혀 쓰지 않는데 카운터를 두면 DB 쓰기가 새로 생깁니다.
 * 외부를 부르지 않고 끝난 응답(형식 오류 · 키 없음)은 캐시하지 않습니다.
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

/** DF-4 — 같은 질의는 CDN 이 한 시간 들고 있습니다 */
const CACHE = { "Cache-Control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=3600" };

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

  return NextResponse.json({ ok: true, hits: hits.slice(0, 5) }, { status: 200, headers: CACHE });
}
