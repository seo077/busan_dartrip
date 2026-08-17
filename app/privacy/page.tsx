/**
 * S6-2 — 개인정보 처리방침.
 *
 * 설계 정본: `화면구성도.md` §17(전체 — §17.2 담을 항목 · §17.5 복귀 경로) · §8.1(S6 개인정보 블록)
 *            `ARCHITECTURE.md` `AD-19`(가입이 받는 항목) · `AD-9`(위치 미수집) · `AD-20`
 *            `API데이터설계.md` §5.7(보존 정책) · §11(`DF-4`·`DF-5` 남용 차단) · `D-46-4`·`D-46-10`
 *
 * 왜 별도 페이지인가 (§17.1)
 * -------------------------
 * r6 까지 개인정보 안내는 S6 안의 세 줄이었고 요지가 *"위치를 저장하지 않고, 회원가입이
 * 없다"* 였습니다. **로그인이 생기면서 두 문장이 다 사실이 아니게 됩니다.** 처리방침은
 * 수집 항목·이용 목적·보유 기간·파기 절차·이용자 권리·보호책임자를 각각 밝혀야 하는 문서라
 * 정보 화면의 한 블록에 넣으면 그 화면이 처리방침에 잡아먹힙니다.
 *
 * 자동으로 기록되는 항목을 왜 따로 적는가 (§2 — 2026-08-09 신설)
 * -------------------------------------------------------------
 * 가입이 받는 항목은 아이디·비밀번호 둘뿐이지만, **남용 차단 카운터**(`lib/ratelimit.ts` ·
 * `DF-4`·`DF-5`)가 접속 주소와 로그인 시도 아이디를 `rate_limits.subject` 에 담고 약 2일
 * 뒤 정기 삭제합니다. 앞 문단만 적고 이 사실을 빼면 **문서가 저장 사실과 어긋납니다.**
 * 그래서 §1(가입이 받는 것)과 §2(쓰는 동안 자동으로 남는 것)를 나눠 적습니다.
 *
 * "약 2일" 이라고 적은 이유 — 삭제는 매일 도는 크론의 `cleanup()` 이 합니다(보존 2일).
 * 크론이 멎으면 그만큼 남으므로(`ARCHITECTURE.md` `R-19`) **"최대 2일" 로 단정하지
 * 않습니다.** 단정하면 그 문장이 다시 사실과 어긋날 수 있습니다.
 *
 * 어디로 돌아가는가 (§17.5 — `X-51`)
 * ----------------------------------
 * 이 페이지를 여는 자리가 둘(S6 정보 화면 · 가입 화면)인데 복귀는 `/about` 한 곳으로
 * 고정돼 있었습니다. **출발지를 `?from=` 으로 받아 그 자리로 돌려보냅니다.** 값은
 * 흰 목록으로만 받고(`about`·`signup`) 그 밖의 값·빈 값은 전부 `/about` 입니다 —
 * 주소를 그대로 믿고 이동하면 밖으로 튕겨 보내는 통로가 됩니다.
 *
 * ★ 제출 전에 반드시 바꿔야 하는 값이 하나 있습니다
 * ------------------------------------------------
 * **보호책임자 연락처**입니다. 지금 값은 임시이며 **실제로 수신 가능한 주소로 교체**해야
 * 합니다(`D-46-10`). 추적 = `PROGRESS.md` §남은 작업 39번. 아래 `CONTACT` 상수 한 곳만
 * 고치면 됩니다.
 *
 * 외부 의존이 없는 정적 문서입니다 (§17.3 — 상태가 "정상" 하나뿐).
 *
 * 하단 데이터 출처 표기 (§2.1 · §17.6 — 2026-08-17 신설)
 * ------------------------------------------------------
 * ② §2.1이 *"데이터 출처 표기는 전 화면 공통이며 예외가 없습니다"* 라고 못박은 규약이
 * **이 화면에만 걸리지 않고 있었습니다.** 규약은 r6에서 섰고 이 화면은 그보다 뒤인 r7
 * 신설이라, **규칙이 자기보다 나중에 생긴 화면을 붙잡지 못한 자리**입니다. 규약을 고치지
 * 않고 화면을 규약에 맞추는 쪽으로 닫았습니다(`D-64-1`).
 *
 * 예외로 두지 않은 이유 — **공공누리 출처표시는 화면 단위 의무**이고, 표기는 많을수록
 * 안전한 쪽입니다. 이 화면이 공공데이터를 직접 그리지 않는다는 사실은 예외의 근거가 되기에
 * 약합니다(같은 논리면 `S7` 로그인 화면도 예외여야 하는데 거기에는 붙어 있습니다).
 *
 * 같은 일이 다음 화면에서 다시 나지 않게 하는 자리는 셋입니다 —
 * `ARCHITECTURE.md` §부록 규칙 ㉮ 표의 「화면」 행 · ② §2.1 · `npm run check:sources`
 * (`scripts/report/screen-sources.ts` — 화면 파일과 표기 부착 여부를 대조해 줍니다).
 */

import Link from "next/link";
import type { Metadata } from "next";

import { DataSources } from "@/components/DataSources";

export const metadata: Metadata = {
  title: "개인정보 처리방침 — 부산 Dartrip",
  description:
    "가입할 때 받는 것은 아이디와 비밀번호 2건입니다. 위치 정보를 수집하지 않으며, 남용을 막기 위한 접속 기록은 약 2일 뒤 지웁니다.",
};

/** ★ 제출 전 교체 대상 (`D-46-10` · `PROGRESS.md` §남은 작업 39번) */
const CONTACT = {
  officer: "부산 Dartrip 운영팀",
  email: "dartrip.busan@gmail.com",
};

/** 시행일 = 게시일 (§17.2 마지막 행) */
const EFFECTIVE_DATE = "2026년 8월 9일";

/**
 * 돌아갈 자리 (§17.5 — `X-51`).
 *
 * 흰 목록입니다. 여기 없는 값은 전부 `/about` 으로 떨어집니다.
 */
const RETURN_TO: Record<string, { href: string; label: string }> = {
  about: { href: "/about", label: "정보" },
  signup: { href: "/signup", label: "가입" },
};

const DEFAULT_RETURN = RETURN_TO.about;

function Article({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-line px-5 py-6">
      <h2 className="mb-3 text-sm font-semibold text-ink-muted">{title}</h2>
      <div className="space-y-2 text-sm leading-relaxed break-keep text-ink">{children}</div>
    </section>
  );
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item} className="flex gap-2">
          <span aria-hidden className="text-ink-muted">
            ·
          </span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export default async function PrivacyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = params.from;
  const back = (typeof raw === "string" ? RETURN_TO[raw] : undefined) ?? DEFAULT_RETURN;

  return (
    <main className="mx-auto min-h-screen w-full max-w-lg bg-canvas text-ink">
      <header className="sticky top-0 z-20 flex h-14 items-center gap-1 bg-canvas/85 px-2 backdrop-blur">
        <Link
          href={back.href}
          aria-label={`뒤로 — ${back.label} 화면으로`}
          className="flex h-11 w-11 items-center justify-center rounded-full text-xl text-ink"
        >
          <span aria-hidden>←</span>
        </Link>
        <h1 className="text-base font-semibold">개인정보 처리방침</h1>
      </header>

      <section className="px-5 pt-2 pb-6">
        <p className="text-sm leading-relaxed break-keep text-ink-muted">
          부산 Dartrip(이하 &lsquo;서비스&rsquo;)은 이용자의 개인정보를 최소한으로만 받습니다.
          가입할 때 받는 것은{" "}
          <strong className="text-ink">아이디와 비밀번호 2건</strong>입니다. 그 밖에,
          서비스를 지키기 위해{" "}
          <strong className="text-ink">접속 주소를 잠깐 기록했다가 지웁니다</strong>{" "}
          (아래 2항).
        </p>
      </section>

      <Article title="1. 가입할 때 받는 항목">
        <Bullets
          items={[
            "아이디 — 로그인에 쓰는 이름입니다.",
            "비밀번호 — 암호화해 저장하며, 원래 값을 저장하거나 열람할 수 없습니다.",
          ]}
        />
        <p className="mt-3 text-xs leading-relaxed break-keep text-ink-muted">
          이메일·이름·연락처·프로필 사진을 받지 않습니다. 그래서 비밀번호를 잊으면 재설정
          메일을 보낼 곳이 없고, 되찾을 수 없습니다. 가입 화면에서 이 사실을 먼저 알립니다.
        </p>
      </Article>

      <Article title="2. 서비스를 쓰는 동안 자동으로 기록되는 항목">
        <Bullets
          items={[
            "접속 주소(IP) — 짧은 시간에 같은 곳에서 요청이 몰릴 때 그것을 막기 위해 셉니다. 사진 올리기·장소 등록·후기·다트처럼 한 번 쓰면 되돌아오지 않는 자원을 지키는 용도입니다.",
            "로그인에 시도한 아이디 — 한 아이디에 비밀번호를 반복해 넣어 보는 시도를 막기 위해 같은 방식으로 셉니다. 가입되지 않은 아이디도 시도가 있으면 세어집니다.",
          ]}
        />
        <p className="mt-3 text-xs leading-relaxed break-keep text-ink-muted">
          이 두 값은 남용을 막는 계수기에만 쓰고, <strong>약 2일이 지나면 정기적으로 지웁니다.</strong>{" "}
          계정 정보나 방문 기록과 연결하지 않고, 광고·분석·프로파일링에도 쓰지 않습니다.
          로그인하지 않아도 서비스를 쓰는 동안에는 이 기록이 남습니다.
        </p>
      </Article>

      <Article title="3. 수집하지 않는 것">
        <Bullets
          items={[
            "위치 정보 — 브라우저에 위치 권한을 요청하는 자리 자체가 없습니다. 다트의 기준점은 구·군이라 현재 위치가 필요하지 않습니다.",
            "기기 식별 정보 — 로그인하지 않은 상태의 등록·후기에 붙는 값은 이 기기에서 만든 임의의 값이며, 기기 자체를 알아내는 값이 아닙니다.",
          ]}
        />
      </Article>

      <Article title="4. 이용 목적">
        <Bullets
          items={[
            "로그인 — 이 계정이 본인의 것임을 확인합니다.",
            "내 방문 기록의 소유자 구분 — 스탬프판과 여행 기록이 누구의 것인지 가릅니다.",
            "서비스 보호 — 위 2항의 기록으로 짧은 시간에 몰리는 요청을 막습니다.",
          ]}
        />
        <p className="mt-3 text-xs leading-relaxed break-keep text-ink-muted">
          광고·마케팅·프로파일링에 쓰지 않습니다. 이용자별 행동을 분석하는 도구를 붙이지
          않았습니다.
        </p>
      </Article>

      <Article title="5. 보유 및 이용 기간">
        <Bullets
          items={[
            "계정 정보 — 계정을 삭제할 때까지 보관합니다.",
            "방문 기록과 후기 — 기간 만료로 자동 삭제되지 않습니다. 이용자가 남긴 기록이기 때문입니다.",
            "위 2항의 자동 기록 — 약 2일 뒤 정기적으로 지웁니다.",
          ]}
        />
      </Article>

      <Article title="6. 파기 절차">
        <p>
          아래 연락처로 계정 삭제를 요청하시면 본인 확인 후 계정과 그 계정에 딸린 방문 기록을
          지웁니다. 지운 정보는 되살릴 수 없습니다.
        </p>
        <p className="mt-3 text-xs leading-relaxed break-keep text-ink-muted">
          위 2항의 자동 기록은 요청을 기다리지 않고 정기적으로 지워집니다.
        </p>
      </Article>

      <Article title="7. 이용자의 권리">
        <Bullets
          items={[
            "열람 — 내 방문 기록은 로그인 후 '내 여행 기록' 화면에서 언제든 볼 수 있습니다.",
            "정정·삭제 — 아래 연락처로 요청하실 수 있습니다.",
            "처리 정지 — 로그아웃하면 그 시점부터 새 기록이 쌓이지 않습니다.",
          ]}
        />
      </Article>

      <Article title="8. 제3자 제공 및 처리 위탁">
        <p>개인정보를 제3자에게 판매하거나 제공하지 않습니다. 서비스 운영에 아래를 씁니다.</p>
        <Bullets
          items={[
            "Supabase — 데이터 보관",
            "Vercel — 서비스 배포",
            "카카오 — 지도 표시",
          ]}
        />
        <p className="mt-3 text-xs leading-relaxed break-keep text-ink-muted">
          지도는 이용자의 브라우저가 카카오를 직접 부르는 방식이라, 지도에서 움직인 좌표가 저희
          서버에 닿지 않습니다.
        </p>
      </Article>

      <Article title="9. 개인정보 보호책임자">
        <Bullets items={[`책임자 — ${CONTACT.officer}`, `연락처 — ${CONTACT.email}`]} />
      </Article>

      <Article title="10. 시행일">
        <p>본 방침은 {EFFECTIVE_DATE}부터 적용합니다.</p>
      </Article>

      <DataSources />
    </main>
  );
}
