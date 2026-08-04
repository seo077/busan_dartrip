/**
 * 백필 09 — 적재 결과 요약.
 *
 * 설계 정본: `API데이터설계.md` §6.2 · §4.2 · §7.3 / `ARCHITECTURE.md` AD-13
 *
 * 백필이 끝난 뒤 **무엇이 얼마나 들어갔고 무엇이 빠졌는지**를 한 화면에 모읍니다.
 * API 를 호출하지 않습니다 — 전부 DB 조회입니다.
 *
 *   1. 출처별 · 상태별 건수
 *   2. 미분류 보관함 현황 (출처별 + 표본)
 *   3. 좌표 점검 (부산 경계 상자 밖)
 *   4. 테마 규칙 기여도 — 어떤 keyword 규칙이 몇 건을 가져갔고, 그 규칙을 빼면 어떻게 되는가
 *   5. 집계표(`dart_pool_stats`) ↔ 실계수 대조
 *   6. 코스 표 현황
 *
 * 4번을 둔 이유
 * ------------
 * `theme_map` 의 keyword 규칙은 **부분 일치**입니다. `'산'` 같은 한 글자 규칙은
 * `'부산…'` 에도 걸립니다. 테마별 건수만 보면 그 규칙이 실어 온 건수가 실제 그 테마인지
 * 알 수 없으므로, **규칙 단위로 건수와 표본을 펼치고 그 규칙을 뺐을 때의 건수까지** 같이
 * 냅니다. 규칙을 고칠지 말지는 이 표를 보고 정할 일이며, 이 스크립트는 고치지 않습니다.
 *
 * 실행
 * ----
 *   npm run backfill:report
 *   npm run backfill:report -- --samples=20
 */

import {
  THEME_KEYS,
  THEME_LABELS,
  classify,
  type ThemeKey,
  type ThemeRule,
} from "../../lib/theme";
import { BUSAN_SIGUNGU_COUNT, isInBusanBox } from "../lib/busan";
import { loadEnv } from "../lib/env";
import { requireDb, selectAll } from "../lib/db";
import { loadThemeRulesFromDb } from "../lib/theme-rules";
import {
  getNumber,
  heading,
  num,
  parseArgs,
  renderTable,
  section,
  type Align,
} from "../lib/cli";

loadEnv();

interface PlaceLite {
  source: string;
  source_id: string | null;
  name: string;
  theme: ThemeKey | null;
  status: string;
  sigungu_code: string;
  lat: number;
  lng: number;
}

interface StatRow {
  sigungu_code: string;
  theme: ThemeKey;
  place_count: number;
}

function emptyThemeCount(): Record<ThemeKey, number> {
  const o = {} as Record<ThemeKey, number>;
  for (const k of THEME_KEYS) o[k] = 0;
  return o;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const sampleCap = Math.max(1, Math.trunc(getNumber(args, "samples", 10)));

  console.log(heading("백필 09 — 적재 결과 요약"));

  const client = requireDb();

  const places = await selectAll<PlaceLite>(
    client,
    "places",
    "source, source_id, name, theme, status, sigungu_code, lat, lng",
    { orderBy: "source" },
  );
  const sigungu = await selectAll<{ code: string; name: string }>(
    client,
    "sigungu",
    "code, name",
  );
  const stats = await selectAll<StatRow>(
    client,
    "dart_pool_stats",
    "sigungu_code, theme, place_count",
  );
  const courses = await selectAll<{ id: string; kind: string | null }>(
    client,
    "courses",
    "id, kind",
  );

  const nameOf = new Map(sigungu.map((s) => [s.code, s.name]));

  console.log("");
  console.log(`  places        ${num(places.length)}행`);
  console.log(`  sigungu       ${num(sigungu.length)}행 (부산 ${BUSAN_SIGUNGU_COUNT})`);
  console.log(`  courses       ${num(courses.length)}행`);

  // ── 1. 출처별 · 상태별 ──────────────────────────────────────────────────
  console.log(section("1. 출처별 · 상태별 건수"));

  const bySource = new Map<
    string,
    { total: number; byStatus: Map<string, number>; byTheme: Record<ThemeKey, number> }
  >();
  for (const p of places) {
    const e =
      bySource.get(p.source) ??
      { total: 0, byStatus: new Map<string, number>(), byTheme: emptyThemeCount() };
    e.total += 1;
    e.byStatus.set(p.status, (e.byStatus.get(p.status) ?? 0) + 1);
    if (p.theme) e.byTheme[p.theme] += 1;
    bySource.set(p.source, e);
  }

  const sourceRows = [...bySource.entries()].map(([source, e]) => [
    source,
    num(e.total),
    num(e.byStatus.get("published") ?? 0),
    num(e.byStatus.get("unclassified") ?? 0),
    ...THEME_KEYS.map((k) => num(e.byTheme[k])),
  ]);
  sourceRows.push([
    "합계",
    num(places.length),
    num(places.filter((p) => p.status === "published").length),
    num(places.filter((p) => p.status === "unclassified").length),
    ...THEME_KEYS.map((k) => num(places.filter((p) => p.theme === k).length)),
  ]);

  console.log("");
  console.log(
    renderTable(
      ["출처", "전체", "published", "미분류", ...THEME_KEYS.map((k) => THEME_LABELS[k])],
      sourceRows,
      ["left", "right", "right", "right", "right", "right", "right", "right"] as Align[],
    ),
  );

  // ── 2. 미분류 보관함 ────────────────────────────────────────────────────
  console.log(section("2. 미분류 보관함 (status='unclassified')"));

  const unclassified = places.filter((p) => p.status === "unclassified");
  console.log("");
  console.log(`  전체          ${num(unclassified.length)}건`);
  console.log("  이 건수는 다트 풀에서 빠집니다. F4 차집합 발굴 모수에서도 빠지는 양입니다.");
  console.log("");

  const uncBySource = new Map<string, PlaceLite[]>();
  for (const p of unclassified) {
    const list = uncBySource.get(p.source) ?? [];
    list.push(p);
    uncBySource.set(p.source, list);
  }
  for (const [source, list] of uncBySource) {
    console.log(`  ${source} — ${num(list.length)}건`);
    console.log(`    ${list.slice(0, sampleCap).map((p) => p.name).join(" · ")}`);
    console.log("");
  }

  // ── 3. 좌표 점검 ────────────────────────────────────────────────────────
  console.log(section("3. 좌표 점검"));

  const outside = places.filter((p) => !isInBusanBox(p.lat, p.lng));
  console.log("");
  console.log(`  부산 경계 상자 밖  ${num(outside.length)}건`);
  if (outside.length > 0) {
    console.log("");
    console.log(
      renderTable(
        ["출처", "이름", "위도", "경도"],
        outside.slice(0, 20).map((p) => [p.source, p.name, String(p.lat), String(p.lng)]),
        ["left", "left", "right", "right"] as Align[],
      ),
    );
    console.log("");
    console.log("  0 이 아니면 원본 좌표 오류이거나 위도·경도 뒤바뀜입니다.");
    console.log("  뒤바뀜이면 전건이 상자를 벗어나므로, 소수 건이면 원본 오류 쪽입니다.");
  } else {
    console.log("  적재된 장소는 전부 부산 경계 상자 안에 있습니다.");
  }

  // ── 4. 테마 규칙 기여도 ─────────────────────────────────────────────────
  console.log(section("4. 테마 규칙 기여도 — 어떤 규칙이 몇 건을 가져갔는가"));

  let rules: ThemeRule[] = [];
  try {
    rules = await loadThemeRulesFromDb(client);
  } catch (e) {
    console.log(`  theme_map 을 읽지 못했습니다: ${e instanceof Error ? e.message : String(e)}`);
  }

  const keywordSources = [...new Set(rules.filter((r) => r.matchKind === "keyword").map((r) => r.source))];

  if (keywordSources.length === 0) {
    console.log("");
    console.log("  keyword 규칙이 없어 분석할 것이 없습니다.");
  }

  for (const source of keywordSources) {
    const sourceRules = rules.filter((r) => r.source === source);
    const targets = places.filter((p) => p.source === source);
    if (targets.length === 0) continue;

    console.log("");
    console.log(`  ${source} — 적재 ${num(targets.length)}건 · 규칙 ${num(sourceRules.length)}행`);
    console.log("");

    // 규칙별 적중
    const hits = new Map<string, { theme: ThemeKey; names: string[] }>();
    for (const p of targets) {
      const v = classify({ source, name: p.name }, sourceRules);
      if (v.theme === null || v.matchedValue === null) continue;
      const e = hits.get(v.matchedValue) ?? { theme: v.theme, names: [] };
      e.names.push(p.name);
      hits.set(v.matchedValue, e);
    }

    // 규칙 하나를 뺐을 때 테마별 건수가 어떻게 되는가
    const baseline = emptyThemeCount();
    let baseUnclassified = 0;
    for (const p of targets) {
      const v = classify({ source, name: p.name }, sourceRules);
      if (v.theme === null) baseUnclassified += 1;
      else baseline[v.theme] += 1;
    }

    const ruleRows: string[][] = [];
    for (const [value, e] of [...hits.entries()].sort((a, b) => b[1].names.length - a[1].names.length)) {
      const without = sourceRules.filter((r) => !(r.matchKind === "keyword" && r.matchValue === value));
      const after = emptyThemeCount();
      let afterUnclassified = 0;
      for (const p of targets) {
        const v = classify({ source, name: p.name }, without);
        if (v.theme === null) afterUnclassified += 1;
        else after[v.theme] += 1;
      }
      ruleRows.push([
        value,
        THEME_LABELS[e.theme],
        num(e.names.length),
        `${num(baseline[e.theme])} → ${num(after[e.theme])}`,
        `${num(baseUnclassified)} → ${num(afterUnclassified)}`,
        e.names.slice(0, Math.min(sampleCap, 6)).join(" · "),
      ]);
    }

    console.log(
      renderTable(
        ["규칙 값", "테마", "적중", "그 규칙 제외 시 테마 건수", "미분류", "표본"],
        ruleRows,
        ["left", "left", "right", "right", "right", "left"] as Align[],
      ),
    );
  }

  console.log("");
  console.log("  '그 규칙 제외 시' 는 규칙을 지웠다고 가정하고 다시 센 값입니다. DB 는 그대로입니다.");
  console.log("  적중 건수가 큰데 표본이 그 테마로 안 읽히면, 그 규칙이 헛맞고 있다는 뜻입니다.");

  // ── 5. 집계표 대조 ──────────────────────────────────────────────────────
  console.log(section("5. 집계표(dart_pool_stats) ↔ 실계수 대조"));

  const actual = new Map<string, number>();
  for (const p of places) {
    if (p.status !== "published" || p.theme === null) continue;
    const key = `${p.sigungu_code}|${p.theme}`;
    actual.set(key, (actual.get(key) ?? 0) + 1);
  }

  const statMap = new Map(stats.map((s) => [`${s.sigungu_code}|${s.theme}`, s.place_count]));
  const keys = new Set([...actual.keys(), ...statMap.keys()]);

  const mismatches: string[][] = [];
  for (const key of keys) {
    const a = actual.get(key) ?? 0;
    const s = statMap.get(key) ?? 0;
    if (a !== s) {
      const [code, theme] = key.split("|");
      mismatches.push([
        nameOf.get(code) ?? code,
        THEME_LABELS[theme as ThemeKey] ?? theme,
        num(s),
        num(a),
        num(a - s),
      ]);
    }
  }

  console.log("");
  console.log(`  집계표 행 수  ${num(stats.length)}`);
  console.log(`  실계수 조합   ${num(actual.size)}`);
  console.log(`  어긋난 조합   ${num(mismatches.length)}`);
  if (mismatches.length > 0) {
    console.log("");
    console.log(
      renderTable(
        ["구·군", "테마", "집계표", "실계수", "차이"],
        mismatches,
        ["left", "left", "right", "right", "right"] as Align[],
      ),
    );
    console.log("");
    console.log("  집계표가 실제보다 작으면 그만큼의 장소가 영구히 안 뽑힙니다(§7.3).");
    console.log("  트리거를 끄고 적재한 적이 있으면 재집계가 필요합니다.");
  } else {
    console.log("  모든 조합이 일치합니다.");
  }

  // ── 6. 코스 표 ──────────────────────────────────────────────────────────
  console.log(section("6. 코스 표 (courses)"));

  const byKind = new Map<string, number>();
  for (const c of courses) byKind.set(c.kind ?? "(없음)", (byKind.get(c.kind ?? "(없음)") ?? 0) + 1);
  console.log("");
  if (courses.length === 0) {
    console.log("  비어 있습니다.");
  } else {
    console.log(
      renderTable(
        ["종류", "건수"],
        [...byKind.entries()].map(([k, v]) => [k, num(v)]),
        ["left", "right"] as Align[],
      ),
    );
    console.log("");
    console.log("  코스는 다트 풀(places)이 아닙니다. 집계표에 잡히지 않습니다.");
  }

  console.log("");
}

main().catch((e) => {
  console.log("");
  console.log("예상하지 못한 오류로 멈췄습니다.");
  console.log(`  ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
  console.log("");
  process.exit(1);
});
