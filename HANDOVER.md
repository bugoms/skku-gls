# HANDOVER — SKKU GLS 과목 위치 찾기 (브라우저 확장앱)

> 새 채팅에서 이 문서만 읽고 바로 이어서 작업할 수 있게 정리. 근거 = 실제 코드 + `docs/api-notes.md`.
> manifest 버전 `0.3.0`(미갱신, 이후 기능 다수 추가됨) / 내장데이터 v4. 최종 갱신 2026-07-19.
> ⚠️ **커밋 상태 주의(§0)**: 마지막 커밋 이후 큰 작업이 **미커밋**. 사용자가 브라우저 검증 후 커밋 예정 — **함부로 커밋/원복 금지**.

## 0. 현재 커밋 / 작업트리 상태 (가장 먼저 읽을 것)
- 마지막 커밋(origin/main, 푸시됨): **`955093d`** — 리디자인 + 강의평 gap 매칭 + 책가방 세션 의존 제거.
- **미커밋(M)**: `manifest.json`, `src/background/background.js`, `src/content/content.js`, `docs/api-notes.md`
- **미추적(??)**: `src/content/everytime-timetable.js`(신규 기능), `docs/everytime-timetable-handover.md`(에타 연동 계획 메모, 이미 구현됨=참고용)
- 미커밋 내용 = ①다른 사이트에서 열기 ②시간표 여러 개 ③에타 시간표로 내보내기 ④시간표 블록 병합.
- **이 4개 전부 브라우저 실검증 대기** → 사용자가 확인해주면 **한 번에 커밋·푸시**한다. (사용자 지시: 검증 전 커밋 금지)

## 1. 목적과 핵심 기능
성균관대 GLS 전자시간표(`kingoinfo.skku.edu`)에서 과목을 검색하면 **"GLS 어느 메뉴/영역에 담아야 하는지"**를 알려주는 Chrome/Whale 확장앱(MV3).
- **검색 → 영역 경로 표시**: 교양 `학사-교양/기타과목`+영역(`gyoAreas`), 전공 `학사-전공과목`+주관학부-학과(`depts`), DS `학사-DS과목`+기반/심화.
- **내 시간표(여러 개)**: [추가하기]로 **현재 활성 시간표**에 누적. 에타식 주간표·자동저장·시간충돌 방지·총학점·**과목별 고정색**. 시간표 **추가/전환/이름변경/삭제**. 온라인/아이캠퍼스는 표 아래 목록. **같은 과목·같은 날 15분 끊긴 블록은 한 블록으로 이어 그림**.
- **GLS 책가방 담기**: 결과카드 [담기] → 실제 GLS 책가방(§4). **세션 의존 제거**(§5) — 설치 후 GLS에 있기만 해도 담김.
- **에타 강의평 바로가기**: [강의평] → 교수+과목 매칭으로 그 강의 `lecture/view` 자동 이동.
- **다른 사이트에서 열기**(신규): 툴바 아이콘으로 **아무 사이트에서** 패널(검색·영역·시간표) 오픈. 담기는 GLS에서만(비-GLS는 경고 토스트).
- **에타 시간표로 내보내기**(신규·미검증): 내 시간표를 **에타 시간표에 실제 강의로 등록**(검색→매칭→검토 모달→저장, 매칭 실패 시 커스텀 직접추가 폴백).

## 2. 기술 스택 / 폴더 구조
- **순수 JavaScript, 빌드 도구 없음.** "압축 해제된 확장 프로그램 로드"로 바로 사용. Node는 테스트/데이터빌드에만.
```
manifest.json                 MV3 매니페스트 (v0.3.0). content_scripts: GLS·에타 lecture·에타 timetable, background, MAIN bag-bridge
data/bundled-courses.json     내장 검색 인덱스(v4, 2026-20 2764과목). depts[]/gyoAreas[] 포함
gls-courses.json / skku-courses.json / gls-courses-review.json   빌드 입력(원본/전공그룹/교양영역탭)
scripts/build-bundled.js      bundled-courses.json 재생성(gls+skku+review+inform 조인, version 자동+1)
fonts/PretendardVariable.woff2  내장 폰트
icons/  icon16/48/128.png · skku-logo.png(헤더 로고)
src/lib/
  ssv.js · inform.js · course-extract.js · normalize.js
  search.js         로컬 검색/랭킹
  schedule.js       강의시간 파싱 + 레인 배정. exports: parseSchedule, DAYS(['월'..'일']), toMinutes, expandRange, assignLanes
src/content/content.js          [ISOLATED] 전체 패널 UI(검색·영역·시간표(여러 개)·담기·강의평·에타 내보내기·전체화면). GLS엔 선언주입, 그 외엔 아이콘 클릭 시 주입
src/content/everytime-link.js   [ISOLATED · everytime.kr/lecture/*] 강의평 자동연결(gap 매칭)
src/content/everytime-timetable.js [ISOLATED · everytime.kr/timetable/*] 에타 시간표 등록(검색→매칭→저장) — 신규·미검증
src/background/background.js     [service worker] 내장데이터 시드, search/stats, 아이콘클릭→토글 or activeTab 주입
src/page-bridge/bag-bridge.js    [MAIN · kingoinfo] 책가방 담기 브릿지(transaction 8인자 캡처/재생 + 템플릿 영구저장)
tests/parser.test.js            파서 테스트 34케이스
docs/api-notes.md               리버스엔지니어링 근거(§8 책가방, §9 에타 시간표 API)
docs/everytime-timetable-handover.md  에타 연동 계획 메모(이미 구현됨 — 참고)
check.md                        영역표시 개편 기록
```

## 3. 지금까지 구현한 내용 (이번 세션 신규는 ★)
- **검색/영역 표시**(content.js `areaHtml`): 교양→gyoAreas 세로나열, 전공→depts(1개 인라인·2개↑ 드롭다운, 세부는 areaGrp3 우선), DS→기반/심화.
- **내 시간표**: 12시간제(9시~자정) 고정틀·주말 동적컬럼·레인 겹침·hover× 삭제·총학점·과목별 `_color` 고정. 온라인 목록.
  - ★ **여러 개(`gls_tables`)**: rchead에 시간표 선택 드롭다운 + [＋ 새 시간표]·[✎ 이름변경]·[🗑 삭제]. "추가하기"는 활성 시간표에 담김. 기존 단일 `gls_mytable`은 "시간표 1"로 자동 이관.
  - ★ **블록 병합**(`mergeAdjacent`, `MERGE_GAP_MIN=30`): 같은 과목·같은 날 ≤30분 간격 블록을 하나로 이어 그림(렌더 직전 데이터만 병합, 디자인 불변).
- **책가방 담기**(bag-bridge.js): `transaction` 8인자 캡처/재생. ★ **템플릿 chrome.storage 영구저장(`gls_bag_tpl`)** — 최초 1회 담기 후 세션마다 컨텍스트만 잡히면 재사용. 합성 `_MENU_ID` 기본값 보정, 후킹 설치 200ms.
- **에타 강의평**(everytime-link.js): ★ **gap 매칭** — 카드 텍스트에서 "과목명 끝↔교수명 시작" 간격 최소 후보 선택(논리회로설계 vs 논리회로설계실험 구분). 캐시 `gls_et_cache`.
- ★ **다른 사이트에서 열기**: background `action.onClicked` → 메시지 실패(미주입 탭)면 `chrome.scripting.executeScript`(activeTab)로 schedule+content 주입. content는 `IS_GLS`로 비-GLS 담기 경고 + 비-GLS 항상 열림.
- ★ **에타 시간표로 내보내기**(everytime-timetable.js + content.js `exportToEverytime`): content가 `gls_et_pending` 플래그 남기고 에타 시간표 탭 오픈 → 에타 스크립트가 검색·매칭·검토모달·저장. 근거 api-notes §9.
- ★ **UI 리디자인**(955093d): glass 시도했다 제거→**흰 배경 유지**, Lovable 폼(둥근 카드·필 버튼·인셋 섀도우·여백), 팝업 라운드 4px, **성균관대 로고 헤더**(로드 실패 시 워드마크 폴백), **전체화면 토글**, **FAB 검색 돋보기 SVG**(흰 배경·`#BEE65A` 외곽선), 강의평 hover 글씨 흰색 제거.
- **데이터 파이프라인**: `build-bundled.js`가 gls+skku+review+inform 조인, version 자동+1. 파서 34/34.

## 4. 수정/해결한 주요 문제 (이번 세션)
- **강의평 매칭 오류(과목명 부분포함)**: `x.txt.indexOf(nameNorm)`이 "논리회로설계"를 "논리회로설계실험"에도 매칭 → **gap 방식**(이름↔교수 간격 최소)으로 교체. DOM 구조 무관(에타 링크가 교수명 감싸도 동작). 6개 시나리오 시뮬 통과.
- **책가방 세션마다 재활성화**: F5마다 `bagTpl` 소멸 → **`gls_bag_tpl` 영구저장 + 저장템플릿 재구성 경로 추가**. 페이지 로드 트랜잭션에서 컨텍스트 자동 포착(후킹 200ms).
- **성균관대 로고 안 뜸**: onload 핸들러가 `style.display=''`로 CSS `display:none`을 되살려 이미지+폴백 둘 다 숨김 → `'block'`으로 수정.
- **UI glass 요구 철회**: 반투명/blur 넣었다가 사용자 요청으로 전부 제거, 솔리드 흰 배경 복귀(Lovable 폼은 유지).
- **에타 시간표 저장이 전체 교체 방식**: 기존 과목 id를 (B)로 읽어 신규와 함께 보내야 유지됨(안 그러면 기존 날아감) — everytime-timetable.js가 처리.
- **(주의) 지도앱은 별도 프로젝트**: `../부트캠프-일조량길추천서비스_20260708`(Next.js). 초반에 착각해 손댔다가 `git restore`로 전량 원복함. **이 repo와 무관 — 건드리지 말 것.**

## 5. 남은 오류 / 미완성 (⚠ 브라우저 실검증은 사용자만 가능)
- **미커밋 4개 기능 전부 브라우저 미검증**: ①다른사이트 열기+담기 경고 ②시간표 여러 개(전환/추가/삭제) ③에타 내보내기 end-to-end ④블록 병합.
- **에타 시간표 연동 — 어시스턴트 미검증(계정 쓰기)**: api-notes §9에 코워크가 브라우저 검색·저장 실측했다고 기록되어 있으나, **실제 end-to-end(내보내기→에타 등록) 최종 확인 필요.** 매칭 실패(외국인 교수·개설차) 과목은 커스텀 폴백 or 실패목록 표시.
- **강의평 매칭 미검증**: gap 로직은 시뮬만 통과, 브라우저 실측 필요(외국인 교수 표기차 등). 실패 시 콘솔 `[GLS-ET]` 로그(gap 값 포함).
- **책가방**: 정상 동작 보고됨(사용자). 다만 세션 컨텍스트 미포착 시 GLS 동작 1회 필요할 수 있음.

## 6. 환경 / API / 배포
- 배포: 빌드 없음. `whale://extensions`(또는 chrome) → 개발자 모드 → 압축 해제된 확장 프로그램 로드 → 이 폴더. **manifest 바뀌면 확장앱 전체 리로드(↻), 아니면 코드 새로고침 + 대상 페이지 F5.** 데이터 변경 시 `node scripts/build-bundled.js`.
- 매니페스트: `permissions:["storage","unlimitedStorage","scripting","activeTab"]`, `host_permissions:["https://kingoinfo.skku.edu/*","https://everytime.kr/*","https://api.everytime.kr/*"]`, `web_accessible_resources`(폰트·`skku-logo.png`, matches `<all_urls>`), `action`(팝업 없음). content_scripts:
  - MAIN·document_start (kingoinfo): `src/page-bridge/bag-bridge.js`
  - ISOLATED·document_idle (kingoinfo): `src/lib/schedule.js`, `src/content/content.js`
  - ISOLATED·document_idle (everytime.kr/lecture/*): `src/content/everytime-link.js`
  - ISOLATED·document_idle (everytime.kr/timetable/*): `src/lib/schedule.js`, `src/content/everytime-timetable.js`
  - 그 외 사이트: 툴바 아이콘 클릭 시 background가 activeTab으로 schedule+content 주입.
- **외부 서버·환경변수 없음.** 에타 API는 `https://api.everytime.kr`(세션 쿠키 인증, CSRF 없음 — api-notes §9). GLS는 암호화 트랜잭션(직접 생성 금지, 페이지 경유).
- **저장(chrome.storage.local)**: `gls_index`·`gls_meta`·`gls_seed_version`(인덱스), `gls_tables`(여러 시간표=현행), `gls_mytable`(레거시·이관원본), `gls_panel_open`, `gls_et_cache`(강의평 id), `gls_bag_tpl`(책가방 템플릿), `gls_et_last`(마지막 에타 시간표 URL), `gls_et_pending`(에타 내보내기 대기 플래그).
- **GitHub**: `https://github.com/bugoms/skku-gls` (브랜치 `main`).

## 7. 중요 파일과 역할
| 파일 | 역할 | 비고 |
|---|---|---|
| `src/content/content.js` | 전체 패널 UI(ISOLATED) | 검색/영역/시간표(여러 개·블록병합)/담기·강의평·에타내보내기 버튼/전체화면. GLS 선언주입 + 타 사이트 activeTab 주입 |
| `src/content/everytime-link.js` | 에타 강의평 자동연결 | gap 매칭. **미검증** |
| `src/content/everytime-timetable.js` | 에타 시간표 등록 | 검색→매칭→검토모달→저장(전체교체)+커스텀 폴백. **신규·미검증** |
| `src/page-bridge/bag-bridge.js` | 책가방 담기(MAIN) | 8인자 캡처/재생 + `gls_bag_tpl` 영구저장(세션 의존 제거) |
| `src/background/background.js` | 시드+검색+아이콘 | 아이콘클릭: 메시지 토글 or activeTab 주입 |
| `src/lib/schedule.js` | 시간 파싱/레인 | `parseSchedule`·`DAYS`·`assignLanes` 등. content·everytime-timetable 공용 |
| `scripts/build-bundled.js` | 내장데이터 빌드 | version 자동+1 |
| `data/bundled-courses.json` | 검색 데이터 | v4, depts[]/gyoAreas[] |
| `docs/api-notes.md` | API 근거 | §8 책가방(GLS), §9 에타 시간표 |

## 8. 다음 채팅에서 가장 먼저 할 일
1. **미커밋 4개 기능 브라우저 검증**(사용자와): ①타 사이트 아이콘→패널 열림 + 비-GLS 담기 경고 ②시간표 여러 개(전환 시 추가버튼 상태 갱신, 삭제) ③**에타 내보내기 end-to-end**(내보내기 → 에타 시간표 탭 → 검토모달 → 실제 등록, 기존 과목 유지) ④같은 과목 15분 끊긴 블록 병합.
2. **검증 완료되면 한 번에 커밋·푸시** (미커밋 M 4개 + 미추적 2개). 커밋 메시지는 세 축(다른사이트 열기 / 시간표 여러 개 / 에타 시간표 연동 + 블록 병합)으로.
3. 에타 매칭/등록 실패 시 콘솔 `[GLS-ETT]`/`[GLS-ET]` 로그로 규격·이름정규화 보정.

## 9. 유지 조건 / 주의사항
- **빌드 도구 도입 금지** — 순수 JS·무빌드.
- **MAIN↔ISOLATED 통신은 CustomEvent만** — `window.postMessage`는 Nexacro와 충돌.
- **GLS 암호화 payload 직접 생성 금지** — 반드시 페이지 Nexacro 트랜잭션 경유(`bag-bridge.js`). 에타는 일반 웹이라 세션 쿠키 `fetch`면 됨(암호화 없음).
- **쓰기 동작(책가방·에타 등록)은 실행 전 확인 UI 필수**. **어시스턴트 샌드박스에서 사용자 GLS/에타 계정 쓰기 실행 금지**(코드·읽기 재현만, 실검증은 사용자).
- **영역 기준**: 교양=review 정답영역(`gyoAreas`), 전공 세부=areaGrp3(21학번 이후) 우선. INFORM 파싱은 폴백.
- **데이터 갱신은 항상 `node scripts/build-bundled.js`**(version 자동증가로 재시드). 직접 편집 금지.
- 코드 수정 후 **`node --check <편집파일>`** + (파서 건드리면) **`node tests/parser.test.js`**. 확장앱 새로고침+F5.
- **에타 ToS/봇 정책 유의** — 본인 계정·저빈도·클릭당. 호출 간 딜레이 유지(everytime-timetable.js 140ms). 대량 자동화 지양.
- **미커밋 변경·미추적 파일 원복 금지**(§0). 지도앱(`../부트캠프-...`)은 이 프로젝트 아님 — 건드리지 말 것.
