/**
 * S7 — 가입 (§14.3).
 *
 * 설계 정본: `화면구성도.md` §14.3(와이어프레임 — 안내 셋이 버튼 위) · §14.7 · §14.8
 *            `D-46-5`(복구 불가 고지) · `D-46-8`(익명 기록 미승계)
 *
 * 안내 배치는 `components/auth/AuthForm.tsx` 가 들고 있습니다 — **되돌릴 수 없는 성질은
 * 행동 전에 읽혀야** 하고, 그것이 이 화면의 핵심입니다.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";

import { AuthForm } from "@/components/auth/AuthForm";
import { DataSources } from "@/components/DataSources";
import { authReady, readCurrentUser, safeNext } from "@/lib/auth";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "가입하기 — 부산 Dartrip",
  description: "가입할 때 아이디와 비밀번호만 받습니다. 이메일·이름·프로필을 받지 않습니다.",
};

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = params.next;
  const next = safeNext(typeof raw === "string" ? raw : null);

  if (authReady()) {
    const user = await readCurrentUser();
    if (user) redirect(next ?? "/stamps");
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-lg bg-canvas text-ink">
      <header className="flex h-14 items-center gap-1 px-2">
        <Link
          href="/login"
          aria-label="뒤로"
          className="flex h-11 w-11 items-center justify-center rounded-full text-xl text-ink"
        >
          <span aria-hidden>←</span>
        </Link>
        <h1 className="text-base font-semibold">가입하기</h1>
      </header>

      {authReady() ? (
        <AuthForm mode="signup" next={next} />
      ) : (
        <section className="px-5 pb-12">
          <p className="rounded-2xl border border-line bg-surface p-4 text-sm leading-relaxed break-keep text-ink">
            로그인을 준비 중이에요.
          </p>
          <Link
            href="/"
            className="mt-4 flex min-h-12 items-center justify-center text-sm text-ink underline underline-offset-2"
          >
            그냥 둘러보기 →
          </Link>
        </section>
      )}

      <DataSources />
    </main>
  );
}
