# 부산 Dartrip

부산 지도에 다트를 던져 갈 곳을 우연으로 정하는 웹 서비스입니다.
2026 관광데이터 활용 공모전 웹·앱 개발 부문 출품작입니다.

- 기술 구성: Next.js (App Router · TypeScript · Tailwind CSS) · Supabase (PostgreSQL + PostGIS) · Vercel
- 설계 문서는 이 저장소가 아니라 별도의 협업 폴더에 있습니다. 이 저장소에는 코드만 둡니다.
- 현재 단계: **환경 구축 · DB 스키마 · 뼈대 배포 · 장소 데이터 백필**.
  다트 기능·지도·상세 화면은 이후 단계에서 붙습니다.

---

## 1. 준비물

| 항목 | 용도 | 발급처 |
|---|---|---|
| Node.js 20 이상 | 개발 서버 · 빌드 | https://nodejs.org |
| 공공데이터포털 계정 + 서비스키 | 관광 정보 조회 | https://www.data.go.kr |
| Supabase 프로젝트 | 데이터베이스 | https://supabase.com |
| Vercel 계정 | 배포 | https://vercel.com |
| 카카오 개발자 앱 | 지도 · 길찾기 | https://developers.kakao.com |

Node 버전은 `node -v` 로 확인합니다.

---

## 2. 로컬 실행

```bash
git clone https://github.com/seo077/busan_dartrip.git
cd busan_dartrip
npm install
```

환경변수 파일을 만듭니다.

```bash
# Windows PowerShell
Copy-Item .env.example .env.local

# macOS / Linux
cp .env.example .env.local
```

`.env.local` 을 열어 값을 채운 뒤 개발 서버를 띄웁니다.

```bash
npm run dev
```

브라우저에서 http://localhost:3000 을 엽니다.

- 값을 아직 안 채웠어도 서버는 정상적으로 뜹니다. 첫 화면에 "환경변수가 아직 비어 있습니다"
  안내가 뜨고, `DATA_GO_KR_KEY` 만 채우고 서버를 다시 시작하면 곧바로 목록이 나옵니다.
- 관광 정보 원본 응답은 http://localhost:3000/api/tour 에서 볼 수 있습니다.

### 잘 되었는지 확인하는 법

첫 화면에 **"…부산 지역에 대해 현재 제공하는 장소는 총 725건입니다"** 라는 문장과
장소 카드 12장이 보이면 연동이 끝난 것입니다. **725**는 2026-08-05 실측값이며,
제공기관이 데이터를 더하거나 빼면 조금씩 달라집니다.

### 헷갈리는 네 숫자

관광공사 부산 데이터에는 **세는 대상이 서로 다른 숫자 네 개**가 나옵니다. 어느 자리에
무엇을 쓰는지 헷갈리면 용량 예산·호출량·다트 풀 두께가 전부 어긋납니다.

| 숫자 | 무엇을 센 것인가 | 어디에 쓰나 |
|---|---|---|
| **1,628** | `areaBasedSyncList2` 의 `totalCount`. **삭제·미노출 이력을 포함**한 누적 | 증분 동기화 경로의 상한 |
| **725** | `areaBasedList2` 의 `totalCount`. **현재 노출 대상만** | 첫 화면 표시 · 백필 수집량 |
| **723** | 위 725 중 실제로 `places` 에 적재된 수 | DB 용량 산정 |
| **598** | 723 중 테마가 붙은 수 (= 다트 풀) | 다트가 뽑을 수 있는 후보 수 |

- `1,628 → 725` 는 `areaBasedList2` 가 이미 `showflag='1'` 만 돌려주기 때문입니다.
  실제로 백필에서 `showflag` 로 걸러진 건수는 **0**이었습니다. `showflag` 필터는
  `areaBasedSyncList2` 를 쓰는 증분 경로 전용으로 남습니다.
- `725 → 723` 은 좌표가 부산 밖인 2건(`반송공원` · `해파랑길(부산,울산 구간)`)을 뺀 것입니다.
- `723 → 598` 은 테마 4종 어디에도 안 붙은 125건(쇼핑 56 · 숙박 69)이 미분류 보관함으로
  가기 때문입니다. 버려지지 않고 같은 표에 남아 있습니다.

여기에 **부산명소정보 213건**을 병합하면 `places` **936행** · 다트 풀 **787건**이 됩니다.

### 다트 풀 실측 표 — `npm run pool:matrix`

```bash
npm run pool:matrix              # 관광공사 단독 — API 직접 호출, DB 없이 돕니다
npm run pool:matrix -- --from-db # 병합된 실제 다트 풀 — 외부 호출 0회
```

부산 16개 구·군 × 테마 4종 = **64칸의 실제 장소 건수**를 표로 출력합니다.

- **기본 경로**는 관광공사 API 에서 직접 셉니다. `.env.local` 의 `DATA_GO_KR_KEY` 하나만
  있으면 되고, 마이그레이션을 아직 안 돌렸어도 실행됩니다(테마 규칙은 마이그레이션 SQL 을
  순서대로 읽어서 씁니다). **API 호출은 9회**이며 개발계정 한도는 1,000회/일입니다.
- **`--from-db`** 는 백필이 끝난 뒤 `places` 를 읽어, 여러 출처가 병합된 실제 다트 풀을
  셉니다. 출처별 기여와 **관광공사 단독 ↔ 병합 후 비교표**를 함께 냅니다.

옵션: `--page-size`(기본 100) · `--max-pages`(기본 30) · `--delay`(기본 200ms).
예) `npm run pool:matrix -- --delay=500`

### 백필 — `npm run backfill:*`

마이그레이션을 실행한 뒤 아래 순서로 돌립니다. 전부 로컬 실행이며 DB 에 직접 씁니다.

```bash
npm run backfill:sigungu               # 구·군 마스터 16행 (다른 백필의 선행 조건)
npm run backfill:theme-map -- --apply  # 마이그레이션의 테마 규칙을 DB 에 반영
npm run backfill:tourapi               # 관광공사 → places
npm run backfill:busan                 # 부산명소정보 → places
npm run backfill:walking               # 부산도보여행정보 → courses
npm run backfill:sigungu -- --recenter # 구·군 중심 좌표를 실제 평균으로
npm run backfill:report                # 적재 결과 요약
```

- `backfill:sigungu` 가 먼저인 이유 — `places.sigungu_code` 가 `sigungu(code)` 를
  참조하는 not null 외래키라, 이 표가 비면 장소가 한 행도 안 들어갑니다.
- 도보여행은 `places` 가 아니라 `courses` 로 갑니다. 응답 전건에 구·군·주소 필드가
  없어(`0/56`) 소속 구·군을 알 수 없고, 코스는 좌표 한 점으로 대표되지 않습니다.
- 각 스크립트는 `--dry-run` 을 받습니다. 무엇이 들어갈지 먼저 보고 싶을 때 씁니다.

### 신규 소스 정찰 — `npm run probe:sources`

부산광역시 오픈API 6종을 `numOfRows=1` 로 한 번씩(6회) 호출해 `totalCount` 와 샘플 1건의
전체 필드, 좌표·구·군·분류 필드 유무를 표로 냅니다. 새 소스를 붙일지 판단하는 재료입니다.

---

## 3. 환경변수

`.env.example` 에 전체 목록과 설명이 있습니다. 요약하면 이렇습니다.

| 이름 | 어디서 쓰나 | 공개 여부 |
|---|---|---|
| `DATA_GO_KR_KEY` | 공공데이터포털 전 API 공통 서비스키 | **서버 전용** |
| `SUPABASE_SERVICE_ROLE_KEY` | 서버에서 DB 쓰기 · 크론 | **서버 전용** |
| `KAKAO_REST_KEY` | 서버측 카카오 REST 호출 | **서버 전용** |
| `CRON_SECRET` | 크론 요청 인증 | **서버 전용** |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase 접속 주소 | 브라우저 노출 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 브라우저 읽기 (RLS 로 보호) | 브라우저 노출 |
| `NEXT_PUBLIC_KAKAO_JS_KEY` | 카카오 지도 JS SDK | 브라우저 노출 |

- `NEXT_PUBLIC_` 이 붙은 것만 브라우저로 나갑니다. 나머지는 서버에서만 읽힙니다.
- 공공데이터포털 서비스키는 **Encoding · Decoding 어느 형태를 넣어도** 동작하도록 처리해 두었습니다.
- `.env.local` 은 `.gitignore` 에 걸려 있어 저장소에 올라가지 않습니다.

---

## 4. DB 마이그레이션

`supabase/migrations/` 안의 SQL 을 **파일명 순서대로** 실행합니다.

| 파일 | 내용 |
|---|---|
| `20260804120000_init_schema.sql` | 확장 3종 · 열거형 3종 · 테이블 9종 · 인덱스 · 집계 트리거 · 다트 추출 함수 · 테마 매핑 초기값 |
| `20260804120100_rls_policies.sql` | 행 수준 보안 정책 |
| `20260805090000_theme_map_refine.sql` | 테마 매핑 규칙 보강 — `'산'` 규칙 삭제 + 88행 추가 |

**이미 실행한 마이그레이션 파일은 고치지 않습니다.** 규칙이나 스키마를 바꿀 때는 항상
새 파일을 더합니다. 뒤에서 고치면 처음부터 다시 적용했을 때와 결과가 달라집니다.

### 새 마이그레이션이 늘었을 때 — 테마 규칙만 다시 반영하기

`theme_map` 규칙만 바뀐 마이그레이션은 SQL 을 붙여넣는 대신 아래 한 줄로 반영할 수
있습니다. 마이그레이션 파일을 순서대로 읽어 그 안의 `insert`·`delete` 를 그대로
재생하므로, 붙여넣기를 빠뜨려 규칙이 옛날 상태로 남는 일이 없습니다.

```bash
npm run backfill:theme-map            # 무엇이 바뀌는지 미리보기
npm run backfill:theme-map -- --apply # 실제 반영
```

규칙만 바꾼 것이라 이미 적재된 `places.theme` 은 그대로입니다. 분류를 다시 매기려면
해당 백필을 다시 돌립니다(예: `npm run backfill:busan`).

### 방법 A — Supabase 대시보드 (권장)

1. Supabase 프로젝트 > 왼쪽 메뉴 **SQL Editor** > **New query**
2. `20260804120000_init_schema.sql` 내용을 통째로 붙여넣고 **Run**
3. 같은 방법으로 `20260804120100_rls_policies.sql` 실행

### 방법 B — Supabase CLI

```bash
npx supabase link --project-ref <프로젝트 ref>
npx supabase db push
```

### 실행 후 확인

Table Editor 에 아래 9개 테이블이 보이면 됩니다.

`sigungu` · `theme_map` · `places` · `dart_pool_stats` · `place_enrichment` ·
`courses` · `reviews` · `throws` · `sync_runs`

`theme_map` 에는 초기 매핑 규칙 13행이 들어 있고, 보강 마이그레이션까지 반영하면 **100행**이 됩니다.
나머지 테이블은 비어 있는 것이 정상입니다. 장소 데이터 적재는 다음 단계(백필)에서 합니다.

---

## 5. 배포 (Vercel)

1. Vercel > **Add New… > Project** > 이 GitHub 저장소를 선택
2. Framework 는 Next.js 로 자동 인식됩니다. 빌드 설정은 기본값 그대로 둡니다.
3. **Environment Variables** 에 `.env.local` 과 같은 이름·값을 등록합니다.
   Production · Preview · Development 세 환경 모두에 넣어 두는 편이 편합니다.
4. **Deploy** 를 누르면 공개 URL 이 만들어집니다.
5. 이후에는 `main` 브랜치에 push 할 때마다 자동으로 다시 배포됩니다.

배포 후에는 카카오 개발자 콘솔의 **플랫폼 > Web > 사이트 도메인** 에 그 URL 을 등록해야
지도 SDK 가 동작합니다.

---

## 6. 사용자가 직접 해야 하는 일

아래는 계정·키·심사와 관련된 작업이라 코드로 대신할 수 없습니다.

| # | 할 일 | 왜 필요한가 | 언제 |
|---|---|---|---|
| 1 | Supabase 프로젝트 생성 후 **URL · anon 키 · service_role 키** 확보 | DB 접속 | 마이그레이션 전 |
| 2 | `.env.example` 을 `.env.local` 로 복사하고 실제 키 입력 | 로컬 실행 | 첫 실행 전 |
| 3 | `supabase/migrations/` SQL 2개 실행 | 테이블 생성 | 백필 전 |
| 4 | Vercel 프로젝트 연결 + 환경변수 등록 + 배포 | 공개 URL 확보 | 되도록 빨리 |
| 5 | 카카오 개발자 앱 등록 + JS 키 발급 + **배포 도메인 등록** | 지도 표시 | 지도 붙이기 전 |
| 6 | **공공데이터포털 운영계정 신청** | 1차 심사 제출 항목 | **배포 URL 이 생긴 직후** |

**6번이 가장 급합니다.** 운영계정 승인요건은 세 가지인데
① 개발계정 테스트 로그 ② `MobileApp` 값이 서비스 고유명(`BusanDartrip`)
두 가지는 이미 충족돼 있고, 남은 것은 ③ **배포된 서비스 URL에서 OpenAPI 를 실제로 쓰고 있는지**
하나입니다. 이번 뼈대 배포가 그 하나를 채웁니다.

신청 경로: 공공데이터포털 > 마이페이지 > 데이터 활용 > **OpenAPI 활용신청 현황** >
해당 API 선택 > **운영계정 신청** > 활용사례(서비스 URL) 등록

심의에 며칠에서 2주가 걸립니다. 배포가 끝나는 대로 바로 신청해 주세요.

---

## 7. 폴더 구조

```
busan_dartrip/
├── app/
│   ├── layout.tsx              공통 레이아웃
│   ├── page.tsx                첫 화면 (뼈대 배포판 — 관광 정보 목록 + 출처 표기)
│   ├── globals.css
│   └── api/
│       └── tour/route.ts       GET /api/tour — 관광공사 areaBasedList2 조회
├── lib/
│   ├── tourapi.ts              웹 전용 창구 (server-only 표식만)
│   ├── tourapi.core.ts         관광공사 KorService2 호출 본체
│   ├── busanapi.core.ts        부산광역시 오픈API(6260000) 호출 본체
│   ├── theme.ts                테마 4종 · 분류 규칙 적용기
│   └── supabase.ts             Supabase 클라이언트 (anon / service_role)
├── scripts/
│   ├── lib/                    스크립트 공통 (환경변수 · 인자·표 · DB · 부산 상수 ·
│   │                           테마 규칙 · 구·군 색인과 places 적재)
│   ├── backfill/
│   │   ├── 01-sigungu.ts       areaCode2 → sigungu (+ --recenter)
│   │   ├── 02-theme-map.ts     마이그레이션의 theme_map 구문을 DB 에 반영
│   │   ├── 03-tourapi.ts       관광공사 → places
│   │   ├── 04-busan.ts         부산명소정보 → places
│   │   ├── 07-walking.ts       부산도보여행정보 → courses
│   │   └── 09-report.ts        적재 결과 요약
│   └── report/
│       ├── pool-matrix.ts      다트 풀 실측 표 (npm run pool:matrix)
│       └── source-probe.ts     신규 소스 정찰 (npm run probe:sources)
├── supabase/
│   └── migrations/             DB 스키마 · 테마 규칙 SQL
├── public/
└── .env.example                환경변수 목록
```

`lib/tourapi.ts` 와 `lib/tourapi.core.ts` 를 나눈 이유 — 스크립트(`scripts/`)는 Next 런타임
밖 순수 Node 라서 `server-only` 를 import 하면 즉시 예외가 납니다. 그래서 실구현은 `core` 에
두고, 웹 코드가 쓰는 `tourapi.ts` 에만 `server-only` 를 얹어 브라우저 번들 유출을 막습니다.

`busanapi.core.ts` 를 따로 둔 이유 — 부산시 오픈API 는 관광공사와 **규격이 다릅니다.**
형식 파라미터가 `_type` 이 아니라 `resultType`, 성공 코드가 `resultCode: "0000"` 이 아니라
`header.code: "00"`, 응답 루트가 `{오퍼레이션}.item[]` 입니다. 재사용이 불가능합니다.

백필 번호가 05·06·08 을 건너뛰는 것은 ④ `API데이터설계.md` §6.2 의 번호 체계를 그대로
따르기 때문입니다. 그 자리는 국가유산·모범음식점·재집계 몫이며 아직 만들지 않았습니다.

앞으로 추가될 것: `app/throw` · `app/result/[throwId]` · `app/place/[placeId]` ·
`app/submit` · `app/about` · `app/api/throw` · `app/api/pool/stats` ·
`app/api/cron/sync` · `lib/kakao.ts`

---

## 8. 개발 시 유의점

- **외부 공공 API 는 서버에서만 호출합니다.** 브라우저에서 직접 부르면 서비스키가 노출되고,
  공공데이터포털이 CORS 를 허용하지 않아 어차피 실패합니다.
- **`arrange` · `listYN` 파라미터를 넣지 마십시오.** `KorService2` 는 이 두 개를 거부하며
  `INVALID_REQUEST_PARAMETER_ERROR` 가 납니다. 정렬은 응답 필드로 처리합니다.
- **`showflag` 가 `'1'` 인 행만 씁니다.** `'0'` 은 제공기관이 노출하지 않기로 한 데이터이고,
  주요 필드가 비어 있어 화면이 통째로 비어 보입니다.
- **좌표는 `mapx` 가 경도, `mapy` 가 위도입니다.** 뒤바꾸면 모든 장소가 바다에 찍힙니다.
- **평점·인기·조회수 컬럼을 만들지 마십시오.** 정렬 기준을 거리 하나로 두겠다는 설계를
  스키마 수준에서 고정한 것입니다.

---

## 9. 데이터 출처

본 서비스는 아래 기관이 제공하는 공공데이터를 활용합니다.

- 한국관광공사 — 국문 관광정보 서비스 / 관광지별 연관관광지 정보 / 두루누비 정보 서비스 / 관광사진 정보 / 한국관광 데이터랩
- 부산광역시 — 부산명소정보 / 부산도보여행정보
- 행정안전부 — 전국모범음식점표준데이터
- 카카오 — 카카오맵

국가유산청 국가유산 공간정보는 **응답이 XML 전용**으로 확인돼 v1 에서는 붙이지 않습니다.

위 데이터는 공공누리 이용허락 조건에 따라 출처를 표시하여 사용합니다.
데이터의 최신성·정확성은 각 제공기관의 갱신 주기를 따르며, 실제 운영 정보는 방문 전 확인해 주세요.
