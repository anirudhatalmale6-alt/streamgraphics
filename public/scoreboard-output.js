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

  /* ---- auto-contrast: pick readable text colour for a row background ---- */
  function hexRgb(h) {
    h = String(h || '').trim().replace(/^#/, '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    if (h.length < 6) return null;
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  function relLum(rgb) {
    var a = rgb.map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
  }
  function contrast(c1, c2) {
    var a = hexRgb(c1), b = hexRgb(c2); if (!a || !b) return 21;
    var l1 = relLum(a), l2 = relLum(b); var hi = Math.max(l1, l2), lo = Math.min(l1, l2);
    return (hi + 0.05) / (lo + 0.05);
  }
  // effective text colour on a given row bg: auto black/white unless a manual colour reads well
  function textOn(rowColor, textColor) {
    if (!rowColor) return textColor || '';           // no row bg -> honour choice / CSS default (dark)
    var rgb = hexRgb(rowColor);
    var auto = (rgb && relLum(rgb) > 0.5) ? '#141414' : '#ffffff';
    if (textColor && contrast(textColor, rowColor) >= 4) return textColor; // good manual colour -> keep
    return auto;
  }

  function render(sb) {
    // meta
    $('presenter').textContent = sb.presenter || '';
    $('title').textContent = sb.title || '';
    $('bracket').textContent = sb.bracketLabel || '';
    $('bracket').style.background = (sb.style && sb.style.bracketColor) || '#7a1420';

    // Event logo: either INLINE in the brand cell, or a FREE OVERLAY you position anywhere.
    var hb = document.querySelector('.hb'), evImg = $('eventLogo'), floatLogo = $('floatLogo');
    var placement = sb.eventLogoPlacement || 'inline';
    var hasLogo = !!sb.eventLogoUrl;
    if (hasLogo && placement === 'inline') {
      if (!evImg) { evImg = document.createElement('img'); evImg.id = 'eventLogo'; evImg.className = 'eventlogo'; hb.parentNode.insertBefore(evImg, hb); }
      evImg.src = sb.eventLogoUrl; evImg.style.display = 'block'; hb.style.display = 'none';
      floatLogo.style.display = 'none';
    } else if (hasLogo) { // free overlay at one of the 9 anchors
      if (evImg) evImg.style.display = 'none';
      hb.style.display = '';
      floatLogo.src = sb.eventLogoUrl;
      floatLogo.style.height = (sb.eventLogoSize || 150) + 'px';
      POSITIONS.forEach(function (p) { floatLogo.classList.remove('pos-' + p); });
      floatLogo.classList.add('pos-' + placement);
      floatLogo.style.display = 'block';
    } else {
      if (evImg) evImg.style.display = 'none';
      hb.style.display = '';
      floatLogo.style.display = 'none';
    }

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
      var rowStyle = tm.rowColor ? 'background:' + tm.rowColor + ';' : '';
      var effText = textOn(tm.rowColor, tm.textColor);
      var txtStyle = effText ? 'color:' + effText + ';' : '';
      var seedStyle = effText ? 'color:' + effText + ';opacity:.7' : '';
      var logo = tm.logoUrl
        ? '<img class="tlogo" src="' + esc(tm.logoUrl) + '" alt="">'
        : '<div class="dot"></div>';
      html += '<div class="row" style="' + rowStyle + '">'
            + '<div class="tcolor" style="background:' + (tm.color || '#ccc') + '"></div>'
            + logo
            + '<div class="nm" style="' + txtStyle + '">' + esc(tm.p1) + ' / ' + esc(tm.p2)
            + (tm.seed ? ' <span class="seed" style="' + seedStyle + '">(' + esc(tm.seed) + ')</span>' : '') + '</div>'
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
