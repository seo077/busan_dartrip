/**
 * 백필 02 — 마이그레이션의 `theme_map` 구문을 DB 에 반영.
 *
 * 설계 정본: `API데이터설계.md` §4.1 · §4.3 · §6.2 / `ARCHITECTURE.md` AD-2
 *
 * 왜 필요한가
 * -----------
 * 규칙을 바꾸려면 새 마이그레이션 파일을 더합니다(이미 실행된 파일은 고치지 않습니다).
 * 그런데 Supabase 대시보드에서 SQL 을 다시 붙여넣는 것은 사람이 빠뜨리기 쉽고,
 * 빠뜨려도 오류가 안 납니다 — 규칙이 옛날 상태로 남아 분류만 조용히 틀립니다.
 *
 * 그래서 이 스크립트가 **마이그레이션 파일을 순서대로 읽어 그 안의 `theme_map`
 * `insert`·`delete` 구문을 그대로 재생**합니다. 규칙 값을 코드에 다시 적지 않으므로
 * SQL 파일이 단일 출처로 남습니다(AD-2).
 *
 * ④ §6.2 는 이 번호를 "categoryCode → theme_map 시드" 로 두었습니다. 관광공사
 * 분류코드는 실응답으로 이미 확인돼(SYNC-5 · POOL-4) 조회할 이유가 없어졌고,
 * 같은 자리(테마 규칙을 DB 에 세우는 단계)를 본 용도가 이어받습니다.
 *
 * 기본은 **미리보기**입니다. 실제로 쓰려면 `--apply` 를 붙입니다.
 *
 * 실행
 * ----
 *   npm run backfill:theme-map              # 무엇이 바뀌는지 보기만
 *   npm run backfill:theme-map -- --apply   # DB 에 반영
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { THEME_LABELS, type ThemeKey } from "../../lib/theme";
import { loadEnv } from "../lib/env";
import { requireDb } from "../lib/db";
import { loadThemeMapStatements, type ThemeMapStatement } from "../lib/theme-rules";
import {
  exitWithNotice,
  hasFlag,
  heading,
  num,
  parseArgs,
  renderTable,
  section,
  type Align,
} from "../lib/cli";

loadEnv();

interface DbRule {
  source: string;
  match_kind: string;
  match_value: string;
  theme: ThemeKey;
  priority: number;
}

async function readRules(client: SupabaseClient): Promise<DbRule[]> {
  const { data, error } = await client
    .from("theme_map")
    .select("source, match_kind, match_value, theme, priority");
  if (error) exitWithNotice(`theme_map 조회에 실패했습니다: ${error.message}`, 2);
  return (data ?? []) as unknown as DbRule[];
}

function keyOf(r: { source: string; match_kind: string; match_value: string }): string {
  return `${r.source}|${r.match_kind}|${r.match_value}`;
}

function describe(st: ThemeMapStatement): string {
  return st.kind === "insert"
    ? `${st.file} — insert ${num(st.rows.length)}행`
    : `${st.file} — delete ${st.source}/${st.matchKind} ${st.values.map((v) => `'${v}'`).join(", ")}`;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const apply = hasFlag(args, "apply");

  console.log(heading("백필 02 — theme_map 규칙 반영"));

  const client = requireDb();

  const statements = loadThemeMapStatements();
  if (statements.length === 0) {
    exitWithNotice(
      [
        "마이그레이션에서 theme_map 구문을 한 줄도 읽지 못했습니다.",
        "",
        "  - 저장소 루트에서 실행했는지 (npm run 으로 실행하면 항상 루트입니다)",
        "  - supabase/migrations/ 에 SQL 이 있는지",
        "  - insert/delete 구문 형태가 `scripts/lib/theme-rules.ts` 주석과 같은지",
      ].join("\n"),
      2,
    );
  }

  console.log("");
  console.log(`  읽은 구문     ${num(statements.length)}개`);
  for (const st of statements) console.log(`    ${describe(st)}`);

  const before = await readRules(client);
  console.log("");
  console.log(`  DB 현재 규칙  ${num(before.length)}행`);

  // ── 반영 후 상태를 먼저 계산해 미리보기로 냅니다 ────────────────────────
  const beforeKeys = new Set(before.map(keyOf));
  const willInsert: DbRule[] = [];
  const willDelete: string[] = [];
  const projected = new Set(beforeKeys);

  for (const st of statements) {
    if (st.kind === "insert") {
      for (const r of st.rows) {
        const key = `${r.source}|${r.matchKind}|${r.matchValue}`;
        if (projected.has(key)) continue; // on conflict do nothing
        projected.add(key);
        willInsert.push({
          source: r.source,
          match_kind: r.matchKind,
          match_value: r.matchValue,
          theme: r.theme,
          priority: r.priority,
        });
      }
    } else {
      for (const v of st.values) {
        const key = `${st.source}|${st.matchKind}|${v}`;
        if (projected.has(key)) {
          projected.delete(key);
          willDelete.push(key);
        }
        // 아직 안 들어간 값을 지우는 구문이면(재생 순서상 뒤에 insert 가 오는 경우)
        // 그 insert 를 취소해야 하므로 예약분에서도 뺍니다.
        const idx = willInsert.findIndex(
          (r) => r.source === st.source && r.match_kind === st.matchKind && r.match_value === v,
        );
        if (idx >= 0) willInsert.splice(idx, 1);
      }
    }
  }

  console.log(section("반영하면 무엇이 바뀌는가"));
  console.log("");
  console.log(`  추가          ${num(willInsert.length)}행`);
  console.log(`  삭제          ${num(willDelete.length)}행`);
  console.log(`  반영 후 총계  ${num(projected.size)}행`);

  if (willDelete.length > 0) {
    console.log("");
    console.log("  삭제 대상");
    for (const k of willDelete) console.log(`    ${k.split("|").join("  ")}`);
  }

  if (willInsert.length > 0) {
    console.log("");
    console.log("  추가 대상");
    console.log("");
    console.log(
      renderTable(
        ["출처", "종류", "값", "테마", "우선"],
        willInsert.map((r) => [
          r.source,
          r.match_kind,
          r.match_value,
          THEME_LABELS[r.theme] ?? r.theme,
          String(r.priority),
        ]),
        ["left", "left", "left", "left", "right"] as Align[],
      ),
    );
  }

  if (!apply) {
    console.log("");
    console.log("  미리보기입니다. 실제로 쓰려면 --apply 를 붙여 주세요.");
    console.log("    npm run backfill:theme-map -- --apply");
    console.log("");
    return;
  }

  // ── 재생 ────────────────────────────────────────────────────────────────
  console.log(section("반영"));

  for (const st of statements) {
    if (st.kind === "insert") {
      const rows = st.rows.map((r) => ({
        source: r.source,
        match_kind: r.matchKind,
        match_value: r.matchValue,
        theme: r.theme,
        priority: r.priority,
        note: r.note,
      }));
      const { error } = await client
        .from("theme_map")
        .upsert(rows, { onConflict: "source,match_kind,match_value", ignoreDuplicates: true });
      if (error) exitWithNotice(`규칙 추가에 실패했습니다: ${error.message}`, 4);
      console.log(`  ${describe(st)} — 반영`);
    } else {
      const { error } = await client
        .from("theme_map")
        .delete()
        .eq("source", st.source)
        .eq("match_kind", st.matchKind)
        .in("match_value", st.values);
      if (error) exitWithNotice(`규칙 삭제에 실패했습니다: ${error.message}`, 4);
      console.log(`  ${describe(st)} — 반영`);
    }
  }

  const after = await readRules(client);

  console.log("");
  console.log(`  반영 전       ${num(before.length)}행`);
  console.log(`  반영 후       ${num(after.length)}행`);

  const bySource = new Map<string, number>();
  for (const r of after) bySource.set(r.source, (bySource.get(r.source) ?? 0) + 1);
  console.log("");
  console.log(
    renderTable(
      ["출처", "규칙 수"],
      [...bySource.entries()].sort().map(([k, v]) => [k, num(v)]),
      ["left", "right"] as Align[],
    ),
  );

  console.log("");
  console.log("  규칙만 바꾼 것이라 이미 적재된 places.theme 은 그대로입니다.");
  console.log("  분류를 다시 매기려면 백필을 다시 돌리십시오.");
  console.log("    npm run backfill:busan");
  console.log("");
}

main().catch((e) => {
  console.log("");
  console.log("예상하지 못한 오류로 멈췄습니다.");
  console.log(`  ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
  console.log("");
  process.exit(1);
});
