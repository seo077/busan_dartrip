"use client";

/**
 * 조준 층 — 지도 위에 덧그리는 과녁 표식과 조준점입니다(D-36).
 *
 * 지도 상자와 **같은 크기·같은 자리**에 깔리는 한 겹이라, 여기 그려진 좌표가 곧
 * `lib/aim.ts` 가 판정에 쓴 좌표입니다. 화면에 보이는 것과 판정 기준이 어긋날 자리가 없습니다.
 *
 * 그리는 것 세 가지:
 *   1. **구·군 표식 16개** — 판정 기준을 눈에 보이게 둡니다. 조준점에서 가장 가까운 표식이
 *      그대로 결과의 구·군입니다. 지금 테마의 후보가 0곳인 구·군은 흐리게 두어 겨누기 전에
 *      알 수 있게 합니다(§7.2 "빈 조합" 을 조준 단계로 당겨 온 것입니다).
 *   2. **조준점** — 십자선과 고리. 겨눈 구·군이 0곳이면 색이 죽습니다.
 *   3. **이름표** — 지금 겨눈 구·군과 후보 건수. 놓기 전에 무엇이 정해질지 글자로 답합니다.
 *
 * 눈속임은 넣지 않았습니다. 여기 쓰인 이름이 서버로 가는 값이고, 결과로 돌아오는 값입니다.
 */

import type { AimState, AimTarget } from "@/lib/aim";

interface Props {
  /** 지금 겨누고 있는 상태. 당기는 중이 아니면 null */
  aim: AimState | null;
  /** 구·군 표식 16개 (지도 상자 px 로 옮겨진 것) */
  targets: readonly AimTarget[];
  /** 조준을 쓸 수 있는 상태인지 — 아니면 이 층 전체가 보이지 않습니다 */
  active: boolean;
  /** 표식만 조용히 띄워 두는 구간(당기기 전) */
  idle: boolean;
  /** 안내 문구에 쓰는 테마 이름 */
  themeName: string;
}

export function AimReticle({ aim, targets, active, idle, themeName }: Props) {
  if (!active) return null;

  const pulling = aim !== null;
  const blocked = aim !== null && aim.target.count === 0;
  const accent = blocked ? "#98A2B3" : "#FF4D4D";

  return (
    /*
      `inset-px` 인 이유 — 이 층의 좌표는 **지도 상자 안쪽**(`clientWidth`·`clientHeight`) 기준인데
      지도 겉테두리가 1px 이라 `inset-0` 으로 깔면 표식이 실제 지도보다 1px 어긋납니다.
      표시와 판정이 같아야 하므로 안쪽에 정확히 맞춥니다.
    */
    <div className="pointer-events-none absolute inset-px overflow-hidden rounded-2xl" aria-hidden>
      {/* 당기는 동안에는 지도를 살짝 눌러 표식이 먼저 읽히게 합니다. */}
      <div
        className="absolute inset-0 bg-black/35 transition-opacity duration-200"
        style={{ opacity: pulling ? 1 : 0 }}
      />

      {/* 구·군 표식 — 판정 기준 그 자체 */}
      {targets.map((t) => {
        if (t.offscreen) return null;
        const picked = aim?.target.code === t.code;
        const empty = t.count === 0;
        const size = picked ? 13 : 7;
        return (
          <div
            key={t.code}
            className="absolute transition-[opacity,width,height] duration-150"
            style={{
              left: t.x,
              top: t.y,
              width: size,
              height: size,
              marginLeft: -size / 2,
              marginTop: -size / 2,
              borderRadius: "50%",
              border: `${picked ? 2 : 1}px solid ${empty ? "rgba(152,162,179,0.85)" : accent}`,
              background: picked && !empty ? accent : "transparent",
              opacity: pulling ? (empty ? 0.5 : 1) : idle ? 0.4 : 0,
              boxShadow: picked && !empty ? `0 0 12px ${accent}` : undefined,
            }}
          />
        );
      })}

      {/* 조준점 */}
      {aim ? (
        <div
          className="absolute"
          style={{ left: aim.point.x, top: aim.point.y, width: 0, height: 0 }}
        >
          <span
            className="absolute block rounded-full"
            style={{
              width: 46,
              height: 46,
              marginLeft: -23,
              marginTop: -23,
              border: `2px solid ${accent}`,
              opacity: 0.9,
            }}
          />
          <span
            className="absolute block"
            style={{
              width: 2,
              height: 66,
              marginLeft: -1,
              marginTop: -33,
              background: `linear-gradient(180deg, transparent, ${accent}, transparent)`,
            }}
          />
          <span
            className="absolute block"
            style={{
              width: 66,
              height: 2,
              marginLeft: -33,
              marginTop: -1,
              background: `linear-gradient(90deg, transparent, ${accent}, transparent)`,
            }}
          />

          {/* 이름표 — 놓기 전에 무엇이 정해지는지 글자로 */}
          <span
            className="absolute left-1/2 block -translate-x-1/2 whitespace-nowrap rounded-full px-3 py-1 text-center text-xs font-semibold"
            style={{
              top: 30,
              background: "rgba(0,0,0,0.72)",
              color: blocked ? "#FFC9C9" : "#F2F4F7",
              border: `1px solid ${blocked ? "rgba(255,201,201,0.5)" : "rgba(255,77,77,0.55)"}`,
            }}
          >
            {aim.target.name}
            <span className="ml-1 font-normal opacity-75">
              {blocked ? `${themeName} 0곳` : `${aim.target.count.toLocaleString("ko-KR")}곳`}
            </span>
          </span>

          {aim.borderline && !blocked ? (
            <span
              className="absolute left-1/2 block -translate-x-1/2 whitespace-nowrap text-[10px]"
              style={{ top: 54, color: "#FFC9C9" }}
            >
              경계 근처예요
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default AimReticle;
