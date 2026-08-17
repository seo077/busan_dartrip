/**
 * 화면 ↔ 데이터 출처 표기 대조 (2026-08-17 신설 · 같은 날 모수 확장 `X-54`·`X-55`).
 *
 * 설계 정본: ② `화면구성도.md` §2.1(전 화면 공통 · 예외 없음) · §8.1(`S6` 자체 절) · §12.2(프레임워크 화면)
 *            ④ `API데이터설계.md` §10(문안·목록 정본) / `ARCHITECTURE.md` §부록 규칙 ㉮·㉣·㉤
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
 * 고치지 않고 **대조만** 합니다.
 *
 * ★ 이 도구의 모수 (2026-08-17 확장 — `X-55`)
 * -------------------------------------------
 * 처음 판의 모수는 **`app/` 아래 실재하는 파일**이었습니다. 그래서 **파일이 없어서 생기는
 * 화면**은 시야 밖이었습니다 — 루트 `not-found.tsx` 가 없으면 프레임워크가 자기 기본 404를
 * 내주는데, 파일이 없으니 어느 목록에도 나타나지 않습니다. **사람이 놓친 이유(「화면 목록에
 * 없어서」)와 도구가 놓친 이유(「파일 목록에 없어서」)가 같았습니다.**
 *
 * 그래서 모수를 **둘**로 둡니다. 이 목록이 곧 이 도구가 보는 전부이며, 여기 없는 것은
 * 이 도구로 걸리지 않습니다 — 그 사실을 도구 자신이 화면에 적습니다.
 *
 *   ㉠ **우리가 만든 화면 파일** — `app/` 아래 `page.tsx` · `not-found.tsx` · `error.tsx` ·
 *      `global-error.tsx`. 각각이 하단 공통 표기(`components/DataSources.tsx`)를 부르는지 봅니다.
 *   ㉡ **프레임워크가 기본값으로 내주는 화면** — 우리가 파일을 두지 않으면 Next.js 가 자기
 *      화면을 내주는 자리(아래 `FRAMEWORK_DEFAULTS`). **파일이 없다는 것 자체를 셉니다.**
 *      그 화면에는 표기도 팔레트도 우리말도 없으므로, 파일을 두거나 **「그대로 둔다」는 판단을
 *      문서에 적고 아래 `ACCEPTED_DEFAULTS` 에 올리거나** 둘 중 하나여야 합니다.
 *
 * 아직 모수 밖인 것 — **빌드가 만드는 그 밖의 경로**(`/robots.txt`·`/manifest.webmanifest` 등
 * 파일 기반 메타데이터)와 **배포본에만 있는 자리**. 화면이 아니라 문서·설정 응답이라 화면
 * 단위 의무의 대상이 아니라고 보았고, 이 판단 자체를 여기 적어 둡니다(`X-55` 3축 ㈜(c)).
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
 * 표기가 빠진 화면이나 **판단이 적히지 않은 프레임워크 기본 화면**이 하나라도 있으면
 * **0이 아닌 종료 코드**로 끝납니다.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { hasFlag, heading, num, parseArgs, renderTable, section, type Align } from "../lib/cli";

/** 화면 파일로 세는 이름 — 실제로 사용자가 보는 화면이 되는 것들입니다 */
const SCREEN_FILES = new Set(["page.tsx", "not-found.tsx", "error.tsx", "global-error.tsx"]);

/** 하단 공통 표기 컴포넌트 이름 (`components/DataSources.tsx`) */
const MARKER = "DataSources";

/**
 * 표기를 겹쳐 두지 않는 자리와 그 사유.
 * 키 = `app/` 기준 상대 경로. 사유는 ② §2.1·§8.1의 서술을 그대로 옮긴 것입니다.
 */
const EXEMPT: Record<string, string> = {
  "about/page.tsx": "S6 정보 화면 — 무엇을 어디에 쓰는지까지 밝히는 자체 절(② §8.1)",
};

/**
 * 우리가 파일을 두지 않으면 **프레임워크가 자기 기본값으로 내주는 화면** (`X-54`).
 *
 * 키 = `app/` 루트 기준 파일 이름. 이 목록은 Next.js App Router 의 특수 파일 중
 * **사용자에게 화면으로 보이는 것**만 담습니다(`loading`·`template` 등 화면 전체를 대신하지
 * 않는 것은 제외). 프레임워크 판을 올릴 때 특수 파일이 늘면 이 표에 함께 더합니다.
 */
const FRAMEWORK_DEFAULTS: { file: string; route: string; what: string }[] = [
  { file: "not-found.tsx", route: "/_not-found", what: "라우트에 없는 주소 (오타 · 옛 링크)" },
  { file: "error.tsx", route: "(오류 경계 — 루트)", what: "처리되지 않은 오류" },
  { file: "global-error.tsx", route: "(오류 경계 — 레이아웃)", what: "루트 레이아웃 자체의 오류" },
];

/**
 * **기본 화면을 그대로 두기로 한 자리**와 그 판단이 적힌 곳.
 *
 * 비어 있는 것이 지금 상태입니다 — 위 셋 모두 우리 파일을 두었습니다(2026-08-17 · `AL-1`).
 * 나중에 어느 하나를 그대로 두기로 정하면 **먼저 ② §12.2에 그 판단과 남는 사실**(다크 반전 ·
 * 영문 · 출처 표기 0건)을 적고, 그 다음에 여기 한 줄을 올립니다.
 */
const ACCEPTED_DEFAULTS: Record<string, string> = {};

/** 루트에 놓인 특수 파일의 사람이 읽는 이름 */
const ROOT_SPECIAL: Record<string, string> = {
  "not-found.tsx": "/_not-found (없는 주소)",
  "error.tsx": "(오류 경계 — 루트)",
  "global-error.tsx": "(오류 경계 — 레이아웃)",
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

  // 루트에 바로 놓인 특수 파일은 주소가 아니라 「자리」로 적습니다.
  if (parts.length === 0 && ROOT_SPECIAL[file]) return ROOT_SPECIAL[file];

  const segments = parts
    // 괄호로 묶인 폴더는 주소에 나타나지 않습니다 (라우트 그룹).
    .filter((p) => !(p.startsWith("(") && p.endsWith(")")))
    .map((p) => (p.startsWith("[") && p.endsWith("]") ? `:${p.slice(1, -1)}` : p));
  const base = `/${segments.join("/")}`.replace(/\/+$/, "");
  const route = base === "" ? "/" : base;
  if (file === "not-found.tsx") return `${route} (없는 대상 안내)`;
  if (file === "error.tsx") return `${route} (오류 안내)`;
  return route;
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

  // ㉡ 모수 — 프레임워크가 기본값으로 내주는 자리 (`X-54`)
  const defaults = FRAMEWORK_DEFAULTS.map((d) => {
    const ours = existsSync(path.join(appRoot, d.file));
    const accepted = ACCEPTED_DEFAULTS[d.file] ?? null;
    return { ...d, ours, accepted };
  });
  const unhandled = defaults.filter((d) => !d.ours && d.accepted === null);

  console.log(heading("화면 ↔ 데이터 출처 표기 대조 (② §2.1)"));
  console.log("");
  console.log("  이 도구가 보는 모수 (여기 없는 자리는 이 도구로 걸리지 않습니다 — X-55)");
  console.log("    ㉠ 우리가 만든 화면 파일  app/ 아래 page.tsx · not-found.tsx · error.tsx · global-error.tsx");
  console.log("    ㉡ 프레임워크 기본 화면    파일을 두지 않으면 Next.js 가 대신 내주는 자리");
  console.log("    (모수 밖 = /robots.txt 같은 파일 기반 메타데이터 · 배포본에만 있는 자리)");
  console.log("");

  const graded = screens.filter((s) => s.exemptReason === null);
  console.log(`  훑은 화면 파일   ${num(screens.length)}개 (모수 ㉠)`);
  console.log(`  제외로 둔 곳     ${num(screens.length - graded.length)}개 (아래 EXEMPT)`);
  console.log(`  표기가 붙은 곳   ${num(graded.filter((s) => s.marked).length)}개 / ${num(graded.length)}개`);
  console.log(`  표기가 없는 곳   ${num(missing.length)}개`);
  console.log(`  프레임워크 자리  ${num(defaults.length)}개 중 우리 파일 ${num(defaults.filter((d) => d.ours).length)}개 · 판단 기재 ${num(defaults.filter((d) => !d.ours && d.accepted !== null).length)}개 · 미처리 ${num(unhandled.length)}개`);

  console.log(section("화면별 (모수 ㉠)"));
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

  console.log(section("프레임워크가 기본값으로 내주는 자리 (모수 ㉡ · X-54)"));
  console.log("");
  console.log(
    renderTable(
      ["자리", "언제 보이나", "상태"],
      defaults.map((d) => [
        d.route,
        d.what,
        d.ours
          ? `우리 화면 — app/${d.file}`
          : d.accepted !== null
            ? `기본값 그대로 — ${d.accepted}`
            : "기본값 그대로 · 판단 기재 없음",
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
  }

  if (unhandled.length > 0) {
    console.log("");
    console.log("  아래는 프레임워크 기본 화면이 그대로 나가는 자리입니다 — 그 화면에는");
    console.log("  우리말도 팔레트도 데이터 출처 표기도 없고, 다크 선호 기기에서는 검은 바탕이");
    console.log("  됩니다(D-61-3 「밝은 화면 고정」과 반대).");
    for (const d of unhandled) console.log(`    ${d.route}  (app/${d.file} 없음 — ${d.what})`);
    console.log("");
    console.log("  고치는 법 = 그 파일을 만들거나, 그대로 두기로 정했다면 ② §12.2에 판단과");
    console.log("  남는 사실을 적고 이 파일의 ACCEPTED_DEFAULTS 에 그 자리를 올립니다.");
  }

  if (missing.length > 0 || unhandled.length > 0) {
    console.log("");
    process.exit(1);
  }

  console.log("");
  console.log("  표기가 빠진 화면도, 판단이 적히지 않은 프레임워크 기본 화면도 없습니다.");
  console.log("");
}

main();
