/**
 * S3 결과 — 넘어오는 동안의 뼈대.
 *
 * 설계 정본: `화면구성도.md` §2.4(로딩 = 스피너 대신 스켈레톤) · §5.4("로딩")
 *
 * 화면 전체가 서버에서 한 번에 오므로 §5.4 가 말한 "히어로는 즉시, 목록만 스켈레톤" 처럼
 * 두 조각으로 나뉘지 않습니다. 대신 도착 전까지 **자리 모양**을 그대로 잡아 두어,
 * 결과가 들어올 때 화면이 튀지 않게 합니다.
 */

export default function ResultLoading() {
  return (
    <main className="mx-auto min-h-screen w-full max-w-lg bg-[#0E1116]">
      <div className="flex min-h-[86svh] animate-pulse flex-col justify-end bg-white/5 px-5 pb-7">
        <div className="mb-3 h-6 w-24 rounded-full bg-white/10" />
        <div className="h-9 w-3/4 rounded bg-white/10" />
        <div className="mt-3 h-5 w-24 rounded bg-white/10" />
        <div className="mt-6 grid grid-cols-2 gap-3">
          <div className="h-12 rounded-2xl bg-white/10" />
          <div className="h-12 rounded-2xl bg-white/10" />
        </div>
      </div>
    </main>
  );
}
