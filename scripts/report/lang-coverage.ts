/**
 * 다국어 실측 — 영문 관광정보(`EngService2`) 가 우리 장소를 얼마나 덮는가.
 *
 * 근거: `AI 논의사항.md` Round 1 §`D-44-2`
 *   *"실제 구현 여부는 미확정 유지 — A 가 `EngService2` 규격 실측(0.5인일)으로
 *     「영문이 787곳 중 몇 %인가」를 확인한 뒤 정한다."*
 *
 * ★ 이 스크립트는 **재는 일만** 합니다. 다국어를 구현하지 않고, 구현 여부·범위도 정하지
 *   않습니다. 그 판단은 여기서 나온 숫자를 보고 사용자가 합니다.
 *
 * 무엇을 재는가
 * -------------
 *   1. 우리 `places` 의 전체 건수와 **출처별 분포**. 영문 서비스는 관광공사 자료만 덮으므로,
 *      부산시·국가유산·사용자 등록분은 **원리적으로 영문이 없습니다.** 분모를 먼저 갈라 둡니다.
 *   2. `EngService2` `areaBasedList2` 를 부산(`areaCode`)으로 전건 훑어 `contentid` 집합을 만듭니다.
 *   3. 우리 관광공사 출처 장소의 `source_id`(= `contentid`)와 **교집합**을 셉니다.
 *   4. 표본 몇 건을 `detailCommon2` 로 열어 **어느 필드가 실제로 영문으로 오는가**를 봅니다
 *      (이름 / 주소 / 소개글 중 무엇이 비는지 — `D-44-2` 가 요구한 "판단 재료").
 *
 * 왜 `contentid` 로 맞추는가
 * -------------------------
 * 관광공사 다국어 서비스는 국문과 **같은 `contentid` 체계**를 씁니다. 이름으로 맞추면
 * 번역·표기 흔들림 때문에 실제보다 낮게 나옵니다. 다만 **이 전제 자체가 실측 대상**이라,
 * 교집합이 비정상적으로 낮으면 그 사실을 그대로 싣고 전제를 의심하도록 적습니다.
 *
 * 실행
 * ----
 *   npm run report:lang
 *   npm run report:lang -- --samples=8 --delay=400
 *
 * 옵션
 *   --samples  소개글까지 열어 볼 표본 수 (기본 5, 0 이면 생략)
 *   --rows     목록 한 번에 받는 건수 (기본 500)
 *   --delay    호출 사이 대기 ms (기본 300)
 *   --json     사람이 읽는 표 대신 JSON 한 덩어리로 출력
 */

import { MOBILE_APP, BUSAN_AREA_CODE } from "../../lib/tourapi.core";
import { checkEnv, describeMissing, readEnv } from "../lib/env";
import { requireDb, selectAll } from "../lib/db";
import {
  exitWithNotice,
  getNumber,
  hasFlag,
  heading,
  num,
  parseArgs,
  renderTable,
  section,
  type Align,
} from "../lib/cli";

/** 영문 서비스. 국문(`KorService2`)과 형제이며 파라미터 규격이 같습니다. */
const ENG_API_BASE = "https://apis.data.go.kr/B551011/EngService2";

const TIMEOUT_MS = 15_000;

interface EngItem {
  contentid?: string;
  contenttypeid?: string;
  title?: string;
  addr1?: string;
  firstimage?: string;
}

interface PlaceRow {
  source: string;
  source_id: string | null;
  name: string;
  status: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 한글이 한 글자라도 있는가 — "영문으로 왔는가" 를 가르는 가장 단순한 잣대입니다. */
function hasHangul(text: string | null | undefined): boolean {
  return typeof text === "string" && /[가-힣]/.test(text);
}

function classify(text: string | null | undefined): "영문" | "한글 섞임" | "빔" {
  if (!text || text.trim() === "") return "빔";
  return hasHangul(text) ? "한글 섞임" : "영문";
}

async function callEng(
  operation: string,
  params: Record<string, string>,
  key: string,
): Promise<Record<string, unknown>> {
  const url = new URL(`${ENG_API_BASE}/${operation}`);
  // 서비스키는 이미 인코딩된 형태로 오는 경우가 있어 직접 이어 붙입니다(국문 모듈과 같은 처리).
  const search = new URLSearchParams({
    MobileOS: "ETC",
    MobileApp: MOBILE_APP,
    _type: "json",
    ...params,
  });
  const full = `${url.toString()}?serviceKey=${key}&${search.toString()}`;

  const res = await fetch(full, {
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  const text = await res.text();

  /*
   * 포털은 **인증 거절을 본문으로** 돌려줍니다(HTTP 상태만 보면 원인을 못 읽습니다).
   * 그중 `30 = 등록되지 않은 서비스키` 는 키가 틀렸다는 뜻이 아니라 **이 서비스에 활용신청이
   * 안 돼 있다**는 뜻입니다 — 같은 키로 `KorService2` 는 그대로 200 이 나옵니다.
   * 다국어 판단에서 가장 먼저 알아야 하는 사실이라 문구를 그대로 올립니다.
   */
  if (text.includes("SERVICE_KEY_IS_NOT_REGISTERED_ERROR")) {
    throw new Error(
      `HTTP ${res.status} — ${operation} — SERVICE_KEY_IS_NOT_REGISTERED_ERROR ` +
        `(등록되지 않은 서비스키 / reasonCode 30). 키가 틀린 것이 아니라 ` +
        `EngService2 에 **활용신청이 안 돼 있습니다.**`,
    );
  }
  if (text.includes("NO_OPENAPI_SERVICE_ERROR")) {
    throw new Error(
      `HTTP ${res.status} — ${operation} — NO_OPENAPI_SERVICE_ERROR (서비스 없음·폐기). ` +
        `서비스 경로를 확인하십시오 — EngService1 은 폐기됐습니다(KorService1 과 같은 자리).`,
    );
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${operation} — ${text.slice(0, 160)}`);

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    // 포털 오류는 XML 로 오는 경우가 있습니다. 앞부분만 잘라 원인을 보여 줍니다.
    throw new Error(`JSON 이 아닌 응답 — ${operation} — ${text.slice(0, 160)}`);
  }
  return body as Record<string, unknown>;
}

function envelope(body: Record<string, unknown>): {
  code: string;
  message: string;
  items: EngItem[];
  totalCount: number;
} {
  const response = (body.response ?? {}) as Record<string, unknown>;
  const header = (response.header ?? {}) as Record<string, unknown>;
  const bodyPart = (response.body ?? {}) as Record<string, unknown>;
  const itemsRaw = (bodyPart.items ?? {}) as Record<string, unknown>;
  const item = itemsRaw.item;

  return {
    code: String(header.resultCode ?? ""),
    message: String(header.resultMsg ?? ""),
    items: Array.isArray(item) ? (item as EngItem[]) : item ? [item as EngItem] : [],
    totalCount: Number(bodyPart.totalCount ?? 0),
  };
}

async function main(): Promise<void> {
  const args = parseArgs();
  const asJson = hasFlag(args, "json");
  const rows = getNumber(args, "rows", 500);
  const delay = getNumber(args, "delay", 300);
  const sampleCount = getNumber(args, "samples", 5);

  const env = checkEnv(["DATA_GO_KR_KEY"]);
  if (!env.ok) exitWithNotice(describeMissing(env.missing), 2);
  const key = readEnv("DATA_GO_KR_KEY") as string;

  // ── 1. 우리 쪽 분모 ────────────────────────────────────────────────────────
  const db = requireDb();
  const places = await selectAll<PlaceRow>(db, "places", "source,source_id,name,status", {
    filter: (q) => (q as never as { is: (a: string, b: null) => unknown }).is("deleted_at", null),
  });

  const published = places.filter((p) => p.status === "published");
  const bySource = new Map<string, number>();
  for (const p of published) bySource.set(p.source, (bySource.get(p.source) ?? 0) + 1);

  const tourIds = new Set<string>();
  for (const p of published) {
    if (p.source === "tourapi" && p.source_id) tourIds.add(p.source_id);
  }

  // ── 2. 영문 서비스 전건 훑기 ───────────────────────────────────────────────
  const engIds = new Set<string>();
  const engSample: EngItem[] = [];
  let engTotal = 0;
  let pages = 0;
  const notes: string[] = [];

  try {
    for (let pageNo = 1; ; pageNo += 1) {
      const body = await callEng(
        "areaBasedList2",
        {
          areaCode: BUSAN_AREA_CODE,
          numOfRows: String(rows),
          pageNo: String(pageNo),
        },
        key,
      );
      const env2 = envelope(body);
      if (env2.code !== "0000") {
        notes.push(`영문 목록 응답 코드 ${env2.code} — ${env2.message}`);
        break;
      }
      engTotal = env2.totalCount;
      pages = pageNo;
      for (const it of env2.items) {
        if (it.contentid) engIds.add(String(it.contentid));
        if (engSample.length < 40) engSample.push(it);
      }
      if (env2.items.length === 0 || engIds.size >= engTotal || pageNo * rows >= engTotal) break;
      await sleep(delay);
    }
  } catch (error) {
    notes.push(`영문 목록 호출 실패 — ${(error as Error).message}`);
  }

  // ── 3. 교집합 ──────────────────────────────────────────────────────────────
  let matched = 0;
  const unmatchedExamples: string[] = [];
  for (const p of published) {
    if (p.source !== "tourapi" || !p.source_id) continue;
    if (engIds.has(p.source_id)) matched += 1;
    else if (unmatchedExamples.length < 8) unmatchedExamples.push(`${p.name} (${p.source_id})`);
  }

  const pct = (n: number, d: number) => (d === 0 ? "—" : `${((n / d) * 100).toFixed(1)}%`);

  // ── 4. 표본으로 필드별 언어 확인 ───────────────────────────────────────────
  interface FieldCheck {
    contentId: string;
    title: string;
    titleKind: string;
    addrKind: string;
    overviewKind: string;
    overviewHead: string;
  }
  const fieldChecks: FieldCheck[] = [];

  const sampleIds = [...engIds].filter((id) => tourIds.has(id)).slice(0, Math.max(0, sampleCount));
  for (const contentId of sampleIds) {
    try {
      const body = await callEng(
        "detailCommon2",
        { contentId, numOfRows: "1", pageNo: "1" },
        key,
      );
      const env3 = envelope(body);
      const it = (env3.items[0] ?? {}) as EngItem & { overview?: string };
      fieldChecks.push({
        contentId,
        title: String(it.title ?? "").slice(0, 34),
        titleKind: classify(it.title),
        addrKind: classify(it.addr1),
        overviewKind: classify(it.overview),
        overviewHead: String(it.overview ?? "")
          .replace(/<[^>]*>/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 46),
      });
      await sleep(delay);
    } catch (error) {
      notes.push(`표본 ${contentId} 조회 실패 — ${(error as Error).message}`);
    }
  }

  const result = {
    measuredAt: new Date().toISOString(),
    areaCode: BUSAN_AREA_CODE,
    ours: {
      totalRows: places.length,
      published: published.length,
      bySource: Object.fromEntries(bySource),
      tourapiWithSourceId: tourIds.size,
    },
    english: { totalCount: engTotal, collectedIds: engIds.size, pages },
    overlap: {
      matched,
      ofTourapi: pct(matched, tourIds.size),
      ofAllPublished: pct(matched, published.length),
      unmatchedExamples,
    },
    fieldChecks,
    notes,
  };

  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(heading("다국어 실측 — 영문 관광정보(EngService2) 커버리지"));
  console.log(`  잰 때  ${result.measuredAt}`);
  console.log(`  지역   areaCode=${BUSAN_AREA_CODE} (부산)`);
  console.log("  ※ 재기만 합니다. 구현 여부·범위는 이 표를 보고 사용자가 정합니다 (D-44-2).");

  console.log(section("① 우리 장소 (분모)"));
  console.log(
    renderTable(
      ["출처", "건수", "영문 가능성"],
      [...bySource.entries()].map(([source, count]) => [
        source,
        num(count),
        source === "tourapi" ? "관광공사 영문 서비스 대상" : "영문 원본 없음",
      ]),
      ["left", "right", "left"] as Align[],
    ),
  );
  console.log(`\n  게시 중 합계 ${num(published.length)}곳 · 그중 관광공사 ${num(tourIds.size)}곳`);

  console.log(section("② 영문 서비스가 가진 부산 건수"));
  console.log(`  totalCount ${num(engTotal)} · 실제로 받은 id ${num(engIds.size)} (${pages}쪽)`);
  if (engIds.size === 0) {
    console.log("");
    console.log("  ※ 0 건인 이유가 ⑤ 에 적혀 있습니다. '등록되지 않은 서비스키' 라면");
    console.log("    **키를 바꾸는 일이 아니라 EngService2 에 활용신청을 하는 일**이 먼저입니다.");
    console.log("    승인 전까지는 아래 ③④ 를 잴 수 없습니다 (0% 가 아니라 '아직 못 잼').");
  }

  console.log(section("③ 겹치는 건수 (핵심 숫자)"));
  const measurable = engIds.size > 0;
  console.log(
    renderTable(
      ["기준", "분자", "분모", "비율"],
      [
        [
          "관광공사 출처 중",
          num(matched),
          num(tourIds.size),
          measurable ? pct(matched, tourIds.size) : "못 잼",
        ],
        [
          "게시 중 전체 중",
          num(matched),
          num(published.length),
          measurable ? pct(matched, published.length) : "못 잼",
        ],
      ],
      ["left", "right", "right", "right"] as Align[],
    ),
  );
  if (!measurable) {
    console.log("");
    console.log("  영문 목록을 한 건도 못 받았으므로 위 분자는 **0% 가 아니라 미측정**입니다.");
  }
  if (unmatchedExamples.length > 0 && measurable) {
    console.log("\n  영문에 없는 예");
    for (const e of unmatchedExamples) console.log(`    - ${e}`);
  }

  console.log(section("④ 어느 필드가 영문으로 오는가 (표본)"));
  if (fieldChecks.length === 0) {
    console.log("  표본 없음 (--samples=0 이거나 겹치는 건이 없습니다)");
  } else {
    console.log(
      renderTable(
        ["contentId", "이름", "이름", "주소", "소개글", "소개글 앞부분"],
        fieldChecks.map((f) => [
          f.contentId,
          f.title,
          f.titleKind,
          f.addrKind,
          f.overviewKind,
          f.overviewHead,
        ]),
      ),
    );
  }

  if (notes.length > 0) {
    console.log(section("⑤ 호출 중 남은 기록"));
    for (const n of notes) console.log(`  - ${n}`);
  }

  console.log(section("읽는 법"));
  console.log("  · ③ '게시 중 전체 중' 비율이 낮으면, 다국어를 넣어도 **화면 글자만 영어**가 되고");
  console.log("    장소 이름·소개는 한글로 남는 반쪽이 됩니다. 그 사실을 먼저 보라는 것이 D-44-2 입니다.");
  console.log("  · ④ 에서 '소개글' 이 자주 비면, 영문 상세 화면은 이름·주소까지만 세웁니다.");
  console.log("");
}

main().catch((error) => {
  exitWithNotice(`예상치 못한 오류: ${(error as Error).message}`, 1);
});
