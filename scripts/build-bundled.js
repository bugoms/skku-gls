/*
 * data/bundled-courses.json 재생성 (오프라인 데이터 빌드 — 확장앱 런타임과 무관).
 *
 * 입력:
 *   - gls-courses.json           : 전량 수집본(과목 원본, 검색 인덱스의 소스)
 *   - skku-courses.json          : 학사-전공과목을 단과대학→학과로 묶은 산출물(주관학부-학과·areaGrp2/3)
 *   - gls-courses-review.json    : 학사-교양/기타과목을 실제 교양영역(13개 탭)으로 묶은 산출물(정답)
 *   - src/lib/inform.js          : INFORM → 영역 파싱("영역구분" 있을 때만; 이제 교양 폴백 용도)
 * 출력:
 *   - data/bundled-courses.json  : version 3, areas 재계산 + (전공)depts[] + (교양/기타/교직)gyoAreas[] 주입
 *
 * 교양 영역(gyoAreas): INFORM 파싱은 부정확(글로벌(필수)→글로벌, 외국인전용 식별불가 등) →
 *   review 파일(실제 메뉴 그룹핑)을 codeSection 으로 조인해 "정답 영역"을 배열로 저장.
 *   같은 과목이 2개 영역에 걸치면(외국인전용＋일반영역 129건) 둘 다 저장(파일 순서 → 외국인전용이 뒤).
 *
 * 주관학부-학과(depts):
 *   같은 학수번호가 여러 학과에 걸쳐 나옴(인정·연계) → 걸친 학과를 **모두** 배열(`depts`)로 저장.
 *   각 학과 세부(sub) = **areaGrp3(21학번 이후) 우선, 없으면 areaGrp2** ("최신 영역구분만").
 *   정렬: 학수번호 접두어(BIZ→경영) 다수결로 학습한 "주관 학과"를 맨 앞으로.
 *   저장 상한 STORE_CAP(파일크기 방어). 초과분은 deptMore 로 개수만. (표시 상한은 content.js)
 *
 * 실행: node scripts/build-bundled.js
 */
var fs = require('fs');
var path = require('path');
var root = path.join(__dirname, '..');
var INFORM = require(path.join(root, 'src', 'lib', 'inform.js'));

var gls = JSON.parse(fs.readFileSync(path.join(root, 'gls-courses.json'), 'utf8'));
var skku = JSON.parse(fs.readFileSync(path.join(root, 'skku-courses.json'), 'utf8'));
var review = JSON.parse(fs.readFileSync(path.join(root, 'gls-courses-review.json'), 'utf8'));

// codeSection -> [교양영역 이름...] (파일 순서 유지, 중복 제거). 정답 영역 소스.
var gyoByCS = {};
(review.areas || []).forEach(function (area) {
  Object.keys(area.byCampus || {}).forEach(function (cg) {
    (((area.byCampus[cg] || {}).courses) || []).forEach(function (c) {
      var arr = gyoByCS[c.codeSection] = gyoByCS[c.codeSection] || [];
      if (arr.indexOf(area.name) < 0) arr.push(area.name);
    });
  });
});

var STORE_CAP = 10;   // 저장할 학과 최대 개수(파일크기 상한). 초과분은 deptMore 로 카운트.

function prefix(code) { var mm = String(code).match(/^[A-Za-z]+/); return mm ? mm[0] : String(code); }
function dmKey(college, major) { return college + ' :: ' + major; }

// code -> 학과별 유니크 [{college, major, sub}]  (sub = areaGrp3||areaGrp2 = 최신 영역구분)
var byCode = {};
skku.colleges.forEach(function (col) {
  (col.majors || []).forEach(function (m) {
    (m.courses || []).forEach(function (c) {
      var arr = byCode[c.code] = byCode[c.code] || [];
      var k = dmKey(col.name, m.name);
      if (!arr.some(function (e) { return e.k === k; })) {
        arr.push({ k: k, college: col.name, major: m.name, sub: c.areaGrp3 || c.areaGrp2 || '' });
      }
    });
  });
});

// 단일학과 코드로 prefix -> 주관학과 다수결 학습(정렬용)
var vote = {};
Object.keys(byCode).forEach(function (code) {
  if (byCode[code].length === 1) {
    var p = prefix(code), k = byCode[code][0].k;
    (vote[p] = vote[p] || {})[k] = (vote[p][k] || 0) + 1;
  }
});
var prefDm = {};
Object.keys(vote).forEach(function (p) {
  var best = '', bn = -1;
  Object.keys(vote[p]).forEach(function (k) { if (vote[p][k] > bn) { bn = vote[p][k]; best = k; } });
  prefDm[p] = best;
});

// 걸친 학과 전체 배열: 주관(접두어 다수결)을 맨 앞으로.
function deptsOf(code) {
  var list = byCode[code]; if (!list || !list.length) return null;
  var arr = list.map(function (e) { return { college: e.college, major: e.major, sub: e.sub }; });
  if (arr.length > 1) {
    var pk = prefDm[prefix(code)];
    if (pk) {
      for (var j = 0; j < arr.length; j++) {
        if (dmKey(arr[j].college, arr[j].major) === pk) { if (j > 0) arr.unshift(arr.splice(j, 1)[0]); break; }
      }
    }
  }
  return arr;
}

var src = gls.courses || gls;
var joined = 0, multi = 0, gyoJoined = 0, gyoDual = 0;
var courses = src.map(function (x) {
  var out = Object.assign({}, x);
  out.areas = INFORM.parseInform(x.informRaw || '');
  if (/전공|실험실습/.test(x.isuType || '')) {
    var depts = deptsOf(x.code);
    if (depts) {
      out.deptMore = Math.max(0, depts.length - STORE_CAP);
      out.depts = depts.slice(0, STORE_CAP);
      joined++;
      if (depts.length > 1) multi++;
    }
  }
  // 교양/기타/교직(그리고 review에 있는 과목): 정답 영역 주입.
  var g = gyoByCS[x.codeSection];
  if (g && g.length) { out.gyoAreas = g.slice(); gyoJoined++; if (g.length > 1) gyoDual++; }
  return out;
});

var bundle = { format: 'skku-gls-finder', version: 3, count: courses.length, courses: courses };
fs.writeFileSync(path.join(root, 'data', 'bundled-courses.json'), JSON.stringify(bundle));
console.log('bundled-courses.json v3 생성 완료:', courses.length, '과목');
console.log('  전공 조인:', joined, '(다중학과', multi + ') | 학습 prefix:', Object.keys(prefDm).length);
console.log('  교양 gyoAreas 조인:', gyoJoined, '(이중영역', gyoDual + ')');
