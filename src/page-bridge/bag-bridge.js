/*
 * [MAIN world] GLS 책가방 담기 브릿지. 근거: docs/api-notes.md §8.
 *
 * 통신: window.postMessage 는 Nexacro 내부 메시지 핸들러와 충돌(id.split 오류)하므로
 *       content(ISOLATED) 와는 document CustomEvent(문자열 detail)로 주고받는다.
 *
 * 담기 실행: nexacro.Form.prototype.transaction 후킹으로
 *   (a) 프레임워크 컨텍스트(HAKBUN·_SESSION_ID·_MENU_ID·_PGM_ID·HAKWIGWAJUNG_GB) 자동 수집
 *   (b) 실제 executeHSSUInsertDeleteBag 호출을 통째로 "템플릿"으로 캡처
 *   요청 시: 템플릿이 있으면 과목 값만 치환해 그대로 재생(가장 확실), 없으면 합성 호출.
 *
 * ★ 2026-07-18 확정(콘솔 진단): native 담기는 transaction 을 8인자로 호출한다 —
 *   (0)svc객체 (1)url (2)inDs (3)outDs (4)arg (5)"commonTransactionCallback" (6)async=false (7)dataType=1.
 *   기존 재생은 앞 5개만 넘겨 6~8번(콜백명/async/dataType)이 누락 → 서버 -1(요청 처리 불가, 평문과 동일 에러).
 *   해결: 캡처한 인자 배열을 통째로 보관하고, 재생 때 arg(=[4])만 치환해 8인자 전부 그대로 apply.
 */
(function () {
  'use strict';
  var TAG = '[GLS-Bag]';
  var ctx = null;      // { hakbun, menuId, pgmId, sessionId, hakwiGb, form }
  var bagTpl = null;   // 실제 담기 호출 템플릿 { form, args:[svc,url,inDs,outDs,arg,cb,async,dtype] }
  var savedTpl = null; // 세션 간 재사용 휴대 템플릿(chrome.storage 저장분, _SESSION_ID 제외)
  var origTx = null;

  function parseArg(arg) {
    var o = {};
    String(arg || '').replace(/([A-Za-z0-9_]+)="([^"]*)"/g, function (_, k, v) { o[k] = v; return ''; });
    return o;
  }
  function setField(arg, key, val) {
    val = String(val == null ? '' : val);
    var re = new RegExp('(' + key + '=")[^"]*(")');
    return re.test(arg) ? arg.replace(re, '$1' + val + '$2') : (arg + ' ' + key + '="' + val + '"');
  }

  function onTx(self, args) {
    try {
      var svc0 = args[0], url = String(args[1] || ''), arg = args[4];
      var a = parseArg(arg);
      if (a._SESSION_ID || a.HAKBUN) {
        ctx = ctx || {};
        if (a.HAKBUN) ctx.hakbun = a.HAKBUN;
        if (a._MENU_ID) ctx.menuId = a._MENU_ID;
        if (a._PGM_ID) ctx.pgmId = a._PGM_ID;
        if (a._SESSION_ID) ctx.sessionId = a._SESSION_ID;
        if (a.HAKWIGWAJUNG_GB) ctx.hakwiGb = a.HAKWIGWAJUNG_GB;
        ctx.form = self;
      }
      var svcId = svc0 && (svc0.strSvcID || svc0);
      if (/executeHSSUInsertDeleteBag/i.test(url) || /executeHSSUInsertDeleteBag/i.test(String(svcId))) {
        // 인자 전체(8개)를 통째로 보관 — 재생 때 arg([4])만 치환하고 나머지(콜백명/async/dataType)는 그대로 재사용.
        bagTpl = { form: self, args: [].slice.call(args) };
        console.log(TAG, '실제 담기 호출 템플릿 캡처 완료(' + bagTpl.args.length + '인자) → 확장앱 담기 활성화');
        try {
          // 세션 간 재사용용 '휴대 템플릿'을 content.js 로 넘겨 chrome.storage 에 저장.
          // 민감한 _SESSION_ID 는 비워서 저장(재생 시 현재 세션값 주입). _MENU_ID/_PGM_ID 등 구조는 실제값 유지.
          var portable = { url: url, inDs: args[2], outDs: args[3], argTpl: setField(String(arg || ''), '_SESSION_ID', ''), cb: args[5], async: args[6], dtype: args[7] };
          document.dispatchEvent(new CustomEvent('gls-bag-tpl-save', { detail: JSON.stringify(portable) }));
        } catch (e) {}
      }
    } catch (e) {}
  }

  function install() {
    if (!(window.nexacro && nexacro.Form && nexacro.Form.prototype && typeof nexacro.Form.prototype.transaction === 'function')) return false;
    if (nexacro.Form.prototype.__glsBagInstalled) return true;
    origTx = nexacro.Form.prototype.transaction;
    nexacro.Form.prototype.transaction = function () { try { onTx(this, arguments); } catch (e) {} return origTx.apply(this, arguments); };
    nexacro.Form.prototype.__glsBagInstalled = true;
    console.log(TAG, 'transaction 후킹 설치');
    return true;
  }
  var iv = setInterval(function () { if (install()) clearInterval(iv); }, 200);
  install();

  // content.js 가 chrome.storage 에서 복원해 넘겨주는 저장 템플릿 수신.
  document.addEventListener('gls-bag-tpl-load', function (ev) {
    try { var t = JSON.parse(ev.detail); if (t && t.argTpl) { savedTpl = t; console.log(TAG, '저장된 담기 템플릿 복원 — 세션 컨텍스트만 잡히면 책가방 재진입 없이 담기 가능'); } } catch (e) {}
  });

  function send(reqId, ok, msg) {
    document.dispatchEvent(new CustomEvent('gls-bag-res', { detail: JSON.stringify({ reqId: reqId, ok: ok, msg: msg }) }));
  }

  function withCourse(arg, course, rowType) {
    arg = setField(arg, 'P_ROW_TYPE', rowType);
    arg = setField(arg, 'GAESUL_YEAR', course.year);
    arg = setField(arg, 'GAESUL_TERM', course.term);
    arg = setField(arg, 'HAKSU_NO', course.code);
    arg = setField(arg, 'BUNBAN', course.section);
    return arg;
  }
  function synthArg(course, rowType) {
    return '  ' + [
      'P_ROW_TYPE="' + rowType + '"', 'GAESUL_YEAR="' + course.year + '"', 'GAESUL_TERM="' + course.term + '"',
      'HAKSU_NO="' + course.code + '"', 'BUNBAN="' + course.section + '"', 'HAKBUN="' + (ctx.hakbun || '') + '"',
      'HAKWIGWAJUNG_GB="' + (ctx.hakwiGb || '1') + '"', '_FIRST_IN_DS_NM=""', '_FIRST_OUT_DS_NM="dsHSSUInsertDeleteBag"',
      '_TRANSACTION_ID="executeHSSUInsertDeleteBag"', '_ALL_IN_DS_NM=""', '_ALL_OUT_DS_NM="dsHSSUInsertDeleteBag=dsHSSUInsertDeleteBag"',
      '_MENU_ID="' + (ctx.menuId || 'M000011089') + '"', '_PGM_ID="' + (ctx.pgmId || 'NHSSU030540M') + '"', '_SESSION_ID="' + (ctx.sessionId || '') + '"'
    ].join(' ') + ' ';
  }

  function doBag(reqId, course, rowType) {
    try {
      // 1) 실제 담기 템플릿이 있으면 그대로 재생(가장 확실).
      //    캡처한 인자 배열(8개: svc/url/inDs/outDs/arg/콜백명/async/dataType)을 통째로 재사용하고,
      //    arg(=[4]) 만 대상 과목 값으로 치환한다. → 6~8번 인자 누락으로 인한 서버 -1 방지.
      if (bagTpl && bagTpl.form && bagTpl.args && origTx) {
        var newArgs = bagTpl.args.slice();
        newArgs[4] = withCourse(String(newArgs[4] || ''), course, rowType);
        console.log(TAG, '담기(템플릿 재생 · ' + newArgs.length + '인자)', { course: course, arg: newArgs[4] });
        var ret = origTx.apply(bagTpl.form, newArgs);
        console.log(TAG, 'transaction 반환값:', ret);
        send(reqId, true, (rowType === 'D' ? '빼기' : '담기') + ' 요청 전송 — GLS 팝업 결과를 확인하세요.');
        return;
      }
      // 1.5) 이전 세션에서 저장한 템플릿 + 이번 세션 컨텍스트로 재구성.
      //      (최초 1회 실제 담기 후 F5·재접속에도 유지 → 책가방 재진입 불필요. 필요한 건 이번 세션 _SESSION_ID 뿐.)
      if (savedTpl && savedTpl.argTpl && ctx && ctx.form && ctx.sessionId && origTx) {
        var argS = savedTpl.argTpl;
        argS = setField(argS, '_SESSION_ID', ctx.sessionId);
        if (ctx.hakbun) argS = setField(argS, 'HAKBUN', ctx.hakbun);
        argS = withCourse(argS, course, rowType);
        var svcS = { objForm: ctx.form, strSvcID: 'executeHSSUInsertDeleteBag', callback: function () { try { console.log(TAG, 'callback(saved)', Array.prototype.slice.call(arguments)); } catch (e) {} } };
        console.log(TAG, '담기(저장 템플릿 재구성)', { course: course, arg: argS });
        origTx.call(ctx.form, svcS, (savedTpl.url || 'h2Service::SKKUHS/executeHSSUInsertDeleteBag.do'), (savedTpl.inDs || ''), (savedTpl.outDs || 'dsHSSUInsertDeleteBag=dsHSSUInsertDeleteBag'), argS, (savedTpl.cb || 'commonTransactionCallback'), (savedTpl.async === undefined ? false : savedTpl.async), (savedTpl.dtype === undefined ? 1 : savedTpl.dtype));
        send(reqId, true, (rowType === 'D' ? '빼기' : '담기') + ' 요청 전송 — GLS 팝업 결과를 확인하세요.');
        return;
      }
      // 2) 템플릿이 아직 없으면: 합성 호출 시도(성공 보장 낮음).
      //    native 와 동일하게 8인자로 호출 — 콜백명 'commonTransactionCallback' · async=false · dataType=1.
      if (ctx && ctx.form && ctx.sessionId && ctx.hakbun && origTx) {
        var form = ctx.form, url = 'h2Service::SKKUHS/executeHSSUInsertDeleteBag.do', arg = synthArg(course, rowType);
        var svc2 = { objForm: form, strSvcID: 'executeHSSUInsertDeleteBag', callback: function () { try { console.log(TAG, 'callback', Array.prototype.slice.call(arguments)); } catch (e) {} } };
        console.log(TAG, '담기(합성 · 8인자)', { course: course, arg: arg });
        origTx.call(form, svc2, url, '', 'dsHSSUInsertDeleteBag=dsHSSUInsertDeleteBag', arg, 'commonTransactionCallback', false, 1);
        send(reqId, true, '담기 요청 전송(합성). 안 되면 GLS에서 직접 담기를 한 번 눌러 연동을 활성화한 뒤 다시 시도하세요.');
        return;
      }
      send(reqId, false, 'GLS에서 아무 과목이나 [책가방 담기]를 한 번 누르면 연동이 활성화됩니다. 그 뒤 다시 시도하세요.');
    } catch (e) {
      console.warn(TAG, '실패', e);
      send(reqId, false, '담기 실행 오류: ' + e);
    }
  }

  document.addEventListener('gls-bag-req', function (ev) {
    var d; try { d = JSON.parse(ev.detail); } catch (e) { return; }
    if (!d) return;
    doBag(d.reqId, d.course, d.action === 'del' ? 'D' : 'I');
  });

  console.log(TAG, 'bag-bridge 준비 (CustomEvent 통신)');
})();
