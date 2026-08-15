/**
 * S7 — 로그인 (§14.2).
 *
 * 설계 정본: `화면구성도.md` §14 · §14.5(진입점) · §14.7(설정 미완) · §14.8(전이)
 *
 * 이미 들어와 있으면 여기 머물 이유가 없습니다 — 스탬프판으로 보냅니다(§14.8).
 * `?next=` 는 §14.5 의 *"로그인 뒤 원래 가려던 화면으로 복귀"* 를 위한 자리이며,
 * **우리 화면 안의 경로만** 받습니다(`lib/auth.ts` `safeNext`).
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";

import { AuthForm } from "@/components/auth/AuthForm";
import { DataSources } from "@/components/DataSources";
import { authReady, readCurrentUser, safeNext } from "@/lib/auth";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "로그인 — 부산 Dartrip",
  description: "아이디와 비밀번호로 로그인합니다. 로그인은 스탬프와 여행 기록에만 필요합니다.",
};

export default async function LoginPage({
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
          href="/"
          aria-label="뒤로"
          className="flex h-11 w-11 items-center justify-center rounded-full text-xl text-ink"
        >
          <span aria-hidden>←</span>
        </Link>
        <h1 className="text-base font-semibold">로그인</h1>
      </header>

      {authReady() ? (
        <AuthForm mode="login" next={next} />
      ) : (
        /* §14.7 "설정 미완" — 다트는 계속 됩니다 */
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
