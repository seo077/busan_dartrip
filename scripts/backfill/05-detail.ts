/**
 * 백필 05 — 관광공사 `detailCommon2` 로 `places.overview` · `tel` · `homepage` 채우기.
 *
 * 설계 정본: `API데이터설계.md` §3.1(오퍼레이션 표) · §6.2(백필) / `ARCHITECTURE.md` AD-7
 *
 * 왜 미리 채우는가
 * ----------------
 * S4 소개 블록은 `places.overview` 를 먼저 보고, 비어 있을 때만 `detailCommon2` 를 부릅니다
 * (`lib/enrich.ts`). 지금은 관광공사 출처 전건의 `overview` 가 비어 있어 **장소를 열 때마다
 * 외부로 나갑니다.** 여기서 한 번 채워 두면 그 호출이 통째로 사라집니다 —
 * 심사 기간에 외부가 흔들려도 소개가 남아 있고(SC-6), 일 호출 한도도 지킵니다.
 *
 * 호출량 (2026-08-05 실측 기준)
 * -----------------------------
 *   대상 = `places` 중 source='tourapi' · status='published' · overview 가 빈 행
 *   건당 `detailCommon2` **1회**. 대상이 598건이면 **598회**입니다.
 *   개발계정 한도는 **1,000회/일** 이라 한 번에 들어갑니다만, 같은 날 백필·정찰을 함께
 *   돌렸다면 남은 한도를 넘길 수 있습니다. 그래서 **나눠 돌릴 수 있게** 해 두었습니다.
 *
 *     npm run backfill:detail -- --limit=300     # 오늘 300건만
 *     npm run backfill:detail                    # 다음 날 나머지
 *
 *   **재개에 커서가 필요 없습니다.** 대상 조건 자체가 "아직 안 채워진 행" 이라, 그냥 다시
 *   돌리면 남은 것만 집습니다. 중간에 끊겨도 이미 채운 것은 다시 부르지 않습니다.
 *
 * 원본이 지저분한 자리 (실측)
 * ---------------------------
 *   `overview`   `<br>` 같은 태그가 섞여 옵니다        → `stripHtml` 로 걷어냅니다
 *   `homepage`   `<a href="…">…</a>` 통째로 옵니다     → `extractHomepageUrl` 로 주소만
 *   `tel`        빈 문자열인 행이 많습니다              → null 로 두고 덮어쓰지 않습니다
 *
 *   셋 다 `lib/tourapi.core.ts` 가 이미 처리해 돌려줍니다. 여기서는 **빈 값으로 기존 값을
 *   덮어쓰지 않는 것**만 지킵니다.
 *
 * 실행
 * ----
 *   npm run backfill:detail
 *   npm run backfill:detail -- --dry-run          # 무엇을 부를지만 보고 끝
 *   npm run backfill:detail -- --limit=300
 *   npm run backfill:detail -- --include-unclassified   # 미분류 보관함까지
 *   npm run backfill:detail -- --redo             # 이미 채운 행도 다시
 */

import { TourApiError, fetchPlaceDetail } from "../../lib/tourapi.core";
import { loadEnv } from "../lib/env";
import { finishSyncRun, requireDb, selectAll, startSyncRun } from "../lib/db";
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

const SOURCE = "tourapi";

/** 동시에 부르는 수. 포털이 순간 부하에 민감해 낮게 둡니다. */
const CONCURRENCY = 4;

/** 한 묶음을 끝낸 뒤 쉬는 시간(ms). */
const DELAY_MS = 150;

/** `selectAll` 의 `filter` 로 넘어오는 조회 빌더 중 이 스크립트가 쓰는 부분만. */
interface QueryChain {
  eq(column: string, value: string): QueryChain;
  is(column: string, value: null): QueryChain;
  in(column: string, values: string[]): QueryChain;
  not(column: string, operator: string, value: null): QueryChain;
}

interface TargetRow {
  id: string;
  source_id: string | null;
  name: string;
  overview: string | null;
  tel: string | null;
  homepage: string | null;
}

interface Filled {
  id: string;
  overview: string | null;
  tel: string | null;
  homepage: string | null;
}

function blank(value: string | null): boolean {
  return value === null || value.trim() === "";
}

async function main(): Promise<void> {
  const args = parseArgs();
  const dryRun = hasFlag(args, "dry-run");
  const redo = hasFlag(args, "redo");
  const includeUnclassified = hasFlag(args, "include-unclassified");
  const limit = Math.max(0, Math.trunc(getNumber(args, "limit", 0))); // 0 = 전건
  const delayMs = Math.max(0, Math.trunc(getNumber(args, "delay", DELAY_MS)));

  console.log(heading("백필 05 — detailCommon2 → places.overview · tel · homepage"));

  const client = requireDb();

  // ── 1. 대상 고르기 ──────────────────────────────────────────────────────
  console.log(section("1. 대상"));

  const rows = await selectAll<TargetRow>(
    client,
    "places",
    "id,source_id,name,overview,tel,homepage",
    {
      orderBy: "id",
      filter: (q) => {
        const base = (q as unknown as QueryChain)
          .eq("source", SOURCE)
          .is("deleted_at", null)
          .not("source_id", "is", null);
        return includeUnclassified
          ? base.in("status", ["published", "unclassified"])
          : base.eq("status", "published");
      },
    },
  );

  const pending = redo ? rows : rows.filter((r) => blank(r.overview));
  const targets = limit > 0 ? pending.slice(0, limit) : pending;

  console.log("");
  console.log(
    renderTable(
      ["구분", "건수"],
      [
        [`source='${SOURCE}' 대상 전체`, num(rows.length)],
        ["  소개가 이미 있음", num(rows.length - rows.filter((r) => blank(r.overview)).length)],
        ["  아직 비어 있음", num(rows.filter((r) => blank(r.overview)).length)],
        ["이번에 부를 건수", num(targets.length)],
      ],
      ["left", "right"] as Align[],
    ),
  );
  console.log("");
  console.log(`  호출 예상   ${num(targets.length)}회 (건당 1회) · 개발계정 한도 1,000회/일`);
  if (limit > 0 && pending.length > targets.length) {
    console.log(`  남는 건수   ${num(pending.length - targets.length)}건 — 다음에 그냥 다시 돌리면 됩니다.`);
  }

  if (targets.length === 0) {
    console.log("");
    console.log("  채울 것이 없습니다.");
    console.log("");
    return;
  }

  if (dryRun) {
    console.log("");
    console.log("  --dry-run 이라 한 번도 부르지 않았습니다.");
    console.log(`  표본: ${targets.slice(0, 5).map((t) => t.name).join(" · ")}`);
    console.log("");
    return;
  }

  // ── 2. 호출 ─────────────────────────────────────────────────────────────
  console.log(section("2. detailCommon2 호출"));

  const runId = await startSyncRun(client, SOURCE, "backfill");

  const filled: Filled[] = [];
  let calls = 0;
  let failed = 0;
  let emptyOverview = 0;
  let firstError: string | null = null;
  const gotTel = { n: 0 };
  const gotHomepage = { n: 0 };

  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    const batch = targets.slice(i, i + CONCURRENCY);

    const results = await Promise.allSettled(
      batch.map((row) => fetchPlaceDetail(String(row.source_id))),
    );
    calls += batch.length;

    results.forEach((res, k) => {
      const row = batch[k];
      if (res.status !== "fulfilled") {
        failed += 1;
        const e = res.reason;
        firstError ??= e instanceof TourApiError ? `${e.message} (${e.reason})` : String(e);
        return;
      }
      const detail = res.value;
      if (!detail) {
        emptyOverview += 1;
        return;
      }

      // 빈 값으로 기존 값을 덮지 않습니다 — `tel` 은 원본이 빈 문자열인 행이 많습니다.
      const patch: Filled = {
        id: row.id,
        overview: blank(detail.overview) ? row.overview : detail.overview,
        tel: blank(detail.tel) ? row.tel : detail.tel,
        homepage: blank(detail.homepage) ? row.homepage : detail.homepage,
      };
      if (blank(detail.overview)) emptyOverview += 1;
      if (!blank(detail.tel)) gotTel.n += 1;
      if (!blank(detail.homepage)) gotHomepage.n += 1;

      // 바뀌는 것이 하나도 없으면 쓸 이유가 없습니다.
      if (
        patch.overview === row.overview &&
        patch.tel === row.tel &&
        patch.homepage === row.homepage
      ) {
        return;
      }
      filled.push(patch);
    });

    const done = Math.min(i + CONCURRENCY, targets.length);
    if (done % 100 < CONCURRENCY || done === targets.length) {
      console.log(`  ${num(done)} / ${num(targets.length)} · 받은 값 ${num(filled.length)} · 실패 ${num(failed)}`);
    }

    // 한도를 넘겼거나 키가 죽었으면 더 두드릴 이유가 없습니다.
    if (failed >= 20 && filled.length === 0) {
      console.log("");
      console.log("  연속으로 실패해 멈춥니다. 호출 한도나 서비스키를 확인해 주세요.");
      break;
    }

    if (delayMs > 0 && i + CONCURRENCY < targets.length) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  // ── 3. 반영 ─────────────────────────────────────────────────────────────
  console.log(section("3. places 갱신"));

  let updated = 0;
  try {
    for (let i = 0; i < filled.length; i += CONCURRENCY * 4) {
      const batch = filled.slice(i, i + CONCURRENCY * 4);
      const results = await Promise.all(
        batch.map((p) =>
          client
            .from("places")
            .update({
              overview: p.overview,
              tel: p.tel,
              homepage: p.homepage,
              updated_at: new Date().toISOString(),
            })
            .eq("id", p.id),
        ),
      );
      for (const r of results) {
        if (r.error) throw new Error(r.error.message);
        updated += 1;
      }
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await finishSyncRun(client, runId, { status: "error", errorMessage: message });
    exitWithNotice(`갱신에 실패했습니다: ${message}`, 4);
  }

  await finishSyncRun(client, runId, {
    status: failed > 0 && updated === 0 ? "error" : "ok",
    fetched: calls,
    upserted: updated,
    skipped: failed,
    errorMessage: firstError,
  });

  console.log("");
  console.log(
    renderTable(
      ["구분", "건수"],
      [
        ["호출", num(calls)],
        ["갱신된 행", num(updated)],
        ["  전화가 붙은 행", num(gotTel.n)],
        ["  홈페이지가 붙은 행", num(gotHomepage.n)],
        ["원본에 소개가 없던 행", num(emptyOverview)],
        ["호출 실패", num(failed)],
      ],
      ["left", "right"] as Align[],
    ),
  );

  if (emptyOverview > 0) {
    console.log("");
    console.log(
      `  원본에 소개가 없는 ${num(emptyOverview)}건은 다음에 다시 돌리면 또 불립니다 —\n` +
        "  \"아직 안 채워진 행\" 과 구분할 방법이 응답에 없기 때문입니다. 그만큼은 감안해 주세요.",
    );
  }
  if (firstError) {
    console.log("");
    console.log(`  첫 실패 사유: ${firstError}`);
  }
  console.log("");
  console.log("  이제 S4 소개 블록은 DB 값을 씁니다 — 장소를 열 때 detailCommon2 를 부르지 않습니다.");
  console.log("");
}

main().catch((e) => {
  console.log("");
  console.log("예상하지 못한 오류로 멈췄습니다.");
  console.log(`  ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
  console.log("");
  process.exit(1);
});
