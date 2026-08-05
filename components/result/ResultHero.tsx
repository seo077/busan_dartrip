/**
 * S3 결과 — 첫 화면(스크롤 전).
 *
 * 설계 정본: `화면구성도.md` §5.1(와이어프레임) · §5.3(구성 요소) · §5.4(상태) · §5.5(전이)
 *
 * 다트가 꽂힌 **한 곳을 화면 가득** 보여 주는 자리입니다(D-10). 고르는 부담을 없애는 것이
 * 이 화면의 목적이라, 다른 후보를 여기에 함께 두지 않습니다 — 근처는 스크롤 아래에 있습니다.
 *
 * 사진이 없는 장소가 많습니다. 그래서 배경은 **언제나 테마별 그라데이션**이고 사진은 그 위에
 * 얹는 것으로 둡니다(§5.4 "사진 없음" · "사진 로드 실패"가 같은 자리로 수렴합니다).
 * 사진 유무는 노출 순서에 영향을 주지 않습니다(§5.3-1).
 *
 * 장소명 탭 → S4 전이(§5.5)는 S4 화면이 생긴 뒤에 잇습니다. 지금 링크를 걸면 404 로 갑니다.
 */

import Link from "next/link";

import { HeroImage } from "@/components/result/HeroImage";
import { ShareButton } from "@/components/result/ShareButton";
import type { PlaceView } from "@/components/result/types";
import { themeGradient, themeIcon, themeLabel } from "@/lib/format";

/**
 * 카카오맵 길찾기 (§5.3-5 · §2.5).
 * 출발지를 우리가 정하지 않습니다 — 브라우저 위치 권한을 요청하지 않기로 했으므로(AD-9)
 * 출발지 결정은 카카오맵에 맡깁니다.
 */
function directionsHref(place: PlaceView): string {
  return `https://map.kakao.com/link/to/${encodeURIComponent(place.name)},${place.lat},${place.lng}`;
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-black/45 px-3 py-1 text-xs text-[#F2F4F7] backdrop-blur-sm">
      {children}
    </span>
  );
}

export function ResultHero({
  place,
  sigunguName,
  nearbyCount,
  rethrowHref,
}: {
  place: PlaceView;
  sigunguName: string;
  nearbyCount: number;
  /** [다시 던지기] — 던졌을 때의 범위·테마를 그대로 달고 S1 로 (§5.3-6) */
  rethrowHref: string;
}) {
  return (
    <section
      className="relative flex min-h-[86svh] flex-col justify-end overflow-hidden"
      style={{ background: themeGradient(place.theme) }}
    >
      {place.image ? <HeroImage src={place.image} /> : null}

      {/* 위아래 그라데이션 — 사진 위에서도 글씨가 읽히게 (§5.1) */}
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-b from-black/55 via-black/10 to-[#0E1116]"
      />

      {/* 상단 바 (§5.1) — 좌: 뒤로 / 우: 공유 */}
      <header className="absolute inset-x-0 top-0 z-10 flex h-14 items-center justify-between px-2">
        <Link
          href="/"
          aria-label="처음으로"
          className="flex h-11 w-11 items-center justify-center rounded-full text-xl text-[#F2F4F7]"
        >
          ←
        </Link>
        <ShareButton
          title={`${place.name} — 부산 Dartrip`}
          text={`다트가 ${sigunguName} ${place.name}에 꽂혔어요.`}
        />
      </header>

      <div className="relative z-10 px-5 pb-7">
        {/* 배지 (§5.3-2·3) */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Badge>
            <span aria-hidden>{themeIcon(place.theme)}</span> {themeLabel(place.theme)}
          </Badge>
          {place.isHiddenGem ? <Badge>✨ 숨은 곳</Badge> : null}
          {place.isGoodRestaurant ? <Badge>🏅 모범음식점</Badge> : null}
        </div>

        {/* 장소명 — 사진이 없을 때는 더 크게 두어 그 자체가 화면이 되게 합니다 (§5.4) */}
        <h1
          className={`font-bold break-keep text-[#F2F4F7] ${
            place.image ? "text-3xl leading-tight" : "text-4xl leading-snug"
          }`}
        >
          {place.name}
        </h1>
        <p className="mt-2 text-base text-[#F2F4F7]/85">{sigunguName}</p>
        {place.address ? (
          <p className="mt-1 text-sm break-keep text-[#98A2B3]">{place.address}</p>
        ) : null}

        {/* 액션 (§5.3-5·6) */}
        <div className="mt-6 grid grid-cols-2 gap-3">
          <a
            href={directionsHref(place)}
            target="_blank"
            rel="noreferrer noopener"
            className="flex min-h-12 items-center justify-center rounded-2xl border border-white/20 bg-black/40 text-sm font-semibold text-[#F2F4F7] backdrop-blur-sm"
          >
            🧭 길찾기
          </a>
          <Link
            href={rethrowHref}
            className="flex min-h-12 items-center justify-center rounded-2xl bg-[#FF4D4D] text-sm font-semibold text-white"
          >
            🎯 다시 던지기
          </Link>
        </div>

        {/* 스크롤 유도 (§5.1) — 근처가 0곳이면 아래에 목록이 없으므로 두지 않습니다 */}
        {nearbyCount > 0 ? (
          <a
            href="#nearby"
            className="mt-6 block text-center text-sm text-[#98A2B3]"
          >
            <span aria-hidden>⌄</span> 이 근처 {nearbyCount}곳
          </a>
        ) : null}
      </div>
    </section>
  );
}

export default ResultHero;
