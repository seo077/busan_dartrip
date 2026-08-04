/**
 * 백필 03 — 한국관광공사 국문 관광정보(`areaBasedList2`) 전량 → `places`.
 *
 * 설계 정본: `API데이터설계.md` §3.1 · §4 · §6.2 / `ARCHITECTURE.md` AD-1 · AD-13 · AD-15
 *
 * 무엇을 넣는가
 * -------------
 * 부산 전역 장소를 100건 단위로 전건 받아 `places` 에 `source='tourapi'` 로 적재합니다.
 * 테마는 DB `theme_map` 규칙을 그대로 적용하고(AD-2), 어느 규칙에도 안 붙은 장소는
 * **버리지 않고** `theme=null` · `status='unclassified'` 로 같은 표에 보관합니다(AD-13).
 * 다트 풀 조건이 `status='published'` 라 미분류는 자동으로 빠집니다.
 *
 * 좌표
 * ----
 * `mapx` 가 **경도**, `mapy` 가 **위도**입니다(SYNC-2 실측). `lib/tourapi.core.ts` 가
 * 이미 옮겨 주므로 여기서는 그대로 씁니다. 그래도 부산 경계 상자로 한 번 더 봅니다 —
 * 뒤바뀌면 전건이 상자를 벗어나므로 즉시 드러납니다.
 *
 * `showflag`
 * ----------
 * `areaBasedList2` 는 이미 노출 대상만 돌려줍니다(POOL-5 실측 — 걸러진 건수 0).
 * 필터는 클라이언트에 그대로 두되, 걸러진 건수를 리포트에 찍어 사실을 계속 관측합니다.
 *
 * 실행
 * ----
 *   npm run backfill:tourapi
 *   npm run backfill:tourapi -- --dry-run
 *   npm run backfill:tourapi -- --keep-outside     # 부산 범위 밖 좌표도 적재
 */

import {
  TourApiError,
  iterateAreaBasedList,
  type TourPlace,
} from "../../lib/tourapi.core";
import { classify, toPlaceColumns, type ThemeKey, type ThemeRule } from "../../lib/theme";
import { THEME_KEYS, THEME_LABELS } from "../../lib/theme";
import { isInBusanBox } from "../lib/busan";
import { loadEnv } from "../lib/env";
import { finishSyncRun, requireDb, startSyncRun } from "../lib/db";
import { loadThemeRulesFromDb } from "../lib/theme-rules";
import {
  SkipLog,
  codeByTourCode,
  loadSigunguIndex,
  upsertPlaces,
  type PlaceRow,
} from "../lib/places";
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

loadEnv();

const SOURCE = "tourapi";

async function main(): Promise<void> {
  const args = parseArgs();
  const dryRun = hasFlag(args, "dry-run");
  const keepOutside = hasFlag(args, "keep-outside");
  const pageSize = Math.min(Math.max(Math.trunc(getNumber(args, "page-size", 100)), 1), 100);
  const maxPages = Math.max(1, Math.trunc(getNumber(args, "max-pages", 30)));

  console.log(heading("백필 03 — 관광공사 관광정보 → places"));

  const client = requireDb();

  // ── 준비 ────────────────────────────────────────────────────────────────
  const index = await loadSigunguIndex(client);
  if (index.size === 0) {
    exitWithNotice(
      [
        "sigungu 표가 비어 있습니다.",
        "",
        "places.sigungu_code 는 sigungu(code) 를 참조하는 외래키라, 구·군 마스터가 없으면",
        "한 행도 들어가지 않습니다. 먼저 아래를 실행해 주세요.",
        "",
        "  npm run backfill:sigungu",
      ].join("\n"),
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
  console.log(`  구·군 마스터  ${num(index.size)}개`);
  console.log(`  테마 규칙     theme_map 중 source='${SOURCE}' ${num(rules.length)}행`);
  if (rules.length === 0) {
    exitWithNotice(
      [
        `theme_map 에 source='${SOURCE}' 규칙이 한 줄도 없습니다.`,
        "이 상태로 적재하면 전건이 미분류가 되어 다트 풀이 비어 버립니다.",
        "마이그레이션의 theme_map 초기값이 들어갔는지 확인해 주세요.",
      ].join("\n"),
      2,
    );
  }

  // ── 1. 수집 ─────────────────────────────────────────────────────────────
  console.log(section("1. 장소 수집 (areaBasedList2)"));

  let collected;
  try {
    collected = await iterateAreaBasedList({
      pageSize,
      maxPages,
      delayMs: 200,
      onPage: (p) =>
        console.log(
          `  ${String(p.pageNo).padStart(2, " ")}/${String(p.totalPages).padStart(2, " ")} 페이지 · ` +
            `누적 ${num(p.accumulated)} / ${num(p.totalCount)}`,
        ),
    });
  } catch (e) {
    if (e instanceof TourApiError) {
      exitWithNotice(`수집에 실패했습니다: ${e.message} (${e.reason})`, 3);
    }
    throw e;
  }

  console.log("");
  console.log(`  totalCount        ${num(collected.totalCount)}`);
  console.log(`  받은 장소         ${num(collected.items.length)}건`);
  console.log(`  showflag 로 제외  ${num(collected.filteredOut)}건`);
  console.log(`  호출 수           ${num(collected.calls)}회`);
  if (collected.truncated) {
    console.log(`  (주의) 순회 상한 ${num(maxPages)}페이지에 걸려 중간에 멈췄습니다.`);
  }

  // ── 2. 변환 ─────────────────────────────────────────────────────────────
  console.log(section("2. places 행으로 변환"));

  const skips = new SkipLog();
  const rows: PlaceRow[] = [];
  const now = new Date().toISOString();

  const themeCount = {} as Record<ThemeKey, number>;
  for (const k of THEME_KEYS) themeCount[k] = 0;
  let unclassified = 0;
  let outsideKept = 0;

  for (const p of collected.items as TourPlace[]) {
    if (!p.sourceId) {
      skips.add("식별자 없음", p.name);
      continue;
    }
    if (p.lat === null || p.lng === null) {
      skips.add("좌표 없음", p.name);
      continue;
    }
    if (!isInBusanBox(p.lat, p.lng)) {
      if (!keepOutside) {
        skips.add("부산 범위 밖 좌표", `${p.name}(${p.lat}, ${p.lng})`);
        continue;
      }
      outsideKept += 1;
    }
    if (p.sigunguCode === null) {
      skips.add("구·군 값 없음", p.name);
      continue;
    }

    const sigunguCode = codeByTourCode(index, p.sigunguCode);
    if (sigunguCode === null) {
      skips.add("구·군 대응 실패", `${p.name}(코드 ${p.sigunguCode})`);
      continue;
    }

    const verdict = classify(
      {
        source: SOURCE,
        cat1: p.cat1,
        cat2: p.cat2,
        cat3: p.cat3,
        contentTypeId: p.contentTypeId,
        name: p.name,
      },
      rules,
    );
    const { theme, status } = toPlaceColumns(verdict);
    if (theme === null) unclassified += 1;
    else themeCount[theme] += 1;

    rows.push({
      source: SOURCE,
      source_id: p.sourceId,
      name: p.name,
      theme,
      sigungu_code: sigunguCode,
      lat: p.lat,
      lng: p.lng,
      address: p.address,
      tel: p.tel,
      homepage: null,
      overview: null,
      first_image: p.firstImage,
      first_image_thumb: p.firstImageThumb,
      content_type_id: p.contentTypeId,
      cat1: p.cat1,
      cat2: p.cat2,
      cat3: p.cat3,
      status,
      source_modified_at: p.sourceModifiedAt,
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
  if (keepOutside && outsideKept > 0) {
    console.log(`  (--keep-outside) 부산 범위 밖 좌표 ${num(outsideKept)}건도 적재 대상에 넣었습니다.`);
  }

  if (skips.total > 0) {
    console.log("");
    console.log("  건너뛴 이유");
    console.log("");
    console.log(renderTable(["이유", "건수", "표본"], skips.rows(), ["left", "right", "left"]));
  }

  if (dryRun) {
    console.log("");
    console.log("  --dry-run 이라 DB 에 쓰지 않았습니다.");
    console.log("");
    return;
  }

  // ── 3. 적재 ─────────────────────────────────────────────────────────────
  console.log(section("3. 적재"));

  const runId = await startSyncRun(client, SOURCE, "backfill");
  try {
    const done = await upsertPlaces(client, rows, (d, t) => {
      if (d === t || d % 400 === 0) console.log(`  ${num(d)} / ${num(t)}`);
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
    console.log("  dart_pool_stats 는 행 트리거가 함께 갱신했습니다 (§5.5 — 트리거를 끄지 않았습니다).");
    console.log("  다음 단계: npm run backfill:busan · npm run backfill:report");
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
