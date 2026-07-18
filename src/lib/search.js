/*
 * 로컬 인덱스 검색 + 랭킹. 근거: plan.md §6.
 * 매칭 우선순위: 학수번호 완전일치 > 과목명 완전일치 > 시작일치 > 부분일치 > 교수명 일치.
 * 의존: GLS_NORMALIZE (normalize.js)
 */
(function (root, factory) {
  var api = factory(root.GLS_NORMALIZE);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.GLS_SEARCH = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (NORM) {

  function getNorm() {
    if (NORM) return NORM;
    if (typeof require !== 'undefined') return require('./normalize.js');
    return (typeof globalThis !== 'undefined' ? globalThis.GLS_NORMALIZE : null);
  }

  function scoreCourse(course, qRaw, qNorm) {
    var norm = getNorm();
    var code = (course.code || '').toLowerCase();
    var codeSection = (course.codeSection || '').toLowerCase();
    var nameNorm = norm.normalize(course.name);
    var profNorm = norm.normalize(course.professor);

    if (!qNorm) return 0;

    // 학수번호 계열
    if (code === qRaw || codeSection === qRaw) return 1000;
    if (code.indexOf(qRaw) === 0 && qRaw.length >= 3) return 900;

    // 과목명 계열
    if (nameNorm === qNorm) return 800;
    if (nameNorm.indexOf(qNorm) === 0) return 700;
    if (nameNorm.indexOf(qNorm) > -1) return 500;

    // 교수명
    if (profNorm && profNorm.indexOf(qNorm) > -1) return 200;

    // 학수번호 부분 포함
    if (code.indexOf(qRaw) > -1) return 150;

    return 0;
  }

  /**
   * courses: Course[], query: string, opts: { limit, campus, yearTerm }
   * 반환: 점수순 정렬된 Course[] (score, 필터 적용)
   */
  function search(courses, query, opts) {
    opts = opts || {};
    var norm = getNorm();
    var qRaw = (query || '').trim().toLowerCase();
    var qNorm = norm.normalize(query);
    if (!qNorm && !qRaw) return [];

    var scored = [];
    for (var i = 0; i < courses.length; i++) {
      var c = courses[i];
      if (opts.campus && c.campus !== opts.campus) continue;
      if (opts.yearTerm && c.yearTerm !== opts.yearTerm) continue;
      var s = scoreCourse(c, qRaw, qNorm);
      if (s > 0) scored.push({ course: c, score: s });
    }

    scored.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      // 동점: 과목명 → 분반 순
      var an = a.course.name || '', bn = b.course.name || '';
      if (an !== bn) return an < bn ? -1 : 1;
      return (a.course.section || '') < (b.course.section || '') ? -1 : 1;
    });

    var limit = opts.limit || 40;
    return scored.slice(0, limit).map(function (x) {
      return Object.assign({ _score: x.score }, x.course);
    });
  }

  return { search: search, scoreCourse: scoreCourse };
});
