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
  | { kind: "not_found" };

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
