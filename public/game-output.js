/* StreamGraphics — Football / basketball output renderer.
 *
 * 🚨 The clock is NOT pushed down this connection tick by tick. The server sends an anchor and a
 * base — "there were 8:12 left, as of server time T" — and this page works out the rest itself on
 * an animation frame. Pushing a number every second would put the board at the mercy of the
 * network for the one thing on it nobody forgives being wrong, and would put a second board on a
 * different second. Same approach as the teleprompter's scroll position and the Presenter's Timer.
 *
 * clockOffset is the difference between this machine's clock and the server's, smoothed. Without
 * it, a browser whose clock is forty seconds fast shows a game clock forty seconds out and every
 * other screen disagrees with it.
 */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var card = $('gmCard'), bug = $('bug');
  var POSITIONS = ['top-left','top-center','top-right','mid-left','mid-center','mid-right','bottom-left','bottom-center','bottom-right'];

  var game = null, clockOffset = 0, visibleNow = false, hideTimer = null;
  function serverNow() { return Date.now() + clockOffset; }

  function nudge(v) {
    var n = Math.round(Number(v));
    if (!isFinite(n)) return 0;
    return n < -600 ? -600 : (n > 600 ? 600 : n);
  }

  var FORCE = new URLSearchParams(location.search).get('preview') === '1';
  var CMAP = { green: '#00b140', magenta: '#ff00ff', blue: '#0000ff' };
  var urlChroma = (function () { var m = new URLSearchParams(location.search).get('bg'); return m ? (CMAP[m] || m) : null; })();
  function applyChroma(c) {
    var col = urlChroma || (c ? (CMAP[c] || c) : '');
    if (col) { document.documentElement.style.setProperty('--chroma', col); document.body.classList.add('chroma'); }
    else document.body.classList.remove('chroma');
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }

  /* Time left on a server-anchored clock. Mirrors clockLeft() in server.js — if that rule ever
     changes it changes in both places, or the board and the panel show different numbers. */
  function left(c) {
    if (!c) return 0;
    var ms = c.running ? (c.baseMs - (serverNow() - (c.anchorServer || serverNow()))) : c.baseMs;
    return Math.max(0, ms);
  }
  /* Broadcast convention, and it is not decoration: under a minute the tenths are what the
     audience is watching, and above it the tenths are noise that makes the number unreadable. */
  function fmtClock(ms) {
    if (ms >= 60000) {
      var m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000);
      return m + ':' + (s < 10 ? '0' : '') + s;
    }
    var sec = Math.floor(ms / 1000), t = Math.floor((ms % 1000) / 100);
    return sec + '.' + t;
  }
  function fmtShot(ms) {
    // A shot clock counts whole seconds up to the last five, then tenths — same reasoning.
    if (ms > 5000) return String(Math.ceil(ms / 1000));
    return (Math.floor(ms / 1000)) + '.' + Math.floor((ms % 1000) / 100);
  }
  // 1st / 2nd / 3rd / 4th, then OT, OT2… — what a board actually says once a game runs long.
  function ord(p) {
    var s = ['th', 'st', 'nd', 'rd'], v = p % 100;
    return p + (s[(v - 20) % 10] || s[v] || s[0]);
  }
  function periodLabel(g) {
    if (g.periodLabel) return g.periodLabel;
    var p = g.period | 0, n = g.periods | 0;
    if (p > n) return (p - n) > 1 ? ('OT' + (p - n)) : 'OT';
    return ord(p);
  }

  function pips(nLeft, nTotal) {
    var out = '';
    for (var i = 0; i < nTotal; i++) out += '<i class="' + (i < nLeft ? 'on' : '') + '"></i>';
    return out;
  }

  function teamRow(g, t, idx) {
    var basket = g.sport === 'basketball';
    var st = g.style || {};
    var logo = t.logoUrl ? '<img class="lg" src="' + esc(t.logoUrl) + '" alt="">' : '<span class="lg"></span>';
    // The bonus threshold is the common one (5 team fouls in a period). It is derived, never
    // stored — a stored flag and a foul count are two sources for one fact.
    var bonus = basket && (t.fouls | 0) >= 5;
    var has = (g.possession === idx);
    return '<div class="trow' + (has ? ' has' : '') + (bonus ? ' bonus' : '') + '">'
      + '<span class="bar" style="background:' + esc(t.color || '#888') + '"></span>'
      + '<span class="poss">' + (idx === 0 ? '▶' : '▶') + '</span>'
      + logo
      + '<span class="ab">' + esc(t.abbr || '') + '</span>'
      + '<span class="nm">' + esc(t.name || '') + '</span>'
      + (basket && st.showFouls !== false
          ? '<span class="fl"><span class="n">' + (t.fouls | 0) + (bonus ? '*' : '') + '</span><span class="l">FOULS</span></span>' : '')
      + (st.showTimeouts !== false ? '<span class="tos">' + pips(t.timeouts | 0, Math.max(3, t.timeouts | 0)) + '</span>' : '')
      + '<span class="sc">' + (t.score | 0) + '</span>'
      + '</div>';
  }

  function build(g) {
    var st = g.style || {};
    var basket = g.sport === 'basketball';
    var clkMs = left(g.clock), shotMs = left(g.shot);

    var sit = '<div class="blk clk' + (g.clock && g.clock.running ? '' : ' stopped') + '">'
        + '<div class="num" id="clkNum">' + fmtClock(clkMs) + '</div><div class="lbl">CLOCK</div></div>'
      + '<div class="blk small"><div class="num">' + esc(periodLabel(g)) + '</div><div class="lbl">PERIOD</div></div>';

    // The same second clock, called what the sport calls it.
    if (st.showShotClock !== false) {
      sit += '<div class="blk shot' + (g.shot && g.shot.running ? '' : ' stopped') + '">'
           + '<div class="num" id="shotNum">' + fmtShot(shotMs) + '</div><div class="lbl">'
           + (basket ? 'SHOT' : 'PLAY') + '</div></div>';
    }
    if (!basket && st.showDown !== false) {
      var dn = ['', '1ST', '2ND', '3RD', '4TH'][g.down | 0] || '1ST';
      var dist = (g.distance === 0 || g.distance === '0') ? 'GOAL' : g.distance;
      sit += '<div class="blk wide"><div class="num" style="font-size:22px">' + esc(dn + ' & ' + dist) + '</div><div class="lbl">DOWN</div></div>';
      // "HER 34" wraps onto two lines in a 44px block, which makes the bug taller than every
      // other board on the show. Wide enough for a yard line, and it never wraps.
      if (g.ballOn) sit += '<div class="blk small" style="min-width:84px"><div class="num" style="white-space:nowrap">' + esc(g.ballOn) + '</div><div class="lbl">BALL ON</div></div>';
      if (g.flag) sit += '<div class="flag">FLAG</div>';
    }

    bug.innerHTML = '<div class="teams">' + teamRow(g, g.teams[0], 0) + teamRow(g, g.teams[1], 1) + '</div>'
                  + '<div class="sit">' + sit + '</div>';
  }

  /* Only the two numbers that move are rewritten between renders. Rebuilding the whole bug every
     frame would restart the logo images and make the board flicker on a slow machine — which is
     exactly the machine that is also running OBS. */
  function tick() {
    if (game) {
      var n = $('clkNum'); if (n) n.textContent = fmtClock(left(game.clock));
      var s = $('shotNum'); if (s) s.textContent = fmtShot(left(game.shot));
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  var sig = '';
  function render(g) {
    if (!g) return;
    game = g;
    var st = g.style || {};
    var pos = 'pos-' + (POSITIONS.indexOf(st.position) >= 0 ? st.position : 'bottom-center');
    card.className = 'gm ' + pos + (visibleNow ? '' : ' is-out') + (card.classList.contains('is-hidden') ? ' is-hidden' : '');
    card.setAttribute('data-anim', ['slide-up', 'fade', 'scale'].indexOf(st.animation) >= 0 ? st.animation : 'slide-up');
    card.style.setProperty('--accent', st.accent || '#f4a63c');
    card.style.setProperty('--nx', nudge(st.offsetX) + 'px');
    card.style.setProperty('--ny', nudge(st.offsetY) + 'px');
    applyChroma(st.chroma);

    // Everything EXCEPT the live clock numbers decides whether a rebuild is needed — they are
    // excluded on purpose, or the bug would be rebuilt on every message.
    var newSig = JSON.stringify([g.sport, g.period, g.periods, g.periodLabel, g.possession, g.down,
      g.distance, g.ballOn, g.flag, g.teams, st.showDown, st.showFouls, st.showTimeouts, st.showShotClock,
      !!(g.clock && g.clock.running), !!(g.shot && g.shot.running)]);
    if (newSig !== sig) { sig = newSig; build(g); }

    var vis = g.visible || FORCE;
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
    try {
      var msg = JSON.parse(e.data);
      if (msg.serverTime) {
        var meas = msg.serverTime - Date.now();
        clockOffset = clockOffset === 0 ? meas : Math.round(clockOffset * 0.7 + meas * 0.3);
      }
      if (msg.state && msg.state.game) render(msg.state.game);
    } catch (err) {}
  };
})();
