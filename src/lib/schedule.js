/*
 * GYOSI_NAME(강의시간) 문자열 → 시간표 블록 배열 파서.
 * 실제 예:
 *   "[월 ~ 금]09:00-09:50【미지정】,10:00-10:50【미지정】,11:00-11:50【미지정】"
 *   "화15:00-16:15【미지정】,목16:30-17:45【미지정】"
 *   "월수13:00-13:50【26117】"
 *
 * 규칙:
 *  - 콤마로 세그먼트 분리.
 *  - 세그먼트 앞에 [요일 ~ 요일] 범위 또는 요일문자열(월수 등)이 있으면 현재 요일을 갱신.
 *  - 요일 표기가 없으면 직전 요일을 그대로 사용(예: [월~금] 다음의 시간들은 월~금 전체에 적용).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.GLS_SCHEDULE = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  var DAYS = ['월', '화', '수', '목', '금', '토', '일'];

  function expandRange(a, b) {
    var ia = DAYS.indexOf(a), ib = DAYS.indexOf(b);
    if (ia < 0 || ib < 0) return [];
    if (ib < ia) { var t = ia; ia = ib; ib = t; }
    var out = [];
    for (var i = ia; i <= ib; i++) out.push(DAYS[i]);
    return out;
  }

  function pad2(s) { return String(s).length < 2 ? ('0' + s) : String(s); }
  function toMinutes(hhmm) {
    var p = String(hhmm).split(':');
    return (parseInt(p[0], 10) || 0) * 60 + (parseInt(p[1], 10) || 0);
  }

  function parseSchedule(raw) {
    var blocks = [];
    if (!raw) return blocks;
    var segs = String(raw).split(',');
    var curDays = null;

    for (var i = 0; i < segs.length; i++) {
      var seg = segs[i].trim();
      if (!seg) continue;

      // [월 ~ 금] 범위
      var mr = seg.match(/^\[\s*([월화수목금토일])\s*~\s*([월화수목금토일])\s*\]/);
      if (mr) { curDays = expandRange(mr[1], mr[2]); seg = seg.slice(mr[0].length); }
      else {
        // 선행 요일 문자열 (월 / 화목 / 월수금 …)
        var md = seg.match(/^([월화수목금토일]+)/);
        if (md) { curDays = md[1].split(''); seg = seg.slice(md[1].length); }
      }

      var mt = seg.match(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/);
      if (!mt || !curDays || !curDays.length) continue;

      var start = pad2(mt[1]) + ':' + mt[2];
      var end = pad2(mt[3]) + ':' + mt[4];
      var room = '';
      var mm = seg.match(/【([^】]*)】/);
      if (mm) room = mm[1];

      curDays.forEach(function (d) {
        blocks.push({ day: d, start: start, end: end, room: room,
          startMin: toMinutes(start), endMin: toMinutes(end) });
      });
    }
    return blocks;
  }

  /*
   * 한 요일 안에서 시간이 겹치는 블록들을 나란히 놓기 위해 레인(열)을 배정한다.
   * 반환: { blocks:[...{lane, lanes}], lanes:최대열수 }
   */
  function assignLanes(dayBlocks) {
    var sorted = dayBlocks.slice().sort(function (a, b) {
      return (a.startMin - b.startMin) || (a.endMin - b.endMin);
    });
    var laneEnds = [];
    sorted.forEach(function (b) {
      var placed = false;
      for (var l = 0; l < laneEnds.length; l++) {
        if (laneEnds[l] <= b.startMin) { b.lane = l; laneEnds[l] = b.endMin; placed = true; break; }
      }
      if (!placed) { b.lane = laneEnds.length; laneEnds.push(b.endMin); }
    });
    var lanes = laneEnds.length || 1;
    sorted.forEach(function (b) { b.lanes = lanes; });
    return { blocks: sorted, lanes: lanes };
  }

  return { parseSchedule: parseSchedule, DAYS: DAYS, toMinutes: toMinutes, expandRange: expandRange, assignLanes: assignLanes };
});

