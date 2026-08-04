/**
 * 신규 소스 정찰 — 부산시 오픈API 6종을 한 번씩만 호출해 규격을 확인합니다.
 *
 * 설계 정본: `API데이터설계.md` §3.5 / `AI 논의사항.md` §"부산명소정보 API 실측 확인"
 *
 * 무엇을 하는가
 * -------------
 * 6종을 `numOfRows=1` 로 **한 번씩(합계 6회)** 호출해 아래를 표로 출력합니다.
 *
 *   - `totalCount` (그 소스의 전체 건수)
 *   - 샘플 1건의 **필드 이름 전체와 값**
 *   - 좌표 필드 유무 · 구·군 필드 유무 · 분류 필드 유무
 *
 * 이 결과가 "맛집·축제·쇼핑을 다트 풀에 병합할지" 를 정하는 재료입니다.
 * 판단 자체는 하지 않습니다 — **관측값만 그대로 싣습니다.**
 *
 * 왜 필드 이름을 다 찍는가
 * -----------------------
 * 부산시 6종은 규격이 공통(`resultType=json` · `header.code="00"` · `{오퍼레이션}.item[]`)
 * 이지만 **필드 이름은 서비스마다 다릅니다.** 명소는 `PLACE`·`GUGUN_NM`·`LAT`/`LNG` 인데
 * 다른 서비스가 같은 이름을 쓴다는 보장이 없습니다. 매핑을 추측해서 적으면 백필이 조용히
 * 빈 값을 넣게 되므로, 먼저 눈으로 보고 매핑을 적습니다.
 *
 * 실행
 * ----
 *   npm run probe:sources
 *   npm run probe:sources -- --only=attraction,walking
 *   npm run probe:sources -- --rows=3 --full
 *
 * 옵션
 *   --only    쉼표로 구분한 소스 키 (attraction · walking · food · festival · shopping · visitorstat)
 *   --rows    샘플로 받을 건수 (기본 1)
 *   --full    값을 자르지 않고 전부 출력
 *   --delay   호출 사이 대기 ms (기본 300)
 */

import {
  BUSAN_API_BASE,
  BUSAN_SERVICES,
  BusanApiError,
  callBusanService,
  findService,
  type BusanEnvelope,
  type BusanServiceSpec,
} from "../../lib/busanapi.core";
import { checkEnv, describeMissing } from "../lib/env";
import {
  exitWithNotice,
  getNumber,
  getValue,
  hasFlag,
  heading,
  num,
  parseArgs,
  renderTable,
  section,
  type Align,
} from "../lib/cli";

/** 부산시 오픈API 일일 한도 (포털 표기값). 안내 문구에만 씁니다. */
const BUSAN_DAILY_LIMIT = 10_000;

/* ── 필드 성격 판정 ─────────────────────────────────────────────────────────
 * 이름만 보고 거는 **눈대중 표식**입니다. 백필 매핑의 근거가 아니라,
 * 표를 읽을 때 어디를 먼저 볼지 알려 주는 안내입니다.
 * 실제 매핑은 사람이 값을 보고 정합니다.
 * ──────────────────────────────────────────────────────────────────────── */

const COORD_PATTERN = /(^|_)(LAT|LNG|LON|LONGITUDE|LATITUDE|MAPX|MAPY|GPS|COORD|X|Y)($|_)/i;
const GUGUN_PATTERN = /(GUGUN|SIGUNGU|GUNGU|AREA|ADDR|LOCATION|SIDO)/i;
const CATEGORY_PATTERN = /(CATE|CAT\d|CTGRY|TYPE|CLASS|GUBUN|DIV|KIND|THEME)/i;
const NAME_PATTERN = /(^|_)(PLACE|TITLE|NAME|SUBJECT)($|_)/i;
const ID_PATTERN = /(SEQ|_ID$|^ID$|NO$|CODE$)/i;

type FieldKind = "좌표" | "구·군·주소" | "분류" | "이름" | "식별자" | "";

function kindOf(field: string): FieldKind {
  if (COORD_PATTERN.test(field)) return "좌표";
  if (CATEGORY_PATTERN.test(field)) return "분류";
  if (GUGUN_PATTERN.test(field)) return "구·군·주소";
  if (NAME_PATTERN.test(field)) return "이름";
  if (ID_PATTERN.test(field)) return "식별자";
  return "";
}

function shorten(value: unknown, full: boolean): string {
  if (value === null || value === undefined) return "(null)";
  if (typeof value === "object") return JSON.stringify(value).slice(0, full ? 4000 : 60);
  const s = String(value).replace(/\s+/g, " ").trim();
  if (s === "") return "(빈 문자열)";
  if (full || s.length <= 58) return s;
  return `${s.slice(0, 58)}…`;
}

interface ProbeOutcome {
  spec: BusanServiceSpec;
  ok: boolean;
  message?: string;
  envelope?: BusanEnvelope;
  fields: string[];
  coordFields: string[];
  gugunFields: string[];
  categoryFields: string[];
}

function collectFields(sample: Record<string, unknown> | undefined): {
  fields: string[];
  coord: string[];
  gugun: string[];
  category: string[];
} {
  const fields = sample ? Object.keys(sample) : [];
  return {
    fields,
    coord: fields.filter((f) => kindOf(f) === "좌표"),
    gugun: fields.filter((f) => GUGUN_PATTERN.test(f)),
    category: fields.filter((f) => kindOf(f) === "분류"),
  };
}

function describeError(e: unknown): string {
  if (!(e instanceof BusanApiError)) {
    return e instanceof Error ? e.message : String(e);
  }
  const guide: Record<string, string> = {
    missing_key: ".env.local 의 DATA_GO_KR_KEY 가 비어 있습니다.",
    network: "연결하지 못했습니다. 네트워크를 확인해 주세요.",
    http: "정상 상태 코드로 답하지 않았습니다.",
    not_json:
      "응답이 JSON 이 아닙니다. 이 오퍼레이션이 resultType=json 을 지원하지 않거나(XML 전용), 활용신청이 안 돼 있을 수 있습니다.",
    api_error: "포털·서비스가 오류로 답했습니다. 활용신청 상태와 파라미터를 확인해 주세요.",
  };
  const lines = [e.message, guide[e.reason] ?? ""];
  if (e.detail) lines.push(`응답 앞부분: ${e.detail.replace(/\s+/g, " ").slice(0, 180)}`);
  return lines.filter((l) => l !== "").join("\n      ");
}

async function main(): Promise<void> {
  const args = parseArgs();
  const rows = Math.max(1, Math.trunc(getNumber(args, "rows", 1)));
  const delayMs = Math.max(0, Math.trunc(getNumber(args, "delay", 300)));
  const full = hasFlag(args, "full");

  const onlyRaw = getValue(args, "only");
  let targets = BUSAN_SERVICES;
  if (onlyRaw) {
    const keys = onlyRaw.split(",").map((s) => s.trim()).filter((s) => s !== "");
    const picked: BusanServiceSpec[] = [];
    for (const key of keys) {
      const spec = findService(key);
      if (!spec) {
        exitWithNotice(
          [
            `'${key}' 라는 소스가 없습니다.`,
            "",
            "쓸 수 있는 값:",
            ...BUSAN_SERVICES.map((s) => `  ${s.key.padEnd(12)} ${s.label}`),
          ].join("\n"),
          2,
        );
      }
      picked.push(spec);
    }
    targets = picked;
  }

  console.log(heading("신규 소스 정찰 — 부산광역시 오픈API"));

  const env = checkEnv(["DATA_GO_KR_KEY"]);
  if (!env.ok) {
    exitWithNotice(
      [
        describeMissing(env.missing),
        "",
        "이 스크립트는 DB 없이 API 만으로 돌아갑니다. Supabase 값은 없어도 됩니다.",
      ].join("\n"),
      2,
    );
  }

  console.log("");
  console.log(`  기관 경로     ${BUSAN_API_BASE}`);
  console.log(`  호출 규격     resultType=json · header.code="00"(NORMAL_CODE) · {오퍼레이션}.item[]`);
  console.log(`  대상          ${num(targets.length)}종 · 각 numOfRows=${num(rows)} 1회 → 총 ${num(targets.length)}회 호출`);
  console.log(`  일일 한도     ${num(BUSAN_DAILY_LIMIT)}회 (부산시 표기)`);

  const outcomes: ProbeOutcome[] = [];

  for (let i = 0; i < targets.length; i += 1) {
    const spec = targets[i];
    console.log(section(`${i + 1}/${targets.length}. ${spec.label} — ${spec.path}`));
    if (spec.note) console.log(`  (사전 정보) ${spec.note}`);

    try {
      const envelope = await callBusanService(spec, { pageNo: 1, numOfRows: rows });
      const sample = envelope.items[0];
      const { fields, coord, gugun, category } = collectFields(sample);

      outcomes.push({
        spec,
        ok: true,
        envelope,
        fields,
        coordFields: coord,
        gugunFields: gugun,
        categoryFields: category,
      });

      console.log("");
      console.log(`  응답 루트     ${envelope.rootKey ?? "(찾지 못함)"}`);
      console.log(
        `  header        ${envelope.headerCode ?? "(없음)"} / ${envelope.headerMessage ?? "(없음)"}` +
          (envelope.headerPath ? `   경로: ${envelope.headerPath}` : ""),
      );
      console.log(
        `  totalCount    ${envelope.totalCount === null ? "(찾지 못함)" : num(envelope.totalCount)}` +
          (envelope.totalCountPath ? `   경로: ${envelope.totalCountPath}` : ""),
      );
      console.log(
        `  item 경로     ${envelope.itemPath ?? "(찾지 못함)"} · 이번 응답 ${num(envelope.items.length)}건`,
      );
      console.log(`  필드 수       ${num(fields.length)}`);

      if (!sample) {
        console.log("");
        console.log("  샘플이 한 건도 오지 않아 필드 목록을 만들지 못했습니다.");
        console.log("  추가 파라미터(연도 등)를 요구하는 오퍼레이션일 수 있습니다.");
      } else {
        console.log("");
        console.log("  샘플 1건의 필드 전체");
        console.log("");
        console.log(
          renderTable(
            ["필드", "성격", "값"],
            fields.map((f) => [f, kindOf(f) || "-", shorten(sample[f], full)]),
            ["left", "left", "left"] as Align[],
          ),
        );
      }

      console.log("");
      console.log(`  좌표 필드     ${coord.length > 0 ? coord.join(" · ") : "없음"}`);
      console.log(`  구·군/주소    ${gugun.length > 0 ? gugun.join(" · ") : "없음"}`);
      console.log(`  분류 필드     ${category.length > 0 ? category.join(" · ") : "없음"}`);
    } catch (e) {
      outcomes.push({
        spec,
        ok: false,
        message: describeError(e),
        fields: [],
        coordFields: [],
        gugunFields: [],
        categoryFields: [],
      });
      console.log("");
      console.log(`  실패: ${describeError(e)}`);
      console.log("  (다음 소스로 넘어갑니다 — 한 종이 막혀도 정찰 전체를 멈추지 않습니다)");
    }

    if (i < targets.length - 1 && delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  // ── 요약 ────────────────────────────────────────────────────────────────
  console.log(section("요약 — 6종 한눈에"));
  console.log("");
  console.log(
    renderTable(
      ["소스", "totalCount", "필드 수", "좌표", "구·군", "분류", "상태"],
      outcomes.map((o) => [
        o.spec.label,
        o.ok ? (o.envelope?.totalCount === null ? "?" : num(o.envelope!.totalCount!)) : "-",
        o.ok ? num(o.fields.length) : "-",
        o.coordFields.length > 0 ? o.coordFields.join("/") : o.ok ? "없음" : "-",
        o.gugunFields.length > 0 ? o.gugunFields.slice(0, 2).join("/") : o.ok ? "없음" : "-",
        o.categoryFields.length > 0 ? o.categoryFields.slice(0, 2).join("/") : o.ok ? "없음" : "-",
        o.ok ? "응답" : "실패",
      ]),
      ["left", "right", "right", "left", "left", "left", "left"] as Align[],
    ),
  );

  const okCount = outcomes.filter((o) => o.ok).length;
  const sumTotal = outcomes
    .filter((o) => o.ok && typeof o.envelope?.totalCount === "number")
    .reduce((acc, o) => acc + (o.envelope!.totalCount ?? 0), 0);

  console.log("");
  console.log(`  응답한 소스   ${num(okCount)} / ${num(outcomes.length)}`);
  console.log(`  건수 합계     ${num(sumTotal)} (응답한 소스의 totalCount 단순 합 — 중복 미제거)`);
  console.log("");
  console.log("  이 표는 관측값입니다. 어느 소스를 다트 풀에 병합할지는 사용자 결정 사항입니다.");
  console.log("  좌표·구·군이 없는 소스는 그 자체로는 다트 대상이 될 수 없습니다(장소로 세울 수 없음).");
  console.log("");
}

main().catch((e) => {
  console.log("");
  console.log("예상하지 못한 오류로 멈췄습니다.");
  console.log(`  ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
  console.log("");
  process.exit(1);
});
