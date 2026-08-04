/**
 * 화면 표기 도우미. 서버·클라이언트 어디서나 씁니다(서버 전용 값에 접근하지 않습니다).
 *
 * 설계 정본: `화면구성도.md` §2.3(테마 표기) · §5.3-8(거리 표기)
 */

import { THEME_LABELS, type ThemeKey } from "@/lib/theme";

/** 테마 아이콘 (`화면구성도.md` §2.3) */
export const THEME_ICONS: Record<ThemeKey, string> = {
  food: "🍚",
  nature: "🌊",
  culture: "🎭",
  activity: "🏃",
};

/** '전체' 를 포함한 표기. 테마 미선택(null)은 '전체' 입니다. */
export function themeLabel(theme: ThemeKey | null): string {
  return theme === null ? "전체" : THEME_LABELS[theme];
}

export function themeIcon(theme: ThemeKey | null): string {
  return theme === null ? "◎" : THEME_ICONS[theme];
}

/**
 * 거리 표기 (§5.3-8) — 1km 미만은 "240m", 그 이상은 "1.2km".
 * 10m 단위로 끊어 실제보다 정밀해 보이지 않게 합니다(좌표 자체의 오차가 그보다 큽니다).
 */
export function formatDistance(meters: number): string {
  if (meters < 1000) {
    const rounded = Math.max(0, Math.round(meters / 10) * 10);
    return `${rounded}m`;
  }
  return `${(meters / 1000).toFixed(1)}km`;
}

/**
 * 테마별 기본 배경 (§5.4 "사진 없음" 상태).
 * 이미지 자산이 아직 없어 그라데이션으로 대신합니다. 대표 이미지 확정은 구간 ⑦ 작업입니다.
 */
export const THEME_GRADIENTS: Record<ThemeKey, string> = {
  food: "linear-gradient(160deg, #4A2318 0%, #8A3B22 100%)",
  nature: "linear-gradient(160deg, #0D2E3D 0%, #17677A 100%)",
  culture: "linear-gradient(160deg, #2A1B3D 0%, #6B3FA0 100%)",
  activity: "linear-gradient(160deg, #123322 0%, #2E7D52 100%)",
};

export function themeGradient(theme: ThemeKey | null): string {
  return theme === null
    ? "linear-gradient(160deg, #171B22 0%, #35405A 100%)"
    : THEME_GRADIENTS[theme];
}
