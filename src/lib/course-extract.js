/*
 * SSV 파싱 결과(datasets) → 표준 Course 객체 배열로 변환.
 * 관심 데이터셋은 "과목 데이터셋"으로 판별한다: 컬럼에 GWAMOK_NAME 과 INFORM 이 모두 있으면 채택.
 * (dsGrdMain03 뿐 아니라 이름이 달라도 스키마로 판별 → 사이트 개편에 강함. 근거: plan.md §6)
 *
 * 의존: GLS_INFORM (inform.js) — 로드 순서상 먼저 주입되어 있어야 함.
 */
(function (root, factory) {
  var api = factory(root.GLS_INFORM);
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  root.GLS_COURSE = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (INFORM) {

  // Node 테스트에서 require 로 주입할 수 있게 지연 로드 허용
  function getInform() {
    if (INFORM) return INFORM;
    if (typeof require !== 'undefined') return require('./inform.js');
    return (typeof globalThis !== 'undefined' ? globalThis.GLS_INFORM : null);
  }

  function isCourseDataset(ds) {
    if (!ds || !ds.columns) return false;
    var cols = ds.columns;
    return cols.indexOf('GWAMOK_NAME') > -1 && cols.indexOf('INFORM') > -1;
  }

  function rowToCourse(row, nowTs) {
    var inform = getInform();
    var year = row.GAESUL_YEAR || '';
    var term = row.GAESUL_TERM || '';
    var raw = row.INFORM || '';
    return {
      id: [year + '-' + term, row.CAMPUS_GB || '', row.HAKSU_NO || '', row.BUNBAN || ''].join('|'),
      yearTerm: year + '-' + term,
      year: year,
      term: term,
      campus: row.CAMPUS_NM || '',
      campusGb: row.CAMPUS_GB || '',
      isuType: row.ISU_NAME || '',            // 교양 / 전공 등 (좌측 메뉴 계열 힌트)
      code: row.HAKSU_NO || '',
      section: row.BUNBAN || '',
      codeSection: row.HAKSU_NO_BUNBAN || '',
      name: row.GWAMOK_NAME || '',
      nameEng: row.GWAMOK_ENG_NAME || '',
      credits: row.HAKJUM || '',
      professor: row.PER_NAME || '',
      schedule: row.GYOSI_NAME || '',
      lectureType: row.HYUNGTAE || '',
      suupType: row.SUUP_TYPE_NM || '',
      grade: row.GRADE_NAME || '',
      lang: row.LANG_CD || '',
      informRaw: raw,
      areas: inform ? inform.parseInform(raw) : [],  // [{area, cohort}]
      fetchedAt: nowTs || 0
    };
  }

  /**
   * parseSSV 결과 → Course[] (정상행 N, 과목명 존재하는 것만).
   */
  function extractCourses(parsed, nowTs) {
    var courses = [];
    if (!parsed || !parsed.datasets) return courses;
    Object.keys(parsed.datasets).forEach(function (name) {
      var ds = parsed.datasets[name];
      if (!isCourseDataset(ds)) return;
      ds.rows.forEach(function (row) {
        var rt = row._RowType_;
        if (rt && rt !== 'N') return;          // 삭제/변경행 제외
        if (!row.GWAMOK_NAME) return;
        courses.push(rowToCourse(row, nowTs));
      });
    });
    return courses;
  }

  return {
    isCourseDataset: isCourseDataset,
    extractCourses: extractCourses,
    rowToCourse: rowToCourse
  };
});
