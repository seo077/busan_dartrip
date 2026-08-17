/**
 * 화면 ↔ 데이터 출처 표기 대조 (2026-08-17 신설).
 *
 * 설계 정본: ② `화면구성도.md` §2.1(전 화면 공통 · 예외 없음) · §8.1(`S6` 자체 절)
 *            ④ `API데이터설계.md` §10(문안·목록 정본) / `ARCHITECTURE.md` §부록 규칙 ㉮
 *
 * 왜 만들었는가
 * -------------
 * ② §2.1은 *"데이터 출처 표기는 전 화면 공통이며 예외가 없습니다"* 라고 못박고 있고,
 * 공공누리 출처표시는 **화면 단위 의무**라 화면이 늘어날 때마다 함께 늘어나야 합니다.
 * 그런데 그 규약은 **글로만 서 있어서**, 규약보다 뒤에 만들어진 화면(`S6-2` 처리방침)에
 * 걸리지 않았습니다. 같은 일이 그 앞에도 한 번 있었습니다(`S5` 장소 등록).
 *
 * **두 번 같은 자리에서 났다는 것은 사람의 부주의가 아니라 구조**입니다. 그래서 규약을
 * 글에만 두지 않고 **한 줄로 훑어볼 수 있는 자리**를 만듭니다. 이 스크립트는 아무것도
 * 고치지 않고 **대조만** 합니다 — `app/` 아래 실재하는 화면 파일을 전수로 모아, 각각이
 * 하단 공통 표기(`components/DataSources.tsx`)를 부르고 있는지 봅니다.
 *
 * 제외 자리 (`EXEMPT`)
 * --------------------
 * ② §2.1이 밝힌 예외는 **`S6` 정보 화면 하나**입니다 — 그 화면은 무엇을 어디에 쓰는지까지
 * 밝히는 **자체 절**(§8.1)을 가지므로 짧은 공통 표기를 겹쳐 두지 않습니다. 예외를 늘리려면
 * **먼저 ② §2.1을 고치고** 그 다음에 아래 표를 고칩니다 — 순서가 뒤집히면 문서와 화면이
 * 다시 갈립니다.
 *
 * 실행
 * ----
 *   npm run check:sources
 *   npm run check:sources -- --all    # 제외 자리까지 전부 표에 싣습니다
 *
 * 표기가 빠진 화면이 하나라도 있으면 **0이 아닌 종료 코드**로 끝납니다.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { hasFlag, heading, num, parseArgs, renderTable, section, type Align } from "../lib/cli";

/** 화면 파일로 세는 이름 — 실제로 주소가 생기는 것들입니다 */
const SCREEN_FILES = new Set(["page.tsx", "not-found.tsx"]);

/** 하단 공통 표기 컴포넌트 이름 (`components/DataSources.tsx`) */
const MARKER = "DataSources";

/**
 * 표기를 겹쳐 두지 않는 자리와 그 사유.
 * 키 = `app/` 기준 상대 경로. 사유는 ② §2.1·§8.1의 서술을 그대로 옮긴 것입니다.
 */
const EXEMPT: Record<string, string> = {
  "about/page.tsx": "S6 정보 화면 — 무엇을 어디에 쓰는지까지 밝히는 자체 절(② §8.1)",
};

interface Screen {
  /** `app/` 기준 상대 경로 */
  rel: string;
  /** 사용자가 보는 주소 */
  route: string;
  /** 표기를 부르고 있는가 */
  marked: boolean;
  /** 제외 사유 (없으면 `null`) */
  exemptReason: string | null;
}

function collect(dir: string, appRoot: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    // 라우트가 되지 않는 자리는 훑지 않습니다.
    if (entry === "api" || entry.startsWith(".")) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      collect(full, appRoot, out);
      continue;
    }
    if (SCREEN_FILES.has(entry)) out.push(path.relative(appRoot, full).split(path.sep).join("/"));
  }
}

/** `place/[placeId]/page.tsx` → `/place/:placeId` */
function toRoute(rel: string): string {
  const parts = rel.split("/");
  const file = parts.pop() ?? "";
  const segments = parts
    // 괄호로 묶인 폴더는 주소에 나타나지 않습니다 (라우트 그룹).
    .filter((p) => !(p.startsWith("(") && p.endsWith(")")))
    .map((p) => (p.startsWith("[") && p.endsWith("]") ? `:${p.slice(1, -1)}` : p));
  const base = `/${segments.join("/")}`.replace(/\/+$/, "");
  const route = base === "" ? "/" : base;
  return file === "not-found.tsx" ? `${route} (없는 대상 안내)` : route;
}

function main(): void {
  const args = parseArgs();
  const showAll = hasFlag(args, "all");

  const appRoot = path.resolve(process.cwd(), "app");
  const files: string[] = [];
  collect(appRoot, appRoot, files);
  files.sort();

  const screens: Screen[] = files.map((rel) => {
    const source = readFileSync(path.join(appRoot, rel), "utf8");
    return {
      rel,
      route: toRoute(rel),
      marked: source.includes(MARKER),
      exemptReason: EXEMPT[rel] ?? null,
    };
  });

  const missing = screens.filter((s) => !s.marked && s.exemptReason === null);
  const listed = showAll ? screens : screens.filter((s) => s.exemptReason === null);

  console.log(heading("화면 ↔ 데이터 출처 표기 대조 (② §2.1)"));
  console.log("");
  const graded = screens.filter((s) => s.exemptReason === null);
  console.log(`  훑은 화면 파일   ${num(screens.length)}개 (app/ 아래 page.tsx · not-found.tsx)`);
  console.log(`  제외로 둔 곳     ${num(screens.length - graded.length)}개 (아래 EXEMPT)`);
  console.log(`  표기가 붙은 곳   ${num(graded.filter((s) => s.marked).length)}개 / ${num(graded.length)}개`);
  console.log(`  표기가 없는 곳   ${num(missing.length)}개`);

  console.log(section("화면별"));
  console.log("");
  console.log(
    renderTable(
      ["주소", "파일", "하단 출처 표기"],
      listed.map((s) => [
        s.route,
        `app/${s.rel}`,
        s.exemptReason !== null ? `제외 — ${s.exemptReason}` : s.marked ? "붙음" : "없음",
      ]),
      ["left", "left", "left"] as Align[],
    ),
  );

  if (missing.length > 0) {
    console.log("");
    console.log("  아래 화면에 하단 공통 표기가 없습니다 — ② §2.1은 예외를 두지 않습니다.");
    for (const s of missing) console.log(`    ${s.route}  (app/${s.rel})`);
    console.log("");
    console.log("  고치는 법 = 그 파일에서 `components/DataSources.tsx` 의 <DataSources /> 를");
    console.log("  본문 맨 끝에 부릅니다. 겹쳐 두지 않기로 정한 자리라면 ② §2.1을 먼저 고치고");
    console.log("  이 파일의 EXEMPT 에 사유와 함께 올립니다.");
    console.log("");
    process.exit(1);
  }

  console.log("");
  console.log("  표기가 빠진 화면은 없습니다.");
  console.log("");
}

main();
