/*
 * 검색용 문자열 정규화. 근거: plan.md §6 검색 로직.
 *  - 공백/구분기호 제거, 소문자화
 *  - 로마숫자 ↔ 아라비아숫자 통일 ("일반물리학2" ↔ "일반물리학II")
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.GLS_NORMALIZE = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  // 유니코드 로마숫자 문자 → 아라비아
  var UNICODE_ROMAN = {
    'ⅰ': '1', 'ⅱ': '2', 'ⅲ': '3', 'ⅳ': '4', 'ⅴ': '5', 'ⅵ': '6', 'ⅶ': '7', 'ⅷ': '8', 'ⅸ': '9', 'ⅹ': '10',
    'Ⅰ': '1', 'Ⅱ': '2', 'Ⅲ': '3', 'Ⅳ': '4', 'Ⅴ': '5', 'Ⅵ': '6', 'Ⅶ': '7', 'Ⅷ': '8', 'Ⅸ': '9', 'Ⅹ': '10'
  };

  // 문자열 끝에 붙은 ASCII 로마숫자(대문자 I,V,X 조합)를 아라비아로.
  var ASCII_ROMAN_MAP = { i: 1, v: 5, x: 10 };
  function asciiRomanToInt(s) {
    var total = 0, prev = 0;
    for (var i = s.length - 1; i >= 0; i--) {
      var val = ASCII_ROMAN_MAP[s[i]];
      if (!val) return null;
      if (val < prev) total -= val; else { total += val; prev = val; }
    }
    return total;
  }

  function normalize(input) {
    if (input == null) return '';
    var s = String(input);

    // 유니코드 로마숫자 치환
    s = s.replace(/[ⅰ-ⅹⅠ-Ⅹ]/g, function (ch) { return UNICODE_ROMAN[ch] || ch; });

    // 소문자화
    s = s.toLowerCase();

    // 끝에 붙은 ASCII 로마숫자(i,v,x 조합)를 숫자로 — 한글 뒤에 오는 경우 위주
    s = s.replace(/([가-힣a-z])([ivx]{1,4})(?=[^a-z]|$)/g, function (m, head, roman) {
      var n = asciiRomanToInt(roman);
      return n != null ? head + n : m;
    });

    // 공백/특수문자 제거 (한글, 영문, 숫자만 남김)
    s = s.replace(/[^0-9a-z가-힣]/g, '');

    return s;
  }

  return { normalize: normalize };
});
