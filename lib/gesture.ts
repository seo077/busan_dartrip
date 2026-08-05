/**
 * 다트 제스처의 셈 부분 — 잡아 당긴 거리를 "세기"로, 세기를 연출 값으로 바꿉니다.
 *
 * 설계 정본: `화면구성도.md` §4.1(3단계 시퀀스) · §4.2(구성 요소) / D-3(구·군 균등 2단) · D-4(범위 선택)
 *
 * **여기에는 결과를 정하는 값이 하나도 없습니다.**
 * 당긴 세기는 날아가는 시간·잔상·기울기에만 쓰고, 당긴 방향은 손에 쥔 느낌을 만드는 데만 씁니다.
 * 어느 쪽으로 얼마나 당겼든 다트가 꽂히는 자리는 서버(`/api/throw`)가 정합니다.
 *
 * 그렇게 두는 이유:
 *   - D-3 은 "부산 16개 구·군 중 **균등 랜덤**" 입니다. 당긴 방향으로 구·군을 맞출 수 있으면
 *     균등이 아니라 사용자가 고른 것이 됩니다.
 *   - 제안서 §필요성 3 은 "고르는 행위를 던지는 행위로 **치환**" 입니다. 조준이 되는 순간
 *     던지는 행위가 다시 고르는 행위가 되어 서비스의 주장이 사라집니다.
 *   - 범위를 좁히고 싶은 사용자를 위한 자리는 이미 D-4(범위 = 부산 전체 / 구·군 선택)에 있습니다.
 *
 * 그래서 이 파일의 함수는 전부 `(세기) → 연출 값` 이며, 좌표·구·군·장소를 다루는 함수가 없습니다.
 */

export interface Point {
  x: number;
  y: number;
}

/** 화면에 놓인 다트의 한 변(px). 비행 계산과 그리기가 같은 값을 씁니다. */
export const DART_SIZE = 56;

/** 당길 수 있는 최대 거리(px). 이보다 더 끌어도 다트는 더 내려오지 않습니다. */
export const MAX_PULL_PX = 132;

/** 손을 놓았다고 보기 위한 최소 이동(px). 이보다 작으면 그냥 톡 건드린 것으로 봅니다. */
export const TAP_SLOP_PX = 8;

/** 이 세기 아래로 놓으면 다트가 못 미치고 떨어집니다 — 서버를 부르지 않습니다. */
export const MIN_THROW_POWER = 0.34;

/** 드래그를 못 하는 경로(키보드·모션 최소화)가 쓰는 기본 세기. */
export const DEFAULT_POWER = 0.72;

/** 당긴 벡터를 최대 거리 안으로 자릅니다. 방향은 그대로 두고 길이만 제한합니다. */
export function clampPull(dx: number, dy: number, max = MAX_PULL_PX): Point {
  const length = Math.hypot(dx, dy);
  if (length <= max || length === 0) return { x: dx, y: dy };
  const ratio = max / length;
  return { x: dx * ratio, y: dy * ratio };
}

/** 당긴 길이 → 0~1 의 세기. **길이만 봅니다(방향은 보지 않습니다).** */
export function pullPower(pull: Point, max = MAX_PULL_PX): number {
  const length = Math.hypot(pull.x, pull.y);
  return Math.min(1, Math.max(0, length / max));
}

/** 날아가는 시간(ms). 세게 당길수록 빨리 갑니다 — 도착지는 그대로입니다. */
export function flightDurationMs(power: number): number {
  return Math.round(560 - 250 * Math.min(1, Math.max(0, power)));
}

/** 못 미친 던지기가 올라갔다 내려오기까지의 시간(ms). */
export function shortFlightDurationMs(power: number): number {
  return Math.round(300 + 160 * Math.min(1, Math.max(0, power)));
}

/** 못 미친 던지기가 도달하는 비율 — 지도까지 가지 못하고 중간에서 떨어집니다. */
export function shortFlightReach(power: number): number {
  return 0.3 + 0.45 * Math.min(1, Math.max(0, power));
}

/** 잔상 개수(0~3). 세게 던질수록 꼬리가 깁니다. */
export function trailCount(power: number): number {
  if (power < 0.5) return 1;
  if (power < 0.8) return 2;
  return 3;
}

/** 잡은 손 방향으로의 기울기(도). 좌우로 끌면 그쪽으로 기울 뿐, 날아가는 곳은 같습니다. */
export function dartTiltDeg(pull: Point): number {
  const raw = pull.x * 0.16;
  return Math.max(-20, Math.min(20, raw));
}

/** 당긴 만큼 눌리는 느낌 — 뒤로 갈수록 살짝 작아집니다(원근). */
export function dartScale(power: number): number {
  return 1 - 0.08 * Math.min(1, Math.max(0, power));
}
