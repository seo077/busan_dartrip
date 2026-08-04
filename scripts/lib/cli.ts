/**
 * 스크립트 공통 — 인자 파싱과 콘솔 출력 도구.
 *
 * 표를 콘솔에 그릴 일이 많아(구·군 × 테마 64칸) 한글 폭을 고려한 정렬기를 여기에 둡니다.
 * 한글·전각 문자는 터미널에서 두 칸을 차지하므로 `String.length` 로 맞추면 표가 틀어집니다.
 */

export interface Args {
  flags: Set<string>;
  values: Map<string, string>;
  rest: string[];
}

/** `--dry-run` `--source=api` `--limit 20` 세 형태를 받습니다. */
export function parseArgs(argv: string[] = process.argv.slice(2)): Args {
  const flags = new Set<string>();
  const values = new Map<string, string>();
  const rest: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      rest.push(token);
      continue;
    }
    const body = token.slice(2);
    const eq = body.indexOf("=");
    if (eq >= 0) {
      values.set(body.slice(0, eq), body.slice(eq + 1));
      continue;
    }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      values.set(body, next);
      i += 1;
      continue;
    }
    flags.add(body);
  }

  return { flags, values, rest };
}

export function hasFlag(args: Args, name: string): boolean {
  return args.flags.has(name) || args.values.get(name) === "true";
}

export function getValue(args: Args, name: string): string | undefined {
  return args.values.get(name);
}

export function getNumber(args: Args, name: string, fallback: number): number {
  const raw = args.values.get(name);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/** 터미널에서 차지하는 칸 수. 한글·전각은 2칸으로 셉니다. */
export function displayWidth(text: string): number {
  let width = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    const wide =
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6);
    width += wide ? 2 : 1;
  }
  return width;
}

export function padEndDisplay(text: string, width: number): string {
  const gap = width - displayWidth(text);
  return gap > 0 ? text + " ".repeat(gap) : text;
}

export function padStartDisplay(text: string, width: number): string {
  const gap = width - displayWidth(text);
  return gap > 0 ? " ".repeat(gap) + text : text;
}

export type Align = "left" | "right";

/** 머리글 + 행 배열을 고정폭 표로 그립니다. */
export function renderTable(
  header: string[],
  rows: string[][],
  align: Align[] = [],
): string {
  const widths = header.map((h, i) =>
    Math.max(displayWidth(h), ...rows.map((r) => displayWidth(r[i] ?? ""))),
  );

  const line = (cells: string[]) =>
    "  " +
    cells
      .map((c, i) =>
        (align[i] ?? "left") === "right"
          ? padStartDisplay(c, widths[i])
          : padEndDisplay(c, widths[i]),
      )
      .join("  ");

  const divider = "  " + widths.map((w) => "-".repeat(w)).join("  ");

  return [line(header), divider, ...rows.map(line)].join("\n");
}

export function heading(text: string): string {
  return `\n${text}\n${"=".repeat(Math.min(displayWidth(text), 78))}`;
}

export function section(text: string): string {
  return `\n${text}\n${"-".repeat(Math.min(displayWidth(text), 78))}`;
}

export function num(value: number): string {
  return value.toLocaleString("ko-KR");
}

/** 스크립트를 안내와 함께 끝냅니다. 예외 스택 대신 사람이 읽을 문장을 남깁니다. */
export function exitWithNotice(message: string, code = 1): never {
  console.log("");
  console.log(message);
  console.log("");
  process.exit(code);
}
