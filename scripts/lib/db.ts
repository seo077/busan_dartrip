/**
 * 스크립트용 Supabase 접근 도구.
 *
 * 클라이언트 자체는 `lib/supabase.ts` 의 `getServiceClient()` 를 그대로 씁니다
 * (같은 규칙을 두 벌 두지 않기 위해서). 이 파일은 그 위에 스크립트에서만 필요한 것을 얹습니다.
 *   - 환경변수가 비었을 때 안내로 끝내기
 *   - 1,000행 상한을 넘겨 전건 읽기 (Supabase REST 기본 상한)
 *   - 대량 upsert 를 덩어리로 나누기
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { getServiceClient } from "../../lib/supabase";
import { checkEnv, describeMissing } from "./env";
import { exitWithNotice } from "./cli";

export const DB_ENV_NAMES = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];

/** DB 접속 정보가 갖춰졌는지만 확인합니다. */
export function isDbConfigured(): boolean {
  return checkEnv(DB_ENV_NAMES).ok;
}

/** 접속 정보가 없으면 안내를 남기고 끝냅니다. 예외 스택을 던지지 않습니다. */
export function requireDb(): SupabaseClient {
  const report = checkEnv(DB_ENV_NAMES);
  if (!report.ok) {
    exitWithNotice(
      [
        describeMissing(report.missing),
        "",
        "Supabase 프로젝트를 아직 안 만들었다면 먼저 만들고,",
        "`supabase/migrations/` 안의 SQL 두 개를 실행해 주세요 (README §4).",
      ].join("\n"),
      2,
    );
  }
  return getServiceClient();
}

/**
 * 테이블 전건을 읽습니다. Supabase REST 는 한 번에 1,000행까지만 주므로 범위를 나눠 이어 붙입니다.
 * 지금 규모(장소 1천 건 안팎)에서는 두세 번이면 끝납니다.
 */
export async function selectAll<T>(
  client: SupabaseClient,
  table: string,
  columns: string,
  options: {
    pageSize?: number;
    orderBy?: string;
    filter?: (q: ReturnType<SupabaseClient["from"]>) => unknown;
  } = {},
): Promise<T[]> {
  const pageSize = options.pageSize ?? 1000;
  const rows: T[] = [];

  for (let from = 0; ; from += pageSize) {
    let query = client.from(table).select(columns);
    if (options.filter) query = options.filter(query as never) as typeof query;
    if (options.orderBy) query = query.order(options.orderBy, { ascending: true });

    const { data, error } = await query.range(from, from + pageSize - 1);
    if (error) throw new Error(`${table} 조회에 실패했습니다: ${error.message}`);

    const batch = (data ?? []) as unknown as T[];
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }

  return rows;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** 한 덩어리씩 upsert 하고 처리한 건수를 돌려줍니다. */
export async function upsertInChunks(
  client: SupabaseClient,
  table: string,
  rows: Record<string, unknown>[],
  onConflict: string,
  options: { size?: number; onProgress?: (done: number, total: number) => void } = {},
): Promise<number> {
  const size = options.size ?? 200;
  let done = 0;

  for (const part of chunk(rows, size)) {
    const { error } = await client.from(table).upsert(part, { onConflict });
    if (error) {
      throw new Error(
        `${table} 적재에 실패했습니다: ${error.message}` +
          (error.hint ? ` (힌트: ${error.hint})` : ""),
      );
    }
    done += part.length;
    options.onProgress?.(done, rows.length);
  }

  return done;
}

/** `sync_runs` 한 행을 시작 상태로 남깁니다. 실패해도 본 작업을 막지 않습니다. */
export async function startSyncRun(
  client: SupabaseClient,
  source: string,
  mode: "backfill" | "incremental",
): Promise<number | null> {
  const { data, error } = await client
    .from("sync_runs")
    .insert({ source, mode, status: "running" })
    .select("id")
    .single();
  if (error) {
    console.log(`  (sync_runs 기록을 남기지 못했습니다: ${error.message})`);
    return null;
  }
  return (data as { id: number }).id;
}

export async function finishSyncRun(
  client: SupabaseClient,
  id: number | null,
  patch: {
    status: "ok" | "error";
    fetched?: number;
    upserted?: number;
    skipped?: number;
    errorMessage?: string | null;
  },
): Promise<void> {
  if (id === null) return;
  const { error } = await client
    .from("sync_runs")
    .update({
      status: patch.status,
      fetched: patch.fetched ?? 0,
      upserted: patch.upserted ?? 0,
      skipped: patch.skipped ?? 0,
      error_message: patch.errorMessage ?? null,
      finished_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) console.log(`  (sync_runs 마무리 기록에 실패했습니다: ${error.message})`);
}
