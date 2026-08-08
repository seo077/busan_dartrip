"use client";

/**
 * S7 — 가입 · 로그인 폼 (§14.2 · §14.3).
 *
 * 설계 정본: `화면구성도.md` §14.2(로그인) · §14.3(가입) · §14.4(구성 요소) · §14.7(상태) · §14.8(전이)
 *            `ARCHITECTURE.md` `AD-19` · `R-17`(복구 절차 없음)
 *
 * 되돌릴 수 없는 것은 누르기 전에 읽힙니다
 * --------------------------------------
 * 가입 화면의 세 안내(복구 불가 · 미승계 · 수집 항목)는 **가입 버튼 위**에 있습니다(§14.3).
 * 완료 화면에서 알리면 이미 늦습니다. 이 배치가 이 화면의 핵심입니다.
 *
 * 보기 토글은 장식이 아닙니다
 * --------------------------
 * 비밀번호를 되찾을 방법이 없으므로(`R-17` — 사용자 결정으로 감수) **오타를 스스로 확인할 수
 * 있어야** 합니다(§14.4-2).
 *
 * 검증 실패에도 버튼을 살려 둡니다
 * -------------------------------
 * §14.7 그대로입니다 — 눌러야 서버 판정도 볼 수 있습니다. 화면이 조용히 막아 버리면 사용자는
 * 무엇이 문제인지 모른 채 멈춥니다.
 *
 * 되돌아갈 길을 항상 보여 줍니다
 * -----------------------------
 * `그냥 둘러보기`(§14.4-7) — **로그인이 막다른 길이 되지 않게** 하는 자리입니다. 로그인은
 * 선택이고(`D-46-3`) 다트는 로그인 없이 그냥 됩니다.
 */

import { useCallback, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

const ID_PATTERN = /^[A-Za-z0-9]{4,20}$/;
const PASSWORD_MIN = 8;

type Mode = "login" | "signup";

interface Failure {
  field: "username" | "password" | "passwordConfirm" | null;
  message: string;
  /** 상한(429)은 틀린 비밀번호와 구분해 보여 줍니다 (§14.7 "상한 도달") */
  retryAfterMinutes?: number;
}

export function AuthForm({ mode, next }: { mode: Mode; next: string | null }) {
  const router = useRouter();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);

  const isSignup = mode === "signup";

  // 화면 쪽 규칙 — 서버가 같은 규칙으로 한 번 더 봅니다(`lib/auth.ts` `checkCredentials`).
  const idBad = username !== "" && !ID_PATTERN.test(username);
  const passwordBad = password !== "" && password.length < PASSWORD_MIN;
  const confirmBad = isSignup && confirm !== "" && confirm !== password;

  const submit = useCallback(async () => {
    setBusy(true);
    setFailure(null);
    try {
      const res = await fetch(isSignup ? "/api/auth/signup" : "/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isSignup ? { username, password, passwordConfirm: confirm } : { username, password },
        ),
      });
      const body = (await res.json()) as {
        ok?: boolean;
        reason?: string;
        field?: Failure["field"];
        message?: string;
        retryAfter?: number;
      };

      if (body?.ok) {
        // §14.8 — 원래 가려던 화면이 있으면 그곳으로, 없으면 스탬프판으로.
        router.replace(next ?? "/stamps");
        router.refresh();
        return;
      }

      if (body?.reason === "rate_limited") {
        setFailure({
          field: null,
          message: "시도가 너무 잦아요. 잠시 뒤에 다시 해 주세요.",
          retryAfterMinutes: Math.max(1, Math.ceil((body.retryAfter ?? 60) / 60)),
        });
        return;
      }

      setFailure({
        field: body?.field ?? null,
        message: body?.message ?? "잠시 뒤에 다시 시도해 주세요.",
      });
    } catch {
      setFailure({ field: null, message: "연결을 확인해 주세요." });
    } finally {
      setBusy(false);
    }
  }, [confirm, isSignup, next, password, router, username]);

  const fieldError = (field: Failure["field"]) =>
    failure && failure.field === field ? failure.message : null;

  return (
    <section className="px-5 pb-12">
      {/* ── 아이디 ─────────────────────────────────────────────────────── */}
      <h2 className="mb-2 text-sm font-semibold text-[#98A2B3]">아이디</h2>
      <input
        type="text"
        value={username}
        onChange={(e) => setUsername(e.target.value.slice(0, 20))}
        autoComplete="username"
        maxLength={20}
        className="min-h-12 w-full rounded-2xl border border-white/10 bg-[#171B22] px-4 text-[#F2F4F7] placeholder:text-[#98A2B3]/60"
        placeholder="영문·숫자 4~20자"
      />
      {isSignup ? <p className="mt-1 text-xs text-[#98A2B3]">영문·숫자 4~20자</p> : null}
      {idBad ? <p className="mt-1 text-xs text-[#FF9B9B]">영문·숫자 4~20자로 적어 주세요.</p> : null}
      {fieldError("username") ? (
        <p className="mt-1 text-xs text-[#FF9B9B]">{fieldError("username")}</p>
      ) : null}

      {/* ── 비밀번호 ───────────────────────────────────────────────────── */}
      <h2 className="mt-6 mb-2 text-sm font-semibold text-[#98A2B3]">비밀번호</h2>
      <div className="relative">
        <input
          type={reveal ? "text" : "password"}
          value={password}
          onChange={(e) => setPassword(e.target.value.slice(0, 200))}
          autoComplete={isSignup ? "new-password" : "current-password"}
          className="min-h-12 w-full rounded-2xl border border-white/10 bg-[#171B22] px-4 pr-14 text-[#F2F4F7]"
        />
        <button
          type="button"
          onClick={() => setReveal((v) => !v)}
          aria-label={reveal ? "비밀번호 가리기" : "비밀번호 보기"}
          aria-pressed={reveal}
          className="absolute right-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full text-[#98A2B3]"
        >
          {reveal ? "🙈" : "👁"}
        </button>
      </div>
      {isSignup ? <p className="mt-1 text-xs text-[#98A2B3]">8자 이상</p> : null}
      {passwordBad ? <p className="mt-1 text-xs text-[#FF9B9B]">8자 이상으로 적어 주세요.</p> : null}
      {fieldError("password") ? (
        <p className="mt-1 text-xs text-[#FF9B9B]">{fieldError("password")}</p>
      ) : null}

      {/* ── 비밀번호 확인 (가입만) ─────────────────────────────────────── */}
      {isSignup ? (
        <>
          <h2 className="mt-6 mb-2 text-sm font-semibold text-[#98A2B3]">비밀번호 확인</h2>
          <input
            type={reveal ? "text" : "password"}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value.slice(0, 200))}
            autoComplete="new-password"
            className="min-h-12 w-full rounded-2xl border border-white/10 bg-[#171B22] px-4 text-[#F2F4F7]"
          />
          {confirmBad ? <p className="mt-1 text-xs text-[#FF9B9B]">비밀번호가 서로 달라요.</p> : null}
          {fieldError("passwordConfirm") ? (
            <p className="mt-1 text-xs text-[#FF9B9B]">{fieldError("passwordConfirm")}</p>
          ) : null}

          {/* ── 복구 불가 경고 (§14.3 · `D-46-5`) — 버튼 위 ─────────────── */}
          <div className="mt-6 rounded-2xl border border-[#FF4D4D]/40 bg-[#FF4D4D]/10 p-4">
            <p className="text-sm leading-relaxed break-keep text-[#F2F4F7]">
              ⚠ 비밀번호를 잊으면 되찾을 수 없습니다.
            </p>
            <p className="mt-1 text-xs leading-relaxed break-keep text-[#98A2B3]">
              이메일을 받지 않아서 재설정 메일을 보낼 곳이 없습니다.
            </p>
          </div>

          {/* ── 수집 항목 · 미승계 (§14.3 · `D-46-4`·`D-46-8`) ──────────── */}
          <ul className="mt-4 space-y-2 text-xs leading-relaxed break-keep text-[#98A2B3]">
            <li>· 가입할 때 받는 것은 아이디와 비밀번호뿐입니다. 이메일·이름·프로필을 받지 않습니다.</li>
            <li>· 남용을 막기 위해 접속 주소를 잠깐 기록했다가 약 2일 뒤 지웁니다.</li>
            <li>· 로그인 전에 남긴 후기와 등록은 이 계정으로 옮겨지지 않습니다.</li>
          </ul>
        </>
      ) : null}

      {/* ── 제출 ───────────────────────────────────────────────────────── */}
      <button
        type="button"
        onClick={() => void submit()}
        disabled={busy}
        className="mt-8 min-h-14 w-full rounded-2xl bg-[#FF4D4D] text-base font-semibold text-white disabled:bg-white/10 disabled:text-[#98A2B3]"
      >
        {busy ? (isSignup ? "가입하는 중…" : "들어가는 중…") : isSignup ? "가입하고 시작" : "로그인"}
      </button>

      {failure && failure.field === null ? (
        <p className="mt-3 text-center text-sm break-keep text-[#FF9B9B]">
          {failure.message}
          {failure.retryAfterMinutes ? ` (약 ${failure.retryAfterMinutes}분)` : ""}
        </p>
      ) : null}

      {isSignup ? (
        <p className="mt-3 text-center text-xs text-[#98A2B3]">
          가입하면{" "}
          <Link href="/privacy?from=signup" className="underline underline-offset-2">
            개인정보 처리방침
          </Link>
          에 동의하는 것으로 봅니다.
        </p>
      ) : (
        <p className="mt-6 text-center text-sm text-[#98A2B3]">
          아직 계정이 없나요?{" "}
          <Link
            href={next ? `/signup?next=${encodeURIComponent(next)}` : "/signup"}
            className="text-[#F2F4F7] underline underline-offset-2"
          >
            가입하기 →
          </Link>
        </p>
      )}

      {/* ── 되돌아갈 길 (§14.4-7) ──────────────────────────────────────── */}
      <div className="mt-8 border-t border-white/10 pt-5">
        <p className="text-center text-xs leading-relaxed break-keep text-[#98A2B3]">
          로그인은 스탬프와 여행 기록에만 필요해요.
          <br />
          다트는 그냥 던지면 돼요.
        </p>
        <Link
          href="/"
          className="mt-3 flex min-h-12 items-center justify-center text-sm text-[#F2F4F7] underline underline-offset-2"
        >
          그냥 둘러보기 →
        </Link>
      </div>

      {isSignup ? (
        <p className="mt-6 text-center text-sm text-[#98A2B3]">
          이미 계정이 있나요?{" "}
          <Link
            href={next ? `/login?next=${encodeURIComponent(next)}` : "/login"}
            className="text-[#F2F4F7] underline underline-offset-2"
          >
            로그인 →
          </Link>
        </p>
      ) : null}
    </section>
  );
}

export default AuthForm;
