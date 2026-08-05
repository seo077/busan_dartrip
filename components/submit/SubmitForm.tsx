"use client";

/**
 * S5 — 장소 등록 본체.
 *
 * 설계 정본: `화면구성도.md` §7.1(와이어프레임) · §7.2(완료) · §7.3(입력 규칙 · 중복 · 작성자)
 *            §7.4(상태 8종) · §7.5(전이) / `D-8`(간이판) · `D-9`(로그인 없음) · `D-15`(사진)
 *
 * 이 화면이 만드는 것은 **승인 대기 행 하나**입니다
 * ------------------------------------------------
 * 등록하면 `places` 에 `status='pending'` 으로 들어가고, 승인은 사람이 Supabase 콘솔에서
 * 합니다(`D-8` — v1 에 승인 화면은 만들지 않습니다). 그래서 완료 화면이 "확인 후 다트에
 * 추가됩니다" 라고 적습니다(§7.2). 등록한 사람이 자기 장소를 바로 열어 볼 수 없는 것도
 * 같은 이유입니다 — S4 조회가 `published` 만 봅니다.
 *
 * 머리말이 "승인되면 다트에 똑같은 확률로 등장합니다" 인 것은 §7.1 그대로입니다. 등록 유인이
 * 곧 이 서비스의 원칙(출처 무관 균등 추출 · `D-3` · AD-1)의 재확인이라 문구를 지킵니다.
 *
 * 사용자가 고른 테마를 그대로 씁니다
 * ---------------------------------
 * `theme_map` 매칭 대상이 아닙니다. 매핑표는 외부 분류코드를 4테마로 옮기는 자리인데
 * 여기에는 옮길 원본 분류가 없습니다. 그래서 등록 화면의 테마는 **필수**이고 '전체' 가
 * 없습니다(§7.3) — 비워 두면 갈 곳이 미분류 보관함뿐입니다.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

import { PinMap, START_CENTER } from "@/components/submit/PinMap";
import { deviceRef } from "@/lib/device";
import { themeIcon } from "@/lib/format";
import { isInBusanBox } from "@/lib/geo";
import { formatBytes, shrinkImage, type ShrunkImage } from "@/lib/imagefile";
import { THEME_KEYS, THEME_LABELS, type ThemeKey } from "@/lib/theme";

const NAME_MAX = 40;
const NOTE_MAX = 60;

/** 핀이 멈춘 뒤 주소를 물어보기까지의 여유. 손가락이 미세하게 떨려도 한 번만 부르게 합니다. */
const GEOCODE_DEBOUNCE_MS = 450;

interface Duplicate {
  id: string | null;
  name: string;
  distanceM: number;
  pending: boolean;
}

type Phase =
  | { kind: "editing" }
  | { kind: "submitting" }
  | { kind: "photo_failed"; message: string }
  | { kind: "duplicate"; duplicates: Duplicate[] }
  | { kind: "failed"; message: string; detail?: string }
  | { kind: "done"; sigunguName: string | null };

export function SubmitForm() {
  // ── 입력 ──────────────────────────────────────────────────────────────────
  const [point, setPoint] = useState<{ lat: number; lng: number }>(START_CENTER);
  const [name, setName] = useState("");
  const [theme, setTheme] = useState<ThemeKey | null>(null);
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<ShrunkImage | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);

  // ── 위치 표기 (역지오코딩) ────────────────────────────────────────────────
  const [address, setAddress] = useState<string | null>(null);
  const [addressBusy, setAddressBusy] = useState(false);
  /** 역지오코딩이 "부산이 아니다" 라고 답한 경우. 상자 판정과 별개로 한 겹 더 봅니다 */
  const [regionOutside, setRegionOutside] = useState(false);

  const [phase, setPhase] = useState<Phase>({ kind: "editing" });

  const fileRef = useRef<HTMLInputElement | null>(null);

  const inBox = isInBusanBox(point.lat, point.lng);
  const outsideBusan = !inBox || regionOutside;

  // ── 핀 → 주소 ─────────────────────────────────────────────────────────────
  const onMove = useCallback((lat: number, lng: number) => {
    setPoint({ lat, lng });
  }, []);

  useEffect(() => {
    if (!inBox) {
      setAddress(null);
      setRegionOutside(false);
      return;
    }

    let cancelled = false;
    setAddressBusy(true);

    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/geo/reverse?lat=${point.lat}&lng=${point.lng}`,
          { cache: "no-store" },
        );
        const body = await res.json();
        if (cancelled) return;

        if (body?.ok) {
          setAddress(body.roadAddress ?? body.address ?? null);
          setRegionOutside(body.inBusan === false);
        } else {
          // 주소는 보조 표기입니다. 못 받아도 등록을 막지 않습니다.
          setAddress(null);
          setRegionOutside(false);
        }
      } catch {
        if (!cancelled) {
          setAddress(null);
          setRegionOutside(false);
        }
      } finally {
        if (!cancelled) setAddressBusy(false);
      }
    }, GEOCODE_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [point.lat, point.lng, inBox]);

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
    } catch (e) {
      setPhoto(null);
      setPhotoError(e instanceof Error ? e.message : "사진을 쓰지 못했어요.");
    } finally {
      setPhotoBusy(false);
    }
  }, []);

  const clearPhoto = useCallback(() => {
    setPhoto(null);
    setPhotoError(null);
    if (fileRef.current) fileRef.current.value = "";
  }, []);

  // ── 등록 가능 여부 (§7.4 "미충족") ────────────────────────────────────────
  const trimmedName = name.trim();
  const canSubmit = useMemo(
    () =>
      trimmedName !== "" &&
      trimmedName.length <= NAME_MAX &&
      theme !== null &&
      !outsideBusan &&
      !photoBusy,
    [trimmedName, theme, outsideBusan, photoBusy],
  );

  // ── 제출 ──────────────────────────────────────────────────────────────────

  /** 사진을 먼저 올려 URL 을 받습니다. 실패는 예외로 올려 §7.4 "사진 실패" 로 이어집니다. */
  const uploadPhoto = useCallback(async (image: ShrunkImage): Promise<string> => {
    const form = new FormData();
    form.append("file", new File([image.blob], `photo.${image.ext}`, { type: image.type }));

    const res = await fetch("/api/upload", { method: "POST", body: form });
    const body = await res.json();
    if (!body?.ok || !body.url) {
      throw new Error(body?.message ?? "사진을 올리지 못했어요.");
    }
    return body.url as string;
  }, []);

  const send = useCallback(
    async (options: { photoUrl: string | null; allowDuplicate: boolean }) => {
      const res = await fetch("/api/places", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmedName,
          theme,
          lat: point.lat,
          lng: point.lng,
          note: note.trim() === "" ? null : note.trim(),
          photoUrl: options.photoUrl,
          submittedBy: deviceRef(),
          allowDuplicate: options.allowDuplicate,
        }),
      });
      return (await res.json()) as {
        ok?: boolean;
        reason?: string;
        message?: string;
        detail?: string;
        duplicates?: Duplicate[];
        sigunguName?: string;
      };
    },
    [trimmedName, theme, point.lat, point.lng, note],
  );

  /**
   * 등록 한 번. `withPhoto = false` 는 §7.4 "사진 실패 — 사진만 제외하고 등록" 경로입니다.
   * 이미 올려 둔 사진이 있으면 다시 올리지 않습니다.
   */
  const submit = useCallback(
    async (opts: { withPhoto: boolean; allowDuplicate: boolean; uploadedUrl?: string | null }) => {
      if (!canSubmit) return;
      setPhase({ kind: "submitting" });

      let photoUrl: string | null = opts.uploadedUrl ?? null;

      if (opts.withPhoto && photo && !photoUrl) {
        try {
          photoUrl = await uploadPhoto(photo);
        } catch (e) {
          setPhase({
            kind: "photo_failed",
            message: e instanceof Error ? e.message : "사진을 올리지 못했어요.",
          });
          return;
        }
      }

      try {
        const body = await send({ photoUrl, allowDuplicate: opts.allowDuplicate });

        if (body?.ok) {
          setPhase({ kind: "done", sigunguName: body.sigunguName ?? null });
          return;
        }
        if (body?.reason === "duplicate") {
          setPhase({ kind: "duplicate", duplicates: body.duplicates ?? [] });
          return;
        }
        setPhase({
          kind: "failed",
          message: body?.message ?? "등록하지 못했어요.",
          detail: body?.detail,
        });
      } catch {
        setPhase({ kind: "failed", message: "등록하지 못했어요. 연결을 확인해 주세요." });
      }
    },
    [canSubmit, photo, uploadPhoto, send],
  );

  // ── S5-완료 (§7.2) ────────────────────────────────────────────────────────
  if (phase.kind === "done") {
    return (
      <section className="flex min-h-[60vh] flex-col items-center justify-center px-8 text-center">
        <span
          aria-hidden
          className="mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-[#FF4D4D]/15 text-3xl text-[#FF4D4D]"
        >
          ✓
        </span>
        <h2 className="text-xl font-bold text-[#F2F4F7]">등록해 주셔서 고맙습니다</h2>
        <p className="mt-4 text-sm leading-relaxed break-keep text-[#98A2B3]">
          확인 후 다트에 추가됩니다.
          <br />
          보통 1~2일이 걸려요.
        </p>
        {phase.sigunguName ? (
          <p className="mt-2 text-xs text-[#98A2B3]/70">{phase.sigunguName}에 등록했습니다</p>
        ) : null}

        <Link
          href="/"
          className="mt-8 flex min-h-12 w-full max-w-xs items-center justify-center rounded-2xl bg-[#FF4D4D] text-sm font-semibold text-white"
        >
          다트 던지러 가기
        </Link>
      </section>
    );
  }

  const submitting = phase.kind === "submitting";

  return (
    <section className="px-5 pb-12">
      {/* 등록 유인 = 원칙의 재확인 (§7.1) */}
      <p className="mb-5 text-sm leading-relaxed break-keep text-[#98A2B3]">
        공공데이터에 없는 부산의 장소를 알려주세요. 승인되면 다트에 똑같은 확률로 등장합니다.
      </p>

      {/* ── 위치 (§7.1) ─────────────────────────────────────────────────── */}
      <h2 className="mb-2 text-sm font-semibold text-[#98A2B3]">
        위치 <span className="text-[#FF4D4D]">*</span>
      </h2>
      <PinMap onMove={onMove} outsideBusan={outsideBusan} />

      {outsideBusan ? (
        <p className="mt-2 text-sm text-[#FF9B9B]">부산 안의 장소만 등록할 수 있어요</p>
      ) : (
        <p className="mt-2 min-h-5 text-sm text-[#98A2B3]">
          {addressBusy && address === null ? "주소를 확인하는 중…" : (address ?? " ")}
        </p>
      )}

      {/* ── 이름 (§7.1 · §7.3) ──────────────────────────────────────────── */}
      <h2 className="mt-6 mb-2 text-sm font-semibold text-[#98A2B3]">
        이름 <span className="text-[#FF4D4D]">*</span>
      </h2>
      <div className="relative">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, NAME_MAX))}
          maxLength={NAME_MAX}
          placeholder="장소 이름"
          className="min-h-12 w-full rounded-2xl border border-white/10 bg-[#171B22] px-4 pr-16 text-[#F2F4F7] placeholder:text-[#98A2B3]/60"
        />
        <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-xs text-[#98A2B3]">
          {name.length}/{NAME_MAX}
        </span>
      </div>

      {/* ── 테마 (§7.1 — '전체' 없음) ───────────────────────────────────── */}
      <h2 className="mt-6 mb-2 text-sm font-semibold text-[#98A2B3]">
        테마 <span className="text-[#FF4D4D]">*</span>
      </h2>
      <div className="grid grid-cols-4 gap-2">
        {THEME_KEYS.map((key) => {
          const selected = theme === key;
          return (
            <button
              key={key}
              type="button"
              aria-pressed={selected}
              onClick={() => setTheme(key)}
              className={`flex min-h-20 flex-col items-center justify-center gap-1 rounded-2xl border px-1 py-2 text-center transition ${
                selected
                  ? "border-[#FF4D4D] bg-[#FF4D4D]/15 text-[#F2F4F7]"
                  : "border-white/10 bg-[#171B22] text-[#98A2B3]"
              }`}
            >
              <span aria-hidden className="text-lg leading-none">
                {themeIcon(key)}
              </span>
              <span className="text-[11px] leading-tight break-keep">{THEME_LABELS[key]}</span>
            </button>
          );
        })}
      </div>

      {/* ── 한 줄 소개 (선택) ───────────────────────────────────────────── */}
      <h2 className="mt-6 mb-2 text-sm font-semibold text-[#98A2B3]">한 줄 소개 (선택)</h2>
      <div className="relative">
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value.slice(0, NOTE_MAX))}
          maxLength={NOTE_MAX}
          placeholder="어떤 곳인지 한 줄로"
          className="min-h-12 w-full rounded-2xl border border-white/10 bg-[#171B22] px-4 pr-16 text-[#F2F4F7] placeholder:text-[#98A2B3]/60"
        />
        <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-xs text-[#98A2B3]">
          {note.length}/{NOTE_MAX}
        </span>
      </div>

      {/* ── 사진 (선택, 1장) ────────────────────────────────────────────── */}
      <h2 className="mt-6 mb-2 text-sm font-semibold text-[#98A2B3]">사진 (선택, 1장)</h2>
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
            alt="올릴 사진 미리보기"
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

      {photoError ? <p className="mt-2 text-sm text-[#FF9B9B]">{photoError}</p> : null}

      {/* ── 등록하기 (§7.1) ─────────────────────────────────────────────── */}
      <button
        type="button"
        disabled={!canSubmit || submitting}
        onClick={() => void submit({ withPhoto: true, allowDuplicate: false })}
        className="mt-8 min-h-14 w-full rounded-2xl bg-[#FF4D4D] text-base font-semibold text-white disabled:bg-white/10 disabled:text-[#98A2B3]"
      >
        {submitting ? "등록하는 중…" : "등록하기"}
      </button>

      {!canSubmit && !submitting ? (
        <p className="mt-2 text-center text-xs text-[#98A2B3]">
          {outsideBusan
            ? "부산 안으로 핀을 옮겨 주세요"
            : trimmedName === ""
              ? "이름을 입력해 주세요"
              : theme === null
                ? "테마를 하나 골라 주세요"
                : "사진을 준비하는 중이에요"}
        </p>
      ) : null}

      {/* ── 제출 실패 (§7.4) — 입력은 그대로 남습니다 ───────────────────── */}
      {phase.kind === "failed" ? (
        <div className="mt-4 rounded-2xl border border-[#FF4D4D]/40 bg-[#FF4D4D]/10 p-4 text-center">
          <p className="text-sm text-[#F2F4F7]">{phase.message}</p>
          {phase.detail ? <p className="mt-1 text-xs text-[#98A2B3]">{phase.detail}</p> : null}
          <button
            type="button"
            onClick={() => void submit({ withPhoto: true, allowDuplicate: false })}
            className="mt-3 min-h-11 rounded-2xl border border-white/20 px-5 text-sm text-[#F2F4F7]"
          >
            다시 시도
          </button>
        </div>
      ) : null}

      {/* ── 사진 실패 (§7.4) — 사진만 빼고 갈지 묻습니다 ─────────────────── */}
      {phase.kind === "photo_failed" ? (
        <div className="mt-4 rounded-2xl border border-white/15 bg-[#171B22] p-4 text-center">
          <p className="text-sm break-keep text-[#F2F4F7]">{phase.message}</p>
          <p className="mt-1 text-xs text-[#98A2B3]">사진 없이 등록할 수도 있어요.</p>
          <div className="mt-3 flex justify-center gap-2">
            <button
              type="button"
              onClick={() => void submit({ withPhoto: false, allowDuplicate: false })}
              className="min-h-11 rounded-2xl bg-[#FF4D4D] px-5 text-sm font-semibold text-white"
            >
              사진 없이 등록
            </button>
            <button
              type="button"
              onClick={() => void submit({ withPhoto: true, allowDuplicate: false })}
              className="min-h-11 rounded-2xl border border-white/20 px-5 text-sm text-[#F2F4F7]"
            >
              다시 시도
            </button>
          </div>
        </div>
      ) : null}

      {/* ── 중복 안내 (§7.3) — 자동으로 막지 않습니다 ───────────────────── */}
      {phase.kind === "duplicate" ? (
        <div className="mt-4 rounded-2xl border border-white/15 bg-[#171B22] p-4">
          <p className="text-sm text-[#F2F4F7]">이미 등록된 장소 같아요</p>
          <ul className="mt-3 space-y-1">
            {phase.duplicates.map((dup, i) => (
              <li key={`${dup.name}-${i}`} className="text-sm text-[#98A2B3]">
                {dup.id ? (
                  <Link href={`/place/${dup.id}`} className="underline underline-offset-2">
                    {dup.name}
                  </Link>
                ) : (
                  <span>{dup.name}</span>
                )}
                <span className="ml-2 text-xs">
                  {Math.round(dup.distanceM)}m{dup.pending ? " · 승인 대기 중" : ""}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs break-keep text-[#98A2B3]">
            같은 건물의 다른 가게라면 그대로 등록해 주세요.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => void submit({ withPhoto: true, allowDuplicate: true })}
              className="min-h-11 flex-1 rounded-2xl bg-[#FF4D4D] text-sm font-semibold text-white"
            >
              그래도 등록하기
            </button>
            <button
              type="button"
              onClick={() => setPhase({ kind: "editing" })}
              className="min-h-11 flex-1 rounded-2xl border border-white/20 text-sm text-[#F2F4F7]"
            >
              고치기
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

export default SubmitForm;
