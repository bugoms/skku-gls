/*
 * [ISOLATED] 에브리타임 시간표 연동 — GLS 확장앱에서 만든 시간표를 에타 시간표에 등록.
 * 동작 페이지: https://everytime.kr/timetable/<year>/<semester>/<identifier>
 *
 * 흐름:
 *   1) 활성 GLS 시간표(gls_tables)의 과목들을 에타 "강의 검색"(학수번호→과목명 순)으로 찾아
 *      실제 에타 강의 id 로 매칭. (에타의 진짜 강의로 등록 → 강의평/공유 연결)
 *   2) 현재 에타 시간표(URL identifier)의 기존 과목 id + 매칭된 id 를 합쳐 "전체 저장".
 *      (에타 저장 API 는 전체 교체 방식이라 기존 과목을 반드시 함께 보냄)
 *   3) 매칭 실패 과목은 목록으로 보여주고, 시간이 있는 과목은 "직접 추가(커스텀)"로 폴백 등록.
 *
 * 인증: 에타 세션 쿠키(credentials:'include'). 별도 CSRF 토큰 없음.
 * 근거: docs/api-notes.md §9 (에타 시간표 등록: 검색→추가).
 * 쓰기 동작이므로 실행 전 확인 모달 필수(사용자 에타 시간표를 바꿈).
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

  /* ---------- URL: /timetable/<year>/<semester>/<identifier> ---------- */
  function parseUrl() {
    var m = (location.pathname || '').match(/\/timetable\/(\d{4})\/(\d+)\/([^/?#]+)/);
    if (!m) return null;
    return { year: m[1], semester: m[2], identifier: m[3] };
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

  // 강의 검색: type ∈ 'code'(학수번호) | 'name'(과목명) | 'professor' | 'place'
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
          id: s.getAttribute('id'),
          code: s.getAttribute('code') || '',
          name: s.getAttribute('name') || '',
          professor: s.getAttribute('professor') || '',
          credit: s.getAttribute('credit') || '',
          target: s.getAttribute('target') || '',
          lectureId: s.getAttribute('lectureId') || '',
          timeStr: s.getAttribute('time') || '',
          timeplaces: tps
        };
      });
    });
  }

  // 현재 에타 시간표 읽기 → { name, year, semester, ids:[...] }
  function etReadTable(identifier) {
    return apiPost('/find/timetable/table', 'id=' + encodeURIComponent(identifier)).then(function (t) {
      var doc = parseXml(t);
      var tb = doc.querySelector('table');
      if (!tb || tb.getAttribute('name') == null) return null;   // -1 등 실패
      var ids = Array.prototype.map.call(tb.querySelectorAll('subject'), function (s) { return s.getAttribute('id'); });
      var seen = {}, uniq = [];
      ids.forEach(function (id) { if (id && !seen[id]) { seen[id] = 1; uniq.push(id); } });
      return { name: tb.getAttribute('name'), year: tb.getAttribute('year'), semester: tb.getAttribute('semester'), ids: uniq };
    });
  }

  // 시간표 전체 저장(교체). ids 는 기존+신규 전부. 커스텀 과목은 음수 id.
  function etSaveTable(name, url, ids) {
    var data = [name, url.year, url.semester, url.identifier].concat(ids).join('/') + '/';
    return apiPost('/save/timetable/table', 'data=' + encodeURIComponent(data)).then(function (t) {
      var m = (t || '').match(/<response>(-?\d+)<\/response>/);
      return { ok: !!(m && m[1] === url.identifier), raw: t };
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
  // 학수번호-분반 동등 비교(분반은 숫자 비교로 01 vs 1 흡수).
  function sameCodeSection(etCode, cs) {
    if (!etCode || !cs) return false;
    if (norm(etCode) === norm(cs)) return true;
    var a = etCode.split('-'), b = cs.split('-');
    if (a.length === 2 && b.length === 2) {
      return norm(a[0]) === norm(b[0]) && parseInt(a[1], 10) === parseInt(b[1], 10);
    }
    return false;
  }
  // GLS 시간블록 → {dayIdx,startMin,endMin}
  function glsBlocks(course) {
    return ((SCHED ? SCHED.parseSchedule(course.schedule) : []) || []).map(function (b) {
      return { day: SCHED.DAYS.indexOf(b.day), startMin: b.startMin, endMin: b.endMin };
    }).filter(function (b) { return b.day >= 0; });
  }
  // 에타 subject 의 시간블록(분 단위)과 GLS 블록이 하나라도 겹치면 true
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
    // 교수 여러 명 표기 대비: 부분 포함 양방향
    return sp.indexOf(p) >= 0 || p.indexOf(sp) >= 0;
  }

  // 한 과목 매칭. 반환: {subject, method} 또는 null(+reason)
  function matchCourse(course, url) {
    var cs = codeSectionOf(course);
    var chain = Promise.resolve(null);

    // 1) 학수번호 검색 → 학수번호-분반 정확 일치
    if (course.code) {
      chain = etSearch('code', course.code, url).then(function (list) {
        var exact = list.filter(function (s) { return sameCodeSection(s.code, cs); });
        if (exact.length === 1) return { subject: exact[0], method: 'code' };
        if (exact.length > 1) {
          // 드묾: 분반까지 같은 복수 → 교수/시간으로 좁힘
          var byProf = exact.filter(function (s) { return profMatch(course, s); });
          if (byProf.length === 1) return { subject: byProf[0], method: 'code+prof' };
          var byTime = exact.filter(function (s) { return timeOverlaps(course, s); });
          if (byTime.length === 1) return { subject: byTime[0], method: 'code+time' };
        }
        return null;
      });
    }

    // 2) 폴백: 과목명 검색 → 교수(+시간)로 특정
    return chain.then(function (m) {
      if (m) return m;
      if (!course.name) return null;
      return etSearch('name', course.name, url).then(function (list) {
        // 우선 code 로 한번 더(과목명 검색 결과에도 code 있음)
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
        // 교수 매칭 0 → 이름+시간만으로 유일하면 채택
        if (pool.length) {
          var byTime2 = pool.filter(function (s) { return timeOverlaps(course, s); });
          if (byTime2.length === 1) return { subject: byTime2[0], method: 'name+time' };
        }
        return null;
      });
    });
  }

  /* ---------- 데이터 로드 ---------- */
  function loadActiveCourses(preferTableId) {
    return new Promise(function (res) {
      try {
        chrome.storage.local.get([TABLES_KEY], function (d) {
          var store = d && d[TABLES_KEY];
          if (!store || !store.tables || !store.tables.length) { res(null); return; }
          var t = null;
          if (preferTableId) t = store.tables.filter(function (x) { return x.id === preferTableId; })[0];
          if (!t) t = store.tables.filter(function (x) { return x.id === store.activeId; })[0];
          if (!t) t = store.tables[0];
          res({ name: t.name, courses: (t.courses || []) });
        });
      } catch (e) { res(null); }
    });
  }

  /* ================= UI (Shadow DOM) ================= */
  var host = document.createElement('div');
  host.id = 'gls-ett-host';
  host.style.cssText = 'all:initial; position:fixed; z-index:2147483647;';
  var shadow = host.attachShadow({ mode: 'open' });
  document.documentElement.appendChild(host);
  shadow.innerHTML = [
    '<style>',
    '*{ box-sizing:border-box; font-family:-apple-system,"Apple SD Gothic Neo","Malgun Gothic",sans-serif; }',
    '.fab{ position:fixed; right:20px; bottom:20px; display:inline-flex; align-items:center; gap:7px; padding:11px 15px; border-radius:9999px; background:#0f7c3f; color:#fff; border:none; cursor:pointer; font-size:13.5px; font-weight:700; box-shadow:0 6px 18px rgba(0,0,0,.22); }',
    '.fab:hover{ background:#0b6a34; }',
    '.fab svg{ width:17px; height:17px; }',
    '.ov{ position:fixed; inset:0; background:rgba(0,0,0,.42); display:none; align-items:center; justify-content:center; }',
    '.ov.open{ display:flex; }',
    '.modal{ width:min(560px,calc(100vw - 32px)); max-height:86vh; background:#fff; border-radius:16px; overflow:hidden; display:flex; flex-direction:column; box-shadow:0 24px 60px rgba(0,0,0,.32); }',
    '.mh{ padding:16px 20px; border-bottom:1px solid #eee; display:flex; align-items:center; gap:8px; }',
    '.mh b{ font-size:15.5px; color:#1c1c1c; flex:1; }',
    '.mh .x{ border:none; background:none; font-size:20px; color:#999; cursor:pointer; }',
    '.mb{ padding:14px 20px; overflow:auto; }',
    '.sub{ font-size:12.5px; color:#666; margin:0 0 12px; line-height:1.55; }',
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
    '<button class="fab" title="GLS 시간표를 이 에타 시간표로 가져오기">',
    '  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v9"/><path d="M8.5 8.5 12 12l3.5-3.5"/><path d="M4 14v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/></svg>',
    '  GLS 시간표 가져오기</button>',
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
  function closeModal() { elOv.classList.remove('open'); }
  elX.addEventListener('click', closeModal);
  elCancel.addEventListener('click', closeModal);
  elOv.addEventListener('click', function (e) { if (e.target === elOv) closeModal(); });
  elFab.addEventListener('click', function () { start(null); });

  /* ---------- 메인 플로우 ---------- */
  var busy = false;
  function start(preferTableId) {
    if (busy) return;
    var url = parseUrl();
    if (!url) { toast('에브리타임 "시간표" 상세 페이지에서 눌러 주세요.\n(왼쪽에서 시간표를 하나 연 뒤 다시 시도)'); return; }
    busy = true;
    elFab.disabled = true;
    Promise.all([loadActiveCourses(preferTableId), etReadTable(url.identifier)]).then(function (r) {
      var gls = r[0], table = r[1];
      if (!gls) { toast('GLS 확장앱에서 만든 시간표가 없어요.\n먼저 GLS에서 시간표를 만들어 주세요.'); return end(); }
      if (!table) { toast('현재 에타 시간표를 읽지 못했어요. 새로고침 후 다시 시도해 주세요.'); return end(); }
      var courses = (gls.courses || []).filter(function (c) { return c && (c.code || c.name); });
      if (!courses.length) { toast('GLS 시간표 "' + gls.name + '" 에 과목이 없어요.'); return end(); }
      openReview(url, gls, table, courses);
    }).catch(function (e) {
      console.error(TAG, e); toast('오류가 발생했어요: ' + (e && e.message || e));
      end();
    });
  }
  function end() { busy = false; elFab.disabled = false; }

  function openReview(url, gls, table, courses) {
    elOv.classList.add('open');
    elBody.innerHTML = '<p class="sub">GLS 시간표 <b>' + esc(gls.name) + '</b> (' + courses.length +
      '과목)을<br>에타 시간표 <b>' + esc(table.name) + '</b> (' + url.year + '년 ' + url.semester +
      '학기 · 기존 ' + table.ids.length + '과목)에서 검색·매칭 중…</p><p class="sub">에타 강의를 검색하는 중이라 잠시 걸려요.</p>';
    elGo.disabled = true; elNote.textContent = '';

    var matched = [], failed = [];
    var seq = Promise.resolve();
    courses.forEach(function (course) {
      seq = seq.then(function () {
        return matchCourse(course, url).then(function (m) {
          if (m && m.subject) matched.push({ course: course, subject: m.subject, method: m.method });
          else failed.push({ course: course, reason: (m && m.ambiguous) ? ('후보 ' + m.ambiguous + '개 — 특정 실패') : '에타에서 못 찾음' });
        }).catch(function () { failed.push({ course: course, reason: '검색 오류' }); });
      }).then(function () { return sleep(140); });   // 저빈도 호출(에타 정책 배려)
    });

    seq.then(function () { renderReview(url, gls, table, matched, failed); });
  }

  function renderReview(url, gls, table, matched, failed) {
    // 기존 시간표에 이미 있는 과목은 스킵 표시
    var existing = {};
    table.ids.forEach(function (id) { existing[id] = 1; });
    var toAdd = matched.filter(function (m) { return !existing[m.subject.id]; });
    var already = matched.filter(function (m) { return existing[m.subject.id]; });

    var h = '';
    h += '<p class="sub">에타 시간표 <b>' + esc(table.name) + '</b> · ' + url.year + '년 ' + url.semester + '학기<br>' +
      '<b>' + toAdd.length + '개</b> 과목을 추가합니다. (기존 ' + table.ids.length + '과목은 유지)</p>';

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
        var c = f.course, cs = codeSectionOf(c);
        var hasTime = glsBlocks(c).length > 0;
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
    elBody.innerHTML = h;

    var canGo = toAdd.length > 0 || failed.some(function (f) { return glsBlocks(f.course).length > 0; });
    elGo.disabled = !canGo;
    elNote.textContent = canGo ? '등록하면 현재 에타 시간표가 갱신됩니다.' : '';

    elGo.onclick = function () { doRegister(url, table, toAdd, failed); };
  }

  function doRegister(url, table, toAdd, failed) {
    elGo.disabled = true; elCancel.disabled = true;
    elGo.innerHTML = '<span class="spin"></span> 등록 중…';

    // 체크된 실패 과목 → 커스텀 추가
    var customChecks = Array.prototype.filter.call(shadow.querySelectorAll('.cust'), function (cb) { return cb.checked; });
    var customCourses = customChecks.map(function (cb) { return failed[+cb.getAttribute('data-i')].course; });

    var newIds = toAdd.map(function (m) { return m.subject.id; });
    var custSeq = Promise.resolve();
    var customAdded = 0, customFailed = 0;
    customCourses.forEach(function (c) {
      custSeq = custSeq.then(function () {
        return etCustomAdd(c).then(function (id) {
          if (id) { newIds.push('-' + id); customAdded++; } else customFailed++;
        }).catch(function () { customFailed++; }).then(function () { return sleep(140); });
      });
    });

    custSeq.then(function () {
      // 기존 + 신규 (중복 제거)
      var seen = {}, finalIds = [];
      table.ids.concat(newIds).forEach(function (id) { if (id && !seen[id]) { seen[id] = 1; finalIds.push(id); } });
      return etSaveTable(table.name, url, finalIds);
    }).then(function (res) {
      clearPending();
      if (res.ok) {
        rememberUrl();   // 이 시간표를 "마지막 대상"으로 기억 → GLS 버튼이 다음에 여길 바로 연다
        var msg = '완료! 강의 ' + toAdd.length + '개' + (customAdded ? ' + 직접추가 ' + customAdded + '개' : '') + ' 등록됨.';
        if (customFailed) msg += '\n(직접추가 ' + customFailed + '개 실패)';
        toast(msg);
        closeModal();
        setTimeout(function () { location.reload(); }, 900);   // 에타 화면 갱신
      } else {
        toast('저장에 실패했어요. 로그인 상태를 확인한 뒤 다시 시도해 주세요.');
        elGo.disabled = false; elCancel.disabled = false; elGo.textContent = '등록';
      }
    }).catch(function (e) {
      console.error(TAG, e); toast('등록 중 오류: ' + (e && e.message || e));
      elGo.disabled = false; elCancel.disabled = false; elGo.textContent = '등록';
    }).then(end);
  }

  /* ---------- 마지막 에타 시간표 URL 기억 (GLS 패널의 "에타로 내보내기"가 이 시간표를 바로 열도록) ---------- */
  function rememberUrl() {
    if (!parseUrl()) return;
    try { chrome.storage.local.set({ gls_et_last: { url: location.href, ts: Date.now() } }); } catch (e) {}
  }
  rememberUrl();

  /* ---------- GLS 패널에서 넘어온 자동 실행(pending) ---------- */
  function clearPending() { try { chrome.storage.local.remove(PENDING_KEY); } catch (e) {} }
  function checkPending() {
    try {
      chrome.storage.local.get([PENDING_KEY], function (d) {
        var p = d && d[PENDING_KEY];
        if (p && p.ts && (Date.now() - p.ts) < 120000 && parseUrl()) {
          clearPending();   // 중복 실행 방지 — 모달을 한 번만 자동으로 띄운다
          setTimeout(function () { start(p.tableId || null); }, 600);
        }
      });
    } catch (e) {}
  }
  checkPending();

  console.log(TAG, '에타 시간표 연동 준비 완료.');
})();
