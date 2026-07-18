/*
 * INFORM 필드 파서 — "이 과목이 어느 영역 탭에 담기는지" 를 뽑아낸다.
 * 근거: docs/api-notes.md §4 (실제 예시 2건).
 *
 *  "**영역구분: 글로벌[2020학번이후] /  전문영어[2019학번이전]"
 *  "**영역구분: 인문사회과학/자연과학기반[2020학번이후] /  기초자연과학[2019학번이전]"
 *
 * ⚠️ 영역명 안에 '/'가 있으므로(예: 인문사회과학/자연과학기반) 절대 '/'로 split 하지 않는다.
 *    반드시 대괄호 [학번조건] 를 기준으로 (영역명, 학번조건) 쌍을 추출한다.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.GLS_INFORM = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  // (영역명)[학번조건] 반복 매칭. 영역 캡처는 대괄호가 아닌 문자 전부.
  var PAIR_RE = /([^\[\]]*?)\s*\[([^\]]+)\]/g;

  function cleanArea(raw) {
    return String(raw)
      .replace(/^\*+/, '')            // 선행 '**'
      .replace(/영역구분\s*:/, '')     // '영역구분:' 라벨
      .replace(/^[\s/]+/, '')         // 앞쪽 잔여 '/' 와 공백 (이전 쌍의 구분자)
      .replace(/\s+$/, '')            // 뒤 공백
      .trim();
  }

  /**
   * INFORM 원문 → [{ area, cohort }] 배열.
   * 대괄호 쌍이 하나도 없으면, 라벨을 제거한 나머지를 area 로 (cohort 없이) 반환.
   */
  function parseInform(inform) {
    var out = [];
    if (!inform) return out;
    var s = String(inform);

    // "영역구분" 표기가 있는 교양 과목만 영역으로 취급.
    // (전공 등은 INFORM 에 플립러닝 시간 등 다른 정보가 들어있어 영역이 아님)
    if (s.indexOf('영역구분') === -1) return out;

    PAIR_RE.lastIndex = 0;
    var m;
    while ((m = PAIR_RE.exec(s)) !== null) {
      var area = cleanArea(m[1]);
      var cohort = m[2].trim();
      if (area) out.push({ area: area, cohort: cohort });
    }

    if (out.length === 0) {
      var fallback = cleanArea(s.replace(/^\*+\s*영역구분\s*:/, ''));
      if (fallback) out.push({ area: fallback, cohort: '' });
    }
    return out;
  }

  /**
   * 표시용 요약 문자열. 예:
   *   "글로벌 (2020학번이후) / 전문영어 (2019학번이전)"
   */
  function informToText(inform) {
    var pairs = parseInform(inform);
    if (!pairs.length) return '';
    return pairs.map(function (p) {
      return p.cohort ? (p.area + ' (' + p.cohort + ')') : p.area;
    }).join(' / ');
  }

  return { parseInform: parseInform, informToText: informToText };
});
