/**
 * 한국관광공사 — 관광사진 정보 (S4 사진 캐러셀 보강).
 *
 * 설계 정본: `API데이터설계.md` §3.4 / `화면구성도.md` §6.1 · §6.3-1
 *
 * 설계가 미리 적어 둔 제약이 그대로입니다 — 이 서비스는 **장소가 아니라 키워드로** 찾습니다.
 * 그래서 장소 단위 정확 매칭이 되지 않고, 못 맞히면 대표 이미지 1장으로 줄어듭니다(§13 U-6).
 *
 * 캐러셀의 주 재료는 이 API 가 아닙니다
 * -------------------------------------
 * 실제로 같은 장소의 사진을 정확히 주는 것은 국문 관광정보 서비스의 `detailImage2` 입니다
 * (`lib/tourapi.core.ts` `fetchPlaceImages`). 이 파일은 그 위에 **키워드로 걸리는 사진을 더**
 * 얹는 자리입니다. 둘 다 비면 대표 이미지 1장이 남고, 그것도 없으면 테마 배경이 남습니다.
 *
 * 저작권 표기
 * -----------
 * 응답의 촬영자(`galPhotographer`)를 함께 들고 옵니다. 값이 있으면 캐러셀 아래에 표기합니다
 * (§3.4 "표기 의무가 있으면 캐러셀 하단에 출처 표기").
 */

import { callPortalAny, pick, type PortalCallResult } from "@/lib/dataportal.core";

/** 서비스 경로. 2026-08-05 확인 — 설계 §3.4 의 잠정 경로가 맞았습니다. */
export const PHOTO_SERVICE = "B551011/PhotoGalleryService1";

/**
 * 오퍼레이션명 — 2026-08-05 실호출로 **존재 여부만** 확인했습니다.
 *
 * 아직 이 서비스에 대해 서비스키가 활용신청되지 않아 본문은 못 봤지만, 포털이 없는 이름에는
 * 코드 12(서비스 없음)로, 있는 이름에는 코드 30(키 미등록)으로 답하기 때문에 **이름이
 * 실재하는지는 키 없이도 갈립니다**.
 *
 *   실재  `gallerySearchList1` · `galleryList1` · `galleryDetailList1`
 *   없음  `galleryKeywordList1` · `galleryLocationList1` · `galleryMetaList1` · `galleryTagList1`
 *
 * 없는 이름을 후보에 남겨 두면 매번 헛호출이 한 번씩 더 나가므로 실재하는 것만 둡니다.
 */
const OPERATIONS = ["gallerySearchList1", "galleryList1"] as const;

export interface GalleryPhoto {
  url: string;
  title: string | null;
  /** 촬영자 — 있으면 화면에 표기합니다 */
  photographer: string | null;
  location: string | null;
}

export interface PhotoResult {
  photos: GalleryPhoto[];
  operation: string;
  envelopePath: string | null;
  fieldsSeen: string[];
  totalCount: number | null;
  /** 어떤 키워드로 찾았는지 */
  keyword: string;
}

const URL_KEYS = ["galWebImageUrl", "galWebImageURL", "webImageUrl", "originimgurl"] as const;
const TITLE_KEYS = ["galTitle", "title", "imgname"] as const;
const PHOTOGRAPHER_KEYS = ["galPhotographer", "photographer"] as const;
const LOCATION_KEYS = ["galPhotographyLocation", "location"] as const;

function toPhotos(result: PortalCallResult, keyword: string): PhotoResult {
  const seen = new Set<string>();
  const photos: GalleryPhoto[] = [];

  for (const raw of result.items) {
    const url = pick(raw, URL_KEYS);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    photos.push({
      url,
      title: pick(raw, TITLE_KEYS),
      photographer: pick(raw, PHOTOGRAPHER_KEYS),
      location: pick(raw, LOCATION_KEYS),
    });
  }

  return {
    photos,
    operation: result.operation,
    envelopePath: result.envelopePath,
    fieldsSeen: result.fieldsSeen,
    totalCount: result.totalCount,
    keyword,
  };
}

/**
 * 장소 이름을 키워드로 사진을 찾습니다.
 * 실패는 예외로 올립니다 — 부르는 쪽이 이유별로 캐시 수명을 다르게 잡습니다.
 */
export async function fetchGalleryPhotos(
  keyword: string,
  options: { limit?: number } = {},
): Promise<PhotoResult> {
  const limit = options.limit ?? 8;

  const result = await callPortalAny(PHOTO_SERVICE, OPERATIONS, {
    keyword,
    numOfRows: 20,
    pageNo: 1,
  });

  const mapped = toPhotos(result, keyword);
  return { ...mapped, photos: mapped.photos.slice(0, limit) };
}
