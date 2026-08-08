/**
 * 로그인 — 아이디+비밀번호를 받아 Supabase Auth 로 넘기고, 세션을 쿠키에 둡니다.
 *
 * 설계 정본: `ARCHITECTURE.md` `AD-19`(합성 이메일 · 쿠키 세션) · `AD-20`(작성자 식별값)
 *            `화면구성도.md` §14(S7 가입·로그인) · §14.7(상태)
 *            `API데이터설계.md` §5.8(RLS — 값을 정하는 자리는 서버) · §11.4(`DF-5`)
 *            `D-46-2`~`D-46-8` · `R-17`(복구 절차 없음) · `R-18`(인증 경로 남용)
 *
 * 화면은 아이디만 받고, 여기서 도메인을 붙입니다
 * --------------------------------------------
 * **Supabase Auth 에는 아이디라는 개념이 없습니다** — `email` 또는 `phone` 만 받습니다.
 * 그래서 `<아이디>@<고정 도메인>` 을 만들어 넘깁니다. 사용자 눈에는 아이디와 비밀번호뿐이고
 * **메일은 0통**입니다(확인 메일 차단은 Supabase 대시보드 설정 — 사용자 영역).
 *
 * 이렇게 하면 **수집 항목이 아이디·비밀번호(암호화) 2건으로 끝납니다**(`D-46-4`).
 * 실제로 받지 않는 이메일이라 어디에도 보내지 않고, 되찾기 경로도 없습니다(`R-17` — 감수).
 *
 * 도메인을 `.local` 로 둔 이유 (실측으로 정한 값)
 * ----------------------------------------------
 * 처음에는 **`.invalid`** 로 잡았습니다 — 표준이 *"이 이름은 절대 실존하지 않는다"* 고 못
 * 박아 둔 최상위 도메인이라(RFC 2606) 남이 가져갈 수 없기 때문입니다. **그런데 Supabase 가
 * 받지 않습니다** (2026-08-08 실측):
 *
 *   `probe@dartrip.invalid` → `email_address_invalid` — "Email address … is invalid"
 *   `probe@dartrip.local`   → 형식 검사 통과
 *
 * 그래서 `.local` 을 씁니다. **공인 인터넷에서 배달되지 않는 이름**이라는 성질은 같고,
 * 우리는 어차피 이 주소로 메일을 보내지 않습니다. 값을 고르는 기준은 "메일이 갈 곳이 없을
 * 것" 과 "Supabase 가 받을 것" 둘이며, 두 번째는 **추정이 아니라 실측으로만 알 수 있는
 * 조건**이었습니다.
 *
 * ★ 확인 메일이 켜져 있으면 가입이 서지 않습니다
 * ----------------------------------------------
 * 같은 실측에서 두 번째 사실이 나왔습니다 — 형식 검사를 통과한 주소도
 * **`over_email_send_rate_limit`** 로 떨어집니다. Supabase 가 **확인 메일을 보내려 하기
 * 때문**이고, 그 주소는 받는 곳이 없습니다. 즉 **대시보드에서 확인 메일을 꺼야 이 경로가
 * 동작합니다**(`AD-19` 가 예고한 "`D-46` 후속 3, 사용자 영역").
 * 추적 = `PROGRESS.md` §남은 작업.
 *
 * 세션을 쿠키에 두는 이유
 * ----------------------
 * 스탬프판·아카이빙은 **서버에서 그려 DB 를 직접 읽는 화면**입니다(결과·상세와 같은 구조).
 * 세션이 브라우저 저장소에만 있으면 서버가 "누구인지" 를 알 수 없습니다. 기존
 * `lib/supabase.ts` 의 두 클라이언트는 `persistSession: false` 라 그대로 두고, 여기에
 * 쿠키를 읽고 쓰는 클라이언트를 따로 세웁니다.
 *
 * 신원을 브라우저에서 받지 않습니다
 * -------------------------------
 * 방문·후기의 `author_ref` 는 **여기서 읽은 세션 값**으로 정합니다(④ §5.8). 브라우저가 보낸
 * `authorRef` 를 로그인 경로에서 그대로 믿으면 **아무나 남의 계정으로 방문을 남길 수 있습니다.**
 * 값을 정하는 자리는 한 곳(서버)이어야 합니다.
 *
 * 서버 전용입니다.
 */

import "server-only";

import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

import { supabaseStatus } from "@/lib/supabase";

// ── 입력 규칙 (§14.4 · §14.7) ────────────────────────────────────────────────

/** 영문·숫자 4~20자 (§14.2 입력 안내와 같은 값) */
export const ID_PATTERN = /^[A-Za-z0-9]{4,20}$/;

/** 8자 이상 (§14.3). 복구 수단이 없으므로 길이 말고는 강제하지 않습니다 */
export const PASSWORD_MIN = 8;

/**
 * 합성 이메일의 고정 도메인 (위 머리말 — 실측으로 정한 값).
 *
 * **이 값을 바꾸면 기존 계정으로 로그인할 수 없게 됩니다** — 아이디에서 이메일을 만드는
 * 규칙이 곧 계정의 열쇠입니다. 바꿔야 한다면 기존 계정을 함께 옮겨야 합니다.
 */
const AUTH_EMAIL_DOMAIN = "dartrip.local";

/**
 * 아이디 → Supabase Auth 가 받는 이메일.
 *
 * **소문자로 접습니다** — 이메일은 대소문자를 구분하지 않는 쪽으로 다뤄지는 값이라,
 * 접지 않으면 `Hong` 과 `hong` 이 같은 계정인지 다른 계정인지가 Supabase 쪽 처리에 달리게
 * 됩니다. 우리가 먼저 하나로 정합니다.
 */
export function toAuthEmail(username: string): string {
  return `${username.trim().toLowerCase()}@${AUTH_EMAIL_DOMAIN}`;
}

export type CredentialField = "username" | "password" | "passwordConfirm";

export type CredentialCheck =
  | { ok: true; username: string; password: string }
  | { ok: false; field: CredentialField; message: string };

/**
 * 아이디·비밀번호를 §14.7 규칙으로 봅니다.
 *
 * 화면도 같은 규칙으로 검사하지만 **화면의 판정을 믿지 않습니다** — 브라우저를 거치지 않고
 * 이 경로로 바로 들어오는 요청이 있습니다(`lib/review.ts`·`lib/submit.ts` 와 같은 이유).
 */
export function checkCredentials(
  payload: unknown,
  options: { withConfirm: boolean },
): CredentialCheck {
  const raw = (payload ?? {}) as Record<string, unknown>;
  const username = typeof raw.username === "string" ? raw.username.trim() : "";
  const password = typeof raw.password === "string" ? raw.password : "";

  if (!ID_PATTERN.test(username)) {
    return { ok: false, field: "username", message: "아이디는 영문·숫자 4~20자예요." };
  }
  if (password.length < PASSWORD_MIN) {
    return { ok: false, field: "password", message: `비밀번호는 ${PASSWORD_MIN}자 이상이에요.` };
  }
  if (options.withConfirm) {
    const confirm = typeof raw.passwordConfirm === "string" ? raw.passwordConfirm : "";
    if (confirm !== password) {
      return { ok: false, field: "passwordConfirm", message: "비밀번호가 서로 달라요." };
    }
  }

  return { ok: true, username, password };
}

// ── 세션 ─────────────────────────────────────────────────────────────────────

/**
 * 쿠키 세션 클라이언트.
 *
 * **쓰기가 막히는 자리가 있습니다** — 서버 컴포넌트에서는 쿠키를 못 씁니다(응답 헤더가 이미
 * 나갔을 수 있습니다). 그 경우 조용히 넘깁니다. 토큰 갱신은 Route 쪽 호출에서 일어나고,
 * 화면은 읽기만 하면 되기 때문입니다.
 */
export async function getSessionClient(): Promise<SupabaseClient> {
  const store = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll: (list) => {
          try {
            for (const { name, value, options } of list) store.set(name, value, options);
          } catch {
            // 서버 컴포넌트에서 부른 경우입니다. 읽기에는 영향이 없습니다.
          }
        },
      },
    },
  );
}

export interface CurrentUser {
  /** Supabase Auth 의 uid */
  id: string;
  /** 화면에 보이는 아이디 */
  username: string;
  /** `reviews.author_ref` · `places.submitted_by` 에 들어갈 값 (`AD-20`) */
  authorRef: string;
}

/** `user:<auth uid>` — 출처 접두를 붙인 작성자 식별값 (`AD-20` · `AD-11`) */
export function authorRefFor(userId: string): string {
  return `user:${userId}`;
}

/**
 * 지금 요청의 로그인 사용자. 없으면 `null`.
 *
 * `getUser()` 를 씁니다 — `getSession()` 은 쿠키에 담긴 값을 그대로 돌려주므로 **위조된
 * 쿠키를 그대로 믿게 됩니다.** `getUser()` 는 Supabase 에 물어 토큰을 검증합니다.
 *
 * **설정이 없으면 조용히 비로그인으로 답합니다** — 로그인은 선택 기능이고(`D-46-3`),
 * 환경변수가 덜 갖춰진 상태에서 다트까지 죽는 쪽이 더 나쁩니다(§14.7 "설정 미완").
 */
export async function readCurrentUser(): Promise<CurrentUser | null> {
  const status = supabaseStatus();
  if (!status.hasUrl || !status.hasAnonKey) return null;

  try {
    const supabase = await getSessionClient();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return null;

    const meta = (data.user.user_metadata ?? {}) as { username?: unknown };
    const username =
      typeof meta.username === "string" && meta.username !== ""
        ? meta.username
        : (data.user.email ?? "").split("@")[0];

    return { id: data.user.id, username, authorRef: authorRefFor(data.user.id) };
  } catch {
    return null;
  }
}

/** 로그인이 준비된 상태인가 (§14.7 "설정 미완" 판정) */
export function authReady(): boolean {
  const status = supabaseStatus();
  return status.hasUrl && status.hasAnonKey;
}

/**
 * 로그인 뒤 돌아갈 곳.
 *
 * **우리 화면 안의 경로만 받습니다** — `//evil.example` 이나 절대 주소를 그대로 쓰면
 * 로그인 화면이 남의 사이트로 보내는 통로가 됩니다(open redirect).
 */
export function safeNext(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  if (raw.length > 200) return null;
  return raw;
}
