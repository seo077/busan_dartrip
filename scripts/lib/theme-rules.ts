/**
 * 테마 매핑 규칙을 어디서 가져올지 정하는 곳.
 *
 * 규칙의 **정본은 DB 의 `theme_map` 테이블**입니다(AD-2 — 값이 바뀌어도 코드를 안 고치려고
 * 데이터로 뺀 것이라, 코드에 같은 값을 또 적으면 그 결정이 무의미해집니다).
 *
 * 다만 두 가지 사정이 있습니다.
 *   ① 다트 풀 실측 표(`scripts/report/pool-matrix.ts`)는 **DB 가 아직 없어도** 돌아야 합니다.
 *   ② 규칙을 바꿀 때 손으로 DB 를 고치면 마이그레이션과 어긋납니다.
 *
 * 그래서 **마이그레이션 SQL 이 규칙의 저장소 측 단일 출처**이고, 이 파일은 그 SQL 안의
 * `insert into theme_map …` · `delete from theme_map …` 구문을 **나타난 순서대로 읽어**
 * 최종 상태를 만듭니다. 규칙 값을 코드에 다시 적지 않습니다.
 *
 * 순서대로 읽는 것이 중요합니다 — 초기 스키마가 넣은 `'산'` 규칙을 나중 마이그레이션이
 * 지우므로, 파일을 순서대로 접어야 실제 DB 와 같은 결과가 나옵니다.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MatchKind, PlaceSource, ThemeKey, ThemeRule } from "../../lib/theme";
import { REPO_ROOT } from "./env";

export type RuleOrigin = "theme_map 테이블" | "마이그레이션 SQL";

export interface LoadedRules {
  rules: ThemeRule[];
  origin: RuleOrigin;
  /** 마이그레이션에서 읽었을 때 참고한 파일들 */
  files?: string[];
}

/** DB 에서 규칙을 읽습니다. */
export async function loadThemeRulesFromDb(
  client: SupabaseClient,
): Promise<ThemeRule[]> {
  const { data, error } = await client
    .from("theme_map")
    .select("source, match_kind, match_value, theme, priority");
  if (error) throw new Error(`theme_map 조회에 실패했습니다: ${error.message}`);

  return (data ?? []).map((row) => {
    const r = row as {
      source: string;
      match_kind: string;
      match_value: string;
      theme: string;
      priority: number;
    };
    return {
      source: r.source as PlaceSource,
      matchKind: r.match_kind as MatchKind,
      matchValue: r.match_value,
      theme: r.theme as ThemeKey,
      priority: r.priority,
    };
  });
}

/* ── 마이그레이션 SQL 파싱 ───────────────────────────────────────────────── */

const MIGRATIONS_DIR = "supabase/migrations";

/** `theme_map` 한 행 + 메모. */
export interface ThemeMapRow extends ThemeRule {
  note: string | null;
}

export type ThemeMapStatement =
  | { kind: "insert"; file: string; at: number; rows: ThemeMapRow[] }
  | {
      kind: "delete";
      file: string;
      at: number;
      source: string;
      matchKind: string;
      values: string[];
    };

/** SQL 문자열 리터럴 안의 `''` 는 따옴표 한 개입니다. */
function unquote(raw: string): string {
  return raw.replace(/''/g, "'");
}

/**
 * `insert into theme_map (…) values (…), (…);` 한 덩어리에서 행을 읽습니다.
 * 컬럼 순서는 `(source, match_kind, match_value, theme, priority, note)` 고정입니다.
 */
function parseInsertRows(block: string): ThemeMapRow[] {
  const rows: ThemeMapRow[] = [];
  const row =
    /\(\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'((?:[^']|'')*)'\s*,\s*'([^']*)'\s*,\s*(\d+)\s*(?:,\s*'((?:[^']|'')*)')?\s*\)/g;

  let m: RegExpExecArray | null;
  while ((m = row.exec(block)) !== null) {
    rows.push({
      source: m[1] as PlaceSource,
      matchKind: m[2] as MatchKind,
      matchValue: unquote(m[3]),
      theme: m[4] as ThemeKey,
      priority: Number(m[5]),
      note: m[6] === undefined ? null : unquote(m[6]),
    });
  }
  return rows;
}

/**
 * 마이그레이션 폴더의 `theme_map` 관련 구문을 **파일 이름순 · 파일 안 등장순** 으로 모읍니다.
 *
 * `delete` 는 아래 형태만 읽습니다. 형태가 달라지면 읽어 낸 구문 수가 줄어들고,
 * 호출측(`02-theme-map.ts`)이 그 수를 그대로 출력하므로 조용히 넘어가지 않습니다.
 *
 *   delete from theme_map
 *    where source = '…' and match_kind = '…' and match_value in ('…','…');
 */
export function loadThemeMapStatements(): ThemeMapStatement[] {
  const dir = resolve(REPO_ROOT, MIGRATIONS_DIR);

  let files: string[] = [];
  try {
    files = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
  } catch {
    return [];
  }

  const statements: ThemeMapStatement[] = [];

  for (const file of files) {
    const sql = readFileSync(join(dir, file), "utf8");
    const lower = sql.toLowerCase();
    const found: ThemeMapStatement[] = [];

    for (let from = 0; ; ) {
      const start = lower.indexOf("insert into theme_map", from);
      if (start < 0) break;
      const semi = sql.indexOf(";", start);
      const block = semi < 0 ? sql.slice(start) : sql.slice(start, semi);
      const rows = parseInsertRows(block);
      if (rows.length > 0) found.push({ kind: "insert", file, at: start, rows });
      from = semi < 0 ? sql.length : semi + 1;
    }

    for (let from = 0; ; ) {
      const start = lower.indexOf("delete from theme_map", from);
      if (start < 0) break;
      const semi = sql.indexOf(";", start);
      const block = semi < 0 ? sql.slice(start) : sql.slice(start, semi);

      const source = /source\s*=\s*'([^']*)'/i.exec(block)?.[1];
      const matchKind = /match_kind\s*=\s*'([^']*)'/i.exec(block)?.[1];
      const inList = /match_value\s+in\s*\(([^)]*)\)/i.exec(block)?.[1];
      const single = /match_value\s*=\s*'((?:[^']|'')*)'/i.exec(block)?.[1];

      let values: string[] = [];
      if (inList) {
        values = [...inList.matchAll(/'((?:[^']|'')*)'/g)].map((mm) => unquote(mm[1]));
      } else if (single !== undefined) {
        values = [unquote(single)];
      }

      if (source && matchKind && values.length > 0) {
        found.push({ kind: "delete", file, at: start, source, matchKind, values });
      }
      from = semi < 0 ? sql.length : semi + 1;
    }

    found.sort((a, b) => a.at - b.at);
    statements.push(...found);
  }

  return statements;
}

/**
 * 마이그레이션 구문을 순서대로 접어 **최종 규칙 상태**를 만듭니다.
 * DB 가 없을 때 `pool-matrix` 기본 경로가 쓰는 값이며, DB 의 `theme_map` 과 같아야 합니다.
 */
export function loadThemeRulesFromMigration(): LoadedRules {
  const statements = loadThemeMapStatements();
  const map = new Map<string, ThemeRule>();
  const files = new Set<string>();

  for (const st of statements) {
    files.add(st.file);
    if (st.kind === "insert") {
      for (const r of st.rows) {
        const key = `${r.source}|${r.matchKind}|${r.matchValue}`;
        // SQL 의 `on conflict do nothing` 과 같은 동작 — 먼저 들어간 값이 이깁니다.
        if (!map.has(key)) {
          map.set(key, {
            source: r.source,
            matchKind: r.matchKind,
            matchValue: r.matchValue,
            theme: r.theme,
            priority: r.priority,
          });
        }
      }
    } else {
      for (const v of st.values) {
        map.delete(`${st.source}|${st.matchKind}|${v}`);
      }
    }
  }

  return {
    rules: [...map.values()],
    origin: "마이그레이션 SQL",
    files: [...files],
  };
}
