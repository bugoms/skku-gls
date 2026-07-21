# everytime ↕ GLS 확장앱 — 업로드(내보내기)/다운로드(가져오기) 오류 수정 코워크 계획

> **목적**: 에타↔GLS 확장앱 시간표 연동(내보내기/가져오기)에서 발생한 4개 오류를, **브라우저에서 실제 에타 API 응답을 확인할 수 있는 코워크**가 진단·수정하도록 상세 지시서.
> 작성자(샌드박스 Claude)는 에타 계정·브라우저가 없어 실 API를 못 봄 → **1단계(실 응답 캡처)가 모든 수정의 전제**.
> 대상 파일: `src/content/everytime-timetable.js`(핵심), `src/content/content.js`(패널 버튼·라이브 동기화), 근거 `docs/api-notes.md §9`.

---

## 0. 유지 조건 (반드시 지킬 것)
- **순수 JS·무빌드**. 빌드 도구 도입 금지. 수정 후 `node --check <파일>`.
- 에타는 일반 웹 → **세션 쿠키 `fetch`(`credentials:'include'`)**, CSRF 없음. GLS 암호화와 무관.
- **쓰기 동작(에타 저장·GLS 저장)은 실행 전 확인 모달 유지.** 본인 계정·저빈도·호출 간 `sleep(140)` 유지(에타 봇 정책).
- **MAIN↔ISOLATED 통신은 CustomEvent만**(이 파일들은 ISOLATED라 해당 없음, 참고).
- 데이터 변환/키: GLS course 객체 필드 = `id, name, professor, credits, code, section, codeSection, campus, schedule`. 그리드는 `SCHED.parseSchedule(course.schedule)`로 그림. 에타 시간 = **day 0=월…6=일**, `start/end`(또는 `starttime/endtime`)는 **5분 단위**(분 = 값×5, 108=09:00).

---

## 1. 현재 구현 상태 (함수 지도)

### `src/content/everytime-timetable.js` (에타 `/timetable/*`에서 동작, ISOLATED, Shadow DOM 모달 1개 재사용)
- **API 래퍼**: `apiPost(path, body)` → `fetch(https://api.everytime.kr + path, POST, credentials:'include')` → text. `parseXml(t)`.
- **검색**: `etSearch(type, keyword, url)` — `/find/timetable/subject/list`. (내보내기 매칭용, 정상 동작 이력 있음)
- **시간표 읽기(id만)**: `etReadTable(identifier)` — `/find/timetable/table`, `<subject id>`에서 **id 목록 + 이름**만.
- **★시간표 목록**: `etListTables()` — `/find/timetable/table/list`(엔드포인트 **추정**), `querySelectorAll('table')` → `{identifier,year,semester,name,primary}`. **← 버그원(§3-A)**
- **★시간표 상세 읽기**: `etReadTableFull(identifier)` + `parseSubjectEl(s)` + `attrOrChild(el,key)` + `intOf(v)` — `/find/timetable/table` 응답의 `<subject>`에서 상세(이름·교수·code·credit·timeplaces) 추출 시도. **← 버그원(§3-B)**
- **저장**: `etSaveTable(name,url,ids)` — `/save/timetable/table`(전체 교체). `etCustomAdd(course)` — `/save/timetable/subject/custom`.
- **내보내기 UI(에타→저장)**: `start(prefer)` → `openExport` → `runExport`(상단 GLS시간표 드롭다운 + 매칭) → `renderReview` → `doRegister`.
- **가져오기 UI(에타→GLS)**: `startImport` → `openImport` → `runImport`(상단 학기 드롭다운 + 상세읽기) → `renderImportReview` → `doImport`(gls_tables에 새 시간표 저장).
- **변환**: `subjectToGlsCourse(subj)` — 에타 subject → GLS course(schedule 문자열 생성).
- **공통**: `busy`/`end()`, `exportGen`/`importGen`(경쟁 방지 토큰), `closeModal()`, `checkPending()`(GLS 패널에서 온 `gls_et_pending{mode}` 자동 실행), `semLabel(s)`, `pickHtml(cls,label,opts)`.

### `src/content/content.js` (GLS 패널)
- 버튼 `[에타로 내보내기]`(`exportToEverytime`), `[에타에서 가져오기]`(`importFromEverytime`) → `gls_et_pending{ts, mode?, tableId?}` 저장 + 에타 탭 오픈.
- **라이브 동기화**: `storage.onChanged`로 `gls_tables` 변경 시 패널 자동 갱신(`_selfTablesWrite` 가드).

---

## 2. 증상 (스크린샷 근거)

| # | 증상 | 근거 |
|---|---|---|
| A | 가져오기 **학기 드롭다운에 "?년 null학기"가 다수 섞임** + 유효 항목("2025년 1학기 · 시간표 1" 등)과 뒤섞임 | 스샷1 |
| B | **각 에타 시간표가 안 읽힘**(과목이 안 뜸) | 사용자 보고 |
| C | 에타 페이지의 **빨간 FAB "GLS에서 가져오기"가 안 눌림** | 사용자 보고 |
| D | **에타로 내보내기 시 등록이 안 뜸** — 기본 선택이 빈 "시간표 2 (0과목)"로 잡혀 "과목 없어요" | 스샷2 |

---

## 3. 근본 원인 가설 & 수정 방향

### A. 학기 목록 "?년 null학기" (`etListTables`)
- **현상 분석**: `etListTables`가 응답에서 `<table>`를 긁는데, **`year`/`semester` 속성이 없는 `<table>`도 섞여** 파싱됨 → 라벨이 "?년 null학기"(코드: `(t.year||'?') + '년 ' + semLabel(t.semester)`, semLabel(null)="null학기").
- **가설**: (1) `/find/timetable/table/list` 응답에 실제 시간표 `<table>` + 부가/래퍼 `<table>`가 섞여 있음, **또는** (2) 실제 데이터가 속성이 아니라 자식 요소(`<year value=…>` 등)에 있음, **또는** (3) 엔드포인트 자체가 틀려서 엉뚱한 `<table>`(예: 페이지 DOM은 아님)이 잡힘.
- **수정 방향**: §4에서 **실 XML 캡처** 후 → (a) 유효 항목만 필터(`identifier && year && semester`), (b) `identifier` 기준 dedup, (c) 속성/자식 어느 쪽인지에 맞춰 파서 수정, (d) `primary` 우선·최신 학기 정렬. 유효 항목이 0이면 "현재 열린 시간표"만 폴백(이미 그렇게 되어 있음).

### B. 시간표 상세가 안 읽힘 (`etReadTableFull` / `parseSubjectEl`)
- **가설(유력)**: `docs/api-notes.md §9-(B)`에 "**기존 과목 id 목록**"만 언급 → `/find/timetable/table` 응답의 `<subject>`가 **id만** 있고 이름·시간이 없을 가능성. 그러면 `parseSubjectEl`이 이름 빈값·timeplaces 0 → `subjectToGlsCourse`가 "(과목명 없음)"·schedule 없음 → 목록 비거나 무의미.
- **대안 경로(캡처 결과에 따라 택1)**:
  1. **상세가 응답에 있다** → `parseSubjectEl`의 속성/자식·timeplace/`<time><data>` 매칭만 실제 태그명에 맞게 교정.
  2. **id만 있다** → 상세를 다른 방법으로 해결:
     - (권장) **에타 시간표 페이지 DOM에서 읽기**: `/timetable` 페이지에 렌더된 과목 블록(과목명·요일·시간·강의실)을 DOM 파싱. 가장 확실(화면에 이미 다 있음). 단 DOM 구조 의존 → 방어적으로.
     - **id→상세 API 탐색**: `/find/timetable/subject/info` 등 id로 단건 조회 엔드포인트가 있는지 네트워크 탭에서 확인.
     - **`etListTables` 응답에 과목까지 포함**되는지 확인(list가 각 table의 subject까지 주면 그걸 사용).
- 어느 쪽이든 최종 산출은 `subjectToGlsCourse`가 기대하는 `{id,name,professor,code,credit,timeplaces:[{day,start,end,place}]}` 형태.

### C. 에타 FAB "GLS에서 가져오기" 안 눌림 (**코드만으로 확실히 수정 가능**)
- **원인(확정에 가까움)**: `start`/`startImport`가 시작 시 `busy=true; elFab.disabled=true`로 잠그는데, **`closeModal()`(취소·X·바깥클릭)이 `end()`를 호출하지 않음** → 모달을 등록/가져오기 없이 닫으면 `busy`가 true로 고착 + FAB `disabled` 유지 → 이후 FAB·start가 `if(busy)return`으로 무반응.
  - 특히 GLS 패널에서 넘어온 **가져오기 pending이 자동 실행 → 모달 뜸 → 사용자가 닫음 → busy 고착** → 그 뒤 FAB 안 눌림. 재현 잘 됨.
- **수정(권장, 브라우저 없이 가능)**: `closeModal()`에서 `end()` 호출(+ 진행 중 저장이 아니면 `elGo`/`elCancel` 상태 복구). 즉:
  ```js
  function closeModal() { elOv.classList.remove('open'); end(); }
  ```
  단 `doRegister`/`doImport`가 저장 완료 후 `closeModal()`을 부르는데, 그 경로엔 이미 `end()`가 있으므로 **중복 호출 무해**(멱등). 저장 진행 중(스피너) 상태에서 닫기를 막고 싶으면 `if(saving)return` 가드 추가 고려.
- **추가 점검**: 스크립트 로드 중 예외로 FAB 리스너가 안 붙었을 가능성 → 콘솔 에러 확인.

### D. 에타로 내보내기 등록 안뜸 (기본 시간표 + 저장 검증)
- **원인1(기본 선택)**: `pickTableId(store, prefer)`가 `prefer`(패널에서 온 activeId) 없거나 활성이 빈 "시간표 2"면 그걸 기본 선택 → "과목 없어요"로 아무것도 안 됨.
  - **수정**: 기본 선택을 **prefer → active → (그게 비었으면) 과목 있는 첫 시간표** 순으로. 빈 시간표뿐이면 안내.
- **원인2(저장/매칭)**: `docs/api-notes.md §9`엔 저장·검색 실측 성공 기록 있음. 리팩터로 `renderReview`가 `.rv`에 그리도록 바뀐 것 외 저장 로직(`doRegister`/`etSaveTable`) 불변 → **회귀 아닐 가능성 큼**. 실제 원인은 D-원인1(빈 시간표)일 확률 높음.
  - **검증**: 과목 있는 시간표를 골라 매칭 결과가 뜨는지 → [등록] → 에타 새로고침 후 반영되는지. 매칭 0이면 검색(§B의 code/name)·학기(url.year/semester) 확인.

---

## 4. ⭐ 1단계 — 실제 에타 API 응답 캡처 (가장 먼저)

**에타 시간표 상세 페이지**(`https://everytime.kr/timetable/<year>/<semester>/<identifier>`)에서 **로그인 상태**로 DevTools 콘솔에 아래를 붙여넣고, **원문 XML을 그대로 이 문서 §7에 붙일 것.** (개인정보는 마스킹)

```js
// 헬퍼
const P = (path, body) => fetch('https://api.everytime.kr'+path, {
  method:'POST', credentials:'include',
  headers:{'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8'},
  body
}).then(r=>r.text());

// (1) 내 시간표 "목록" — §3-A 진단. 빈 body/다른 파라미터도 시도.
P('/find/timetable/table/list','').then(t=>console.log('LIST\n', t));

// (2) 현재 시간표 "상세 읽기" — §3-B 진단. <identifier>는 현재 URL에서.
const ID = location.pathname.match(/\/timetable\/\d+\/\d+\/([^/?#]+)/)[1];
P('/find/timetable/table','id='+encodeURIComponent(ID)).then(t=>console.log('TABLE\n', t));

// (3) 참고: 검색 응답 형식(정상 동작) — subject/timeplace 태그 형태 비교용
P('/find/timetable/subject/list','campusId=13&keyword='+encodeURIComponent(JSON.stringify({type:'code',keyword:'GEDB001'}))+'&limitNum=5&semester=2&startNum=0&year=2026').then(t=>console.log('SEARCH\n', t));
```

- **(1)**의 XML에서: `<table>`가 몇 개인지, 각 `<table>`의 **속성 목록**(`identifier`/`id`/`year`/`semester`/`name`/`primary` 실제 이름), "?년 null" 유발하는 `<table>`이 무엇인지(래퍼? 자식요소형?).
- **(2)**의 XML에서: `<subject>`에 **id 외 어떤 데이터가 있는지**(이름·교수·code·credit이 속성인지 자식인지, 시간이 `<timeplace start end>`인지 `<time><data starttime endtime>`인지, **혹은 아예 없는지**).
- 네트워크 탭에서 **에타가 시간표를 그릴 때 실제로 치는 요청**(목록·상세)이 위와 같은지, 다른 엔드포인트/파라미터인지도 확인.

> 이 3개 XML만 확보되면 A·B는 결정적으로 고쳐짐.

---

## 5. 2단계 — 이슈별 수정 지침 (캡처 결과 반영)

### 순서 (권장)
1. **C(busy 고착)** 먼저 — 브라우저 없이 즉시 수정 → FAB 다시 눌리게 만들고 반복 테스트 가능.
2. **§4 캡처** — A·B의 실 데이터 확보.
3. **A(목록 파서)** 수정 → 학기 드롭다운 정상화.
4. **B(상세 파서 or DOM/대체경로)** 수정 → 과목 실제로 읽힘.
5. **D(기본 시간표 + 내보내기 end-to-end)** 검증·보정.

### 각 수정의 산출물
- **A**: `etListTables()` — 유효 항목 필터+dedup+정렬, 실제 태그/속성명 반영. (필요시 엔드포인트 교체)
- **B**: `etReadTableFull()`/`parseSubjectEl()` 교정, **또는** 상세를 못 얻으면 **DOM 리더**(`readTableFromDom()`) 신설해 `runImport`가 그걸 쓰게.
- **C**: `closeModal()`에 `end()`.
- **D**: `pickTableId()`(빈 시간표 회피) + 내보내기 실동작 확인.

각 수정 후 `node --check src/content/everytime-timetable.js`, (해당 시) `node --check src/content/content.js`.

---

## 6. 검증 체크리스트 (코워크가 브라우저에서)
- [ ] 에타 시간표 페이지 FAB **여러 번 눌러도 매번 반응**(취소 후에도) — §C
- [ ] 가져오기 학기 드롭다운에 **"?년 null" 없음**, 내 실제 시간표만 학기별로 뜸 — §A
- [ ] 드롭다운에서 학기 바꾸면 **그 시간표 과목이 실제로 목록에 뜸**(이름·시간) — §B
- [ ] [가져오기] → GLS 패널에 **새 시간표 자동 생성 + 블록 그려짐**(라이브 동기화)
- [ ] 내보내기: **과목 있는 GLS 시간표가 기본 선택** → 매칭 결과 표시 → [등록] → **에타 새로고침 시 실제로 등록됨** — §D
- [ ] 매칭 실패 과목: 커스텀 폴백 체크·등록 동작
- [ ] 콘솔에 uncaught 에러 없음, `[GLS-ETT]` 로그로 흐름 추적 가능

---

## 7. 캡처한 실제 API 응답 (2026-07-19 코워크 실측 · 브라우저)

> 개인정보(내 시간표·과목) 대량 원문 대신 **구조/스키마**로 기록(수정에 필요한 건 이거임). URL=`/timetable/2026/2/60120324`(시간표1, 과목 있음)에서 캡처.

### (1) LIST — `POST /find/timetable/table/list` (body 빈 문자열)
- 응답 루트 `<response>` 안에 **`<table>` 17개**. 두 종류:
  - **유효**: 속성 `id, is_deleted, name, year, semester, priv, primary, created_at, updated_at, identifier` (`is_deleted="0"`). ← 진짜 내 시간표(유효 10개).
  - **삭제 스텁**: 속성 `id, is_deleted`(`is_deleted="1"`) 뿐 — **year/semester/name/identifier 없음** → 이게 "?년 null학기"의 정체(§3-A 확정).
- **★키 매핑 확정**: **읽기/URL 식별자 = `id` 속성(숫자 8자리)**. `identifier` 속성은 **20자 공유코드로 별개**(읽기에 쓰면 안 됨). 예: 현재 URL `60120324` = 그 `<table>`의 `id`. (`identifier`는 `RAz4…` 형식)
- **semester 값 = 문자열** `"1" "2" "여름" "겨울"` (숫자 3/4 아님). → `semLabel` 이 여름/겨울도 처리해야 함.
- 유효 table 엔 `<subject id>` 가 `<day>` 밑에 중첩(목록엔 상세 없음) — 목록은 드롭다운용으로만 사용.

### (2) TABLE 상세 — `POST /find/timetable/table` (body `id=<숫자 id>`)
- `<response><table id name year semester primary …><subject id="…">…</subject>…</table>`.
- **★`<subject>` 상세는 "자식요소"로 옴**(속성 아님): `<internal value>`, **`<name value>`**, **`<professor value>`**, **`<time value>`**, **`<place value>`**, **`<credit value>`**, `<closed value>`. **`<code>` 없음**(학수번호 못 얻음).
- **`<time value>` = 사람이 읽는 문자열**, `<br>` 구분: 예 `"월09:00-10:15【미지정】<br>수10:30-11:45【미지정】"`.
  → **`<br>`→`,` 치환하면 `SCHED.parseSchedule` 이 그대로 파싱**(요일+HH:MM-HH:MM【강의실】). timeplace/start/end(5분단위) 아님. (§3-B 확정)
- 실측: 시간표1 5과목(물리전자·회로이론2·기초공학수학2·전기자기학2·기초회로실험) 전부 schedule 블록 정상 생성 확인.

### (3) SEARCH (참고, 정상) — `POST /find/timetable/subject/list`
- `<subject id code name professor credit target lectureId time …>` + 자식 `<timeplace day start end place>`(start/end=5분단위). 내보내기 매칭용. `code`=학수번호-분반(GLS codeSection과 동일).

---

## 9. 수정 완료 (2026-07-19 코워크)
`src/content/everytime-timetable.js` 만 수정(내용은 §7 실측 반영). `content.js`/`manifest.json` 변경 없음. `node --check` 통과, 위 실 데이터로 검증.
- **A** `etListTables()`: `is_deleted="1"` 및 year/semester 없는 스텁 제외 + **`id` 속성(숫자) 사용**(identifier 아님) + id dedup + 연도/학기 정렬. `semLabel` 에 여름/겨울 추가.
- **B** `parseSubjectEl()`: 자식요소 `value` 읽기(`childVal`) + **`<time value>` `<br>`→`,` → schedule 문자열** 직접 생성. `subjectToGlsCourse`·`runImport` 필터를 schedule 기반으로.
- **C** `closeModal()` 이 `end()` 호출 → 취소/X 후 `busy` 고착 해제(FAB 다시 눌림). 저장 스피너 상태도 정리.
- **D** `pickTableId()`: 과목 있는 시간표 우선 선택(빈 시간표 기본선택→"과목 없어요" 방지).

> ⚠️ **정정 (2026-07-20)** — 위 §9는 작성 당시 계획/기록이며 이후 코드와 어긋남:
> - **A·B(가져오기/에타→GLS)는 이후 제거됨**(커밋 `4086d4b`, "내보내기 전용" 정리). `etListTables`·`parseSubjectEl`·`runImport`·`startImport`·`importFromEverytime` 등 가져오기 함수·FAB "GLS에서 가져오기" 버튼은 **현재 코드에 없음**. 재구현하려면 §7 실측 스키마 참고.
> - **C**는 유지(내보내기 `closeModal`→`end()`).
> - **D**는 함수명이 실제로는 `pickInitialId()`이며, "과목 있는 시간표 우선" 로직은 **작성 시점엔 미적용**이었고 **2026-07-20에 실제 반영**됨(지정/활성이 비면 과목 있는 첫 시간표로 폴백, 전부 비면 기존 우선순위 유지).

---

## 8. 참고 파일
- `docs/api-notes.md §9` — 에타 4개 API(검색·읽기·저장·커스텀) 실측 근거.
- `docs/everytime-timetable-handover.md` — 초기 연동 계획.
- `src/lib/schedule.js` — `parseSchedule`(요일+HH:MM-HH:MM【강의실】), `DAYS(['월'..'일'])`, `assignLanes`.
