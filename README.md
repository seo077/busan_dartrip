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

http://localhost:3000/api/tour 를 열어 `totalCount` 가 **725** 근처로 나오고 `items` 에
장소가 채워져 있으면 공공데이터 연동이 끝난 것입니다. **725**는 2026-08-05 실측값이며,
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
npm run backfill:detail                # 소개·전화·홈페이지 (detailCommon2)
npm run backfill:goodfood              # 모범음식점 배지 → places.is_good_restaurant
npm run backfill:walking               # 부산도보여행정보 → courses
npm run backfill:sigungu -- --recenter # 구·군 중심 좌표를 실제 평균으로
npm run backfill:report                # 적재 결과 요약
```

- `backfill:sigungu` 가 먼저인 이유 — `places.sigungu_code` 가 `sigungu(code)` 를
  참조하는 not null 외래키라, 이 표가 비면 장소가 한 행도 안 들어갑니다.
- 도보여행은 `places` 가 아니라 `courses` 로 갑니다. 응답 전건에 구·군·주소 필드가
  없어(`0/56`) 소속 구·군을 알 수 없고, 코스는 좌표 한 점으로 대표되지 않습니다.
- 각 스크립트는 `--dry-run` 을 받습니다. 무엇이 들어갈지 먼저 보고 싶을 때 씁니다.
- `backfill:detail` 은 **장소 한 건당 API 를 1회** 부릅니다. 2026-08-05 실행 기준 **598회**
  이며 개발계정 한도는 1,000회/일입니다. 같은 날 다른 것도 돌렸다면 `-- --limit=300` 처럼
  나눠 돌리고, 다음 날 그냥 다시 실행하면 남은 것만 집습니다(재개에 커서가 필요 없습니다).
  이 백필이 끝나면 **S4 를 열 때 `detailCommon2` 를 부르지 않습니다.**
- `backfill:goodfood` 는 **모범음식점 원본에 좌표가 없어** 도로명주소를 카카오 로컬 API 로
  좌표로 바꾼 뒤 "50m 이내 + 상호명 일치"로 맞춥니다. 첫 실행은 포털 655회(전국 65,426건을
  100건씩) + 카카오 342회를 쓰고, 결과를 `scripts/.cache/` 에 남겨 **다시 돌리면 외부 호출이
  0회**입니다. 원본을 새로 받으려면 `-- --refresh`. 붙이지 못한 곳은 억지로 붙이지 않고
  "붙이지 않은 근접 후보" 표로 출력합니다 — 없는 인증을 표시하지 않기 위해서입니다.
  **배지는 표시 전용이라 다트 추출·정렬·필터에 관여하지 않습니다.**

### 증분 동기화 크론 — `GET /api/cron/sync`

배포 후 **하루 1회 Vercel Cron 이 자동으로** 부릅니다. 사람이 부를 일은 확인할 때뿐입니다.

```bash
# 로컬에서 한 번 돌려 보기 (dev 서버가 떠 있어야 합니다)
curl -H "x-cron-secret: <.env.local 의 CRON_SECRET>" http://localhost:3000/api/cron/sync
```

- `CRON_SECRET` 이 없거나 틀리면 **401** 입니다. 이 경로는 외부 API 를 부르고 DB 에 쓰므로
  열어 두면 아무나 일 한도(1,000회)를 태울 수 있습니다.
- 확인용 스위치: `?dryRun=1`(쓰지 않고 계산만) · `?audit=1`(집계표 대조를 강제로) ·
  `?from=YYYYMMDD`(그 날짜부터 다시).
- **변경분이 0건이어도 `sync_runs` 에 행이 남습니다.** 이게 이 크론의 첫째 목적입니다 —
  Supabase 무료 티어는 7일 무활동이면 프로젝트를 정지시킵니다. 심사 기간(2026-10)에
  그 상태가 되면 서비스가 통째로 멈춥니다.
- 관광공사 `areaBasedSyncList2` 의 `modifiedtime` 은 **"그 날짜 이후" 가 아니라 "그 날 하루"**
  입니다(2026-08-05 실측). 그래서 날짜를 하루씩 짚어 부르고, 밀린 날짜는 `sync_runs.cursor`
  에 남겨 다음 실행이 이어받습니다.
- **커서가 앞서 있어도 최소 3일은 되짚습니다** (2026-08-06 신설). 커서만 따라가면 되짚는 폭이
  사실상 하루라, 공사가 **수정분을 며칠 뒤 배치에 실어 보내면** 커서가 이미 지나가 그 건은
  영영 안 들어옵니다. 폭을 3일로 두면 그 구멍이 닫히고, 대가는 **실행당 호출 2~3회 증가**뿐
  입니다(일 한도 1,000회). 평상시 호출은 **하루 3~4회**입니다. `upsert` 라 같은 행을 다시 봐도
  중복이 쌓이지 않습니다.
- **커서를 지나친 날짜가 영구 누락되는 것은 아닙니다.** 되짚는 범위가 커서 날짜를 **포함**
  하므로, 그 날 갱신분을 놓쳐도 다음 실행이 같은 날짜를 다시 짚습니다 — 최대 하루 지연입니다.

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
| `20260805150000_place_enrichment_detail_kind.sql` | 캐시 종류에 `'detail'` 추가 — 소개·전화·홈페이지를 사진 행에서 분리 |
| `20260805170000_storage_place_photos.sql` | 등록·후기 사진 보관함(Storage 버킷 `place-photos`, 공개 읽기 · 1MB) |
| `20260805210000_reviews_unique_author.sql` | 후기 중복 방지 — `reviews (place_id, author_ref)` 부분 유니크 인덱스 (`anon:unknown` 제외) |
| `20260806100000_rate_limits.sql` | 익명 공개 경로 상한 (`DF-4`) — `rate_limits` 표 + `consume_rate_limit` 함수 |
| `20260806140000_function_grants.sql` | 함수 실행 권한 좁히기 (`X-37`) |
| `20260808090000_sync_runs_cleanup.sql` | **만료 정리 건수 기록** (`X-47`) — `sync_runs.cleanup` 열 추가 |
| `20260809090000_sync_runs_audit.sql` | **집계표 대조 결과 기록** (`X-50`) — `sync_runs.audit` 열 추가 |

> 위 표는 **2026-08-09 기준 전건**입니다. 앞의 셋이 표에 없던 것은 각 마이그레이션을 더한
> 회차가 이 표를 함께 훑지 않았기 때문이며, 그 재발을 막는 규칙이
> `ARCHITECTURE.md` §부록 「문서 운용 안내」 ㉮ 입니다.

새 파일이 늘었을 때도 방법은 같습니다. **Supabase 대시보드 > SQL Editor 에 그 파일 내용을
붙여넣고 Run** 하면 끝이며, 여러 번 실행해도 결과가 같게 써 두었습니다.

**이미 실행한 마이그레이션 파일은 고치지 않습니다.** 규칙이나 스키마를 바꿀 때는 항상
새 파일을 더합니다. 뒤에서 고치면 처음부터 다시 적용했을 때와 결과가 달라집니다.

#### 후기 중복 방지 인덱스 — 아직 실행하지 않았다면

`20260805210000_reviews_unique_author.sql` 을 **SQL Editor 에 붙여넣고 Run** 하면 적용됩니다.
같은 기기가 같은 장소에 두 번 남기지 못하게 하는 마지막 잠금이며, 애플리케이션 검사만으로는
못 막는 **동시 요청(더블탭)** 을 여기서 잡습니다. 실행하지 않아도 서비스는 그대로 동작하고
평상시 판정도 같습니다 — 다만 그 경합 한 가지가 열려 있습니다.

인덱스를 만들기 전에 이미 쌓인 중복이 있으면 **같은 (장소 · 작성자) 묶음에서 먼저 남긴 한
건만 남기고 뒤엣것을 지웁니다.** 몇 건을 지웠는지는 실행 결과의 Notice 로 나옵니다.

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

상한 마이그레이션(`20260806100000_rate_limits.sql`)까지 실행하면 **`rate_limits` 가 더해져
10개**입니다.

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

### 크론 (`vercel.json`)

```json
{ "crons": [ { "path": "/api/cron/sync", "schedule": "0 20 * * *" }] }
```

`0 20 * * *` = 매일 **20:00 UTC = 다음 날 05:00 KST** 입니다.

**왜 05시대인가 (`D-44`)** — 한국관광공사는 콘텐츠를 **매일 새벽 04:00 에 동기화**하고, 국문
관광정보는 **04:30 이후에 호출해야** 그 날 갱신분이 담깁니다(`tourapi@knto.or.kr` 회신
2026-08-06). 아래 표대로 Hobby 플랜은 **분 단위를 지키지 않고 지정 시각이 든 한 시간 안**에
발화하므로, 04:30 이후를 보장하려면 **분이 아니라 시를 옮겨야** 합니다 — `40 19`(04:40) 로
적어도 실제 창은 04:00~05:00 이라 04:30 이전 발화가 남습니다. 종전 값 `0 19 * * *`(창
04:00~05:00)에서 관측된 04:31 발화는 그 창 안의 우연이었습니다. **되돌리지 마십시오.**

Hobby 플랜의 제약과 이 설정의 관계입니다.

| 제약 | 값 | 이 설정 |
|---|---|---|
| 크론 개수 | 2개까지 | 1개 |
| 실행 빈도 | **하루 1회까지** (시·분 단위 스케줄 불가) | 하루 1회 |
| 실행 시각 | 지정 시각이 든 **1시간 안** 어디선가 (정각 보장 없음) | **이 제약이 시각 선택을 지배합니다** — 창이 05:00~06:00 KST 라 공사 동기화(04:00 종료, 04:30 이후 호출)와 겹치지 않습니다 |
| 함수 실행 시간 | 60초 | `maxDuration = 60`, 내부 예산은 **40초** |

내부 예산을 상한보다 짧게 둔 이유 — 60초에 그냥 잘리면 `sync_runs` 가 `running` 인 채로
남아 "실행 중 오류" 와 "실행 자체가 멈춤" 을 구분할 수 없게 됩니다. 40초에서 스스로 멈추면
커서를 남기고 정상 종료하며, 밀린 날짜는 다음 날 실행이 이어받습니다.

**환경변수 `CRON_SECRET` 을 Vercel 에도 등록해야 합니다.** 없으면 크론이 500 으로 실패합니다.

### 배포본이 어느 커밋인지 — `GET /api/version`

```bash
curl -s https://busan-dartrip.vercel.app/api/version
# → {"ok":true,"source":"vercel","commit":"…","commitShort":"0fa5fa9","ref":"main",
#     "deploymentId":"dpl_…","env":"production",
#     "crons":[{"path":"/api/cron/sync","schedule":"0 20 * * *"}], … }
```

로컬의 `git rev-parse HEAD` 와 `commit` 을 맞춰 보면 **"내가 보고 있는 코드가 지금 서 있는
코드인가"** 가 한 번에 끝납니다. 값은 Vercel 이 넣어 주는 시스템 환경변수에서 오고, 우리가
등록할 것은 없습니다.

**`crons` 를 함께 싣는 것이 핵심입니다.** `vercel.json` 같은 설정 파일은 번들에 들어가지
않아 **빌드 산출물을 아무리 대조해도 반영 여부를 알 수 없습니다.** 크론 시각을 옮긴 커밋이
실제로 배포됐는지가 이 값 하나로 확인됩니다. 커밋 메시지·작성자는 필요가 없어 싣지 않습니다.

로컬에서 부르면 `source: "local"` · `commit: null` 이 정상입니다 — 모르는 값을 지어내지
않습니다. `/api/health` 에도 커밋 7자만 얹혀 있어 감시 화면만 봐도 대략은 보입니다.

---

## 6. 사용자가 직접 해야 하는 일

아래는 계정·키·심사와 관련된 작업이라 코드로 대신할 수 없습니다.

| # | 할 일 | 왜 필요한가 | 언제 |
|---|---|---|---|
| 1 | Supabase 프로젝트 생성 후 **URL · anon 키 · service_role 키** 확보 | DB 접속 | 마이그레이션 전 |
| 2 | `.env.example` 을 `.env.local` 로 복사하고 실제 키 입력 | 로컬 실행 | 첫 실행 전 |
| 3 | `supabase/migrations/` SQL **전건 실행** — 현재 **10개**, §4 표의 **파일명 순서대로** | 테이블 생성 · 이후 열·정책 추가분 반영 | 백필 전 (뒤에 늘어난 파일은 **그때그때**) |
| 4 | Vercel 프로젝트 연결 + 환경변수 등록(**`CRON_SECRET` 포함**) + 배포 | 공개 URL 확보 · 크론 동작 | 되도록 빨리 |
| 5 | 카카오 개발자 앱 등록 + JS 키 발급 + **배포 도메인 등록** | 지도 표시 | 지도 붙이기 전 |
| 6 | **공공데이터포털 운영계정 신청** | 1차 심사 제출 항목 | **배포 URL 이 생긴 직후** |
| 7 | **Supabase Authentication > 확인 메일(Confirm email) 끄기** | **이걸 끄지 않으면 가입이 되지 않습니다** — 아래 설명 | 로그인 기능을 쓰기 전 |

**7번은 로그인의 전제 조건입니다.** 화면은 아이디만 받고 서버가 `<아이디>@dartrip.local` 을
만들어 Supabase Auth 로 넘깁니다(`AD-19`). 받는 곳이 없는 주소라, 확인 메일이 켜져 있으면
Supabase 가 그 주소로 메일을 보내려다 **`over_email_send_rate_limit` 으로 가입이 실패**합니다
(2026-08-08 실측). 경로 = Supabase 프로젝트 > **Authentication > Sign In / Providers > Email**
> `Confirm email` 끄기.

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
│   ├── page.tsx                S1 홈 · 다트 설정
│   ├── result/[throwId]/       S3 결과
│   ├── place/[placeId]/        S4 장소 상세
│   ├── submit/                 S5 장소 등록
│   ├── about/                  S6 정보
│   ├── privacy/                S6-2 개인정보 처리방침
│   ├── login/ · signup/        S7 로그인 · 가입
│   ├── stamps/                 S8 구·군 스탬프판  (로그인 필수)
│   ├── archive/                S9 여행 기록      (로그인 필수)
│   ├── data/                   공공데이터 연동 확인 화면 (AD-14)
│   ├── globals.css
│   └── api/                    throw · pool/stats · places(+reviews·visit·enrich) ·
│                               geo/* · upload · tour · health · version ·
│                               auth/{signup,login,logout} · cron/sync
├── lib/
│   ├── tourapi.ts              웹 전용 창구 (server-only 표식만)
│   ├── tourapi.core.ts         관광공사 KorService2 호출 본체
│   ├── busanapi.core.ts        부산광역시 오픈API(6260000) 호출 본체
│   ├── theme.ts                테마 4종 · 분류 규칙 적용기
│   ├── supabase.ts             Supabase 클라이언트 (anon / service_role)
│   ├── auth.ts                 쿠키 세션 · 아이디→합성 이메일 (AD-19)
│   └── visit.ts                방문 기록 · 스탬프판 · 아카이빙 (AD-21)
├── scripts/
│   ├── lib/                    스크립트 공통 (환경변수 · 인자·표 · DB · 부산 상수 ·
│   │                           테마 규칙 · 구·군 색인과 places 적재)
│   ├── backfill/
│   │   ├── 01-sigungu.ts       areaCode2 → sigungu (+ --recenter)
│   │   ├── 02-theme-map.ts     마이그레이션의 theme_map 구문을 DB 에 반영
│   │   ├── 03-tourapi.ts       관광공사 → places
│   │   ├── 04-busan.ts         부산명소정보 → places
│   │   ├── 05-detail.ts        detailCommon2 → places.overview·tel·homepage
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

백필 번호가 06·08 을 건너뛰는 것은 ④ `API데이터설계.md` §6.2 의 번호 체계를 그대로
따르기 때문입니다. 그 자리는 모범음식점·재집계 몫이며 아직 만들지 않았습니다.

`app/api/cron/sync/route.ts` 는 누가 불렀는지 확인하는 일만 하고, 실제 동기화는
`lib/sync.ts` 에 있습니다. 크론 스케줄러의 요청 처리와 파이프라인을 나눠 두면 파이프라인을
스크립트·테스트에서도 같은 코드로 부를 수 있습니다.

위 목록 중 `app/submit` · `app/about` · `lib/kakao.ts` · `scripts/backfill/06-goodfood.ts` 는
**이미 있습니다** — 앞선 회차에 만들어졌는데 이 절이 계속 "앞으로 추가될 것" 으로 적고
있었습니다(2026-08-08 정정). **아직 없는 것은 `scripts/backfill/08-recount.ts` 하나**이며,
그 몫(집계표 재집계·대조)은 현재 증분 크론이 주 1회 수행합니다(④ §6.3 ⑥).

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

- 출처: ⓒ한국관광공사 — 국문 관광정보 서비스 / 관광지별 연관관광지 정보 / 두루누비 정보 서비스 / 관광사진 정보
- 출처: 부산광역시 — 부산명소정보 / 부산도보여행정보
- 출처: 행정안전부 — 전국모범음식점표준데이터
- 출처: 카카오 — 카카오맵

**표기 형식은 주최 측 공식 공지가 정합니다** — 올바른 표기는 `출처: ⓒ한국관광공사`(또는
`출처: ⓒ한국관광콘텐츠랩`)이고, **`TourAPI` 처럼 API 서비스명만 단독으로 적는 것은 불가**이며
**로고 이미지 없이 텍스트로만** 적습니다. `ⓒ` 는 한국관광공사 데이터에만 붙이고 나머지 기관은
공공누리 표준대로 기관명만 적습니다 — 공지가 형식을 정한 것이 공사 데이터이기 때문입니다.

위 목록의 기준은 하나입니다 — **서비스가 실제로 호출하면 적고, 호출하지 않으면 뺍니다.**
공공누리 출처표시 의무는 활용한 데이터에 대한 것이라, 안 쓰는 이름이 섞이면 사실과
달라집니다. 그래서 아래 두 건은 상시 표기에 없습니다.

**국가유산청 국가유산 공간정보** — **응답이 XML 전용**으로 확인돼 v1 에서 붙이지 않았습니다.
호출하지도, 설계에 참고하지도 않았으므로 상시 출처 표기(`components/DataSources.tsx`)와
S6 정보 화면(`app/about/page.tsx`) 어디에도 적지 않습니다. 보류 사실은 개발자가 읽는
이 자리에만 남깁니다. v2 에서 XML 파서를 붙여 실제로 호출하게 되면 그때 두 곳에 올립니다.

**한국관광 데이터랩** — 설계 단계에 저방문 구·군을 고르려고 통계를 한 번 참고했을 뿐,
서비스가 호출하지 않습니다. 상시 출처 표기에는 두지 않고 S6 정보 화면의 "설계 단계 참고
자료" 에만 적습니다 — 참고한 사실을 숨길 이유는 없으나 상시 출처로 적으면 사실과 다릅니다.
`D-7` 시드 발굴에서 실제로 호출하게 되면 그때 상시 표기로 올립니다.

반대로 **부산광역시 부산도보여행정보**는 `scripts/backfill/07-walking.ts` 가 실제로 호출해
`courses` 56건을 적재하고 장소 상세의 "주변 도보 코스" 가 그 표를 읽으므로, 위 상시 표기
목록에 있습니다.

> 출처를 옮길 때는 **`components/DataSources.tsx` · `app/about/page.tsx` · 본 절 세 곳을
> 한 번에** 고칩니다. 한쪽만 고치면 화면과 문서가 어긋납니다.

위 데이터는 공공누리 이용허락 조건에 따라 출처를 표시하여 사용합니다.
데이터의 최신성·정확성은 각 제공기관의 갱신 주기를 따르며, 실제 운영 정보는 방문 전 확인해 주세요.
