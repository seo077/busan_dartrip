/**
 * 테마 매핑 규칙을 어디서 가져올지 정하는 곳.
 *
 * 규칙의 **정본은 DB 의 `theme_map` 테이블**입니다(AD-2 — 값이 바뀌어도 코드를 안 고치려고
 * 데이터로 뺀 것이라, 코드에 같은 값을 또 적으면 그 결정이 무의미해집니다).
 *
 * 다만 다트 풀 실측 표(`scripts/report/pool-matrix.ts`)는 **DB 가 아직 없어도** 돌아야 합니다.
 * 그때 값을 코드에 새로 적는 대신 **마이그레이션 SQL 의 `theme_map` 초기값 구문을 그대로 읽어서**
 * 씁니다. 저장소 안 단일 출처를 유지하면서 DB 없이도 같은 규칙으로 셀 수 있습니다.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MatchKind, PlaceSource, ThemeKey, ThemeRule } from "../../lib/theme";
import { REPO_ROOT } from "./env";

export type RuleOrigin = "theme_map 테이블" | "마이그레이션 SQL 초기값";

export interface LoadedRules {
  rules: ThemeRule[];
  origin: RuleOrigin;
  /** 마이그레이션에서 읽었을 때 그 파일 이름 */
  file?: string;
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

const MIGRATIONS_DIR = "supabase/migrations";

/**
 * 마이그레이션 SQL 안의 `insert into theme_map ... values (...)` 구문을 읽습니다.
 * 형식이 바뀌어 한 행도 못 읽으면 빈 배열을 돌려주며, 호출측이 그 사실을 그대로 알립니다.
 */
export function loadThemeRulesFromMigration(): LoadedRules {
  const dir = resolve(REPO_ROOT, MIGRATIONS_DIR);

  let files: string[] = [];
  try {
    files = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
  } catch {
    return { rules: [], origin: "마이그레이션 SQL 초기값" };
  }

  for (const file of files) {
    const sql = readFileSync(join(dir, file), "utf8");
    const start = sql.toLowerCase().indexOf("insert into theme_map");
    if (start < 0) continue;

    const after = sql.slice(start);
    const end = after.toLowerCase().indexOf("on conflict");
    const block = end > 0 ? after.slice(0, end) : after;

    const rules: ThemeRule[] = [];
    const row =
      /\(\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*(\d+)\s*,/g;

    let m: RegExpExecArray | null;
    while ((m = row.exec(block)) !== null) {
      rules.push({
        source: m[1] as PlaceSource,
        matchKind: m[2] as MatchKind,
        matchValue: m[3],
        theme: m[4] as ThemeKey,
        priority: Number(m[5]),
      });
    }

    if (rules.length > 0) {
      return { rules, origin: "마이그레이션 SQL 초기값", file };
    }
  }

  return { rules: [], origin: "마이그레이션 SQL 초기값" };
}
