/* StreamGraphics — Scorer: a big-button, mistake-proof interface for live scoring.
 * Drives the same scoreboard state as the full control panel, but with huge touch targets. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var sb = null;

  var BOARD = new URLSearchParams(location.search).get('board') || '';
  /* 🚨 The worst version of the missing-court bug lived here. A tablet bookmarked to a court that
     no longer exists used to fall through to the FIRST court — and this page does not merely show
     a score, it CHANGES one. So the scorer tapped +1 POINT believing they were on court 3 and put
     the point on court 1, and the heading agreed with them because it named whatever board it had
     landed on. Now: no court, no scoring. `dead` latches and every post is refused. */
  var dead = false;
  function post(a) {
    if (dead) return Promise.resolve();
    if (a && String(a.type || '').indexOf('sb_') === 0) a.board = (sb && sb.id) || BOARD;
    return fetch('/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(a) }).catch(function () {});
  }
  function contrast(hex) { hex = String(hex || '#1f7a8c').replace('#', ''); if (hex.length === 3) hex = hex.replace(/(.)/g, '$1$1'); var r = parseInt(hex.slice(0, 2), 16) || 0, g = parseInt(hex.slice(2, 4), 16) || 0, b = parseInt(hex.slice(4, 6), 16) || 0; var L = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; return L > 0.6 ? '#111' : '#fff'; }

  function scoreOf(t, g) { var v = sb.teams[t].games[g]; return (v == null) ? '--' : v; }

  /* 🚨 Point every link on this page at the court this page is actually scoring.
   * They are written in the HTML without a board and MUST be rewritten here. Left as written,
   * "Teams & match setup" opened /scoreboard with no ?board= — which falls back to the FIRST
   * court — so a scorer on court 3 was handed court 1's full panel, complete with the court
   * switcher, Rename, Delete and the on-air buttons, and with no way back to their own board.
   * &scorer=1 asks that panel to show only this court's match; see lockDown() in scoreboard.js. */
  function relink(id) {
    var setup = $('navSetup'), out = $('navOut');
    if (setup) setup.href = '/scoreboard?board=' + encodeURIComponent(id) + '&scorer=1';
    if (out) out.href = '/scoreboard-output?board=' + encodeURIComponent(id);
  }
  if (BOARD) relink(BOARD);   // before the first state arrives, the URL is all we know

  function render() {
    if (!sb) return;
    relink(sb.id);
    if (sb.name) { $('btag').textContent = sb.name; $('btag').style.display = ''; }
    var g = sb.activeGame | 0;
    $('matchTitle').textContent = sb.title || 'Match';
    $('gtag').textContent = 'Game ' + (g + 1);
    var A = sb.teams[0], B = sb.teams[1];
    $('nameA').textContent = (A.p1 || '') + (A.p2 ? ' / ' + A.p2 : '');
    $('nameB').textContent = (B.p1 || '') + (B.p2 ? ' / ' + B.p2 : '');
    $('scoreA').textContent = scoreOf(0, g);
    $('scoreB').textContent = scoreOf(1, g);
    // colour the +1 buttons + card accents with each team's colour
    var ca = A.color || '#1f7a8c', cb = B.color || '#b23a48';
    $('plusA').style.background = ca; $('plusA').style.color = contrast(ca); $('cardA').style.borderColor = ca;
    $('plusB').style.background = cb; $('plusB').style.color = contrast(cb); $('cardB').style.borderColor = cb;
    // per-game mini row
    var n = sb.gamesCount || 3, html = '';
    for (var i = 0; i < n; i++) {
      html += '<div class="g' + (i === g ? ' active' : '') + '"><small>G' + (i + 1) + '</small>' + scoreOf(0, i) + ' - ' + scoreOf(1, i) + '</div>';
    }
    $('gamesRow').innerHTML = html;
    $('airState').textContent = sb.visible ? 'ON AIR' : 'OFF AIR';
    $('airState').classList.toggle('live', !!sb.visible);
  }

  /* 🚨 Every one of these guards on `live()`, not on nothing.
     Before, `sb.activeGame` was read straight out of the handler — so with no court the button
     did "refuse", but only by throwing a TypeError on a null. That is not a refusal, it is an
     accident that happened to have the right effect, and it would have stopped being one the
     moment a court was deleted while a Scorer was open on it: `sb` is non-null then, stale, and
     the tap would have gone through to whatever board it named. A test that only clicks the
     button cannot tell those two apart, because a notice sits over the button either way. */
  function live() { return !!sb && !dead; }
  $('plusA').onclick   = function () { if (!live()) return; post({ type: 'sb_score', team: 0, game: sb.activeGame | 0, delta: 1 }); };
  $('plusB').onclick   = function () { if (!live()) return; post({ type: 'sb_score', team: 1, game: sb.activeGame | 0, delta: 1 }); };
  $('minusA').onclick  = function () { if (!live()) return; post({ type: 'sb_score', team: 0, game: sb.activeGame | 0, delta: -1 }); };
  $('minusB').onclick  = function () { if (!live()) return; post({ type: 'sb_score', team: 1, game: sb.activeGame | 0, delta: -1 }); };
  $('startNext').onclick = function () { if (!live()) return; var g = Math.min((sb.gamesCount || 3) - 1, (sb.activeGame | 0) + 1); post({ type: 'sb_startGame', game: g }); };
  $('backGame').onclick  = function () { if (!live()) return; post({ type: 'sb_backGame' }); };
  $('restart').onclick   = function () { if (!live()) return; if (confirm('Restart the whole match? All scores reset.')) post({ type: 'sb_restart' }); };

  function connect() {
    var es = SGLive('/events');
    es.onopen = function () { $('conn').className = 'conn ok'; $('connTxt').textContent = 'live'; };
    es.onmessage = function (e) {
      try {
        var m = JSON.parse(e.data);
        if (!m.state) return;
        var got = SGBoard.pick(m.state, BOARD);
        if (got.board) { dead = false; SGBoard.clearNotice(); sb = got.board; render(); return; }
        // The court named in this tablet's link is gone. Stop, loudly, rather than scoring
        // somebody else's match — see the note on post().
        dead = true;
        SGBoard.notice('This tablet is set to a court that no longer exists', [
          'The link on this device asks for <b>' + SGBoard.esc(got.wanted) + '</b>, and there is no such court.',
          'Courts open right now: ' + (SGBoard.nameList(m.state) || 'none') + '.',
          'Scoring is switched off here so it cannot go onto the wrong court. Ask for the Scorer ' +
          'link for your court again — the technical director can send it, or show the QR code on ' +
          'the scoreboard panel.'
        ]);
      } catch (x) {}
    };
    es.onerror = function () { $('conn').className = 'conn off'; $('connTxt').textContent = 'reconnecting…'; };
  }
  connect();
})();
