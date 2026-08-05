"use client";

/**
 * S4-후기 — 작성 시트.
 *
 * 설계 정본: `화면구성도.md` §6.2(와이어프레임 · "다녀왔어요만으로도 제출 가능")
 *            §6.4(후기 등록 실패 · 사진 용량 초과) · §6.5(전이)
 *            `사용자플로우.md` F5 후기 흐름 ①~④ · §분기 처리
 *            `D-12`(다녀왔어요 + 한 줄 + 사진 1장, 별점 없음) · `D-9`(로그인 없음)
 *
 * 받는 것이 세 가지뿐입니다
 * ------------------------
 * 다녀왔다는 사실 · 한 줄 · 사진 1장. **별점을 넣을 자리가 없습니다.** 그리고 그 이유를
 * §6.2 는 화면에 문장으로 적기로 했습니다 — "별점은 받지 않습니다. 숫자가 장소를 다시
 * 가리기 때문이에요." 사용자가 없는 기능을 찾다 지나가는 대신, 없는 이유를 읽고 가게 합니다.
 *
 * 한 줄과 사진은 둘 다 선택입니다. [남기기] 는 아무것도 입력하지 않아도 눌립니다 — 표본이
 * 적은 장소일수록 기록의 문턱이 결과를 좌우하기 때문입니다(§6.2).
 *
 * 실패해도 쓴 것을 잃지 않습니다
 * -----------------------------
 * §6.4 의 "후기 등록 실패 — 시트 유지 + 다시 시도(입력 내용 보존)" 그대로입니다. 실패 시
 * 시트를 닫지 않고, 이미 올라간 사진의 URL 은 들고 있다가 재시도 때 **다시 올리지 않습니다**.
 *
 * 사진 처리는 S5 등록과 같은 길을 씁니다 — `lib/imagefile.ts`(브라우저에서 줄이기) →
 * `POST /api/upload`(서버 검사 · Storage). 후기 사진은 `folder=reviews` 로 보냅니다.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { deviceRef } from "@/lib/device";
import { formatBytes, shrinkImage, type ShrunkImage } from "@/lib/imagefile";

/** `reviews.body` 의 길이 제약과 같은 값입니다 (§5.3 · §6.2 의 `0/60`) */
const BODY_MAX = 60;

type Phase =
  | { kind: "editing" }
  | { kind: "submitting" }
  | { kind: "failed"; message: string; detail?: string };

export function ReviewComposer({ placeId }: { placeId: string }) {
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [photo, setPhoto] = useState<ShrunkImage | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  /** 이미 올려 둔 사진의 주소. 재시도 때 같은 사진을 두 번 올리지 않으려고 들고 있습니다 */
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "editing" });
  const [done, setDone] = useState(false);

  const fileRef = useRef<HTMLInputElement | null>(null);

  // ── 시트 열림 동안 뒤 화면이 따라 스크롤되지 않게 ────────────────────────────
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  const close = useCallback(() => {
    setOpen(false);
    setPhase({ kind: "editing" });
  }, []);

  // Esc 로도 닫힙니다 — 시트는 되돌릴 수 있어야 합니다 (§2.4 "막다른 곳을 두지 않는다").
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  // ── 사진 고르기 → 그 자리에서 줄이기 (§5.6 · D-15) ────────────────────────
  useEffect(() => {
    if (!photo) {
      setPhotoPreview(null);
      return;
    }
    const url = URL.createObjectURL(photo.blob);
    setPhotoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  const onPickPhoto = useCallback(async (file: File | null) => {
    if (!file) return;
    setPhotoBusy(true);
    setPhotoError(null);
    try {
      const shrunk = await shrinkImage(file);
      setPhoto(shrunk);
      // 새 사진을 골랐으면 앞서 올려 둔 주소는 버립니다.
      setUploadedUrl(null);
    } catch {
      setPhoto(null);
      setUploadedUrl(null);
      // §6.4 "사진 용량 초과" 행의 문구를 그대로 씁니다.
      setPhotoError("사진을 불러오지 못했어요. 다른 사진을 선택해 주세요.");
    } finally {
      setPhotoBusy(false);
    }
  }, []);

  const clearPhoto = useCallback(() => {
    setPhoto(null);
    setUploadedUrl(null);
    setPhotoError(null);
    if (fileRef.current) fileRef.current.value = "";
  }, []);

  // ── 남기기 ────────────────────────────────────────────────────────────────
  const submit = useCallback(async () => {
    setPhase({ kind: "submitting" });

    let photoUrl = uploadedUrl;

    if (photo && !photoUrl) {
      try {
        const form = new FormData();
        form.append("file", new File([photo.blob], `photo.${photo.ext}`, { type: photo.type }));
        form.append("folder", "reviews");

        const res = await fetch("/api/upload", { method: "POST", body: form });
        const uploaded = await res.json();
        if (!uploaded?.ok || !uploaded.url) {
          throw new Error(uploaded?.message ?? "사진을 올리지 못했어요.");
        }
        photoUrl = uploaded.url as string;
        setUploadedUrl(photoUrl);
      } catch (e) {
        setPhase({
          kind: "failed",
          message: "저장하지 못했어요.",
          detail: e instanceof Error ? e.message : undefined,
        });
        return;
      }
    }

    try {
      const res = await fetch(`/api/places/${encodeURIComponent(placeId)}/reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body: body.trim() === "" ? null : body.trim(),
          photoUrl,
          authorRef: deviceRef(),
        }),
      });
      const result = await res.json();

      if (!result?.ok) {
        setPhase({
          kind: "failed",
          message: result?.message ?? "저장하지 못했어요.",
          detail: result?.detail,
        });
        return;
      }

      // 성공 — 시트를 닫고 목록을 다시 그립니다 (§6.5 "후기 남기기 완료 → S4 (목록 갱신)").
      setOpen(false);
      setBody("");
      setPhoto(null);
      setUploadedUrl(null);
      setPhotoError(null);
      setPhase({ kind: "editing" });
      setDone(true);
      router.refresh();
    } catch {
      setPhase({ kind: "failed", message: "저장하지 못했어요. 연결을 확인해 주세요." });
    }
  }, [body, photo, placeId, router, uploadedUrl]);

  const submitting = phase.kind === "submitting";

  return (
    <>
      {/* ── 여는 버튼 (§6.1 맨 아래 칸 · §6.3-10 "항상 표시") ─────────────── */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-4 flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl border border-white/15 bg-[#171B22] text-base font-semibold text-[#F2F4F7]"
      >
        <span aria-hidden>✓</span> 다녀왔어요
      </button>

      {done && !open ? (
        <p className="mt-2 text-center text-xs text-[#98A2B3]">기록을 남겼어요. 고맙습니다.</p>
      ) : null}

      {!open ? null : (
        <div className="fixed inset-0 z-50 flex items-end justify-center">
          {/* 뒤쪽 어둡게 — 눌러도 닫힙니다 */}
          <button
            type="button"
            aria-label="닫기"
            onClick={close}
            className="absolute inset-0 bg-black/60"
          />

          <div
            role="dialog"
            aria-modal="true"
            aria-label="다녀왔어요"
            className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-3xl border-t border-white/10 bg-[#0E1116] px-5 pt-5 pb-8"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-[#F2F4F7]">다녀왔어요</h2>
              <button
                type="button"
                onClick={close}
                aria-label="닫기"
                className="flex h-11 w-11 items-center justify-center rounded-full text-lg text-[#98A2B3]"
              >
                ✕
              </button>
            </div>

            {/* ── 한 줄 (선택) ─────────────────────────────────────────── */}
            <h3 className="mt-4 mb-2 text-sm font-semibold text-[#98A2B3]">한 줄 남기기 (선택)</h3>
            <div className="relative">
              <input
                type="text"
                value={body}
                onChange={(e) => setBody(e.target.value.slice(0, BODY_MAX))}
                maxLength={BODY_MAX}
                placeholder="어땠는지 한 줄로"
                className="min-h-12 w-full rounded-2xl border border-white/10 bg-[#171B22] px-4 pr-16 text-[#F2F4F7] placeholder:text-[#98A2B3]/60"
              />
              <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-xs text-[#98A2B3]">
                {body.length}/{BODY_MAX}
              </span>
            </div>

            {/* ── 사진 (선택, 1장) ─────────────────────────────────────── */}
            <h3 className="mt-6 mb-2 text-sm font-semibold text-[#98A2B3]">사진 (선택, 1장)</h3>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => void onPickPhoto(e.target.files?.[0] ?? null)}
            />

            {photo && photoPreview ? (
              <div className="flex items-center gap-3">
                {/* 미리보기는 브라우저 안에서 만든 blob 이라 next/image 최적화 대상이 아닙니다. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photoPreview}
                  alt="남길 사진 미리보기"
                  className="h-24 w-24 rounded-2xl border border-white/10 object-cover"
                />
                <div className="text-xs text-[#98A2B3]">
                  <p>
                    {photo.width}×{photo.height}
                  </p>
                  <p className="mt-1">
                    {formatBytes(photo.originalBytes)} → {formatBytes(photo.bytes)}
                  </p>
                  <button
                    type="button"
                    onClick={clearPhoto}
                    className="mt-2 min-h-9 rounded-xl border border-white/20 px-3 text-[#F2F4F7]"
                  >
                    사진 빼기
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={photoBusy}
                className="flex h-24 w-24 items-center justify-center rounded-2xl border border-dashed border-white/20 bg-[#171B22] text-2xl text-[#98A2B3] disabled:opacity-50"
              >
                {photoBusy ? "…" : "+"}
              </button>
            )}

            {photoError ? (
              <p className="mt-2 text-sm break-keep text-[#FF9B9B]">{photoError}</p>
            ) : null}

            {/* ── 남기기 — 아무 입력 없이도 눌립니다 (§6.2) ─────────────── */}
            <button
              type="button"
              disabled={submitting || photoBusy}
              onClick={() => void submit()}
              className="mt-8 min-h-14 w-full rounded-2xl bg-[#FF4D4D] text-base font-semibold text-white disabled:bg-white/10 disabled:text-[#98A2B3]"
            >
              {submitting ? "남기는 중…" : "남기기"}
            </button>

            {/* ── 실패 (§6.4) — 시트는 그대로, 쓴 것도 그대로 ───────────── */}
            {phase.kind === "failed" ? (
              <div className="mt-4 rounded-2xl border border-[#FF4D4D]/40 bg-[#FF4D4D]/10 p-4 text-center">
                <p className="text-sm text-[#F2F4F7]">{phase.message}</p>
                {phase.detail ? (
                  <p className="mt-1 text-xs break-keep text-[#98A2B3]">{phase.detail}</p>
                ) : null}
                <button
                  type="button"
                  onClick={() => void submit()}
                  className="mt-3 min-h-11 rounded-2xl border border-white/20 px-5 text-sm text-[#F2F4F7]"
                >
                  다시 시도
                </button>
              </div>
            ) : null}

            {/* ── 원칙을 사용자에게 설명 (§6.2 아래 두 줄) ──────────────── */}
            <p className="mt-5 text-center text-xs leading-relaxed break-keep text-[#98A2B3]">
              별점은 받지 않습니다.
              <br />
              숫자가 장소를 다시 가리기 때문이에요.
            </p>
          </div>
        </div>
      )}
    </>
  );
}

export default ReviewComposer;
