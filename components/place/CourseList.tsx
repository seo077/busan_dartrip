/**
 * S4 — 주변 도보 코스 (§6.1 · §6.3-8).
 *
 * 설계 정본: `화면구성도.md` §6.1 · §6.3-8("없을 때: 블록 통째 생략")
 *            `API데이터설계.md` §3.3(두루누비) · §5.3(`courses`)
 *
 * 두 곳에서 옵니다.
 *   · `courses` 표 — 시작점 좌표가 있어 **"여기서 몇 km" 를 실제로 잽니다**. 외부 호출 0회.
 *   · 두루누비 응답 — 좌표가 없어 거리는 못 재고, 같은 시·군의 코스를 뒤에 덧붙입니다.
 *
 * 그래서 줄마다 보이는 값이 다릅니다. 거리를 아는 줄은 거리를, 모르는 줄은 코스 길이와
 * 지역을 적습니다. **모르는 값을 그럴듯하게 채우지 않는 것**이 이 화면의 규칙입니다.
 *
 * 비면 블록을 통째로 감춥니다 (AD-8).
 */

import type { CourseView } from "@/components/place/types";
import { formatDistance } from "@/lib/format";

function subtitle(course: CourseView): string {
  const parts: string[] = [];
  if (course.distanceM !== null) parts.push(`여기서 ${formatDistance(course.distanceM)}`);
  else if (course.region) parts.push(course.region);
  if (course.lengthKm !== null) parts.push(`코스 ${course.lengthKm}km`);
  if (course.kind) parts.push(course.kind);
  return parts.join(" · ");
}

export function CourseList({ courses }: { courses: CourseView[] }) {
  if (courses.length === 0) return null;

  return (
    <section className="border-t border-line px-5 py-6">
      <h2 className="mb-3 text-sm font-semibold text-ink-muted">주변 도보 코스</h2>

      <ul className="space-y-2">
        {courses.map((course) => (
          <li
            key={course.id}
            className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-4"
          >
            <span aria-hidden className="text-lg">
              🥾
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-ink">{course.name}</p>
              <p className="mt-0.5 truncate text-xs text-ink-muted">{subtitle(course)}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default CourseList;
