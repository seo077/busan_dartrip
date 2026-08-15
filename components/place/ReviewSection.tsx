/**
 * S4 — 다녀온 사람들 (§6.1 · §6.3-9·10 · §6.2).
 *
 * 설계 정본: `화면구성도.md` §6.1 · §6.2(후기 작성 시트) · §6.3-9·10
 *            D-12(별점 없음) / `ARCHITECTURE.md` AD-6
 *
 * **별점이 없습니다.** `reviews` 테이블에 평점 컬럼 자체가 없어서, 이 화면에 숫자를 넣고
 * 싶어도 넣을 값이 없습니다. 설계가 그것을 스키마로 고정한 이유를 §6.2 는 사용자에게도
 * 그대로 말하기로 했습니다 — "별점은 받지 않습니다. 숫자가 장소를 다시 가리기 때문이에요."
 *
 * 순서는 최신순 하나뿐입니다
 * -------------------------
 * 정렬을 고를 자리를 두지 않았습니다. 추천 수·좋아요를 셀 컬럼도 없습니다. 후기는 순위
 * 데이터가 아니라 흔적이고, 그 흔적에 순위가 생기는 순간 다트가 발견시킨 장소가 다시
 * 가려지기 때문입니다(D-12 · D-11 과 같은 논리).
 *
 * 작성은 `ReviewComposer` 가 맡습니다 — 이 컴포넌트는 서버에서 그려지고, 시트는 브라우저에서
 * 도는 별도 조각입니다.
 */

import { ReviewComposer } from "@/components/place/ReviewComposer";
import type { ReviewView } from "@/components/place/types";

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function ReviewSection({
  placeId,
  reviews,
}: {
  placeId: string;
  reviews: ReviewView[];
}) {
  return (
    <section className="border-t border-line px-5 py-6">
      <h2 className="mb-3 text-sm font-semibold text-ink-muted">
        다녀온 사람들{reviews.length > 0 ? ` (${reviews.length})` : ""}
      </h2>

      {reviews.length === 0 ? (
        <div className="rounded-2xl border border-line bg-surface p-6 text-center">
          <p className="text-sm break-keep text-ink">아직 기록이 없어요.</p>
          <p className="mt-1 text-sm break-keep text-ink-muted">첫 기록을 남겨보세요.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {reviews.map((review) => (
            <li
              key={review.id}
              className="flex gap-3 rounded-2xl border border-line bg-surface p-4"
            >
              {review.photoPath ? (
                // Storage 공개 URL 입니다. 후기 사진은 작게 한 장뿐이라 최적화를 거치지 않습니다.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={review.photoPath}
                  alt=""
                  loading="lazy"
                  className="h-16 w-16 shrink-0 rounded-xl border border-line object-cover"
                />
              ) : null}

              <div className="min-w-0 flex-1">
                {review.body ? (
                  <p className="text-sm leading-relaxed break-keep text-ink">{review.body}</p>
                ) : (
                  <p className="text-sm text-ink-muted">다녀왔어요</p>
                )}
                <p className="mt-2 text-xs text-ink-muted">{formatDate(review.createdAt)}</p>
              </div>
            </li>
          ))}
        </ul>
      )}

      <ReviewComposer placeId={placeId} />
    </section>
  );
}

export default ReviewSection;
