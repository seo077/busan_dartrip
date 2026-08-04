/**
 * 다트 풀 실측 표 — 부산 구·군 16 × 테마 4 = 64칸의 실제 장소 건수.
 *
 * 설계 정본: `API데이터설계.md` §4(테마 매핑) · §7.1(다트 추출) / `ARCHITECTURE.md` D-3
 *
 * 무엇을 세는가
 * -------------
 * `areaBasedList2` 가 돌려주는 부산 전역 장소를 전건 받아, 각 행의 `sigungucode` 와
 * `theme_map` 규칙으로 정한 테마를 교차해 칸마다 건수를 셉니다. 여기서 나오는 숫자가
 * 다트 §7.1 ①단계("해당 테마 건수 > 0 인 구·군 중 균등 랜덤")에서 **실제로 고를 수 있는
 * 구·군이 몇 개인지**를 그대로 보여 줍니다.
 *
 * DB 없이 돕니다
 * --------------
 * Supabase 마이그레이션을 아직 안 돌렸어도 실행됩니다. `.env.local` 의 `DATA_GO_KR_KEY`
 * 하나만 있으면 됩니다. 테마 규칙은 DB 의 `theme_map` 대신 **마이그레이션 SQL 안의 초기값
 * insert 구문**을 읽어서 씁니다(`scripts/lib/theme-rules.ts`). 규칙 값을 이 파일에 다시
 * 적지 않는 이유는 AD-2 — 매핑을 데이터로 뺀 결정이 무의미해지기 때문입니다.
 *
 * 호출 수
 * -------
 *   areaCode2         1회   (구·군 코드·이름 목록)
 *   areaBasedList2    ceil(totalCount / 100)회
 *
 * 2026-08-04 실측 `totalCount` 는 **725** 이므로(SYNC-6) 8회, 합계 **9회**입니다.
 * 관광공사 개발계정 한도는 1,000회/일이라 하루에 100번 넘게 돌려도 남습니다.
 * `--max-pages` 로 상한을 걸어 두어(기본 30) 응답이 이상해도 한도를 태우지 않습니다.
 *
 * 칸마다 `numOfRows=1` 로 `totalCount` 만 읽는 방법(16 × 4 = 64회)도 가능하지만
 * 여기서는 쓰지 않았습니다. 전건 순회가 **호출이 더 적고**(9회 < 64회), `cat1` 외의
 * 매칭 종류(`cat3`·`content_type`·`keyword`)까지 `classify()` 그대로 적용되며,
 * 미분류 건수와 그 원인 분류값까지 한 번에 나옵니다.
 *
 * 실행
 * ----
 *   npm run pool:matrix
 *   npm run pool:matrix -- --page-size=100 --max-pages=30 --delay=200
 *
 * 옵션
 *   --page-size   한 번에 받는 건수 (1~100, 기본 100)
 *   --max-pages   순회 상한 페이지 수 (기본 30)
 *   --delay       페이지 사이 대기 ms (기본 200)
 */

import {
  BUSAN_AREA_CODE,
  TOUR_API_BASE,
  TourApiError,
  fetchAreaCodeList,
  iterateAreaBasedList,
  type AreaCodeItem,
  type TourPlace,
} from "../../lib/tourapi.core";
import {
  THEME_KEYS,
  THEME_LABELS,
  classify,
  type ThemeKey,
  type ThemeRule,
} from "../../lib/theme";
import { BUSAN_SIGUNGU_COUNT, isInBusanBox } from "../lib/busan";
import { checkEnv, describeMissing } from "../lib/env";
import { loadThemeRulesFromMigration } from "../lib/theme-rules";
import {
  exitWithNotice,
  getNumber,
  heading,
  num,
  parseArgs,
  renderTable,
  section,
  type Align,
} from "../lib/cli";

/** 2026-08-04 사용자 실행분에서 관측된 `areaBasedList2` totalCount (SYNC-6). 예상 호출 수 안내에만 씁니다. */
const OBSERVED_TOTAL_COUNT = 725;

/** 관광공사 개발계정 일일 호출 한도. 안내 문구에만 씁니다. */
const DEV_ACCOUNT_DAILY_LIMIT = 1000;

interface Cell {
  code: string;
  name: string;
  byTheme: Record<ThemeKey, number>;
  unclassified: number;
  /** 4테마 합 — 테마를 고르지 않은("전체") 다트가 보는 풀 */
  themedTotal: number;
  /** 미분류까지 포함한 원본 건수 */
  rawTotal: number;
}

function emptyCell(code: string, name: string): Cell {
  const byTheme = {} as Record<ThemeKey, number>;
  for (const key of THEME_KEYS) byTheme[key] = 0;
  return { code, name, byTheme, unclassified: 0, themedTotal: 0, rawTotal: 0 };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** 구·군 코드는 숫자 문자열입니다. 숫자로 읽히면 숫자순, 아니면 문자순으로 정렬합니다. */
function compareCode(a: string, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return a.localeCompare(b);
}

function describeTourApiError(e: TourApiError): string {
  const guide: Record<string, string> = {
    missing_key:
      "`.env.local` 의 DATA_GO_KR_KEY 가 비어 있습니다. 공공데이터포털 마이페이지 > 일반 인증키 값을 넣어 주세요.",
    network:
      "공공데이터포털에 연결하지 못했습니다. 네트워크 상태를 확인하고 잠시 뒤 다시 실행해 주세요.",
    http: "공공데이터포털이 정상 상태 코드로 답하지 않았습니다. 잠시 뒤 다시 실행해 주세요.",
    not_json:
      "응답이 JSON 이 아닙니다. 서비스키가 이 서비스(KorService2)에 활용신청돼 있는지, 오늘 호출 한도를 넘기지 않았는지 확인해 주세요.",
    api_error:
      "포털이 오류로 답했습니다. 서비스키 승인 여부와 활용신청한 오퍼레이션 목록을 확인해 주세요.",
  };
  const lines = [`호출에 실패했습니다: ${e.message}`, "", guide[e.reason] ?? ""];
  if (e.detail) {
    lines.push("", "응답 앞부분:", `  ${e.detail.replace(/\s+/g, " ").slice(0, 200)}`);
  }
  return lines.filter((l) => l !== "").join("\n");
}

async function main(): Promise<void> {
  const args = parseArgs();
  const pageSize = clamp(Math.trunc(getNumber(args, "page-size", 100)), 1, 100);
  const maxPages = Math.max(1, Math.trunc(getNumber(args, "max-pages", 30)));
  const delayMs = Math.max(0, Math.trunc(getNumber(args, "delay", 200)));

  console.log(heading("다트 풀 실측 — 부산 구·군 × 테마"));

  // ── 실행 조건 ───────────────────────────────────────────────────────────
  const env = checkEnv(["DATA_GO_KR_KEY"]);
  if (!env.ok) {
    exitWithNotice(
      [
        describeMissing(env.missing),
        "",
        "이 스크립트는 DB 없이 API 만으로 돌아갑니다. Supabase 값은 없어도 됩니다.",
      ].join("\n"),
      2,
    );
  }

  const expectedListCalls = Math.ceil(OBSERVED_TOTAL_COUNT / pageSize);
  console.log("");
  console.log(`  서비스        ${TOUR_API_BASE}`);
  console.log(`  areaCode      ${BUSAN_AREA_CODE} (부산)`);
  console.log(`  페이지 크기   ${pageSize}건 · 순회 상한 ${maxPages}페이지`);
  console.log("");
  console.log("  예상 호출 수  areaCode2 1회 + areaBasedList2 ceil(totalCount / 페이지크기)회");
  console.log(
    `                2026-08-04 실측 totalCount ${num(OBSERVED_TOTAL_COUNT)} 기준 → ` +
      `총 ${num(expectedListCalls + 1)}회 (상한 ${num(maxPages + 1)}회)`,
  );
  console.log(
    `                관광공사 개발계정 한도 ${num(DEV_ACCOUNT_DAILY_LIMIT)}회/일`,
  );

  // ── 테마 규칙 ───────────────────────────────────────────────────────────
  const loaded = loadThemeRulesFromMigration();
  if (loaded.rules.length === 0) {
    exitWithNotice(
      [
        "테마 매핑 규칙을 한 줄도 읽지 못했습니다.",
        "",
        "이 스크립트는 `supabase/migrations/*.sql` 안의 `insert into theme_map ... values (...)`",
        "구문을 읽어서 규칙을 얻습니다. 아래를 확인해 주세요.",
        "  - 저장소 루트에서 실행했는지 (npm run pool:matrix 로 실행하면 항상 루트입니다)",
        "  - supabase/migrations/ 에 초기 스키마 SQL 이 있는지",
        "  - 그 SQL 의 theme_map insert 구문 형태가 바뀌지 않았는지",
      ].join("\n"),
      2,
    );
  }

  const tourRules: ThemeRule[] = loaded.rules.filter((r) => r.source === "tourapi");
  console.log("");
  console.log(
    `  테마 규칙     ${loaded.origin}${loaded.file ? ` (${loaded.file})` : ""} — ` +
      `전체 ${num(loaded.rules.length)}행 중 관광정보(tourapi) ${num(tourRules.length)}행 적용`,
  );

  if (tourRules.length === 0) {
    exitWithNotice(
      [
        "관광정보(source='tourapi') 규칙이 한 줄도 없습니다.",
        "규칙이 없으면 모든 장소가 미분류가 되어 표가 전부 0이 됩니다.",
        "마이그레이션 SQL 의 theme_map 초기값을 확인해 주세요.",
      ].join("\n"),
      2,
    );
  }

  // ── 1. 구·군 목록 (areaCode2) ───────────────────────────────────────────
  console.log(section("1. 구·군 목록 조회 (areaCode2)"));

  let areaCodes: AreaCodeItem[] = [];
  let areaCodeCalls = 0;
  let areaCodeNote = "";

  try {
    areaCodes = await fetchAreaCodeList();
    areaCodeCalls = 1;
    console.log(`  ${num(areaCodes.length)}개 구·군을 받았습니다.`);
    if (areaCodes.length !== BUSAN_SIGUNGU_COUNT) {
      areaCodeNote =
        `areaCode2 가 돌려준 구·군이 ${num(areaCodes.length)}개입니다. ` +
        `부산은 ${BUSAN_SIGUNGU_COUNT}개라 표의 행 수가 다를 수 있습니다.`;
      console.log(`  (참고) ${areaCodeNote}`);
    }
  } catch (e) {
    areaCodeCalls = 1;
    areaCodeNote =
      "areaCode2 조회에 실패해 구·군 이름을 붙이지 못했습니다. " +
      "표의 행은 응답에 실제로 나타난 코드만으로 만들었으므로, " +
      "장소가 한 건도 없는 구·군은 아예 행으로 보이지 않습니다.";
    console.log(`  실패: ${e instanceof Error ? e.message : String(e)}`);
    console.log(`  ${areaCodeNote}`);
    console.log("  (이 오퍼레이션은 설계상 아직 미확정 항목입니다 — U-1)");
  }

  // ── 2. 장소 전건 수집 (areaBasedList2) ──────────────────────────────────
  console.log(section("2. 장소 수집 (areaBasedList2)"));

  let result;
  try {
    result = await iterateAreaBasedList({
      pageSize,
      maxPages,
      delayMs,
      onPage: (p) => {
        console.log(
          `  ${String(p.pageNo).padStart(2, " ")}/${String(p.totalPages).padStart(2, " ")} 페이지 · ` +
            `받은 ${String(p.fetched).padStart(3, " ")}건 · ` +
            `누적 ${num(p.accumulated)} / ${num(p.totalCount)}`,
        );
      },
    });
  } catch (e) {
    if (e instanceof TourApiError) exitWithNotice(describeTourApiError(e), 3);
    throw e;
  }

  const totalCalls = areaCodeCalls + result.calls;
  console.log("");
  console.log(`  totalCount        ${num(result.totalCount)}`);
  console.log(`  수집한 장소       ${num(result.items.length)}건`);
  console.log(`  showflag 로 제외  ${num(result.filteredOut)}건`);
  console.log(`  실제 호출 수      ${num(totalCalls)}회 (areaCode2 ${num(areaCodeCalls)} + areaBasedList2 ${num(result.calls)})`);
  if (result.truncated) {
    console.log(
      `  (주의) 순회 상한 ${num(maxPages)}페이지에 걸려 중간에 멈췄습니다. ` +
        "--max-pages 를 올려 다시 실행해 주세요. 아래 표는 받은 만큼만 센 것입니다.",
    );
  }
  if (result.items.length === 0) {
    exitWithNotice(
      [
        "장소를 한 건도 받지 못했습니다.",
        "",
        "서비스키가 이 서비스(KorService2)에 활용신청돼 있는지,",
        `areaCode 값(${BUSAN_AREA_CODE})이 부산이 맞는지 확인해 주세요.`,
        "부산 코드가 다르면 .env.local 에 TOUR_API_AREA_CODE 를 넣어 덮어쓸 수 있습니다.",
      ].join("\n"),
      3,
    );
  }

  // ── 3. 집계 ─────────────────────────────────────────────────────────────
  const cells = new Map<string, Cell>();
  for (const area of areaCodes) cells.set(area.code, emptyCell(area.code, area.name));

  let noSigungu = 0;
  let outOfBox = 0;
  let noCoordinate = 0;
  /** 구·군 코드 유무와 무관하게 센 미분류 전체 건수 */
  let totalUnclassified = 0;

  /**
   * cat1 값별 분포. 어떤 원본 분류가 몇 건이고 어느 테마에 붙었는지를 그대로 보여 줍니다.
   * 어떤 테마의 건수가 적을 때 그것이 매핑이 빠진 탓인지 데이터 자체가 적은 탓인지는
   * 이 표를 봐야 갈립니다.
   */
  const byCat1 = new Map<
    string,
    {
      cat1: string;
      count: number;
      theme: ThemeKey | null;
      matchedBy: string | null;
      sample: string;
    }
  >();

  for (const place of result.items as TourPlace[]) {
    if (place.lat === null || place.lng === null) noCoordinate += 1;
    else if (!isInBusanBox(place.lat, place.lng)) outOfBox += 1;

    const verdict = classify(
      {
        source: "tourapi",
        cat1: place.cat1,
        cat2: place.cat2,
        cat3: place.cat3,
        contentTypeId: place.contentTypeId,
        name: place.name,
      },
      tourRules,
    );

    if (verdict.theme === null) totalUnclassified += 1;

    // 같은 cat1 이라도 다른 종류의 규칙(content_type 등)에 걸려 테마가 갈릴 수 있으므로
    // cat1 하나가 아니라 (cat1, 결과 테마) 짝으로 셉니다.
    const cat1 = place.cat1 ?? "(cat1 없음)";
    const cat1Key = `${cat1} ${verdict.theme ?? "-"}`;
    const seen = byCat1.get(cat1Key);
    if (seen) seen.count += 1;
    else
      byCat1.set(cat1Key, {
        cat1,
        count: 1,
        theme: verdict.theme,
        matchedBy: verdict.matchedBy,
        sample: place.name,
      });

    const code = place.sigunguCode;
    if (code === null) {
      noSigungu += 1;
      continue;
    }

    let cell = cells.get(code);
    if (!cell) {
      cell = emptyCell(code, `(이름 미확인 · 코드 ${code})`);
      cells.set(code, cell);
    }

    cell.rawTotal += 1;
    if (verdict.theme === null) {
      cell.unclassified += 1;
    } else {
      cell.byTheme[verdict.theme] += 1;
      cell.themedTotal += 1;
    }
  }

  const rows = [...cells.values()].sort((a, b) => compareCode(a.code, b.code));

  // ── 4. 표 ───────────────────────────────────────────────────────────────
  console.log(section(`3. 구·군 × 테마 (${num(rows.length)} × ${THEME_KEYS.length} = ${num(rows.length * THEME_KEYS.length)}칸)`));

  const header = [
    "구·군",
    ...THEME_KEYS.map((k) => THEME_LABELS[k]),
    "4테마 합",
    "미분류",
    "원본 합",
  ];
  const align: Align[] = ["left", ...header.slice(1).map((): Align => "right")];

  const themeTotals = {} as Record<ThemeKey, number>;
  for (const key of THEME_KEYS) themeTotals[key] = 0;
  let grandThemed = 0;
  let grandUnclassified = 0;
  let grandRaw = 0;

  const body = rows.map((cell) => {
    for (const key of THEME_KEYS) themeTotals[key] += cell.byTheme[key];
    grandThemed += cell.themedTotal;
    grandUnclassified += cell.unclassified;
    grandRaw += cell.rawTotal;
    return [
      cell.name,
      ...THEME_KEYS.map((k) => num(cell.byTheme[k])),
      num(cell.themedTotal),
      num(cell.unclassified),
      num(cell.rawTotal),
    ];
  });

  body.push([
    "합계",
    ...THEME_KEYS.map((k) => num(themeTotals[k])),
    num(grandThemed),
    num(grandUnclassified),
    num(grandRaw),
  ]);

  console.log("");
  console.log(renderTable(header, body, align));

  // ── 5. 0건 조합 ─────────────────────────────────────────────────────────
  const cellCount = rows.length * THEME_KEYS.length;
  const zeroPairs: Array<{ sigungu: string; theme: ThemeKey }> = [];
  for (const cell of rows) {
    for (const key of THEME_KEYS) {
      if (cell.byTheme[key] === 0) zeroPairs.push({ sigungu: cell.name, theme: key });
    }
  }

  console.log(section("4. 0건 조합"));
  console.log("");
  console.log(
    `  0건 조합 수   ${num(zeroPairs.length)} / ${num(cellCount)}칸 ` +
      `(${((zeroPairs.length / cellCount) * 100).toFixed(1)}%)`,
  );
  console.log(
    `  1건 이상 칸   ${num(cellCount - zeroPairs.length)}칸`,
  );

  console.log("");
  console.log("  테마별로 고를 수 있는 구·군 수 — 다트 §7.1 ①단계의 후보 수");
  const candidateRows = THEME_KEYS.map((k) => {
    const available = rows.filter((c) => c.byTheme[k] > 0).length;
    return [
      THEME_LABELS[k],
      `${num(available)} / ${num(rows.length)}`,
      num(themeTotals[k]),
      themeTotals[k] > 0 && available > 0
        ? (themeTotals[k] / available).toFixed(1)
        : "-",
    ];
  });
  candidateRows.push([
    "전체(테마 미선택)",
    `${num(rows.filter((c) => c.themedTotal > 0).length)} / ${num(rows.length)}`,
    num(grandThemed),
    grandThemed > 0 && rows.filter((c) => c.themedTotal > 0).length > 0
      ? (grandThemed / rows.filter((c) => c.themedTotal > 0).length).toFixed(1)
      : "-",
  ]);
  console.log("");
  console.log(
    renderTable(
      ["테마", "고를 수 있는 구·군", "총 건수", "구·군당 평균"],
      candidateRows,
      ["left", "right", "right", "right"],
    ),
  );

  if (zeroPairs.length > 0) {
    console.log("");
    console.log("  0건 조합 목록");
    for (const key of THEME_KEYS) {
      const names = zeroPairs.filter((p) => p.theme === key).map((p) => p.sigungu);
      if (names.length === 0) continue;
      console.log(`    ${THEME_LABELS[key]} (${num(names.length)}) — ${names.join(" · ")}`);
    }
  }

  // ── 6. 최다·최소 조합 ───────────────────────────────────────────────────
  const allPairs = rows.flatMap((c) =>
    THEME_KEYS.map((k) => ({ sigungu: c.name, theme: k, count: c.byTheme[k] })),
  );
  const sorted = [...allPairs].sort((a, b) => b.count - a.count);
  const nonZero = sorted.filter((p) => p.count > 0);

  console.log(section("5. 최다 · 최소 조합"));
  console.log("");
  const top = sorted.slice(0, 5);
  console.log("  최다 5칸");
  for (const p of top) {
    console.log(`    ${p.sigungu} × ${THEME_LABELS[p.theme]} — ${num(p.count)}건`);
  }
  if (nonZero.length > 0) {
    console.log("");
    console.log("  0건이 아닌 칸 중 최소 5칸");
    for (const p of nonZero.slice(-5).reverse()) {
      console.log(`    ${p.sigungu} × ${THEME_LABELS[p.theme]} — ${num(p.count)}건`);
    }
  }

  // ── 7. 원본 분류값 분포 ─────────────────────────────────────────────────
  console.log(section("6. 원본 분류값(cat1) 분포 — 어떤 값이 어느 테마로 갔는가"));
  console.log("");
  console.log(
    "  어떤 테마의 건수가 적을 때, 그것이 매핑 규칙이 빠진 탓인지 원본 데이터가 원래 적은 탓인지는",
  );
  console.log("  이 표에서 갈립니다. '미분류' 행이 곧 규칙이 안 붙은 값입니다.");
  console.log("");

  const cat1Rows = [...byCat1.values()]
    .sort((a, b) => b.count - a.count)
    .map((v) => [
      v.cat1,
      num(v.count),
      v.theme === null ? "미분류" : THEME_LABELS[v.theme],
      v.matchedBy ?? "-",
      v.sample,
    ]);
  console.log(
    renderTable(
      ["cat1", "건수", "붙은 테마", "맞은 규칙", "예시 장소"],
      cat1Rows,
      ["left", "right", "left", "left", "left"],
    ),
  );

  console.log("");
  if (totalUnclassified === 0) {
    console.log("  미분류가 없습니다. 수집한 장소 전부가 4테마 중 하나에 붙었습니다.");
  } else {
    console.log(
      `  미분류 ${num(totalUnclassified)}건은 다트 풀에 들어가지 않습니다 ` +
        "(places.status = 'unclassified' — 설계 §4.2).",
    );
    if (totalUnclassified !== grandUnclassified) {
      console.log(
        `  이 중 ${num(totalUnclassified - grandUnclassified)}건은 구·군 코드가 없어 표에도 안 들어갔습니다.`,
      );
    }
  }

  // ── 8. 데이터 점검 ──────────────────────────────────────────────────────
  console.log(section("7. 데이터 점검"));
  console.log("");
  console.log(`  표의 행 수         ${num(rows.length)} (부산 구·군 ${BUSAN_SIGUNGU_COUNT})`);
  console.log(`  구·군 코드 없음    ${num(noSigungu)}건 — 표 어느 행에도 못 들어간 장소`);
  console.log(`  좌표 없음          ${num(noCoordinate)}건`);
  console.log(`  부산 범위 밖 좌표  ${num(outOfBox)}건 — 0이 아니면 mapx/mapy 뒤바뀜을 의심`);
  console.log(`  totalCount 대비    ${num(result.items.length)} / ${num(result.totalCount)}`);
  if (areaCodeNote !== "") {
    console.log("");
    console.log(`  (참고) ${areaCodeNote}`);
  }

  // ── 9. 읽는 법 ──────────────────────────────────────────────────────────
  console.log(section("8. 각 숫자가 무엇을 센 것인가"));
  console.log("");
  console.log("  칸 하나          그 구·군에서 그 테마로 분류된 장소 수. 사용자가 구·군과 테마를");
  console.log("                   둘 다 고른 채 다트를 던질 때 뽑히는 후보 수입니다.");
  console.log("  4테마 합         테마를 안 고르고 던질 때 그 구·군에서 뽑히는 후보 수입니다.");
  console.log("  미분류           theme_map 규칙 어디에도 안 붙은 장소 수. 다트 풀에 들어가지");
  console.log("                   않으므로 어느 테마 칸에도 세지 않았습니다.");
  console.log("  0건 조합 수      64칸 중 후보가 하나도 없는 칸의 수입니다.");
  console.log("  고를 수 있는     그 테마를 골랐을 때 §7.1 ①단계가 균등 랜덤으로 집을 수 있는");
  console.log("  구·군            구·군의 수입니다.");
  console.log("");
  console.log(`  이번 실행에 쓴 호출: ${num(totalCalls)}회 / 개발계정 한도 ${num(DEV_ACCOUNT_DAILY_LIMIT)}회 하루`);
  console.log("");
}

main().catch((e) => {
  console.log("");
  console.log("예상하지 못한 오류로 멈췄습니다.");
  console.log(`  ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
  console.log("");
  process.exit(1);
});
