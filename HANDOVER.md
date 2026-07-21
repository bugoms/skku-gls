# HANDOVER — SKKU GLS 과목 위치 찾기 (브라우저 확장앱)

> 새 채팅에서 이 문서만 읽고 바로 이어서 작업할 수 있게 정리. 근거 = 실제 코드 + `docs/api-notes.md` + `everytime-upload_download.md`.
> manifest 버전 `0.3.0`(미갱신, 이후 기능 다수 추가됨) / 내장데이터 v4. 최종 갱신 **2026-07-21**.

## 0. 현재 커밋 / 작업트리 상태 (가장 먼저 읽을 것)
- **이번 세션 변경을 `main`에 직접 커밋·푸시함.** 직전 HEAD = `5add3b9`.
- 이번 세션 커밋에 포함된 변경(내 작업 + 코워크):
  - **content.js(내 작업)** — ① 네이티브 `prompt/confirm/alert` → **커스텀 다이얼로그**(`uiPrompt/uiConfirm/uiAlert`, GLS 패널 디자인) 교체. ② 헤더 `✎`/`🗑` 이모지 → **SVG 아이콘**(연필/휴지통). ③ **우측 하단 FAB 완전 제거** — 이제 **툴바 확장 아이콘 클릭 또는 Ctrl+K**로만 패널 토글.
  - **icons(내 작업)** — **확장앱 아이콘 icon16/48/128 교체**: 사용자 제공 `gls-fab-icon.png`(GLS 일러스트)에서 **배경 flood-fill 투명화 + 크롭 + 리사이즈**로 생성. 투명 마스터 `icons/gls-fab-icon.png` 추가.
  - **everytime-timetable.js(코워크)** — 에타 내보내기에 **"넣을 에타 시간표" 선택** 추가(같은 학기 목록, 기본시간표=primary default) + **"내보낼 GLS 시간표" 선택**(FAB 수동클릭 시). `etListTables`/`etTargetsFor` 재도입(**대상 선택용**, 가져오기 아님). 대상 기존 과목 유지 저장. ⚠ `pickInitialId`는 **원래(활성 기반)로 회귀** — 이전 세션의 "과목 있는 시간표 우선" 보정은 이 rewrite로 사라짐(§5).
  - **everytime-upload_download.md(내 작업)** — §9 정정 노트(작성 시점 기록 vs 현행 코드 불일치 표기).
- **미커밋/제외**: `skku-gls-extension-v0.3.0.zip`(스토어 제출용 빌드 산출물). `manifest.json`은 세션 중 WAR에 gls-fab.png 추가→제거로 **HEAD 대비 순변화 없음**.
- **커밋 정책**: 사용자가 "커밋 푸시" 지시할 때만. 이 repo는 **`main`에 직접 커밋·푸시**하는 1인 워크플로우(브랜치/PR 안 씀). **여러 명(사용자·코워크·이 어시스턴트)이 같은 작업트리를 동시 편집** — 커밋 전 `git diff`로 남의 변경을 먼저 확인할 것.

## 1. 목적과 핵심 기능
성균관대 GLS 전자시간표(`kingoinfo.skku.edu`)에서 과목을 검색하면 **"GLS 어느 메뉴/영역에 담아야 하는지"**를 알려주는 Chrome/Whale/Edge 확장앱(MV3).
- **검색 → 영역 경로 표시**: 교양 `학사-교양/기타과목`+영역(`gyoAreas`), 전공 `학사-전공과목`+주관학부-학과(`depts`), DS `학사-DS과목`+기반/심화.
- **패널 열기(★FAB 제거)**: **툴바 확장 아이콘 클릭 또는 Ctrl+K**로 패널 토글. GLS엔 선언 주입, 그 외 사이트는 아이콘 클릭 시 activeTab 주입. (이전의 우측 하단 플로팅 버튼은 제거됨.)
- **내 시간표(여러 개)**: [추가하기]로 **현재 활성 시간표**에 누적. 에타식 주간표·자동저장·시간충돌 방지·총학점·**과목별 고정색**. 시간표 **추가/전환/이름변경/삭제**. 온라인/아이캠퍼스는 표 아래 목록. **같은 과목·같은 날 ≤30분 끊긴 블록은 한 블록으로 이어 그림**.
- **시간표 블록 클릭 → 과목 카드 팝오버**: 시간표 블록 클릭 시 그 과목의 **검색 카드**(과목명·교수·학점·시간)를 그 자리에 띄움. **X / ESC / 바깥 클릭**으로 닫힘. 카드 [추가하기] 자리에 **[삭제]**. 영역 박스는 팝오버에선 숨김.
- **★커스텀 다이얼로그**: 시간표 이름 추가·변경, 시간표 삭제, 전체 비우기, 책가방 담기, 시간겹침 경고를 **네이티브 팝업이 아니라 패널 디자인의 모달**로 표시(상황별 아이콘, Enter=확인·ESC=취소).
- **GLS 책가방 담기**: 결과카드 [담기] → 실제 GLS 책가방(§4). **세션 의존 제거** — 설치 후 GLS에 있기만 해도 담김.
- **에타 강의평 바로가기**: [강의평] → 교수+과목 매칭으로 그 강의 `lecture/view` 자동 이동.
- **다른 사이트에서 열기**: 툴바 아이콘으로 **아무 사이트에서** 패널(검색·영역·시간표) 오픈. 담기는 GLS에서만(비-GLS는 경고 토스트).
- **에타 시간표로 내보내기(내보내기 전용 · ★대상 선택 추가)**: 내 GLS 시간표를 **에타 시간표에 실제 강의로 등록**. 검토 모달에서 **[내보낼 GLS 시간표](FAB 수동클릭 시만) + [넣을 에타 시간표](항상, 같은 학기 목록·기본시간표 default·"지금 화면" 표시)** 선택 → 검색·매칭 → 대상 기존 과목 읽기 → **전체 저장(기존 과목 유지)** + 매칭 실패·시간 있는 과목은 커스텀 직접추가 폴백. ⚠ **반대 방향(에타→GLS "가져오기")은 여전히 없음**(구현했다가 제거, §4). `etListTables`는 이제 **대상 시간표 나열용**으로만 존재.

## 2. 기술 스택 / 폴더 구조
- **순수 JavaScript, 빌드 도구 없음.** "압축 해제된 확장 프로그램 로드"로 바로 사용. Node는 테스트/데이터빌드에만. (아이콘 배경 투명화는 Python+Pillow 일회성 스크립트 사용 — 저장 안 함.)
```
manifest.json                 MV3 매니페스트 (v0.3.0). content_scripts: GLS·에타 lecture·에타 timetable, background, MAIN bag-bridge. WAR=폰트·skku-logo·skku-emblem
data/bundled-courses.json     내장 검색 인덱스(v4, 2026-20 2764과목). depts[]/gyoAreas[] 포함
gls-courses.json / skku-courses.json / gls-courses-review.json   빌드 입력(원본/전공그룹/교양영역탭) — 스토어 zip 제외
scripts/build-bundled.js      bundled-courses.json 재생성(gls+skku+review+inform 조인, version 자동+1)
fonts/PretendardVariable.woff2  내장 폰트
icons/  icon16/48/128.png(★확장앱 아이콘=GLS 일러스트) · skku-logo.png(헤더 로고) · skku-emblem.png(WAR 등록·현재 코드 미사용) · gls-fab-icon.png(★아이콘 소스 마스터·투명) · gls-fab.png(구 FAB용·현재 미사용)
src/lib/
  ssv.js · inform.js · course-extract.js   ← 빌드 전용(Node require). 확장 런타임 미로드·스토어 zip 제외
  normalize.js · search.js                 ← background 가 importScripts
  schedule.js       강의시간 파싱 + 레인 배정. exports: parseSchedule, DAYS(['월'..'일']), toMinutes, expandRange, assignLanes
src/content/content.js          [ISOLATED] 전체 패널 UI(검색·영역·시간표·블록클릭 팝오버·★커스텀 다이얼로그·담기·강의평·에타 내보내기·전체화면). GLS엔 선언주입, 그 외엔 아이콘 클릭 시 주입. ★FAB 없음
src/content/everytime-link.js   [ISOLATED · everytime.kr/lecture/*] 강의평 자동연결(gap 매칭)
src/content/everytime-timetable.js [ISOLATED · everytime.kr/timetable/*] 에타 시간표 내보내기(GLS→에타 검색→매칭→★대상 선택→저장)
src/background/background.js     [service worker] 내장데이터 시드, search/stats, 아이콘클릭→토글 or activeTab 주입. importScripts('../lib/normalize.js','../lib/search.js')
src/page-bridge/bag-bridge.js    [MAIN · kingoinfo] 책가방 담기 브릿지(transaction 8인자 캡처/재생 + 템플릿 영구저장)
tests/parser.test.js            파서 테스트 34케이스
docs/api-notes.md               리버스엔지니어링 근거(§8 책가방, §9 에타 시간표 API)
everytime-upload_download.md    에타 연동 코워크 계획 + ★에타 API 실측(§7) + §9 정정노트
check.md                        시간표 블록 팝오버 기능 이해 메모(구현 완료)
skku-gls-extension-v0.3.0.zip   ★스토어 제출용 빌드 산출물(git 미포함)
```

## 3. 지금까지 구현한 내용 (이번 세션 신규는 ★)
- **검색/영역 표시**(content.js `areaHtml`): 교양→gyoAreas 세로나열, 전공→depts(1개 인라인·2개↑ 드롭다운, 세부는 areaGrp3 우선), DS→기반/심화.
- **내 시간표**: 12시간제(9시~자정) 고정틀·주말 동적컬럼·레인 겹침·hover× 삭제·총학점·과목별 `_color` 고정. 온라인 목록. 여러 개(`gls_tables`)·블록 병합(`mergeAdjacent`, `MERGE_GAP_MIN=30`).
- **시간표 블록 클릭 → 과목 카드 팝오버**(content.js): `courseCardHtml(c,{mode})` 공용화(search=추가하기 / block=삭제). 블록 `data-key`=keyOf(course) → `openCardPop`이 블록 rect 근처(화면밖 보정)에 표시. 닫기 = X/ESC/바깥 mousedown(`composedPath`).
- ★ **커스텀 다이얼로그**(content.js `openDialog`/`uiPrompt`/`uiConfirm`/`uiAlert`): Shadow DOM 안 `.dlg-ov` 모달. 라운드 카드·초록 포인트·상황별 아이콘(연필=prompt / 휴지통=삭제 danger / 물음표=confirm / 경고삼각형=alert). Enter=확인·ESC/바깥클릭=취소(문서 keydown에서 다이얼로그 최우선 처리). 적용처: 새 시간표·이름 변경(prompt), 시간표 삭제·전체 비우기(confirm danger), 책가방 담기(confirm), 시간겹침(alert). **에타로 내보내기 확인창은 네이티브 유지**(window.open 팝업 타이밍 때문, §5).
- ★ **헤더 아이콘 SVG화**: 시간표 이름변경 `✎`·삭제 `🗑` 이모지(윈도우에서 흐릿) → feather 스타일 SVG(연필/휴지통, `stroke=currentColor`로 hover 색 상속).
- ★ **FAB 제거**: 우측 하단 플로팅 버튼(구 성균관대 엠블럼→gls-fab 이미지→검은 텍스트버튼 순으로 실험) → **사용자 요청으로 완전 제거**. 패널은 툴바 아이콘/Ctrl+K로만 토글. 관련 HTML/CSS/JS·이미지 로딩 코드 전부 삭제.
- ★ **확장앱 아이콘 교체**: 사용자 제공 `gls-fab-icon.png`(1254², 실제론 투명 아님 — 옅은 회색 체커보드가 픽셀로 baked-in). 가장자리 **flood-fill로 배경만 투명화**(카드/돋보기 내부 안 뚫림 확인) → 일러스트 bbox 크롭 → 정사각 캔버스 중앙배치 → LANCZOS로 16/48/128 생성. 라이트/다크 툴바 양쪽 확인. 소스 마스터도 투명본으로 덮어씀.
- **책가방 담기**(bag-bridge.js): `transaction` 8인자 캡처/재생 + 템플릿 영구저장(`gls_bag_tpl`).
- **에타 강의평**(everytime-link.js): gap 매칭. 캐시 `gls_et_cache`.
- **다른 사이트에서 열기**: background `action.onClicked` → 메시지 실패 시 `chrome.scripting.executeScript`(activeTab)로 schedule+content 주입.
- ★ **에타 내보내기 대상 선택(코워크, everytime-timetable.js)**: `etListTables`(삭제 스텁·연도/학기 없는 항목 제외, 숫자 id 키) → `etTargetsFor(url)`(같은 학기 시간표, primary·현재화면·이름순) → `start(preferTableId, showSrc)` → `renderShell`(2개 드롭다운) → `matchAndRender`(선택 GLS 소스 매칭, 140ms 스로틀) → `renderWithTarget`(대상 기존 과목 `etReadTable`) → `drawReview`(추가할/이미있음/매칭실패 분리) → `doRegister`(커스텀 추가 후 기존+신규 전체저장, 저장한 시간표가 화면이면 reload). 기본 대상 = 기본시간표(primary).
- **데이터 파이프라인**: `build-bundled.js`가 gls+skku+review+inform 조인, version 자동+1. 파서 34/34.
- ★ **크롬 웹스토어 등록 텍스트 생성**(chrome-store-listing 스킬): 설명·카테고리(**교육**)·전용목적·권한근거(storage/호스트/activeTab·scripting/원격코드=아니요)·데이터 체크(9개 중 없음, 하단 3개 체크)·개인정보처리방침(하이브리드) 6블록. **제출 zip = `skku-gls-extension-v0.3.0.zip`**(런타임 파일만; 빌드전용 lib·미사용 이미지·문서·테스트 제외).

## 4. 수정/해결한 주요 문제
- ★ **네이티브 팝업 → 커스텀 다이얼로그**: 이름 변경·삭제 등에서 `www.naver.com 내용:` 같은 네이티브 prompt/confirm이 뜨던 것을 패널 디자인 모달로 교체(§3).
- ★ **삭제/이름변경 아이콘 흐릿함**: 이모지 렌더(특히 Windows) 문제 → SVG로 교체.
- ★ **확장앱 아이콘 "레이어 두 개"**: gls-fab류 이미지가 **투명이 아니라 흰/회색 사각 캔버스에 카드+그림자가 그려진** 형태여서, 그냥 쓰면 바깥 사각 + 안쪽 카드가 겹쳐 보임 → flood-fill 배경 투명화 + 크롭으로 한 겹 아이콘화(§3).
- **확장 컨텍스트 무효화 오류**: 리로드 후 죽은 `chrome.runtime` 호출 → `ctxOk`/`sendMsg`/`stGet`/`stSet` 방어 래퍼.
- **에타 FAB 고착**: `closeModal()`이 `end()` 미호출 → 취소/X 후 busy 고착. `closeModal`에서 `end()` 호출로 해결.
- **에타 "가져오기"(에타→GLS) 시도 후 제거**: `/find/timetable/table` 상세 스키마 이슈로 내보내기 전용 정리(4086d4b). ★재구현하려면 `everytime-upload_download.md §7` 실측 스키마대로.
- **강의평 매칭 오류(과목명 부분포함)**: gap 방식으로 교체.
- **책가방 세션마다 재활성화**: `gls_bag_tpl` 영구저장 + 저장템플릿 재구성.
- **에타 저장이 전체 교체 방식**: 기존 과목 id를 읽어(`etReadTable`) 신규와 함께 보내야 유지 — 코워크 대상선택 flow에 반영됨.
- **(주의) 지도앱은 별도 프로젝트**: `../부트캠프-일조량길추천서비스_20260708`(Next.js). **이 repo와 무관 — 건드리지 말 것.**

## 5. 남은 오류 / 미완성 (⚠ 브라우저 실검증은 사용자만 가능)
- **에타 내보내기 end-to-end 실검증(★대상 선택 포함)**: FAB 수동 → [내보낼 GLS 시간표]+[넣을 에타 시간표] 선택 → 검토 → 실제 등록(기존 과목 유지) 확인 필요. 패널 자동(pending) flow는 `showSrc=false`(소스=활성 고정, 대상만 선택).
- **★`pickInitialId` "과목 우선" 회귀**: 이전 세션에 넣은 "지정/활성 시간표가 비면 과목 있는 시간표 우선" 보정이 **코워크의 everytime-timetable.js rewrite로 사라짐**(현재 활성 기반 원본). 빈 활성 GLS 시간표를 **패널 자동 내보내기**(소스 드롭다운 없음)하면 "이 GLS 시간표에 과목이 없어요" 로 막힘. 재적용하려면 `pickInitialId`에 `tableHasCourses` 우선 로직 추가(원하는지 사용자 확인 후).
- **문서 §9 정정노트 일부 stale**: `everytime-upload_download.md §9` 2026-07-20 노트가 "etListTables 없음 / pickInitialId 과목우선 반영"이라 적었으나, 코워크가 **etListTables를 대상선택용으로 재도입**했고 **과목우선은 회귀** → 2026-07-21 기준 재정정 필요(코드 동작엔 영향 없음, 문서 정합성만).
- **강의평 매칭 미검증**: gap 로직 시뮬만 통과. 실패 시 콘솔 `[GLS-ET]` 로그.
- **책가방**: 정상 동작 보고됨. 세션 컨텍스트 미포착 시 GLS 동작 1회 필요할 수 있음.

## 6. 환경 / API / 배포 / 스토어 제출
- 로컬 배포: 빌드 없음. `whale://extensions`(또는 chrome/edge) → 개발자 모드 → 압축 해제된 확장 프로그램 로드 → 이 폴더. **manifest·아이콘/폰트 파일 바뀌면 확장앱 전체 리로드(↻), 아니면 코드 새로고침 + 대상 페이지 F5.** 데이터 변경 시 `node scripts/build-bundled.js`.
- 매니페스트: `permissions:["storage","unlimitedStorage","scripting","activeTab"]`, `host_permissions:["https://kingoinfo.skku.edu/*","https://everytime.kr/*","https://api.everytime.kr/*"]`, `web_accessible_resources`(폰트·`skku-logo.png`·`skku-emblem.png`, matches `<all_urls>`), `action`(팝업 없음, 아이콘=icon16/48/128). content_scripts:
  - MAIN·document_start (kingoinfo): `src/page-bridge/bag-bridge.js`
  - ISOLATED·document_idle (kingoinfo): `src/lib/schedule.js`, `src/content/content.js`
  - ISOLATED·document_idle (everytime.kr/lecture/*): `src/content/everytime-link.js`
  - ISOLATED·document_idle (everytime.kr/timetable/*): `src/lib/schedule.js`, `src/content/everytime-timetable.js`
  - 그 외 사이트: 툴바 아이콘 클릭 시 background가 activeTab으로 schedule+content 주입.
- **외부 서버·환경변수 없음.** 에타 API = `https://api.everytime.kr`(세션 쿠키 인증, CSRF 없음). GLS는 암호화 트랜잭션(직접 생성 금지, 페이지 경유).
- **★크롬 웹스토어 제출용 zip**(`skku-gls-extension-v0.3.0.zip`) 구성 = manifest + `src/background/background.js` + `src/lib/{normalize,search,schedule}.js` + `src/content/{content,everytime-link,everytime-timetable}.js` + `src/page-bridge/bag-bridge.js` + `data/bundled-courses.json` + `icons/{icon16,icon48,icon128,skku-logo,skku-emblem}.png` + `fonts/PretendardVariable.woff2`. **제외**: 빌드전용 lib(ssv/inform/course-extract), 미사용 이미지(gls-fab·gls-fab-icon), 원본 JSON, tests/docs/scripts/*.md/.git. manifest.json이 zip 루트에 있어야 함. **코드 바뀌면 zip 재생성 필요.**
- **★스토어 등록 텍스트**(이번 세션 chrome-store-listing 스킬로 생성, 재생성 가능): 카테고리=**교육**, 원격코드=**아니요**(모든 JS 번들·에타 fetch는 데이터만), 사용자 데이터 9유형 **아무것도 체크 안 함**(전부 chrome.storage 로컬·에타/GLS는 본인 세션), 개인정보처리방침=하이브리드(로컬 저장 + §4 외부사이트 통신 고지). 다음 단계: 스크린샷 1280×800 1장, 개인정보처리방침 Google Sites 공개 게시 후 URL 입력.
- **저장(chrome.storage.local)**: `gls_index`·`gls_meta`·`gls_seed_version`(인덱스), `gls_tables`(`{tables,activeId}`), `gls_mytable`(레거시), `gls_panel_open`, `gls_et_cache`(강의평 id), `gls_bag_tpl`(책가방 템플릿), `gls_et_last`(마지막 에타 시간표 URL), `gls_et_pending`(에타 내보내기 대기 플래그).
- **GitHub**: `https://github.com/bugoms/skku-gls` (브랜치 `main`).

## 7. 중요 파일과 역할
| 파일 | 역할 | 비고 |
|---|---|---|
| `src/content/content.js` | 전체 패널 UI(ISOLATED) | 검색/영역/시간표(병합·블록팝오버)/**커스텀 다이얼로그**/담기·강의평·에타내보내기/전체화면. **컨텍스트 안전 래퍼**. **FAB 없음**(툴바/Ctrl+K 토글). GLS 선언주입 + 타 사이트 activeTab 주입 |
| `src/content/everytime-timetable.js` | 에타 시간표 **내보내기 전용** | GLS→에타 검색→매칭→**대상 시간표 선택**→검토모달→전체저장(기존유지)+커스텀 폴백. `closeModal`→`end()`. **가져오기 없음**. `pickInitialId`=활성 기반(과목우선 아님) |
| `src/content/everytime-link.js` | 에타 강의평 자동연결 | gap 매칭 |
| `src/page-bridge/bag-bridge.js` | 책가방 담기(MAIN) | 8인자 캡처/재생 + `gls_bag_tpl` |
| `src/background/background.js` | 시드+검색+아이콘 | `importScripts('../lib/normalize.js','../lib/search.js')`. 아이콘클릭: 메시지 토글 or activeTab 주입 |
| `src/lib/schedule.js` | 시간 파싱/레인 | `parseSchedule`·`DAYS`·`assignLanes`. content·everytime-timetable 공용 |
| `data/bundled-courses.json` | 검색 데이터 | v4, depts[]/gyoAreas[] |
| `icons/gls-fab-icon.png` | ★아이콘 소스 마스터 | 투명 처리본. icon16/48/128 재생성 시 여기서 크롭/리사이즈 |
| `docs/api-notes.md` / `everytime-upload_download.md` | API 근거 | §8 책가방, §9 에타 / 에타 실측 §7 |

## 8. 다음 채팅에서 할 만한 일
1. **크롬 웹스토어 제출 마무리**(사용자): 개발자 대시보드에 zip 업로드 + 스토어 텍스트 6블록 입력 + **스크린샷 1280×800 1장**(GLS에 패널 뜬 화면) + 개인정보처리방침 Google Sites 공개 게시 후 URL 입력.
2. **에타 내보내기 실검증**(사용자): [내보낼 GLS 시간표]+[넣을 에타 시간표] 선택 → 등록(기존 과목 유지) 확인.
3. (선택) **`pickInitialId` 과목우선 재적용 여부 결정** — 재적용 시 코워크 rewrite 위에 `tableHasCourses` 우선 로직 추가(§5). 사용자 확인 필요.
4. (정리) `everytime-upload_download.md §9` 정정노트 2026-07-21 기준 재정정(etListTables 재도입·pickInitialId 회귀).
5. (선택) `skku-emblem.png`가 코드에서 미사용 → WAR에서 제거할지, `gls-fab.png` 미사용 정리 여부.
6. 에타 매칭/등록 실패 시 콘솔 `[GLS-ETT]`(내보내기)/`[GLS-ET]`(강의평) 로그로 규격·이름정규화 보정.

## 9. 유지 조건 / 주의사항
- **빌드 도구 도입 금지** — 순수 JS·무빌드.
- **MAIN↔ISOLATED 통신은 CustomEvent만** — `window.postMessage`는 Nexacro와 충돌.
- **GLS 암호화 payload 직접 생성 금지** — 반드시 페이지 Nexacro 트랜잭션 경유(`bag-bridge.js`). 에타는 일반 웹이라 세션 쿠키 `fetch`면 됨(암호화 없음).
- **쓰기 동작(책가방·에타 등록)은 실행 전 확인 UI 필수**. **어시스턴트 샌드박스에서 사용자 GLS/에타 계정 쓰기 실행 금지**(코드·읽기 재현만, 실검증은 사용자/브라우저 가능한 코워크).
- **영역 기준**: 교양=review 정답영역(`gyoAreas`), 전공 세부=areaGrp3(21학번 이후) 우선. INFORM 파싱은 폴백.
- **데이터 갱신은 항상 `node scripts/build-bundled.js`**(version 자동증가로 재시드). 직접 편집 금지.
- 코드 수정 후 **`node --check <편집파일>`** + (파서 건드리면) **`node tests/parser.test.js`**. 확장앱 새로고침+F5.
- **동시 편집 주의**: 사용자·코워크가 같은 파일(특히 `everytime-timetable.js`)을 병렬 수정함. 내 변경이 덮이거나 남의 변경을 덮지 않게 **커밋 전 `git diff` 필독**.
- **에타 ToS/봇 정책 유의** — 본인 계정·저빈도·클릭당. 호출 간 딜레이 유지(everytime-timetable.js 140ms). 대량 자동화 지양.
- **커밋은 사용자 지시 때만, `main`에 직접**. 지도앱(`../부트캠프-...`)은 이 프로젝트 아님 — 건드리지 말 것.

## 변경 이력
- 2026-07-21: 커스텀 다이얼로그(네이티브 팝업 대체)·헤더 아이콘 SVG화·**FAB 완전 제거**(내 작업), 확장앱 아이콘 GLS 일러스트로 교체(배경 투명화)(내 작업), 에타 내보내기 **"넣을 에타 시간표" 대상 선택 추가**(코워크·`pickInitialId` 활성기반 회귀), 크롬 웹스토어 등록 텍스트·제출 zip 생성.
- 2026-07-20: 내보내기 전용 정리·블록 팝오버·컨텍스트 방어·엠블럼 FAB·에타 API 실측 반영(직전 HANDOVER 기준 `4086d4b`).
