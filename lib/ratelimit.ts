/**
 * 익명 공개 경로의 소모형 자원 상한 (DF-4).
 *
 * 설계 정본: `API데이터설계.md` §11(무료 티어 방어) · §8(Route 목록) · §5.6(스토리지)
 *            `ARCHITECTURE.md` §8 `R-7`(Storage 1GB) · `R-4`(무료 티어 정지) · `AD-16`
 *            `supabase/migrations/20260806100000_rate_limits.sql` (표·함수)
 *
 * 어디에 걸고 어디에 안 거는가
 * ----------------------------
 * 익명으로 열려 있는 경로는 여섯이지만 상한을 거는 것은 **셋**입니다. 기준은 하나입니다 —
 * **이미 DB 를 건드리는 경로에만 겁니다.**
 *
 * | 경로 | 무엇을 태우나 | 방어 |
 * |---|---|---|
 * | `POST /api/upload` | Storage 1GB — **되돌아오지 않음** | 상한 (본 파일) |
 * | `POST /api/places` | DB 행 — **되돌아오지 않음** | 상한 (본 파일) |
 * | `GET /api/places/:id/enrich` | 관광공사 일 한도 — 하루 뒤 회복 | 상한 (본 파일) + 7일 캐시 |
 * | `GET /api/tour` | 관광공사 일 한도 — 하루 뒤 회복 | 응답 캐시 |
 * | `GET /api/geo/*` | 카카오 일 한도 — 하루 뒤 회복 | 응답 캐시 |
 * | `POST /api/places/:id/reviews` | DB 행 | 한 기기·한 장소 1회 (DB 유니크 인덱스) |
 *
 * `geo` 2종에 상한을 걸지 않은 것은 봐주는 것이 아니라 **그 경로가 DB 를 전혀 안 쓰기
 * 때문**입니다. 상한을 걸면 카카오 호출을 아끼려고 DB 쓰기를 새로 만드는 셈이 되어, 지키려던
 * 무료 티어를 다른 쪽에서 깎습니다. 그 자리는 응답 캐시로 흡수합니다.
 *
 * 못 막는 것을 적어 둡니다
 * ------------------------
 * IP 단위라 **주소를 바꿔 가며 부르면 그만큼 통과**합니다. 로그인이 없는 v1(`D-9`)에서 IP 는
 * 쓸 수 있는 가장 안정적인 단위이고, 그 이상은 사람을 식별하는 일이라 범위 밖입니다.
 * 이것은 벽이 아니라 **문턱**이며, 노리는 것은 "주소를 아는 사람이 무심코, 또는 한 대의
 * 기계로 반복해서" 무료 티어를 태우는 경우입니다.
 *
 * 판정 못 하면 통과시킵니다 (fail open)
 * -------------------------------------
 * 마이그레이션 미실행 · DB 장애 · 설정 미완 — 어느 경우에도 **요청을 막지 않습니다.**
 * 방어 장치가 서비스를 세우면 그것이 곧 `SC-7`(심사 기간 상시 접속) 위반이고, 막으려던
 * 사고보다 확실하게 나쁩니다. 대신 통과시킨 사실을 응답 헤더 `x-ratelimit: unavailable` 로
 * 드러내 조용히 뚫려 있는 상태가 생기지 않게 합니다.
 */

import "server-only";

import { getServiceClient, supabaseStatus } from "@/lib/supabase";

export type LimitBucket = "upload" | "place_submit" | "enrich";

interface Window {
  seconds: number;
  limit: number;
  label: string;
}

const HOUR = 3_600;
const DAY = 86_400;

/**
 * 상한 값 (`M-R1-2`).
 *
 * 잡은 근거 — **정상 사용자가 닿을 일이 없고, 자원 한도에는 닿기 전에 걸리는 값**입니다.
 *  - `upload` 사진 1MB × 일 60 = 하루 60MB. Storage 1GB 를 한 주소가 태우는 데 17일 걸립니다.
 *    등록·후기 흐름은 한 번에 사진 1장이라 정상 사용은 시간당 한 자릿수입니다.
 *  - `place_submit` 은 사람이 지도에 핀을 찍고 이름을 적는 작업이라 시간당 10 이면 넉넉합니다.
 *  - `enrich` 는 화면(S4)이 쓰지 않는 규격 확인용 창구입니다(그 화면은 서버에서 직접 읽습니다).
 *    일 200 이면 캐시 미적중이 전부라도 외부 호출이 관광공사 일 한도 1,000 아래에 머뭅니다.
 */
const RULES: Record<LimitBucket, Window[]> = {
  upload: [
    { seconds: HOUR, limit: 20, label: "시간당" },
    { seconds: DAY, limit: 60, label: "하루" },
  ],
  place_submit: [
    { seconds: HOUR, limit: 10, label: "시간당" },
    { seconds: DAY, limit: 30, label: "하루" },
  ],
  enrich: [
    { seconds: HOUR, limit: 60, label: "시간당" },
    { seconds: DAY, limit: 200, label: "하루" },
  ],
};

export interface LimitVerdict {
  /** 통과시킬 것인가. 판정 불가일 때도 true 입니다 (fail open) */
  allowed: boolean;
  /** 판정이 실제로 이뤄졌는가. false = 표·함수가 없거나 DB 를 못 읽음 */
  enforced: boolean;
  /** 걸렸을 때 다시 시도할 수 있기까지의 초 */
  retryAfterSeconds: number;
  /** 어느 창에 걸렸는지 (사람이 읽는 말) */
  window: string | null;
}

const PASS: LimitVerdict = {
  allowed: true,
  enforced: true,
  retryAfterSeconds: 0,
  window: null,
};

const UNAVAILABLE: LimitVerdict = {
  allowed: true,
  enforced: false,
  retryAfterSeconds: 0,
  window: null,
};

/**
 * 요청자를 가리키는 값.
 *
 * `x-real-ip` 를 먼저 봅니다 — Vercel 이 직접 채우는 값이라 보내는 쪽이 흉내 낼 수 없습니다.
 * `x-forwarded-for` 는 **맨 뒤**를 씁니다. 앞쪽은 요청자가 적어 넣을 수 있고 뒤로 갈수록
 * 우리 쪽 프록시가 붙인 값이라, 앞을 믿으면 헤더 한 줄로 상한을 피할 수 있습니다.
 */
export function clientKey(request: Request): string {
  const real = request.headers.get("x-real-ip")?.trim();
  if (real) return `ip:${real}`;

  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const parts = forwarded
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
    if (parts.length > 0) return `ip:${parts[parts.length - 1]}`;
  }

  // 배포 환경에서는 위 둘 중 하나가 항상 옵니다. 여기에 떨어지는 것은 로컬 실행뿐입니다.
  return "ip:unknown";
}

/**
 * 한 번 쓰고 판정합니다. 창이 여럿이면 **짧은 것부터** 봅니다.
 *
 * 짧은 창에서 이미 걸렸으면 긴 창은 세지 않습니다 — 막힌 요청까지 일 누적에 넣으면
 * 한 번 걸린 사람이 그날 내내 못 쓰게 됩니다.
 */
export async function consume(bucket: LimitBucket, request: Request): Promise<LimitVerdict> {
  const status = supabaseStatus();
  if (!status.hasUrl || !status.hasServiceKey) return UNAVAILABLE;

  let db;
  try {
    db = getServiceClient();
  } catch {
    return UNAVAILABLE;
  }

  const subject = clientKey(request);

  for (const window of RULES[bucket]) {
    const { data, error } = await db.rpc("consume_rate_limit", {
      p_bucket: bucket,
      p_subject: subject,
      p_window_seconds: window.seconds,
      p_limit: window.limit,
    });

    // 함수가 없으면(마이그레이션 미실행) 여기로 옵니다. 막지 않고 통과시킵니다.
    if (error) return UNAVAILABLE;

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return UNAVAILABLE;

    const verdict = row as {
      is_allowed: boolean;
      hit_count: number;
      retry_after_seconds: number;
    };

    if (!verdict.is_allowed) {
      return {
        allowed: false,
        enforced: true,
        retryAfterSeconds: Math.max(1, verdict.retry_after_seconds),
        window: `${window.label} ${window.limit}회`,
      };
    }
  }

  return PASS;
}

/** 상한에 걸린 요청의 공통 응답. 화면이 안내 문구를 그대로 쓸 수 있게 합니다 */
export function limitResponseBody(verdict: LimitVerdict): {
  ok: false;
  reason: "rate_limited";
  message: string;
  detail: string;
  retryAfter: number;
} {
  const minutes = Math.max(1, Math.ceil(verdict.retryAfterSeconds / 60));
  return {
    ok: false,
    reason: "rate_limited",
    message: "잠시 뒤에 다시 시도해 주세요.",
    detail: `짧은 시간에 요청이 너무 많았습니다 (${verdict.window ?? "상한"}). 약 ${minutes}분 뒤에 다시 됩니다.`,
    retryAfter: verdict.retryAfterSeconds,
  };
}

/** 응답에 붙일 헤더. 판정이 실제로 섰는지를 밖에서 확인할 수 있게 합니다 */
export function limitHeaders(verdict: LimitVerdict): Record<string, string> {
  if (!verdict.enforced) return { "x-ratelimit": "unavailable" };
  if (verdict.allowed) return { "x-ratelimit": "ok" };
  return { "x-ratelimit": "blocked", "Retry-After": String(verdict.retryAfterSeconds) };
}
