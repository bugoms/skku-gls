/*
 * [ISOLATED world] content script. 근거: plan.md §6, §7.
 *  - 단일 화면: 왼쪽=검색/정보, 오른쪽=내 시간표(항상 표시, 추가한 과목 누적·자동 저장).
 *  - 검색 인덱스는 내장 데이터(background 시드)만 사용 — 페이지 수집 없음.
 *  - 설치 직후 기본값: 패널 열림 + 빈 시간표. 툴바 아이콘/🔎/Ctrl+K 로 토글.
 */
(function () {
  'use strict';
  if (window.__glsExtContentLoaded) return;
  window.__glsExtContentLoaded = true;

  var SCHED = window.GLS_SCHEDULE;
  var MYTABLE_KEY = 'gls_mytable';
  var PANEL_OPEN_KEY = 'gls_panel_open';
  var myTable = [];
  var lastResults = [];

  var MENU_LABEL = { '교양': '학사-교양/기타과목', '기타': '학사-교양/기타과목', '전공': '학사-전공과목', 'DS': '학사-DS과목' };
  function menuLabelFor(t) { return t ? (MENU_LABEL[t] || ('학사-' + t)) : '전자시간표'; }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  /* ---------- 툴바 아이콘 클릭 → 패널 토글 ---------- */
  chrome.runtime.onMessage.addListener(function (msg) {
    if (msg && msg.type === 'togglePanel') togglePanel();
  });

  /* ================= UI ================= */
  var host = document.createElement('div');
  host.id = 'gls-ext-host';
  host.style.cssText = 'all:initial; position:fixed; z-index:2147483647;';
  var shadow = host.attachShadow({ mode: 'open' });
  document.documentElement.appendChild(host);

  // Pretendard 를 FontFace API 로 등록(콘텐츠 스크립트 fetch 는 페이지 CSP 영향을 받지 않음).
  // document.fonts 에 등록하면 Shadow DOM 안에서도 'Pretendard GLS' 로 사용 가능.
  try {
    fetch(chrome.runtime.getURL('fonts/PretendardVariable.woff2'))
      .then(function (r) { return r.arrayBuffer(); })
      .then(function (buf) { return new FontFace('Pretendard GLS', buf, { weight: '100 900' }).load(); })
      .then(function (f) { if (f) document.fonts.add(f); })
      .catch(function () {});
  } catch (e) {}

  shadow.innerHTML = [
    '<style>',
    ':host{ --green:#0f7c3f; --green-d:#0b6a34; --lime:#8bc53f; --blue:#eaeef7; --mint:#eef6ef; --mint-bd:#d7e8db; --orange:#e5720b; --prof:#2f9757; --line:#e2e2e2; --ink:#232323; --muted:#6b6b6b; --red:#d94b4b; }',
    '*{ box-sizing:border-box; font-family:"Pretendard GLS","Pretendard",-apple-system,"Apple SD Gothic Neo","Malgun Gothic",sans-serif; }',
    '.fab{ position:fixed; right:20px; bottom:20px; width:52px; height:52px; border-radius:50%; background:var(--green); color:#fff; border:none; cursor:pointer; font-size:22px; box-shadow:0 4px 14px rgba(0,0,0,.28); }',
    '.fab:hover{ background:var(--green-d); }',
    '.panel{ position:fixed; right:16px; bottom:82px; width:min(1180px, calc(100vw - 32px)); height:min(660px, calc(100vh - 110px)); background:#fff; color:var(--ink); border-radius:12px; box-shadow:0 12px 46px rgba(0,0,0,.32); display:none; flex-direction:column; overflow:hidden; border:1px solid var(--line); }',
    '.panel.open{ display:flex; }',
    '.head{ position:relative; padding:13px 44px; background:#fff; display:flex; align-items:center; justify-content:center; border-bottom:1px solid var(--line); }',
    '.head .t{ font-weight:700; font-size:15px; letter-spacing:-.3px; color:var(--green); }',
    '.head .x{ position:absolute; right:12px; top:50%; transform:translateY(-50%); cursor:pointer; font-size:20px; background:none; border:none; color:#aaa; }',
    '.head .x:hover{ color:#555; }',
    '.mainview{ flex:1; display:flex; min-height:0; }',
    '.leftcol{ flex:0 0 460px; display:flex; flex-direction:column; border-right:1px solid var(--line); min-height:0; }',
    '.rightcol{ flex:1; display:flex; flex-direction:column; min-height:0; }',
    '.rchead{ display:flex; align-items:center; gap:8px; padding:9px 12px; background:#fff; border-bottom:1px solid var(--line); }',
    '.rchead .rt{ font-weight:700; font-size:13px; color:var(--ink); flex:1; }',
    '.rchead .clear{ font-size:12px; border:1px solid var(--red); color:var(--red); background:#fff; border-radius:8px; padding:5px 10px; cursor:pointer; }',
    '.rchead .clear:hover{ background:var(--red); color:#fff; }',
    '.ttscroll{ flex:1; overflow:auto; padding:10px 12px; }',
    '.searchbar{ padding:10px 12px; background:#EFEFEF; border-bottom:1px solid var(--line); display:flex; gap:8px; }',
    '.searchbar input{ flex:1; padding:9px 11px; border:1px solid #c7cede; border-radius:8px; font-size:14px; outline:none; background:#fff; color:var(--ink); }',
    '.searchbar input:focus{ border-color:var(--green); }',
    '.searchbar select{ padding:8px; border:1px solid #c7cede; border-radius:8px; font-size:12px; background:#fff; color:var(--ink); }',
    '.results{ overflow-y:auto; padding:6px; flex:1; }',
    '.card{ border:1px solid var(--line); border-radius:10px; padding:10px 12px; margin:6px 4px; background:#fff; }',
    '.crow{ display:flex; gap:8px; align-items:flex-start; }',
    '.cinfo{ flex:1; min-width:0; }',
    '.card .nm{ font-weight:700; font-size:14px; color:var(--ink); } .card .cs{ color:var(--orange); font-weight:700; font-size:12px; margin-left:6px; }',
    '.card .meta{ color:var(--muted); font-size:12px; margin-top:3px; } .card .meta .prof{ color:var(--prof); font-weight:600; }',
    '.area{ margin-top:8px; padding:8px 10px; background:var(--mint); border-left:3px solid var(--green); border-radius:0 8px 8px 0; }',
    '.area .amenu{ display:block; font-size:11px; color:var(--muted); margin-bottom:2px; }',
    '.area .aname{ display:block; font-size:15px; font-weight:700; color:var(--green-d); letter-spacing:-.2px; }',
    '.area .asub{ display:block; font-size:12px; font-weight:600; color:var(--green); margin-top:2px; }',
    '.area .adept{ display:block; font-size:13.5px; font-weight:700; color:var(--green-d); letter-spacing:-.2px; margin-top:2px; }',
    '.area .adept .adsub{ font-size:12px; font-weight:600; color:var(--green); }',
    '.area .dept-toggle{ display:inline-flex; align-items:center; gap:5px; margin-top:5px; padding:3px 9px; font-size:12px; font-weight:600; color:var(--green-d); background:#fff; border:1px solid var(--mint-bd); border-radius:7px; cursor:pointer; }',
    '.area .dept-toggle:hover{ background:var(--mint); }',
    '.area .dept-toggle .dt-count{ min-width:15px; text-align:center; color:#fff; background:var(--green); border-radius:9px; padding:0 5px; font-size:11px; font-weight:700; }',
    '.area .dept-toggle .dt-chev{ font-size:9px; line-height:1; transition:transform .15s; }',
    '.area .dept-toggle.open .dt-chev{ transform:rotate(180deg); }',
    '.area .dept-list{ display:none; margin-top:6px; padding:7px 9px; background:#fff; border:1px solid var(--mint-bd); border-radius:8px; }',
    '.area .dept-list.open{ display:block; }',
    '.area .dept-list .adept:first-child{ margin-top:0; }',
    '.actions{ display:flex; flex-wrap:wrap; justify-content:flex-end; gap:5px; flex:0 0 auto; }',
    '.actions button{ font-size:11px; padding:5px 9px; border:1px solid var(--green); color:var(--green); background:#fff; border-radius:8px; cursor:pointer; font-weight:600; white-space:nowrap; }',
    '.actions button:hover{ background:var(--green); color:#fff; }',
    '.actions button:disabled{ opacity:.6; cursor:default; }',
    '.actions button.added{ background:var(--green); color:#fff; }',
    '.actions .bag{ border-color:var(--mint-bd); color:var(--green-d); background:var(--mint); display:inline-flex; align-items:center; gap:4px; }',
    '.actions .bag:hover{ background:#e3efe4; color:var(--green-d); border-color:var(--lime); }',
    '.actions .bag svg{ width:13px; height:13px; color:var(--green); flex:0 0 auto; }',
    '.actions .review{ border-color:#fbeef1; color:#3d3d3d; background:#fbeef1; display:inline-flex; align-items:center; gap:5px; }',
    '.actions .review:hover{ background:#f6dde4; border-color:#f6dde4; }',
    '.actions .review svg{ width:13px; height:13px; color:#555; flex:0 0 auto; }',
    '.empty{ padding:26px 16px; text-align:center; color:#999; font-size:13px; line-height:1.6; }',
    '.foot{ border-top:1px solid var(--line); padding:8px 12px; font-size:11px; color:var(--muted); display:flex; justify-content:space-between; align-items:center; }',
    '.foot a{ color:var(--green); cursor:pointer; text-decoration:underline; }',
    /* 시간표 그리드 */
    '.tt{ border:1px solid #ececec; border-radius:6px; overflow:hidden; }',
    '.tt-head{ display:flex; background:#fff; border-bottom:1px solid #eee; }',
    '.tt-head .c{ flex:1; text-align:center; padding:5px 0; font-size:12px; color:#999; border-left:1px solid #f2f2f2; }',
    '.tt-head .g{ flex:0 0 30px; border-left:none; }',
    '.tt-body{ display:flex; position:relative; }',
    '.tt-g{ flex:0 0 30px; position:relative; }',
    '.tt-g .h{ position:absolute; right:5px; font-size:11px; color:#bbb; transform:translateY(-7px); }',
    '.tt-col{ flex:1; position:relative; border-left:1px solid #f2f2f2; }',
    '.tt-blk{ position:absolute; border-radius:4px; padding:5px 6px; overflow:hidden; box-sizing:border-box; color:#fff; }',
    '.tt-blk b{ display:block; font-size:12.5px; font-weight:700; line-height:1.22; }',
    '.tt-blk .p{ display:block; font-size:11px; line-height:1.2; opacity:.92; margin-top:1px; }',
    '.tt-blk .rm{ position:absolute; top:1px; right:1px; width:16px; height:16px; display:flex; align-items:center; justify-content:center; font-size:12px; line-height:1; padding:0; border:none; border-radius:3px; background:rgba(0,0,0,.2); color:#fff; cursor:pointer; opacity:0; }',
    '.tt-blk:hover .rm{ opacity:1; }',
    '.tt-empty{ font-size:12px; color:#999; padding:16px; text-align:center; }',
    '.tt-online{ margin-top:12px; border-top:1px solid #eee; padding-top:8px; }',
    '.tt-online .oltitle{ font-size:11px; color:var(--muted); font-weight:600; margin:0 2px 6px; }',
    '.ol-item{ position:relative; padding:8px 32px 8px 10px; margin:5px 0; background:#fafafa; border-radius:6px; }',
    '.ol-item .ol-nm{ font-weight:700; font-size:13px; color:var(--ink); }',
    '.ol-item .ol-sub{ display:block; font-size:11px; color:var(--muted); margin-top:1px; }',
    '.ol-item .rm{ position:absolute; top:50%; right:8px; transform:translateY(-50%); width:18px; height:18px; display:flex; align-items:center; justify-content:center; padding:0; line-height:1; border:none; border-radius:4px; background:#e6e6e6; color:#777; cursor:pointer; font-size:13px; }',
    '.ol-item .rm:hover{ background:var(--red); color:#fff; }',
    '.toast{ position:fixed; right:20px; bottom:150px; background:#232323; color:#fff; padding:10px 14px; border-radius:9px; font-size:13px; box-shadow:0 4px 14px rgba(0,0,0,.3); display:none; max-width:340px; white-space:pre-line; }',
    '</style>',
    '<button class="fab" title="과목 위치 찾기 (Ctrl+K)">🔎</button>',
    '<div class="panel">',
    '  <div class="head"><span class="t">GLS 과목 위치 찾기</span><button class="x" title="닫기">×</button></div>',
    '  <div class="mainview">',
    '    <div class="leftcol">',
    '      <div class="searchbar"><input type="text" placeholder="과목명 / 학수번호 / 교수명" /><select class="campus"><option value="">전체</option></select></div>',
    '      <div class="results"></div>',
    '      <div class="foot"><span class="cnt">과목 0개</span><a class="refresh">새로고침</a></div>',
    '    </div>',
    '    <div class="rightcol">',
    '      <div class="rchead"><span class="rt">내 시간표 (0과목)</span><button class="clear">전체 비우기</button></div>',
    '      <div class="ttscroll"></div>',
    '    </div>',
    '  </div>',
    '</div>',
    '<div class="toast"></div>'
  ].join('');

  var $ = function (s) { return shadow.querySelector(s); };
  var elFab = $('.fab'), elPanel = $('.panel'), elClose = $('.x');
  var elInput = $('input'), elCampus = $('.campus'), elResults = $('.results');
  var elCnt = $('.foot .cnt'), elRefresh = $('.refresh'), elToast = $('.toast');
  var elTtScroll = $('.ttscroll'), elRt = $('.rt'), elClear = $('.clear');

  /* ---------- 열기/닫기 (상태 저장, 기본값 열림) ---------- */
  function setOpen(open, focus) {
    elPanel.classList.toggle('open', open);
    try { var o = {}; o[PANEL_OPEN_KEY] = open; chrome.storage.local.set(o); } catch (e) {}
    if (open) { refreshStats(); if (focus !== false) elInput.focus(); }
  }
  function togglePanel() { setOpen(!elPanel.classList.contains('open'), true); }
  elFab.addEventListener('click', togglePanel);
  elClose.addEventListener('click', function () { setOpen(false); });
  elRefresh.addEventListener('click', function () { refreshStats(); runSearch(); });
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); togglePanel(); }
    else if (e.key === 'Escape' && elPanel.classList.contains('open')) setOpen(false);
  });
  elClear.addEventListener('click', function () {
    if (!myTable.length || !confirm('내 시간표를 모두 비울까요?')) return;
    myTable = []; saveMyTable(); renderTimetable(); refreshAddedButtons();
  });

  var toastTimer = null;
  function toast(msg) {
    elToast.textContent = msg; elToast.style.display = 'block';
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { elToast.style.display = 'none'; }, 2600);
  }

  /* ---------- 검색 ---------- */
  var searchTimer = null;
  elInput.addEventListener('input', function () { if (searchTimer) clearTimeout(searchTimer); searchTimer = setTimeout(runSearch, 220); });
  elCampus.addEventListener('change', runSearch);

  // "해당 전공 보기" 드롭다운 토글 (위임 — 재검색으로 카드가 새로 그려져도 유지).
  elResults.addEventListener('click', function (e) {
    var t = (e.target && e.target.closest) ? e.target.closest('.dept-toggle') : null;
    if (!t) return;
    var list = t.parentElement && t.parentElement.querySelector('.dept-list');
    if (!list) return;
    var open = !list.classList.contains('open');
    list.classList.toggle('open', open);
    t.classList.toggle('open', open);
    t.setAttribute('aria-expanded', open ? 'true' : 'false');
    var lbl = t.querySelector('.dt-label'); if (lbl) lbl.textContent = open ? '해당 전공 숨기기' : '해당 전공 보기';
  });
  function runSearch() {
    var q = elInput.value.trim();
    if (!q) { elResults.innerHTML = emptyHtml(); return; }
    chrome.runtime.sendMessage({ type: 'search', query: q, opts: { campus: elCampus.value || undefined, limit: 40 } },
      function (resp) { render((resp && resp.results) || []); });
  }
  function emptyHtml() {
    return '<div class="empty">과목명·학수번호·교수명으로 검색하세요.<br>찾은 과목을 [추가하기] 하면 오른쪽 시간표에 쌓입니다.</div>';
  }

  // 최신 학번 기준(2020학번이후)만 남긴다.
  function latestAreas(areas) {
    if (!areas || !areas.length) return [];
    var after = areas.filter(function (a) { return a.cohort && a.cohort.indexOf('이후') > -1; });
    if (after.length) return after;
    var notPrev = areas.filter(function (a) { return !(a.cohort && a.cohort.indexOf('이전') > -1); });
    return notPrev.length ? notPrev : areas;
  }
  // 영역 박스: 위(메뉴 경로) / 큰글씨(주된 영역) / 작은글씨(세부, 선택).
  function areaBox(menu, big, sub) {
    var h = '<div class="area"><span class="amenu">' + esc(menu) + '</span>';
    if (big) h += '<span class="aname">' + esc(big) + '</span>';
    if (sub) h += '<span class="asub">' + esc(sub) + '</span>';
    return h + '</div>';
  }
  // "이 과목이 GLS 어느 메뉴/영역에 있는지" 를 계열별로 표시.
  function deptLine(d) {
    var sub = d.sub ? ' <span class="adsub">' + esc(d.sub) + '</span>' : '';
    return '<span class="adept">' + esc(d.college + '-' + d.major) + sub + '</span>';
  }
  function areaHtml(course) {
    var isu = course.isuType || '';

    // 전공 계열: 학사-전공과목. 학과 1개면 인라인, 여러 개면 경로만 + "해당 전공 보기" 드롭다운.
    if (/전공|실험실습/.test(isu)) {
      var depts = course.depts || [];
      if (!depts.length) return areaBox('학사-전공과목', isu, '');   // 조인 실패 폴백
      if (depts.length === 1) {
        return '<div class="area"><span class="amenu">학사-전공과목</span>' + deptLine(depts[0]) + '</div>';
      }
      var items = depts.map(deptLine).join('');
      if (course.deptMore > 0) items += '<span class="asub">외 ' + course.deptMore + '개 학과</span>';
      return '<div class="area"><span class="amenu">학사-전공과목</span>' +
        '<button type="button" class="dept-toggle" aria-expanded="false">' +
          '<span class="dt-label">해당 전공 보기</span><span class="dt-count">' + depts.length + '</span>' +
          '<span class="dt-chev" aria-hidden="true">▾</span>' +
        '</button>' +
        '<div class="dept-list">' + items + '</div>' +
      '</div>';
    }
    // DS 계열: 학사-DS과목 → 기반/심화 + 계열
    if (/^DS/.test(isu)) {
      var base = isu.indexOf('심화') > -1 ? 'DS 심화' : 'DS 기반';
      var gm = isu.match(/\(([^)]+)\)/);
      return areaBox('학사-DS과목', base, gm ? gm[1] : '');
    }
    // 교양/기타/교직: review 조인 정답 영역(gyoAreas) 우선 — 여러 영역이면 세로 나열.
    //  (INFORM 파싱은 부정확: 글로벌(필수)→글로벌, 외국인전용 식별불가 등 → gyoAreas가 정답)
    var gyo = course.gyoAreas || [];
    if (gyo.length) {
      return '<div class="area"><span class="amenu">학사-교양/기타과목</span>' +
        gyo.map(function (a) { return '<span class="aname">' + esc(a) + '</span>'; }).join('') +
        '</div>';
    }
    // 폴백: review에 없을 때만 INFORM 영역(2020학번이후) 파싱 사용.
    var list = latestAreas(course.areas);
    if (list.length) {
      return list.map(function (a) { return areaBox('학사-교양/기타과목', a.area, ''); }).join('');
    }
    if (isu === '교직' || isu === '교양' || isu === '기타') return areaBox('학사-교양/기타과목', '기타과목', '');

    // 그 외: 경로만 표시("영역 정보 없음" 문구는 쓰지 않음)
    return areaBox(menuLabelFor(isu), '', '');
  }

  // GLS "담기" 스타일 아이콘 (내려담기 — 트레이로 화살표).
  var BAG_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v9"/><path d="M8.5 8.5 12 12l3.5-3.5"/><path d="M4 14v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/></svg>';
  // 강의평 아이콘 — 말풍선 2개(후기/댓글).
  var REVIEW_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 9a2 2 0 0 1-2 2H6l-4 4V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2Z"/><path d="M18 9h2a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-1"/></svg>';

  function render(results) {
    lastResults = results;
    if (!results.length) { elResults.innerHTML = '<div class="empty">검색 결과가 없어요.<br>아직 해당 영역을 안 둘러봤을 수 있어요.</div>'; return; }
    elResults.innerHTML = results.map(function (c, i) {
      var meta = [];
      if (c.professor) meta.push('<span class="prof">' + esc(c.professor) + '</span>');
      if (c.credits) meta.push(esc(c.credits + '학점'));
      if (c.campus) meta.push(esc(c.campus));
      if (c.schedule) meta.push(esc(c.schedule));
      var added = isInMyTable(c);
      return '<div class="card">' +
        '<div class="crow">' +
          '<div class="cinfo">' +
            '<div><span class="nm">' + esc(c.name) + '</span><span class="cs">' + esc(c.codeSection || (c.code + '-' + c.section)) + '</span></div>' +
            '<div class="meta">' + meta.join(' · ') + '</div>' +
          '</div>' +
          '<div class="actions">' +
            '<button data-add="' + i + '" class="' + (added ? 'added' : '') + '">' + (added ? '✓ 추가됨' : '추가하기') + '</button>' +
            '<button data-bag="' + i + '" class="bag" title="GLS 책가방에 담기">' + BAG_ICON + '담기</button>' +
            '<button data-review="' + i + '" class="review" title="에브리타임 강의평 보기">' + REVIEW_ICON + '강의평</button>' +
          '</div>' +
        '</div>' + areaHtml(c) +
        '</div>';
    }).join('');
    Array.prototype.forEach.call(elResults.querySelectorAll('button[data-add]'), function (btn) {
      btn.addEventListener('click', function () { toggleMyTable(results[+btn.getAttribute('data-add')], btn); });
    });
    Array.prototype.forEach.call(elResults.querySelectorAll('button[data-bag]'), function (btn) {
      btn.addEventListener('click', function () { onBagClick(results[+btn.getAttribute('data-bag')], btn); });
    });
    Array.prototype.forEach.call(elResults.querySelectorAll('button[data-review]'), function (btn) {
      btn.addEventListener('click', function () { openReview(results[+btn.getAttribute('data-review')]); });
    });
  }

  /* ---------- GLS 책가방 담기 (MAIN world bag-bridge 와 CustomEvent 통신) ---------- */
  var bagSeq = 0, bagCbs = {};
  document.addEventListener('gls-bag-res', function (ev) {
    var d; try { d = JSON.parse(ev.detail); } catch (e) { return; }
    if (!d) return;
    var cb = bagCbs[d.reqId]; if (cb) { delete bagCbs[d.reqId]; cb(d); }
  });
  function requestBag(course, action, cb) {
    var id = ++bagSeq; bagCbs[id] = cb;
    document.dispatchEvent(new CustomEvent('gls-bag-req', { detail: JSON.stringify({
      reqId: id, action: action,
      course: { year: course.year, term: course.term, code: course.code, section: course.section, name: course.name }
    }) }));
    setTimeout(function () { if (bagCbs[id]) { delete bagCbs[id]; cb({ ok: false, msg: '응답 없음 — 전자시간표 화면에서 시도해 주세요.' }); } }, 7000);
  }
  function onBagClick(course, btn) {
    var cs = course.codeSection || (course.code + '-' + course.section);
    if (!confirm('"' + course.name + ' ' + cs + '" 을(를) GLS 책가방에 담을까요?')) return;
    var prev = btn.innerHTML; btn.disabled = true; btn.textContent = '담는 중…';
    requestBag(course, 'add', function (res) {
      btn.disabled = false;
      if (res.ok) {
        // 성공 결과는 GLS 자체 팝업이 보여주므로 별도 토스트 없이 버튼만 잠깐 표시.
        btn.textContent = '✓ 담김';
        setTimeout(function () { btn.innerHTML = prev; }, 1400);
      } else {
        btn.innerHTML = prev;
        toast('책가방 담기 실패: ' + res.msg);
      }
    });
  }
  /* ---------- 에브리타임 강의평 바로가기 (경로 B: 검색딥링크 → everytime-link.js 자동선택 → id 캐싱) ---------- */
  var etCache = {};   // { "<학수번호>|<정규화교수명>": "<everytime lecture id>" }  (everytime-link.js 가 채움)
  try {
    chrome.storage.local.get('gls_et_cache', function (o) { if (o && o.gls_et_cache) etCache = o.gls_et_cache; });
    chrome.storage.onChanged.addListener(function (ch, area) {
      if (area === 'local' && ch.gls_et_cache) etCache = ch.gls_et_cache.newValue || {};
    });
  } catch (e) {}
  function normProf(s) { return String(s == null ? '' : s).replace(/\s+/g, '').toLowerCase(); }
  function openReview(course) {
    var prof = course.professor || '', code = course.code || '', name = course.name || '';
    // 캐시 적중 → 그 교수 강의평 페이지로 바로. (동기 처리라 팝업차단 안 걸림)
    var id = (prof && code) ? etCache[code + '|' + normProf(prof)] : '';
    var url;
    if (id) {
      url = 'https://everytime.kr/lecture/view/' + encodeURIComponent(id);
    } else {
      // 과목명으로 검색 + 우리 마커(교수/학수번호/과목명) → everytime-link.js 가 교수 매칭해 자동 이동.
      url = 'https://everytime.kr/lecture/search?keyword=' + encodeURIComponent(name) + '&condition=name';
      if (prof) {
        url += '#gls=1&prof=' + encodeURIComponent(prof) +
               '&code=' + encodeURIComponent(code) +
               '&name=' + encodeURIComponent(name);
      }
    }
    window.open(url, '_blank', 'noopener');
  }

  function refreshAddedButtons() {
    Array.prototype.forEach.call(elResults.querySelectorAll('button[data-add]'), function (btn) {
      var c = lastResults[+btn.getAttribute('data-add')]; var added = isInMyTable(c);
      btn.classList.toggle('added', added); btn.textContent = added ? '✓ 추가됨' : '추가하기';
    });
  }

  /* ---------- 내 시간표 ---------- */
  function keyOf(c) { return c.id || (c.yearTerm + '|' + c.code + '|' + c.section); }
  function creditOf(c) { var m = String(c && c.credits || '').match(/(\d+(?:\.\d+)?)/); return m ? parseFloat(m[1]) : 0; }
  function totalCredits() { return myTable.reduce(function (s, c) { return s + creditOf(c); }, 0); }
  function isInMyTable(c) { var k = keyOf(c); return myTable.some(function (x) { return keyOf(x) === k; }); }
  function loadMyTable(cb) { chrome.storage.local.get([MYTABLE_KEY], function (d) { myTable = (d && d[MYTABLE_KEY]) || []; if (cb) cb(); }); }
  function saveMyTable() { var o = {}; o[MYTABLE_KEY] = myTable; chrome.storage.local.set(o); }

  function conflictWith(course) {
    var nb = SCHED ? SCHED.parseSchedule(course.schedule) : [];
    if (!nb.length) return null;
    for (var i = 0; i < myTable.length; i++) {
      var eb = SCHED ? SCHED.parseSchedule(myTable[i].schedule) : [];
      for (var a = 0; a < nb.length; a++) for (var b = 0; b < eb.length; b++) {
        if (nb[a].day === eb[b].day && nb[a].startMin < eb[b].endMin && eb[b].startMin < nb[a].endMin)
          return { existing: myTable[i], day: eb[b].day, start: eb[b].startMin, end: eb[b].endMin };
      }
    }
    return null;
  }

  function toggleMyTable(course, btn) {
    var k = keyOf(course);
    if (isInMyTable(course)) { myTable = myTable.filter(function (x) { return keyOf(x) !== k; }); toast('내 시간표에서 제거'); }
    else {
      var cf = conflictWith(course);
      if (cf) {
        window.alert('⚠ 시간이 겹쳐 추가할 수 없습니다.\n\n이미 담은 "' + cf.existing.name + '" (' + (cf.existing.codeSection || '') + ')\n' +
          cf.day + ' ' + fmtMin(cf.start) + '-' + fmtMin(cf.end) + ' 과(와) 겹칩니다.\n\n기존 과목을 우선합니다. 바꾸려면 기존 과목을 먼저 지우세요.');
        return;
      }
      if (!course._color) course._color = pickColor();   // 추가 시점에 고정 색 배정(삭제해도 안 바뀜)
      myTable.push(course); toast('내 시간표에 추가: ' + course.name);
    }
    saveMyTable();
    if (btn) { var added = isInMyTable(course); btn.classList.toggle('added', added); btn.textContent = added ? '✓ 추가됨' : '추가하기'; }
    renderTimetable();
  }
  function removeFromMyTable(k) { myTable = myTable.filter(function (x) { return keyOf(x) !== k; }); saveMyTable(); renderTimetable(); refreshAddedButtons(); }

  /* ---------- 시간표 그리드 (에브리타임 스타일) ---------- */
  var PALETTE = ['#f0837a', '#52c0ac', '#efc15a', '#6aa6e0', '#93c85b', '#f5a94f', '#b292d6', '#ec8cae', '#4fc3d6', '#c9a66b'];
  // 현재 시간표에서 안 쓰인 색을 우선 반환(다 쓰였으면 가장 적게 쓰인 색). 과목별 색은 한 번 정하면 유지.
  function pickColor() {
    var used = {};
    myTable.forEach(function (c) { if (c._color) used[c._color] = (used[c._color] || 0) + 1; });
    var best = PALETTE[0], bn = Infinity;
    for (var i = 0; i < PALETTE.length; i++) {
      var n = used[PALETTE[i]] || 0;
      if (n === 0) return PALETTE[i];
      if (n < bn) { bn = n; best = PALETTE[i]; }
    }
    return best;
  }
  function fmtMin(m) { var h = Math.floor(m / 60), mm = m % 60; return (h < 10 ? '0' + h : h) + ':' + (mm < 10 ? '0' + mm : mm); }
  function hourLabel(h) { return h > 12 ? h - 12 : h; }  // 12시간제 표기

  function timetableHtml() {
    // 과목별 고정 색(추가 시 배정·저장). 옛 데이터(_color 없음)는 여기서 한 번 배정 후 저장.
    var colorByKey = {}, migrated = false;
    myTable.forEach(function (c) {
      if (!c._color) { c._color = pickColor(); migrated = true; }
      colorByKey[keyOf(c)] = c._color;
    });
    if (migrated) saveMyTable();

    // 시간 있는 과목 / 없는 과목(온라인·아이캠퍼스) 분리
    var all = [], untimed = [];
    myTable.forEach(function (c) {
      var blks = SCHED ? SCHED.parseSchedule(c.schedule) : [];
      if (!blks.length) { untimed.push(c); return; }
      var color = colorByKey[keyOf(c)];
      blks.forEach(function (b) {
        all.push({ day: b.day, startMin: b.startMin, endMin: b.endMin, name: c.name, prof: c.professor, color: color, key: keyOf(c) });
      });
    });

    // 시간표 틀은 과목이 없어도 항상 표시(비워도 그대로 고정)
    return buildGrid(all) + onlineHtml(untimed, colorByKey);
  }

  function buildGrid(all) {
    // 기본 월~금, 주말 수업이 있으면 그때만 토/일 컬럼 추가
    var present = {}; all.forEach(function (b) { present[b.day] = true; });
    var cols = ['월', '화', '수', '목', '금'];
    ['토', '일'].forEach(function (d) { if (present[d]) cols.push(d); });

    var pxPerMin = 0.8, startH = 9, endH = 24;   // 오전 9시 ~ 자정
    var base = startH * 60, hourPx = 60 * pxPerMin, bodyH = (endH - startH) * 60 * pxPerMin;

    var head = '<div class="tt-head"><div class="c g"></div>' + cols.map(function (d) { return '<div class="c">' + d + '</div>'; }).join('') + '</div>';
    var gut = '';
    for (var h = startH; h <= endH; h++) gut += '<div class="h" style="top:' + ((h - startH) * hourPx) + 'px">' + hourLabel(h) + '</div>';

    var lineBg = 'background-image:repeating-linear-gradient(to bottom,#eee 0,#eee 1px,transparent 1px,transparent ' + hourPx + 'px);';
    var colHtml = cols.map(function (d) {
      var dayBlocks = all.filter(function (b) { return b.day === d; });
      var laid = SCHED ? SCHED.assignLanes(dayBlocks) : { blocks: dayBlocks, lanes: 1 };
      var lanes = laid.lanes;
      var blks = laid.blocks.map(function (b) {
        var top = Math.max(0, (b.startMin - base) * pxPerMin);
        var hgt = Math.max((b.endMin - b.startMin) * pxPerMin, 16);
        var wPct = 100 / lanes, leftPct = (b.lane || 0) * wPct;
        var prof = b.prof ? '<span class="p">' + esc(b.prof) + '</span>' : '';
        return '<div class="tt-blk" title="' + esc(b.name + (b.prof ? ' ' + b.prof : '') + ' ' + fmtMin(b.startMin) + '-' + fmtMin(b.endMin)) + '" ' +
          'style="top:' + top + 'px;height:' + hgt + 'px;left:calc(' + leftPct + '% + 1px);width:calc(' + wPct + '% - 2px);background:' + b.color + '">' +
          '<button class="rm" data-rm="' + esc(b.key) + '" title="제거">×</button>' +
          '<b>' + esc(b.name) + '</b>' + prof + '</div>';
      }).join('');
      return '<div class="tt-col" style="' + lineBg + '">' + blks + '</div>';
    }).join('');

    return '<div class="tt">' + head + '<div class="tt-body" style="height:' + bodyH + 'px"><div class="tt-g">' + gut + '</div>' + colHtml + '</div></div>';
  }

  // 시간 없는 과목(온라인/아이캠퍼스)을 시간표 아래에 목록으로
  function onlineHtml(untimed, colorByKey) {
    if (!untimed.length) return '';
    var items = untimed.map(function (c) {
      var col = colorByKey[keyOf(c)];
      var sub = [c.codeSection, c.professor].filter(Boolean).join(' · ');
      return '<div class="ol-item" style="border-left:4px solid ' + col + '">' +
        '<span class="ol-nm">' + esc(c.name) + '</span>' +
        '<span class="ol-sub">' + esc(sub) + '</span>' +
        '<button class="rm" data-rm="' + esc(keyOf(c)) + '" title="제거">×</button></div>';
    }).join('');
    return '<div class="tt-online"><div class="oltitle">온라인 · 아이캠퍼스</div>' + items + '</div>';
  }

  function renderTimetable() {
    var tc = totalCredits();
    var tcStr = (tc % 1 === 0) ? String(tc) : tc.toFixed(1);
    elRt.textContent = '내 시간표 (' + myTable.length + '과목 · ' + tcStr + '학점)';
    elTtScroll.innerHTML = timetableHtml();
    Array.prototype.forEach.call(elTtScroll.querySelectorAll('button[data-rm]'), function (btn) {
      btn.addEventListener('click', function (e) { e.stopPropagation(); removeFromMyTable(btn.getAttribute('data-rm')); });
    });
  }

  /* ---------- 현황 ---------- */
  function refreshStats() {
    chrome.runtime.sendMessage({ type: 'stats' }, function (meta) {
      if (!meta) return;
      elCnt.textContent = '과목 ' + (meta.total || 0) + '개';
      var current = elCampus.value, opts = ['<option value="">전체</option>'];
      Object.keys(meta.byCampus || {}).sort().forEach(function (cm) {
        opts.push('<option value="' + esc(cm) + '">' + esc(cm) + ' (' + meta.byCampus[cm] + ')</option>');
      });
      elCampus.innerHTML = opts.join(''); elCampus.value = current;
    });
  }

  // 초기화
  elResults.innerHTML = emptyHtml();
  loadMyTable(function () { renderTimetable(); });
  refreshStats();
  // 기본값: 열림. 사용자가 닫았으면 그 상태를 기억.
  chrome.storage.local.get([PANEL_OPEN_KEY], function (d) {
    var open = (d && typeof d[PANEL_OPEN_KEY] === 'boolean') ? d[PANEL_OPEN_KEY] : true;
    setOpen(open, false);
  });
  console.log('[GLS-Ext] content script 준비 완료');
})();
