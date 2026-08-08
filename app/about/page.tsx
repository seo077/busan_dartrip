/**
 * S6 — 정보.
 *
 * 설계 정본: `화면구성도.md` §8(전체 — 와이어프레임 · §8.2 상태) · §1(IA — `/about`)
 *            `API데이터설계.md` §1.1(데이터 소스 9종과 사용처) · §10(출처 표기 문안)
 *            `ARCHITECTURE.md` OG-4(정렬 기준은 거리뿐) · AD-9(위치 권한 미요청)
 *            제안서 원칙 승계 — 위치 정보 미수집 (`PR-8` · `화면구성도.md` §2.5)
 *
 * 이 화면이 있는 이유는 두 가지입니다
 * ----------------------------------
 * 1) **공공누리 출처표시 의무.** 전 유형에서 출처 표시가 필수입니다(④ §1.1). 하단 공통
 *    표기(`components/DataSources.tsx`)는 어느 화면에서나 보이는 짧은 목록이고, 이 화면은
 *    **무엇을 어디에 쓰는지까지 밝히는 자리**입니다.
 *
 *    두 가지를 갈라 적습니다 — 서비스가 **실제로 호출하는** 데이터 8종과, 설계 단계에
 *    한 번 **참고했을 뿐** 서비스가 호출하지 않는 자료입니다. 출처표시 의무는 활용한
 *    데이터에 대한 것이라 앞의 것만 하단 공통 표기에 두고, 뒤의 것은 여기에만 둡니다.
 *    참고한 사실을 숨길 이유는 없지만, 상시 출처로 적으면 사실과 다릅니다.
 *
 *    ④ §1.1 은 소스 9종을 세지만, 그중 **국가유산청 국가유산 공간정보는 응답이 XML
 *    전용이라 v1 에서 붙이지 않았습니다.** 참고조차 하지 않았으므로 아래 두 목록 어디에도
 *    두지 않습니다 — 보류 사유는 `README.md` §9 에만 남깁니다. 반대로 **부산도보여행정보는
 *    실제로 호출**해 `courses` 를 채우므로(`scripts/backfill/07-walking.ts`) 호출 목록에
 *    있습니다. 이 파일을 고칠 때 `components/DataSources.tsx` · `README.md` §9 를 함께 봅니다.
 * 2) 서비스가 무엇을 하지 않는지 알리기 위해서. 평점·인기·조회수를 쓰지 않는다는 것과
 *    위치를 수집하지 않는다는 것은 화면에 적지 않으면 사용자가 알 방법이 없습니다.
 *
 * 외부 의존이 없습니다 (§8.2 — 상태가 "정상" 하나뿐인 유일한 화면입니다). 서버 조회도,
 * 브라우저에서 도는 조각도 없어 빌드 시점에 굳혀 둡니다.
 */

import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "정보 — 부산 Dartrip",
  description:
    "부산 Dartrip 서비스 소개와 데이터 출처 표기. 공공데이터 8종을 활용하며 위치 정보를 수집하지 않습니다.",
};

/**
 * 서비스가 실제로 호출하는 데이터. 순서·표기는 ④ §10 의 출처 표기 문안을 따릅니다.
 *
 * `provider` 앞에 `출처: ` 가 붙어 화면에 나갑니다(`SourceCard`). **`ⓒ` 는 한국관광공사
 * 데이터에만** 붙습니다 — 공식 공지가 형식을 정한 것이 공사 데이터이고(`NC-5` · `D-43-3`),
 * 나머지 기관은 공공누리 표준대로 기관명만 적습니다. 자세한 근거는
 * `components/DataSources.tsx` 머리말에 한 번만 적어 두었습니다.
 */
const SOURCES: { provider: string; name: string; usage: string }[] = [
  {
    provider: "ⓒ한국관광공사",
    name: "국문 관광정보 서비스",
    usage: "다트가 뽑는 장소의 바탕. 장소 이름·주소·소개·사진",
  },
  {
    provider: "ⓒ한국관광공사",
    name: "관광지별 연관관광지 정보",
    usage: "장소 상세의 '함께 가볼 만한 곳'",
  },
  {
    provider: "ⓒ한국관광공사",
    name: "두루누비 정보 서비스",
    usage: "장소 상세의 '주변 도보 코스'",
  },
  {
    provider: "ⓒ한국관광공사",
    name: "관광사진 정보",
    usage: "장소 상세의 사진",
  },
  {
    provider: "부산광역시",
    name: "부산명소정보",
    usage: "다트가 뽑는 장소의 바탕. 관광정보에 없던 장소를 찾는 데도 사용",
  },
  {
    provider: "부산광역시",
    name: "부산도보여행정보",
    usage: "장소 상세의 '주변 도보 코스'",
  },
  {
    provider: "행정안전부",
    name: "전국모범음식점표준데이터",
    usage: "음식점의 '모범음식점' 표식 (표식일 뿐, 순서를 바꾸지 않습니다)",
  },
  {
    provider: "카카오",
    name: "카카오맵",
    usage: "지도 표시 · 주소 확인 · 길찾기 연결",
  },
];

/**
 * 설계 단계에 참고했을 뿐, 서비스가 호출하지 않는 자료.
 *
 * 하단 공통 표기(`components/DataSources.tsx`)에는 두지 않습니다 — 상시 출처 표기는 실제로
 * 활용하는 데이터의 자리이기 때문입니다. 여기에는 남깁니다. 참고한 것은 사실이니까요.
 */
const REFERENCES: { provider: string; name: string; usage: string }[] = [
  {
    provider: "한국관광공사",
    name: "한국관광 데이터랩",
    usage:
      "서비스를 만들기 전, 방문이 적은 구·군을 가려내는 데 한 번 참고했습니다. 서비스가 이 자료를 불러오지는 않습니다",
  },
];

const HOW_IT_WORKS = [
  "부산 16개 구·군 중 하나를 균등한 확률로 뽑습니다.",
  "그 안의 장소 중 하나를 뽑습니다.",
  "결과는 거리순으로만 보여줍니다.",
];

/**
 * §17.4 — r7 개정분.
 *
 * 로그인이 생기면서 **두 문장이 사실이 아니게 됐습니다** — "회원가입이 없습니다" 와
 * "등록·후기는 기기 식별값으로만 구분합니다" 입니다. 위치 미수집(`AD-9`)은 그대로 유효합니다.
 * 세 줄로는 담을 수 없는 항목(수집·이용·보유·파기·권리·책임자)은 별도 페이지(`/privacy`)로
 * 나가고, 여기서는 그리로 가는 길만 둡니다.
 */
const PRIVACY = [
  "위치 정보를 수집·저장하지 않습니다.",
  "로그인은 선택입니다. 스탬프와 여행 기록을 쓸 때만 필요하고, 다트·후기·장소 등록은 로그인 없이 됩니다.",
  "로그인하지 않으면 등록·후기는 기기 식별값으로만 구분합니다.",
  "가입할 때 받는 것은 아이디와 비밀번호뿐입니다.",
  "남용을 막기 위해 접속 주소를 잠깐 기록했다가 약 2일 뒤 지웁니다.",
];

/**
 * `credit` 이 참이면 앞에 `출처: ` 가 붙습니다 (`NC-5` 형식).
 *
 * 설계 단계에 참고만 한 자료(`REFERENCES`)에는 붙이지 않습니다 — 공공누리 출처표시
 * 의무는 **활용한 데이터**에 대한 것이고, 호출하지 않는 자료에 출처 표기를 달면
 * 활용 사실을 잘못 알리는 것이 됩니다.
 */
function SourceCard({
  provider,
  name,
  usage,
  credit = true,
}: {
  provider: string;
  name: string;
  usage: string;
  credit?: boolean;
}) {
  return (
    <li className="rounded-2xl border border-white/10 bg-[#171B22] p-4">
      <p className="text-sm font-medium break-keep text-[#F2F4F7]">
        {credit ? "출처: " : ""}
        {provider} — {name}
      </p>
      <p className="mt-1 text-xs leading-relaxed break-keep text-[#98A2B3]">{usage}</p>
    </li>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-white/10 px-5 py-6">
      <h2 className="mb-3 text-sm font-semibold text-[#98A2B3]">{title}</h2>
      {children}
    </section>
  );
}

export default function AboutPage() {
  return (
    <main className="mx-auto min-h-screen w-full max-w-lg bg-[#0E1116] text-[#F2F4F7]">
      {/* 상단 바 (§8.1) — 도착지는 S1 하나입니다 (§9 전이 종합 "S6 → S1") */}
      <header className="sticky top-0 z-20 flex h-14 items-center gap-1 bg-[#0E1116]/85 px-2 backdrop-blur">
        <Link
          href="/"
          aria-label="뒤로"
          className="flex h-11 w-11 items-center justify-center rounded-full text-xl text-[#F2F4F7]"
        >
          <span aria-hidden>←</span>
        </Link>
        <h1 className="text-base font-semibold">정보</h1>
      </header>

      {/* ── 서비스 소개 (§8.1) ─────────────────────────────────────────────── */}
      <section className="px-5 pt-2 pb-6">
        <p className="text-xl font-bold">부산 Dartrip</p>
        <p className="mt-3 text-sm leading-relaxed break-keep text-[#98A2B3]">
          부산 지도에 다트를 던져, 추천 순위 없이 우연으로 부산 16개 구·군의 관광지를 만나는
          웹 서비스입니다.
        </p>
      </section>

      {/* ── 이렇게 동작합니다 (§8.1) ───────────────────────────────────────── */}
      <Section title="이렇게 동작합니다">
        <ol className="space-y-2">
          {HOW_IT_WORKS.map((step, i) => (
            <li key={step} className="flex gap-3 text-sm leading-relaxed break-keep">
              <span
                aria-hidden
                className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs text-[#F2F4F7]"
              >
                {i + 1}
              </span>
              <span className="text-[#F2F4F7]">{step}</span>
            </li>
          ))}
        </ol>
        <p className="mt-4 rounded-2xl border border-white/10 bg-[#171B22] p-4 text-sm leading-relaxed break-keep text-[#98A2B3]">
          평점·인기·조회수는 사용하지 않습니다. 순위를 매기면 이미 알려진 곳이 다시 앞에 서고,
          그 뒤에 있던 장소는 계속 보이지 않기 때문입니다. 그래서 후기에도 별점이 없고, 목록의
          순서는 거리 하나로만 정합니다.
        </p>
      </Section>

      {/* ── 데이터 출처 (§8.1 · ④ §10) — 공공누리 의무 표기 ────────────────── */}
      <Section title="데이터 출처">
        <p className="mb-4 text-sm leading-relaxed break-keep text-[#98A2B3]">
          본 서비스는 아래 기관이 제공하는 공공데이터를 활용합니다.
        </p>

        <ul className="space-y-2">
          {SOURCES.map((source) => (
            <SourceCard key={`${source.provider}-${source.name}`} {...source} />
          ))}
        </ul>

        <p className="mt-4 text-xs leading-relaxed break-keep text-[#98A2B3]">
          위 데이터는 공공누리 이용허락 조건에 따라 출처를 표시하여 사용합니다. 데이터의
          최신성·정확성은 각 제공기관의 갱신 주기를 따르며, 실제 운영 정보는 방문 전 확인해
          주세요.
        </p>
      </Section>

      {/* ── 설계 단계 참고 자료 — 서비스가 호출하지 않는 자료 ────────────────── */}
      <Section title="설계 단계 참고 자료">
        <p className="mb-4 text-sm leading-relaxed break-keep text-[#98A2B3]">
          아래 자료는 서비스를 만드는 과정에서 참고했을 뿐, 서비스가 실제로 불러오지는
          않습니다. 그래서 위의 데이터 출처와 나누어 적습니다.
        </p>

        <ul className="space-y-2">
          {REFERENCES.map((reference) => (
            <SourceCard
              key={`${reference.provider}-${reference.name}`}
              {...reference}
              credit={false}
            />
          ))}
        </ul>
      </Section>

      {/* ── 개인정보 (§8.1 · §2.5) ────────────────────────────────────────── */}
      <Section title="개인정보">
        <ul className="space-y-2">
          {PRIVACY.map((line) => (
            <li key={line} className="flex gap-2 text-sm leading-relaxed break-keep text-[#F2F4F7]">
              <span aria-hidden className="text-[#98A2B3]">
                ·
              </span>
              <span>{line}</span>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs leading-relaxed break-keep text-[#98A2B3]">
          다트의 기준점은 구·군이라 사용자의 현재 위치가 필요하지 않습니다. 그래서 브라우저에
          위치 권한을 요청하는 자리 자체가 없습니다. 장소 등록과 후기에 붙는 기기 식별값은 이
          기기에서 만든 임의의 값이며, 누구인지 알아내는 데 쓰지 않습니다.
        </p>
        <Link
          href="/privacy?from=about"
          className="mt-4 flex min-h-12 w-full items-center justify-between rounded-2xl border border-white/10 bg-[#171B22] px-4 text-sm text-[#F2F4F7]"
        >
          <span>개인정보 처리방침</span>
          <span aria-hidden className="text-[#98A2B3]">
            →
          </span>
        </Link>
      </Section>

      {/* ── 만든 사람들 (§8.1) ────────────────────────────────────────────── */}
      <Section title="만든 사람들">
        <p className="text-sm leading-relaxed break-keep text-[#F2F4F7]">
          2026 관광데이터 활용 공모전 출품작
        </p>
        <p className="mt-1 text-xs text-[#98A2B3]">v1.0.0</p>
      </Section>
    </main>
  );
}
