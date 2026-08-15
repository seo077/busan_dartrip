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
 * 테마 색 (`D-61-1` 팔레트 「감천」).
 *
 * **배정은 고정입니다** (`D-61-2`) — 이 네 색을 식도락·자연·문화·예술·액티비티에 그대로 매어
 * 둡니다. 화면마다 다른 색을 쓰면 스탬프판·결과 카드·테마 버튼이 서로 다른 말을 합니다.
 * 값의 단일 출처는 `app/globals.css` 의 토큰이고, 여기 있는 것은 **인라인 style 로만 쓸 수 있는
 * 자리**(그라데이션·SVG 등)를 위한 같은 값의 사본입니다. Tailwind 클래스로 쓸 수 있는 자리는
 * `bg-food`·`text-nature` 같은 토큰 유틸리티를 씁니다.
 */
export const THEME_COLORS: Record<ThemeKey, string> = {
  food: "#F4826B",
  nature: "#7FBF9B",
  culture: "#F2C14E",
  activity: "#6FA8DC",
};

/** 포인트 색 (`D-61-1` — 다트·주요 행동). 테마가 없는 자리의 대표색으로도 씁니다. */
export const BRAND_COLOR = "#E85D75";

/** 테마 색 하나. 테마가 없으면 포인트 색입니다. */
export function themeColor(theme: ThemeKey | null): string {
  return theme === null ? BRAND_COLOR : THEME_COLORS[theme];
}

/**
 * 테마별 기본 배경 (§5.4 "사진 없음" 상태).
 * 이미지 자산이 아직 없어 그라데이션으로 대신합니다. 대표 이미지 확정은 구간 ⑦ 작업입니다.
 *
 * 각 테마 색과 그 색을 흰쪽으로 45% 섞은 옅은 짝을 잇습니다 — 밝은 화면(`D-61-3`)에 얹히는
 * 면이라 어두운 그라데이션을 그대로 두면 이 자리만 검게 남습니다.
 */
export const THEME_GRADIENTS: Record<ThemeKey, string> = {
  food: "linear-gradient(160deg, #F9BAAE 0%, #F4826B 100%)",
  nature: "linear-gradient(160deg, #B9DCC8 0%, #7FBF9B 100%)",
  culture: "linear-gradient(160deg, #F8DD9E 0%, #F2C14E 100%)",
  activity: "linear-gradient(160deg, #B0CFEC 0%, #6FA8DC 100%)",
};

export function themeGradient(theme: ThemeKey | null): string {
  return theme === null
    ? "linear-gradient(160deg, #FFF8F0 0%, #F0E3D6 100%)"
    : THEME_GRADIENTS[theme];
}
