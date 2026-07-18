/*
 * 파서 검증 — 실제 GLS 응답 fixture 로 SSV/INFORM/normalize/search 를 테스트.
 * 실행: node tests/parser.test.js
 */
var fs = require('fs');
var path = require('path');

var SSV = require('../src/lib/ssv.js');
var INFORM = require('../src/lib/inform.js');
var COURSE = require('../src/lib/course-extract.js');
var NORM = require('../src/lib/normalize.js');
var SEARCH = require('../src/lib/search.js');
var SCHED = require('../src/lib/schedule.js');

var pass = 0, fail = 0;
function eq(actual, expected, name) {
  var a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + '\n      expected: ' + e + '\n      actual:   ' + a); }
}
function ok(cond, name) { eq(!!cond, true, name); }

function readFixture(f) {
  return fs.readFileSync(path.join(__dirname, '..', 'fixtures', f), 'utf8');
}

console.log('== SSV + Course 추출: 과학영어(1행) ==');
(function () {
  var parsed = SSV.parseSSV(readFixture('dsGrdMain03-sample.ssv'));
  eq(parsed.errorCode, 0, 'ErrorCode=0');
  ok(parsed.datasets.dsGrdMain03, 'dsGrdMain03 존재');
  var courses = COURSE.extractCourses(parsed, 111);
  eq(courses.length, 1, '과목 1건');
  var c = courses[0];
  eq(c.name, '과학영어', '과목명');
  eq(c.code, 'GEDG006', '학수번호');
  eq(c.section, '41', '분반');
  eq(c.campus, '자연과학', '캠퍼스');
  eq(c.isuType, '교양', '이수구분');
  eq(c.professor, '킴찰스바넷', '교수명');
  eq(c.areas, [{ area: '글로벌', cohort: '2020학번이후' }, { area: '전문영어', cohort: '2019학번이전' }], '영역(글로벌/전문영어)');
})();

console.log('== SSV + Course 추출: 미분적분학(2행, 영역명에 / 포함) ==');
(function () {
  var parsed = SSV.parseSSV(readFixture('dsGrdMain03-calculus-2rows.ssv'));
  var courses = COURSE.extractCourses(parsed, 222);
  eq(courses.length, 2, '과목 2건(분반 41,42)');
  var c = courses[0];
  eq(c.name, '미분적분학1', '과목명');
  eq(c.codeSection, 'GEDB001-41', '학수번호-분반');
  // 핵심: 영역명 안의 '/' 가 보존돼야 한다
  eq(c.areas, [{ area: '인문사회과학/자연과학기반', cohort: '2020학번이후' }, { area: '기초자연과학', cohort: '2019학번이전' }], '영역명에 / 보존');
})();

console.log('== INFORM 파서 단독 ==');
(function () {
  eq(INFORM.informToText('**영역구분: 글로벌[2020학번이후] /  전문영어[2019학번이전]'),
    '글로벌 (2020학번이후) / 전문영어 (2019학번이전)', 'informToText');
  eq(INFORM.parseInform('**영역구분: 인문사회과학/자연과학기반[2020학번이후] /  기초자연과학[2019학번이전]'),
    [{ area: '인문사회과학/자연과학기반', cohort: '2020학번이후' }, { area: '기초자연과학', cohort: '2019학번이전' }], '/ 포함 영역 파싱');
  eq(INFORM.parseInform(''), [], '빈 문자열');
  eq(INFORM.parseInform('*플립러닝:1.5h(ON)+1.5h(OFF)'), [], '영역구분 아님(전공) → 영역 없음');
})();

console.log('== normalize ==');
(function () {
  eq(NORM.normalize('일반물리학2'), NORM.normalize('일반물리학II'), '아라비아2 == 로마II');
  eq(NORM.normalize(' 미분적분학 1 '), '미분적분학1', '공백 제거');
  eq(NORM.normalize('English for Science'), 'englishforscience', '영문 소문자+공백제거');
})();

console.log('== search 랭킹 ==');
(function () {
  var courses = [
    { id: 'a', name: '일반물리학II', code: 'GEDB005', section: '41', codeSection: 'GEDB005-41', professor: '홍길동', campus: '자연과학', isuType: '교양', areas: [{ area: '자연/과학/기술', cohort: '' }] },
    { id: 'b', name: '미분적분학1', code: 'GEDB001', section: '41', codeSection: 'GEDB001-41', professor: '서이혁', campus: '자연과학', isuType: '교양', areas: [{ area: '인문사회과학/자연과학기반', cohort: '' }] },
    { id: 'c', name: '미분적분학1', code: 'GEDB001', section: '42', codeSection: 'GEDB001-42', professor: '서이혁', campus: '자연과학', isuType: '교양', areas: [] }
  ];
  var r1 = SEARCH.search(courses, '일반물리학2', {});
  ok(r1.length >= 1 && r1[0].name === '일반물리학II', '"일반물리학2" → 일반물리학II 매칭');
  var r2 = SEARCH.search(courses, 'GEDB001', {});
  eq(r2.length, 2, '학수번호로 2개 분반');
  var r3 = SEARCH.search(courses, '서이혁', {});
  eq(r3.length, 2, '교수명 검색');
  var r4 = SEARCH.search(courses, '일반물리학2', { campus: '인문사회' });
  eq(r4.length, 0, '캠퍼스 필터');
})();

console.log('== schedule 파서 ==');
(function () {
  var b1 = SCHED.parseSchedule('화15:00-16:15【미지정】,목16:30-17:45【미지정】');
  eq(b1.length, 2, '화/목 2블록');
  eq(b1[0], { day: '화', start: '15:00', end: '16:15', room: '미지정', startMin: 900, endMin: 975 }, '첫 블록');
  eq(b1[1].day, '목', '둘째 블록 요일');

  var b2 = SCHED.parseSchedule('[월 ~ 금]09:00-09:50【미지정】,10:00-10:50【미지정】,11:00-11:50【미지정】');
  eq(b2.length, 15, '월~금 × 3교시 = 15블록');

  var b3 = SCHED.parseSchedule('월수13:00-13:50【26117】');
  eq(b3.length, 2, '월수 2블록');
  eq(b3[0].room, '26117', '강의실');

  eq(SCHED.parseSchedule(''), [], '빈 문자열');

  // 레인 배정: 겹치면 2열, 안 겹치면 1열
  var overlap = SCHED.assignLanes([
    { startMin: 540, endMin: 600 }, { startMin: 570, endMin: 630 }
  ]);
  eq(overlap.lanes, 2, '겹치는 두 블록 → 2열');
  var nonOverlap = SCHED.assignLanes([
    { startMin: 540, endMin: 600 }, { startMin: 600, endMin: 660 }
  ]);
  eq(nonOverlap.lanes, 1, '안 겹치는 두 블록 → 1열');
})();

console.log('\n결과: ' + pass + ' 통과, ' + fail + ' 실패');
process.exit(fail ? 1 : 0);
