/* StreamGraphics — Scoreboard output renderer.
 * Subscribes to server state (SSE) and draws the board. Score cells flash when
 * their value changes. Supports a transparent (alpha) or solid chroma background,
 * 9 positions, and an optional Photoshop backdrop image behind the coded frame. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var card = $('sbCard'), animEl = card.querySelector('.anim'), frame = $('frame');
  var rowsEl = $('rows'), backdrop = $('backdrop');
  var POSITIONS = ['top-left','top-center','top-right','mid-left','mid-center','mid-right','bottom-left','bottom-center','bottom-right'];

  var visibleNow = false, hideTimer = null;
  var prevScores = {};   // "team-game" -> last value, to detect changes for the flash

  // Optional chroma key via URL: /scoreboard-output?bg=green  (or magenta/blue/#00ff00)
  (function () {
    var m = new URLSearchParams(location.search).get('bg');
    if (m) {
      var map = { green: '#00b140', magenta: '#ff00ff', blue: '#0000ff' };
      document.documentElement.style.setProperty('--chroma', map[m] || m);
      document.body.classList.add('chroma');
    }
  })();

  function fmt(v) { return v == null ? '--' : String(v); }

  function render(sb) {
    // meta
    $('presenter').textContent = sb.presenter || '';
    $('title').textContent = sb.title || '';
    $('bracket').textContent = sb.bracketLabel || '';
    $('bracket').style.background = (sb.style && sb.style.bracketColor) || '#7a1420';

    // backdrop image (Photoshop art) if provided
    if (sb.style && sb.style.backdropUrl) {
      backdrop.src = sb.style.backdropUrl;
      backdrop.classList.add('on');
      frame.classList.add('hide-frame');
    } else {
      backdrop.classList.remove('on');
      frame.classList.remove('hide-frame');
    }

    // rows
    var active = sb.activeGame | 0;
    var accent = (sb.style && sb.style.accent) || '#dbe8fe';
    var html = '';
    sb.teams.forEach(function (tm, ti) {
      var cells = '';
      for (var g = 0; g < sb.gamesCount; g++) {
        var v = tm.games[g];
        var cls = 'cell' + (v == null ? ' dim' : '') + (g === active ? ' active' : '');
        cells += '<div class="' + cls + '" data-k="' + ti + '-' + g + '"'
               + (g === active && v != null ? ' style="background:' + accent + '"' : '')
               + '>' + fmt(v) + '</div>';
      }
      html += '<div class="row">'
            + '<div class="tcolor" style="background:' + (tm.color || '#ccc') + '"></div>'
            + '<div class="dot"></div>'
            + '<div class="nm">' + esc(tm.p1) + ' / ' + esc(tm.p2)
            + (tm.seed ? ' <span class="seed">(' + esc(tm.seed) + ')</span>' : '') + '</div>'
            + '<div class="cells">' + cells + '</div>'
            + '</div>';
    });
    rowsEl.innerHTML = html;

    // flash cells whose value changed
    sb.teams.forEach(function (tm, ti) {
      for (var g = 0; g < sb.gamesCount; g++) {
        var key = ti + '-' + g, v = tm.games[g];
        if (prevScores[key] !== undefined && prevScores[key] !== v && v != null) {
          var el = rowsEl.querySelector('[data-k="' + key + '"]');
          if (el) { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
        }
        prevScores[key] = v;
      }
    });

    // position + animation
    if (sb.style) {
      if (sb.style.position && POSITIONS.indexOf(sb.style.position) >= 0) {
        POSITIONS.forEach(function (p) { card.classList.remove('pos-' + p); });
        card.classList.add('pos-' + sb.style.position);
      }
      if (sb.style.animation) card.setAttribute('data-anim', sb.style.animation);
    }
    setVisible(!!sb.visible);
  }

  function setVisible(v) {
    if (v === visibleNow) return;
    visibleNow = v;
    if (v) {
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
      card.classList.remove('is-hidden'); void card.offsetWidth; card.classList.remove('is-out');
    } else {
      card.classList.add('is-out');
      hideTimer = setTimeout(function () { card.classList.add('is-hidden'); }, 600);
    }
  }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }

  function connect() {
    var es = new EventSource('/events');
    es.onmessage = function (e) {
      try { var msg = JSON.parse(e.data); if (msg.state && msg.state.scoreboard) render(msg.state.scoreboard); }
      catch (err) {}
    };
  }
  connect();
})();
