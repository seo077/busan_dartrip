/**
 * GET /api/geo/reverse?lat=&lng= — 핀 좌표를 사람이 읽는 주소로.
 *
 * 설계 정본: `화면구성도.md` §7.1("역지오코딩 결과 자동 표기") · §7.4(부산 밖 상태)
 *            `API데이터설계.md` §2(키 관리) · §8(Route 목록)
 *
 * §8 의 Route 표에는 등록(`POST /api/places`)만 "역지오코딩" 으로 적혀 있습니다. 그 자리는
 * 그대로 두고(적재되는 주소는 서버가 자기가 부른 값으로 씁니다), **화면이 핀을 옮길 때마다
 * 주소를 보여 주기 위한 읽기 전용 창구**를 하나 더 둡니다. 같은 외부 호출을 브라우저에서
 * 직접 하려면 서버 전용 키(`KAKAO_REST_KEY`)가 브라우저로 나가야 하기 때문입니다(④ §2).
 *
 * 헛호출을 막는 자리
 *   - 부산 상자 밖 좌표는 외부를 부르지 않고 그대로 돌려보냅니다.
 *   - 화면이 핀 이동을 멈춘 뒤에만 부릅니다(`components/submit/PinMap.tsx`).
 *   - **같은 좌표로 다시 물으면 1분간 CDN 이 답합니다** (DF-4, 아래).
 *
 * 캐시에 대해 — 두 가지 경우를 갈라 봐야 합니다 (DF-4)
 * ----------------------------------------------------
 * r1 은 "핀이 계속 움직이므로 캐시가 맞을 일이 없다" 는 이유로 캐시를 두지 않았습니다.
 * **사람이 핀을 끄는 동안은 그 말이 그대로 맞습니다** — 좌표가 매번 달라 캐시가 걸리지
 * 않습니다. 그래서 정상 사용에서는 이 캐시가 아무 일도 하지 않습니다.
 *
 * 갈리는 것은 **같은 좌표를 반복해서 부르는 경우**입니다. 이 경로는 인증이 없고 부를 때마다
 * 카카오로 나가므로, 주소를 아는 사람이 한 줄짜리 반복 호출로 일 한도를 태울 수 있습니다.
 * 그 모양은 좌표가 고정이라 **캐시가 정확히 걸립니다.** 1분이면 반복 호출 대부분이 외부까지
 * 닿지 않고, 사람의 조작에는 영향이 없습니다.
 *
 * 상한(카운터)이 아니라 캐시를 택한 이유 — 이 경로는 DB 를 전혀 쓰지 않습니다. 카운터를
 * 두면 카카오 호출을 아끼려고 DB 쓰기를 새로 만드는 셈입니다(`lib/ratelimit.ts` 머리말).
 *
 * 외부를 부르지 않고 끝난 응답(부산 밖 · 키 없음 · 조회 실패)은 캐시하지 않습니다 —
 * 아낄 호출이 없고, 키를 채우자마자 화면이 살아나야 합니다.
 *
 * 응답
 *   { ok: true, inBusan, region2, address, roadAddress }
 *   { ok: true, inBusan: false }                       ← 부산 밖 (오류가 아닙니다)
 *   { ok: false, reason: "bad_request" | "unavailable" }
 */

import { NextResponse } from "next/server";

import { isInBusanBox } from "@/lib/geo";
import { hasKakaoRestKey, looksBusan, reverseGeocode } from "@/lib/kakao";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/** DF-4 — 같은 좌표를 되풀이해 묻는 경우만 걸립니다 (위 머리말) */
const CACHE = { "Cache-Control": "public, max-age=0, s-maxage=60" };

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const lat = Number(params.get("lat"));
  const lng = Number(params.get("lng"));

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json(
      { ok: false, reason: "bad_request", message: "좌표가 올바르지 않습니다." },
      { status: 400, headers: NO_STORE },
    );
  }

  // 부산 밖은 외부를 부르지 않습니다. 화면이 필요한 답("여기는 부산이 아닙니다")이 이미 나왔습니다.
  if (!isInBusanBox(lat, lng)) {
    return NextResponse.json({ ok: true, inBusan: false }, { status: 200, headers: NO_STORE });
  }

  if (!hasKakaoRestKey()) {
    // 주소는 보조 표기입니다. 키가 없어도 등록은 되므로 오류가 아니라 "지금은 못 보여 준다" 입니다.
    return NextResponse.json(
      { ok: false, reason: "unavailable", inBusan: true },
      { status: 200, headers: NO_STORE },
    );
  }

  const geo = await reverseGeocode(lat, lng);
  if (!geo) {
    return NextResponse.json(
      { ok: false, reason: "unavailable", inBusan: true },
      { status: 200, headers: NO_STORE },
    );
  }

  // 상자 안이지만 행정구역이 부산이 아닌 자리(예: 경남 접경)는 여기서 걸러집니다.
  const inBusan = geo.region1 === null || looksBusan(geo.region1);

  return NextResponse.json(
    {
      ok: true,
      inBusan,
      region2: geo.region2,
      address: geo.address,
      roadAddress: geo.roadAddress,
    },
    { status: 200, headers: CACHE },
  );
}
