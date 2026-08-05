/**
 * POST /api/upload — 사진 1장을 Storage 에 올립니다.
 *
 * 설계 정본: `API데이터설계.md` §5.6(스토리지) · §5.8(쓰기는 전부 API Route 경유) · §8(Route)
 *            `화면구성도.md` §7.3(사진 선택 1장) · §7.4("사진 실패" 상태) / `D-15`(무료 1GB)
 *
 * 등록과 업로드를 나눈 이유
 * ------------------------
 * §7.4 에 **"사진 실패 — 사진만 제외하고 등록 진행 여부를 물음"** 이라는 상태가 있습니다.
 * 한 요청으로 묶으면 사진이 실패할 때 등록도 함께 실패하므로 그 상태를 만들 수 없습니다.
 * 그래서 사진을 먼저 올려 URL 을 받고, 등록은 그 URL 만 들고 갑니다.
 *
 * 서버가 다시 재는 것
 * ------------------
 * 브라우저가 이미 장변 1280px · WebP · 200KB 목표로 줄여서 보냅니다(§5.6). 그래도 여기서
 * **크기와 실제 이미지 여부를 다시 확인**합니다 — 브라우저를 거치지 않고 들어오는 요청이
 * 있을 수 있고, 무료 스토리지 1GB 가 서비스 가용성 문제이기 때문입니다(`D-15` · DF-3).
 * 확장자·`Content-Type` 헤더는 보내는 쪽이 마음대로 적을 수 있으므로 **파일 앞머리 몇 바이트**로
 * 판정합니다.
 *
 * 응답
 *   { ok: true, url, path }
 *   { ok: false, reason: "bad_request" | "too_large" | "not_image" | "missing_config" | "storage" }
 */

import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

import { getServiceClient, supabaseStatus } from "@/lib/supabase";
import { PHOTO_BUCKET, UPLOAD_MAX_BYTES } from "@/lib/upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 이 파일이 내보내는 것은 위의 세그먼트 설정과 아래 `POST` 뿐입니다 — Route Handler 규격.
// 상한 용량·버킷 이름은 규격 밖 export 라 `lib/upload.ts` 로 옮겼습니다(그 파일 머리말 참조).

const NO_STORE = { "Cache-Control": "no-store" };

type ImageKind = { mime: string; ext: string };

/**
 * 파일 앞머리로 실제 이미지인지 봅니다. 헤더·확장자를 믿지 않습니다.
 *   WebP `RIFF....WEBP` / JPEG `FF D8 FF` / PNG `89 50 4E 47 0D 0A 1A 0A`
 */
function sniff(bytes: Uint8Array): ImageKind | null {
  if (bytes.length < 12) return null;

  const ascii = (start: number, end: number) =>
    String.fromCharCode(...bytes.subarray(start, end));

  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") {
    return { mime: "image/webp", ext: "webp" };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mime: "image/jpeg", ext: "jpg" };
  }
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return { mime: "image/png", ext: "png" };
  }
  return null;
}

function fail(reason: string, message: string, status = 400, detail?: string) {
  return NextResponse.json(
    { ok: false, reason, message, detail },
    { status, headers: NO_STORE },
  );
}

export async function POST(request: Request) {
  const status = supabaseStatus();
  if (!status.hasUrl || !status.hasServiceKey) {
    return fail(
      "missing_config",
      "사진 보관함 설정이 아직 없습니다.",
      200,
      "`.env.local` 의 NEXT_PUBLIC_SUPABASE_URL · SUPABASE_SERVICE_ROLE_KEY 를 채워 주세요.",
    );
  }

  let file: File | null = null;
  try {
    const form = await request.formData();
    const value = form.get("file");
    if (value instanceof File) file = value;
  } catch {
    return fail("bad_request", "요청 형식이 올바르지 않습니다.");
  }

  if (!file) return fail("bad_request", "사진이 없습니다.");
  if (file.size === 0) return fail("bad_request", "사진이 비어 있습니다.");
  if (file.size > UPLOAD_MAX_BYTES) {
    return fail("too_large", "사진이 너무 큽니다. 1MB 이하로 올려 주세요.", 413);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = sniff(bytes);
  if (!kind) return fail("not_image", "이미지 파일만 올릴 수 있어요.", 415);

  // 이름을 그대로 쓰지 않습니다 — 한글·공백·경로 문자가 섞이고, 같은 이름이 서로를 덮습니다.
  const now = new Date();
  const yyyymm = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const path = `submissions/${yyyymm}/${randomUUID()}.${kind.ext}`;

  const db = getServiceClient();
  const { error } = await db.storage.from(PHOTO_BUCKET).upload(path, bytes, {
    contentType: kind.mime,
    upsert: false,
    cacheControl: "31536000",
  });

  if (error) {
    return fail("storage", "사진을 올리지 못했어요.", 502, error.message);
  }

  const { data } = db.storage.from(PHOTO_BUCKET).getPublicUrl(path);

  return NextResponse.json(
    { ok: true, url: data.publicUrl, path, bytes: file.size },
    { status: 200, headers: NO_STORE },
  );
}
