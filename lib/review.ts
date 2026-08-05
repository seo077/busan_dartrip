/**
 * S4-후기 — 서버 쪽 본체 (검증 · 적재).
 *
 * 설계 정본: `화면구성도.md` §6.2(후기 작성 시트) · §6.3-9·10 · §6.4(후기 등록 실패 · 사진 초과)
 *            `사용자플로우.md` F5 후기 흐름 · §분기 처리
 *            `API데이터설계.md` §5.3(`reviews` DDL) · §5.8(RLS — 쓰기는 API Route 경유) · §8
 *            `D-12`(다녀왔어요 + 한 줄 + 사진 1장, 별점 없음) · `D-9`(로그인 없음) · AD-11
 *
 * 이 파일이 지키는 것 하나
 * -----------------------
 * **넣을 수 있는 값이 세 개뿐입니다** — 장소 · 한 줄 · 사진. 점수·추천·좋아요를 받을 자리가
 * 없고, `reviews` 테이블에도 그런 컬럼이 없습니다(§5.4 · AD-6). 후기는 순위 데이터가 아니라
 * 흔적입니다. 컬럼이 없으면 언젠가 누가 정렬에 쓰는 일이 일어나지 않습니다.
 *
 * 한 줄과 사진은 **둘 다 선택**입니다(§6.2). 아무것도 넣지 않은 "다녀왔어요" 한 번도 그대로
 * 저장됩니다 — 기록의 문턱을 낮춰 표본이 적은 장소에도 흔적이 남게 하려는 것입니다.
 *
 * 작성자
 * ------
 * `author_ref` 는 출처 무관 문자열입니다(`D-9` · AD-11). 지금은 브라우저가 만든 `anon:<uuid>`
 * 가 들어오고, 카카오 로그인이 붙으면 `kakao:<id>` 로 **값만** 바뀝니다. 스키마도 이 파일도
 * 그때 고칠 것이 없습니다.
 *
 * 한 기기는 한 장소에 한 번
 * -------------------------
 * 같은 `author_ref` 가 같은 장소에 이미 후기를 남겼으면 새로 쓰지 못합니다. "다녀왔어요" 는
 * 한 장소에 여러 번 쌓을 성격이 아니고, 로그인이 없는 v1(`D-9`)에서 도배를 막을 손잡이가
 * 기기 식별값뿐이기 때문입니다. 지우면 초기화되는 값이라 **완전한 차단이 아니라 문턱**이며,
 * 그 이상은 v1 범위 밖입니다(`D-8` 과 같은 간이판 철학 — 지우기는 콘솔 수동).
 *
 * 화면도 같은 규칙으로 작성 버튼을 감추지만, 판정은 여기서 한 번 더 합니다 — 브라우저를
 * 거치지 않고 이 경로로 바로 들어오는 요청이 있기 때문입니다.
 *
 * 그리고 **마지막 판정은 DB 가 합니다** — 아래 조회는 읽는 순간과 쓰는 순간이 떨어져 있어,
 * 같은 기기의 POST 두 건이 동시에 오면 둘 다 "없다" 를 읽고 둘 다 씁니다(더블탭). 조회로는
 * 못 막는 틈이라 `reviews_place_author_uidx` 부분 유니크 인덱스를 두고
 * (`supabase/migrations/20260805210000_reviews_unique_author.sql`), 인덱스에 걸린 삽입도
 * **같은 `duplicate`** 로 받아 넘깁니다. 두 층의 답이 같아야 화면이 한 가지 안내만 알면
 * 됩니다. 인덱스가 아직 적용되지 않은 DB 에서도 조회 쪽 판정이 그대로 동작합니다.
 *
 * 인덱스 조건(`author_ref <> 'anon:unknown'`)은 아래 `isIdentifiable()` 의 경계와 같은
 * 값입니다. 한쪽만 고치면 화면·서버·DB 의 답이 갈립니다.
 *
 * 서버 전용입니다. `server-only` 가 붙어 있어 클라이언트 컴포넌트가 import 하면 빌드가
 * 그 자리에서 멈춥니다(service_role 키 유출 차단).
 */

import "server-only";

import { getServiceClient, supabaseStatus } from "@/lib/supabase";
import { isOwnPhotoUrl } from "@/lib/submit";

// ── 입력 규칙 (§6.2 · §5.3) ──────────────────────────────────────────────────

/** 한 줄의 길이 상한. `reviews.body` 의 `check (char_length(body) <= 60)` 과 같은 값입니다 */
export const REVIEW_BODY_MAX = 60;

/** 작성자 식별자 모양 — `lib/submit.ts` 의 등록자 규칙과 같습니다 (AD-11) */
const AUTHOR_PATTERN = /^[a-z]{1,16}:[A-Za-z0-9._:-]{1,128}$/;

/**
 * 기기 저장소를 못 쓰는 브라우저(시크릿 모드 일부·차단 설정)에서 오는 값.
 * `author_ref` 는 not null 이므로 빈 값 대신 이 값을 넣습니다 — 기록을 막지 않기 위해서입니다.
 */
const ANONYMOUS_REF = "anon:unknown";

/**
 * 작성자 식별값이 **한 사람을 가리키는지** 봅니다.
 *
 * `anon:unknown` 은 저장소를 못 쓰는 브라우저가 모두 같이 쓰는 값이라 기기 하나가 아닙니다.
 * 이 값에까지 1회 제한을 걸면 서로 남남인 사용자들이 서로의 기록을 막게 되므로 제외합니다
 * (기록의 문턱을 낮춘다는 §6.2 의 결정과 같은 쪽입니다). 이 값을 흉내 내면 제한을 피할 수
 * 있지만, 기기 식별값 자체가 지우면 초기화되는 값이라 어차피 완전한 차단은 아닙니다.
 */
function isIdentifiable(authorRef: string): boolean {
  return authorRef !== ANONYMOUS_REF && AUTHOR_PATTERN.test(authorRef);
}

/** 부분 유니크 인덱스 이름. 마이그레이션 `20260805210000_reviews_unique_author.sql` 와 같은 값입니다. */
const UNIQUE_INDEX = "reviews_place_author_uidx";

/** Postgres 의 unique_violation. 인덱스에 걸린 삽입은 이 코드로 옵니다. */
const UNIQUE_VIOLATION = "23505";

/**
 * 이 삽입 오류가 "이미 남겼다" 인가.
 *
 * `23505` 만으로 판정하지 않고 **인덱스 이름까지** 봅니다. `reviews` 에는 기본키도 유니크라,
 * 코드만 보면 성격이 다른 충돌까지 "이미 남기셨어요" 로 답하게 됩니다. 우리가 만든 그
 * 인덱스에 걸렸을 때만 중복으로 다루고, 나머지는 그대로 오류로 올려보냅니다.
 */
function isDuplicateInsert(error: { code?: string; message?: string; details?: string } | null) {
  if (!error || error.code !== UNIQUE_VIOLATION) return false;
  return `${error.message ?? ""} ${error.details ?? ""}`.includes(UNIQUE_INDEX);
}

/**
 * 이 작성자가 이 장소에 이미 후기를 남겼는지.
 *
 * 화면(작성 버튼 자리)과 적재(POST)가 같은 판단을 쓰도록 한 곳에 둡니다.
 */
export async function hasDeviceReview(placeId: string, authorRef: string): Promise<boolean> {
  if (!isIdentifiable(authorRef)) return false;

  requireConfig();

  const { data, error } = await getServiceClient()
    .from("reviews")
    .select("id")
    .eq("place_id", placeId)
    .eq("author_ref", authorRef)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new ReviewError("db_error", "이전 기록을 확인하지 못했습니다.", error.message);
  }

  return data !== null;
}

export class ReviewError extends Error {
  readonly reason: "missing_config" | "db_error";
  readonly detail?: string;

  constructor(reason: "missing_config" | "db_error", message: string, detail?: string) {
    super(message);
    this.name = "ReviewError";
    this.reason = reason;
    this.detail = detail;
  }
}

function requireConfig(): void {
  const status = supabaseStatus();
  if (!status.hasUrl || !status.hasServiceKey) {
    throw new ReviewError(
      "missing_config",
      "데이터베이스 설정이 아직 없습니다.",
      "`.env.local` 의 NEXT_PUBLIC_SUPABASE_URL · SUPABASE_SERVICE_ROLE_KEY 를 채워 주세요.",
    );
  }
}

export interface ReviewInput {
  body: string | null;
  photoUrl: string | null;
  authorRef: string;
}

export type ReviewField = "body" | "photo";

export type ParseReviewResult =
  | { ok: true; input: ReviewInput }
  | { ok: false; field: ReviewField; message: string };

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * 요청 본문을 §6.2 규칙에 맞춰 다듬습니다.
 *
 * 화면도 같은 규칙으로 글자 수를 자르지만 화면의 판정을 믿지 않습니다 — 브라우저를 거치지
 * 않고 이 경로로 바로 들어오는 요청이 있을 수 있기 때문입니다(`lib/submit.ts` 와 같은 이유).
 */
export function parseReview(payload: unknown): ParseReviewResult {
  const raw = (payload ?? {}) as Record<string, unknown>;

  const bodyRaw = asString(raw.body);
  if (bodyRaw.length > REVIEW_BODY_MAX) {
    return { ok: false, field: "body", message: `한 줄은 ${REVIEW_BODY_MAX}자까지예요.` };
  }

  const photoRaw = asString(raw.photoUrl);
  if (photoRaw !== "" && !isOwnPhotoUrl(photoRaw)) {
    return { ok: false, field: "photo", message: "사진을 다시 올려 주세요." };
  }

  const authorRaw = asString(raw.authorRef);

  return {
    ok: true,
    input: {
      body: bodyRaw === "" ? null : bodyRaw,
      photoUrl: photoRaw === "" ? null : photoRaw,
      authorRef: AUTHOR_PATTERN.test(authorRaw) ? authorRaw : ANONYMOUS_REF,
    },
  };
}

// ── 적재 ─────────────────────────────────────────────────────────────────────

export interface CreatedReview {
  id: string;
  body: string | null;
  photoPath: string | null;
  createdAt: string;
}

export type CreateReviewOutcome =
  | { kind: "created"; review: CreatedReview }
  | { kind: "not_found" }
  | { kind: "duplicate" };

/**
 * 후기 1건.
 *
 * 붙일 장소가 **공개된 장소인지 먼저 봅니다.** 승인 대기(`pending`)·미분류(`unclassified`)
 * 장소는 S4 를 열 수 없으므로(§6.4 "미승인") 그 장소에 후기가 붙을 경로도 두지 않습니다.
 * 없는 장소와 같게 다뤄 `not_found` 를 돌려줍니다.
 *
 * `photo_path` 에는 우리 Storage 의 공개 URL 이 그대로 들어갑니다. `places.first_image` 가
 * 같은 형태로 URL 을 들고 있고(S5), 화면은 그 값을 이미지 주소로 바로 씁니다 — 받아들이는
 * 자리를 우리 버킷 하나로 좁히는 검사(`isOwnPhotoUrl`)도 등록과 같은 것을 씁니다.
 *
 * 장소를 확인한 다음 **이미 남긴 기록이 있는지**를 봅니다(`duplicate`). 없는 장소를 두고
 * "이미 남기셨다" 고 답하지 않으려고 순서를 이렇게 둡니다.
 *
 * 그 조회를 통과했더라도 **삽입이 인덱스에 걸리면 같은 `duplicate`** 입니다 — 조회와 삽입
 * 사이에 다른 요청이 먼저 쓴 경우입니다(파일 머리말 §"한 기기는 한 장소에 한 번"). 어느
 * 쪽으로 걸리든 Route 는 `409 duplicate` 하나로 답합니다.
 */
export async function createReview(
  placeId: string,
  input: ReviewInput,
): Promise<CreateReviewOutcome> {
  requireConfig();

  const db = getServiceClient();

  const { data: place, error: placeError } = await db
    .from("places")
    .select("id")
    .eq("id", placeId)
    .eq("status", "published")
    .is("deleted_at", null)
    .maybeSingle();

  if (placeError) {
    throw new ReviewError("db_error", "장소를 확인하지 못했습니다.", placeError.message);
  }
  if (!place) return { kind: "not_found" };

  if (await hasDeviceReview(placeId, input.authorRef)) return { kind: "duplicate" };

  const { data, error } = await db
    .from("reviews")
    .insert({
      place_id: placeId,
      author_ref: input.authorRef,
      body: input.body,
      photo_path: input.photoUrl,
    })
    .select("id,body,photo_path,created_at")
    .single();

  // 조회를 통과하고도 인덱스에 걸렸다면, 조회와 삽입 사이에 다른 요청이 먼저 쓴 것입니다.
  // 사용자에게는 위 사전 조회에 걸린 것과 구분할 이유가 없는 같은 상황입니다.
  if (isDuplicateInsert(error)) return { kind: "duplicate" };

  if (error || !data) {
    throw new ReviewError(
      "db_error",
      "저장하지 못했어요.",
      error?.message ?? "적재 결과가 비어 있습니다.",
    );
  }

  return {
    kind: "created",
    review: {
      id: data.id as string,
      body: (data.body as string | null) ?? null,
      photoPath: (data.photo_path as string | null) ?? null,
      createdAt: data.created_at as string,
    },
  };
}
