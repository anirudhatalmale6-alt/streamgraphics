/* StreamGraphics — Scorer: a big-button, mistake-proof interface for live scoring.
 * Drives the same scoreboard state as the full control panel, but with huge touch targets. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var sb = null;

  var BOARD = new URLSearchParams(location.search).get('board') || '';
  function pickBoard(state) { var list = (state && state.scoreboards) || []; return (BOARD && list.filter(function (b) { return b.id === BOARD; })[0]) || list[0] || null; }
  function post(a) { if (a && String(a.type || '').indexOf('sb_') === 0) a.board = (sb && sb.id) || BOARD; return fetch('/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(a) }).catch(function () {}); }
  function contrast(hex) { hex = String(hex || '#1f7a8c').replace('#', ''); if (hex.length === 3) hex = hex.replace(/(.)/g, '$1$1'); var r = parseInt(hex.slice(0, 2), 16) || 0, g = parseInt(hex.slice(2, 4), 16) || 0, b = parseInt(hex.slice(4, 6), 16) || 0; var L = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; return L > 0.6 ? '#111' : '#fff'; }

  function scoreOf(t, g) { var v = sb.teams[t].games[g]; return (v == null) ? '--' : v; }

  function render() {
    if (!sb) return;
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

  $('plusA').onclick = function () { post({ type: 'sb_score', team: 0, game: sb.activeGame | 0, delta: 1 }); };
  $('plusB').onclick = function () { post({ type: 'sb_score', team: 1, game: sb.activeGame | 0, delta: 1 }); };
  $('minusA').onclick = function () { post({ type: 'sb_score', team: 0, game: sb.activeGame | 0, delta: -1 }); };
  $('minusB').onclick = function () { post({ type: 'sb_score', team: 1, game: sb.activeGame | 0, delta: -1 }); };
  $('startNext').onclick = function () { if (!sb) return; var g = Math.min((sb.gamesCount || 3) - 1, (sb.activeGame | 0) + 1); post({ type: 'sb_startGame', game: g }); };
  $('backGame').onclick = function () { post({ type: 'sb_backGame' }); };
  $('restart').onclick = function () { if (confirm('Restart the whole match? All scores reset.')) post({ type: 'sb_restart' }); };

  function connect() {
    var es = new EventSource('/events');
    es.onopen = function () { $('conn').className = 'conn ok'; $('connTxt').textContent = 'live'; };
    es.onmessage = function (e) { try { var m = JSON.parse(e.data); var bd = m.state && pickBoard(m.state); if (bd) { sb = bd; render(); } } catch (x) {} };
    es.onerror = function () { $('conn').className = 'conn off'; $('connTxt').textContent = 'reconnecting…'; };
  }
  connect();
})();
