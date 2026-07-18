# SKKU GLS 과목 위치 찾기 (브라우저 확장앱)

GLS 전자시간표에서 과목을 검색하면 **어느 영역(성균인성리더십 / 글로벌 / 인문사회과학·자연과학기반 / 자연·과학·기술 …)에 담아야 하는지**를 알려주고, **내 시간표**를 만들 수 있는 Chrome/Whale/Edge 확장앱입니다.

> "일반물리학2가 성균인성리더십에 있는지 자연과학기반에 있는지 못 찾겠다" 는 문제를 해결합니다.

## 설치 (압축 해제된 확장 프로그램 로드)

1. Whale/Chrome 주소창에 `whale://extensions` (크롬은 `chrome://extensions`) 입력.
2. 우측 상단 **개발자 모드** 켜기.
3. **압축 해제된 확장 프로그램을 로드합니다** 클릭 → 이 폴더(`manifest.json` 이 있는 폴더) 선택.
4. `https://kingoinfo.skku.edu` (GLS) 페이지로 이동. 설치하면 **2026학년도 2학기 2764과목**이 바로 검색됩니다(별도 수집 불필요).

## 사용법

1. GLS 페이지에서 확장앱 패널이 **자동으로 열립니다**(처음엔 시간표가 빈 상태). 닫으려면 헤더의 ×, 다시 열려면 우측 아래 **🔎** 버튼·**툴바 아이콘**·**Ctrl+K**.
2. **왼쪽 = 검색/정보:** 과목명·학수번호·교수명 검색 → 결과 카드에 **📍 영역 경로**(2020학번 이후 기준).
   ```
   미분적분학1  GEDB001-41
   서이혁 · 3(3)학점 · 자연과학 · [월~금]09:00...
   📍 학사-교양/기타과목 > 인문사회과학/자연과학기반  [2020학번이후]
   [추가하기]
   ```
3. **오른쪽 = 내 시간표:** [추가하기] 로 담은 과목이 주간 시간표(오전 9시~자정)에 색깔 블록으로 쌓입니다. 자동 저장됩니다.
   - **시간 충돌 방지:** 이미 담은 과목과 겹치면 경고창이 뜨고 추가되지 않습니다(기존 과목 우선).
   - **삭제:** 각 블록 우상단 **×**, 또는 **전체 비우기**.
   - 주말 수업을 담으면 그때 **토/일 칸이 자동 추가**됩니다(평소엔 월~금).

## 내장 데이터

검색 인덱스는 **`data/bundled-courses.json` (내장 데이터)** 로만 채워집니다. 확장앱은 더 이상 페이지에서 과목을 수집하지 않습니다.

- 데이터 갱신 방법: `gls-courses.json`(전체 수집본)을 편집/교체 → 아래 한 줄로 `data/bundled-courses.json` 재생성 후 `version` 을 올려 배포하면, 사용자 브라우저에서 자동으로 재시드(인덱스 완전 교체)됩니다.
  ```bash
  node -e 'var fs=require("fs"),I=require("./src/lib/inform.js");var s=JSON.parse(fs.readFileSync("gls-courses.json","utf8"));var c=s.courses.map(x=>{x.areas=I.parseInform(x.informRaw||"");return x});fs.writeFileSync("data/bundled-courses.json",JSON.stringify({format:"skku-gls-finder",version:3,count:c.length,courses:c}))'
  ```

## 동작 원리 (요약)

- 검색 인덱스는 설치 시 `data/bundled-courses.json` 을 `chrome.storage.local` 로 시드(재시드 시 완전 교체).
- 검색·시간표·충돌검사·저장 모두 **로컬**에서 수행. 외부 서버·수집 없음.
- GLS 조사 근거(Nexacro, 암호화 요청, SSV 응답, INFORM=영역 등)는 [docs/api-notes.md](docs/api-notes.md), 설계는 [plan.md](plan.md).

## 구조

```
manifest.json
data/bundled-courses.json   내장 데이터(= 검색 인덱스 원본, 2026-20 2764과목)
gls-courses.json            전체 수집본(내장 데이터의 소스)
src/
  lib/
    inform.js         INFORM → 영역/학번 파싱 (영역명 내 '/' 보존, '영역구분' 있을 때만)
    normalize.js      검색 정규화 (숫자↔로마자 등)
    search.js         로컬 검색/랭킹
    schedule.js       강의시간(GYOSI_NAME) → 시간표 블록 + 레인 배정
    ssv.js, course-extract.js   SSV 파서(초기 수집·테스트용, 런타임 미사용)
  content/content.js       [ISOLATED] 검색 + 시간표 UI (단일 화면)
  background/background.js  검색/현황 + 내장데이터 시드 (service worker)
icons/                      아이콘
fixtures/                   실제 GLS 응답 샘플 (테스트용)
tests/parser.test.js        파서 테스트 (node tests/parser.test.js) — 34 케이스
```

## 개발 / 테스트

```bash
node tests/parser.test.js
```
실제 GLS 응답 fixture 로 SSV·INFORM·정규화·검색·시간표 로직을 검증합니다(빌드 도구 불필요, 순수 JS).

## 참고

- 수강신청(sugang) 사이트는 건드리지 않습니다. 읽기 전용입니다.
- 실제 브라우저 로드 확인은 사용자 환경에서 진행합니다(파서 로직·문법은 검증 완료).
