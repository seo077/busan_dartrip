/**
 * 카카오 로컬 API — 좌표를 주소·행정구역으로 (역지오코딩).
 *
 * 설계 정본: `API데이터설계.md` §2(키 관리) · §8(`POST /api/places` — 역지오코딩)
 *            `화면구성도.md` §7.1("역지오코딩 결과 자동 표기") · §7.3(위치 = 부산 내부)
 *
 * 방향이 반대인 이웃 파일
 * ----------------------
 * `scripts/lib/kakao.ts` 는 **주소 → 좌표**(백필 시점, 모범음식점 매칭)입니다.
 * 이 파일은 **좌표 → 주소·구·군**(사용자 요청 시점, S5)이라 방향도 쓰는 시점도 다릅니다.
 * 캐시 구조가 서로 맞지 않아 합치지 않았습니다.
 *
 * 왜 서버에서 부르는가
 * -------------------
 * `KAKAO_REST_KEY` 는 `NEXT_PUBLIC_` 이 붙지 않은 서버 전용 값입니다(④ §2). 브라우저가
 * 직접 부르면 키가 노출되므로, 화면은 우리 Route 를 거쳐서만 이 결과를 봅니다.
 *
 * **이 파일의 결과는 등록 경로에서만 씁니다.** 다트 실행 경로(홈 → 던지기 → 결과)에는
 * 외부 호출이 하나도 없다는 전제(`D-6` · `OG-1`)는 그대로입니다.
 *
 * 실패를 예외로 올리지 않는 이유
 * -----------------------------
 * 역지오코딩이 안 되어도 등록 자체는 되어야 합니다. 주소는 **보조 표기**이고, 소속 구·군은
 * 실패 시 구·군 중심 좌표에서 가장 가까운 곳으로 정합니다(`lib/submit.ts`).
 * 그래서 모든 실패는 `null` 로 돌아옵니다.
 */

import "server-only";

const REGION_URL = "https://dapi.kakao.com/v2/local/geo/coord2regioncode.json";
const ADDRESS_URL = "https://dapi.kakao.com/v2/local/geo/coord2address.json";

const TIMEOUT_MS = 6_000;

export interface ReverseGeocode {
  /** 시·도 이름 — '부산광역시'. 값이 있으면 부산 판정의 두 번째 근거가 됩니다 */
  region1: string | null;
  /** 구·군 이름 — '영도구'. `sigungu.name` 과 맞춰 소속 구·군을 정합니다 */
  region2: string | null;
  /** 법정동 이름 — '영선동4가' */
  region3: string | null;
  /** 도로명주소 — '부산 영도구 흰여울길 88' */
  roadAddress: string | null;
  /** 지번주소 — '부산 영도구 영선동4가 1044-6' */
  address: string | null;
}

export function hasKakaoRestKey(): boolean {
  const key = process.env.KAKAO_REST_KEY;
  return typeof key === "string" && key.trim() !== "";
}

async function callKakao(url: string): Promise<unknown | null> {
  const key = process.env.KAKAO_REST_KEY?.trim();
  if (!key) return null;

  try {
    const res = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Authorization: `KakaoAK ${key}` },
    });
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
}

interface RegionDoc {
  region_type?: string;
  region_1depth_name?: string;
  region_2depth_name?: string;
  region_3depth_name?: string;
}

interface AddressDoc {
  road_address?: { address_name?: string } | null;
  address?: { address_name?: string } | null;
}

function documents<T>(body: unknown): T[] {
  if (!body || typeof body !== "object") return [];
  const docs = (body as { documents?: unknown }).documents;
  return Array.isArray(docs) ? (docs as T[]) : [];
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/**
 * 좌표 한 점의 행정구역과 주소. 키가 없거나 호출이 실패하면 `null` 입니다.
 *
 * 두 번 부르는 이유 — 카카오는 행정구역(`coord2regioncode`)과 주소(`coord2address`)를
 * 다른 오퍼레이션으로 나눠 두었습니다. 구·군은 앞쪽이 정확하고(법정동 기준),
 * 사람이 읽는 주소는 뒤쪽이 낫습니다. 둘 중 하나만 실패해도 나머지는 씁니다.
 */
export async function reverseGeocode(
  lat: number,
  lng: number,
): Promise<ReverseGeocode | null> {
  if (!hasKakaoRestKey()) return null;

  const query = `x=${encodeURIComponent(String(lng))}&y=${encodeURIComponent(String(lat))}`;

  const [regionBody, addressBody] = await Promise.all([
    callKakao(`${REGION_URL}?${query}`),
    callKakao(`${ADDRESS_URL}?${query}`),
  ]);

  if (regionBody === null && addressBody === null) return null;

  // 행정동(H)과 법정동(B)이 함께 오는데, 우리가 쓰는 구·군 이름은 둘이 같습니다.
  // 법정동을 먼저 보는 것은 `region_3depth_name` 이 주소 표기와 맞기 때문입니다.
  const regions = documents<RegionDoc>(regionBody);
  const region = regions.find((d) => d.region_type === "B") ?? regions[0];

  const addressDoc = documents<AddressDoc>(addressBody)[0];

  return {
    region1: text(region?.region_1depth_name),
    region2: text(region?.region_2depth_name),
    region3: text(region?.region_3depth_name),
    roadAddress: text(addressDoc?.road_address?.address_name),
    address: text(addressDoc?.address?.address_name),
  };
}

/**
 * 시·도 이름이 부산인지. 카카오는 '부산광역시' 로 돌려주지만 표기 흔들림에 대비해
 * '부산' 이 앞에 오는지만 봅니다.
 *
 * **이 판정은 보조입니다.** 1차 판정은 외부에 기대지 않는 `isInBusanBox()`(`lib/geo.ts`)이고,
 * 이 함수는 값이 있을 때만 한 겹 더 좁힙니다 — 키가 없거나 호출이 실패한 날에
 * 등록이 통째로 막히면 안 되기 때문입니다.
 */
export function looksBusan(region1: string | null): boolean {
  return region1 !== null && region1.startsWith("부산");
}
