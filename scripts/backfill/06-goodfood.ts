/**
 * 백필 06 — 행정안전부 모범음식점 → `places.is_good_restaurant` 매칭.
 *
 * 설계 정본: `API데이터설계.md` §3.7 · §6.2 / `AI 논의사항.md` §D-11 · §D-26
 *
 * 무엇을 하는가
 * ------------
 *   1. 모범음식점 전국 원본을 받아 **부산 · 지금 유효한 지정**만 남깁니다
 *   2. 원본에 좌표가 없어서, 도로명주소를 **카카오 로컬 API 로 좌표로** 바꿉니다
 *   3. §3.7 규칙(반경 50m + 상호명 정규화 일치)으로 `places` 의 식도락 장소와 맞춥니다
 *   4. 맞은 곳은 `is_good_restaurant = true`, 이번에 맞지 않은 곳은 `false` 로 되돌립니다
 *
 * 배지는 표시 전용입니다 (`D-11`)
 * -------------------------------
 * 이 스크립트가 건드리는 컬럼은 `is_good_restaurant` 하나뿐입니다. `theme` · `status` ·
 * `dart_pool_stats` 어느 것도 손대지 않으므로 **다트에 뽑힐 확률과 순서가 바뀌지 않습니다.**
 * 배지가 붙은 가게가 더 자주 나오거나 앞에 오는 일이 없어야 한다는 것이 `D-11` 이고,
 * `D-26` 이 더한 것은 배지의 용도 설명(위생·안전을 "걸러내기"가 아니라 "알려주기")뿐입니다.
 *
 * 왜 되돌리기(`false`)까지 하는가
 * ------------------------------
 * 지정은 **풀립니다.** 부산 원본 2,960건 중 2,600건에 이미 철회일자가 있습니다.
 * 붙이기만 하고 떼지 않으면, 한 번 붙은 배지가 지정이 풀린 뒤에도 화면에 남습니다.
 * 그래서 매번 **전건을 다시 계산**하고 이번에 맞지 않은 곳은 되돌립니다.
 *
 * `sync_runs` 에 남기지 않습니다
 * -----------------------------
 * `sync_runs.source` 는 `place_source` 열거형(`tourapi`·`busan_attraction`·`heritage`·
 * `seed`·`user`)이라 모범음식점을 가리킬 값이 없습니다. 열거형에 값을 더하는 것은 스키마
 * 변경(§5.3)이라 이번 작업 범위 밖입니다. 다른 출처 이름을 빌려 적으면 그 출처의 적재
 * 이력이 오염되므로, 실행 결과는 아래 콘솔 리포트로만 남깁니다.
 *
 * 실행
 * ----
 *   npm run backfill:goodfood -- --dry-run    # DB 에 쓰지 않고 무엇이 붙을지만 봅니다
 *   npm run backfill:goodfood
 *   npm run backfill:goodfood -- --refresh    # 캐시를 무시하고 포털에서 다시 받습니다
 *   npm run backfill:goodfood -- --radius=100 # 반경을 바꿔 비교 (기본 50m, §3.7)
 *   npm run backfill:goodfood -- --samples=40
 */

import {
  GOODFOOD_MAX_ROWS,
  GOODFOOD_URL,
  GoodFoodError,
  MATCH_RADIUS_M,
  fetchGoodFoodPage,
  isActiveDesignation,
  isBusanAddress,
  matchBadge,
  readGoodRestaurant,
  type GoodRestaurant,
  type MatchKind,
  type MatchResult,
} from "../../lib/goodfood.core";
import { isInBusanBox } from "../lib/busan";
import { loadEnv, checkEnv, describeMissing } from "../lib/env";
import { chunk, requireDb, selectAll } from "../lib/db";
import {
  GeocodeCache,
  ageInDays,
  hasKakaoKey,
  readRoster,
  tidyAddressForSearch,
  writeRoster,
} from "../lib/kakao";
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

/** 원본 목록 캐시를 이 날수보다 오래 두지 않습니다. 지정 변동이 느려 주 1회면 충분합니다(§3.7). */
const ROSTER_MAX_AGE_DAYS = 7;
const ROSTER_FILE = "goodfood-busan.json";
const GEO_FILE = "goodfood-geo.json";

/** `selectAll` 이 넘겨주는 질의 객체 — `05-detail.ts` 와 같은 모양입니다. */
interface QueryChain {
  eq(column: string, value: string | boolean): QueryChain;
  is(column: string, value: null): QueryChain;
}

interface PlaceLite {
  id: string;
  name: string;
  lat: number;
  lng: number;
  address: string | null;
  sigungu_code: string;
  is_good_restaurant: boolean;
}

const KIND_LABEL: Record<MatchKind, string> = {
  name: "이름 일치",
  branch: "지점 표기",
};

/* ── 1. 원본 수집 ────────────────────────────────────────────────────────── */

async function collectBusanRoster(refresh: boolean): Promise<{
  rows: GoodRestaurant[];
  calls: number;
  fromCache: boolean;
  fetchedAt: string | null;
  nationwide: number;
}> {
  if (!refresh) {
    const cached = readRoster<GoodRestaurant>(ROSTER_FILE);
    if (cached && ageInDays(cached.fetchedAt) <= ROSTER_MAX_AGE_DAYS) {
      return {
        rows: cached.items,
        calls: 0,
        fromCache: true,
        fetchedAt: cached.fetchedAt,
        nationwide: 0,
      };
    }
  }

  const first = await fetchGoodFoodPage(1, GOODFOOD_MAX_ROWS);
  const total = first.totalCount;
  const pages = Math.max(1, Math.ceil(total / GOODFOOD_MAX_ROWS));

  console.log(`  전국 ${num(total)}건 · ${num(pages)}페이지 (한 번에 ${GOODFOOD_MAX_ROWS}건이 상한)`);

  const busan: GoodRestaurant[] = [];
  let calls = 0;
  let seen = 0;

  const take = (items: Record<string, unknown>[]) => {
    for (const raw of items) {
      seen += 1;
      const g = readGoodRestaurant(raw);
      if (g && isBusanAddress(g)) busan.push(g);
    }
  };

  take(first.items);
  calls += 1;

  for (let page = 2; page <= pages; page += 1) {
    let ok = false;
    for (let attempt = 1; attempt <= 3 && !ok; attempt += 1) {
      try {
        const body = await fetchGoodFoodPage(page, GOODFOOD_MAX_ROWS);
        calls += 1;
        take(body.items);
        ok = true;
      } catch (e) {
        calls += 1;
        const detail = e instanceof GoodFoodError ? `${e.message} (${e.reason})` : String(e);
        console.log(`  ${page}페이지 재시도 ${attempt}/3 — ${detail}`);
        await new Promise((r) => setTimeout(r, 500 * attempt));
      }
    }
    if (!ok) console.log(`  ${page}페이지를 받지 못했습니다 — 그 100건은 이번 결과에서 빠집니다`);
    if (page % 100 === 0) {
      console.log(`  ${num(page)}/${num(pages)} 페이지 · 훑은 ${num(seen)} · 부산 ${num(busan.length)}`);
    }
  }

  writeRoster(ROSTER_FILE, busan);
  return { rows: busan, calls, fromCache: false, fetchedAt: new Date().toISOString(), nationwide: seen };
}

/* ── 본체 ────────────────────────────────────────────────────────────────── */

async function main(): Promise<void> {
  const args = parseArgs();
  const dryRun = hasFlag(args, "dry-run");
  const refresh = hasFlag(args, "refresh");
  const radius = Math.max(1, getNumber(args, "radius", MATCH_RADIUS_M));
  const sampleCap = Math.max(1, Math.trunc(getNumber(args, "samples", 30)));

  console.log(heading("백필 06 — 모범음식점 → places.is_good_restaurant"));

  const portal = checkEnv(["DATA_GO_KR_KEY"]);
  if (!portal.ok) exitWithNotice(describeMissing(portal.missing), 2);
  if (!hasKakaoKey()) {
    exitWithNotice(
      [
        "카카오 REST 키(KAKAO_REST_KEY)가 설정되지 않았습니다.",
        "",
        "  모범음식점 원본에는 좌표가 없어, 도로명주소를 좌표로 바꿔야 §3.7 의",
        "  '50m 이내 + 상호명 일치' 규칙을 쓸 수 있습니다.",
        "  발급: https://developers.kakao.com > 내 애플리케이션 > 앱 키 > REST API 키",
      ].join("\n"),
      2,
    );
  }

  const client = requireDb();

  console.log("");
  console.log(`  요청주소      ${GOODFOOD_URL}`);
  console.log(`  매칭 반경     ${num(radius)}m ${radius === MATCH_RADIUS_M ? "(§3.7)" : "(§3.7 기본값 50m 에서 바꿈)"}`);

  // ── 1. 원본 ───────────────────────────────────────────────────────────────
  console.log(section("1. 모범음식점 원본"));

  let roster;
  try {
    roster = await collectBusanRoster(refresh);
  } catch (e) {
    const detail = e instanceof GoodFoodError ? `${e.message} (${e.reason})` : String(e);
    exitWithNotice(`모범음식점 원본을 받지 못했습니다: ${detail}`, 3);
  }

  if (roster.fromCache) {
    const age = ageInDays(roster.fetchedAt ?? "");
    console.log(`  캐시 사용     ${num(roster.rows.length)}건 · ${age.toFixed(1)}일 전 수집 (다시 받으려면 --refresh)`);
  } else {
    console.log(`  포털 호출     ${num(roster.calls)}회 · 훑은 ${num(roster.nationwide)}건`);
  }

  const active = roster.rows.filter(isActiveDesignation);
  const revoked = roster.rows.filter((g) => g.revokedOn !== null).length;
  const closed = roster.rows.filter((g) => g.closedOn !== null).length;

  console.log("");
  console.log(
    renderTable(
      ["구분", "건수"],
      [
        ["부산 전체", num(roster.rows.length)],
        ["  지정 철회됨", num(revoked)],
        ["  폐업", num(closed)],
        ["지금 유효한 지정", num(active.length)],
      ],
      ["left", "right"] as Align[],
    ),
  );
  console.log("");
  console.log("  철회·폐업분을 빼지 않으면 지금은 모범음식점이 아닌 곳에 배지가 붙습니다.");

  if (active.length === 0) {
    exitWithNotice("유효한 모범음식점이 한 곳도 없습니다. 원본 필드를 확인해 주세요.", 3);
  }

  // ── 2. 좌표 채우기 ────────────────────────────────────────────────────────
  console.log(section("2. 도로명주소 → 좌표 (카카오 로컬)"));

  const cache = new GeocodeCache(GEO_FILE);
  const geoFailed: string[] = [];
  let outOfBox = 0;

  for (const g of active) {
    const queries = [tidyAddressForSearch(g.roadAddress), tidyAddressForSearch(g.lotAddress)];
    const hit = await cache.lookup(g.mngNo, queries);
    if (!hit.ok) {
      if (hit.reason === "no_key" || hit.reason === "network") {
        cache.save();
        exitWithNotice(`카카오 로컬 API 호출이 막혔습니다 (${hit.reason}). ${hit.detail ?? ""}`, 3);
      }
      geoFailed.push(`${g.name}(${g.roadAddress ?? g.lotAddress ?? "주소 없음"})`);
      continue;
    }
    if (!isInBusanBox(hit.lat, hit.lng)) {
      // 주소에 '부산'이 들어갔지만 좌표가 부산 밖 — 동명 지명에 걸린 경우입니다.
      outOfBox += 1;
      geoFailed.push(`${g.name}(좌표가 부산 밖: ${hit.lat.toFixed(4)}, ${hit.lng.toFixed(4)})`);
      continue;
    }
    g.lat = hit.lat;
    g.lng = hit.lng;
    if (cache.calls > 0 && cache.calls % 100 === 0) cache.save();
  }
  cache.save();

  const located = active.filter((g) => g.lat !== null && g.lng !== null);
  console.log("");
  console.log(
    renderTable(
      ["구분", "건수"],
      [
        ["좌표를 얻은 곳", num(located.length)],
        ["좌표를 못 얻은 곳", num(geoFailed.length)],
        ["  (그중 좌표가 부산 밖)", num(outOfBox)],
        ["이번 실행 카카오 호출", num(cache.calls)],
        ["캐시로 해결", num(cache.hits)],
      ],
      ["left", "right"] as Align[],
    ),
  );
  if (geoFailed.length > 0) {
    console.log("");
    console.log(`  좌표를 못 얻은 곳 표본 — 이 가게들은 배지 대상에서 빠집니다`);
    console.log(`    ${geoFailed.slice(0, 8).join(" · ")}`);
  }

  // ── 3. 대상 장소 ──────────────────────────────────────────────────────────
  console.log(section("3. 배지를 붙일 대상 장소"));

  // 대상 = 화면에 노출되는 식도락 장소. `D-11` 이 음식점 모수를 관광공사 `contentTypeId=39`
  // 로 한정했고, 그 모수가 곧 `theme='food'` 로 들어와 있습니다(§4.3).
  const foodPlaces = await selectAll<PlaceLite>(
    client,
    "places",
    "id, name, lat, lng, address, sigungu_code, is_good_restaurant",
    {
      orderBy: "id",
      filter: (q) =>
        (q as unknown as QueryChain)
          .eq("theme", "food")
          .eq("status", "published")
          .is("deleted_at", null),
    },
  );
  const targets = foodPlaces.filter((p) => p.lat !== null && p.lng !== null);

  // 이번에 대상이 아닌데 배지가 켜져 있는 행까지 찾아 되돌립니다 (테마·상태가 바뀐 장소 등).
  const badgedElsewhere = await selectAll<{ id: string; name: string }>(
    client,
    "places",
    "id, name",
    {
      orderBy: "id",
      filter: (q) => (q as unknown as QueryChain).eq("is_good_restaurant", true),
    },
  );

  console.log("");
  console.log(`  식도락 테마 장소   ${num(targets.length)}곳`);
  console.log(`  지금 배지가 켜진 행 ${num(badgedElsewhere.length)}곳`);

  // ── 4. 매칭 ───────────────────────────────────────────────────────────────
  console.log(section("4. 매칭"));

  const matched: { place: PlaceLite; result: MatchResult }[] = [];
  const nearMiss: { place: PlaceLite; near: string[] }[] = [];
  const usedByGood = new Map<string, string[]>();

  for (const p of targets) {
    const result = matchBadge(
      { name: p.name, lat: p.lat, lng: p.lng, address: p.address },
      located,
      radius,
    );
    if (result) {
      matched.push({ place: p, result });
      const list = usedByGood.get(result.good.mngNo) ?? [];
      list.push(p.name);
      usedByGood.set(result.good.mngNo, list);
      continue;
    }
    // 반경 안에 뭔가 있었는데 이름이 어긋난 경우만 검토 목록에 올립니다.
    const near = located
      .filter((g) => g.lat !== null && g.lng !== null)
      .map((g) => ({ g, d: haversine(p.lat, p.lng, g.lat as number, g.lng as number) }))
      .filter((c) => c.d <= radius)
      .sort((a, b) => a.d - b.d)
      .map((c) => `${c.g.name}(${c.d.toFixed(0)}m)`);
    if (near.length > 0) nearMiss.push({ place: p, near });
  }

  const byKind = { name: 0, branch: 0 } as Record<MatchKind, number>;
  for (const m of matched) byKind[m.result.kind] += 1;

  console.log("");
  console.log(
    renderTable(
      ["구분", "건수"],
      [
        ["식도락 장소", num(targets.length)],
        ["유효 모범음식점(좌표 있음)", num(located.length)],
        ["배지가 붙은 곳", num(matched.length)],
        [`  ${KIND_LABEL.name} (반경 ${radius}m + 상호명 일치)`, num(byKind.name)],
        [`  ${KIND_LABEL.branch} (반경 ${radius}m + 도로명주소 일치 + 이름 포함)`, num(byKind.branch)],
        ["붙지 않은 곳", num(targets.length - matched.length)],
        ["  그중 반경 안에 후보는 있었던 곳", num(nearMiss.length)],
      ],
      ["left", "right"] as Align[],
    ),
  );

  console.log(section("5. 배지가 붙은 곳 전건"));
  console.log("");
  console.log(
    renderTable(
      ["거리", "장소 (places)", "모범음식점 (원본)", "주된 음식", "지정일", "근거"],
      matched
        .sort((a, b) => a.result.distanceM - b.result.distanceM)
        .map((m) => [
          `${m.result.distanceM.toFixed(0)}m`,
          m.place.name,
          m.result.good.name,
          m.result.good.foodKind ?? "-",
          m.result.good.designatedOn ?? "-",
          KIND_LABEL[m.result.kind],
        ]),
      ["right", "left", "left", "left", "left", "left"] as Align[],
    ),
  );

  const doubled = [...usedByGood.entries()].filter(([, v]) => v.length > 1);
  if (doubled.length > 0) {
    console.log("");
    console.log("  (확인) 한 모범음식점이 여러 장소에 붙었습니다 — 같은 가게가 두 번 적재됐는지 보십시오");
    for (const [mngNo, names] of doubled) console.log(`    ${mngNo} → ${names.join(" · ")}`);
  }

  console.log(section("6. 붙이지 않은 근접 후보 — 사람이 볼 목록"));
  console.log("");
  console.log("  반경 안에 모범음식점이 있었지만 이름 규칙에 걸리지 않아 **붙이지 않은** 것들입니다.");
  console.log("  같은 건물에 다른 가게가 있는 경우가 실제로 있어, 억지로 붙이지 않습니다.");
  console.log("");
  if (nearMiss.length === 0) {
    console.log("  없습니다.");
  } else {
    console.log(
      renderTable(
        ["장소 (places)", "반경 안 모범음식점"],
        nearMiss.slice(0, sampleCap).map((n) => [n.place.name, n.near.join(", ")]),
      ),
    );
    if (nearMiss.length > sampleCap) {
      console.log("");
      console.log(`  ... 외 ${num(nearMiss.length - sampleCap)}곳 (--samples 로 더 볼 수 있습니다)`);
    }
  }

  if (dryRun) {
    console.log("");
    console.log("  --dry-run 이라 DB 에 쓰지 않았습니다.");
    console.log("");
    return;
  }

  // ── 7. 반영 ───────────────────────────────────────────────────────────────
  console.log(section("7. 반영"));

  const onIds = new Set(matched.map((m) => m.place.id));
  const turnOn = matched.filter((m) => !m.place.is_good_restaurant).map((m) => m.place.id);
  const turnOff = badgedElsewhere.filter((p) => !onIds.has(p.id)).map((p) => p.id);

  try {
    for (const part of chunk(turnOn, 100)) {
      const { error } = await client.from("places").update({ is_good_restaurant: true }).in("id", part);
      if (error) throw new Error(error.message);
    }
    for (const part of chunk(turnOff, 100)) {
      const { error } = await client.from("places").update({ is_good_restaurant: false }).in("id", part);
      if (error) throw new Error(error.message);
    }
  } catch (e) {
    exitWithNotice(`반영에 실패했습니다: ${e instanceof Error ? e.message : String(e)}`, 4);
  }

  console.log("");
  console.log(
    renderTable(
      ["구분", "건수"],
      [
        ["새로 켠 배지", num(turnOn.length)],
        ["되돌린 배지 (지정이 풀렸거나 이번에 안 맞음)", num(turnOff.length)],
        ["이미 켜져 있어 그대로 둔 것", num(matched.length - turnOn.length)],
        ["반영 후 배지 총계", num(matched.length)],
      ],
      ["left", "right"] as Align[],
    ),
  );

  // 반영 확인 — 쓴 값을 다시 읽습니다.
  const after = await selectAll<{ id: string; name: string }>(client, "places", "id, name", {
    orderBy: "id",
    filter: (q) => (q as unknown as QueryChain).eq("is_good_restaurant", true),
  });
  console.log("");
  console.log(`  DB 재확인     is_good_restaurant = true 인 행 ${num(after.length)}곳`);
  console.log(`  표본          ${after.slice(0, 6).map((p) => p.name).join(" · ")}`);
  console.log("");
}

/** 근접 후보 표를 만들 때만 쓰는 거리 계산. 판정은 `lib/goodfood.core.ts` 안에서 합니다. */
function haversine(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6_371_008.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

main().catch((e) => {
  console.log("");
  console.log("예상하지 못한 오류로 멈췄습니다.");
  console.log(`  ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
  console.log("");
  process.exit(1);
});
