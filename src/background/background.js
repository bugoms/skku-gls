/*
 * [service worker] 검색 인덱스 = 내장 데이터(data/bundled-courses.json).
 * 수집 기능은 제거됨: 인덱스는 내장 데이터로만 채우며, 재시드 시 완전 교체한다.
 *   - search: 질의 → 랭킹된 결과
 *   - stats:  현황
 * 툴바 아이콘 클릭 → content 에 패널 토글 요청.
 */
importScripts('../lib/normalize.js', '../lib/search.js');

var SEARCH = self.GLS_SEARCH;
var STORE_KEY = 'gls_index';       // { [id]: Course }
var META_KEY = 'gls_meta';         // { total, byYearTerm, byCampus, lastUpdated }
var SEED_KEY = 'gls_seed_version'; // 내장 데이터 시드 버전

function getLocal(keys) { return new Promise(function (res) { chrome.storage.local.get(keys, res); }); }
function setLocal(obj) { return new Promise(function (res) { chrome.storage.local.set(obj, res); }); }

function recomputeMeta(index) {
  var byYearTerm = {}, byCampus = {};
  Object.keys(index).forEach(function (id) {
    var c = index[id];
    byYearTerm[c.yearTerm] = (byYearTerm[c.yearTerm] || 0) + 1;
    if (c.campus) byCampus[c.campus] = (byCampus[c.campus] || 0) + 1;
  });
  return { lastUpdated: Date.now(), total: Object.keys(index).length, byYearTerm: byYearTerm, byCampus: byCampus };
}

/* 내장 데이터로 인덱스를 완전히 교체(수집 기능이 없으므로 인덱스=번들). */
function seedBundled() {
  return getLocal([SEED_KEY]).then(function (data) {
    return fetch(chrome.runtime.getURL('data/bundled-courses.json'))
      .then(function (r) { return r.json(); })
      .then(function (bundle) {
        var fileVer = (bundle && bundle.version) || 0;
        var seededVer = data[SEED_KEY] || 0;
        if (!bundle || !bundle.courses || !bundle.courses.length) return;
        if (fileVer <= seededVer) return;
        var index = {};
        bundle.courses.forEach(function (c) { if (c && c.id) index[c.id] = c; });
        var payload = {};
        payload[STORE_KEY] = index;
        payload[META_KEY] = recomputeMeta(index);
        payload[SEED_KEY] = fileVer;
        return setLocal(payload);
      })
      .catch(function () { /* 번들 파일 없음/파싱 실패 → 무시 */ });
  });
}
chrome.runtime.onInstalled.addListener(function () { seedBundled(); });
seedBundled();

/* 툴바 아이콘 클릭 → 활성 탭의 패널 토글 (팝업 대체).
 * GLS/에타처럼 이미 주입된 탭이면 메시지로 토글. 그 외 사이트는 content script가 없어
 * 메시지가 실패하므로, activeTab 권한으로 schedule+content 를 즉석 주입한다(브로드 권한 불필요).
 * content 는 로드 시 GLS가 아니면 자동으로 열리므로 별도 토글 메시지는 불필요. */
chrome.action.onClicked.addListener(function (tab) {
  if (!tab || tab.id == null) return;
  chrome.tabs.sendMessage(tab.id, { type: 'togglePanel' }, function () {
    if (!chrome.runtime.lastError) return;         // 이미 주입된 탭 → 토글 완료
    if (!chrome.scripting) return;
    chrome.scripting.executeScript(
      { target: { tabId: tab.id }, files: ['src/lib/schedule.js', 'src/content/content.js'] },
      function () { void chrome.runtime.lastError; } // chrome:// · 웹스토어 등 주입 불가 페이지는 무시
    );
  });
});

function doSearch(query, opts) {
  return getLocal([STORE_KEY]).then(function (data) {
    var index = data[STORE_KEY] || {};
    var list = Object.keys(index).map(function (k) { return index[k]; });
    return SEARCH.search(list, query, opts || {});
  });
}
function getStats() {
  return getLocal([META_KEY]).then(function (data) {
    return data[META_KEY] || { total: 0, byYearTerm: {}, byCampus: {}, lastUpdated: 0 };
  });
}

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg || !msg.type) return;
  switch (msg.type) {
    case 'search': doSearch(msg.query, msg.opts).then(function (r) { sendResponse({ results: r }); }); return true;
    case 'stats': getStats().then(sendResponse); return true;
    default: return;
  }
});
