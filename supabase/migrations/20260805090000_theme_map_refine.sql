-- ============================================================================
-- 부산 Dartrip — theme_map 규칙 보강 (D-34)
--
-- 설계 정본: `API데이터설계.md` §4.1 · §4.3 / `ARCHITECTURE.md` AD-2 · AD-13
--
-- 초기 스키마(20260804120000)는 `busan_attraction` 규칙 8행을 **'추정'** 으로 두고
-- "백필 후 결과로 조정" 한다고 적어 두었습니다. 2026-08-05 백필 213건 실적재로
-- 그 조정 근거가 나왔으므로 본 파일에서 조정합니다.
--
-- **초기 스키마 파일을 고치지 않습니다.** 이미 실행된 마이그레이션을 뒤에서 바꾸면
-- 다시 처음부터 적용했을 때와 결과가 달라집니다. 항상 새 파일로 덧씌웁니다.
--
-- 무엇을 바꾸는가
-- --------------
-- ① `'산' → 자연` 삭제.
--    keyword 는 부분 일치라 `'산'` 이 **`'부산…'` 에 걸립니다.** 실측에서 명소 206개
--    이름 중 58개가 `'산'` 을 포함했고 이 규칙이 51건을 자연으로 가져갔는데,
--    그 안에 `부산도서관` · `롯데월드 어드벤처 부산` · `부산해양자연사박물관` ·
--    `백산기념관` 이 들어 있었습니다. 자연 건수를 절반 넘게 부풀리던 규칙입니다.
--
-- ② 실제 산·섬·대 이름을 **개별 등재**. 실데이터에 나타난 것만 넣습니다.
--
-- ③ 미분류 보관함을 훑어 규칙으로 흡수. 시설 유형(기념관·전시관·수목원…)이
--    개별 이름보다 정보량이 많으므로 **유형 규칙을 먼저, 고유명을 마지막에** 봅니다.
--
-- 우선순위 규약 (작을수록 먼저, `lib/theme.ts` 가 이 순서로 적용)
-- --------------------------------------------------------------
--   60  문화 시설 유형   기념관 · 전시관 · 향교 …
--   65  액티비티 유형    야구장 · 레포츠 · 케이블카 …
--   70  자연 유형        수목원 · 숲 · 전망대 · 수원지 …
--   90  초기 스키마 잔존 해수욕장 · 공원 · 계곡 · 박물관 · 미술관 · 마을 · 거리
--   95  고유명 (마지막)  금정산 · 태종대 · 범어사 …
--
-- 고유명을 **마지막에** 두는 이유 — 고유명은 더 긴 이름의 일부일 수 있습니다.
-- `범어사` 를 먼저 보면 `범어사 용성계곡`(자연) 까지 문화로 끌고 갑니다.
-- 마지막에 두면 `계곡`(90) 이 먼저 잡아 자연으로 남고, `범어사` 단독 항목만
-- 문화로 갑니다. `장산` ↔ `반여 초록공원 장산 계곡`, `해운대` ↔ `해운대 수목원`
-- 도 같은 구조입니다.
--
-- 무엇을 **안** 바꾸는가
-- ---------------------
-- 관광공사(`tourapi`) 규칙은 손대지 않습니다. 그쪽 미분류 125건은 전부
-- `A04`(쇼핑 56) · `B02`(숙박 69)이고, 테마 4종에 대응하는 자리가 없어
-- 미분류 보관함에 남는 것이 맞습니다 (D-5 테마 4종 유지 — D-35).
-- 테마 4종 · 구·군 구조 · 다트 추출은 전혀 건드리지 않습니다.
-- ============================================================================

-- ── ① '산' 규칙 삭제 ─────────────────────────────────────────────────────────
delete from theme_map
 where source = 'busan_attraction'
   and match_kind = 'keyword'
   and match_value in ('산');

-- ── ②③ 규칙 보강 ────────────────────────────────────────────────────────────
insert into theme_map (source, match_kind, match_value, theme, priority, note) values
  -- 문화 시설 유형 (60)
  ('busan_attraction', 'keyword', '기념관',   'culture',  60, '실측 — 박태준·우장춘·임시수도·유엔평화·고려제강'),
  ('busan_attraction', 'keyword', '역사관',   'culture',  60, '실측 — 조선통신사·국립일제강제동원·근현대'),
  ('busan_attraction', 'keyword', '전시관',   'culture',  60, '실측 — 동삼동패총·산복도로'),
  ('busan_attraction', 'keyword', '홍보관',   'culture',  60, '실측 — 북항재개발'),
  ('busan_attraction', 'keyword', '문학관',   'culture',  60, '실측 — 요산김정한'),
  ('busan_attraction', 'keyword', '과학관',   'culture',  60, '실측 — 국립부산·국립수산'),
  ('busan_attraction', 'keyword', '민속관',   'culture',  60, '실측 — 부산어촌'),
  ('busan_attraction', 'keyword', '체험관',   'culture',  60, '실측 — 국악체험관'),
  ('busan_attraction', 'keyword', '국악원',   'culture',  60, '실측 — 국립부산국악원'),
  ('busan_attraction', 'keyword', '도서관',   'culture',  60, '실측 — 부산도서관·북두칠성. 종전에는 ''산'' 규칙 탓에 자연이었음'),
  ('busan_attraction', 'keyword', '아트센터', 'culture',  60, '실측 — 홍티·지그재그'),
  ('busan_attraction', 'keyword', '갤러리',   'culture',  60, '실측 — 수정·플레이리스트·최민식'),
  ('busan_attraction', 'keyword', '영화관',   'culture',  60, '실측 — 독립영화관'),
  ('busan_attraction', 'keyword', '극장',     'culture',  60, '실측 — 모퉁이극장·자동차극장'),
  ('busan_attraction', 'keyword', '전당',     'culture',  60, '실측 — 영화의 전당'),
  ('busan_attraction', 'keyword', '문화',     'culture',  60, '실측 — 문화원·문화예술플랫폼·문화공감·문화마을·문화센터'),
  ('busan_attraction', 'keyword', '향교',     'culture',  60, '실측 — 동래·기장'),
  ('busan_attraction', 'keyword', '읍성',     'culture',  60, '실측 — 동래읍성'),
  ('busan_attraction', 'keyword', '성당',     'culture',  60, '실측 — 죽성성당'),
  ('busan_attraction', 'keyword', '순교자',   'culture',  60, '실측 — 오륜대 순교자 성지. ''성지''로 걸면 ''성지곡수원지''(자연)를 잘못 가져감'),
  ('busan_attraction', 'keyword', '생가',     'culture',  60, '실측 — 박차정의사'),
  ('busan_attraction', 'keyword', '광장',     'culture',  60, '실측 — 송상현광장'),
  ('busan_attraction', 'keyword', '책방',     'culture',  60, '실측 — 보수동책방골목'),
  ('busan_attraction', 'keyword', '등대',     'culture',  60, '실측 — 대항 어항동 방파제 등대'),

  -- 액티비티 유형 (65)
  ('busan_attraction', 'keyword', '야구장',     'activity', 65, '실측 — 사직야구장'),
  ('busan_attraction', 'keyword', '레포츠',     'activity', 65, '실측 — 황령산레포츠공원. ''공원''(90)보다 먼저 봐야 액티비티로 남음'),
  ('busan_attraction', 'keyword', '케이블카',   'activity', 65, '실측 — 송도해상케이블카'),
  ('busan_attraction', 'keyword', '어드벤처',   'activity', 65, '실측 — 롯데월드 어드벤처'),
  ('busan_attraction', 'keyword', '스포원',     'activity', 65, '실측 — 스포원파크'),
  ('busan_attraction', 'keyword', '렛츠런파크', 'activity', 65, '실측 — 렛츠런파크 부산경남'),
  ('busan_attraction', 'keyword', '도예',       'activity', 65, '실측 — 기장 도예 관광 힐링촌'),

  -- 자연 유형 (70)
  ('busan_attraction', 'keyword', '수목원',   'nature',   70, '실측 — 해운대·화명'),
  ('busan_attraction', 'keyword', '숲',       'nature',   70, '실측 — 우암동도시숲·아홉산 숲·치유의 숲·황토숲길'),
  ('busan_attraction', 'keyword', '휴양림',   'nature',   70, '실측 — 기장 달음산 자연휴양림'),
  ('busan_attraction', 'keyword', '수원지',   'nature',   70, '실측 — 회동·성지곡·구덕'),
  ('busan_attraction', 'keyword', '전망대',   'nature',   70, '실측 — 아미산·대청스카이·스카이웨이·해돋이·누리바라기'),
  ('busan_attraction', 'keyword', '유원지',   'nature',   70, '실측 — 태종대 유원지'),
  ('busan_attraction', 'keyword', '산책로',   'nature',   70, '실측 — 오시리아 해안 산책로'),
  ('busan_attraction', 'keyword', '둘레길',   'nature',   70, '실측 — 인공철새서식지 명품둘레길'),
  ('busan_attraction', 'keyword', '탐조',     'nature',   70, '실측 — 명지 철새 탐조대'),
  ('busan_attraction', 'keyword', '야생화',   'nature',   70, '실측 — 감전야생화단지'),
  ('busan_attraction', 'keyword', '포구',     'nature',   70, '실측 — 장림포구(부네치아)'),

  -- 고유명 — 산·섬·대 (95, 마지막)
  ('busan_attraction', 'keyword', '금정산',   'nature',   95, '실측'),
  ('busan_attraction', 'keyword', '백양산',   'nature',   95, '실측'),
  ('busan_attraction', 'keyword', '장산',     'nature',   95, '실측. ''반여 초록공원 장산 계곡''은 공원(90)이 먼저 잡음'),
  ('busan_attraction', 'keyword', '승학산',   'nature',   95, '실측 — 승학산 억새평원'),
  ('busan_attraction', 'keyword', '봉래산',   'nature',   95, '실측'),
  ('busan_attraction', 'keyword', '황령산',   'nature',   95, '실측 — 황령산 전망쉼터'),
  ('busan_attraction', 'keyword', '아미산',   'nature',   95, '실측 — 아미산전망대'),
  ('busan_attraction', 'keyword', '달음산',   'nature',   95, '실측'),
  ('busan_attraction', 'keyword', '아홉산',   'nature',   95, '실측'),
  ('busan_attraction', 'keyword', '태종대',   'nature',   95, '실측'),
  ('busan_attraction', 'keyword', '신선대',   'nature',   95, '실측'),
  ('busan_attraction', 'keyword', '오륙도',   'nature',   95, '실측'),
  ('busan_attraction', 'keyword', '을숙도',   'nature',   95, '실측'),
  ('busan_attraction', 'keyword', '동백섬',   'nature',   95, '실측'),
  ('busan_attraction', 'keyword', '가덕도',   'nature',   95, '실측 — 가덕도·가덕도 연대봉'),
  ('busan_attraction', 'keyword', '해운대',   'nature',   95, '실측. ''해운대 수목원''은 수목원(70)이 먼저 잡음'),
  ('busan_attraction', 'keyword', '청사포',   'nature',   95, '실측 — 청사포와 미포'),

  -- 고유명 — 사찰·근대건축 (95, 마지막)
  ('busan_attraction', 'keyword', '범어사',   'culture',  95, '실측. ''범어사 용성계곡''은 계곡(90), ''성보박물관''은 박물관(90)이 먼저 잡음'),
  ('busan_attraction', 'keyword', '해동용궁사', 'culture', 95, '실측'),
  ('busan_attraction', 'keyword', '삼광사',   'culture',  95, '실측'),
  ('busan_attraction', 'keyword', '장안사',   'culture',  95, '실측'),
  ('busan_attraction', 'keyword', '석불사',   'culture',  95, '실측'),
  ('busan_attraction', 'keyword', '선암사',   'culture',  95, '실측'),
  ('busan_attraction', 'keyword', '운수사',   'culture',  95, '실측'),
  ('busan_attraction', 'keyword', '홍법사',   'culture',  95, '실측'),
  ('busan_attraction', 'keyword', '내원정사', 'culture',  95, '실측. ''구덕야영장 계곡…''은 계곡(90)이 먼저 잡음'),
  ('busan_attraction', 'keyword', '복천사',   'culture',  95, '실측'),
  ('busan_attraction', 'keyword', '성암사',   'culture',  95, '실측'),
  ('busan_attraction', 'keyword', '마하사',   'culture',  95, '실측'),
  ('busan_attraction', 'keyword', '충렬사',   'culture',  95, '실측'),
  ('busan_attraction', 'keyword', '영도대교', 'culture',  95, '실측'),
  ('busan_attraction', 'keyword', 'F1963',    'culture',  95, '실측 — 고려제강 옛 공장'),
  ('busan_attraction', 'keyword', '이바구',   'culture',  95, '실측 — 초량 이바구길·이바구길 사진관·이바구 캠프'),

  -- 2차 흡수 — 1차 반영 후 남은 미분류를 다시 훑어 추가한 분
  ('busan_attraction', 'keyword', '미디어센터', 'culture',  60, '실측 — 부산시청자미디어센터'),
  ('busan_attraction', 'keyword', '구름다리',   'nature',   70, '실측 — 송도용궁구름다리'),
  ('busan_attraction', 'keyword', '다이브',     'activity', 65, '실측 — 포디움다이브엠'),
  ('busan_attraction', 'keyword', '다대포',     'nature',   95, '실측 — 바다누리길·동측해안. 해변공원·해수욕장은 90이 먼저 잡음'),
  ('busan_attraction', 'keyword', '구덕포',     'nature',   95, '실측 — 송정 구덕포길'),
  ('busan_attraction', 'keyword', '누리마루',   'culture',  95, '실측 — 누리마루 APEC하우스'),
  ('busan_attraction', 'keyword', '40계단',     'culture',  95, '실측'),
  ('busan_attraction', 'keyword', '백제병원',   'culture',  95, '실측 — 구 백제병원(근대건축)'),
  ('busan_attraction', 'keyword', '동래역',     'culture',  95, '실측 — 1934 기차 동래역'),
  ('busan_attraction', 'keyword', '이슬람',     'culture',  95, '실측 — 한국 이슬람 부산성원'),
  ('busan_attraction', 'keyword', '부산타워',   'culture',  95, '실측'),
  ('busan_attraction', 'keyword', '벡스코',     'culture',  95, '실측 — 전시·컨벤션'),
  ('busan_attraction', 'keyword', '상상마당',   'culture',  95, '실측 — KT&G상상마당 부산')
on conflict (source, match_kind, match_value) do nothing;
