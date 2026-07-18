# GLS(킹고인포) API 조사 노트 (Phase 0)

> plan.md의 근거 문서. DevTools 캡처 + curl 재현으로 **실제 확인된 사실만** 기록한다.
> 최종 갱신: 2026-07-17

---

## 요약 (제일 중요한 3가지)

1. **GLS 전자시간표 = Nexacro(GAIA) 앱.** 화면은 `.xfdl`, 통신은 `/gaia/<화면ID>/<메서드>.do` 로 POST.
2. **요청 본문은 클라이언트에서 암호화된다** (`Crypto::<base64>::<hex16>::<hex16>` 형식). 평문 요청은 서버가 `ErrorCode=-1 요청을 처리할 수 없습니다` 로 거부 → **임의 쿼리를 raw HTTP로 못 만든다.**
3. **응답은 평문 SSV** 로 돌아온다. 복호화 불필요, 그대로 파싱 가능. **→ 확장앱의 핵심 전략은 "페이지가 받는 응답을 가로채 인덱싱"으로 결정.**

---

## 1. 플랫폼: Nexacro / GAIA

- 초기 로딩 파일: `SDI_FRAME.xfdl.js`, `TOP_MENU.xfdl.js`, `MDI_TAB.xfdl.js`, `MENU_POPUP_DIV.xfdl.js`, `gaia_sdi.xadl.js`, initiator `Framework.js`.
- 페이지 진입점: `https://kingoinfo.skku.edu/gaia/nxui/index.html` (Referer로 확인).
- 화면은 일반 DOM이 아니라 Nexacro가 그리는 구조 → **단순 DOM 클릭/스크래핑은 비권장.** 대신 페이지 전역 `nexacro` 객체를 통해 앱/데이터셋에 접근하는 방식 검토.
- content script는 isolated world라 페이지의 `nexacro` 전역·XHR에 직접 접근 불가 → **MAIN world 주입 필요** (MV3 `world: "MAIN"`).

## 2. 확인된 엔드포인트

| 엔드포인트 | 데이터셋 | 성격 | 비고 |
|---|---|---|---|
| `POST /gaia/NHSSU030540M/selectMain03.do` | `dsGrdMain03` | **전자시간표(교양) 과목 목록** (핵심) | **INFORM(영역) 포함 확정.** 영역 탭 클릭 시 호출 |
| `POST /gaia/NHSSU030540M/selectMain02.do` | `dsGrdMain02` | 전자시간표 영역 요약/서브목록(추정) | 소용량(수백 bytes, 8·9·3행). 영역 탭 클릭 시 selectMain03과 쌍으로 호출 |
| `POST /gaia/NHSSU030610M/selectMain.do` | `dsGrdMain` | **"전체과목 검색" 결과(추정)** | 별도 화면 ID(`...0610M`). 키워드 검색 시 호출. **INFORM(영역) 포함 여부 = 다음 확인 대상(가장 중요)** |
| `sessionLogin.do`, `switchSession.do`(302) | — | 세션/로그인 | |
| `getMenuInfoList.do` (11.1kB) | — | 좌측 메뉴 트리 | |

- 화면 ID 매핑(관측): `NHSSU030540M` = 전자시간표(교양), `NHSSU030610M` = 전체과목 검색(추정). 다른 좌측 메뉴(전공/DS 등)는 또 다른 화면 ID일 것.
- **패턴:** 전자시간표에서 영역 탭 클릭 → `selectMain02`(요약) + `selectMain03`(과목목록, INFORM 포함)이 함께 호출됨. → **패시브 훅으로 영역을 훑으면 dsGrdMain03들이 자연히 인덱싱됨.**

## 3. 요청 포맷 (암호화)

실제 캡처된 요청 헤더/본문:

```
POST /gaia/NHSSU030540M/selectMain03.do
Content-Type: text/xml
X-NX-Content-Type: 2            ← Nexacro 전송 타입
X-Requested-With: XMLHttpRequest
Origin: https://kingoinfo.skku.edu
Referer: https://kingoinfo.skku.edu/gaia/nxui/index.html
Cookie: ... JSESSIONID=... ; WMONID=... ; HOMEPAGE_JSESSIONID=...

본문(--data-raw):
Crypto::<base64 암호문>::f372ed6...(hex32)::099f152...(hex32)
```

- `Crypto::` 프리픽스 + base64 암호문 + `::` + 32hex(IV 추정) + `::` + 32hex(체크섬/키 추정).
- **암호화는 필수.** 같은 세션에서 동일 암호문 재전송(replay)은 성공(멱등) → nonce/타임스탬프 강제는 아님. 하지만 **본문이 불투명해 검색어를 바꿀 수 없음.**

### 인증
- `JSESSIONID`(전자시간표 세션) + `WMONID` 쿠키로 인증. curl 재현 성공 → 세션 쿠키만 있으면 호출 가능.
- 별도 CSRF 토큰 헤더는 관측되지 않음(암호문 자체가 무결성 역할로 추정).

## 4. 응답 포맷 (평문 SSV) — 파싱 규격 확정

- `Content-Type: text/html` 이지만 본문은 **Nexacro SSV**.
- 구분자: `\x1e`(RS, 섹션/레코드) · `\x1f`(US, 필드).
- 구조:
  ```
  SSV:UTF-8 <RS> ErrorCode:int=0 <RS> ErrorMsg:string=SUCCESS <RS>
  Dataset:dsGrdMain03 <RS>
  <컬럼정의: name:type(size) 를 US로 구분> <RS>
  <데이터행: 첫 필드 _RowType_(N=Normal), 이후 US로 구분> <RS> ...
  ```
- 실패 시: `ErrorCode:int=-1 ErrorMsg:string=요청을 처리할 수 없습니다.`

### `dsGrdMain03` 컬럼 (전량)
`_RowType_`, `_chk`, `GAESUL_YEAR(4)`, `GAESUL_TERM(2)`, `CAMPUS_GB(1)`, `CAMPUS_NM(300)`,
`ISU_NAME(20)`, `HAKSU_NO(7)`, `BUNBAN(3)`, `HAKSU_NO_BUNBAN(11)`, `JUKYONGHAKWI_GB(7)`,
`GWAMOK_NAME(4000)`, `GWAMOK_ENG_NAME(4000)`, `HAKJUM(82)`, `PER_ID`, `PER_NAME(60)`,
`GYOSI_NAME(500)`, `HYUNGTAE(300)`, `BIGO(343)`, `SUUP_TYPE_CD(2)`, `SUUP_TYPE_NM(300)`,
`GRADE_NAME(32)`, `SEMINAR_SUBJECT(100)`, `ABEEK_YN(32)`, `LANG_CD(32)`,
**`INFORM(4000)`**, `HAKBU_JIBJUNG_GB(1)`, `HAKBU_JIBJUNG_GB_NM(300)`,
`LECTURE_PLAN_TYPE(2)`, `ABK_PROGRAM(32)`, `INTRO_URL(500)`

### 우리 기능에 필요한 필드 (확정)
| 필드 | 예시값 | 우리 화면에서의 의미 |
|---|---|---|
| `CAMPUS_NM` | `자연과학` | 캠퍼스 구분 (인문사회/자연과학/i-Campus) |
| `ISU_NAME` | `교양` | 좌측 메뉴 계열(학사-교양/기타 vs 전공 vs DS) |
| **`INFORM`** | `**영역구분: 글로벌[2020학번이후] /  전문영어[2019학번이전]` | **상단 영역 탭 = "어디에 담아야 하는지". 학번별 분류까지 텍스트로 들어있음** |
| `HAKSU_NO` / `BUNBAN` | `GEDG006` / `41` | 학수번호-분반 |
| `GWAMOK_NAME` | `과학영어` | 과목명 |
| `PER_NAME` | `킴찰스바넷` | 교수명 |
| `HAKJUM` | `2(3)` | 학점(시수) |
| `GYOSI_NAME` | `[월 ~ 금]12:00-12:50【26117】...` | 시간/강의실 |

> 즉 **한 과목 행에 "이 과목이 어느 영역 탭에 있는지"가 이미 들어있다.** INFORM을 파싱하면 별도 매핑 테이블 없이 영역명을 바로 얻을 수 있다(단, 학번별 분기를 어떻게 보여줄지는 UI 결정 사항).

### INFORM 실제 예시 (파싱 규격 근거)
| 과목 | INFORM 원문 |
|---|---|
| 과학영어 (GEDG006-41) | `**영역구분: 글로벌[2020학번이후] /  전문영어[2019학번이전]` |
| 미분적분학1 (GEDB001-41/42) | `**영역구분: 인문사회과학/자연과학기반[2020학번이후] /  기초자연과학[2019학번이전]` |

- 형식: `**영역구분: <영역명>[<학번조건>] /  <영역명>[<학번조건>] ...` (뒤에 공백 패딩 있을 수 있음).
- **영역명에 `/`가 포함됨**(`인문사회과학/자연과학기반`) → 바 `/` split 금지. `([^\[\]]*?)\s*\[([^\]]+)\]` 정규식으로 (영역, 학번) 쌍 추출, 영역 캡처의 앞쪽 `/`·공백 트림.
- `GAESUL_TERM` 코드 체계(확정): **10=1학기, 15=여름 계절학기, 20=2학기, 25=겨울 계절학기**. (관측: 15=여름, 20=2학기 2764과목). `CAMPUS_GB=2` ↔ `CAMPUS_NM=자연과학`.

## 5. 확정된 제약 → 설계 결론

- ❌ **raw HTTP로 검색어 바꿔 쿼리 불가** (암호화 필수, 평문 거부 재현 완료).
- ✅ **응답은 평문** → 페이지가 받는 SSV 응답을 MAIN world에서 가로채 파싱하면 됨.
- → **결론: 확장앱은 "요청을 만드는" 대신 "응답을 관찰·인덱싱"한다.** (plan.md 전략 재작성 근거)

## 6. 아직 필요한 확인 (다음 캡처/구현 초기 검증)

| # | 확인할 것 | 방법 | 왜 필요 |
|---|---|---|---|
| 1 | **전체과목 검색** 메뉴의 엔드포인트/응답 | 그 화면에서 "일반물리학" 검색 후 캡처 | 키워드 검색 하나로 모든 영역을 커버하면 인덱싱 없이도 가능 |
| 2 | 영역 탭 클릭 시 요청이 **탭마다 별도 호출**인지 | 탭 2개 클릭 후 Network 비교 | 패시브 인덱싱이 자연스럽게 전 영역을 모으는지 판단 |
| 3 | ~~페이지에서 `nexacro.getApplication()` 접근 가능 여부~~ | ✅ **확인됨 (2026-07-17)**: `Application` 객체(`id: gaia_sdi`) 정상 반환. `commonTransactionCallback`, `cancelTransaction`, `all`(MainFrame/폼 컬렉션) 등 노출 → **능동 조회·탭이동·데이터셋 접근 가능** | "이 위치로 이동" 자동화 및 능동 수집 실현 가능 |
| 4 | `GAESUL_TERM` 코드 체계 (관측값 "15" = 2026 여름?) | 학기 바꿔 캡처 | 캐시 키/필터에 사용 |
| 5 | i-Campus / 인문사회 캠퍼스의 `CAMPUS_GB` 값 | 캠퍼스 라디오 변경 캡처 | 캠퍼스 필터 |

## 7. 보안/윤리 메모
- 캡처된 curl에는 사용자 본인 세션 쿠키가 포함 → 로컬에서만 사용, 외부 공유 금지. 로그아웃 시 무효화.
- 확장앱은 **읽기 전용 관찰**만 수행, 수강신청(sugang) 사이트는 건드리지 않음.

## 8. "책가방 담기" 연동 검토 (미구현, 2026-07-18)

전자시간표 각 과목 행의 **[책가방 담기]** 버튼을 확장앱에서 트리거할 수 있는지에 대한 예비 분석.
> 이건 kingoinfo(GLS)의 **책가방(사전 담기)** 이고, 실제 수강신청(sugang.skku.edu)과는 별개. 다만 계정 상태를 바꾸는 **쓰기 동작**이라 읽기 전용이던 기존 기능보다 신중해야 함.

### 가능성 판단: **조건부 가능(likely)**, 단 리버스엔지니어링 추가 필요
- 근거: `nexacro.getApplication()` 접근이 확인됨(§6-3). 담기 역시 Nexacro 트랜잭션이라, 앱 객체를 통해 **암호화를 프레임워크에 맡기고** 호출할 수 있을 가능성이 높음.

### 접근법
1. **DOM 클릭 시뮬레이션** — Nexacro는 자체 이벤트 체계라 표준 `.click()`이 안 먹을 수 있고, 담기 버튼은 **현재 화면에 보이는 과목 행에만** 존재 → 임의 과목 담기에는 부적합.
2. **폼의 담기 함수 직접 호출** (유력) — 담기 버튼의 onclick 핸들러(예: `fn_add_bookbag(row)`)를 찾아, 대상 과목의 데이터셋 행을 세팅해 호출. Nexacro가 암호화 처리. 폼(NHSSU030540M 등)이 로드돼 있어야 함.
3. **담기 트랜잭션 직접 호출** — 입력 데이터셋(학수번호·분반·년도·학기·캠퍼스)만으로 담기 엔드포인트를 직접 부름. 가장 유연하나 서버 검증(현재 화면 컨텍스트/시간충돌/선수과목 등) 통과 여부 불확실.

### 확인된 엔드포인트 (2026-07-18 캡처 · 담기 클릭 시 순서대로)
| # | 요청 | 성격 | 비고 |
|---|---|---|---|
| 1 | `POST /gaia/SKKUHS/selectHakwiGb.do` | 읽기(사전조회) | 응답 `dsHakwiGb.HAKWIGWAJUNG_GB=1`(학위과정 구분). **read-only 재현 성공** |
| 2 | `POST /gaia/SKKUHS/executeHSSUInsertDeleteBag.do` | **쓰기(담기/삭제 실행)** | 암호화. **재현하지 않음**(계정 책가방 변경) |
| 3 | `GET /gaia/nxui/cm/CommSystemMessagePopup.xfdl.js` | 결과 팝업 화면 로드 | Nexacro 팝업 |

- 담기 폼/화면 ID = **`SKKUHS`** (조회 화면 `NHSSU030540M` 과 별개).
- 두 요청 모두 `Crypto::` 암호화. 관측: 두 요청의 **말미 IV/키가 동일**(`9bc8ba02…::c35b41b1…`)하고, 2번 payload 꼬리가 이전 `selectMain03` payload와 **동일한 큰 블록**을 공유 → 암호문 = **세션 고정 컨텍스트 블록 + 소량 가변부(대상 과목)** 구조로 추정. (그래도 키 없이 임의 payload 생성은 불가.)

### 담기 실행 상세 (2026-07-18 콘솔 후킹으로 확정)
호출 체인 (전자시간표 그리드에서 담기 셀 클릭 시):
`grdMain03_OnCellClick`(NHSSU030540M.xfdl.js) → `insertBag` → `executeSaveBag` → `actionSubmit` → `commonTransaction`(skku.js) → `form.transaction`(플랫폼)

실제 담기 트랜잭션:
- svcID: `executeHSSUInsertDeleteBag`, url: `h2Service::SKKUHS/executeHSSUInsertDeleteBag.do`
- **입력 데이터셋 없음** — 모든 파라미터는 `arg` 문자열(key="value" 나열)로 전달:
  ```
  P_ROW_TYPE="I"  GAESUL_YEAR="2026"  GAESUL_TERM="20"  HAKSU_NO="GEDB021"  BUNBAN="41"
  HAKBUN="<학번>"  HAKWIGWAJUNG_GB="1"
  _FIRST_OUT_DS_NM="dsHSSUInsertDeleteBag"  _TRANSACTION_ID="executeHSSUInsertDeleteBag"
  _ALL_OUT_DS_NM="dsHSSUInsertDeleteBag=dsHSSUInsertDeleteBag"
  _MENU_ID="M000011089"  _PGM_ID="NHSSU030540M"  _SESSION_ID="<세션>"
  ```
  - `P_ROW_TYPE`: **I=담기, D=삭제** (명시적. 토글 아님)
  - 과목 식별: `GAESUL_YEAR/GAESUL_TERM/HAKSU_NO/BUNBAN`
  - 사용자: `HAKBUN`(학번), `HAKWIGWAJUNG_GB`(학위과정 — `selectHakwiGb.do` 에서 획득, 관측값 "1")
  - 프레임워크: `_MENU_ID/_PGM_ID/_SESSION_ID` (화면·세션 컨텍스트)
- 참고: 후킹 시 `form.transaction`의 첫 인자가 `{objForm, strSvcID, callback}` 객체로 관측됨(commonTransaction의 커스텀 호출 규약).

### ★ transaction 인자 규격 확정 (2026-07-18 콘솔 진단 + 재생 성공)
`form.transaction` 은 **8인자**로 호출된다:

| # | 값(담기 예) | 의미 |
|---|---|---|
| 0 | `{objForm, strSvcID:"executeHSSUInsertDeleteBag", callback:ƒ}` | svc 객체(커스텀 규약) |
| 1 | `h2Service::SKKUHS/executeHSSUInsertDeleteBag.do` | url |
| 2 | `""` | inDataset (없음) |
| 3 | `dsHSSUInsertDeleteBag=dsHSSUInsertDeleteBag` | outDataset |
| 4 | `  P_ROW_TYPE="I" ... _SESSION_ID="..."` | arg 문자열 |
| 5 | `"commonTransactionCallback"` | **콜백 함수명(문자열)** |
| 6 | `false` | async |
| 7 | `1` | dataType |

- **암호화는 `transaction`(플랫폼) 내부에서 수행** → 이 함수를 그대로 재생하면 `Crypto::` 요청이 정상 생성됨(진단 XHR 로그로 `ENCRYPTED` 확인).
- **-1(요청 처리 불가)의 진짜 원인 = 인자 5~7 누락.** 앞 5개만 재생하면 콜백명/async/dataType이 빠져 서버가 처리 못함(평문과 동일 에러). **8인자 전부 재생하면 ErrorCode=0 성공**(콘솔 `glsTestBag(...,"D")`로 실증, 실제 책가방에서 삭제됨).
- 콜백 `commonTransactionCallback`(arity 3, `app` 레벨): `function(objSvcID,nErrorCode,strErrorMsg){ skku.$.GLOBAL_TX_COUNT--; ... }`. → 응답 후 GLS 자체 결과 팝업 처리. `commonTransaction`은 `skku` 네임스페이스 내부라 전역/폼/프로토타입에서 직접 노출되지 않음(하지만 **재생엔 불필요** — form.transaction 8인자면 충분).

### 남은 것 (구현 시) — ✅ 해결됨
- [x] transaction 시그니처(8인자) 확정 → 확장앱은 캡처한 인자 배열을 통째로 재사용하고 **arg의 과목값(P_ROW_TYPE·YEAR·TERM·HAKSU_NO·BUNBAN)만 치환**해 재생. (skku.js 원문 불필요)

### 리스크
- **쓰기 동작**: 사용자 계정의 책가방을 변경 → 실행 전 확인 UI 필요.
- **화면 종속·취약**: 특정 폼/함수 이름에 의존, 사이트 개편 시 파손.
- **부분 커버**: 임의 과목(인덱스에 있으나 화면에 없는)을 담으려면 해당 화면으로 먼저 이동해야 할 수 있음.

### 잠정 결론 (갱신 2)
- **거의 모든 것 확정.** 담기는 `arg` 파라미터만으로 실행되고, 필요한 값(과목·학번·학위·프레임워크 컨텍스트)을 전부 파악함.
- 구현 방법 (권장 순):
  1. **페이지 함수 재사용** — MAIN world에서 NHSSU030540M 폼의 `commonTransaction`/관련 함수를 대상 과목 파라미터로 호출. skku.js 시그니처만 확인하면 됨.
  2. **transaction 직접 호출** — `form.transaction`을 캡처한 arg 형식 그대로(과목값만 치환) 호출. HAKBUN/_SESSION_ID/_MENU_ID는 런타임에서 소싱.
- **쓰기 동작이므로 실행 전 확인 UI 필수.** P_ROW_TYPE=I(담기)/D(삭제)로 담기·빼기 모두 지원 가능.

### 구현 (2026-07-18) — 방법 2(transaction 직접 재현) 채택 · **8인자 재생으로 성공 확정**
- `src/page-bridge/bag-bridge.js` (MAIN world): `nexacro.Form.prototype.transaction` 후킹으로 프레임워크 컨텍스트(HAKBUN·_SESSION_ID·_MENU_ID·_PGM_ID·HAKWIGWAJUNG_GB) **자동 수집**(전자시간표 조회 시 arg에 실려 옴). 실제 담기 호출을 **인자 배열 통째로(8개) `bagTpl.args`에 캡처**.
- content 요청 시: `bagTpl.args` 를 복사해 **arg(=[4])의 과목값만 치환**하고 `origTx.apply(form, newArgs)` 로 **8인자 전부 재생**. (초기 버그: 5인자만 재생 → 서버 -1. 원인=콜백명/async/dataType 누락, 위 규격표 참조.)
- content: 결과 카드 우측 상단 [🎒 책가방] 버튼 → 확인창 → 브릿지 요청. 실제 결과는 GLS 자체 팝업이 표시.
- **검증됨(2026-07-18)**: 콘솔 8인자 재생 테스트에서 `ErrorCode=0` + 실제 책가방 반영 확인. 확장앱 코드도 동일 방식(8인자)으로 반영. (F5마다 `bagTpl`은 사라지므로, 세션당 GLS native 담기 1회로 템플릿 재시드 필요.)
