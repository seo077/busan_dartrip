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
 * 이번 회차의 범위
 * ----------------
 * 목록을 읽어 보여 주는 것까지가 이번 작업입니다. 작성 시트(§6.2)와 사진 업로드는
 * 다음 구간(Phase 5)의 일이라, 여기서는 **자리와 안내만** 둡니다. 누르면 아무 일도 일어나지
 * 않는 버튼을 두지 않으려고, 버튼 대신 준비 중이라는 사실을 적었습니다 (§2.4).
 */

import type { ReviewView } from "@/components/place/types";

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function ReviewSection({ reviews }: { reviews: ReviewView[] }) {
  return (
    <section className="border-t border-white/10 px-5 py-6">
      <h2 className="mb-3 text-sm font-semibold text-[#98A2B3]">
        다녀온 사람들{reviews.length > 0 ? ` (${reviews.length})` : ""}
      </h2>

      {reviews.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-[#171B22] p-6 text-center">
          <p className="text-sm break-keep text-[#F2F4F7]">아직 기록이 없어요.</p>
          <p className="mt-1 text-sm break-keep text-[#98A2B3]">첫 기록을 남겨보세요.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {reviews.map((review) => (
            <li key={review.id} className="rounded-2xl border border-white/10 bg-[#171B22] p-4">
              {review.body ? (
                <p className="text-sm leading-relaxed break-keep text-[#F2F4F7]">{review.body}</p>
              ) : (
                <p className="text-sm text-[#98A2B3]">다녀왔어요</p>
              )}
              <p className="mt-2 text-xs text-[#98A2B3]">{formatDate(review.createdAt)}</p>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 rounded-2xl border border-dashed border-white/15 p-4 text-center">
        <p className="text-sm font-medium text-[#F2F4F7]">✓ 다녀왔어요</p>
        <p className="mt-1 text-xs break-keep text-[#98A2B3]">
          기록 남기기는 준비 중이에요. 한 줄과 사진 모두 선택이고,
          <br />
          별점은 받지 않습니다 — 숫자가 장소를 다시 가리기 때문이에요.
        </p>
      </div>
    </section>
  );
}

export default ReviewSection;
