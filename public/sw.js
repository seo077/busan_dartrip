/*
 * 서비스워커 — 오프라인 껍데기 전용 (범위 확대 【1】 PWA).
 *
 * ── 무엇을 하지 "않는가" 를 먼저 적습니다 ────────────────────────────────────
 * 서비스워커의 고유 위험은 **캐시 포이즈닝**과 **오래된 데이터 제공**입니다. 한 번 잘못
 * 담기면 사용자 기기에 남아 새 판을 밀어도 옛 화면이 계속 뜹니다. 그래서 처음부터 좁게
 * 잡았습니다.
 *
 *   · `GET` 이 아닌 요청은 손대지 않습니다.
 *   · **다른 출처의 요청은 손대지 않습니다** (지도 SDK·타일·사진 전부 그대로 통과).
 *   · **`/api/` 는 어떤 경우에도 캐시하지 않습니다** — 집계표·다트 결과·후기는 지금 값이어야
 *     하고, 캐시가 끼면 "어제 숫자로 오늘 던지는" 경로가 열립니다.
 *   · 화면(HTML)은 **캐시하지 않습니다.** 언제나 네트워크로 가고, 실패했을 때만 오프라인
 *     안내를 대신 내줍니다. 그래서 로그인 상태가 섞인 화면이 남을 자리가 없습니다.
 *
 * 담는 것은 두 가지뿐입니다.
 *   1. `/offline` — 연결이 끊겼을 때 보여 줄 껍데기 한 장 (설치 시점에 미리 받아 둡니다)
 *   2. `/_next/static/…` — 파일 이름에 내용 해시가 붙어 **내용이 바뀌면 이름이 바뀌는** 자원.
 *      같은 이름이면 같은 내용이 보장되므로 오래된 값을 줄 수가 없습니다.
 *
 * 판을 올릴 때는 `CACHE` 이름만 바꾸면 옛 캐시가 `activate` 에서 통째로 지워집니다.
 */

const CACHE = "dartrip-shell-v1";
const OFFLINE_URL = "/offline";

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // `reload` = 이 요청만은 브라우저 HTTP 캐시를 건너뛰고 원본에서 받습니다.
      await cache.add(new Request(OFFLINE_URL, { cache: "reload" }));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.method !== "GET") return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  // 다른 출처는 그대로 통과 — 지도 SDK·지도 타일·외부 사진이 여기 걸리면 안 됩니다.
  if (url.origin !== self.location.origin) return;

  // 서버가 답해야 하는 것들. 캐시가 끼면 값이 낡습니다.
  if (url.pathname.startsWith("/api/")) return;

  // 이름에 해시가 붙은 빌드 자원 — 캐시 우선이 안전합니다.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok) {
          const cache = await caches.open(CACHE);
          cache.put(request, response.clone());
        }
        return response;
      })(),
    );
    return;
  }

  // 화면 이동 — 언제나 네트워크. 실패했을 때만 껍데기.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          return await fetch(request);
        } catch {
          const cached = await caches.match(OFFLINE_URL);
          return (
            cached ??
            new Response("오프라인입니다.", {
              status: 503,
              headers: { "Content-Type": "text/plain; charset=utf-8" },
            })
          );
        }
      })(),
    );
  }
});
