/**
 * 백필 01 — 부산 16개 구·군 마스터 적재.
 *
 * 설계 정본: `API데이터설계.md` §6.2 · §5.3(`sigungu`) / `ARCHITECTURE.md` §5
 *
 * 왜 먼저 도는가
 * -------------
 * `places.sigungu_code` 가 `sigungu(code)` 를 참조하는 **not null 외래키**입니다.
 * 이 표가 비어 있으면 03·04 백필이 한 행도 들어가지 못합니다. 그래서 이 스크립트가
 * 백필의 첫 단계입니다.
 *
 * 코드를 지어내지 않습니다
 * ----------------------
 * 구·군 코드는 하드코딩하지 않고 관광공사 `areaCode2` 응답으로 채웁니다(§6.2).
 * 다만 `places.sigungu_code` 에 들어가는 **내부 코드는 관광공사 숫자 코드가 아니라
 * 사람이 읽는 slug**(`yeongdo` 등)입니다. 출처가 여러 개라 소스별 코드를 그대로 쓰면
 * 부산명소(`GUGUN_NM` 한글)와 관광공사(`sigungucode` 숫자)가 같은 구를 다른 키로
 * 가리키게 됩니다(BUSAN-3). 그래서 이름을 slug 하나로 모으고, 소스별 코드는
 * `tour_api_sigungu_code` 같은 별도 칸에 남겨 둡니다.
 *
 * 이미 있는 행의 좌표는 건드리지 않습니다
 * ------------------------------------
 * `center_lat` · `center_lng` 는 not null 인데 `areaCode2` 응답에 좌표가 없습니다.
 * 처음에는 부산 기준점 하나를 넣어 두고, 장소 적재가 끝난 뒤 `--recenter` 로
 * 그 구·군에 속한 장소들의 평균 좌표로 덮어씁니다. 재실행이 recenter 결과를
 * 되돌리지 않도록, 기존 행에는 이름·소스 코드만 갱신합니다.
 *
 * 실행
 * ----
 *   npm run backfill:sigungu
 *   npm run backfill:sigungu -- --recenter     # 장소 적재 후 중심 좌표 재계산
 *   npm run backfill:sigungu -- --dry-run
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  BUSAN_AREA_CODE,
  TourApiError,
  fetchAreaCodeList,
} from "../../lib/tourapi.core";
import {
  BUSAN_REFERENCE_POINT,
  BUSAN_SIGUNGU_COUNT,
  SIGUNGU_SLUG_BY_NAME,
  slugForSigungu,
} from "../lib/busan";
import { loadEnv } from "../lib/env";
import { requireDb, selectAll } from "../lib/db";
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

interface SigunguRow {
  code: string;
  name: string;
  tour_api_area_code: string | null;
  tour_api_sigungu_code: string | null;
  center_lat: number;
  center_lng: number;
}

/**
 * `selectAll` 의 filter 콜백은 조회 빌더를 그대로 받습니다.
 * 빌더 타입이 제네릭이라 그대로는 `.is` 가 보이지 않아, 쓰는 메서드만 좁혀 씁니다.
 */
type NullFilter = { is(column: string, value: null): unknown };

async function recenter(client: SupabaseClient): Promise<void> {
  console.log(section("중심 좌표 재계산 (--recenter)"));

  const places = await selectAll<{ sigungu_code: string; lat: number; lng: number }>(
    client,
    "places",
    "sigungu_code, lat, lng",
    { filter: (q) => (q as unknown as NullFilter).is("deleted_at", null) },
  );

  if (places.length === 0) {
    console.log("  places 가 비어 있어 재계산할 것이 없습니다. 장소 백필을 먼저 돌려 주세요.");
    return;
  }

  const acc = new Map<string, { lat: number; lng: number; n: number }>();
  for (const p of places) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
    const cur = acc.get(p.sigungu_code) ?? { lat: 0, lng: 0, n: 0 };
    cur.lat += p.lat;
    cur.lng += p.lng;
    cur.n += 1;
    acc.set(p.sigungu_code, cur);
  }

  const rows: string[][] = [];
  for (const [code, v] of acc) {
    const lat = v.lat / v.n;
    const lng = v.lng / v.n;
    const { error } = await client
      .from("sigungu")
      .update({ center_lat: lat, center_lng: lng })
      .eq("code", code);
    rows.push([
      code,
      num(v.n),
      lat.toFixed(5),
      lng.toFixed(5),
      error ? `실패: ${error.message}` : "갱신",
    ]);
  }

  console.log("");
  console.log(
    renderTable(
      ["구·군 코드", "장소 수", "중심 위도", "중심 경도", "결과"],
      rows.sort((a, b) => a[0].localeCompare(b[0])),
      ["left", "right", "right", "right", "left"] as Align[],
    ),
  );
}

async function main(): Promise<void> {
  const args = parseArgs();
  const dryRun = hasFlag(args, "dry-run");

  console.log(heading("백필 01 — 구·군 마스터 (sigungu)"));

  const client = requireDb();

  if (hasFlag(args, "recenter")) {
    await recenter(client);
    console.log("");
    return;
  }

  // ── 1. areaCode2 ────────────────────────────────────────────────────────
  console.log(section("1. 구·군 목록 조회 (areaCode2)"));

  let areas: Array<{ code: string; name: string }> = [];
  try {
    areas = await fetchAreaCodeList();
  } catch (e) {
    const detail = e instanceof TourApiError ? `${e.message} (${e.reason})` : String(e);
    exitWithNotice(
      [
        `구·군 목록을 받지 못했습니다: ${detail}`,
        "",
        "구·군 코드는 지어내지 않습니다. 이 호출이 성공해야 백필을 시작할 수 있습니다.",
        "서비스키(DATA_GO_KR_KEY)와 KorService2 활용신청 상태를 확인해 주세요.",
      ].join("\n"),
      3,
    );
  }

  console.log(`  areaCode ${BUSAN_AREA_CODE} (부산) → ${num(areas.length)}개`);
  if (areas.length !== BUSAN_SIGUNGU_COUNT) {
    console.log(
      `  (참고) 부산은 ${BUSAN_SIGUNGU_COUNT}개입니다. 받은 수가 다르면 아래 표를 확인해 주세요.`,
    );
  }

  const unknown = areas.filter((a) => !(a.name.trim() in SIGUNGU_SLUG_BY_NAME));
  if (unknown.length > 0) {
    console.log("");
    console.log(
      `  (주의) slug 표에 없는 이름 ${num(unknown.length)}건 — ` +
        `\`bs-<코드>\` 로 들어갑니다: ${unknown.map((u) => `${u.name}(${u.code})`).join(" · ")}`,
    );
  }

  // ── 2. 기존 행 ──────────────────────────────────────────────────────────
  const existing = await selectAll<{ code: string }>(client, "sigungu", "code");
  const existingCodes = new Set(existing.map((r) => r.code));
  console.log(`  DB 기존 행    ${num(existingCodes.size)}건`);

  const rows: SigunguRow[] = areas.map((a) => ({
    code: slugForSigungu(a.name, a.code),
    name: a.name.trim(),
    tour_api_area_code: BUSAN_AREA_CODE,
    tour_api_sigungu_code: a.code,
    center_lat: BUSAN_REFERENCE_POINT.lat,
    center_lng: BUSAN_REFERENCE_POINT.lng,
  }));

  const toInsert = rows.filter((r) => !existingCodes.has(r.code));
  const toUpdate = rows.filter((r) => existingCodes.has(r.code));

  console.log("");
  console.log(
    renderTable(
      ["내부 코드", "이름", "관광공사 코드", "처리"],
      rows.map((r) => [
        r.code,
        r.name,
        r.tour_api_sigungu_code ?? "-",
        existingCodes.has(r.code) ? "이름·코드만 갱신" : "신규",
      ]),
      ["left", "left", "right", "left"] as Align[],
    ),
  );

  if (dryRun) {
    console.log("");
    console.log(`  --dry-run 이라 쓰지 않았습니다. 신규 ${num(toInsert.length)} · 갱신 ${num(toUpdate.length)}`);
    console.log("");
    return;
  }

  // ── 3. 적재 ─────────────────────────────────────────────────────────────
  console.log(section("2. 적재"));

  if (toInsert.length > 0) {
    const { error } = await client.from("sigungu").insert(toInsert);
    if (error) {
      exitWithNotice(`sigungu 적재에 실패했습니다: ${error.message}`, 4);
    }
  }

  // 기존 행은 중심 좌표를 건드리지 않습니다 (--recenter 결과 보존).
  for (const r of toUpdate) {
    const { error } = await client
      .from("sigungu")
      .update({
        name: r.name,
        tour_api_area_code: r.tour_api_area_code,
        tour_api_sigungu_code: r.tour_api_sigungu_code,
      })
      .eq("code", r.code);
    if (error) console.log(`  ${r.code} 갱신 실패: ${error.message}`);
  }

  const after = await selectAll<{ code: string }>(client, "sigungu", "code");

  console.log("");
  console.log(`  신규 적재     ${num(toInsert.length)}건`);
  console.log(`  이름·코드 갱신 ${num(toUpdate.length)}건`);
  console.log(`  현재 행 수    ${num(after.length)} (부산 ${BUSAN_SIGUNGU_COUNT})`);
  console.log("");
  console.log("  중심 좌표는 아직 부산 기준점 하나입니다. 장소 적재 후");
  console.log("  `npm run backfill:sigungu -- --recenter` 로 실제 평균 좌표로 바꿉니다.");
  console.log("");
}

main().catch((e) => {
  console.log("");
  console.log("예상하지 못한 오류로 멈췄습니다.");
  console.log(`  ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
  console.log("");
  process.exit(1);
});
