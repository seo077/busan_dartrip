"use client";

/**
 * S3 결과 — "이 근처" (스크롤 후).
 *
 * 설계 정본: `화면구성도.md` §5.2(와이어프레임) · §5.3-7·8·9 · §5.4("근처 빈값")
 *            `API데이터설계.md` §7.4("이 근처" 조회) · §7.5(반경 3km 근거)
 *
 * **순서는 거리 하나로만 정해집니다.** 목록은 서버가 이미 거리순으로 정렬해 스냅샷에 넣어 둔
 * 것을 그대로 그립니다(`lib/dart.ts` `loadNearby`). 이 파일에는 재정렬도, 거르기도 없습니다 —
 * 평점·인기·조회수는 스키마에 컬럼 자체가 없어서 넣을 수도 없습니다(D-10·D-11·D-12).
 * 모범음식점(🏅)·숨은 곳(✨)은 **배지일 뿐** 순서에 관여하지 않습니다(§5.3-9).
 *
 * 순서 기준을 화면에 문장으로 적는 것이 이 화면의 요구사항입니다(§5.3 주석) —
 * "가까운 순" 이라고 쓰지 않으면 사용자는 목록을 추천 순위로 읽습니다.
 *
 * 브라우저에서 도는 이유는 [더 보기] 하나뿐입니다. 목록 값 자체는 서버에서 통째로 받으므로
 * 여기서 따로 불러오는 것이 없고, 자바스크립트가 늦어도 첫 10곳은 이미 화면에 있습니다.
 */

import { useState } from "react";
import Link from "next/link";

import type { NearbyView } from "@/components/result/types";
import { formatDistance, themeGradient, themeIcon, themeLabel } from "@/lib/format";

/** 처음에 펼쳐 두는 건수 (§5.3-7 "초기 10건 + 더 보기") */
const INITIAL_COUNT = 10;

function Thumb({ item }: { item: NearbyView }) {
  const [failed, setFailed] = useState(false);
  const showImage = item.image !== null && !failed;

  return (
    <div
      className="h-20 w-20 shrink-0 overflow-hidden rounded-xl"
      style={{ background: themeGradient(item.theme) }}
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.image as string}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <span
          aria-hidden
          className="flex h-full w-full items-center justify-center text-2xl opacity-70"
        >
          {themeIcon(item.theme)}
        </span>
      )}
    </div>
  );
}

export function NearbyList({
  originName,
  items,
  rethrowHref,
}: {
  /** 거리를 재는 기준이 된 장소 = 다트가 꽂힌 곳 */
  originName: string;
  items: NearbyView[];
  /** 근처가 비었을 때 내미는 다음 행동 (§5.4 · §2.4) */
  rethrowHref: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? items : items.slice(0, INITIAL_COUNT);

  // 근처 빈값 (§5.4) — 막다른 안내문으로 끝내지 않습니다.
  if (items.length === 0) {
    return (
      <section id="nearby" className="scroll-mt-4 px-5 py-10">
        <h2 className="text-lg font-bold text-[#F2F4F7]">이 근처</h2>
        <div className="mt-4 rounded-2xl border border-white/10 bg-[#171B22] p-6 text-center">
          <p className="text-sm leading-relaxed break-keep text-[#F2F4F7]">
            주변 3km 안에는 다른 장소가 없어요.
            <br />이 곳만의 시간을 보내보세요
          </p>
          <Link
            href={rethrowHref}
            className="mt-5 inline-flex min-h-11 items-center justify-center rounded-2xl border border-white/20 px-6 text-sm text-[#F2F4F7]"
          >
            다시 던지기
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section id="nearby" className="scroll-mt-4 px-5 py-10">
      <h2 className="text-lg font-bold text-[#F2F4F7]">이 근처</h2>
      {/* 정렬 기준을 문장으로 (§5.2 · §5.3 주석) — 순위가 아니라 거리라는 사실 */}
      <p className="mt-1 text-sm break-keep text-[#98A2B3]">
        {originName}에서 가까운 순으로 보여드려요
      </p>

      <ul className="mt-4 space-y-2">
        {shown.map((item) => (
          <li
            key={item.id}
            className="flex items-center gap-3 rounded-2xl border border-white/10 bg-[#171B22] p-3"
          >
            <Thumb item={item} />
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <p className="truncate font-medium text-[#F2F4F7]">{item.name}</p>
                <span className="shrink-0 text-sm" aria-hidden>
                  {item.isGoodRestaurant ? "🏅" : ""}
                  {item.isHiddenGem ? "✨" : ""}
                </span>
              </div>
              {item.isGoodRestaurant || item.isHiddenGem ? (
                <span className="sr-only">
                  {item.isGoodRestaurant ? "모범음식점 " : ""}
                  {item.isHiddenGem ? "숨은 곳" : ""}
                </span>
              ) : null}
              <p className="mt-1 text-sm text-[#98A2B3]">
                <span aria-hidden>{themeIcon(item.theme)}</span> {themeLabel(item.theme)} ·{" "}
                {formatDistance(item.distanceM)}
              </p>
            </div>
          </li>
        ))}
      </ul>

      {/* 더 보기 (§5.2) */}
      {!expanded && items.length > INITIAL_COUNT ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-3 min-h-12 w-full rounded-2xl border border-white/15 text-sm text-[#F2F4F7]"
        >
          더 보기 ({items.length}곳 중 {INITIAL_COUNT})
        </button>
      ) : null}
    </section>
  );
}

export default NearbyList;
