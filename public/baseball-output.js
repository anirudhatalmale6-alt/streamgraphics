/* StreamGraphics — Baseball / softball output renderer.
 * Subscribes to server state (SSE) and draws the score bug + optional line score.
 * Transparent (alpha) or solid chroma background, 9 positions, in/out animation. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var card = $('blCard'), bug = $('bug'), lineEl = $('line');
  var POSITIONS = ['top-left','top-center','top-right','mid-left','mid-center','mid-right','bottom-left','bottom-center','bottom-right'];

  var visibleNow = false, hideTimer = null;
  // preview mode (used by the control panel's iframe) always shows the board, even off air
  var FORCE = new URLSearchParams(location.search).get('preview') === '1';

  var CMAP = { green: '#00b140', magenta: '#ff00ff', blue: '#0000ff' };
  var urlChroma = (function () { var m = new URLSearchParams(location.search).get('bg'); return m ? (CMAP[m] || m) : null; })();
  function applyChroma(c) {
    var col = urlChroma || (c ? (CMAP[c] || c) : '');
    if (col) { document.documentElement.style.setProperty('--chroma', col); document.body.classList.add('chroma'); }
    else document.body.classList.remove('chroma');
  }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  function runs(t) { return (t.line || []).reduce(function (s, v) { return s + (v == null ? 0 : (parseInt(v, 10) || 0)); }, 0); }

  function teamRow(t, batting) {
    var logo = t.logoUrl ? '<img class="lg" src="' + esc(t.logoUrl) + '" alt="">' : '<span class="lg"></span>';
    return '<div class="trow' + (batting ? ' batting' : '') + '">'
      + '<span class="bar" style="background:' + esc(t.color || '#888') + '"></span>'
      + logo
      + '<span class="ab">' + esc(t.abbr || '') + '</span>'
      + '<span class="nm">' + esc(t.name || '') + '</span>'
      + '<span class="r">' + runs(t) + '</span>'
      + '</div>';
  }

  function render(bb) {
    if (!bb) return;
    var st = bb.style || {};

    // position + animation flavour
    var pos = 'pos-' + (POSITIONS.indexOf(st.position) >= 0 ? st.position : 'bottom-left');
    card.className = 'bb ' + pos + (visibleNow ? '' : ' is-out') + (card.classList.contains('is-hidden') ? ' is-hidden' : '');
    card.setAttribute('data-anim', ['slide-up', 'fade', 'scale'].indexOf(st.animation) >= 0 ? st.animation : 'slide-up');
    card.style.setProperty('--accent', st.accent || '#f4a63c');
    applyChroma(st.chroma);

    var away = bb.teams[0], home = bb.teams[1];
    var battingHome = (bb.half === 'bottom');

    // outs pips (0..3)
    var outs = '';
    for (var o = 0; o < 3; o++) outs += '<i class="' + (o < bb.outs ? 'on' : '') + '"></i>';

    // bases diamond
    var b = bb.bases || {};
    var diamond = '<div class="diamond">'
      + '<span class="b b2' + (b.second ? ' on' : '') + '"></span>'
      + '<span class="b b3' + (b.third ? ' on' : '') + '"></span>'
      + '<span class="b b1' + (b.first ? ' on' : '') + '"></span>'
      + '</div>';

    var clock = st.showClock
      ? '<div class="clock">' + esc(st.clockText || '0:00') + '</div>'
      : '';

    bug.innerHTML =
      '<div class="teams">' + teamRow(away, !battingHome) + teamRow(home, battingHome) + '</div>'
      + '<div class="sit">'
        + '<div class="inn"><div class="arrow">' + (battingHome ? '▼' : '▲') + '</div>'
          + '<div class="num">' + bb.inning + '</div><div class="lbl">' + (battingHome ? 'BOT' : 'TOP') + '</div></div>'
        + '<div class="count"><div class="bs">' + bb.balls + '-' + bb.strikes + '</div><div class="cl">B–S</div></div>'
        + '<div style="text-align:center"><div class="outs">' + outs + '</div><div class="cl" style="font-size:9px;letter-spacing:.12em;color:#9aa6b5;font-weight:800;margin-top:4px">OUTS</div></div>'
        + diamond
      + '</div>'
      + clock;

    // optional line score
    if (st.showLine) {
      lineEl.style.display = '';
      var n = bb.innings, head = '<th class="tm"></th>';
      for (var i = 1; i <= n; i++) head += '<th>' + i + '</th>';
      head += '<th>R</th><th>H</th><th>E</th>';
      function row(t, isHome) {
        var cur = (isHome ? bb.half === 'bottom' : bb.half === 'top');
        var tds = '<td class="tm">' + esc(t.abbr || t.name || '') + '</td>';
        for (var k = 0; k < n; k++) {
          var now = cur && (k === bb.inning - 1);
          tds += '<td class="' + (now ? 'now' : '') + '">' + (t.line[k] == null ? '' : t.line[k]) + '</td>';
        }
        tds += '<td class="rhe">' + runs(t) + '</td><td>' + (t.hits || 0) + '</td><td>' + (t.errors || 0) + '</td>';
        return '<tr>' + tds + '</tr>';
      }
      lineEl.innerHTML = '<table><thead><tr>' + head + '</tr></thead><tbody>'
        + row(away, false) + row(home, true) + '</tbody></table>';
    } else {
      lineEl.style.display = 'none';
    }

    // show / hide with animation
    var vis = bb.visible || FORCE;
    if (vis && !visibleNow) {
      visibleNow = true; clearTimeout(hideTimer);
      card.classList.remove('is-hidden');
      requestAnimationFrame(function () { requestAnimationFrame(function () { card.classList.remove('is-out'); }); });
    } else if (!vis && visibleNow) {
      visibleNow = false; card.classList.add('is-out');
      hideTimer = setTimeout(function () { card.classList.add('is-hidden'); }, 650);
    }
  }

  var es = SGLive('/events');
  es.onmessage = function (e) {
    try { var msg = JSON.parse(e.data); if (msg.state && msg.state.baseball) render(msg.state.baseball); } catch (err) {}
  };
})();
