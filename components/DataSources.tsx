/**
 * 하단 데이터 출처 표기 — 전 화면 공통.
 *
 * 설계 정본: `API데이터설계.md` §10(출처 표기) / `화면구성도.md` §8
 *
 * 공공누리 이용허락 조건에 따른 **의무 표기**입니다. 화면을 새로 만들 때마다
 * 빠뜨리지 않도록 컴포넌트 하나로 묶어 둡니다.
 * S1 상단의 ⓘ 가 이 영역(`#sources`)을 가리킵니다 — S6 정보 화면은 이후 구간 작업입니다.
 */

const DATA_SOURCES = [
  "한국관광공사 — 국문 관광정보 서비스",
  "한국관광공사 — 관광지별 연관관광지 정보",
  "한국관광공사 — 두루누비 정보 서비스",
  "한국관광공사 — 관광사진 정보",
  "부산광역시 — 부산명소정보",
  "국가유산청 — 국가유산 공간정보",
  "행정안전부 — 전국모범음식점표준데이터",
  "카카오 — 카카오맵",
];

export function DataSources({ className = "" }: { className?: string }) {
  return (
    <footer
      id="sources"
      className={`scroll-mt-16 border-t border-white/10 px-5 py-8 text-xs leading-relaxed text-[#98A2B3] ${className}`}
    >
      <h2 className="mb-2 text-sm font-semibold text-[#F2F4F7]">데이터 출처</h2>
      <p className="mb-2">본 서비스는 아래 기관이 제공하는 공공데이터를 활용합니다.</p>
      <ul className="mb-3 space-y-0.5">
        {DATA_SOURCES.map((source) => (
          <li key={source}>· {source}</li>
        ))}
      </ul>
      <p>
        위 데이터는 공공누리 이용허락 조건에 따라 출처를 표시하여 사용합니다. 데이터의
        최신성·정확성은 각 제공기관의 갱신 주기를 따르며, 실제 운영 정보는 방문 전 확인해
        주세요.
      </p>
    </footer>
  );
}

export default DataSources;
