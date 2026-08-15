/**
 * S4 — 제목·배지·길찾기 (§6.1 · §6.3-2·3).
 *
 * 설계 정본: `화면구성도.md` §6.1 · §6.3-2("없을 때: 배지만 생략") · §6.3-3("항상 표시")
 *            D-11(모범음식점 배지) · `API데이터설계.md` §3.7
 *
 * 모범음식점 배지(🏅)에 대하여
 * ---------------------------
 * **표시 전용입니다.** 이 값이 노출 여부·순서·필터에 관여하는 코드가 서비스 어디에도 없습니다
 * (D-11 · D-26). 지방자치단체가 위생을 직접 점검해 지정한 행정 인증이라 "알려주기" 의 값은
 * 있지만, 그것으로 다른 음식점을 걸러내면 별점 필터를 이름만 바꿔 되살리는 셈이 됩니다.
 * 배지가 없는 음식점도 같은 확률로 뽑히고 같은 순서에 놓입니다.
 *
 * 길찾기는 언제나 있습니다(§6.3-3). 출발지는 우리가 정하지 않습니다 — 브라우저 위치 권한을
 * 요청하지 않기로 했으므로(AD-9) 출발지 결정은 카카오맵에 맡깁니다.
 */

import type { PlaceDetailView } from "@/components/place/types";
import { themeIcon, themeLabel } from "@/lib/format";

function directionsHref(place: PlaceDetailView): string {
  return `https://map.kakao.com/link/to/${encodeURIComponent(place.name)},${place.lat},${place.lng}`;
}

function Badge({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <span className="rounded-full border border-line bg-line/50 px-2.5 py-1 text-xs text-ink">
      <span aria-hidden>{children}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function PlaceTitle({ place }: { place: PlaceDetailView }) {
  return (
    <section className="px-5 pt-5 pb-6">
      <div className="flex items-start justify-between gap-3">
        <h1 className="text-2xl leading-tight font-bold break-keep text-ink">
          {place.name}
        </h1>
        <div className="mt-1 flex shrink-0 gap-1.5">
          {place.isGoodRestaurant ? <Badge label="모범음식점">🏅</Badge> : null}
          {place.isHiddenGem ? <Badge label="숨은 곳">✨</Badge> : null}
        </div>
      </div>

      <p className="mt-2 text-sm text-ink-muted">
        <span aria-hidden>{themeIcon(place.theme)}</span> {themeLabel(place.theme)} ·{" "}
        {place.sigunguName}
      </p>

      {place.isGoodRestaurant ? (
        <p className="mt-2 text-[11px] break-keep text-ink-muted">
          🏅 지방자치단체가 지정한 모범음식점이에요. 알려드릴 뿐, 이 표시로 다른 곳을 덜
          보여주지는 않아요.
        </p>
      ) : null}

      <a
        href={directionsHref(place)}
        target="_blank"
        rel="noreferrer noopener"
        className="mt-5 flex min-h-12 items-center justify-center rounded-2xl bg-brand-deep text-sm font-semibold text-white"
      >
        🧭 길찾기
      </a>
    </section>
  );
}

export default PlaceTitle;
