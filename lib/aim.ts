/**
 * 다트 조준의 셈 부분 — 당긴 벡터를 지도 위의 한 점으로, 그 점을 구·군 하나로 바꿉니다.
 *
 * 설계 정본: `AI 논의사항.md` Round 1 §D-36(다트 조준) / D-3(구·군 균등 2단) · D-4(범위 선택)
 *
 * ── 이 파일이 지키는 약속 ────────────────────────────────────────────────────
 * **겨눈 대로 갑니다.** 여기서 고른 구·군이 그대로 `/api/throw` 의 `scope` 로 나가고,
 * 화면이 조준 중에 보여 준 이름과 결과의 구·군이 같습니다. 궤적을 몰래 휘게 하거나
 * 확률을 손보는 처리가 이 파일에 없습니다 — 그런 자리를 두지 않았습니다.
 *
 * **바뀌지 않는 것**: 구·군이 정해진 다음의 장소 추출은 여전히 균등입니다(D-3 2단계).
 * 조준으로 정해지는 것은 구·군 하나뿐이고, 특정 장소를 겨눠 맞출 수는 없습니다.
 * 조준을 쓰지 않으면(부산 전체 모드·키보드·모션 최소화) 종전대로 16개 구·군 균등입니다
 * (D-3 1단계).
 *
 * ── 당김 → 조준점 (세기 = 거리, 방향 = 좌우) ────────────────────────────────
 * 던지는 몸짓 그대로입니다.
 *   · **세게 당길수록 멀리** — 지도의 위쪽(북쪽)에 꽂힙니다. 살짝 당기면 아래쪽(남쪽)입니다.
 *   · **당긴 반대쪽으로** — 오른쪽으로 당기면 **왼쪽**으로 날아갑니다 (`D-60-1` — 새총).
 *
 * **좌우 방향이 `D-60`에서 뒤집혔습니다 (2026-08-09).** 그 전까지는 당긴 쪽 그대로였고,
 * 이 자리에 *"좌우는 뒤집지 않습니다 — 오른쪽을 겨눴으면 오른쪽으로 가야 합니다"* 라고
 * 적혀 있었습니다. **값이 아니라 방향의 정의가 바뀐 것**이며(`D-36` 개정), 은유가 「겨눔」에서
 * 「새총」으로 옮겨간 결과입니다 — 새총은 물린 것을 **당긴 반대쪽으로** 보냅니다.
 * 세로(세기)는 그대로입니다.
 *
 * 이 두 가지를 곱하면 지도의 **어느 자리든** 던질 수 있는 세기 안에서 닿습니다.
 * 당김 벡터를 그대로 좌표로 옮겨 쓰지 않고 이렇게 나눈 이유가 여기 있습니다 — 그대로 옮기면
 * 지도 한가운데를 겨누려면 당김이 0이어야 하는데, 그 세기로는 다트가 지도까지 못 갑니다.
 * 가운데에 몰려 있는 구·군(중구·동구·부산진구·연제구·수영구·동래구·사상구)이 통째로
 * 겨눌 수 없게 됩니다. 세기를 "거리" 로 읽으면 그 자리가 정확히 중간 세기에 놓입니다.
 *
 * 던질 수 있는 최소 세기(`MIN_THROW_POWER`)가 지도의 아래 끝, 최대가 위 끝입니다.
 * 그보다 약하게 놓으면 지도에 닿지 못하고 떨어집니다 — 화면의 "못 미쳤어요" 와 같은 말입니다.
 * 조준점은 당기는 내내 화면에 보이므로 손으로 맞춰 갈 수 있습니다.
 *
 * ── 조준점 → 구·군 ──────────────────────────────────────────────────────────
 * 16개 구·군의 중심점을 지도 좌표로 옮겨 두고, 조준점에서 **가장 가까운 중심**을 고릅니다.
 * 화면에는 그 16개 중심이 표식으로 그려지고 고른 하나가 밝아지므로, 판정 기준이 사용자에게
 * 그대로 보입니다(행정 경계선이 아니라 "가장 가까운 표식"이 기준이라는 것이 화면에 드러납니다).
 *
 * **판정에 드는 것은 화면에 표식이 그려진 구·군뿐입니다.** 지도가 비추는 범위를 벗어난
 * 중심점은 표식이 없어 사용자가 겨눌 근거를 볼 수 없는데, 그런 것이 판정에 남아 있으면
 * 화면 어디에도 없는 이름이 결과로 나옵니다. 지도 쪽에서 조준 대상 전부가 들어오도록
 * 범위를 맞추고(`BusanMap` `fitBounds`), 여기서 한 번 더 걸러 둘이 어긋날 자리를 없앱니다.
 */

import { MIN_THROW_POWER, pullPower, type Point } from "@/lib/gesture";

export interface BoxSize {
  width: number;
  height: number;
}

/** 지도가 지금 비추고 있는 범위 + 그 상자 크기. 조준점을 실제 좌표로 옮기는 근거입니다. */
export interface MapViewport {
  swLat: number;
  swLng: number;
  neLat: number;
  neLng: number;
  width: number;
  height: number;
}

/** 조준 대상 후보 — 구·군 하나와 지금 테마의 후보 건수 */
export interface AimCandidate {
  code: string;
  name: string;
  lat: number;
  lng: number;
  /** 현재 테마 기준 후보 건수. 0이면 던져도 나올 장소가 없습니다(§7.2). */
  count: number;
}

/** 지도 상자 안의 px 자리로 옮겨진 조준 대상 */
export interface AimTarget extends AimCandidate {
  x: number;
  y: number;
  /** 지도가 비추는 범위 밖이라 표식을 그리지 않는 대상 */
  offscreen: boolean;
}

export interface AimState {
  /** 조준점 — 지도 상자 기준 px */
  point: Point;
  target: AimTarget;
  /** 두 번째로 가까운 구·군이 코앞일 때. 사용자가 손을 조금 더 옮길 수 있게 알려 줍니다. */
  borderline: boolean;
}

/** 조준점이 상자 가장자리에 붙어 잘리지 않도록 두는 여백(px) */
const AIM_INSET_PX = 18;

/** 구·군이 모여 있는 자리 둘레로 두는 여백(px) — 가장자리 구·군도 넉넉히 겨눌 수 있게 */
const EXTENT_PAD_PX = 16;

/** 조준 범위가 지나치게 좁아지지 않게 두는 최소 크기(px) */
const MIN_EXTENT_PX = 60;

/** 조준이 훑는 직사각형 — 지도 상자가 아니라 **구·군이 실제로 놓인 자리**입니다. */
export interface AimExtent {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** 이 차이 안쪽이면 "경계 근처" 로 알립니다(px) */
const BORDERLINE_PX = 13;

function clamp(value: number, min: number, max: number): number {
  if (max < min) return (min + max) / 2;
  return Math.min(max, Math.max(min, value));
}

/**
 * 조준이 훑을 범위.
 *
 * 지도 상자 전체가 아니라 **구·군 표식이 실제로 놓인 자리**에 맞춥니다. 부산은 지도 상자
 * 안에서 한쪽에 몰려 있고 나머지는 바다·경남이라, 상자 전체를 훑게 두면 손가락 움직임의
 * 절반 이상이 겨눌 것 없는 자리에 쓰입니다. 범위를 좁혀 두면 같은 손동작으로 구·군 사이를
 * 더 곱게 오갈 수 있습니다 — 밀집한 원도심(중구·동구·서구·영도구)에서 특히 차이가 납니다.
 */
export function aimExtent(targets: readonly AimTarget[], box: BoxSize): AimExtent {
  const insetX = Math.min(AIM_INSET_PX, box.width / 2);
  const insetY = Math.min(AIM_INSET_PX, box.height / 2);
  const full: AimExtent = {
    minX: insetX,
    minY: insetY,
    maxX: box.width - insetX,
    maxY: box.height - insetY,
  };

  const visible = targets.filter((t) => !t.offscreen);
  if (visible.length === 0) return full;

  const xs = visible.map((t) => t.x);
  const ys = visible.map((t) => t.y);
  let minX = Math.min(...xs) - EXTENT_PAD_PX;
  let maxX = Math.max(...xs) + EXTENT_PAD_PX;
  let minY = Math.min(...ys) - EXTENT_PAD_PX;
  let maxY = Math.max(...ys) + EXTENT_PAD_PX;

  // 표식이 몰려 있어도 조준 범위가 바늘구멍이 되지는 않게 합니다.
  if (maxX - minX < MIN_EXTENT_PX) {
    const mid = (minX + maxX) / 2;
    minX = mid - MIN_EXTENT_PX / 2;
    maxX = mid + MIN_EXTENT_PX / 2;
  }
  if (maxY - minY < MIN_EXTENT_PX) {
    const mid = (minY + maxY) / 2;
    minY = mid - MIN_EXTENT_PX / 2;
    maxY = mid + MIN_EXTENT_PX / 2;
  }

  return {
    minX: Math.max(full.minX, minX),
    minY: Math.max(full.minY, minY),
    maxX: Math.min(full.maxX, maxX),
    maxY: Math.min(full.maxY, maxY),
  };
}

/**
 * 당긴 벡터 → 지도 위의 조준점.
 *
 *   세로 = 세기.   던질 수 있는 최소 세기가 범위의 아래 끝, 최대 세기가 위 끝입니다.
 *   가로 = 방향.   똑바로 당기면 가운데, 옆으로 눕힐수록 **당긴 반대쪽**으로 벌어집니다
 *                  (`D-60-1` 새총 — r1~ 은 당긴 쪽이었습니다).
 *                  각도에 비례시켜(사인이 아니라) 똑바로 당기는 근처에서 덜 예민하게 뒀습니다.
 */
export function aimPointFromPull(pull: Point, extent: AimExtent): Point {
  const power = pullPower(pull);
  const reach = clamp((power - MIN_THROW_POWER) / (1 - MIN_THROW_POWER), 0, 1);

  // 당김 방향이 수직에서 좌우로 얼마나 기울었는지 (-90°~+90° → -1~+1).
  // **부호를 뒤집습니다** — 오른쪽으로 당기면 왼쪽(-), 왼쪽으로 당기면 오른쪽(+)입니다
  // (`D-60-1` 새총). 앞 판본은 뒤집지 않았고, 그 시절 주석이 이 자리에 있었습니다.
  const lateral =
    power === 0
      ? 0
      : -clamp(Math.atan2(pull.x, Math.abs(pull.y) || 1e-6) / (Math.PI / 2), -1, 1);

  const midX = (extent.minX + extent.maxX) / 2;
  const halfW = (extent.maxX - extent.minX) / 2;

  return {
    x: clamp(midX + lateral * halfW, extent.minX, extent.maxX),
    y: clamp(extent.maxY - reach * (extent.maxY - extent.minY), extent.minY, extent.maxY),
  };
}

/** 위경도 → 지도 상자 안 px. 한 화면 안에서는 선형 보간으로 충분합니다. */
export function toContainerPoint(
  lat: number,
  lng: number,
  viewport: MapViewport,
): Point {
  const spanLat = viewport.neLat - viewport.swLat;
  const spanLng = viewport.neLng - viewport.swLng;
  if (spanLat === 0 || spanLng === 0) {
    return { x: viewport.width / 2, y: viewport.height / 2 };
  }
  return {
    x: ((lng - viewport.swLng) / spanLng) * viewport.width,
    y: ((viewport.neLat - lat) / spanLat) * viewport.height,
  };
}

/** 구·군 중심점들을 지금 지도 상자 좌표로 옮깁니다. */
export function projectTargets(
  candidates: readonly AimCandidate[],
  viewport: MapViewport,
): AimTarget[] {
  const margin = 6;
  return candidates.map((c) => {
    const p = toContainerPoint(c.lat, c.lng, viewport);
    return {
      ...c,
      x: p.x,
      y: p.y,
      offscreen:
        p.x < -margin ||
        p.y < -margin ||
        p.x > viewport.width + margin ||
        p.y > viewport.height + margin,
    };
  });
}

/**
 * 조준점에서 가장 가까운 구·군을 고릅니다. 판정은 이 하나뿐입니다.
 *
 * **넘기는 대상은 화면에 표식이 그려진 것들뿐입니다**(`resolveAim` 가 걸러 냅니다).
 * 화면 밖 표식이 판정에 끼면 사용자가 **본 적 없는 구·군**이 결과가 되고, 그때는 조준점을
 * 어디로 옮겨야 하는지 화면에 단서가 없습니다.
 */
export function pickTarget(
  point: Point,
  targets: readonly AimTarget[],
): { target: AimTarget; borderline: boolean } | null {
  if (targets.length === 0) return null;

  let best: AimTarget = targets[0];
  let bestD = Number.POSITIVE_INFINITY;
  let secondD = Number.POSITIVE_INFINITY;

  for (const t of targets) {
    const d = Math.hypot(t.x - point.x, t.y - point.y);
    if (d < bestD) {
      secondD = bestD;
      bestD = d;
      best = t;
    } else if (d < secondD) {
      secondD = d;
    }
  }

  return { target: best, borderline: Number.isFinite(secondD) && secondD - bestD < BORDERLINE_PX };
}

/**
 * 당김 한 번 → 조준 결과 한 벌. 화면 표시와 실제 던지기가 **같은 함수**를 씁니다.
 *
 * 조준 범위도 판정도 **화면에 표식이 그려진 구·군**만 씁니다. 지도가 조준 대상 전부를
 * 담도록 맞춰져 있으면(`BusanMap` `fitBounds`) 걸러지는 것이 없고, 어떤 이유로 일부가 화면
 * 밖으로 밀려도 "보이는 것만 결과가 된다" 는 약속이 깨지지 않습니다.
 */
export function resolveAim(
  pull: Point,
  box: BoxSize,
  targets: readonly AimTarget[],
): AimState | null {
  if (box.width <= 0 || box.height <= 0) return null;
  const visible = targets.filter((t) => !t.offscreen);
  const pool = visible.length > 0 ? visible : targets;
  const point = aimPointFromPull(pull, aimExtent(pool, box));
  const picked = pickTarget(point, pool);
  if (!picked) return null;
  return { point, target: picked.target, borderline: picked.borderline };
}
