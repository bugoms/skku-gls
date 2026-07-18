/*
 * SSV (Nexacro Separated Value) 파서.
 * 근거: docs/api-notes.md §4 — 섹션/레코드 구분 \x1e, 필드 구분 \x1f.
 *
 * 응답 구조:
 *   SSV:UTF-8 <RS> ErrorCode:int=0 <RS> ErrorMsg:string=SUCCESS <RS>
 *   Dataset:<name> <RS> <컬럼정의 US구분> <RS> <데이터행 US구분> <RS> ...
 *
 * 브라우저(page-hook)와 Node 테스트 양쪽에서 쓰도록 UMD 패턴으로 노출한다.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.GLS_SSV = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  var RS = '\x1e';
  var US = '\x1f';

  /**
   * SSV 문자열을 { errorCode, errorMsg, datasets: { name: {columns, rows} } } 로 파싱.
   * rows 는 컬럼명을 키로 갖는 객체 배열.
   */
  function parseSSV(text) {
    var result = { errorCode: null, errorMsg: '', datasets: {} };
    if (typeof text !== 'string' || text.indexOf('SSV:') !== 0) return result;

    var segments = text.split(RS);
    var currentName = null;   // 현재 데이터셋 이름
    var currentCols = null;   // 현재 데이터셋 컬럼명 배열 (null이면 다음 세그먼트가 컬럼정의)

    for (var i = 0; i < segments.length; i++) {
      var seg = segments[i];
      if (seg === '') continue;

      if (seg.indexOf('SSV:') === 0) {
        continue; // 인코딩 헤더
      }
      if (seg.indexOf('ErrorCode:') === 0) {
        var v = seg.split('=')[1];
        result.errorCode = v === undefined ? null : parseInt(v, 10);
        continue;
      }
      if (seg.indexOf('ErrorMsg:') === 0) {
        result.errorMsg = seg.substring(seg.indexOf('=') + 1);
        continue;
      }
      if (seg.indexOf('Dataset:') === 0) {
        currentName = seg.substring('Dataset:'.length);
        currentCols = null; // 다음 세그먼트 = 컬럼정의
        result.datasets[currentName] = { columns: [], rows: [] };
        continue;
      }
      // 데이터셋 컨텍스트가 아니면(변수 섹션 등) 무시
      if (currentName === null) continue;

      if (currentCols === null) {
        // 컬럼 정의 라인: "name:type(size)" 를 US로 구분, name 만 추출
        currentCols = seg.split(US).map(function (def) {
          return def.split(':')[0];
        });
        result.datasets[currentName].columns = currentCols;
        continue;
      }

      // 데이터 행
      var fields = seg.split(US);
      var row = {};
      for (var c = 0; c < currentCols.length; c++) {
        row[currentCols[c]] = fields[c] === undefined ? '' : fields[c];
      }
      result.datasets[currentName].rows.push(row);
    }
    return result;
  }

  return { parseSSV: parseSSV, RS: RS, US: US };
});
