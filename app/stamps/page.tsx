/**
 * S8 — 구·군 스탬프판.
 *
 * 설계 정본: `화면구성도.md` §15(전체) · §15.2(빈 곳 다트) · §15.4(상태 세 가지) · §15.5(전이)
 *            `ARCHITECTURE.md` `AD-21`(재료는 `reviews`) · `SC-3`(밀도 무관 균등)
 *            `D-46-1`·`D-46-6`·`D-46-11`
 *
 * 칸 하나 = 구·군 하나이고, 그 구·군에 방문이 1건이라도 있으면 채워집니다. **몇 곳을 갔는지는
 * 세지 않습니다** — 스탬프는 "가 봤다" 는 표시이지 횟수 기록이 아닙니다(§15.1).
 *
 * 서버에서 그리고 세션으로 본인을 확인합니다(`AD-19`). 결과·상세와 같은 구조입니다.
 *
 * 빈 판을 빈 화면으로 대체하지 않습니다
 * -----------------------------------
 * 0/16 일 때도 **격자는 16칸을 다 그립니다**(§15.4). 무엇을 모으는 판인지 먼저 보여야 하고,
 * 안내 문구만 띄우면 그것을 알 수 없습니다. 로딩 자리 표시도 칸 수를 16으로 맞추는 것이 같은
 * 이유입니다 — 나중에 늘어나면 화면이 튑니다.
 *
 * **축하 연출을 두지 않습니다**(§15.4 전부 채운 상태) — 이 서비스는 달성을 겨루게 하지
 * 않습니다.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";

import { DataSources } from "@/components/DataSources";
import { LogoutMenu } from "@/components/stamps/LogoutMenu";
import { themeColor, themeIcon } from "@/lib/format";
import { readCurrentUser } from "@/lib/auth";
import { STAMP_TOTAL, loadStampBoard, pickEmptySigungu, type StampBoard } from "@/lib/visit";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "내 스탬프 — 부산 Dartrip",
  description: "부산 16개 구·군 중 다녀온 곳이 스탬프로 모입니다.",
};

function Header() {
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center justify-between bg-canvas/85 px-2 backdrop-blur">
      <div className="flex items-center gap-1">
        <Link
          href="/"
          aria-label="뒤로"
          className="flex h-11 w-11 items-center justify-center rounded-full text-xl text-ink"
        >
          <span aria-hidden>←</span>
        </Link>
        <h1 className="text-base font-semibold">내 스탬프</h1>
      </div>
      <LogoutMenu />
    </header>
  );
}

/** 격자 — 어느 상태에서나 **16칸을 다 그립니다** (§15.4) */
function Grid({ board }: { board: StampBoard }) {
  return (
    <ul className="grid grid-cols-4 gap-2 px-5">
      {board.cells.map((cell) => (
        <li key={cell.code}>
          {cell.filled ? (
            /*
              채운 칸을 탭하면 그 구·군으로 걸러진 아카이빙이 열립니다 (§15.5).
              칸 색 = **그 방문의 테마 색** (`D-61-1`). 테마 버튼·결과 카드와 같은 배정이라
              세 화면이 같은 말을 합니다. 표식도 테마 아이콘으로 두어 색과 뜻이 맞습니다.
            */
            <Link
              href={`/archive?gu=${encodeURIComponent(cell.code)}`}
              className="flex min-h-20 flex-col items-center justify-center gap-1 rounded-2xl border px-1 py-2 text-center"
              style={{
                borderColor: themeColor(cell.theme),
                backgroundColor: `color-mix(in srgb, ${themeColor(cell.theme)} 20%, transparent)`,
              }}
            >
              <span aria-hidden className="text-lg leading-none">
                {cell.theme ? themeIcon(cell.theme) : "🏅"}
              </span>
              <span className="text-[11px] leading-tight break-keep text-ink">
                {cell.name}
              </span>
            </Link>
          ) : (
            /* 빈 칸은 **회색으로 죽이지 않습니다** — 아직 갈 곳이지 못 간 곳이 아닙니다 (§15.3-4) */
            <div className="flex min-h-20 flex-col items-center justify-center gap-1 rounded-2xl border border-line bg-surface px-1 py-2 text-center">
              <span className="text-[11px] leading-tight break-keep text-ink-muted">
                {cell.name}
              </span>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

export default async function StampsPage() {
  // §15.4 "비로그인" — 화면을 그리지 않고 로그인으로 보냅니다. 돌아올 자리를 함께 넘깁니다.
  const user = await readCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent("/stamps")}`);

  let board: StampBoard | null = null;
  try {
    board = await loadStampBoard(user.authorRef);
  } catch {
    board = null;
  }

  // §15.4 "오류" — **로그아웃시키지 않습니다.**
  if (!board) {
    return (
      <main className="mx-auto min-h-screen w-full max-w-lg bg-canvas text-ink">
        <Header />
        <section className="px-5 py-10 text-center">
          <p className="text-sm break-keep text-ink">스탬프를 불러오지 못했어요</p>
          <Link
            href="/stamps"
            className="mt-4 inline-flex min-h-11 items-center rounded-2xl border border-ink/20 px-5 text-sm text-ink"
          >
            다시 시도
          </Link>
        </section>
        <DataSources />
      </main>
    );
  }

  const empty = board.filledCount === 0;
  const complete = board.filledCount === STAMP_TOTAL;
  const target = complete ? null : pickEmptySigungu(board);

  return (
    <main className="mx-auto min-h-screen w-full max-w-lg bg-canvas text-ink">
      <Header />

      {/* ── 진행 표시 (§15.3-1) — 비율(%)로 쓰지 않습니다 ─────────────────── */}
      <section className="px-5 pt-4 pb-5 text-center">
        <p className="text-sm text-ink-muted">부산 {STAMP_TOTAL}개 구·군 중</p>
        <p className="mt-1 text-2xl font-bold text-ink">
          <span aria-hidden className="text-brand-deep">
            ●{" "}
          </span>
          {board.filledCount} / {STAMP_TOTAL}
        </p>
      </section>

      {complete ? (
        <p className="mb-4 px-5 text-center text-sm font-semibold break-keep text-ink">
          부산 {STAMP_TOTAL}개 구·군을 모두 다녀왔습니다
        </p>
      ) : null}

      {empty ? (
        <p className="mb-4 px-5 text-center text-sm leading-relaxed break-keep text-ink-muted">
          다녀온 곳에서 &lsquo;다녀왔어요&rsquo;를 누르면 스탬프가 찍혀요.
        </p>
      ) : null}

      <Grid board={board} />

      {/* ── 빈 곳으로 던지기 (§15.2) ───────────────────────────────────────
          고르는 방식은 **균등**입니다. "가장 가까운 곳"·"인기 있는 곳" 을 고르는 순간
          그것이 추천이 되어 `SC-3` 과 서비스 원칙이 함께 깨집니다.
          전부 채웠으면 고를 빈 곳이 없으므로 버튼이 `다시 던지기` 로 바뀝니다(§15.4). */}
      <section className="px-5 pt-8">
        {!empty && !complete ? (
          <p className="mb-2 text-center text-sm break-keep text-ink-muted">
            아직 안 가 본 곳으로 던져 볼까요?
          </p>
        ) : null}

        <Link
          href={target ? `/?scope=${encodeURIComponent(target)}` : "/"}
          className="flex min-h-14 w-full items-center justify-center rounded-2xl bg-brand-deep text-base font-semibold text-white"
        >
          {complete ? "다시 던지기" : empty || !target ? "다트 던지러 가기" : "빈 곳 중에서 다트 던지기"}
        </Link>

        <Link
          href="/archive"
          className="mt-4 flex min-h-12 items-center justify-center text-sm text-ink underline underline-offset-2"
        >
          내 여행 기록 보기 →
        </Link>
      </section>

      <DataSources />
    </main>
  );
}
