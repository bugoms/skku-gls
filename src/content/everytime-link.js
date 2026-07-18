/*
 * [ISOLATED] 에브리타임 강의평 자동 연결 (경로 B).
 *
 * GLS 확장앱의 [강의평] 버튼이 아래 형태로 새 탭을 연다:
 *   https://everytime.kr/lecture/search?keyword=<과목명>&condition=name
 *     #gls=1&prof=<교수명>&code=<학수번호>&name=<과목명>
 *
 * 이 스크립트는 검색 결과 페이지 위에서:
 *   1) 렌더된 결과의 lecture/view 링크들을 훑고
 *   2) 교수명이 일치하는 강의가 "정확히 1개"면 그 강의평 페이지로 자동 이동(직결) + id 캐싱
 *   3) 여러 개/없음이면 후보 하이라이트 + 안내 배너(가짜 정밀도 방지 — 애매하면 목록 유지)
 *
 * 근거: docs/api-notes.md (에타 검색은 로그인 필요·비공식, 그래서 스크래핑 대신
 *       사용자 세션 위에서 DOM 매칭 → CORS·구조변경에 강함). 캐시는 확장앱과 공유(chrome.storage.local).
 */
(function () {
  'use strict';
  var TAG = '[GLS-ET]';

  function norm(s) { return String(s == null ? '' : s).replace(/\s+/g, '').toLowerCase(); }

  // 확장앱이 붙인 #gls=1&prof=..&code=..&name=.. 파싱
  function parseHash() {
    var h = (location.hash || '').replace(/^#/, '');
    if (!h) return null;
    var o = {};
    h.split('&').forEach(function (kv) {
      var i = kv.indexOf('='); if (i < 0) return;
      try { o[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1)); } catch (e) {}
    });
    return o.gls ? o : null;
  }

  var target = parseHash();
  // 검색 결과 페이지 + 우리 마커가 있을 때만 동작(그 외 lecture/view 등에서는 아무 것도 안 함)
  if (!target || !/\/lecture\/search/.test(location.pathname)) return;

  var prof = target.prof || '', code = target.code || '', name = target.name || '';
  var profTokens = prof.split(/[,/·、;]+/).map(norm).filter(Boolean);
  var primary = profTokens[0] || '';

  if (!primary) { banner('info', '교수명 정보가 없어 자동 선택을 건너뜁니다. 목록에서 직접 선택하세요.'); return; }

  // 결과가 비동기 렌더될 수 있으므로 잠깐 폴링(최대 ~6초)
  var tries = 0, MAX = 24;
  var iv = setInterval(function () {
    tries++;
    var anchors = collectAnchors();
    if (anchors.length) { clearInterval(iv); pick(anchors); }
    else if (tries >= MAX) { clearInterval(iv); banner('warn', '결과를 불러오지 못했어요. 로그인 상태·검색어를 확인한 뒤 목록에서 직접 선택하세요.'); }
  }, 250);

  function collectAnchors() {
    return Array.prototype.slice.call(document.querySelectorAll('a[href*="/lecture/view/"]'));
  }
  function idOf(a) {
    var m = (a.getAttribute('href') || a.href || '').match(/\/lecture\/view\/(\d+)/);
    return m ? m[1] : '';
  }
  // 링크 + 주변 행 텍스트(교수명이 링크 바깥에 있을 수 있어 조상까지 훑음)
  function rowText(a) {
    var t = a.textContent || '';
    var el = a, hop = 0;
    while (norm(t).length < 6 && el.parentElement && hop < 3) { el = el.parentElement; t = el.textContent || t; hop++; }
    return norm(t);
  }

  function pick(anchors) {
    // 교수 primary 토큰을 포함하는 링크만, id 기준 중복 제거
    var seen = {}, cands = [];
    anchors.forEach(function (a) {
      var id = idOf(a); if (!id || seen[id]) return;
      if (rowText(a).indexOf(primary) >= 0) { seen[id] = 1; cands.push({ a: a, id: id }); }
    });

    if (cands.length === 1) { cacheAndGo(cands[0].id, cands[0].a.href || ('/lecture/view/' + cands[0].id)); return; }
    if (cands.length > 1) { highlight(cands); banner('info', '"' + prof + '" 교수님 강의가 여러 개예요. 맞는 강의를 클릭하세요.'); return; }
    banner('warn', '"' + prof + '" 교수님 강의를 못 찾았어요. 목록에서 직접 선택하세요.');
  }

  function cacheAndGo(id, href) {
    var go = function () { try { location.replace(href); } catch (e) { location.href = href; } };
    if (!code || !prof) { go(); return; }
    var key = code + '|' + norm(prof);
    try {
      chrome.storage.local.get('gls_et_cache', function (o) {
        var c = (o && o.gls_et_cache) || {};
        c[key] = id;
        try { chrome.storage.local.set({ gls_et_cache: c }, go); } catch (e) { go(); }
      });
    } catch (e) { go(); }
  }

  /* ---- 안내 배너 / 하이라이트 (페이지 CSP 회피 위해 inline style만 사용) ---- */
  function banner(kind, msg) {
    try {
      var bg = kind === 'warn' ? '#8a3b12' : '#123a5c';
      var d = document.createElement('div');
      d.textContent = 'GLS 과목찾기 · ' + msg;
      var s = d.style;
      s.position = 'fixed'; s.left = '50%'; s.top = '14px'; s.transform = 'translateX(-50%)';
      s.zIndex = '2147483647'; s.background = bg; s.color = '#fff';
      s.padding = '10px 16px'; s.borderRadius = '10px'; s.fontSize = '13px';
      s.fontFamily = '-apple-system,"Malgun Gothic",sans-serif'; s.boxShadow = '0 6px 20px rgba(0,0,0,.35)';
      s.maxWidth = '90vw'; s.cursor = 'pointer';
      d.addEventListener('click', function () { d.remove(); });
      document.body.appendChild(d);
      setTimeout(function () { if (d.parentNode) d.remove(); }, 6000);
    } catch (e) {}
  }
  function highlight(cands) {
    cands.forEach(function (c, i) {
      try {
        var el = c.a;
        el.style.outline = '2px solid #e8453c';
        el.style.outlineOffset = '2px';
        el.style.borderRadius = '6px';
        if (i === 0 && el.scrollIntoView) el.scrollIntoView({ block: 'center' });
      } catch (e) {}
    });
  }

  console.log(TAG, '자동 연결 준비 — 교수:', prof, '/ 과목:', name);
})();
