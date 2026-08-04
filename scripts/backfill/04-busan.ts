/**
 * 백필 04 — 부산광역시 부산명소정보 전량 → `places`.
 *
 * 설계 정본: `API데이터설계.md` §3.5 · §4 · §6.2
 *            `AI 논의사항.md` §"부산명소정보 API 실측 확인"(BUSAN-1~5)
 *
 * 필드 매핑 (BUSAN-2·3 판독 결과 그대로)
 * ------------------------------------
 *   UC_SEQ                          → source_id
 *   PLACE                           → name      ★ MAIN_TITLE 을 쓰지 않습니다 (BUSAN-2)
 *   LAT / LNG                       → lat / lng  (숫자형, 이름이 명확)
 *   ADDR1                           → address
 *   GUGUN_NM                        → sigungu_code (한글 이름 → 내부 코드, BUSAN-3)
 *   MAIN_IMG_NORMAL / MAIN_IMG_THUMB→ first_image / first_image_thumb
 *   CNTCT_TEL                       → tel
 *   HOMEPAGE_URL                    → homepage
 *   ITEMCNTNTS                      → overview   (S4 상세 재료)
 *
 * `MAIN_TITLE` 을 이름으로 쓰지 않는 이유 — `국립해양박물관(한,영,중간,중번,일)` 처럼
 * 언어 표기가 붙어 있어 그대로 화면에 나갑니다. `PLACE` 가 깨끗합니다.
 * `PLACE` 가 비었을 때만 `MAIN_TITLE` 에서 그 표기를 떼고 씁니다.
 *
 * 분류 코드가 없습니다 (BUSAN-4)
 * -----------------------------
 * 이 소스에는 관광공사의 `cat1~3` · `contenttypeid` 에 해당하는 필드가 없습니다.
 * 그래서 `theme_map` 의 **keyword 규칙만** 걸립니다.
 *
 * 매칭 대상은 **`PLACE` 하나**입니다. `lib/theme.ts` 의 `ClassifiableInput.name` 이
 * "keyword 매칭에 쓰는 문자열(보통 장소명)" 이라, 홍보 문구인 `TITLE`·`SUBTITLE` 이나
 * 본문 산문인 `ITEMCNTNTS` 까지 넣으면 매칭 대상이 장소명이 아니게 됩니다.
 * 실측으로도 대상을 넓힐수록 헛맞는 건수가 늘었습니다(`PLACE` 51건 → `+TITLE+SUBTITLE` 80건).
 * `--match-text=place+title` 로 넓혀서 비교해 볼 수 있습니다.
 *
 * keyword 는 **부분 일치**라 짧은 낱말이 헛맞습니다. `'산'` 이 `'부산…'` 에 걸리는 것이
 * 대표적입니다. 이 스크립트는 규칙을 고치지 않고, **어떤 규칙이 어떤 이름을 가져갔는지
 * 전부 세어 표로 남깁니다**(§3). 규칙 보강은 그 표를 보고 정할 일입니다.
 *
 * 어디에도 안 걸린 장소는 버리지 않고 `status='unclassified'` 로 보관합니다(AD-13).
 *
 * 실행
 * ----
 *   npm run backfill:busan
 *   npm run backfill:busan -- --dry-run
 *   npm run backfill:busan -- --match-text=place+title   # 매칭 대상을 넓혀서 비교
 *   npm run backfill:busan -- --samples=40               # 규칙별 표본을 더 많이
 */

import {
  BUSAN_SERVICES,
  BusanApiError,
  findService,
  iterateBusanService,
} from "../../lib/busanapi.core";
import {
  THEME_KEYS,
  THEME_LABELS,
  classify,
  toPlaceColumns,
  type ThemeKey,
  type ThemeRule,
} from "../../lib/theme";
import { isInBusanBox, stripLanguageTags } from "../lib/busan";
import { loadEnv } from "../lib/env";
import { finishSyncRun, requireDb, startSyncRun } from "../lib/db";
import { loadThemeRulesFromDb } from "../lib/theme-rules";
import {
  SkipLog,
  codeByName,
  loadSigunguIndex,
  upsertPlaces,
  type PlaceRow,
} from "../lib/places";
import {
  exitWithNotice,
  getNumber,
  getValue,
  hasFlag,
  heading,
  num,
  parseArgs,
  renderTable,
  section,
  type Align,
} from "../lib/cli";

loadEnv();

const SOURCE = "busan_attraction";

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function numOrNull(v: unknown): number | null {
  const s = str(v);
  if (s === null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const dryRun = hasFlag(args, "dry-run");
  const matchTextMode = (getValue(args, "match-text") ?? "place").toLowerCase();
  const sampleCap = Math.max(1, Math.trunc(getNumber(args, "samples", 4)));

  console.log(heading("백필 04 — 부산명소정보 → places"));

  const spec = findService("attraction");
  if (!spec) exitWithNotice("부산명소정보 명세를 찾지 못했습니다.", 2);

  const client = requireDb();

  const index = await loadSigunguIndex(client);
  if (index.size === 0) {
    exitWithNotice(
      ["sigungu 표가 비어 있습니다. 먼저 실행해 주세요.", "", "  npm run backfill:sigungu"].join("\n"),
      2,
    );
  }

  let rules: ThemeRule[] = [];
  try {
    rules = (await loadThemeRulesFromDb(client)).filter((r) => r.source === SOURCE);
  } catch (e) {
    exitWithNotice(`theme_map 을 읽지 못했습니다: ${e instanceof Error ? e.message : String(e)}`, 2);
  }

  console.log("");
  console.log(`  요청주소      ${BUSAN_SERVICES[0].path}`);
  console.log(`  구·군 마스터  ${num(index.size)}개`);
  console.log(
    `  테마 규칙     theme_map 중 source='${SOURCE}' ${num(rules.length)}행 ` +
      `(전부 keyword — 이 소스에는 분류 코드가 없습니다, BUSAN-4)`,
  );
  console.log(
    `  매칭 대상     ${matchTextMode === "place" ? "PLACE (장소명)" : "PLACE + TITLE + SUBTITLE"}`,
  );

  if (rules.length === 0) {
    console.log("");
    console.log("  (주의) 규칙이 한 줄도 없어 전건이 미분류 보관함으로 들어갑니다.");
  }

  // ── 1. 수집 ─────────────────────────────────────────────────────────────
  console.log(section("1. 수집"));

  let collected;
  try {
    collected = await iterateBusanService(spec, {
      pageSize: 100,
      maxPages: 20,
      delayMs: 200,
      onPage: (p) =>
        console.log(
          `  ${String(p.pageNo).padStart(2, " ")}/${String(p.totalPages).padStart(2, " ")} 페이지 · ` +
            `누적 ${num(p.accumulated)} / ${num(p.totalCount)}`,
        ),
    });
  } catch (e) {
    const detail = e instanceof BusanApiError ? `${e.message} (${e.reason})` : String(e);
    exitWithNotice(`수집에 실패했습니다: ${detail}`, 3);
  }

  console.log("");
  console.log(`  totalCount    ${num(collected.totalCount)}`);
  console.log(`  받은 장소     ${num(collected.items.length)}건`);
  console.log(`  호출 수       ${num(collected.calls)}회`);
  if (collected.truncated) console.log("  (주의) 순회 상한에 걸려 중간에 멈췄습니다.");

  // ── 2. 변환 ─────────────────────────────────────────────────────────────
  console.log(section("2. places 행으로 변환"));

  const skips = new SkipLog();
  const rows: PlaceRow[] = [];
  const seen = new Set<string>();
  const now = new Date().toISOString();

  const themeCount = {} as Record<ThemeKey, number>;
  for (const k of THEME_KEYS) themeCount[k] = 0;
  let unclassified = 0;

  /** 어떤 keyword 규칙이 몇 건을 가져갔는지 — 규칙이 헛맞는지 눈으로 보려고 셉니다. */
  const byRule = new Map<string, { theme: ThemeKey; count: number; samples: string[] }>();
  const unmatchedSamples: string[] = [];

  for (const item of collected.items) {
    const sourceId = str(item.UC_SEQ);
    if (!sourceId) {
      skips.add("식별자 없음", str(item.PLACE) ?? "(이름 없음)");
      continue;
    }
    if (seen.has(sourceId)) continue;
    seen.add(sourceId);

    const mainTitle = str(item.MAIN_TITLE);
    const name = str(item.PLACE) ?? (mainTitle ? stripLanguageTags(mainTitle) : null);
    if (!name) {
      skips.add("이름 없음", `UC_SEQ ${sourceId}`);
      continue;
    }

    const lat = numOrNull(item.LAT);
    const lng = numOrNull(item.LNG);
    if (lat === null || lng === null) {
      skips.add("좌표 없음", name);
      continue;
    }
    if (!isInBusanBox(lat, lng)) {
      skips.add("부산 범위 밖 좌표", `${name}(${lat}, ${lng})`);
      continue;
    }

    const gugun = str(item.GUGUN_NM);
    if (!gugun) {
      skips.add("구·군 값 없음", name);
      continue;
    }
    const sigunguCode = codeByName(index, gugun);
    if (sigunguCode === null) {
      skips.add("구·군 대응 실패", `${name}(${gugun})`);
      continue;
    }

    const matchText =
      matchTextMode === "place+title"
        ? [name, str(item.TITLE), str(item.SUBTITLE)].filter(Boolean).join(" ")
        : name;

    const verdict = classify({ source: SOURCE, name: matchText }, rules);
    const { theme, status } = toPlaceColumns(verdict);

    if (theme === null) {
      unclassified += 1;
      if (unmatchedSamples.length < 12) unmatchedSamples.push(name);
    } else {
      themeCount[theme] += 1;
      const key = verdict.matchedValue ?? "(알 수 없음)";
      const hit = byRule.get(key) ?? { theme, count: 0, samples: [] };
      hit.count += 1;
      if (hit.samples.length < sampleCap) hit.samples.push(name);
      byRule.set(key, hit);
    }

    rows.push({
      source: SOURCE,
      source_id: sourceId,
      name,
      theme,
      sigungu_code: sigunguCode,
      lat,
      lng,
      address: str(item.ADDR1),
      tel: str(item.CNTCT_TEL),
      homepage: str(item.HOMEPAGE_URL),
      overview: str(item.ITEMCNTNTS),
      first_image: str(item.MAIN_IMG_NORMAL),
      first_image_thumb: str(item.MAIN_IMG_THUMB),
      content_type_id: null,
      cat1: null,
      cat2: null,
      cat3: null,
      status,
      source_modified_at: null,
      synced_at: now,
    });
  }

  console.log("");
  console.log(
    renderTable(
      ["구분", "건수"],
      [
        ["받은 장소", num(collected.items.length)],
        ["적재 대상", num(rows.length)],
        ["건너뜀", num(skips.total)],
        ...THEME_KEYS.map((k) => [`  ${THEME_LABELS[k]}`, num(themeCount[k])]),
        ["  미분류 보관함", num(unclassified)],
      ],
      ["left", "right"] as Align[],
    ),
  );

  if (skips.total > 0) {
    console.log("");
    console.log("  건너뛴 이유");
    console.log("");
    console.log(renderTable(["이유", "건수", "표본"], skips.rows(), ["left", "right", "left"]));
  }

  // ── 규칙이 걸린 자리 ────────────────────────────────────────────────────
  console.log(section("3. 어떤 keyword 규칙이 몇 건을 가져갔는가"));
  console.log("");
  console.log("  keyword 규칙은 **부분 일치**입니다. 짧은 낱말은 엉뚱한 이름에도 걸립니다");
  console.log("  (예: '산' 은 '부산…' 에 걸립니다). 아래 표본을 눈으로 확인해 주세요.");
  console.log("");
  if (byRule.size === 0) {
    console.log("  걸린 규칙이 없습니다.");
  } else {
    console.log(
      renderTable(
        ["규칙 값", "붙은 테마", "건수", "표본"],
        [...byRule.entries()]
          .sort((a, b) => b[1].count - a[1].count)
          .map(([value, v]) => [value, THEME_LABELS[v.theme], num(v.count), v.samples.join(" · ")]),
        ["left", "left", "right", "left"] as Align[],
      ),
    );
  }

  if (unclassified > 0) {
    console.log("");
    console.log(`  미분류 ${num(unclassified)}건 표본 — 규칙 보강 대상입니다`);
    console.log(`    ${unmatchedSamples.join(" · ")}`);
  }

  if (dryRun) {
    console.log("");
    console.log("  --dry-run 이라 DB 에 쓰지 않았습니다.");
    console.log("");
    return;
  }

  // ── 4. 적재 ─────────────────────────────────────────────────────────────
  console.log(section("4. 적재"));

  const runId = await startSyncRun(client, SOURCE, "backfill");
  try {
    const done = await upsertPlaces(client, rows, (d, t) => {
      if (d === t) console.log(`  ${num(d)} / ${num(t)}`);
    });
    await finishSyncRun(client, runId, {
      status: "ok",
      fetched: collected.items.length,
      upserted: done,
      skipped: skips.total,
    });
    console.log("");
    console.log(`  적재 완료     ${num(done)}건 (source='${SOURCE}')`);
    console.log("");
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await finishSyncRun(client, runId, { status: "error", errorMessage: message });
    exitWithNotice(`적재에 실패했습니다: ${message}`, 4);
  }
}

main().catch((e) => {
  console.log("");
  console.log("예상하지 못한 오류로 멈췄습니다.");
  console.log(`  ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
  console.log("");
  process.exit(1);
});
