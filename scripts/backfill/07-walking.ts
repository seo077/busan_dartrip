/**
 * 백필 07 — 부산광역시 부산도보여행정보 → `courses`.
 *
 * 설계 정본: `API데이터설계.md` §5.3(`courses`) · §6.2 / `ARCHITECTURE.md` §5
 *
 * 왜 `places` 가 아니라 `courses` 인가 (A 자체 결정)
 * ------------------------------------------------
 * 도보여행 56건은 **지점이 아니라 경로**입니다. 다트 풀(`places`)에 넣지 않고
 * 코스 표에 적재합니다. 근거 세 가지입니다.
 *
 *   ① **구·군을 알 수 없습니다.** 이 오퍼레이션의 응답에는 `GUGUN_NM` 도 `ADDR1` 도
 *      없습니다(2026-08-05 정찰 실측 — 필드 13개 중 위치 정보는 `LAT`/`LNG` 뿐).
 *      `places.sigungu_code` 는 not null 외래키라 채울 근거가 원본에 없습니다.
 *      좌표로 구·군을 되짚는 방법이 있지만, 행정 경계 폴리곤이 아직 없고(U-10)
 *      **추정한 구·군이 다트 결과의 "어느 구·군이 걸렸는가" 를 그대로 좌우**하므로
 *      지어낸 값을 넣지 않습니다.
 *
 *   ② **시작점 한 점이 코스를 대표하지 못합니다.** 예: `초량이바구길` 의 `PLACE` 는
 *      `초량이바구길, 이바구공작소, 168계단` 으로 경유지 나열입니다. 좌표는 하나뿐이라
 *      이 점을 장소로 세우면 D-10 "이 근처" 가 코스 전체가 아니라 시작점 주변만 보게 됩니다.
 *
 *   ③ `place_source` 열거형에 도보여행에 해당하는 값이 없습니다. 넣으려면 열거형을
 *      바꿔야 하고, 그것은 설계 변경입니다.
 *
 * `courses` 는 원래 두루누비 부산 코스를 담는 표이며(§5.3), 도보 코스라는 성격이 같습니다.
 * 그래서 ④ §6.2 의 07 번(코스 적재) 자리에 둡니다. 두루누비는 나중에 같은 표에
 * 다른 `id` 접두어로 들어옵니다.
 *
 * 이름
 * ----
 * 코스 이름은 `MAIN_TITLE` 에서 언어 표기를 뗀 값을 씁니다. 명소와 반대인데,
 * 도보여행의 `PLACE` 는 장소명이 아니라 **경유지 나열**이기 때문입니다.
 * 경유지 원문은 `detail.waypoints` 에 그대로 남깁니다.
 *
 * 실행
 * ----
 *   npm run backfill:walking
 *   npm run backfill:walking -- --dry-run
 */

import {
  BusanApiError,
  findService,
  iterateBusanService,
} from "../../lib/busanapi.core";
import { isInBusanBox, stripLanguageTags } from "../lib/busan";
import { loadEnv } from "../lib/env";
import { chunk, requireDb } from "../lib/db";
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

/** `courses.id` 접두어. 두루누비가 같은 표에 들어와도 안 부딪히게 소스를 접두어로 답니다. */
const ID_PREFIX = "busan-walking";

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function numOrNull(v: unknown): number | null {
  const s = str(v);
  if (s === null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

interface CourseRow {
  id: string;
  name: string;
  distance_km: number | null;
  kind: string | null;
  start_lat: number | null;
  start_lng: number | null;
  detail: Record<string, unknown>;
  synced_at: string;
  [key: string]: unknown;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const dryRun = hasFlag(args, "dry-run");

  console.log(heading("백필 07 — 부산도보여행정보 → courses"));

  const spec = findService("walking");
  if (!spec) exitWithNotice("부산도보여행정보 명세를 찾지 못했습니다.", 2);

  const client = requireDb();

  console.log("");
  console.log(`  요청주소      ${spec.path}`);
  console.log("  적재 대상     courses (places 가 아닙니다 — 파일 머리말의 근거 ①②③ 참조)");

  // ── 1. 수집 ─────────────────────────────────────────────────────────────
  console.log(section("1. 수집"));

  let collected;
  try {
    collected = await iterateBusanService(spec, {
      pageSize: 100,
      maxPages: 10,
      delayMs: 200,
      onPage: (p) =>
        console.log(
          `  ${String(p.pageNo).padStart(2, " ")}/${String(p.totalPages).padStart(2, " ")} 페이지 · ` +
            `누적 ${num(p.accumulated)} / ${num(p.totalCount)}`,
        ),
    });
  } catch (e) {
    const detail = e instanceof BusanApiError ? `${e.message} (${e.reason})` : String(e);
    exitWithNotice(`수집에 실패했습니다: ${detail}`, 3);
  }

  console.log("");
  console.log(`  totalCount    ${num(collected.totalCount)}`);
  console.log(`  받은 코스     ${num(collected.items.length)}건`);
  console.log(`  호출 수       ${num(collected.calls)}회`);

  // ── 2. 위치 정보 실태 ───────────────────────────────────────────────────
  // "구·군 필드가 없다" 는 판단이 표본 1건이 아니라 전건에서 성립하는지 확인합니다.
  console.log(section("2. 위치 정보 실태 — 전건 확인"));

  const fieldSeen = new Map<string, number>();
  for (const item of collected.items) {
    for (const [k, v] of Object.entries(item)) {
      if (str(v) !== null) fieldSeen.set(k, (fieldSeen.get(k) ?? 0) + 1);
    }
  }
  const locationFields = ["GUGUN_NM", "ADDR1", "ADDR2", "LAT", "LNG", "CATE2_NM"];
  console.log("");
  console.log(
    renderTable(
      ["필드", "값이 있는 건수", "전체 대비"],
      locationFields.map((f) => [
        f,
        num(fieldSeen.get(f) ?? 0),
        `${num(fieldSeen.get(f) ?? 0)} / ${num(collected.items.length)}`,
      ]),
      ["left", "right", "right"] as Align[],
    ),
  );
  console.log("");
  console.log("  구·군/주소 칸이 0 이면 이 소스만으로는 장소의 소속 구·군을 알 수 없습니다.");

  const cate2 = new Map<string, number>();
  for (const item of collected.items) {
    const v = str(item.CATE2_NM) ?? "(없음)";
    cate2.set(v, (cate2.get(v) ?? 0) + 1);
  }
  console.log("");
  console.log("  CATE2_NM 분포 — 분류에 쓸 수 있는 유일한 필드입니다");
  console.log(
    renderTable(
      ["CATE2_NM", "건수"],
      [...cate2.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, num(v)]),
      ["left", "right"] as Align[],
    ),
  );

  // ── 3. 변환 ─────────────────────────────────────────────────────────────
  console.log(section("3. courses 행으로 변환"));

  const rows: CourseRow[] = [];
  const seen = new Set<string>();
  const now = new Date().toISOString();
  let noName = 0;
  let noCoord = 0;
  let outside = 0;

  for (const item of collected.items) {
    const seq = str(item.UC_SEQ);
    if (!seq) continue;
    const id = `${ID_PREFIX}-${seq}`;
    if (seen.has(id)) continue;
    seen.add(id);

    const mainTitle = str(item.MAIN_TITLE);
    const name = mainTitle ? stripLanguageTags(mainTitle) : str(item.PLACE);
    if (!name) {
      noName += 1;
      continue;
    }

    const lat = numOrNull(item.LAT);
    const lng = numOrNull(item.LNG);
    if (lat === null || lng === null) noCoord += 1;
    else if (!isInBusanBox(lat, lng)) outside += 1;

    rows.push({
      id,
      name,
      distance_km: null, // 응답에 거리 필드가 없습니다
      kind: str(item.CATE2_NM),
      start_lat: lat,
      start_lng: lng,
      detail: {
        source: "busan_walking",
        uc_seq: seq,
        waypoints: str(item.PLACE), // 경유지 나열 원문
        headline: str(item.TITLE),
        subtitle: str(item.SUBTITLE),
        traffic: str(item.TRFC_INFO),
        accessibility: str(item.MIDDLE_SIZE_RM1),
        image: str(item.MAIN_IMG_NORMAL),
        image_thumb: str(item.MAIN_IMG_THUMB),
        overview: str(item.ITEMCNTNTS),
      },
      synced_at: now,
    });
  }

  console.log("");
  console.log(
    renderTable(
      ["구분", "건수"],
      [
        ["받은 코스", num(collected.items.length)],
        ["적재 대상", num(rows.length)],
        ["이름 없음(제외)", num(noName)],
        ["좌표 없음(적재하되 표시)", num(noCoord)],
        ["부산 범위 밖 좌표", num(outside)],
      ],
      ["left", "right"] as Align[],
    ),
  );

  console.log("");
  console.log("  표본 5건");
  console.log("");
  console.log(
    renderTable(
      ["코스 이름", "종류", "시작 좌표", "경유지"],
      rows.slice(0, 5).map((r) => [
        r.name,
        r.kind ?? "-",
        r.start_lat === null ? "-" : `${r.start_lat.toFixed(4)}, ${r.start_lng?.toFixed(4)}`,
        String(r.detail.waypoints ?? "-").slice(0, 40),
      ]),
      ["left", "left", "left", "left"] as Align[],
    ),
  );

  if (dryRun) {
    console.log("");
    console.log("  --dry-run 이라 DB 에 쓰지 않았습니다.");
    console.log("");
    return;
  }

  // ── 4. 적재 ─────────────────────────────────────────────────────────────
  console.log(section("4. 적재"));

  let done = 0;
  for (const part of chunk(rows, 100)) {
    const { error } = await client.from("courses").upsert(part, { onConflict: "id" });
    if (error) exitWithNotice(`courses 적재에 실패했습니다: ${error.message}`, 4);
    done += part.length;
  }

  console.log("");
  console.log(`  적재 완료     ${num(done)}건 (courses, id 접두어 '${ID_PREFIX}-')`);
  console.log("");
  console.log("  이 표는 다트 풀이 아닙니다. dart_pool_stats 는 바뀌지 않습니다.");
  console.log("");
}

main().catch((e) => {
  console.log("");
  console.log("예상하지 못한 오류로 멈췄습니다.");
  console.log(`  ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
  console.log("");
  process.exit(1);
});
