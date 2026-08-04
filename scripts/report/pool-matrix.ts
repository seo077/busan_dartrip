/**
 * 다트 풀 실측 표 — 부산 구·군 16 × 테마 4 = 64칸의 실제 장소 건수.
 *
 * 설계 정본: `API데이터설계.md` §4(테마 매핑) · §7.1(다트 추출) / `ARCHITECTURE.md` D-3
 *
 * 무엇을 세는가
 * -------------
 * 각 행의 구·군과 테마를 교차해 칸마다 건수를 셉니다. 여기서 나오는 숫자가
 * 다트 §7.1 ①단계("해당 테마 건수 > 0 인 구·군 중 균등 랜덤")에서 **실제로 고를 수 있는
 * 구·군이 몇 개인지**를 그대로 보여 줍니다.
 *
 * 두 가지 경로
 * ------------
 *   (기본)      관광공사 `areaBasedList2` 를 직접 호출해 셉니다. **DB 가 없어도 됩니다.**
 *   `--from-db` `places` 표를 읽어서 셉니다. **여러 출처가 병합된 실제 다트 풀**입니다.
 *               다트가 보는 것과 같은 조건(`status='published'`)으로 셉니다.
 *
 * `--from-db` 는 여기에 더해 **출처별 기여**와 **관광공사 단독 ↔ 병합 후 비교표**를
 * 함께 냅니다. 비교표의 "단독" 열은 기억해 둔 값이 아니라 같은 `places` 에서
 * `source='tourapi'` 만 걸러 그 자리에서 다시 센 값입니다.
 *
 * 호출 수 (기본 경로)
 * ------------------
 *   areaCode2         1회
 *   areaBasedList2    ceil(totalCount / 100)회 — 실측 725 기준 8회, 합계 9회
 * `--from-db` 는 외부 호출 0회입니다.
 *
 * 실행
 * ----
 *   npm run pool:matrix
 *   npm run pool:matrix -- --from-db
 *   npm run pool:matrix -- --page-size=100 --max-pages=30 --delay=200
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
import { checkEnv, describeMissing, loadEnv } from "../lib/env";
import { isDbConfigured, requireDb, selectAll } from "../lib/db";
import { loadThemeRulesFromMigration } from "../lib/theme-rules";
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

/** 2026-08-04 사용자 실행분에서 관측된 `areaBasedList2` totalCount (SYNC-6). 예상 호출 수 안내에만 씁니다. */
const OBSERVED_TOTAL_COUNT = 725;

/** 관광공사 개발계정 일일 호출 한도. 안내 문구에만 씁니다. */
const DEV_ACCOUNT_DAILY_LIMIT = 1000;

/* ── 집계 자료구조 ───────────────────────────────────────────────────────── */

/** 세는 단위 하나 — "어느 구·군의 어느 테마인가" 만 있으면 됩니다. */
interface Record_ {
  sigunguCode: string | null;
  theme: ThemeKey | null;
  source: string;
}

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

interface Matrix {
  rows: Cell[];
  themeTotals: Record<ThemeKey, number>;
  grandThemed: number;
  grandUnclassified: number;
  grandRaw: number;
  /** 구·군 코드가 없어 어느 행에도 못 들어간 건수 */
  noSigungu: number;
  zeroPairs: Array<{ sigungu: string; theme: ThemeKey }>;
  cellCount: number;
}

function emptyThemeRecord(): Record<ThemeKey, number> {
  const o = {} as Record<ThemeKey, number>;
  for (const key of THEME_KEYS) o[key] = 0;
  return o;
}

function emptyCell(code: string, name: string): Cell {
  return {
    code,
    name,
    byTheme: emptyThemeRecord(),
    unclassified: 0,
    themedTotal: 0,
    rawTotal: 0,
  };
}

/** 구·군 코드는 숫자이거나 slug 입니다. 숫자로 읽히면 숫자순, 아니면 문자순. */
function compareCode(a: string, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return a.localeCompare(b, "ko");
}

/**
 * 레코드 목록을 64칸 표로 접습니다.
 * `seedRows` 에 구·군 목록을 미리 넣어 두면 **장소가 0건인 구·군도 행으로 남습니다.**
 * 이 행이 사라지면 "고를 수 있는 구·군" 분모가 조용히 줄어듭니다.
 */
function buildMatrix(
  records: Record_[],
  seedRows: Array<{ code: string; name: string }>,
): Matrix {
  const cells = new Map<string, Cell>();
  for (const s of seedRows) cells.set(s.code, emptyCell(s.code, s.name));

  let noSigungu = 0;

  for (const r of records) {
    if (r.sigunguCode === null) {
      noSigungu += 1;
      continue;
    }
    let cell = cells.get(r.sigunguCode);
    if (!cell) {
      cell = emptyCell(r.sigunguCode, `(이름 미확인 · 코드 ${r.sigunguCode})`);
      cells.set(r.sigunguCode, cell);
    }
    cell.rawTotal += 1;
    if (r.theme === null) cell.unclassified += 1;
    else {
      cell.byTheme[r.theme] += 1;
      cell.themedTotal += 1;
    }
  }

  const rows = [...cells.values()].sort((a, b) => compareCode(a.code, b.code));

  const themeTotals = emptyThemeRecord();
  let grandThemed = 0;
  let grandUnclassified = 0;
  let grandRaw = 0;
  for (const cell of rows) {
    for (const key of THEME_KEYS) themeTotals[key] += cell.byTheme[key];
    grandThemed += cell.themedTotal;
    grandUnclassified += cell.unclassified;
    grandRaw += cell.rawTotal;
  }

  const zeroPairs: Array<{ sigungu: string; theme: ThemeKey }> = [];
  for (const cell of rows) {
    for (const key of THEME_KEYS) {
      if (cell.byTheme[key] === 0) zeroPairs.push({ sigungu: cell.name, theme: key });
    }
  }

  return {
    rows,
    themeTotals,
    grandThemed,
    grandUnclassified,
    grandRaw,
    noSigungu,
    zeroPairs,
    cellCount: rows.length * THEME_KEYS.length,
  };
}

/** 테마별로 고를 수 있는 구·군 수 — §7.1 ①단계의 후보 수. */
function availableSigungu(m: Matrix, theme: ThemeKey): number {
  return m.rows.filter((c) => c.byTheme[theme] > 0).length;
}

function availableAny(m: Matrix): number {
  return m.rows.filter((c) => c.themedTotal > 0).length;
}

/* ── 출력 ────────────────────────────────────────────────────────────────── */

function printMatrix(m: Matrix, title: string): void {
  console.log(section(`${title} (${num(m.rows.length)} × ${THEME_KEYS.length} = ${num(m.cellCount)}칸)`));

  const header = [
    "구·군",
    ...THEME_KEYS.map((k) => THEME_LABELS[k]),
    "4테마 합",
    "미분류",
    "원본 합",
  ];
  const align: Align[] = ["left", ...header.slice(1).map((): Align => "right")];

  const body = m.rows.map((cell) => [
    cell.name,
    ...THEME_KEYS.map((k) => num(cell.byTheme[k])),
    num(cell.themedTotal),
    num(cell.unclassified),
    num(cell.rawTotal),
  ]);
  body.push([
    "합계",
    ...THEME_KEYS.map((k) => num(m.themeTotals[k])),
    num(m.grandThemed),
    num(m.grandUnclassified),
    num(m.grandRaw),
  ]);

  console.log("");
  console.log(renderTable(header, body, align));
}

function printZeroAndCandidates(m: Matrix): void {
  console.log(section("0건 조합"));
  console.log("");
  console.log(
    `  0건 조합 수   ${num(m.zeroPairs.length)} / ${num(m.cellCount)}칸 ` +
      `(${((m.zeroPairs.length / m.cellCount) * 100).toFixed(1)}%)`,
  );
  console.log(`  1건 이상 칸   ${num(m.cellCount - m.zeroPairs.length)}칸`);

  console.log("");
  console.log("  테마별로 고를 수 있는 구·군 수 — 다트 §7.1 ①단계의 후보 수");
  const candidateRows = THEME_KEYS.map((k) => {
    const available = availableSigungu(m, k);
    return [
      THEME_LABELS[k],
      `${num(available)} / ${num(m.rows.length)}`,
      num(m.themeTotals[k]),
      m.themeTotals[k] > 0 && available > 0 ? (m.themeTotals[k] / available).toFixed(1) : "-",
    ];
  });
  const anyAvailable = availableAny(m);
  candidateRows.push([
    "전체(테마 미선택)",
    `${num(anyAvailable)} / ${num(m.rows.length)}`,
    num(m.grandThemed),
    m.grandThemed > 0 && anyAvailable > 0 ? (m.grandThemed / anyAvailable).toFixed(1) : "-",
  ]);
  console.log("");
  console.log(
    renderTable(
      ["테마", "고를 수 있는 구·군", "총 건수", "구·군당 평균"],
      candidateRows,
      ["left", "right", "right", "right"],
    ),
  );

  if (m.zeroPairs.length > 0) {
    console.log("");
    console.log("  0건 조합 목록");
    for (const key of THEME_KEYS) {
      const names = m.zeroPairs.filter((p) => p.theme === key).map((p) => p.sigungu);
      if (names.length === 0) continue;
      console.log(`    ${THEME_LABELS[key]} (${num(names.length)}) — ${names.join(" · ")}`);
    }
  }
}

/* ── 경로 A. 관광공사 API 직접 ───────────────────────────────────────────── */

function describeTourApiError(e: TourApiError): string {
  const guide: Record<string, string> = {
    missing_key:
      "`.env.local` 의 DATA_GO_KR_KEY 가 비어 있습니다. 공공데이터포털 마이페이지 > 일반 인증키 값을 넣어 주세요.",
    network: "공공데이터포털에 연결하지 못했습니다. 네트워크 상태를 확인하고 잠시 뒤 다시 실행해 주세요.",
    http: "공공데이터포털이 정상 상태 코드로 답하지 않았습니다. 잠시 뒤 다시 실행해 주세요.",
    not_json:
      "응답이 JSON 이 아닙니다. 서비스키가 이 서비스(KorService2)에 활용신청돼 있는지, 오늘 호출 한도를 넘기지 않았는지 확인해 주세요.",
    api_error: "포털이 오류로 답했습니다. 서비스키 승인 여부와 활용신청한 오퍼레이션 목록을 확인해 주세요.",
  };
  const lines = [`호출에 실패했습니다: ${e.message}`, "", guide[e.reason] ?? ""];
  if (e.detail) {
    lines.push("", "응답 앞부분:", `  ${e.detail.replace(/\s+/g, " ").slice(0, 200)}`);
  }
  return lines.filter((l) => l !== "").join("\n");
}

async function runFromApi(args: ReturnType<typeof parseArgs>): Promise<void> {
  const pageSize = Math.min(Math.max(Math.trunc(getNumber(args, "page-size", 100)), 1), 100);
  const maxPages = Math.max(1, Math.trunc(getNumber(args, "max-pages", 30)));
  const delayMs = Math.max(0, Math.trunc(getNumber(args, "delay", 200)));

  const env = checkEnv(["DATA_GO_KR_KEY"]);
  if (!env.ok) {
    exitWithNotice(
      [
        describeMissing(env.missing),
        "",
        "이 경로는 DB 없이 API 만으로 돌아갑니다. Supabase 값은 없어도 됩니다.",
        "이미 백필을 마쳤다면 `--from-db` 로 병합된 실제 다트 풀을 볼 수 있습니다.",
      ].join("\n"),
      2,
    );
  }

  const expectedListCalls = Math.ceil(OBSERVED_TOTAL_COUNT / pageSize);
  console.log("");
  console.log(`  집계 대상     관광공사 areaBasedList2 (부산명소 등 다른 출처는 안 들어갑니다)`);
  console.log(`  서비스        ${TOUR_API_BASE}`);
  console.log(`  areaCode      ${BUSAN_AREA_CODE} (부산)`);
  console.log(`  페이지 크기   ${pageSize}건 · 순회 상한 ${maxPages}페이지`);
  console.log("");
  console.log(
    `  예상 호출 수  실측 totalCount ${num(OBSERVED_TOTAL_COUNT)} 기준 총 ${num(expectedListCalls + 1)}회 ` +
      `(개발계정 한도 ${num(DEV_ACCOUNT_DAILY_LIMIT)}회/일)`,
  );

  // 테마 규칙 — DB 없이 돌아야 하므로 마이그레이션 SQL 초기값을 읽습니다.
  const loaded = loadThemeRulesFromMigration();
  if (loaded.rules.length === 0) {
    exitWithNotice(
      [
        "테마 매핑 규칙을 한 줄도 읽지 못했습니다.",
        "",
        "이 경로는 `supabase/migrations/*.sql` 안의 `insert into theme_map ... values (...)`",
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
    `  테마 규칙     ${loaded.origin} (${(loaded.files ?? []).length}개 파일 순서 적용) — ` +
      `전체 ${num(loaded.rules.length)}행 중 관광정보(tourapi) ${num(tourRules.length)}행 적용`,
  );
  if (tourRules.length === 0) {
    exitWithNotice(
      [
        "관광정보(source='tourapi') 규칙이 한 줄도 없습니다.",
        "규칙이 없으면 모든 장소가 미분류가 되어 표가 전부 0이 됩니다.",
      ].join("\n"),
      2,
    );
  }

  // 1. 구·군 목록
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
  }

  // 2. 장소 수집
  console.log(section("2. 장소 수집 (areaBasedList2)"));
  let result;
  try {
    result = await iterateAreaBasedList({
      pageSize,
      maxPages,
      delayMs,
      onPage: (p) =>
        console.log(
          `  ${String(p.pageNo).padStart(2, " ")}/${String(p.totalPages).padStart(2, " ")} 페이지 · ` +
            `누적 ${num(p.accumulated)} / ${num(p.totalCount)}`,
        ),
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
  console.log(`  실제 호출 수      ${num(totalCalls)}회`);
  if (result.truncated) {
    console.log(`  (주의) 순회 상한 ${num(maxPages)}페이지에 걸려 중간에 멈췄습니다.`);
  }
  if (result.items.length === 0) {
    exitWithNotice(
      [
        "장소를 한 건도 받지 못했습니다.",
        "",
        "서비스키가 이 서비스(KorService2)에 활용신청돼 있는지,",
        `areaCode 값(${BUSAN_AREA_CODE})이 부산이 맞는지 확인해 주세요.`,
      ].join("\n"),
      3,
    );
  }

  // 3. 집계
  const records: Record_[] = [];
  const byCat1 = new Map<
    string,
    { cat1: string; count: number; theme: ThemeKey | null; matchedBy: string | null; sample: string }
  >();
  let outOfBox = 0;
  let noCoordinate = 0;

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

    const cat1 = place.cat1 ?? "(cat1 없음)";
    const cat1Key = `${cat1} ${verdict.theme ?? "-"}`;
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

    records.push({ sigunguCode: place.sigunguCode, theme: verdict.theme, source: "tourapi" });
  }

  const matrix = buildMatrix(
    records,
    areaCodes.map((a) => ({ code: a.code, name: a.name })),
  );

  printMatrix(matrix, "3. 구·군 × 테마");
  printZeroAndCandidates(matrix);

  // 원본 분류값 분포
  console.log(section("원본 분류값(cat1) 분포 — 어떤 값이 어느 테마로 갔는가"));
  console.log("");
  console.log("  어떤 테마의 건수가 적을 때, 매핑 규칙이 빠진 탓인지 원본이 원래 적은 탓인지는");
  console.log("  이 표에서 갈립니다. '미분류' 행이 곧 규칙이 안 붙은 값입니다.");
  console.log("");
  console.log(
    renderTable(
      ["cat1", "건수", "붙은 테마", "맞은 규칙", "예시 장소"],
      [...byCat1.values()]
        .sort((a, b) => b.count - a.count)
        .map((v) => [
          v.cat1,
          num(v.count),
          v.theme === null ? "미분류" : THEME_LABELS[v.theme],
          v.matchedBy ?? "-",
          v.sample,
        ]),
      ["left", "right", "left", "left", "left"],
    ),
  );

  console.log(section("데이터 점검"));
  console.log("");
  console.log(`  표의 행 수         ${num(matrix.rows.length)} (부산 구·군 ${BUSAN_SIGUNGU_COUNT})`);
  console.log(`  구·군 코드 없음    ${num(matrix.noSigungu)}건`);
  console.log(`  좌표 없음          ${num(noCoordinate)}건`);
  console.log(`  부산 범위 밖 좌표  ${num(outOfBox)}건 — 0이 아니면 mapx/mapy 뒤바뀜을 의심`);
  console.log(`  totalCount 대비    ${num(result.items.length)} / ${num(result.totalCount)}`);
  if (areaCodeNote !== "") console.log(`\n  (참고) ${areaCodeNote}`);
  console.log("");
  console.log(`  이번 실행에 쓴 호출: ${num(totalCalls)}회 / 개발계정 한도 ${num(DEV_ACCOUNT_DAILY_LIMIT)}회 하루`);
  console.log("");
  console.log("  이 표는 관광공사 단독입니다. 백필을 마쳤다면 `--from-db` 로 병합 후를 보십시오.");
  console.log("");
}

/* ── 경로 B. DB (병합된 실제 다트 풀) ────────────────────────────────────── */

interface DbPlace {
  source: string;
  theme: ThemeKey | null;
  status: string;
  sigungu_code: string;
}

async function runFromDb(): Promise<void> {
  if (!isDbConfigured()) {
    exitWithNotice(
      [
        "`--from-db` 는 Supabase 접속 정보가 필요합니다.",
        "",
        "접속 정보 없이 관광공사 단독으로 세려면 옵션 없이 실행하십시오.",
        "  npm run pool:matrix",
      ].join("\n"),
      2,
    );
  }

  const client = requireDb();

  const places = await selectAll<DbPlace>(
    client,
    "places",
    "source, theme, status, sigungu_code",
  );
  const sigungu = await selectAll<{ code: string; name: string }>(client, "sigungu", "code, name");

  console.log("");
  console.log("  집계 대상     places 표 (병합된 실제 다트 풀)");
  console.log(`  구·군 마스터  ${num(sigungu.length)}행 (부산 ${BUSAN_SIGUNGU_COUNT})`);
  console.log(`  places        ${num(places.length)}행`);
  console.log("  외부 호출     0회");

  if (places.length === 0) {
    exitWithNotice(
      [
        "places 가 비어 있습니다. 백필을 먼저 돌려 주세요.",
        "",
        "  npm run backfill:sigungu",
        "  npm run backfill:tourapi",
        "  npm run backfill:busan",
      ].join("\n"),
      2,
    );
  }
  if (sigungu.length === 0) {
    exitWithNotice("sigungu 표가 비어 있습니다. `npm run backfill:sigungu` 를 먼저 돌려 주세요.", 2);
  }

  const seed = sigungu.map((s) => ({ code: s.code, name: s.name }));

  /**
   * 다트가 보는 것과 같은 조건으로 셉니다.
   * `status='published'` 가 아닌 행(미분류 보관함)은 테마 칸에 안 들어가고 '미분류' 로만 셉니다.
   */
  const toRecord = (p: DbPlace): Record_ => ({
    sigunguCode: p.sigungu_code,
    theme: p.status === "published" ? p.theme : null,
    source: p.source,
  });

  const merged = buildMatrix(places.map(toRecord), seed);
  const tourOnly = buildMatrix(
    places.filter((p) => p.source === "tourapi").map(toRecord),
    seed,
  );

  // 1. 출처별
  console.log(section("1. 출처별 건수"));
  const sources = [...new Set(places.map((p) => p.source))].sort();
  const sourceRows = sources.map((s) => {
    const rows = places.filter((p) => p.source === s);
    const pub = rows.filter((p) => p.status === "published");
    return [
      s,
      num(rows.length),
      num(pub.length),
      num(rows.length - pub.length),
      ...THEME_KEYS.map((k) => num(pub.filter((p) => p.theme === k).length)),
    ];
  });
  sourceRows.push([
    "합계",
    num(places.length),
    num(places.filter((p) => p.status === "published").length),
    num(places.filter((p) => p.status !== "published").length),
    ...THEME_KEYS.map((k) =>
      num(places.filter((p) => p.status === "published" && p.theme === k).length),
    ),
  ]);
  console.log("");
  console.log(
    renderTable(
      ["출처", "전체", "다트 풀", "미분류", ...THEME_KEYS.map((k) => THEME_LABELS[k])],
      sourceRows,
      ["left", "right", "right", "right", "right", "right", "right", "right"] as Align[],
    ),
  );

  // 2. 64칸 표
  printMatrix(merged, "2. 구·군 × 테마 — 병합 후");
  printZeroAndCandidates(merged);

  // 3. 비교표
  console.log(section("관광공사 단독 → 병합 후"));
  console.log("");
  console.log("  '단독' 열은 같은 places 에서 source='tourapi' 만 걸러 그 자리에서 다시 센 값입니다.");
  console.log("");

  const cmpRows = THEME_KEYS.map((k) => [
    THEME_LABELS[k],
    num(tourOnly.themeTotals[k]),
    num(merged.themeTotals[k]),
    (merged.themeTotals[k] - tourOnly.themeTotals[k] >= 0 ? "+" : "") +
      num(merged.themeTotals[k] - tourOnly.themeTotals[k]),
    `${num(availableSigungu(tourOnly, k))} / ${num(tourOnly.rows.length)}`,
    `${num(availableSigungu(merged, k))} / ${num(merged.rows.length)}`,
  ]);
  cmpRows.push([
    "전체(테마 미선택)",
    num(tourOnly.grandThemed),
    num(merged.grandThemed),
    (merged.grandThemed - tourOnly.grandThemed >= 0 ? "+" : "") +
      num(merged.grandThemed - tourOnly.grandThemed),
    `${num(availableAny(tourOnly))} / ${num(tourOnly.rows.length)}`,
    `${num(availableAny(merged))} / ${num(merged.rows.length)}`,
  ]);
  cmpRows.push([
    "미분류 보관함",
    num(tourOnly.grandUnclassified),
    num(merged.grandUnclassified),
    (merged.grandUnclassified - tourOnly.grandUnclassified >= 0 ? "+" : "") +
      num(merged.grandUnclassified - tourOnly.grandUnclassified),
    "-",
    "-",
  ]);
  cmpRows.push([
    "0건 조합",
    `${num(tourOnly.zeroPairs.length)} / ${num(tourOnly.cellCount)}`,
    `${num(merged.zeroPairs.length)} / ${num(merged.cellCount)}`,
    (merged.zeroPairs.length - tourOnly.zeroPairs.length >= 0 ? "+" : "") +
      num(merged.zeroPairs.length - tourOnly.zeroPairs.length),
    "-",
    "-",
  ]);

  console.log(
    renderTable(
      ["구분", "관광공사 단독", "병합 후", "증감", "단독 후보 구·군", "병합 후보 구·군"],
      cmpRows,
      ["left", "right", "right", "right", "right", "right"] as Align[],
    ),
  );

  // 4. 테마 × 출처 기여
  console.log(section("테마별 출처 기여"));
  console.log("");
  const contribRows = THEME_KEYS.map((k) => [
    THEME_LABELS[k],
    ...sources.map((s) =>
      num(
        places.filter((p) => p.source === s && p.status === "published" && p.theme === k).length,
      ),
    ),
    num(merged.themeTotals[k]),
  ]);
  console.log(
    renderTable(
      ["테마", ...sources, "합계"],
      contribRows,
      ["left", ...sources.map((): Align => "right"), "right"] as Align[],
    ),
  );

  console.log("");
  console.log("  어느 테마가 어느 출처에 기대고 있는지를 보여 줍니다.");
  console.log("  한 출처에만 기댄 테마는 그 출처가 흔들리면 함께 흔들립니다.");

  console.log(section("읽는 법"));
  console.log("");
  console.log("  칸 하나          그 구·군에서 그 테마로 분류된 장소 수. 구·군과 테마를 둘 다 고른 채");
  console.log("                   다트를 던질 때 뽑히는 후보 수입니다.");
  console.log("  4테마 합         테마를 안 고르고 던질 때 그 구·군에서 뽑히는 후보 수입니다.");
  console.log("  미분류           theme_map 규칙 어디에도 안 붙은 장소 수. 다트 풀에 들어가지 않습니다.");
  console.log("  0건 조합 수      64칸 중 후보가 하나도 없는 칸의 수입니다.");
  console.log("");
  console.log("  이 표는 관측값입니다. 테마 구조를 바꿀지는 사용자 결정 사항입니다.");
  console.log("");
}

/* ── 진입점 ──────────────────────────────────────────────────────────────── */

async function main(): Promise<void> {
  const args = parseArgs();
  const fromDb = hasFlag(args, "from-db");

  console.log(heading("다트 풀 실측 — 부산 구·군 × 테마"));

  if (fromDb) await runFromDb();
  else await runFromApi(args);
}

main().catch((e) => {
  console.log("");
  console.log("예상하지 못한 오류로 멈췄습니다.");
  console.log(`  ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
  console.log("");
  process.exit(1);
});
