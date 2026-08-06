/**
 * POST /api/throw — 다트 실행.
 *
 * 설계 정본: `API데이터설계.md` §7(다트 추출) · §8.1(요청·응답 예) / `ARCHITECTURE.md` AD-10
 *
 * **외부 API 호출 0회입니다** (D-6 · OG-1 · SC-1). 보는 것은 DB 네 표뿐입니다.
 *
 * 요청  { "scope": null | "<구·군 코드>", "theme": null | "food"|"nature"|"culture"|"activity" }
 *
 * `scope` 에는 **화면에서 겨눈 구·군**이 그대로 들어옵니다(D-36). 서버가 보기에는 사용자가
 * 범위를 골라 준 것과 완전히 같은 요청이라, 추출 로직은 조준 도입 전과 한 줄도 다르지 않습니다
 * — `scope` 가 있으면 그 구·군, 없으면 16개 구·군 균등(D-3 1단계). 그 다음 장소 균등 추출은
 * 어느 경우에도 그대로입니다(D-3 2단계 · `throw_dart()` 미변경).
 * 응답 200 — 정상
 *   { throwId, sigungu: {code,name}, place: {...}, nearbyCount, empty: false }
 * 응답 200 — 빈 조합 (오류가 아니라 정상 응답의 한 형태, AD-10)
 *   { throwId: null, empty: true, reason: "no_place_in_combination" }
 * 응답 429 — 주소 단위 상한 (④ §11.3 `DF-4`)
 *   { ok: false, reason: "rate_limited", message, detail, retryAfter }
 */

import { NextResponse } from "next/server";

import { DartError, throwDart, type DartScope, type DartTheme } from "@/lib/dart";
import { consume, limitHeaders, limitResponseBody } from "@/lib/ratelimit";
import { isThemeKey } from "@/lib/theme";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

interface ParsedInput {
  scope: DartScope;
  theme: DartTheme;
}

/** 입력은 범위·테마 둘뿐입니다(D-4 로 반경·기준점 입력이 제거됐습니다). */
function parse(body: unknown): ParsedInput | { error: string } {
  const raw = (body ?? {}) as Record<string, unknown>;

  const scopeRaw = raw.scope;
  let scope: DartScope = null;
  if (scopeRaw !== null && scopeRaw !== undefined && scopeRaw !== "") {
    if (typeof scopeRaw !== "string" || scopeRaw.length > 40) {
      return { error: "범위 값이 올바르지 않습니다." };
    }
    scope = scopeRaw;
  }

  const themeRaw = raw.theme;
  let theme: DartTheme = null;
  if (themeRaw !== null && themeRaw !== undefined && themeRaw !== "" && themeRaw !== "all") {
    if (!isThemeKey(themeRaw)) {
      return { error: "테마 값이 올바르지 않습니다." };
    }
    theme = themeRaw;
  }

  return { scope, theme };
}

export async function POST(request: Request) {
  // 던질 때마다 `throws` 에 행이 하나 생깁니다. 30일 뒤 만료되지만 그 30일이 심사 기간보다
  // 길어, 기계가 반복해서 부르면 만료 전에 무료 DB 용량이 찹니다(④ §11.3 · `R-15`).
  // **사람이 닿지 않는 높이**로만 끊습니다 — 여기서 정상 사용이 막히면 서비스의 핵심이
  // 멎습니다(`SC-7`). 판정 불가일 때는 통과시킵니다(fail open).
  const limit = await consume("throw", request);
  if (!limit.allowed) {
    return NextResponse.json(limitResponseBody(limit), {
      status: 429,
      headers: { ...NO_STORE, ...limitHeaders(limit) },
    });
  }

  let body: unknown = {};
  try {
    const text = await request.text();
    body = text ? JSON.parse(text) : {};
  } catch {
    return NextResponse.json(
      { ok: false, reason: "bad_request", message: "요청 형식이 올바르지 않습니다." },
      { status: 400, headers: NO_STORE },
    );
  }

  const parsed = parse(body);
  if ("error" in parsed) {
    return NextResponse.json(
      { ok: false, reason: "bad_request", message: parsed.error },
      { status: 400, headers: { ...NO_STORE, ...limitHeaders(limit) } },
    );
  }

  try {
    const outcome = await throwDart(parsed);

    if (outcome.empty) {
      return NextResponse.json(
        { ok: true, throwId: null, empty: true, reason: outcome.reason },
        { status: 200, headers: { ...NO_STORE, ...limitHeaders(limit) } },
      );
    }

    return NextResponse.json(
      {
        ok: true,
        empty: false,
        throwId: outcome.throwId,
        sigungu: outcome.sigungu,
        place: {
          id: outcome.place.id,
          name: outcome.place.name,
          theme: outcome.place.theme,
          lat: outcome.place.lat,
          lng: outcome.place.lng,
          image: outcome.place.image,
          isHiddenGem: outcome.place.isHiddenGem,
          isGoodRestaurant: outcome.place.isGoodRestaurant,
        },
        nearbyCount: outcome.nearby.length,
      },
      { status: 200, headers: { ...NO_STORE, ...limitHeaders(limit) } },
    );
  } catch (e) {
    if (e instanceof DartError) {
      const status = e.reason === "missing_config" ? 200 : 502;
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
