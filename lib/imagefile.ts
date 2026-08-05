"use client";

/**
 * 사진 줄이기 — 브라우저에서 리사이즈·압축.
 *
 * 설계 정본: `API데이터설계.md` §5.6(장변 1280px · WebP · 목표 200KB 이하)
 *            `화면구성도.md` §7.3(사진 1장, 업로드 시 리사이즈·압축) / `D-15`(무료 1GB)
 *
 * 왜 브라우저에서 하는가
 * ---------------------
 * §5.6 그대로입니다 — 업로드 대역과 서버 처리를 함께 아낍니다. 무료 티어에서 서버측 이미지
 * 변환이 가장 비싼 작업이고, 우리에게는 그 처리를 얹을 자리가 없습니다(Vercel Hobby 함수).
 *
 * 200KB 목표의 근거는 용량 예산입니다. 200KB × 5,000장 ≈ 1GB 로 Supabase 무료 스토리지 상한과
 * 같습니다. 요즘 휴대폰 사진이 3~6MB 이므로, 줄이지 않으면 200장 남짓에 상한이 찹니다.
 *
 * 못 줄이면 어떻게 되는가
 * ----------------------
 * 이 파일의 모든 실패는 예외로 올립니다. 화면은 그것을 §7.4 의 **"사진 실패"** 상태로 받아
 * "사진만 빼고 등록할까요?" 를 묻습니다 — 사진 때문에 등록 자체가 막히지 않습니다.
 */

/** 장변 상한 (§5.6) */
export const MAX_EDGE = 1280;

/** 목표 용량 (§5.6). 이 아래로 내려가면 더 낮추지 않습니다 */
export const TARGET_BYTES = 200 * 1024;

/** 서버가 받아 주는 상한 (§5.6 "서버 검증 — 최대 1MB") */
export const HARD_LIMIT_BYTES = 1024 * 1024;

/** 화질을 이 순서로 낮춰 가며 목표 용량에 닿는 첫 값을 씁니다 */
const QUALITY_STEPS = [0.82, 0.7, 0.6, 0.5, 0.4];

export interface ShrunkImage {
  blob: Blob;
  width: number;
  height: number;
  bytes: number;
  type: string;
  /** 확장자 — 서버에 보내는 파일 이름에 씁니다 */
  ext: string;
  /** 줄이기 전 크기. 화면에 "3.4MB → 180KB" 로 보여 줍니다 */
  originalBytes: number;
}

export class ImageShrinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageShrinkError";
  }
}

/** WebP 로 내보낼 수 있는 브라우저인지. 안 되면 JPEG 으로 물러섭니다. */
function webpSupported(): boolean {
  try {
    const probe = document.createElement("canvas");
    probe.width = 1;
    probe.height = 1;
    return probe.toDataURL("image/webp").startsWith("data:image/webp");
  } catch {
    return false;
  }
}

/**
 * 파일을 그릴 수 있는 형태로 엽니다.
 * `createImageBitmap` 이 있으면 그쪽이 빠르고, 없으면 `<img>` 로 물러섭니다.
 */
async function decode(file: File): Promise<{
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        release: () => bitmap.close(),
      };
    } catch {
      // 아래 <img> 경로로 넘어갑니다.
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new ImageShrinkError("사진을 읽지 못했어요."));
      el.src = url;
    });
    return {
      source: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      release: () => URL.revokeObjectURL(url),
    };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * 장변 1280px 로 줄이고 목표 용량에 닿을 때까지 화질을 낮춥니다.
 *
 * 가장 낮은 화질에서도 상한을 넘으면 **가로세로를 한 번 더 줄여** 다시 시도합니다.
 * 화질만 계속 낮추면 사진이 뭉개지는 데 비해 용량은 잘 안 줄기 때문입니다.
 */
export async function shrinkImage(file: File): Promise<ShrunkImage> {
  if (!file.type.startsWith("image/")) {
    throw new ImageShrinkError("이미지 파일만 올릴 수 있어요.");
  }

  const decoded = await decode(file);
  const type = webpSupported() ? "image/webp" : "image/jpeg";
  const ext = type === "image/webp" ? "webp" : "jpg";

  try {
    if (decoded.width === 0 || decoded.height === 0) {
      throw new ImageShrinkError("사진을 읽지 못했어요.");
    }

    let scale = Math.min(1, MAX_EDGE / Math.max(decoded.width, decoded.height));
    let best: Blob | null = null;
    let bestWidth = 0;
    let bestHeight = 0;

    // 두 바퀴면 충분합니다 — 1280 → 960 까지 줄여도 안 되는 사진은 사실상 없습니다.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const width = Math.max(1, Math.round(decoded.width * scale));
      const height = Math.max(1, Math.round(decoded.height * scale));

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new ImageShrinkError("사진을 줄이지 못했어요.");
      ctx.drawImage(decoded.source, 0, 0, width, height);

      for (const quality of QUALITY_STEPS) {
        const blob = await toBlob(canvas, type, quality);
        if (!blob) continue;
        if (!best || blob.size < best.size) {
          best = blob;
          bestWidth = width;
          bestHeight = height;
        }
        if (blob.size <= TARGET_BYTES) {
          return {
            blob,
            width,
            height,
            bytes: blob.size,
            type,
            ext,
            originalBytes: file.size,
          };
        }
      }

      scale *= 0.75;
    }

    if (!best) throw new ImageShrinkError("사진을 줄이지 못했어요.");
    if (best.size > HARD_LIMIT_BYTES) {
      throw new ImageShrinkError("사진이 너무 큽니다. 다른 사진을 올려 주세요.");
    }

    return {
      blob: best,
      width: bestWidth,
      height: bestHeight,
      bytes: best.size,
      type,
      ext,
      originalBytes: file.size,
    };
  } finally {
    decoded.release();
  }
}

/** "3.4MB" · "182KB" 처럼 사람이 읽는 크기. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
