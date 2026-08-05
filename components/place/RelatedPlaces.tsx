/**
 * S4 — 함께 가볼 만한 곳 (§6.1 · §6.3-7 · §6.5).
 *
 * 설계 정본: `화면구성도.md` §6.1(가로 스크롤) · §6.3-7("없을 때: 블록 통째 생략")
 *            `API데이터설계.md` §3.2(연관관광지)
 *
 * **비면 아무것도 그리지 않습니다.** 연관관광지는 등재된 주요 관광지에만 데이터가 있고,
 * F4 로 발굴한 숨은 명소는 정의상 이 데이터가 없습니다(§6.3 주석). 빈 블록을 남기면
 * "정보 없는 곳 = 별로인 곳" 인상이 생겨, 발굴한 장소를 다시 가립니다 (AD-8).
 *
 * **번호를 매기지 않습니다.** 이 API 는 연관 순위를 함께 주지만 우리는 그 값을 읽지 않고
 * 화면에도 두지 않습니다. 순위를 보이는 순간 D-10·D-11·D-12 가 없애려 한 서열이 생깁니다.
 *
 * 우리 `places` 에 같은 이름이 있는 것만 S4 로 잇습니다(§6.5). 없는 것은 링크 없는 칸으로
 * 두어, 눌렀는데 "찾을 수 없는 장소" 로 가는 일이 없게 합니다.
 */

import Link from "next/link";

import type { RelatedView } from "@/components/place/types";

function Card({ item }: { item: RelatedView }) {
  const inner = (
    <>
      <p className="line-clamp-2 text-sm font-medium break-keep text-[#F2F4F7]">{item.name}</p>
      <p className="mt-1 line-clamp-1 text-xs text-[#98A2B3]">
        {[item.region, item.category].filter(Boolean).join(" · ") || " "}
      </p>
    </>
  );

  const className =
    "flex h-24 w-36 shrink-0 snap-start flex-col justify-end rounded-2xl border border-white/10 bg-[#171B22] p-3";

  return item.placeId ? (
    <Link href={`/place/${item.placeId}`} className={className}>
      {inner}
    </Link>
  ) : (
    <div className={className}>{inner}</div>
  );
}

export function RelatedPlaces({ items }: { items: RelatedView[] }) {
  if (items.length === 0) return null;

  return (
    <section className="border-t border-white/10 py-6">
      <h2 className="mb-3 px-5 text-sm font-semibold text-[#98A2B3]">함께 가볼 만한 곳</h2>

      <div className="flex snap-x gap-2 overflow-x-auto px-5 pb-1">
        {items.map((item) => (
          <Card key={`${item.name}-${item.region ?? ""}`} item={item} />
        ))}
      </div>

      <p className="mt-3 px-5 text-[11px] text-[#98A2B3]">
        한국관광공사 연관관광지 정보에서 가져왔어요. 순위가 아니라 함께 찾는 곳들이에요.
      </p>
    </section>
  );
}

export default RelatedPlaces;
