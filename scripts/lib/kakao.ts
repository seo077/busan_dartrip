/**
 * 카카오 로컬 API — 주소를 좌표로 (스크립트 전용).
 *
 * 설계 정본: `API데이터설계.md` §2(키 관리) · §3.9(카카오 지도) · §3.7(모범음식점 매칭)
 *
 * 왜 필요한가
 * ----------
 * §3.7 의 매칭 규칙은 **"좌표 50m 이내 + 상호명 정규화 일치"** 인데, 모범음식점 원본에는
 * **좌표 필드가 없습니다**(업소명·주소·전화·지정일자만 옵니다). 주소 문자열만으로 맞추면
 * 괄호 표기·번지 표기·구주소/신주소 차이 때문에 많이 놓칩니다. 그래서 **도로명주소를
 * 좌표로 바꾼 뒤 §3.7 의 원래 규칙을 그대로** 씁니다.
 *
 * 이 파일은 `scripts/` 전용입니다
 * -------------------------------
 * 앱 런타임(`app/` · `lib/`)은 이 경로를 쓰지 않습니다. 지오코딩은 **백필 시점에 한 번**
 * 일어나고 결과는 매칭에만 쓰이므로, 사용자 요청 경로에 외부 호출을 더하지 않습니다
 * (다트 실행 경로 외부 호출 0회 — `D-6`). S5 의 역지오코딩(핀 → 주소)은 방향도 시점도
 * 다른 별개의 일이라 여기 얹지 않았습니다.
 *
 * 캐시를 파일로 두는 이유
 * ----------------------
 * 같은 주소를 다시 물어볼 이유가 없습니다. 백필을 다시 돌릴 때(규칙을 손보거나 재매칭할 때)
 * 카카오 호출이 **0 회**가 되도록 `scripts/.cache/` 에 남깁니다. 캐시 키에 주소 문자열을
 * 포함시켜, 원본 주소가 바뀌면 자동으로 다시 물어봅니다.
 *
 * 호출 한도
 * --------
 * 카카오 로컬 API 무료 한도는 일 100,000 회입니다. 부산 유효 모범음식점이 342 곳이라
 * 첫 실행에서 350 회 안팎(도로명 실패 시 지번으로 1회 더)을 씁니다 — 한도의 0.4% 입니다.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { REPO_ROOT, readEnv } from "./env";

const ADDRESS_URL = "https://dapi.kakao.com/v2/local/search/address.json";

/** 캐시 파일 위치. `.gitignore` 에 올라가 있어 저장소에는 남지 않습니다. */
export const CACHE_DIR = resolve(REPO_ROOT, "scripts/.cache");

export interface GeocodeHit {
  lat: number;
  lng: number;
  /** 카카오가 되돌려준 주소 — 우리가 보낸 것과 다르면 여기서 드러납니다 */
  matchedAddress: string | null;
}

export type GeocodeOutcome =
  | ({ ok: true } & GeocodeHit)
  | { ok: false; reason: "no_key" | "not_found" | "http" | "network"; detail?: string };

export function hasKakaoKey(): boolean {
  return readEnv("KAKAO_REST_KEY") !== null;
}

/**
 * 주소 문자열을 좌표로. 찾지 못하면 실패로 돌려줍니다 — **값을 지어내지 않습니다.**
 * 근처 아무 좌표나 붙이면 50m 규칙이 엉뚱한 가게를 붙입니다.
 */
export async function geocodeAddress(
  query: string,
  timeoutMs = 15_000,
): Promise<GeocodeOutcome> {
  const key = readEnv("KAKAO_REST_KEY");
  if (!key) return { ok: false, reason: "no_key" };

  const url = `${ADDRESS_URL}?query=${encodeURIComponent(query)}&size=1`;

  let res: Response;
  try {
    res = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Authorization: `KakaoAK ${key}` },
    });
  } catch (e) {
    return { ok: false, reason: "network", detail: e instanceof Error ? e.message : String(e) };
  }

  const text = await res.text();
  if (!res.ok) return { ok: false, reason: "http", detail: `${res.status} ${text.slice(0, 160)}` };

  let doc: { y?: string; x?: string; road_address?: { address_name?: string }; address?: { address_name?: string } } | undefined;
  try {
    doc = (JSON.parse(text) as { documents?: unknown[] }).documents?.[0] as typeof doc;
  } catch {
    return { ok: false, reason: "http", detail: "응답이 JSON 이 아닙니다." };
  }
  if (!doc) return { ok: false, reason: "not_found" };

  const lat = Number(doc.y);
  const lng = Number(doc.x);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { ok: false, reason: "not_found" };

  return {
    ok: true,
    lat,
    lng,
    matchedAddress: doc.road_address?.address_name ?? doc.address?.address_name ?? null,
  };
}

/**
 * 주소 문자열을 카카오가 잘 알아듣는 모양으로 다듬습니다.
 *
 *   `부산광역시 중구 광복중앙로 31 (신창동1가, 중앙아파트)` → `부산광역시 중구 광복중앙로 31`
 *
 * 괄호 안 법정동·건물명과 쉼표 뒤 상세주소(층·호수)를 뗍니다. 이것들을 남기면 검색이
 * 통째로 실패하는 경우가 있습니다.
 */
export function tidyAddressForSearch(raw: string | null | undefined): string {
  return String(raw ?? "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/,.*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/* ── 파일 캐시 ───────────────────────────────────────────────────────────── */

interface CacheEntry {
  lat: number | null;
  lng: number | null;
  matchedAddress: string | null;
  /** 실패했을 때의 이유. 다음 실행에서 재시도할지 판단하는 데 씁니다 */
  reason: string | null;
  at: string;
}

export class GeocodeCache {
  private readonly path: string;
  private data: Record<string, CacheEntry> = {};
  private dirty = false;

  /** 이번 실행에서 실제로 카카오를 부른 횟수 */
  calls = 0;
  /** 캐시로 해결한 횟수 */
  hits = 0;

  constructor(fileName: string) {
    this.path = resolve(CACHE_DIR, fileName);
    if (existsSync(this.path)) {
      try {
        this.data = JSON.parse(readFileSync(this.path, "utf8")) as Record<string, CacheEntry>;
      } catch {
        this.data = {}; // 깨진 캐시는 버리고 다시 만듭니다. 값을 반쯤 믿는 것보다 낫습니다
      }
    }
  }

  get size(): number {
    return Object.keys(this.data).length;
  }

  /**
   * 캐시에 있으면 그대로, 없으면 카카오에 물어보고 저장합니다.
   * 캐시 키는 `식별자|주소` 라 원본 주소가 바뀌면 다시 물어봅니다.
   */
  async lookup(id: string, queries: string[]): Promise<GeocodeOutcome> {
    const usable = queries.filter((q) => q.trim() !== "");
    const key = `${id}|${usable.join("|")}`;

    const cached = this.data[key];
    if (cached) {
      this.hits += 1;
      if (cached.lat !== null && cached.lng !== null) {
        return { ok: true, lat: cached.lat, lng: cached.lng, matchedAddress: cached.matchedAddress };
      }
      return { ok: false, reason: (cached.reason as "not_found") ?? "not_found" };
    }

    let last: GeocodeOutcome = { ok: false, reason: "not_found" };
    for (const q of usable) {
      this.calls += 1;
      last = await geocodeAddress(q);
      if (last.ok) break;
      // 키가 없거나 네트워크가 끊긴 상태면 다음 후보를 물어봐야 결과가 같습니다.
      if (last.reason === "no_key" || last.reason === "network") break;
    }

    // 키 없음·네트워크 실패는 다음 실행에서 다시 시도해야 하므로 캐시에 남기지 않습니다.
    if (!last.ok && (last.reason === "no_key" || last.reason === "network")) return last;

    this.data[key] = last.ok
      ? { lat: last.lat, lng: last.lng, matchedAddress: last.matchedAddress, reason: null, at: new Date().toISOString() }
      : { lat: null, lng: null, matchedAddress: null, reason: last.reason, at: new Date().toISOString() };
    this.dirty = true;
    return last;
  }

  save(): void {
    if (!this.dirty) return;
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(this.data, null, 1), "utf8");
    this.dirty = false;
  }
}

/* ── 원본 목록 캐시 (지오코딩과 같은 자리에 둡니다) ──────────────────────── */

export interface RosterCache<T> {
  fetchedAt: string;
  items: T[];
}

export function readRoster<T>(fileName: string): RosterCache<T> | null {
  const path = resolve(CACHE_DIR, fileName);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as RosterCache<T>;
  } catch {
    return null;
  }
}

export function writeRoster<T>(fileName: string, items: T[]): void {
  const path = resolve(CACHE_DIR, fileName);
  mkdirSync(dirname(path), { recursive: true });
  const payload: RosterCache<T> = { fetchedAt: new Date().toISOString(), items };
  writeFileSync(path, JSON.stringify(payload), "utf8");
}

export function ageInDays(iso: string): number {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return Number.POSITIVE_INFINITY;
  return (Date.now() - t) / 86_400_000;
}
