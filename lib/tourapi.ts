/**
 * 한국관광공사 국문 관광정보 서비스(KorService2) — 웹 코드용 창구.
 *
 * 실제 구현은 `lib/tourapi.core.ts` 에 있고, 이 파일은 거기에 **서버 전용 표식만 얹어**
 * 그대로 내보냅니다. 둘로 나눈 이유는 하나입니다.
 *
 *   - Next 쪽(`app/**`)은 이 파일을 씁니다. `server-only` 가 붙어 있어 클라이언트 컴포넌트가
 *     실수로 import 하면 빌드가 그 자리에서 멈춥니다. 서비스키가 브라우저 번들에 섞이는 것을
 *     막는 장치입니다.
 *   - 백필·리포트 스크립트(`scripts/**`)는 Next 런타임이 아니라 순수 Node 에서 돕니다.
 *     그 환경에서 `server-only` 를 import 하면 즉시 예외가 나므로, 스크립트는 `tourapi.core`
 *     쪽을 직접 씁니다.
 *
 * 규격·주의사항(D-23 · SYNC-2 · SYNC-4 · SYNC-6)은 `tourapi.core.ts` 머리말에 있습니다.
 */

import "server-only";

export * from "./tourapi.core";
