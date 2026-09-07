/* StreamGraphics Pro — which court is this page for?
 *
 * 🚨 WHY THIS FILE EXISTS.
 * Three pages — the control panel, the Scorer and the output — each carried their own copy of:
 *
 *     (BOARD && list.find(b => b.id === BOARD)) || list[0]
 *
 * Read it again. If the id in the URL matches nothing, it quietly hands back THE FIRST COURT and
 * says nothing. Not an error, not a blank: a different court's live match, drawn as though it
 * were the one you asked for.
 *
 * That went off the day the scoreboards started being saved. Losing the courts had already
 * regenerated every board id, so every output URL sitting in an OBS scene, and every Scorer
 * bookmark on a tablet, now named a court that no longer existed. Mark's report was "the scoring
 * app is changing the score in the control but not in the output — for court 2": the control had
 * a fresh id and was right, the OBS source had the old one and was drawing court 1, and nothing
 * anywhere said so. The Scorer was worse — a stale bookmark did not just DISPLAY court 1, it
 * SCORED it, while the tablet's own heading agreed it was on court 1 and the person holding it
 * never looked.
 *
 * The distinction this makes, and the reason it is one function now:
 *   - NO board in the URL     → the first court. A default, deliberate and unchanged.
 *   - A board that MATCHES    → that court.
 *   - A board that does NOT   → **nothing**, and `missing` is true. Never a substitute.
 *
 * Matching accepts the court's NAME as well as its id, case- and space-insensitive, so a link
 * anyone typed by hand ("?board=Court 2") keeps working. Ids still win, because renaming a court
 * is a thing people do mid-event and a link already pasted into a switcher should survive it.
 */
(function (global) {
  'use strict';

  function norm(s) { return String(s == null ? '' : s).trim().toLowerCase(); }

  /* Returns { board, missing, wanted }.
   *   board   — the court to use, or null
   *   missing — true ONLY when the URL named a court and no such court exists. The caller must
   *             treat this as a fault to be shown, never as "use the first one". */
  function pick(state, wanted) {
    var list = (state && state.scoreboards) || [];
    if (!wanted) return { board: list[0] || null, missing: false, wanted: '' };

    var i;
    for (i = 0; i < list.length; i++) if (list[i].id === wanted) return { board: list[i], missing: false, wanted: wanted };
    var want = norm(wanted);
    for (i = 0; i < list.length; i++) if (norm(list[i].name) === want) return { board: list[i], missing: false, wanted: wanted };
    return { board: null, missing: true, wanted: wanted };
  }

  /* The card an operator actually sees. Deliberately plain HTML in the middle of the page rather
   * than anything drawn on the 1920x1080 stage: the stage gets chroma-keyed, positioned and
   * animated, and a fault message must not inherit any of that. */
  function notice(title, lines) {
    var el = document.getElementById('sgBoardNotice');
    if (!el) {
      el = document.createElement('div');
      el.id = 'sgBoardNotice';
      el.setAttribute('style',
        'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;' +
        'background:#0b1220;font:400 16px/1.5 "Segoe UI",Arial,sans-serif;color:#dbe6f5;padding:24px');
      document.body.appendChild(el);
    }
    el.innerHTML = '<div style="max-width:620px;border:1px solid #33507a;border-radius:14px;' +
      'background:#111c2e;padding:26px 30px;box-shadow:0 18px 50px rgba(0,0,0,.5)">' +
      '<div style="font-size:21px;font-weight:800;color:#ffd166;margin-bottom:12px">' + esc(title) + '</div>' +
      lines.map(function (l) { return '<p style="margin:0 0 10px">' + l + '</p>'; }).join('') +
      '</div>';
    el.style.display = 'flex';
    return el;
  }
  function clearNotice() {
    var el = document.getElementById('sgBoardNotice');
    if (el) el.style.display = 'none';
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c];
    });
  }
  // "Court 1, Court 2 and Center Court" — so the message names the way out, not just the problem.
  function nameList(state) {
    var names = ((state && state.scoreboards) || []).map(function (b) { return esc(b.name); });
    if (!names.length) return '';
    if (names.length === 1) return '<b>' + names[0] + '</b>';
    return '<b>' + names.slice(0, -1).join('</b>, <b>') + '</b> and <b>' + names[names.length - 1] + '</b>';
  }

  global.SGBoard = { pick: pick, notice: notice, clearNotice: clearNotice, nameList: nameList, esc: esc };
})(window);
