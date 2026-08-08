/**
 * 동기화가 살아 있는지 — `sync_runs` 한 장으로 판정합니다 (DF-2).
 *
 * 설계 정본: `API데이터설계.md` §6.5(실패 알림 DF-2) · §11(DF-1~DF-3) · §11.2(심사 기간 점검)
 *            `ARCHITECTURE.md` `R-4`(무활동 정지) · `SC-7`(심사 기간 상시 접속)
 *
 * 왜 판정을 한 파일로 모으는가
 * ----------------------------
 * 같은 질문을 두 곳이 합니다 — **크론 자신**(`lib/sync.ts`, 실행을 마치고 "내가 어제도
 * 실패했나" 를 봅니다)과 **`GET /api/health`**(밖에서 주기적으로 찌르는 감시가 봅니다).
 * 두 곳의 답이 갈리면 알림이 왔는데 상태 경로는 정상이라고 하는 상황이 생기므로,
 * 판정 자체는 여기 한 곳에만 둡니다.
 *
 * 두 가지를 따로 셉니다
 * ---------------------
 *   ① **연속 실패** — 최근 실행이 `error` 로 몇 번 이어졌는가. §6.5 2행("2일 연속 실패").
 *   ② **마지막 성공 이후 경과** — 성공이 언제였는가. §6.5 3행("48시간 초과").
 *
 * ②가 ①을 대신하지 못합니다. 실행이 아예 멈추면 `error` 행조차 안 생겨서 ①은 계속 0 입니다.
 * **①이 세는 것은 「행」이라, 행이 안 남는 실패는 원리적으로 못 셉니다** — `startRun()` 자체가
 * 실패하거나 함수가 INSERT 전에 잘려 나가는 경우입니다. 그런 일이 실제로 있었던 흔적이
 * `sync_runs` id 공백(`10`·`11`·`12`)으로 관측됐습니다(`X-48` · ④ §6.5.1 · `R-19`).
 * 그 실패 종류에서는 **②가 유일한 방어**입니다.
 * 그리고 ②는 **앱 안에서 재는 것만으로는 부족합니다** — 크론이 안 돌면 이 코드도 안 돕니다.
 * 그래서 같은 판정을 밖에서도 볼 수 있게 `GET /api/health` 로 내보냅니다(§6.5 3행의 실제 수단).
 *
 * `running` 은 실패로 세지 않습니다
 * ---------------------------------
 * 함수가 상한에 잘려 `running` 인 채로 남은 행이 있을 수 있습니다(`app/api/cron/sync` 머리말).
 * 그것은 "실패했다" 가 아니라 "결과를 모른다" 이므로 연속 실패 계산에서 **건너뜁니다**.
 * 대신 성공도 아니므로 ②의 경과 시간에는 그대로 반영됩니다 — 진짜로 멈췄다면 ②가 잡습니다.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getServiceClient, supabaseStatus } from "@/lib/supabase";

/** §6.5 3행 — 마지막 성공이 이 시간을 넘으면 이상으로 봅니다 */
export const STALE_AFTER_HOURS = 48;

/** §6.5 2행 — 실행이 이만큼 연속으로 실패하면 알립니다 */
export const CONSECUTIVE_FAILURE_THRESHOLD = 2;

/** 연속 실패를 세려고 되짚어 보는 행 수. 하루 1회 실행이라 열흘치입니다 */
const LOOKBACK_ROWS = 10;

export interface SyncHealth {
  /** 판정 가능 여부. false 면 아래 값들은 의미가 없습니다 */
  known: boolean;
  /** 왜 판정할 수 없었는지 (`known: false` 일 때만) */
  reason: "missing_config" | "db_error" | null;
  /** 마지막으로 `ok` 로 끝난 실행 시각 (ISO). 한 번도 없으면 null */
  lastSuccessAt: string | null;
  /** 마지막 성공 이후 지난 시간(시). 성공 이력이 없으면 null */
  hoursSinceSuccess: number | null;
  /** 마지막 성공이 `STALE_AFTER_HOURS` 를 넘었는가. 성공 이력이 아예 없어도 true */
  stale: boolean;
  /** 최근 실행이 `error` 로 이어진 횟수 (`running` 은 건너뜀) */
  consecutiveFailures: number;
  /** 마지막 실행 시각 — 성공·실패를 가리지 않습니다 */
  lastRunAt: string | null;
  /** 마지막 실행의 상태 */
  lastRunStatus: string | null;
  /** 마지막 실행이 남긴 한 줄 (`sync_runs.error_message`) */
  lastRunNote: string | null;
}

function unknown(reason: SyncHealth["reason"]): SyncHealth {
  return {
    known: false,
    reason,
    lastSuccessAt: null,
    hoursSinceSuccess: null,
    // 모르는 상태를 정상으로 보고하지 않습니다 — 감시가 조용해지는 쪽이 더 나쁩니다.
    stale: true,
    consecutiveFailures: 0,
    lastRunAt: null,
    lastRunStatus: null,
    lastRunNote: null,
  };
}

interface RunRow {
  status: string | null;
  started_at: string | null;
  finished_at: string | null;
  error_message: string | null;
}

/** 실행이 끝난 시각. 아직 안 끝났으면 시작 시각을 씁니다 */
function runTime(row: RunRow): string | null {
  return row.finished_at ?? row.started_at;
}

/**
 * `sync_runs` 최근 이력으로 상태를 판정합니다.
 *
 * `db` 를 받는 이유 — 크론은 이미 열어 둔 클라이언트가 있고, 상태 경로는 없습니다.
 * 넘기지 않으면 여기서 엽니다.
 */
export async function readSyncHealth(db?: SupabaseClient): Promise<SyncHealth> {
  const status = supabaseStatus();
  if (!status.hasUrl || !status.hasServiceKey) return unknown("missing_config");

  let client: SupabaseClient;
  try {
    client = db ?? getServiceClient();
  } catch {
    return unknown("missing_config");
  }

  const { data, error } = await client
    .from("sync_runs")
    .select("status, started_at, finished_at, error_message")
    .order("id", { ascending: false })
    .limit(LOOKBACK_ROWS);

  if (error) return unknown("db_error");

  const rows = (data ?? []) as RunRow[];

  // 최근부터 훑으며 error 를 셉니다. ok 를 만나면 멈추고, running 은 건너뜁니다.
  let consecutiveFailures = 0;
  for (const row of rows) {
    if (row.status === "ok") break;
    if (row.status === "error") consecutiveFailures += 1;
    // running 그 밖의 값 — 세지도, 멈추지도 않습니다.
  }

  const lastSuccess = rows.find((row) => row.status === "ok") ?? null;
  const lastSuccessAt = lastSuccess ? runTime(lastSuccess) : null;

  const hoursSinceSuccess =
    lastSuccessAt === null
      ? null
      : Math.round(((Date.now() - new Date(lastSuccessAt).getTime()) / 3_600_000) * 10) / 10;

  const last = rows[0] ?? null;

  return {
    known: true,
    reason: null,
    lastSuccessAt,
    hoursSinceSuccess,
    // 성공 이력이 아예 없는 것도 이상입니다 — 크론이 한 번도 안 돌았다는 뜻입니다.
    stale: hoursSinceSuccess === null || hoursSinceSuccess > STALE_AFTER_HOURS,
    consecutiveFailures,
    lastRunAt: last ? runTime(last) : null,
    lastRunStatus: last?.status ?? null,
    lastRunNote: last?.error_message ?? null,
  };
}
