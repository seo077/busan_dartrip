/**
 * 사진 업로드의 공용 상수 — 상한 용량과 버킷 이름.
 *
 * 설계 정본: `API데이터설계.md` §5.6(스토리지 · "서버 검증 — 최대 1MB") / `D-15`(무료 1GB)
 *
 * 왜 라우트가 아니라 여기에 있는가
 * -------------------------------
 * 원래 이 두 값은 `app/api/upload/route.ts` 가 직접 `export` 하고 있었습니다. 그런데 **Route
 * Handler 파일이 내보낼 수 있는 것은 정해져 있습니다** — HTTP 메서드(`GET`·`POST`…)와 세그먼트
 * 설정(`runtime`·`dynamic`·`revalidate`·`maxDuration` 등)뿐입니다. 그 밖의 값을 내보내는 것은
 * Next 가 보장하는 규격 밖이라, 편집기의 Next 타입 플러그인이 "유효한 Route export 가 아니다"
 * 로 표시하고 향후 버전에서 빌드가 막힐 수 있는 자리입니다.
 *
 * 값 자체는 라우트 밖에서도 쓸 만한 것이므로(브라우저 사전 검사·스토리지 경로 조립),
 * 라우트에서 떼어 내 이 파일에 두고 라우트가 import 하도록 했습니다. 값은 그대로입니다.
 *
 * 이 파일은 서버·브라우저 어느 쪽에서 불러도 됩니다 — 상수만 있고 `server-only` 도 아닙니다.
 */

/** 서버가 받아 주는 사진 1장의 상한 (§5.6 "서버 검증 — 최대 1MB") */
export const UPLOAD_MAX_BYTES = 1024 * 1024;

/** 사진이 들어가는 Storage 버킷 이름 (§5.6) */
export const PHOTO_BUCKET = "place-photos";

/**
 * 버킷 안에서 사진이 놓이는 자리.
 *
 * 버킷은 하나입니다(§5.6 제목이 "후기·등록 사진"). 다만 나중에 사람이 콘솔에서 사진을 볼 때
 * **등록 사진과 후기 사진이 섞여 있으면 무엇을 승인해야 하는지 알 수 없으므로**(`D-8` 승인은
 * 사람이 합니다) 폴더로만 갈라 둡니다. 접근 권한은 둘 다 같습니다.
 */
export const PHOTO_FOLDERS = ["submissions", "reviews"] as const;

export type PhotoFolder = (typeof PHOTO_FOLDERS)[number];

export function isPhotoFolder(value: unknown): value is PhotoFolder {
  return typeof value === "string" && (PHOTO_FOLDERS as readonly string[]).includes(value);
}
