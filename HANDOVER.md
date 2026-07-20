# HANDOVER — SKKU GLS 과목 위치 찾기 (브라우저 확장앱)

> 새 채팅에서 이 문서만 읽고 바로 이어서 작업할 수 있게 정리. 근거 = 실제 코드 + `docs/api-notes.md` + `everytime-upload_download.md`.
> manifest 버전 `0.3.0`(미갱신, 이후 기능 다수 추가됨) / 내장데이터 v4. 최종 갱신 **2026-07-20**.

## 0. 현재 커밋 / 작업트리 상태 (가장 먼저 읽을 것)
- **작업트리 깨끗**. `main` = `origin/main` 동기화됨. **미커밋/미추적 없음.**
- 최근 커밋(원격 push 완료):
  - **`4086d4b`**(HEAD) — 에타에서 **가져오기 제거 → 내보내기 전용 정리** + 에타 FAB 고착 수정 + 내보낼 GLS 시간표 선택 드롭다운.
  - `678f157` — 시간표 블록 클릭→과목 카드 팝오버 + 확장 컨텍스트 오류 방어 + FAB 성균관대 엠블럼 + 에타 버튼 리디자인.
  - `d5c0a05` — 다른 사이트에서 열기 + 시간표 여러 개 + 에타 내보내기 + 블록 병합.
  - `955093d` — 리디자인 + 강의평 gap 매칭 + 책가방 세션 의존 제거.
- **커밋 정책**: 사용자가 "커밋 푸시" 지시할 때만. 이 repo는 **`main`에 직접 커밋·푸시**하는 1인 워크플로우(브랜치/PR 안 씀).

## 1. 목적과 핵심 기능
성균관대 GLS 전자시간표(`kingoinfo.skku.edu`)에서 과목을 검색하면 **"GLS 어느 메뉴/영역에 담아야 하는지"**를 알려주는 Chrome/Whale 확장앱(MV3).
- **검색 → 영역 경로 표시**: 교양 `학사-교양/기타과목`+영역(`gyoAreas`), 전공 `학사-전공과목`+주관학부-학과(`depts`), DS `학사-DS과목`+기반/심화.
- **내 시간표(여러 개)**: [추가하기]로 **현재 활성 시간표**에 누적. 에타식 주간표·자동저장·시간충돌 방지·총학점·**과목별 고정색**. 시간표 **추가/전환/이름변경/삭제**. 온라인/아이캠퍼스는 표 아래 목록. **같은 과목·같은 날 ≤30분 끊긴 블록은 한 블록으로 이어 그림**.
- **시간표 블록 클릭 → 과목 카드 팝오버**(신규 678f157): 시간표의 과목 블록을 클릭하면 그 과목의 **검색 카드**(과목명·교수·학점·시간)를 그 자리에 띄움. **X / ESC / 바깥 클릭**으로 닫힘. 카드의 [추가하기] 자리에 **[삭제]**(시간표에서 제거). 영역(경로) 박스는 팝오버에선 숨김.
- **GLS 책가방 담기**: 결과카드 [담기] → 실제 GLS 책가방(§4). **세션 의존 제거** — 설치 후 GLS에 있기만 해도 담김.
- **에타 강의평 바로가기**: [강의평] → 교수+과목 매칭으로 그 강의 `lecture/view` 자동 이동.
- **다른 사이트에서 열기**: 툴바 아이콘으로 **아무 사이트에서** 패널(검색·영역·시간표) 오픈. 담기는 GLS에서만(비-GLS는 경고 토스트).
- **에타 시간표로 내보내기**(내보내기 **전용**): 내 시간표를 **에타 시간표에 실제 강의로 등록**(검색→매칭→검토 모달→저장, 매칭 실패 시 커스텀 직접추가 폴백). ⚠️ **반대 방향(에타→GLS "가져오기")은 구현했다가 제거함**(§4·§5).

## 2. 기술 스택 / 폴더 구조
- **순수 JavaScript, 빌드 도구 없음.** "압축 해제된 확장 프로그램 로드"로 바로 사용. Node는 테스트/데이터빌드에만.
```
manifest.json                 MV3 매니페스트 (v0.3.0). content_scripts: GLS·에타 lecture·에타 timetable, background, MAIN bag-bridge
data/bundled-courses.json     내장 검색 인덱스(v4, 2026-20 2764과목). depts[]/gyoAreas[] 포함
gls-courses.json / skku-courses.json / gls-courses-review.json   빌드 입력(원본/전공그룹/교양영역탭)
scripts/build-bundled.js      bundled-courses.json 재생성(gls+skku+review+inform 조인, version 자동+1)
fonts/PretendardVariable.woff2  내장 폰트
icons/  icon16/48/128.png(툴바=초록 돋보기) · skku-logo.png(헤더 로고) · skku-emblem.png(FAB 아이콘) · gls-fab.png(미사용·보존)
src/lib/
  ssv.js · inform.js · course-extract.js · normalize.js
  search.js         로컬 검색/랭킹
  schedule.js       강의시간 파싱 + 레인 배정. exports: parseSchedule, DAYS(['월'..'일']), toMinutes, expandRange, assignLanes
src/content/content.js          [ISOLATED] 전체 패널 UI(검색·영역·시간표(여러 개)·블록클릭 팝오버·담기·강의평·에타 내보내기·전체화면). GLS엔 선언주입, 그 외엔 아이콘 클릭 시 주입
src/content/everytime-link.js   [ISOLATED · everytime.kr/lecture/*] 강의평 자동연결(gap 매칭)
src/content/everytime-timetable.js [ISOLATED · everytime.kr/timetable/*] 에타 시간표 내보내기 전용(GLS→에타 검색→매칭→저장)
src/background/background.js     [service worker] 내장데이터 시드, search/stats, 아이콘클릭→토글 or activeTab 주입
src/page-bridge/bag-bridge.js    [MAIN · kingoinfo] 책가방 담기 브릿지(transaction 8인자 캡처/재생 + 템플릿 영구저장)
tests/parser.test.js            파서 테스트 34케이스
docs/api-notes.md               리버스엔지니어링 근거(§8 책가방, §9 에타 시간표 API)
docs/everytime-timetable-handover.md  에타 연동 초기 계획 메모(참고)
everytime-upload_download.md    에타 연동 코워크 계획 + ★에타 API 실측(§7). ⚠ §9는 "가져오기 수정완료"라 적혀 있으나 실제론 제거됨(문서-코드 불일치)
check.md                        시간표 블록 팝오버 기능 이해 메모(구현 완료)
```

## 3. 지금까지 구현한 내용 (이번 세션 신규는 ★)
- **검색/영역 표시**(content.js `areaHtml`): 교양→gyoAreas 세로나열, 전공→depts(1개 인라인·2개↑ 드롭다운, 세부는 areaGrp3 우선), DS→기반/심화.
- **내 시간표**: 12시간제(9시~자정) 고정틀·주말 동적컬럼·레인 겹침·hover× 삭제·총학점·과목별 `_color` 고정. 온라인 목록. 여러 개(`gls_tables`)·블록 병합(`mergeAdjacent`, `MERGE_GAP_MIN=30`).
- ★ **시간표 블록 클릭 → 과목 카드 팝오버**(content.js): `courseCardHtml(c, {mode})` 공용화(search=추가하기 / block=삭제). 블록에 `data-key`=keyOf(course), 클릭 시 `myTable`에서 원본 course 복원 → `openCardPop`이 블록 rect 근처(화면밖 보정)에 카드 표시. 닫기 = X(`.popx`) / ESC(패널은 유지) / 바깥 mousedown(`composedPath`). 팝오버 카드는 폭 430px·제목 한 줄·회색 메타 항목별 nowrap·시간표 별도 줄·**영역 박스 숨김**.
- ★ **확장 컨텍스트 오류 방어**(content.js): 확장앱 리로드 후 죽은 컨텍스트로 `chrome.*` 호출 시 나던 "Extension context invalidated"/"undefined sendMessage" → `ctxOk()`·`sendMsg`·`stGet`·`stSet` 래퍼로 무방비 호출 대체(무효면 조용히 무시).
- **책가방 담기**(bag-bridge.js): `transaction` 8인자 캡처/재생 + 템플릿 영구저장(`gls_bag_tpl`).
- **에타 강의평**(everytime-link.js): gap 매칭(과목명 끝↔교수명 시작 간격 최소). 캐시 `gls_et_cache`.
- **다른 사이트에서 열기**: background `action.onClicked` → 메시지 실패 시 `chrome.scripting.executeScript`(activeTab)로 schedule+content 주입. content는 `IS_GLS`로 비-GLS 담기 경고 + 항상 열림.
- ★ **에타 시간표로 내보내기(내보내기 전용)**(everytime-timetable.js + content.js `exportToEverytime`): content가 `gls_et_pending` 남기고 에타 시간표 탭 오픈 → 에타 스크립트가 검색·매칭·검토모달·저장. **에타 FAB "GLS에서 가져오기" 수동 클릭 시 "내보낼 GLS 시간표" 드롭다운**(활성 기본, 바꾸면 재매칭). 패널 자동 실행(pending)은 활성 시간표 그대로. `semLabel`로 학기 표시(여름/겨울 포함), 재선택 경쟁 방지 `exportGen`.
- ★ **UI**: 팝업(창/전체화면) 라운드 4px→**12px**. **FAB 아이콘 = 성균관대 엠블럼**(`skku-emblem.png`, skku-logo에서 크롭한 정사각 투명 PNG. 로드 실패 시 돋보기 SVG 폴백). 에타 "GLS에서 가져오기" 버튼 = `#F91F15` pill·다운로드 아이콘·Apple SD Gothic Neo(모달은 Pretendard). (955093d 리디자인: 흰 배경·Lovable 폼·성균관대 로고 헤더·전체화면 토글 유지)
- **데이터 파이프라인**: `build-bundled.js`가 gls+skku+review+inform 조인, version 자동+1. 파서 34/34.

## 4. 수정/해결한 주요 문제
- ★ **확장 컨텍스트 무효화 오류**: 리로드 후 남은 이전 content script가 죽은 `chrome.runtime`을 호출 → 방어 래퍼로 해결(§3).
- ★ **에타 FAB 고착("GLS에서 가져오기" 안 눌림)**: `closeModal()`이 `end()`를 안 불러 취소/X 후 `busy=true`·FAB `disabled` 고착 → `closeModal`에서 `end()` 호출로 해결(코워크).
- ★ **에타 "가져오기"(에타→GLS) 시도 후 제거**: 에타→GLS 가져오기를 학기 드롭다운까지 붙였으나, `/find/timetable/table` 상세 응답이 **과목 상세를 자식요소로**(`<name value>`·`<time value>` 등) 주고 목록 API엔 삭제 스텁이 섞이는 등 이슈로, **코워크가 내보내기 전용으로 정리**(가져오기 함수·버튼 전부 삭제, 4086d4b). ★재구현하려면 **`everytime-upload_download.md §7` 실측 스키마**대로 하면 됨(§5·§6).
- **강의평 매칭 오류(과목명 부분포함)**: gap 방식으로 교체(논리회로설계 vs …실험 구분).
- **책가방 세션마다 재활성화**: `gls_bag_tpl` 영구저장 + 저장템플릿 재구성.
- **성균관대 로고 안 뜸**: onload 핸들러 `display=''`→`'block'`.
- **에타 저장이 전체 교체 방식**: 기존 과목 id를 (B)로 읽어 신규와 함께 보내야 유지.
- **(주의) 지도앱은 별도 프로젝트**: `../부트캠프-일조량길추천서비스_20260708`(Next.js). **이 repo와 무관 — 건드리지 말 것.**

## 5. 남은 오류 / 미완성 (⚠ 브라우저 실검증은 사용자만 가능)
- **에타 내보내기 end-to-end 최종 검증**: 코워크가 실측(검색·저장 정상) 기록. 다만 **기본 선택이 활성 시간표라 활성이 빈 시간표면 "과목 없어요"** 로 뜸 → 수동 FAB 드롭다운으로 다른 시간표 선택은 가능. "과목 있는 시간표 우선 선택" 보정은 **미적용**(원하면 `pickInitialId` 수정).
- **에타 "가져오기" 제거됨**: 재추가 원하면 §6의 실측 스키마로. (현재는 코드에 없음)
- **문서 불일치**: `everytime-upload_download.md §9`는 "가져오기 A/B/D 수정 완료"라 적혀 있으나 코드엔 가져오기 없음 → 정리 시 한 줄 정정 필요.
- **강의평 매칭 미검증**: gap 로직 시뮬만 통과. 실패 시 콘솔 `[GLS-ET]` 로그(gap 포함).
- **책가방**: 정상 동작 보고됨. 세션 컨텍스트 미포착 시 GLS 동작 1회 필요할 수 있음.

## 6. 환경 / API / 배포
- 배포: 빌드 없음. `whale://extensions`(또는 chrome) → 개발자 모드 → 압축 해제된 확장 프로그램 로드 → 이 폴더. **manifest·아이콘/폰트 파일 바뀌면 확장앱 전체 리로드(↻), 아니면 코드 새로고침 + 대상 페이지 F5.** 데이터 변경 시 `node scripts/build-bundled.js`.
- 매니페스트: `permissions:["storage","unlimitedStorage","scripting","activeTab"]`, `host_permissions:["https://kingoinfo.skku.edu/*","https://everytime.kr/*","https://api.everytime.kr/*"]`, `web_accessible_resources`(폰트·`skku-logo.png`·`skku-emblem.png`, matches `<all_urls>`), `action`(팝업 없음). content_scripts:
  - MAIN·document_start (kingoinfo): `src/page-bridge/bag-bridge.js`
  - ISOLATED·document_idle (kingoinfo): `src/lib/schedule.js`, `src/content/content.js`
  - ISOLATED·document_idle (everytime.kr/lecture/*): `src/content/everytime-link.js`
  - ISOLATED·document_idle (everytime.kr/timetable/*): `src/lib/schedule.js`, `src/content/everytime-timetable.js`
  - 그 외 사이트: 툴바 아이콘 클릭 시 background가 activeTab으로 schedule+content 주입.
- **외부 서버·환경변수 없음.** 에타 API = `https://api.everytime.kr`(세션 쿠키 인증, CSRF 없음). GLS는 암호화 트랜잭션(직접 생성 금지, 페이지 경유).
- **★에타 API 실측(코워크, `everytime-upload_download.md §7`)** — 가져오기 재구현/디버그 시 필수:
  - **시간표 읽기 키 = URL의 숫자 `id`**(예 `60120324`, `<table>`의 `id` 속성). `identifier` 속성(20자)은 **공유코드로 별개** — 읽기에 쓰면 안 됨.
  - **`/find/timetable/table/list`**(body 빈 문자열): `<table>` 다수. 유효(`is_deleted="0"`, `id/name/year/semester/…`) + **삭제 스텁(`is_deleted="1"`, year/semester 없음)** 혼재 → 스텁 걸러야 "?년 null학기" 안 뜸.
  - **`/find/timetable/table`**(body `id=<숫자>`): `<subject>` 상세가 **자식요소**로 옴 — `<name value>`·`<professor value>`·`<time value>`·`<credit value>`(**`<code>` 없음**). `<time value>`는 사람용 문자열(`월09:00-10:15【미지정】<br>…`) → **`<br>`→`,` 치환하면 `SCHED.parseSchedule`이 그대로 파싱**.
  - **`semester` 값 = 문자열** `"1"/"2"/"여름"/"겨울"`(숫자 아님) → `semLabel`이 여름/겨울 처리(반영됨).
  - **`/find/timetable/subject/list`**(검색, 정상): `<subject id code name professor credit target lectureId time>` + 자식 `<timeplace day start end place>`(start/end=5분단위). `code`=학수번호-분반(GLS `codeSection` 동일). **내보내기 매칭용.**
- **저장(chrome.storage.local)**: `gls_index`·`gls_meta`·`gls_seed_version`(인덱스), `gls_tables`(여러 시간표=현행 `{tables,activeId}`), `gls_mytable`(레거시·이관원본), `gls_panel_open`, `gls_et_cache`(강의평 id), `gls_bag_tpl`(책가방 템플릿), `gls_et_last`(마지막 에타 시간표 URL), `gls_et_pending`(에타 **내보내기** 대기 플래그).
- **GitHub**: `https://github.com/bugoms/skku-gls` (브랜치 `main`).

## 7. 중요 파일과 역할
| 파일 | 역할 | 비고 |
|---|---|---|
| `src/content/content.js` | 전체 패널 UI(ISOLATED) | 검색/영역/시간표(여러 개·병합·**블록클릭 팝오버**)/담기·강의평·에타내보내기 버튼/전체화면. **컨텍스트 안전 래퍼**(ctxOk/sendMsg/stGet/stSet). GLS 선언주입 + 타 사이트 activeTab 주입 |
| `src/content/everytime-timetable.js` | 에타 시간표 **내보내기 전용** | GLS→에타 검색→매칭→검토모달→저장(전체교체)+커스텀 폴백. FAB 수동클릭 시 GLS 시간표 선택 드롭다운. `closeModal`→`end()`. **가져오기 없음** |
| `src/content/everytime-link.js` | 에타 강의평 자동연결 | gap 매칭 |
| `src/page-bridge/bag-bridge.js` | 책가방 담기(MAIN) | 8인자 캡처/재생 + `gls_bag_tpl` 영구저장 |
| `src/background/background.js` | 시드+검색+아이콘 | 아이콘클릭: 메시지 토글 or activeTab 주입 |
| `src/lib/schedule.js` | 시간 파싱/레인 | `parseSchedule`·`DAYS`·`assignLanes`. content·everytime-timetable 공용 |
| `data/bundled-courses.json` | 검색 데이터 | v4, depts[]/gyoAreas[] |
| `docs/api-notes.md` / `everytime-upload_download.md` | API 근거 | §8 책가방, §9 에타 / 에타 실측 §7 |

## 8. 다음 채팅에서 할 만한 일
1. **에타 내보내기 실검증**(사용자): 내보내기 → 에타 탭 → 검토모달 → 실제 등록(기존 과목 유지). FAB 수동클릭 시 GLS 시간표 드롭다운 전환.
2. (선택) 내보내기 기본 선택을 **과목 있는 시간표 우선**으로(`pickInitialId` 보정) — 빈 활성 시간표일 때 "과목 없어요" 방지.
3. (선택) **에타 "가져오기" 재구현** — `everytime-upload_download.md §7` 실측대로(읽기키=숫자 id, subject 자식요소, `<time>` `<br>→,`, list 스텁 필터).
4. (정리) `everytime-upload_download.md §9` 불일치 한 줄 정정.
5. 에타 매칭/등록 실패 시 콘솔 `[GLS-ETT]`(내보내기)/`[GLS-ET]`(강의평) 로그로 규격·이름정규화 보정.

## 9. 유지 조건 / 주의사항
- **빌드 도구 도입 금지** — 순수 JS·무빌드.
- **MAIN↔ISOLATED 통신은 CustomEvent만** — `window.postMessage`는 Nexacro와 충돌.
- **GLS 암호화 payload 직접 생성 금지** — 반드시 페이지 Nexacro 트랜잭션 경유(`bag-bridge.js`). 에타는 일반 웹이라 세션 쿠키 `fetch`면 됨(암호화 없음).
- **쓰기 동작(책가방·에타 등록)은 실행 전 확인 UI 필수**. **어시스턴트 샌드박스에서 사용자 GLS/에타 계정 쓰기 실행 금지**(코드·읽기 재현만, 실검증은 사용자/브라우저 가능한 코워크).
- **영역 기준**: 교양=review 정답영역(`gyoAreas`), 전공 세부=areaGrp3(21학번 이후) 우선. INFORM 파싱은 폴백.
- **데이터 갱신은 항상 `node scripts/build-bundled.js`**(version 자동증가로 재시드). 직접 편집 금지.
- 코드 수정 후 **`node --check <편집파일>`** + (파서 건드리면) **`node tests/parser.test.js`**. 확장앱 새로고침+F5.
- **에타 ToS/봇 정책 유의** — 본인 계정·저빈도·클릭당. 호출 간 딜레이 유지(everytime-timetable.js 140ms). 대량 자동화 지양.
- **커밋은 사용자 지시 때만, `main`에 직접**. 지도앱(`../부트캠프-...`)은 이 프로젝트 아님 — 건드리지 말 것.
