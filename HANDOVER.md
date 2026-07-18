# HANDOVER — SKKU GLS 과목 위치 찾기 (브라우저 확장앱)

> 새 채팅에서 이 문서만 읽고 바로 이어서 작업할 수 있게 정리. 근거 = 실제 코드 + `docs/api-notes.md`.
> 기준 버전: 확장앱 v0.3.0 / 내장데이터 v4. 최종 갱신 2026-07-18.

## 1. 목적과 핵심 기능
성균관대 GLS 전자시간표(`kingoinfo.skku.edu`)에서 교양·전공 과목을 검색하면 **"GLS 어느 메뉴/영역에 담아야 하는지"**를 알려주는 Chrome/Whale 확장앱(MV3).
- **검색 → 영역 경로 표시**: 계열별로 `학사-교양/기타과목`+영역, `학사-전공과목`+주관학부-학과, `학사-DS과목`+기반/심화.
- **내 시간표**: [추가하기]로 담으면 에브리타임식 주간표에 누적(자동저장·시간충돌 방지·총학점·**과목별 고정색**). 시간 없는 온라인/아이캠퍼스는 표 아래 목록.
- **GLS 책가방 담기**: 결과 카드 [담기] → 실제 GLS 책가방에 담기/빼기(§4).
- **에브리타임 강의평 바로가기**: 결과 카드 [강의평] → 그 교수의 에타 `lecture/view`로 자동 연결(§4).

## 2. 기술 스택 / 폴더 구조
- **순수 JavaScript, 빌드 도구 없음.** "압축 해제된 확장 프로그램 로드"로 바로 사용.
- Node는 **테스트(`node tests/parser.test.js`)와 데이터 빌드(`node scripts/build-bundled.js`)에만** 사용.
```
manifest.json                 MV3 매니페스트 (v0.3.0)
data/bundled-courses.json     내장 데이터(=검색 인덱스, v4, 2026-20 2764과목). 전공엔 depts[], 교양엔 gyoAreas[]
gls-courses.json              전량 수집본(과목 원본, 빌드 입력)
skku-courses.json             학사-전공과목 college→major 그룹핑(주관학부-학과·areaGrp2/3 소스, 빌드 입력)
gls-courses-review.json       학사-교양/기타과목 13개 영역탭 그룹핑(교양 정답영역 소스, 빌드 입력)
scripts/build-bundled.js      bundled-courses.json 재생성(위 3개+inform 조인). version 자동 +1
fonts/PretendardVariable.woff2  내장 폰트
icons/                        아이콘 16/48/128
src/lib/
  ssv.js            SSV(\x1e/\x1f) 파서
  inform.js         INFORM → 영역/학번 파싱("영역구분" 있을 때만, 영역명 내 '/' 보존)
  course-extract.js SSV → Course 객체(빌드/테스트용, 런타임 미사용)
  normalize.js      검색 정규화(숫자↔로마자)
  search.js         로컬 검색/랭킹(전체 course 객체 그대로 반환)
  schedule.js       강의시간 파싱 + 레인(겹침) 배정
src/content/content.js        [ISOLATED] 전체 UI: 검색·영역표시·시간표·담기/강의평 버튼·패널 토글
src/content/everytime-link.js [ISOLATED · everytime.kr] 강의평 자동연결(교수+과목 매칭→이동+캐싱)
src/background/background.js   [service worker] 내장데이터 시드, search/stats, 아이콘클릭→토글
src/page-bridge/bag-bridge.js [MAIN world] 책가방 담기 브릿지(Nexacro transaction 후킹/재생)
tests/parser.test.js          파서 테스트 34케이스
docs/api-notes.md             GLS 리버스엔지니어링 근거(엔드포인트/암호화/SSV/책가방 §8)
check.md                      영역표시 개편 이해·결정 기록
```

## 3. GLS 구조(리버스 엔지니어링, 확정 — 근거 `docs/api-notes.md`)
- GLS = **Nexacro(GAIA) 앱.** `nexacro.getApplication()` 접근 가능.
- 통신: `POST /gaia/<화면ID>/<메서드>.do`. **요청 본문 암호화 필수**(`Crypto::<base64>::<hex>::<hex>`, 평문은 `ErrorCode=-1` 거부). **응답은 평문 SSV.**
- 과목목록: `NHSSU030540M/selectMain03.do` → `dsGrdMain03`. 필드: `GWAMOK_NAME`(과목명), `HAKSU_NO`/`BUNBAN`, `ISU_NAME`(이수구분), `PER_NAME`, `GYOSI_NAME`, `HAKJUM`, `CAMPUS_NM`, **`INFORM`**(교양만 "영역구분: …" 포함).
- 학기코드 `GAESUL_TERM`: **10=1학기, 15=여름, 20=2학기, 25=겨울**. 내장데이터=20.
- 책가방: `SKKUHS/executeHSSUInsertDeleteBag.do`. **`form.transaction`을 8인자로 호출**(§4·§8).

## 4. 지금까지 구현한 내용
- **검색/영역 표시**(content.js `areaHtml`, 계열 분기):
  - 교양/기타/교직 → `학사-교양/기타과목` + **`gyoAreas[]`**(정답영역, review 조인) 세로 나열. 이중영역(외국인전용＋일반영역)은 둘 다.
  - 전공(대학원 포함) → `학사-전공과목` + **`depts[]`**(주관학부-학과, skku 조인). **1개면 인라인, 2개↑면 "해당 전공 보기(N)" 드롭다운**(클릭 시 펼침, `.dept-list.open`). 각 줄에 세부(전공코어/전공심화/실험실습, areaGrp3=21학번이후 우선) inline.
  - DS → `학사-DS과목` + 기반/심화(+계열). "영역 정보 없음" 문구 제거.
- **내 시간표**(에브리타임식): 12시간제 9시~자정 고정틀·주말 동적컬럼·레인 겹침·hover× 삭제·총학점. **과목별 고정색**(추가 시 `course._color` 배정·저장, `pickColor()`가 안 쓰인 색 우선). 온라인/아이캠퍼스는 표 아래 목록.
- **책가방 담기**(bag-bridge.js, MAIN): `nexacro.Form.prototype.transaction` 후킹 → 실제 담기 호출 **8인자 전체를 `bagTpl.args`로 캡처** → 요청 시 arg(=[4])의 과목값만 치환해 `origTx.apply(form, 8인자)` 재생. 프레임워크 컨텍스트(`ctx`: HAKBUN·_SESSION_ID·폼)는 **아무 트랜잭션에서나** 수집(합성 경로 fallback). content↔bridge는 **CustomEvent**(`gls-bag-req`/`gls-bag-res`).
- **에타 강의평**(content.js `openReview` + everytime-link.js): 캐시(`gls_et_cache[code|교수]`) 적중 시 `lecture/view/{id}` 바로, 미적중 시 `lecture/search?keyword=<과목명>&condition=name#gls=1&prof=&code=&name=` 새 탭 → everytime-link.js가 결과에서 **과목명＋교수명 일치** 강의가 1개면 자동 이동＋id 캐싱.
- **UI**: GLS 색감(초록/라임/오렌지 학수번호)·Pretendard 내장(FontFace, 페이지 CSP 회피)·헤더 중앙정렬·패널 폭 1180/결과컬럼 460. 담기 버튼=연녹색+내려담기 아이콘(성공 시 GLS 자체 팝업에 위임, 토스트 없음). 강의평 버튼=연분홍+말풍선 아이콘(테두리 없음). 검색 placeholder="과목명 / 학수번호 / 교수명". 팝업 없음(툴바 아이콘/🔎/Ctrl+K로 패널 토글).
- **데이터 파이프라인**: `scripts/build-bundled.js`가 gls+skku+review+inform 조인. **version 자동 +1**(재시드 보장). 파서 34/34 통과.

## 5. 수정/해결한 주요 문제
- **책가방 -1(요청 처리 불가)**: native는 transaction을 **8인자**(svc/url/inDs/outDs/arg/콜백명/async/dataType)로 호출하는데 확장앱이 **5개만** 재생 → 콜백명/async/dataType 누락으로 서버 거부. **8인자 전체 재생**으로 해결(콘솔 `glsTestBag` 로 ErrorCode=0 실증).
- **책가방 활성화 오해 정정**: `bagTpl`(native 담기)와 `ctx`(GLS 둘러보기·책가방 진입 등 아무 트랜잭션) 둘 다 메모리이나, **정상 사용 중 자동 재획득**되어 세션마다 사실상 그냥 됨.
- **교양 영역 부정확(INFORM 파싱 47%만 일치)**: 글로벌(필수)→글로벌, 외국인전용 식별불가, 일반선택 누락 등 → **review 파일 codeSection 조인(`gyoAreas`, 1012/1012 정답)** 으로 교체. INFORM 파싱은 폴백.
- **전공 주관학부-학과**: 같은 학수번호가 여러 학과에 걸침 → skku 조인으로 **걸친 학과 모두 `depts[]`**, 학수번호 접두어 다수결로 주관학과를 맨 앞 정렬. 많으면 드롭다운.
- **시간표 색상 밀림**: 인덱스 기반 색배정 → 앞 과목 삭제 시 뒤 색 변경. **과목별 `_color` 고정 저장**으로 해결.
- **에타 동명교수 오류**: 교수명만 매칭해서 `일반물리학2 강대준`/`일반물리학실험2 강대준` 혼동 → **과목명＋교수명 둘 다 매칭**(0이면 교수명 단독 폴백), 행 텍스트를 한 강의로 제한, 결과 지연로딩 대응 스크롤 추가.
- **MAIN↔ISOLATED 통신**: `window.postMessage`가 Nexacro와 충돌(`id.split`) → **CustomEvent**로 전환.
- **데이터 미반영**: version 고정으로 재시드 안 되던 문제 → **빌드마다 version 자동 +1**.

## 6. 남은 오류 / 미완성 (⚠ 브라우저 실검증은 사용자만 가능)
- **에타 강의평 매칭 — 미검증**: 지연로딩 스크롤 + 과목명＋교수명 매칭 + 행텍스트 제한을 넣었으나 **브라우저 확인 안 됨.** 특히 **외국인 교수명**(예: 일반물리학2 `랍라하예`, `드리바데미시톨라`)이 에타에서 GLS와 다르게 표기되면 여전히 실패 가능. 에타 검색결과 **DOM 셀렉터는 로그인 필요로 실측 못 함** → `a[href*="/lecture/view/"]` + 행 텍스트 포함여부라는 구조 비의존 방식으로만 작성. 실패 시 콘솔 `[GLS-ET]` 로그(강의마다 `[과목][교수]` 태그)로 진단.
- **주관학과 접두어 폴백**: 접두어 학습 안 되는 코드(≈243개)는 skku 최초등장 학과로 폴백 → 일부 오배정 가능. 드롭다운엔 걸친 학과 전부 나오므로 실사용 영향은 작음.
- **책가방/에타/드롭다운/색상 등 이번 변경 전부 브라우저 최종 확인 필요**(어시스턴트 검증 불가).
- **책가방 세션 의존**: 세션마다 컨텍스트 재획득 필요(대개 자동). 완전 제거하려면 §8-2 개선.

## 7. 환경 / API / 배포
- 배포: 빌드 없음. `whale://extensions`(또는 chrome) → 개발자 모드 → **압축 해제된 확장 프로그램 로드** → 이 폴더. 코드 수정 후 **확장앱 새로고침(↻) + GLS/에타 F5**. **데이터 변경 시 `node scripts/build-bundled.js` 실행 → version 올라가 재시드됨.**
- 매니페스트(v0.3.0): `manifest_version:3`, `permissions:["storage","unlimitedStorage"]`, `host_permissions:["https://kingoinfo.skku.edu/*","https://everytime.kr/*"]`, `web_accessible_resources`(폰트), `action`(팝업 없음). content_scripts:
  - MAIN·document_start (kingoinfo): `src/page-bridge/bag-bridge.js`
  - ISOLATED·document_idle (kingoinfo): `src/lib/schedule.js`, `src/content/content.js`
  - ISOLATED·document_idle (everytime.kr/lecture/*): `src/content/everytime-link.js`
  - background service_worker: `src/background/background.js`
- **외부 서버·환경변수 없음.** 저장은 `chrome.storage.local`: `gls_index`, `gls_meta`, `gls_seed_version`, `gls_mytable`(과목에 `_color` 포함), `gls_panel_open`, `gls_et_cache`(에타 강의 id 캐시).
- **GitHub**: `https://github.com/bugoms/skku-gls` (브랜치 `main`).

## 8. 다음 채팅에서 가장 먼저 할 일
1. **이번 변경 브라우저 검증**(사용자와): ①시간표 색 고정(A 삭제해도 B 유지), ②전공 다중학과 드롭다운, ③교양 정답영역 재시드(예: 영어쓰기→글로벌, 의사소통1→소통과사고/의사소통＋외국인전용교과목), ④에타 매칭(외국인 교수·동명 교수).
2. **에타 매칭이 여전히 실패하면**: 에타 검색페이지 콘솔의 `[GLS-ET] 발견한 강의 링크 …` 로그(각 강의 `[과목][교수]` 태그)를 받아 → 셀렉터/이름 정규화(음차·공백·로마자 vs 숫자) 보정. 필요 시 교수명 매핑 추가.
3. (선택) **책가방 세션 의존 제거**: `skku.js`의 `commonTransaction` 직접 호출로 native 담기 없이 활성화(§9 주의: 그리드 선택행 의존 여부 확인).

## 9. 유지 조건 / 주의사항
- **빌드 도구 도입 금지** — 순수 JS·무빌드 유지(즉시 로드).
- **MAIN↔ISOLATED 통신은 CustomEvent만** — `window.postMessage`는 Nexacro와 충돌.
- **암호화 payload 직접 생성 금지** — 반드시 페이지의 Nexacro 트랜잭션 경유(`bag-bridge.js`).
- **영역 기준**: 교양은 review 정답영역(`gyoAreas`), 전공 세부는 **areaGrp3(21학번 이후) 우선**. INFORM 파싱은 폴백.
- **데이터 갱신은 항상 `node scripts/build-bundled.js`** — 직접 편집 금지(version 자동증가로 재시드 트리거).
- 코드 수정 후 **`node tests/parser.test.js`**(파서 회귀) + 편집한 JS **`node --check`**. 확장앱 새로고침＋F5 필수.
- **어시스턴트 샌드박스에서 사용자 GLS/에타 계정 쓰기 실행 금지**(읽기 재현만). 세션쿠키는 민감정보.
- **실제 브라우저 동작(책가방·에타 매칭)은 사용자 확인 필요** — 어시스턴트가 직접 검증 불가.
- 확장앱은 **읽기 + 책가방(사전담기)만**, 수강신청(`sugang.skku.edu`) 미접근. (책가방은 선착순 아님·클릭당 1건이라 매크로 리스크 낮음 — 대화 참고)

## 10. 중요 파일과 역할 (요약)
| 파일 | 역할 | 비고 |
|---|---|---|
| `src/content/content.js` | 전체 UI(ISOLATED) | 검색/영역표시(areaHtml)/시간표(고정색)/담기·강의평 버튼/드롭다운 |
| `src/content/everytime-link.js` | 에타 강의평 자동연결 | 과목명＋교수명 매칭→이동, id 캐싱. **미검증** |
| `src/page-bridge/bag-bridge.js` | 책가방 담기(MAIN) | transaction 8인자 캡처·재생, CustomEvent |
| `src/background/background.js` | 시드+검색+아이콘토글 | `seedBundled`는 version 커질 때만 재시드 |
| `scripts/build-bundled.js` | 내장데이터 빌드 | gls+skku+review+inform 조인, version 자동+1 |
| `src/lib/inform.js` / `schedule.js` / `search.js` / `normalize.js` / `ssv.js` | 파서·검색·정규화 | 파서 34케이스 |
| `data/bundled-courses.json` | 검색 데이터 | v4, depts[]/gyoAreas[] 포함 |
| `docs/api-notes.md` | API 근거 | §8 책가방 8인자 규격 |
