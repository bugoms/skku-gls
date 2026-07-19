/*
 * [ISOLATED] 에브리타임 강의평 자동 연결 (경로 B).
 *
 * GLS 확장앱의 [강의평] 버튼이 아래 형태로 새 탭을 연다:
 *   https://everytime.kr/lecture/search?keyword=<과목명>&condition=name
 *     #gls=1&prof=<교수명>&code=<학수번호>&name=<과목명>
 *
 * 이 스크립트는 검색 결과 페이지 위에서:
 *   1) (지연로딩 대응) 결과 목록을 스크롤로 끝까지 로드한 뒤
 *   2) lecture/view 링크들을 훑어 교수명이 일치하는 강의가 "정확히 1개"면 그 강의평으로 자동 이동 + id 캐싱
 *   3) 여러 개/없음이면 후보 하이라이트 + 배너, 그리고 콘솔에 전체 링크·행텍스트를 찍어 진단 가능하게 함
 *
 * 근거: docs/api-notes.md. 캐시는 확장앱과 공유(chrome.storage.local).
 */
(function () {
  'use strict';
  var TAG = '[GLS-ET]';

  function norm(s) { return String(s == null ? '' : s).replace(/\s+/g, '').toLowerCase(); }

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
  if (!target || !/\/lecture\/search/.test(location.pathname)) return;

  var prof = target.prof || '', code = target.code || '', name = target.name || '';
  var profTokens = prof.split(/[,/·、;]+/).map(norm).filter(Boolean);
  var primary = profTokens[0] || '';
  if (!primary) { banner('info', '교수명 정보가 없어 자동 선택을 건너뜁니다. 목록에서 직접 선택하세요.'); return; }

  console.log(TAG, '자동연결 시작 — 교수:', prof, '(정규화:', primary + ') / 과목:', name);

  /* ---- 지연로딩 대응: 스크롤로 끝까지 로드 후 매칭 ---- */
  function collect() { return Array.prototype.slice.call(document.querySelectorAll('a[href*="/lecture/view/"]')); }
  function scrollDown() {
    try {
      var h = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
      window.scrollTo(0, h);
      if (document.scrollingElement) document.scrollingElement.scrollTop = h;
      // 스크롤 리스너 기반 무한스크롤도 깨우기
      window.dispatchEvent(new Event('scroll'));
    } catch (e) {}
  }

  var lastN = -1, stable = 0, tries = 0, MAX = 40;
  var iv = setInterval(function () {
    tries++;
    var n = collect().length;
    scrollDown();
    if (n > 0 && n === lastN) stable++; else stable = 0;
    lastN = n;
    // 개수가 3틱 연속 안 변하면(=끝까지 로드됨) 또는 타임아웃 → 매칭
    if ((n > 0 && stable >= 3) || tries >= MAX) {
      clearInterval(iv);
      try { window.scrollTo(0, 0); } catch (e) {}
      if (n > 0) pick(collect());
      else banner('warn', '결과를 불러오지 못했어요. 로그인 상태·검색어를 확인한 뒤 목록에서 직접 선택하세요.');
    }
  }, 300);

  function idOf(a) {
    var m = (a.getAttribute('href') || a.href || '').match(/\/lecture\/view\/(\d+)/);
    return m ? m[1] : '';
  }
  // 링크가 감싼 "한 강의" 카드의 텍스트 — 교수명이 링크 바깥에 있을 수 있어 조상까지 넓히되,
  // 조상이 다른 강의 링크까지 품으면(이웃 강의 텍스트가 섞임) 거기서 중단.
  function rowText(a) {
    var el = a, best = a.textContent || '', hop = 0;
    while (hop < 4 && el.parentElement) {
      var p = el.parentElement;
      if (p.querySelectorAll('a[href*="/lecture/view/"]').length > 1) break;
      el = p; hop++;
      best = el.textContent || best;
    }
    return norm(best);
  }

  function go(x) { cacheAndGo(x.id, x.a.href || ('/lecture/view/' + x.id)); }

  function pick(anchors) {
    var seen = {}, list = [];
    anchors.forEach(function (a) { var id = idOf(a); if (id && !seen[id]) { seen[id] = 1; list.push({ a: a, id: id, txt: rowText(a) }); } });

    var nameNorm = norm(name);
    list.forEach(function (x) {
      x.hasProf = !!(primary && x.txt.indexOf(primary) >= 0);
      x.hasName = !!(nameNorm && x.txt.indexOf(nameNorm) >= 0);
      // 카드 텍스트에서 '과목명 끝 ~ 교수명 시작' 간격(글자수). 작을수록 과목명이 정확히 일치.
      //   "논리회로설계|국태용" → 0,  "논리회로설계|실험국태용" → 2  ⇒ 정확한 쪽이 더 작다.
      //   (에타 링크가 교수명까지 감싸도, 링크 밖 DOM 구조와 무관하게 동작)
      var ni = x.txt.indexOf(nameNorm), pi = x.txt.indexOf(primary);
      x.gap = (nameNorm && primary && ni >= 0 && pi >= ni + nameNorm.length) ? (pi - (ni + nameNorm.length)) : 9999;
      x.lead = ni < 0 ? 9999 : ni; // 과목명이 카드 앞쪽일수록(접두어 다른 과목 배제) 우선
    });

    // 진단 로그
    console.log(TAG, '발견한 강의 링크', list.length, '개 (과목="' + name + '", 교수="' + primary + '")');
    list.forEach(function (x) { console.log('   view/' + x.id, '｜', x.txt.slice(0, 70), (x.hasName ? '[과목]' : ''), (x.hasProf ? '[교수]' : ''), 'gap=' + (x.gap === 9999 ? '-' : x.gap)); });

    // 1순위: 교수 + 과목명 둘 다 일치. 여러 개면 '과목명↔교수 간격'이 가장 작은(=과목명이 정확한) 하나.
    //   논리회로설계 클릭 시 논리회로설계실험(간격 큼)보다 논리회로설계(간격 0)를 고른다. 동점이면 사용자 선택.
    var both = list.filter(function (x) { return x.hasProf && x.hasName; });
    if (both.length) {
      both.sort(function (a, b) { return (a.gap - b.gap) || (a.lead - b.lead); });
      var t0 = both[0];
      var tie = both.filter(function (x) { return x.gap === t0.gap && x.lead === t0.lead; });
      if (tie.length === 1) { go(t0); return; }
      highlight(tie); banner('info', '"' + name + ' · ' + prof + '" 강의가 여러 개예요. 맞는 강의를 클릭하세요.'); return;
    }

    // 2순위(폴백): 교수만 — 에타 과목명이 GLS와 크게 다를 때(외국인 교수/음차 표기 등)
    var loose = list.filter(function (x) { return x.hasProf; });
    if (loose.length === 1) { go(loose[0]); return; }
    if (loose.length > 1) { highlight(loose); banner('info', '"' + prof + '" 교수님 강의가 여러 개예요. 맞는 강의를 클릭하세요.'); return; }

    highlightAll(list);
    banner('warn', '"' + prof + '" 교수님 강의를 자동으로 못 찾았어요. 목록에서 직접 선택하세요. (콘솔 [GLS-ET] 로그 참고)');
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

  /* ---- 배너 / 하이라이트 (inline style만) ---- */
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
      setTimeout(function () { if (d.parentNode) d.remove(); }, 7000);
    } catch (e) {}
  }
  function outline(el, color) { try { el.style.outline = '2px solid ' + color; el.style.outlineOffset = '2px'; el.style.borderRadius = '6px'; } catch (e) {} }
  function highlight(cands) { cands.forEach(function (c, i) { outline(c.a, '#e8453c'); if (i === 0 && c.a.scrollIntoView) try { c.a.scrollIntoView({ block: 'center' }); } catch (e) {} }); }
  function highlightAll(list) { list.forEach(function (x) { outline(x.a, '#c9a', ''); }); }

  console.log(TAG, '준비 완료 — 스크롤 로딩 후 매칭합니다.');
})();
