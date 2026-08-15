/**
 * 다트 하나를 그립니다 — 촉·대·날개 세 조각뿐인 CSS 도형입니다.
 *
 * 설계 정본: `화면구성도.md` §4.2-1("CSS transform 기반. 저사양 기기 대응") · §2.2(색 토큰)
 *
 * 이미지 파일도, 애니메이션 라이브러리도 쓰지 않습니다. 움직임은 이 도형을 감싼 쪽에서
 * `transform` 으로만 주므로 레이아웃을 다시 계산하지 않습니다.
 * 촉이 항상 **위쪽 가운데**에 오도록 그려, 감싼 쪽이 회전만으로 방향을 정할 수 있게 했습니다.
 */

import { DART_SIZE } from "@/lib/gesture";

export function DartGlyph({
  size = DART_SIZE,
  glow = false,
}: {
  size?: number;
  glow?: boolean;
}) {
  const w = size;

  return (
    <div
      aria-hidden
      style={{
        width: w,
        height: w,
        position: "relative",
        filter: glow ? "drop-shadow(0 2px 10px rgba(232, 93, 117, 0.55))" : undefined,
      }}
    >
      {/* 촉 */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: 0,
          transform: "translateX(-50%)",
          width: 0,
          height: 0,
          borderLeft: `${w * 0.1}px solid transparent`,
          borderRight: `${w * 0.1}px solid transparent`,
          borderBottom: `${w * 0.3}px solid #E85D75`,
        }}
      />
      {/* 대 */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: w * 0.27,
          transform: "translateX(-50%)",
          width: w * 0.11,
          height: w * 0.42,
          borderRadius: w * 0.06,
          // 대는 밝은 바탕(`D-61-3`) 위에 놓입니다 — 옛 은색은 바탕에 묻혀 사라집니다.
          background: "linear-gradient(180deg, #6B6472 0%, #2E2A33 100%)",
        }}
      />
      {/* 날개 */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: w * 0.6,
          transform: "translateX(-50%)",
          width: w * 0.46,
          height: w * 0.34,
          background: "linear-gradient(180deg, #F49AA9 0%, #E85D75 100%)",
          clipPath: "polygon(50% 0%, 100% 100%, 50% 74%, 0% 100%)",
        }}
      />
    </div>
  );
}

export default DartGlyph;
