# HANDOVER — SKKU GLS 과목 위치 찾기 (브라우저 확장앱)

> 새 채팅에서 이 문서만 읽고 바로 이어서 작업할 수 있도록 정리. 근거는 실제 코드 + `docs/api-notes.md` + `plan.md`.
> 최종 갱신 기준일: 2026-07-18.

## 1. 목적과 핵심 기능
성균관대 GLS 전자시간표(kingoinfo.skku.edu)에서 **교양 과목을 검색하면 "어느 영역 탭(성균인성리더십/글로벌/인문사회과학·자연과학기반 등)에 담아야 하는지"**를 바로 알려주는 Chrome/Whale 확장앱.
- 검색 → 결과 카드에 **영역 경로**(2020학번이후 기준) 표시.
- **내 시간표**: [추가하기]로 담으면 에브리타임식 주간 시간표에 누적(자동 저장, 시간충돌 방지, 총 학점 표시). 시간 없는 온라인/아이캠퍼스 과목은 시간표 아래 목록.
- **GLS 책가방 담기**: 결과 카드 [담기] 버튼으로 실제 GLS 책가방에 담기 → **동작 확정(§5, 8인자 재생). 세션당 native 담기 1회로 템플릿 시드 필요.**
- **에브리타임 강의평 바로가기**: 결과 카드 [강의평] 버튼 → 에타 `lecture/search`(과목명)를 새 탭으로 열고, `everytime-link.js`가 **교수명 일치 강의가 정확히 1개면 그 `lecture/view/{id}`로 자동 이동**(여러 개/없음이면 후보 하이라이트+배너). 한 번 찾은 id는 `gls_et_cache`에 저장 → 다음엔 바로 직결. 로그인은 사용자 세션에 위임(로그아웃이면 에타 로그인→복귀). §10 참조.

## 2. 기술 스택 / 폴더 구조
- **순수 JavaScript, 빌드 도구 없음.** MV3 확장앱을 "압축 해제된 확장 프로그램 로드"로 바로 사용.
- Node는 테스트 실행에만 사용(`node tests/parser.test.js`).
```
manifest.json               MV3 매니페스트
data/bundled-courses.json   내장 데이터(= 검색 인덱스 원본, version 3, 2026-20 2764과목; 전공엔 college/major/areaGrp3 주입)
gls-courses.json            전체 수집본(내장 데이터의 소스, export 포맷)
skku-courses.json           학부/학과 그룹핑본(전공 주관학부-학과·areaGrp3 소스 → 빌드에 조인됨)
gls-courses-review.json     교양영역(13탭) 그룹핑본(교양/기타/교직 정답영역 소스 → 빌드에 조인됨)
scripts/build-bundled.js    data/bundled-courses.json 재생성(gls+skku+review+inform 조인, 오프라인 빌드)
fonts/PretendardVariable.woff2   내장 폰트
icons/                      아이콘 16/48/128
src/lib/
  ssv.js            SSV(\x1e/\x1f) 파서
  inform.js         INFORM → 영역/학번 파싱 ("영역구분" 있을 때만, 영역명 내 '/' 보존)
  course-extract.js SSV → Course 객체(런타임 미사용, 빌드/테스트용)
  normalize.js      검색 정규화(숫자↔로마자)
  search.js         로컬 검색/랭킹
  schedule.js       강의시간 파싱 + 레인(겹침) 배정
src/content/content.js       [ISOLATED] 검색+시간표 UI, 책가방/강의평 버튼, 팝업 토글
src/content/everytime-link.js [ISOLATED · everytime.kr] 강의평 검색결과에서 교수 매칭→자동이동+id 캐싱
src/background/background.js [service worker] 내장데이터 시드, search/stats, 아이콘클릭→토글
src/page-bridge/bag-bridge.js [MAIN world] 책가방 담기 브릿지(Nexacro transaction 후킹/재생)
tests/parser.test.js         파서 테스트 34케이스
docs/api-notes.md            GLS 리버스엔지니어링 근거(엔드포인트/암호화/SSV/책가방 §8)
plan.md                      설계 문서
README.md                    설치/사용법
```

## 3. GLS 구조(리버스 엔지니어링 결과, 확정)
- GLS = **Nexacro(GAIA) 앱**. `nexacro.getApplication()` 접근 가능(확인됨).
- 통신: `POST /gaia/<화면ID>/<메서드>.do`. **요청 본문은 암호화 필수**(`Crypto::<base64>::<hex16>::<hex16>`), 평문은 `ErrorCode=-1 요청을 처리할 수 없습니다`로 거부. **응답은 평문 SSV.**
- 과목 목록: `NHSSU030540M/selectMain03.do` → 데이터셋 `dsGrdMain03`. 필드: `GWAMOK_NAME`(과목명), `HAKSU_NO`/`BUNBAN`, `ISU_NAME`(교양 등), `CAMPUS_NM`, `GYOSI_NAME`(강의시간), `HAKJUM`, `PER_NAME`, **`INFORM`**(="영역구분: 글로벌[2020학번이후] / 전문영어[2019학번이전]").
- 학기코드 `GAESUL_TERM`: **10=1학기, 15=여름, 20=2학기, 25=겨울**. 내장 데이터는 20(2학기).
- **책가방 담기**(§5·docs §8): 클릭 시 3요청 — `SKKUHS/selectHakwiGb.do`(사전조회) → `SKKUHS/executeHSSUInsertDeleteBag.do`(실행) → `CommSystemMessagePopup.xfdl.js`(결과팝업). 호출체인: `grdMain03_OnCellClick`→`insertBag`→`executeSaveBag`→`actionSubmit`→`commonTransaction`(skku.js)→`form.transaction`.
  - 담기 arg(평문): `P_ROW_TYPE="I"(담기)/"D"(삭제) GAESUL_YEAR GAESUL_TERM HAKSU_NO BUNBAN HAKBUN HAKWIGWAJUNG_GB _MENU_ID _PGM_ID _SESSION_ID ...`. 입력 데이터셋 없이 arg만으로 실행.

## 4. 지금까지 구현/해결한 것
- GLS API 리버스 엔지니어링(암호화/SSV/영역/책가방 전부 파악). 근거 `docs/api-notes.md`.
- 파서: SSV, INFORM(영역명 '/' 보존 함정 해결), 강의시간(범위 `[월~금]`·레인 겹침), 정규화, 검색 — 실제 fixture로 34케이스 테스트 통과.
- **수집 기능 제거** → 내장 데이터(`data/bundled-courses.json` v2, 2764과목)만 사용. background `seedBundled()`가 설치/버전업 시 인덱스를 **완전 교체**로 시드.
- UI: GLS 색감(초록/라임/오렌지 학수번호/연회색 검색바 #EFEFEF), **Pretendard 내장**(FontFace API — 페이지 CSP 회피), 상단 헤더 흰배경 중앙정렬, 영역은 아이콘·배지 없이 큰 텍스트, **에브리타임식 시간표**(팔레트 색·교수명·12시간제 9시~자정 고정 틀·주말 동적 컬럼·블록 우상단 hover × 삭제), 온라인/아이캠퍼스는 시간표 아래 목록, **총 학점 표시**, 결과 카드 **우측 상단에 [추가하기][담기]**(담기 = GLS 책가방, 연녹색·내려담기 아이콘). 담기 성공 시 GLS 자체 팝업이 결과를 표시하므로 별도 토스트 없이 버튼에 잠깐 `✓ 담김`만.
- 팝업 제거(툴바 아이콘 클릭 → 패널 토글: background `chrome.action.onClicked`).
- 책가방 담기 1차 버그 해결: `window.postMessage`가 **Nexacro 내부 메시지 핸들러와 충돌**(`id.split is not a function`) → MAIN↔ISOLATED 통신을 **CustomEvent(`gls-bag-req`/`gls-bag-res`, JSON 문자열 detail)**로 전환.

## 5. 책가방 담기 — ✅ 해결됨 (2026-07-18)
**원인 확정**: native 담기는 `form.transaction`을 **8인자**로 호출하는데, 확장앱은 **앞 5개만** 재생해 **6~8번(콜백명 `"commonTransactionCallback"` / async=false / dataType=1)이 누락** → 서버가 `ErrorCode=-1 요청을 처리할 수 없습니다`(평문과 동일 에러)로 거부했던 것. 암호화 자체는 `transaction`(플랫폼) 내부에서 됨(진단 XHR 로그 `ENCRYPTED` 확인).
**해결**: `bag-bridge.js`가 실제 담기 호출을 **인자 배열 통째로(`bagTpl.args`, 8개) 캡처**하고, 재생 때 **arg(=[4])의 과목값만 치환** 후 `origTx.apply(bagTpl.form, newArgs)`로 **8인자 전부 재생**.
**실증**: 콘솔 `glsTestBag("GEDB021","41","D")` 8인자 재생 → `ErrorCode=0` + 실제 책가방에서 삭제 확인. 확장앱 코드도 동일 방식 반영. 인자 규격표는 `docs/api-notes.md §8`.

## 6. 남은 확인 / 운영 주의 (책가방)
1. **최종 회귀 검증(사용자)**: 확장앱 새로고침 + GLS F5 후, GLS에서 native [책가방 담기] 1회(템플릿 시드) → 확장앱 검색결과 [🎒 책가방]으로 임의 과목 담기/빼기 → GLS 팝업 `정상 처리` + 실제 책가방 반영 확인. (어시스턴트는 계정 쓰기 검증 불가 → 사용자 확인 필요)
2. **템플릿 재시드 필수**: F5마다 `bagTpl`(메모리)이 사라지므로, 세션당 GLS native [책가방 담기] 1회 → `[GLS-Bag] 실제 담기 호출 템플릿 캡처 완료(8인자)` 확인 후에 확장앱 담기가 활성화됨. (미시드 시 합성 경로 fallback — 성공 보장 낮음.)
   - 향후 개선 여지: native 담기 없이도 템플릿 없이 바로 담기 → `commonTransaction`(skku 네임스페이스) 재생 또는 컨텍스트만으로 8인자 합성 안정화. 현재는 불필요(템플릿 재생으로 충분).
3. **주의**: 임의 과목(인덱스엔 있으나 GLS 그리드에 없는)도 arg만으로 담김이 확인됨(그리드 행 선택 불필요) — 8인자 재생이 컨텍스트를 arg에 다 싣기 때문.

## 7. 환경 / API / 배포
- 배포: 빌드 없음. `whale://extensions`(또는 chrome) → 개발자 모드 → **압축 해제된 확장 프로그램 로드** → 이 폴더 선택. 코드 수정 후 **확장앱 새로고침(↻) + GLS F5**.
- 매니페스트(v0.3.0): `manifest_version:3`, `permissions:["storage","unlimitedStorage"]`, `host_permissions:["https://kingoinfo.skku.edu/*","https://everytime.kr/*"]`, `web_accessible_resources`(폰트), `action`(팝업 없음, 아이콘만), content_scripts 3개:
  - MAIN·document_start (kingoinfo): `src/page-bridge/bag-bridge.js`
  - ISOLATED·document_idle (kingoinfo): `src/lib/schedule.js`, `src/content/content.js`
  - ISOLATED·document_idle (everytime.kr/lecture/*): `src/content/everytime-link.js`
  - background service_worker: `src/background/background.js`
- 외부 서버 없음. 검색 인덱스·내 시간표는 `chrome.storage.local`(키: `gls_index`, `gls_meta`, `gls_seed_version`, `gls_mytable`, `gls_panel_open`, `gls_et_cache`=에타 강의id 캐시).
- **환경변수 없음.** 내장 데이터 갱신: `gls-courses.json`(+`skku-courses.json`) 편집 → **빌드 스크립트로 `data/bundled-courses.json` 재생성**(version 자동 3, 재시드 트리거). 버전 더 올리려면 스크립트의 `version` 수정.
  ```bash
  node scripts/build-bundled.js
  ```
  - 스크립트가 하는 일: INFORM→영역 재계산 + **전공계열 과목에 주관학부-학과/areaGrp3 주입**(`skku-courses.json` 조인, 학수번호 접두어로 주관학과 결정). 근거·한계는 `check.md`, 스크립트 주석 참조.

## 8. 중요 파일과 역할 (요약)
| 파일 | 역할 | 비고 |
|---|---|---|
| `src/page-bridge/bag-bridge.js` | 책가방 담기 실행(MAIN) | **8인자 재생으로 동작(§5).** transaction 후킹·재생, CustomEvent 통신 |
| `src/content/everytime-link.js` | 에타 강의평 자동연결(ISOLATED·everytime.kr) | 검색결과 교수매칭→자동이동, id 캐싱. §10 |
| `src/content/content.js` | 전체 UI(ISOLATED) | 검색/시간표/책가방·강의평 버튼/토글 |
| `src/background/background.js` | 시드+검색+아이콘토글 | `seedBundled` 인덱스 완전교체 |
| `src/lib/inform.js` | 영역 파싱 | "영역구분" 있을 때만, '/' 보존 |
| `src/lib/schedule.js` | 시간표 파싱 | `parseSchedule`, `assignLanes` |
| `data/bundled-courses.json` | 검색 데이터 | v2 2764과목 |
| `docs/api-notes.md` | API 근거 | §8에 책가방 상세 |

## 9. 유지 조건 / 주의사항
- **빌드 도구 도입 금지** — 순수 JS·무빌드 유지(즉시 로드).
- **MAIN↔ISOLATED 통신은 CustomEvent만** — `window.postMessage`는 Nexacro와 충돌(id.split).
- **암호화 payload를 직접 만들지 말 것** — 반드시 페이지의 Nexacro 트랜잭션 경유.
- **어시스턴트 샌드박스에서 사용자 GLS 계정에 쓰기 요청 실행 금지**(자동 차단됨/올바름). 읽기 재현만 허용. 캡처 curl의 세션쿠키는 민감정보.
- 영역 표시는 **2020학번이후 기준만**(`latestAreas`).
- 확장앱은 **읽기/책가방 외 계정 변경 없음**, 수강신청(sugang) 미접근.
- 코드 수정 후 `node tests/parser.test.js`로 파서 회귀 확인. 파일 수정 후 확장앱 새로고침+F5 필수.
- 실제 브라우저 동작(특히 책가방·강의평)은 **사용자 확인 필요** — 어시스턴트가 직접 검증 불가.

## 10. 에브리타임 강의평 바로가기 (v0.3.0 신규)
**목표**: 결과 카드 [강의평] → 그 **교수님의 에타 `lecture/view/{id}`로 바로**. 에타 내부 id는 GLS에 없어서 "검색결과에서 교수 매칭"이 필요.

**설계(경로 B — 백그라운드 스크래핑 대신 에타 페이지 위 DOM 매칭)**: CORS·구조변경에 강하고, 로그인은 사용자 세션에 위임.
1. `content.js openReview(course)` — 캐시(`gls_et_cache`, 인메모리 `etCache`) 적중 시 `everytime.kr/lecture/view/{id}` 새 탭 직결(동기 open → 팝업차단 회피). 미적중 시 `lecture/search?keyword=<과목명>&condition=name#gls=1&prof=&code=&name=` 새 탭.
2. `everytime-link.js` (everytime.kr/lecture/* ISOLATED) — `#gls` 마커 있는 **검색 결과 페이지에서만** 동작. `a[href*="/lecture/view/"]`를 훑어 **교수명 primary 토큰이 일치하는 강의**를 찾음:
   - **정확히 1개 → 자동 이동**(`location.replace`) + `gls_et_cache[code|정규화교수]=id` 저장(→ 확장앱 `onChanged`로 즉시 반영, 다음부터 직결).
   - **여러 개/0개 → 자동 이동 안 함**(하이라이트+배너). "가짜 정밀도"(엉뚱한 교수로 보내기) 방지.
3. 매칭 키: `code(HAKSU_NO) + '|' + 공백제거·소문자 교수명`. 분반(BUNBAN)은 에타가 통합하므로 키에서 제외.

**주의/한계**:
- 셀렉터는 `a[href*="/lecture/view/"]` + 행 텍스트에 교수명 포함 여부로만 판단(클래스명 비의존) → 에타 UI 개편에 비교적 강하나, 링크 형식이 바뀌면 파손.
- 로그아웃 시 에타가 로그인으로 302 → 로그인 후 복귀 시 **hash(`#gls`)는 서버로 안 실려 유실** → 자동선택 없이 목록만 표시(안전한 degrade). 대부분 사용자는 로그인 상태라 실무상 문제 적음.
- **약관 리스크 최소화**: 버튼 클릭 시 1건씩, 사용자 세션으로만. 백그라운드 대량 프리페치 금지.
- 실제 매칭 정확도·자동이동은 **사용자 확인 필요**(어시스턴트 검증 불가). 오매칭 사례 나오면 매칭 규칙(과목명 보조매칭 등) 보강.

## 11. 영역 표시 개편 (계열별, v0.3.0) — `content.js areaHtml()`
"영역 정보 없음" 제거. 계열별로 **메뉴 경로 + 영역/세부**를 표시:

| isuType | 위(amenu) | 본문 | 출처 |
|---|---|---|---|
| 교양/기타/교직 | 학사-교양/기타과목 | **정답 교양영역을 모두 세로 나열**(글로벌, 소통과사고/의사소통, 외국인전용교과목, 기타과목 등) | bundled `gyoAreas[]`(=review 조인) |
| 전공기반/전공심화/실험실습/전공/전공(대학원) | 학사-전공과목 | **걸친 주관학부-학과를 모두 세로 나열**, 각 줄에 세부(전공코어/전공심화/실험실습) inline | bundled `depts[]`(=skku 조인) |
| DS기반(계열n)/DS심화 | 학사-DS과목 | DS 기반 / DS 심화 (+ 계열n) | isuType 파싱 |

- **전공 depts[]**: 같은 학수번호가 여러 학과에 걸침(인정·연계) → `data/bundled-courses.json`의 각 전공과목에 `depts:[{college,major,sub}]` 저장(빌드 시 `skku-courses.json` 조인, `scripts/build-bundled.js`).
  - **세부(sub) = areaGrp3(21학번 이후) 우선, 없으면 areaGrp2** — "최신 영역구분만". 전공(대학원)은 areaGrp3 빈값 → areaGrp2="전공(대학원)".
  - **학과별로 세부가 다를 수 있음**(예: 생명공학의이해=바이오메카는 전공심화, 식품/융합은 전공코어) → 학과 줄마다 각자 표시.
  - **정렬**: 학수번호 접두어 다수결로 학습한 "주관학과"를 맨 앞으로(회계원리→경영학과 우선). 나머지는 skku 순서.
  - **표시 상한**: content.js `DEPT_DISPLAY_CAP=6` 줄까지, 초과는 "외 N개 학과". 저장 상한 `STORE_CAP=10`(초과 `deptMore`로 카운트). 예: 글로벌캡스톤디자인 32학과 → 6줄+"외 26개 학과".
  - CSS: `.adept`(학과 줄) + `.adsub`(세부 inline).
- **교양 gyoAreas[]** (2026-07-18): INFORM 파싱이 교양 영역을 절반가량 오판(글로벌(필수)→글로벌, 외국인전용 식별불가, 일반선택 누락 등, review 대조 결과 47%만 일치) → `gls-courses-review.json`(실제 13개 영역탭 그룹핑)을 **codeSection 조인**해 정답 영역을 `gyoAreas:[...]` 배열로 저장. **검증: 1012/1012 정답 일치**.
  - 같은 과목이 2개 영역(외국인전용＋일반영역 129건)이면 **둘 다 세로 나열**. 외국인전용교과목도 하나의 영역으로 취급(파일 순서상 뒤에 옴).
  - 교직 75과목은 review에서 "기타과목" 영역으로 조인됨(전용 분기 제거, gyoAreas로 일원화).
  - content.js: `gyoAreas` 있으면 우선 사용(`.aname` 줄 나열), 없을 때만 INFORM 파싱 폴백.
