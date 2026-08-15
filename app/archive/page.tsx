/**
 * S9 — 여행 아카이빙.
 *
 * 설계 정본: `화면구성도.md` §16(전체) · §16.2(담는 것·안 담는 것) · §16.4(상태) · §16.5(전이)
 *            `ARCHITECTURE.md` `AD-21` · `D-46-9`(아카이빙 = 방문 전부)
 *
 * **방문 전부를 담습니다** — 다트로 만난 곳이든 아니든 구분하지 않습니다(`D-46-9`). 다트 경유
 * 표시는 `throws` 에만 남고 30일 만료라, 구분하면 *"예전에 던져서 갔는데 안 잡히는"* 경로가
 * 반드시 생깁니다. 후기를 쓴 방문과 "다녀왔어요" 만 누른 방문도 **둘 다** 담습니다.
 *
 * **정렬은 최신순 고정입니다**(§16.3) — 정렬 선택지를 두면 그 순간 순위 감각이 들어옵니다.
 *
 * 필터는 주소로 겁니다 (`?gu=`)
 * -----------------------------
 * §16.5 가 *"구·군 칩 → 같은 화면(필터만 적용)"* 이라 화면 상태를 브라우저에 둘 이유가 없고,
 * 주소에 두면 스탬프판의 채운 칸이 그대로 이 화면의 걸러진 목록으로 이어집니다(§15.5).
 *
 * **칩은 방문한 구·군만** 나옵니다(§16.3-2). 그래서 §16.4 의 "필터 결과 0건" 이 원리적으로
 * 나오지 않습니다 — 그 판정은 `lib/visit.ts` 가 전체 기준으로 칩을 만드는 데서 나옵니다.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";

import { DataSources } from "@/components/DataSources";
import { readCurrentUser } from "@/lib/auth";
import { themeIcon } from "@/lib/format";
import { loadArchive, type Archive, type VisitEntry } from "@/lib/visit";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "내 여행 기록 — 부산 Dartrip",
  description: "다녀온 곳이 시간순으로 쌓입니다.",
};

/** 달 구분 머리 (§16.3-3) — 시간 흐름이 보이는 최소 단위 */
function monthKey(iso: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "long",
  }).format(new Date(iso));
}

/** 카드의 날짜 — `MM-DD` (§16.1) */
function dayLabel(iso: string): string {
  const parts = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(iso));
  const month = parts.find((p) => p.type === "month")?.value ?? "";
  const day = parts.find((p) => p.type === "day")?.value ?? "";
  return `${month}-${day}`;
}

function groupByMonth(entries: VisitEntry[]): { month: string; items: VisitEntry[] }[] {
  const out: { month: string; items: VisitEntry[] }[] = [];
  for (const entry of entries) {
    const month = monthKey(entry.visitedAt);
    const last = out[out.length - 1];
    if (last && last.month === month) last.items.push(entry);
    else out.push({ month, items: [entry] });
  }
  return out;
}

function Header() {
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-1 bg-canvas/85 px-2 backdrop-blur">
      {/* §16.5 — 뒤로는 스탬프판입니다 */}
      <Link
        href="/stamps"
        aria-label="뒤로"
        className="flex h-11 w-11 items-center justify-center rounded-full text-xl text-ink"
      >
        <span aria-hidden>←</span>
      </Link>
      <h1 className="text-base font-semibold">내 여행 기록</h1>
    </header>
  );
}

function VisitCard({ entry }: { entry: VisitEntry }) {
  return (
    <li>
      <Link
        href={`/place/${entry.placeId}`}
        className="flex gap-3 rounded-2xl border border-line bg-surface p-4"
      >
        <span aria-hidden className="text-xl leading-none">
          {themeIcon(entry.theme)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium break-keep text-ink">
            {entry.placeName}
          </span>
          <span className="mt-1 block text-xs text-ink-muted">
            {entry.sigunguName}
            {entry.themeLabel ? ` · ${entry.themeLabel}` : ""}
          </span>
          <span className="mt-1 block text-xs text-ink-muted">{dayLabel(entry.visitedAt)}</span>
          {entry.body ? (
            <span className="mt-2 block text-sm break-keep text-ink">
              &ldquo;{entry.body}&rdquo;
            </span>
          ) : null}
        </span>
        {entry.photoPath ? (
          /* 후기 사진은 우리 Storage 의 공개 URL 입니다(§5.6). 최적화 대상이 아니라 그대로 씁니다. */
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={entry.photoPath}
            alt=""
            className="h-16 w-16 shrink-0 rounded-xl border border-line object-cover"
          />
        ) : null}
      </Link>
    </li>
  );
}

export default async function ArchivePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await readCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent("/archive")}`);

  const params = await searchParams;
  const guRaw = params.gu;
  const gu = typeof guRaw === "string" && guRaw !== "" && guRaw.length <= 40 ? guRaw : null;

  let archive: Archive | null = null;
  try {
    archive = await loadArchive(user.authorRef, { sigungu: gu });
  } catch {
    archive = null;
  }

  // §16.4 "오류"
  if (!archive) {
    return (
      <main className="mx-auto min-h-screen w-full max-w-lg bg-canvas text-ink">
        <Header />
        <section className="px-5 py-10 text-center">
          <p className="text-sm break-keep text-ink">기록을 불러오지 못했어요</p>
          <Link
            href="/archive"
            className="mt-4 inline-flex min-h-11 items-center rounded-2xl border border-ink/20 px-5 text-sm text-ink"
          >
            다시 시도
          </Link>
        </section>
        <DataSources />
      </main>
    );
  }

  // §16.4 "빈 목록" — **필터 칩은 그리지 않습니다**(고를 것이 없습니다)
  if (archive.total === 0) {
    return (
      <main className="mx-auto min-h-screen w-full max-w-lg bg-canvas text-ink">
        <Header />
        <section className="px-5 py-10 text-center">
          <p className="text-sm leading-relaxed break-keep text-ink-muted">
            아직 기록이 없어요. 다녀온 곳에서 &lsquo;다녀왔어요&rsquo;를 눌러 보세요.
          </p>
          <Link
            href="/"
            className="mt-6 inline-flex min-h-14 w-full max-w-xs items-center justify-center rounded-2xl bg-brand-deep text-base font-semibold text-white"
          >
            다트 던지러 가기
          </Link>
        </section>
        <DataSources />
      </main>
    );
  }

  const groups = groupByMonth(archive.entries);

  return (
    <main className="mx-auto min-h-screen w-full max-w-lg bg-canvas text-ink">
      <Header />

      <section className="px-5 pt-2 pb-4">
        <p className="text-sm text-ink-muted">전체 {archive.total}곳</p>

        {/* ── 구·군 필터 (§16.3-2) — 방문한 구·군만 ─────────────────────── */}
        <ul className="mt-3 flex flex-wrap gap-2">
          <li>
            <Link
              href="/archive"
              aria-current={gu === null ? "true" : undefined}
              className={`flex min-h-10 items-center rounded-full border px-4 text-sm ${
                gu === null
                  ? "border-brand bg-brand/15 text-ink"
                  : "border-line bg-surface text-ink-muted"
              }`}
            >
              전체
            </Link>
          </li>
          {archive.sigungu.map((chip) => (
            <li key={chip.code}>
              <Link
                href={`/archive?gu=${encodeURIComponent(chip.code)}`}
                aria-current={gu === chip.code ? "true" : undefined}
                className={`flex min-h-10 items-center rounded-full border px-4 text-sm ${
                  gu === chip.code
                    ? "border-brand bg-brand/15 text-ink"
                    : "border-line bg-surface text-ink-muted"
                }`}
              >
                {chip.name}
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {groups.map((group) => (
        <section key={group.month} className="border-t border-line px-5 py-5">
          <h2 className="mb-3 text-sm font-semibold text-ink-muted">{group.month}</h2>
          <ul className="space-y-2">
            {group.items.map((entry) => (
              <VisitCard key={entry.reviewId} entry={entry} />
            ))}
          </ul>
        </section>
      ))}

      <DataSources />
    </main>
  );
}
