/*
 * [ISOLATED] 에브리타임 시간표 연동 — GLS 확장앱 시간표를 에타 시간표에 등록.
 * 동작 페이지: https://everytime.kr/timetable/<year>/<semester>/<identifier>
 *
 * 흐름:
 *   1) GLS 시간표(활성 또는 FAB에서 선택)의 과목들을 에타 "강의 검색"(학수번호→과목명)으로 매칭.
 *   2) "넣을 에타 시간표"(같은 학기 안 시간표1/2/… 중 선택)의 기존 과목 id + 매칭 id 를 합쳐 "전체 저장".
 *      (에타 저장 API 는 전체 교체 방식 → 기존 과목을 반드시 함께 보냄)
 *   3) 매칭 실패 + 시간 있는 과목은 "직접 추가(커스텀)"로 폴백.
 *
 * 선택 UI:
 *   · FAB(에타에서 수동 클릭) → [내보낼 GLS 시간표] + [넣을 에타 시간표] 둘 다 선택 가능.
 *   · GLS 패널 "에타로 내보내기"에서 자동으로 넘어온 경우 → GLS는 활성 시간표 고정, [넣을 에타 시간표]만 선택.
 *
 * 인증: 에타 세션 쿠키(credentials:'include'). CSRF 없음. 쓰기 전 확인 모달 필수.
 * 근거: docs/api-notes.md §9.
 */
(function () {
  'use strict';
  if (window.__glsEtTtLoaded) return;
  window.__glsEtTtLoaded = true;

  var SCHED = window.GLS_SCHEDULE;
  var API = 'https://api.everytime.kr';
  var CAMPUS_ID = '13';           // 성균관대
  var TABLES_KEY = 'gls_tables';
  var PENDING_KEY = 'gls_et_pending';
  var TAG = '[GLS-ETT]';

  function norm(s) { return String(s == null ? '' : s).replace(/\s+/g, '').toLowerCase(); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function semLabel(s) { var m = { '1': '1학기', '2': '2학기', '3': '여름학기', '4': '겨울학기' }; return m[String(s)] || (s + '학기'); }

  /* ---------- URL: /timetable/<year>/<semester>[/<identifier>] ----------
   * identifier(3번째 세그먼트)는 선택 — /timetable/2026/2 처럼 학기까지만 있어도 동작.
   * (대상 에타 시간표는 목록 API로 고르므로 페이지 id가 필수 아님) */
  function parseUrl() {
    var m = (location.pathname || '').match(/\/timetable\/(\d{4})\/(\d+)(?:\/([^/?#]+))?/);
    if (!m) return null;
    return { year: m[1], semester: m[2], identifier: m[3] || null };
  }

  /* ---------- 에타 API ---------- */
  function apiPost(path, body) {
    return fetch(API + path, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: body
    }).then(function (r) { return r.text(); });
  }
  function parseXml(t) { return new DOMParser().parseFromString(t || '', 'text/xml'); }

  // 강의 검색: type ∈ 'code'(학수번호) | 'name'(과목명)
  function etSearch(type, keyword, url) {
    var kw = encodeURIComponent(JSON.stringify({ type: type, keyword: keyword }));
    var body = 'campusId=' + CAMPUS_ID + '&keyword=' + kw +
      '&limitNum=100&semester=' + encodeURIComponent(url.semester) +
      '&startNum=0&year=' + encodeURIComponent(url.year);
    return apiPost('/find/timetable/subject/list', body).then(function (t) {
      var doc = parseXml(t);
      return Array.prototype.map.call(doc.querySelectorAll('subject'), function (s) {
        var tps = Array.prototype.map.call(s.querySelectorAll('timeplace'), function (tp) {
          return {
            day: parseInt(tp.getAttribute('day'), 10),
            start: parseInt(tp.getAttribute('start'), 10),   // 5분 단위
            end: parseInt(tp.getAttribute('end'), 10),
            place: tp.getAttribute('place') || ''
          };
        });
        return {
          id: s.getAttribute('id'), code: s.getAttribute('code') || '',
          name: s.getAttribute('name') || '', professor: s.getAttribute('professor') || '',
          credit: s.getAttribute('credit') || '', target: s.getAttribute('target') || '',
          lectureId: s.getAttribute('lectureId') || '', timeplaces: tps
        };
      });
    });
  }

  // 특정 에타 시간표의 기존 과목 id + 이름/학기 읽기(전체 저장 시 기존 과목 보존용).
  function etReadTable(identifier) {
    return apiPost('/find/timetable/table', 'id=' + encodeURIComponent(identifier)).then(function (t) {
      var doc = parseXml(t);
      var tb = doc.querySelector('table');
      if (!tb || tb.getAttribute('name') == null) return null;   // -1 등 실패
      var ids = Array.prototype.map.call(tb.querySelectorAll('subject'), function (s) { return s.getAttribute('id'); });
      var seen = {}, uniq = [];
      ids.forEach(function (id) { if (id && !seen[id]) { seen[id] = 1; uniq.push(id); } });
      return { identifier: identifier, name: tb.getAttribute('name'), year: tb.getAttribute('year'), semester: tb.getAttribute('semester'), ids: uniq };
    });
  }

  // 내 에타 시간표 목록. 삭제 스텁(is_deleted=1)·연도/학기 없는 항목 제외. 키 = 숫자 id 속성.
  function etListTables() {
    return apiPost('/find/timetable/table/list', '').then(function (t) {
      var doc = parseXml(t), out = [], seen = {};
      Array.prototype.forEach.call(doc.querySelectorAll('table'), function (tb) {
        if (tb.getAttribute('is_deleted') === '1') return;
        var id = tb.getAttribute('id'), year = tb.getAttribute('year'), sem = tb.getAttribute('semester');
        if (!id || !year || !sem) return;
        if (seen[id]) return; seen[id] = 1;
        out.push({ identifier: id, year: year, semester: sem, name: tb.getAttribute('name') || '', primary: tb.getAttribute('primary') });
      });
      return out;
    }).catch(function () { return []; });
  }
  // 현재 열린 에타 시간표와 "같은 학기"의 시간표들(넣을 대상 후보). 현재 시간표는 항상 포함.
  function etTargetsFor(url) {
    return etListTables().then(function (list) {
      var same = list.filter(function (t) { return String(t.year) === String(url.year) && String(t.semester) === String(url.semester); });
      if (url.identifier && !same.some(function (t) { return t.identifier === url.identifier; })) {
        same.unshift({ identifier: url.identifier, year: url.year, semester: url.semester, name: '', primary: '0' });
      }
      // 기본시간표(primary) 먼저, 그다음 현재 열린 시간표, 이름순
      same.sort(function (a, b) {
        if ((a.primary === '1') !== (b.primary === '1')) return a.primary === '1' ? -1 : 1;
        if ((a.identifier === url.identifier) !== (b.identifier === url.identifier)) return a.identifier === url.identifier ? -1 : 1;
        return String(a.name).localeCompare(String(b.name));
      });
      return same;
    }).catch(function () { return url.identifier ? [{ identifier: url.identifier, year: url.year, semester: url.semester, name: '', primary: '0' }] : []; });
  }

  // 시간표 전체 저장(교체). u = {year,semester,identifier}. ids = 기존+신규 전부. 커스텀은 음수 id.
  function etSaveTable(name, u, ids) {
    var data = [name, u.year, u.semester, u.identifier].concat(ids).join('/') + '/';
    return apiPost('/save/timetable/table', 'data=' + encodeURIComponent(data)).then(function (t) {
      var m = (t || '').match(/<response>(-?\d+)<\/response>/);
      return { ok: !!(m && m[1] === String(u.identifier)), raw: t };
    });
  }

  // 커스텀(직접) 과목 생성 → 양수 id 반환. 시간표엔 -id 로 참조.
  function etCustomAdd(course) {
    var blocks = (SCHED ? SCHED.parseSchedule(course.schedule) : []) || [];
    if (!blocks.length) return Promise.resolve(null);
    var tp = blocks.map(function (b) {
      var di = SCHED.DAYS.indexOf(b.day);
      if (di < 0) return null;
      return { day: di, starttime: Math.round(b.startMin / 5), endtime: Math.round(b.endMin / 5), place: b.room || '' };
    }).filter(Boolean);
    if (!tp.length) return Promise.resolve(null);
    var payload = { name: course.name || '(과목명 없음)', professor: course.professor || '', time_place: tp };
    return apiPost('/save/timetable/subject/custom', 'data=' + encodeURIComponent(JSON.stringify(payload))).then(function (t) {
      var m = (t || '').match(/<response>(-?\d+)<\/response>/);
      var id = m ? parseInt(m[1], 10) : NaN;
      return (isFinite(id) && id > 0) ? id : null;
    });
  }

  /* ---------- 매칭 ---------- */
  function codeSectionOf(c) {
    if (c.codeSection) return c.codeSection;
    if (c.code && c.section != null && c.section !== '') return c.code + '-' + c.section;
    return c.code || '';
  }
  function sameCodeSection(etCode, cs) {
    if (!etCode || !cs) return false;
    if (norm(etCode) === norm(cs)) return true;
    var a = etCode.split('-'), b = cs.split('-');
    if (a.length === 2 && b.length === 2) {
      return norm(a[0]) === norm(b[0]) && parseInt(a[1], 10) === parseInt(b[1], 10);
    }
    return false;
  }
  function glsBlocks(course) {
    return ((SCHED ? SCHED.parseSchedule(course.schedule) : []) || []).map(function (b) {
      return { day: SCHED.DAYS.indexOf(b.day), startMin: b.startMin, endMin: b.endMin };
    }).filter(function (b) { return b.day >= 0; });
  }
  function timeOverlaps(course, subj) {
    var gb = glsBlocks(course);
    if (!gb.length || !subj.timeplaces.length) return false;
    for (var i = 0; i < gb.length; i++) for (var j = 0; j < subj.timeplaces.length; j++) {
      var s = subj.timeplaces[j];
      var ss = s.start * 5, se = s.end * 5;
      if (gb[i].day === s.day && gb[i].startMin < se && ss < gb[i].endMin) return true;
    }
    return false;
  }
  function profMatch(course, subj) {
    var p = norm(course.professor);
    if (!p) return false;
    var sp = norm(subj.professor);
    return sp.indexOf(p) >= 0 || p.indexOf(sp) >= 0;
  }
  function matchCourse(course, url) {
    var cs = codeSectionOf(course);
    var chain = Promise.resolve(null);
    if (course.code) {
      chain = etSearch('code', course.code, url).then(function (list) {
        var exact = list.filter(function (s) { return sameCodeSection(s.code, cs); });
        if (exact.length === 1) return { subject: exact[0], method: 'code' };
        if (exact.length > 1) {
          var byProf = exact.filter(function (s) { return profMatch(course, s); });
          if (byProf.length === 1) return { subject: byProf[0], method: 'code+prof' };
          var byTime = exact.filter(function (s) { return timeOverlaps(course, s); });
          if (byTime.length === 1) return { subject: byTime[0], method: 'code+time' };
        }
        return null;
      });
    }
    return chain.then(function (m) {
      if (m) return m;
      if (!course.name) return null;
      return etSearch('name', course.name, url).then(function (list) {
        var exact = list.filter(function (s) { return sameCodeSection(s.code, cs); });
        if (exact.length === 1) return { subject: exact[0], method: 'name→code' };
        var nameEq = list.filter(function (s) { return norm(s.name) === norm(course.name); });
        var pool = nameEq.length ? nameEq : list;
        var byProf = pool.filter(function (s) { return profMatch(course, s); });
        if (byProf.length === 1) return { subject: byProf[0], method: 'name+prof' };
        if (byProf.length > 1) {
          var byTime = byProf.filter(function (s) { return timeOverlaps(course, s); });
          if (byTime.length === 1) return { subject: byTime[0], method: 'name+prof+time' };
          return { ambiguous: byProf.length };
        }
        if (pool.length) {
          var byTime2 = pool.filter(function (s) { return timeOverlaps(course, s); });
          if (byTime2.length === 1) return { subject: byTime2[0], method: 'name+time' };
        }
        return null;
      });
    });
  }

  /* ---------- GLS 시간표 로드 ---------- */
  function loadAllTables() {   // { tables, activeId } 또는 null
    return new Promise(function (res) {
      try {
        chrome.storage.local.get([TABLES_KEY], function (d) {
          var store = d && d[TABLES_KEY];
          res(store && store.tables && store.tables.length ? store : null);
        });
      } catch (e) { res(null); }
    });
  }
  function pickInitialId(store, prefer) {
    if (prefer && store.tables.some(function (t) { return t.id === prefer; })) return prefer;
    if (store.activeId && store.tables.some(function (t) { return t.id === store.activeId; })) return store.activeId;
    return store.tables[0].id;
  }
  function glsTableById(store, id) { return store.tables.filter(function (t) { return t.id === id; })[0] || store.tables[0]; }
  function pickHtml(cls, label, options) {
    return '<div class="pick"><span>' + esc(label) + '</span><select class="' + cls + '">' + options + '</select></div>';
  }

  /* ================= UI (Shadow DOM) ================= */
  var host = document.createElement('div');
  host.id = 'gls-ett-host';
  host.style.cssText = 'all:initial; position:fixed; z-index:2147483647;';
  var shadow = host.attachShadow({ mode: 'open' });
  document.documentElement.appendChild(host);

  try {
    fetch(chrome.runtime.getURL('fonts/PretendardVariable.woff2'))
      .then(function (r) { return r.arrayBuffer(); })
      .then(function (buf) { return new FontFace('Pretendard GLS', buf, { weight: '100 900' }).load(); })
      .then(function (f) { if (f) document.fonts.add(f); })
      .catch(function () {});
  } catch (e) {}

  shadow.innerHTML = [
    '<style>',
    '*{ box-sizing:border-box; font-family:"Pretendard GLS","Pretendard",-apple-system,"Apple SD Gothic Neo","Malgun Gothic",sans-serif; }',
    '.fab{ position:fixed; right:20px; bottom:20px; display:inline-flex; align-items:center; justify-content:center; gap:7px; padding:11px 24px; border-radius:9999px; background:#F91F15; color:#fff; border:none; cursor:pointer; font-size:14px; font-weight:700; font-family:"Apple SD Gothic Neo","Malgun Gothic",-apple-system,sans-serif; transition:background .15s; }',
    '.fab:hover{ background:#d81a10; }',
    '.fab svg{ width:17px; height:17px; }',
    '.ov{ position:fixed; inset:0; background:rgba(0,0,0,.42); display:none; align-items:center; justify-content:center; }',
    '.ov.open{ display:flex; }',
    '.modal{ width:min(560px,calc(100vw - 32px)); max-height:86vh; background:#fff; border-radius:16px; overflow:hidden; display:flex; flex-direction:column; box-shadow:0 24px 60px rgba(0,0,0,.32); }',
    '.mh{ padding:16px 20px; border-bottom:1px solid #eee; display:flex; align-items:center; gap:8px; }',
    '.mh b{ font-size:15.5px; color:#1c1c1c; flex:1; }',
    '.mh .x{ border:none; background:none; font-size:20px; color:#999; cursor:pointer; }',
    '.mb{ padding:14px 20px; overflow:auto; }',
    '.sub{ font-size:12.5px; color:#666; margin:0 0 12px; line-height:1.55; }',
    '.pick{ display:flex; align-items:center; gap:8px; margin:0 0 10px; font-size:13px; color:#444; }',
    '.pick span{ font-weight:700; white-space:nowrap; flex:0 0 108px; }',
    '.pick select{ flex:1; min-width:0; padding:8px 10px; border:1px solid #d7d7d7; border-radius:8px; font-size:13px; background:#fff; color:#1c1c1c; cursor:pointer; }',
    '.grp{ margin:14px 0 6px; font-size:12px; font-weight:800; letter-spacing:.2px; }',
    '.grp.ok{ color:#0f7c3f; } .grp.warn{ color:#c2410c; } .grp.skip{ color:#8a8a8a; }',
    '.row{ display:flex; gap:8px; align-items:flex-start; padding:7px 10px; border:1px solid #eee; border-radius:10px; margin:5px 0; font-size:13px; }',
    '.row .nm{ font-weight:700; color:#1c1c1c; } .row .mt{ color:#777; font-size:11.5px; margin-top:2px; }',
    '.row .tag{ margin-left:auto; font-size:10.5px; color:#0f7c3f; background:#eef6ef; border:1px solid #d7e8db; border-radius:9999px; padding:2px 8px; white-space:nowrap; flex:0 0 auto; }',
    '.row.bad .tag{ color:#c2410c; background:#fff3ec; border-color:#f4d9c7; }',
    '.row label{ display:flex; gap:6px; align-items:center; margin-left:auto; font-size:11.5px; color:#c2410c; cursor:pointer; flex:0 0 auto; }',
    '.mf{ padding:13px 20px; border-top:1px solid #eee; display:flex; gap:8px; justify-content:flex-end; align-items:center; }',
    '.mf .note{ margin-right:auto; font-size:12px; color:#888; }',
    '.btn{ border:1px solid #0f7c3f; background:#0f7c3f; color:#fff; border-radius:10px; padding:9px 18px; font-size:13.5px; font-weight:700; cursor:pointer; }',
    '.btn.ghost{ background:#fff; color:#555; border-color:#ddd; }',
    '.btn:disabled{ opacity:.55; cursor:default; }',
    '.spin{ display:inline-block; width:15px; height:15px; border:2px solid rgba(255,255,255,.4); border-top-color:#fff; border-radius:50%; animation:sp .7s linear infinite; vertical-align:-2px; }',
    '@keyframes sp{ to{ transform:rotate(360deg); } }',
    '.toast{ position:fixed; right:20px; bottom:80px; background:#232323; color:#fff; padding:11px 15px; border-radius:12px; font-size:13px; box-shadow:0 8px 22px rgba(0,0,0,.32); display:none; max-width:360px; white-space:pre-line; line-height:1.5; }',
    '</style>',
    '<button class="fab" title="현재 GLS 시간표를 이 에타 시간표로 가져오기"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="3" x2="12" y2="15"/></svg>GLS에서 가져오기</button>',
    '<div class="ov"><div class="modal">',
    '  <div class="mh"><b>에브리타임으로 가져오기</b><button class="x" title="닫기">×</button></div>',
    '  <div class="mb"></div>',
    '  <div class="mf"><span class="note"></span><button class="btn ghost cancel">취소</button><button class="btn go">등록</button></div>',
    '</div></div>',
    '<div class="toast"></div>'
  ].join('');

  var $ = function (s) { return shadow.querySelector(s); };
  var elFab = $('.fab'), elOv = $('.ov'), elBody = $('.mb'), elNote = $('.note'),
      elGo = $('.btn.go'), elCancel = $('.cancel'), elX = $('.mh .x'), elToast = $('.toast');

  var toastTimer = null;
  function toast(msg) {
    elToast.textContent = msg; elToast.style.display = 'block';
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { elToast.style.display = 'none'; }, 4200);
  }
  // 모달 닫으면 반드시 busy 해제(취소/X 후 FAB 고착 방지).
  function closeModal() {
    elOv.classList.remove('open');
    elGo.disabled = false; elCancel.disabled = false;
    end();
  }
  elX.addEventListener('click', closeModal);
  elCancel.addEventListener('click', closeModal);
  elOv.addEventListener('click', function (e) { if (e.target === elOv) closeModal(); });
  elFab.addEventListener('click', function () { start(null, true); });   // 수동 클릭 → GLS 시간표 선택 표시

  /* ---------- 메인 플로우 (내보내기) ---------- */
  var busy = false, mGen = 0, tGen = 0;

  //  showSrc=true(FAB): GLS 소스 시간표 선택 드롭다운 표시. false(자동): 활성/지정 GLS 시간표 고정.
  //  대상 에타 시간표 선택 드롭다운은 항상 표시.
  function start(preferTableId, showSrc) {
    if (busy) return;
    var url = parseUrl();
    if (!url) { toast('에브리타임 "시간표" 상세 페이지에서 눌러 주세요.\n(왼쪽에서 시간표를 하나 연 뒤 다시 시도)'); return; }
    busy = true; elFab.disabled = true;
    Promise.all([loadAllTables(), etTargetsFor(url)]).then(function (r) {
      var store = r[0], targets = r[1];
      if (!store) { toast('GLS 확장앱에서 만든 시간표가 없어요.\n먼저 GLS에서 시간표를 만들어 주세요.'); return end(); }
      if (!targets.length) { toast('에타 시간표 목록을 불러오지 못했어요.\n새로고침 후 다시 시도해 주세요.'); return end(); }
      // 기본값 = "기본시간표"(primary). 없으면 현재 열린 시간표 → 없으면 첫 항목.
      var primaryTgt = targets.filter(function (t) { return t.primary === '1'; })[0];
      var st = {
        url: url, store: store, targets: targets,
        srcId: pickInitialId(store, preferTableId),
        tgtId: (primaryTgt && primaryTgt.identifier) || url.identifier || targets[0].identifier,
        primaryId: primaryTgt ? primaryTgt.identifier : null,
        showSrc: !!showSrc, matched: null, failed: null, target: null
      };
      elOv.classList.add('open');
      renderShell(st);
      matchAndRender(st);
    }).catch(function (e) {
      console.error(TAG, e); toast('오류가 발생했어요: ' + (e && e.message || e)); end();
    });
  }
  function end() { busy = false; elFab.disabled = false; }

  // 상단: [내보낼 GLS 시간표](FAB만) + [넣을 에타 시간표](항상) + 결과 .rv
  function renderShell(st) {
    var srcPick = '';
    if (st.showSrc) {
      var srcOpts = st.store.tables.map(function (t) {
        return '<option value="' + esc(t.id) + '"' + (t.id === st.srcId ? ' selected' : '') + '>' + esc(t.name) + ' (' + (t.courses || []).length + '과목)</option>';
      }).join('');
      srcPick = pickHtml('srcpick', '내보낼 GLS 시간표', srcOpts);
    }
    var tgtOpts = st.targets.map(function (t) {
      var lbl = (t.name || '(이름 없음)') + (t.primary === '1' ? ' · 기본' : '') + (t.identifier === st.url.identifier ? ' · 지금 화면' : '');
      return '<option value="' + esc(t.identifier) + '"' + (t.identifier === st.tgtId ? ' selected' : '') + '>' + esc(lbl) + '</option>';
    }).join('');
    var tgtPick = pickHtml('tgtpick', '넣을 에타 시간표', tgtOpts);

    elBody.innerHTML = srcPick + tgtPick + '<div class="rv"></div>';
    var sp = $('.srcpick'); if (sp) sp.onchange = function () { st.srcId = sp.value; st.matched = null; matchAndRender(st); };
    var tp = $('.tgtpick'); if (tp) tp.onchange = function () { st.tgtId = tp.value; st.target = null; renderWithTarget(st); };
    elGo.disabled = true; elGo.textContent = '등록'; elNote.textContent = '';
  }

  // 선택된 GLS 소스 시간표를 매칭(네트워크) → 캐시 → 대상 반영. 대상만 바뀌면 재매칭 안 함.
  function matchAndRender(st) {
    var rv = $('.rv');
    var gt = glsTableById(st.store, st.srcId);
    var courses = (gt.courses || []).filter(function (c) { return c && (c.code || c.name); });
    elGo.disabled = true;
    if (!courses.length) { if (rv) rv.innerHTML = '<p class="sub">이 GLS 시간표에 과목이 없어요.</p>'; return; }
    if (rv) rv.innerHTML = '<p class="sub">GLS <b>' + esc(gt.name) + '</b> (' + courses.length + '과목) 에타 강의 검색·매칭 중…</p>';
    var gen = ++mGen, matched = [], failed = [], seq = Promise.resolve();
    courses.forEach(function (course) {
      seq = seq.then(function () {
        return matchCourse(course, st.url).then(function (m) {
          if (m && m.subject) matched.push({ course: course, subject: m.subject, method: m.method });
          else failed.push({ course: course, reason: (m && m.ambiguous) ? ('후보 ' + m.ambiguous + '개 — 특정 실패') : '에타에서 못 찾음' });
        }).catch(function () { failed.push({ course: course, reason: '검색 오류' }); });
      }).then(function () { return sleep(140); });   // 저빈도 호출(에타 정책 배려)
    });
    seq.then(function () {
      if (gen !== mGen) return;
      st.matched = matched; st.failed = failed; st.target = null;
      renderWithTarget(st);
    });
  }

  // 선택된 대상 에타 시간표의 기존 과목을 읽고 결과 분리 렌더(재매칭 없음).
  function renderWithTarget(st) {
    if (!st.matched) return;
    var rv = $('.rv'); if (rv) rv.innerHTML = '<p class="sub">대상 에타 시간표 읽는 중…</p>';
    elGo.disabled = true;
    var gen = ++tGen;
    etReadTable(st.tgtId).then(function (table) {
      if (gen !== tGen) return;
      if (!table) { if (rv) rv.innerHTML = '<p class="sub">대상 시간표를 읽지 못했어요.</p>'; return; }
      st.target = table;
      drawReview(st);
    }).catch(function (e) { console.error(TAG, e); if (rv) rv.innerHTML = '<p class="sub">대상 시간표 읽기 오류.</p>'; });
  }

  function drawReview(st) {
    var existing = {}; st.target.ids.forEach(function (id) { existing[id] = 1; });
    var matched = st.matched, failed = st.failed;
    var toAdd = matched.filter(function (m) { return !existing[m.subject.id]; });
    var already = matched.filter(function (m) { return existing[m.subject.id]; });
    var tname = st.target.name || '(이름 없음)';

    var h = '<p class="sub">에타 시간표 <b>' + esc(tname) + '</b> · ' + st.url.year + '년 ' + semLabel(st.url.semester) + '<br>' +
      '<b>' + toAdd.length + '개</b> 과목을 추가합니다. (기존 ' + st.target.ids.length + '과목은 유지)</p>';
    if (toAdd.length) {
      h += '<div class="grp ok">추가할 강의 ' + toAdd.length + '개</div>';
      toAdd.forEach(function (m) {
        var s = m.subject, meta = [s.code, s.professor, (s.credit ? s.credit + '학점' : ''), s.target].filter(Boolean).join(' · ');
        h += '<div class="row"><div><div class="nm">' + esc(s.name) + '</div><div class="mt">' + esc(meta) + '</div></div>' +
          '<span class="tag">' + esc(m.method) + '</span></div>';
      });
    }
    if (already.length) {
      h += '<div class="grp skip">이미 있음 ' + already.length + '개</div>';
      already.forEach(function (m) {
        h += '<div class="row"><div><div class="nm">' + esc(m.subject.name) + '</div>' +
          '<div class="mt">' + esc(m.subject.code + ' · ' + m.subject.professor) + '</div></div>' +
          '<span class="tag">건너뜀</span></div>';
      });
    }
    if (failed.length) {
      h += '<div class="grp warn">매칭 실패 ' + failed.length + '개</div>';
      failed.forEach(function (f, i) {
        var c = f.course, cs = codeSectionOf(c), hasTime = glsBlocks(c).length > 0;
        h += '<div class="row bad"><div><div class="nm">' + esc(c.name) + '</div>' +
          '<div class="mt">' + esc([cs, c.professor, c.schedule].filter(Boolean).join(' · ')) + ' — ' + esc(f.reason) + '</div></div>' +
          (hasTime
            ? '<label><input type="checkbox" class="cust" data-i="' + i + '" checked> 직접 추가</label>'
            : '<span class="tag">시간정보 없음</span>') +
          '</div>';
      });
    }
    if (!toAdd.length && !failed.length) {
      h += '<p class="sub">추가할 새 과목이 없어요. (이미 모두 등록되어 있거나 과목이 없습니다.)</p>';
    }
    var rv = $('.rv'); if (rv) rv.innerHTML = h;

    var canGo = toAdd.length > 0 || failed.some(function (f) { return glsBlocks(f.course).length > 0; });
    elGo.disabled = !canGo; elGo.textContent = '등록';
    elNote.textContent = canGo ? '등록하면 선택한 에타 시간표가 갱신됩니다.' : '';
    elGo.onclick = function () { doRegister(st, toAdd, failed); };
  }

  function doRegister(st, toAdd, failed) {
    elGo.disabled = true; elCancel.disabled = true;
    elGo.innerHTML = '<span class="spin"></span> 등록 중…';

    var customChecks = Array.prototype.filter.call(shadow.querySelectorAll('.cust'), function (cb) { return cb.checked; });
    var customCourses = customChecks.map(function (cb) { return failed[+cb.getAttribute('data-i')].course; });

    var newIds = toAdd.map(function (m) { return m.subject.id; });
    var custSeq = Promise.resolve(), customAdded = 0, customFailed = 0;
    customCourses.forEach(function (c) {
      custSeq = custSeq.then(function () {
        return etCustomAdd(c).then(function (id) {
          if (id) { newIds.push('-' + id); customAdded++; } else customFailed++;
        }).catch(function () { customFailed++; }).then(function () { return sleep(140); });
      });
    });

    var saveU = { year: st.target.year || st.url.year, semester: st.target.semester || st.url.semester, identifier: st.tgtId };
    custSeq.then(function () {
      var seen = {}, finalIds = [];
      st.target.ids.concat(newIds).forEach(function (id) { if (id && !seen[id]) { seen[id] = 1; finalIds.push(id); } });
      return etSaveTable(st.target.name, saveU, finalIds);
    }).then(function (res) {
      clearPending();
      if (res.ok) {
        rememberUrlFor(saveU);
        var msg = '완료! "' + (st.target.name || '에타 시간표') + '"에 강의 ' + toAdd.length + '개' + (customAdded ? ' + 직접추가 ' + customAdded + '개' : '') + ' 등록됨.';
        if (customFailed) msg += '\n(직접추가 ' + customFailed + '개 실패)';
        toast(msg);
        closeModal();
        // 지금 화면에 보이는 시간표에 저장한 경우에만 갱신(상세 URL이면 그 id, /2026/2 면 기본시간표가 보임)
        var showingSaved = (st.url.identifier && String(st.tgtId) === String(st.url.identifier)) || (!st.url.identifier && st.tgtId === st.primaryId);
        if (showingSaved) setTimeout(function () { location.reload(); }, 900);
      } else {
        toast('저장에 실패했어요. 로그인 상태를 확인한 뒤 다시 시도해 주세요.');
        elGo.disabled = false; elCancel.disabled = false; elGo.textContent = '등록';
      }
    }).catch(function (e) {
      console.error(TAG, e); toast('등록 중 오류: ' + (e && e.message || e));
      elGo.disabled = false; elCancel.disabled = false; elGo.textContent = '등록';
    }).then(end);
  }

  /* ---------- 마지막 에타 시간표 URL 기억 (GLS 패널 "에타로 내보내기"가 여길 바로 열도록) ---------- */
  function rememberUrl() {
    if (!parseUrl()) return;
    try { chrome.storage.local.set({ gls_et_last: { url: location.href, ts: Date.now() } }); } catch (e) {}
  }
  function rememberUrlFor(u) {
    try { chrome.storage.local.set({ gls_et_last: { url: 'https://everytime.kr/timetable/' + u.year + '/' + u.semester + '/' + u.identifier, ts: Date.now() } }); } catch (e) {}
  }
  rememberUrl();

  /* ---------- GLS 패널 "에타로 내보내기" 직후 자동 실행(pending) ---------- */
  function clearPending() { try { chrome.storage.local.remove(PENDING_KEY); } catch (e) {} }
  function checkPending() {
    try {
      chrome.storage.local.get([PENDING_KEY], function (d) {
        var p = d && d[PENDING_KEY];
        if (p && p.ts && (Date.now() - p.ts) < 120000 && parseUrl()) {
          clearPending();   // 중복 실행 방지 — 자동으로 한 번만
          setTimeout(function () { start(p.tableId || null, false); }, 600);   // 자동: GLS는 활성 고정, 대상 선택만
        }
      });
    } catch (e) {}
  }
  checkPending();

  console.log(TAG, '에타 시간표 내보내기 준비 완료.');
})();
