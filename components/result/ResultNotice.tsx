/**
 * S3 결과 — 결과 대신 안내를 띄우는 자리.
 *
 * 설계 정본: `화면구성도.md` §5.4("잘못된 링크" · "오류") · §2.4(공통 상태 처리 원칙)
 *
 * §2.4 가 요구하는 두 가지를 이 컴포넌트가 강제합니다.
 *   1) 원인을 사용자 문장으로 적는다 (기술 메시지·오류 코드는 화면에 두지 않습니다)
 *   2) **다음 행동 버튼을 항상 함께 둔다** — 막다른 안내문만 남기지 않습니다
 */

import Link from "next/link";

export function ResultNotice({
  title,
  body,
  actionLabel,
  actionHref,
}: {
  title: string;
  body: string;
  actionLabel: string;
  actionHref: string;
}) {
  return (
    <section className="flex min-h-[70svh] flex-col items-center justify-center px-8 text-center">
      <p className="mb-5 text-4xl" aria-hidden>
        🎯
      </p>
      <h1 className="text-xl font-bold break-keep text-ink">{title}</h1>
      <p className="mt-3 text-sm leading-relaxed break-keep text-ink-muted">{body}</p>
      <Link
        href={actionHref}
        className="mt-8 flex min-h-12 items-center justify-center rounded-2xl bg-brand-deep px-8 text-sm font-semibold text-white"
      >
        {actionLabel}
      </Link>
    </section>
  );
}

export default ResultNotice;
