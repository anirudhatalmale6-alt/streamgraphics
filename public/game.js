/* StreamGraphics — Football / basketball control panel. Sends actions; reflects live state.
 *
 * The clock readout here is computed exactly the way the OUTPUT computes it: from the server's
 * anchor plus this machine's offset from server time. It deliberately does NOT keep its own
 * count. An operator watching a panel that says 4:03 while the board says 4:01 stops trusting
 * both, and the one they will believe is the one on air. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var editing = null;                 // a field being typed into (don't clobber it on refresh)
  var game = null, clockOffset = 0;
  function serverNow() { return Date.now() + clockOffset; }

  function send(a) {
    return fetch('/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(a) }).catch(function () {});
  }

  /* ---- output URL ---- */
  (function () {
    SGLinks.onbase(function () {
      var url = SGLinks.url('/game-output');
      var a = $('outUrl'), b = $('outUrl2'); if (a) a.textContent = url; if (b) b.textContent = url;
    });
    $('copyBtn').onclick = function () { SGLinks.copy(SGLinks.url('/game-output'), this); };
  })();

  /* ---- clock maths: mirrors clockLeft() in server.js and left() in game-output.js ---- */
  function left(c) {
    if (!c) return 0;
    var ms = c.running ? (c.baseMs - (serverNow() - (c.anchorServer || serverNow()))) : c.baseMs;
    return Math.max(0, ms);
  }
  function fmtClock(ms) {
    if (ms >= 60000) {
      var m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000);
      return m + ':' + (s < 10 ? '0' : '') + s;
    }
    var sec = Math.floor(ms / 1000), t = Math.floor((ms % 1000) / 100);
    return sec + '.' + t;
  }
  function fmtShot(ms) { return ms > 5000 ? String(Math.ceil(ms / 1000)) : (Math.floor(ms / 1000)) + '.' + Math.floor((ms % 1000) / 100); }
  /* "12:00", "12", "90" and "1:30" all mean something obvious to a human, and an operator
     setting a clock mid-game is not going to be careful about which. A bare number is SECONDS
     when it is small enough to be seconds and minutes otherwise — 12 is twelve minutes on a
     game clock, which is what "period length 12" means to everyone who says it. */
  function parseClock(txt, bareIsMinutes) {
    var s = String(txt == null ? '' : txt).trim();
    if (!s) return null;
    var m = s.match(/^(\d{1,3}):([0-5]?\d)(?:\.(\d))?$/);
    if (m) return (+m[1]) * 60000 + (+m[2]) * 1000 + (m[3] ? (+m[3]) * 100 : 0);
    if (!/^\d{1,4}(\.\d)?$/.test(s)) return null;
    var n = parseFloat(s);
    if (!isFinite(n)) return null;
    return Math.round((bareIsMinutes && n <= 99 ? n * 60 : n) * 1000);
  }

  /* ---- on air ---- */
  $('btnShow').onclick = function () { send({ type: 'gm_show' }); };
  $('btnHide').onclick = function () { send({ type: 'gm_hide' }); };
  document.querySelectorAll('#sportSel button').forEach(function (b) {
    b.onclick = function () { send({ type: 'gm_sport', sport: b.dataset.sport }); };
  });

  /* ---- game clock ---- */
  $('btnClock').onclick = function () { send({ type: 'gm_clock', cmd: 'toggle' }); };
  document.querySelectorAll('[data-adj]').forEach(function (b) {
    b.onclick = function () { send({ type: 'gm_clock', cmd: 'adjust', ms: +b.dataset.adj }); };
  });
  $('btnClockSet').onclick = function () {
    var ms = parseClock($('clockSet').value, true);
    if (ms == null) { alert('Type a time like 12:00, or 45 for 45 seconds.'); return; }
    send({ type: 'gm_clock', cmd: 'set', ms: ms });
    $('clockSet').value = '';
  };
  $('clockSet').onkeydown = function (e) { if (e.key === 'Enter') $('btnClockSet').onclick(); };
  $('btnClockReset').onclick = function () { send({ type: 'gm_clock', cmd: 'reset' }); };
  $('btnLen').onclick = function () {
    var ms = parseClock($('lenSet').value, true);
    if (ms == null) { alert('Type a period length like 12:00.'); return; }
    send({ type: 'gm_clock', cmd: 'length', ms: ms });
  };

  /* ---- shot clock ---- */
  $('btnShot').onclick = function () { send({ type: 'gm_shot', cmd: 'toggle' }); };
  $('btnShotReset').onclick = function () { send({ type: 'gm_shot', cmd: 'reset' }); };
  $('btnShotReset2').onclick = function () { send({ type: 'gm_shot', cmd: 'reset2' }); };
  document.querySelectorAll('[data-shotadj]').forEach(function (b) {
    b.onclick = function () { send({ type: 'gm_shot', cmd: 'adjust', ms: +b.dataset.shotadj }); };
  });
  $('btnShotLen').onclick = function () {
    var full = parseClock($('shotLen').value, false), shortR = parseClock($('shotLen2').value, false);
    if (full != null) send({ type: 'gm_shot', cmd: 'length', ms: full });
    if (shortR != null) send({ type: 'gm_shot', cmd: 'reset2length', ms: shortR });
  };

  /* ---- teams ---- */
  document.querySelectorAll('.teamcard').forEach(function (card) {
    var ti = +card.dataset.team;
    card.querySelectorAll('input[data-f]').forEach(function (inp) {
      inp.addEventListener('focus', function () { editing = inp; });
      inp.addEventListener('blur', function () { editing = null; });
      inp.addEventListener('input', function () { var a = { type: 'gm_team', team: ti }; a[inp.dataset.f] = inp.value; send(a); });
    });
    card.querySelectorAll('[data-score]').forEach(function (b) { b.onclick = function () { send({ type: 'gm_score', team: ti, delta: +b.dataset.score }); }; });
    card.querySelectorAll('[data-to]').forEach(function (b) { b.onclick = function () { send({ type: 'gm_timeout', team: ti, delta: +b.dataset.to }); }; });
    card.querySelectorAll('[data-foul]').forEach(function (b) { b.onclick = function () { send({ type: 'gm_foul', team: ti, delta: +b.dataset.foul }); }; });
    card.querySelectorAll('[data-poss]').forEach(function (b) { b.onclick = function () { send({ type: 'gm_possession', team: ti }); }; });
  });

  /* ---- logo upload ---- */
  function uploadFile(file, done) {
    if (file.size > 25 * 1024 * 1024) { alert('That image is too large (over 25 MB). Use a smaller PNG/JPG.'); return; }
    var r = new FileReader();
    r.onload = function () {
      fetch('/upload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: file.name, data: r.result }) })
        .then(function (x) { return x.json(); })
        .then(function (res) { if (res && res.ok && res.url) done(res.url); else alert('Upload failed - try a PNG/JPG under ~15MB.'); })
        .catch(function () { alert('Upload failed.'); });
    };
    r.readAsDataURL(file);
  }
  document.querySelectorAll('[data-browse-team]').forEach(function (inp) {
    inp.onchange = function () { var f = inp.files[0]; if (!f) return; var ti = +inp.dataset.browseTeam; uploadFile(f, function (url) { send({ type: 'gm_team', team: ti, logoUrl: url }); }); inp.value = ''; };
  });

  /* ---- situation ---- */
  $('btnNewPeriod').onclick = function () { send({ type: 'gm_newPeriod' }); };
  $('btnPossNone').onclick  = function () { send({ type: 'gm_possession', cmd: 'none' }); };
  $('btnRestart').onclick   = function () { if (confirm('Restart the game? Scores, clock, period, fouls and timeouts reset (team names, colours and logos stay).')) send({ type: 'gm_restart' }); };
  document.querySelectorAll('[data-per]').forEach(function (b) { b.onclick = function () { send({ type: 'gm_period', delta: +b.dataset.per }); }; });
  $('periods').onchange   = function () { send({ type: 'gm_periods', n: +this.value }); };
  $('perCustom').addEventListener('focus', function () { editing = this; });
  $('perCustom').addEventListener('blur', function () { editing = null; });
  $('perCustom').oninput  = function () { send({ type: 'gm_periodLabel', label: this.value }); };
  document.querySelectorAll('[data-down]').forEach(function (b) { b.onclick = function () { send({ type: 'gm_down', n: +b.dataset.down }); }; });
  document.querySelectorAll('[data-dist]').forEach(function (b) { b.onclick = function () { send({ type: 'gm_distance', delta: +b.dataset.dist }); }; });
  $('btnGoal').onclick  = function () { send({ type: 'gm_distance', text: 'Goal' }); };
  // The single most-pressed sequence in a football broadcast, as one button.
  $('btnFirst').onclick = function () { send({ type: 'gm_down', n: 1 }); send({ type: 'gm_distance', n: 10 }); };
  $('ballOn').addEventListener('focus', function () { editing = this; });
  $('ballOn').addEventListener('blur', function () { editing = null; });
  $('ballOn').oninput   = function () { send({ type: 'gm_ballOn', text: this.value }); };
  $('btnFlag').onclick  = function () { send({ type: 'gm_flag' }); };

  /* ---- look ---- */
  var NUDGE_MAX = 600, curStyle = {};
  function showNudge(x, y) { $('nudgeV').textContent = x + ', ' + y; }
  document.querySelectorAll('#nudgePad button').forEach(function (b) {
    b.onclick = function (e) {
      var x, y;
      if (b.dataset.nreset) { x = 0; y = 0; }
      else {
        var step = e.shiftKey ? 25 : 5;
        x = (Math.round(Number(curStyle.offsetX)) || 0) + (+b.dataset.nx) * step;
        y = (Math.round(Number(curStyle.offsetY)) || 0) + (+b.dataset.ny) * step;
        x = Math.max(-NUDGE_MAX, Math.min(NUDGE_MAX, x));
        y = Math.max(-NUDGE_MAX, Math.min(NUDGE_MAX, y));
      }
      showNudge(x, y);
      send({ type: 'gm_style', style: { offsetX: x, offsetY: y } });
    };
  });
  $('stPos').onchange    = function () { send({ type: 'gm_style', style: { position: this.value } }); };
  $('stAnim').onchange   = function () { send({ type: 'gm_style', style: { animation: this.value } }); };
  $('stAccent').oninput  = function () { send({ type: 'gm_style', style: { accent: this.value } }); };
  $('chromaSel').onchange = function () { send({ type: 'gm_style', style: { chroma: this.value } }); };
  $('stTimeouts').onchange = function () { send({ type: 'gm_style', style: { showTimeouts: this.checked } }); };
  $('stDown').onchange   = function () { send({ type: 'gm_style', style: { showDown: this.checked } }); };
  $('stShot').onchange   = function () { send({ type: 'gm_style', style: { showShotClock: this.checked } }); };
  $('stFouls').onchange  = function () { send({ type: 'gm_style', style: { showFouls: this.checked } }); };

  /* ---- the two live readouts, on an animation frame like the output's ---- */
  function tick() {
    if (game) {
      var c = $('bigClock');
      c.textContent = fmtClock(left(game.clock));
      c.classList.toggle('running', !!(game.clock && game.clock.running));
      var s = $('bigShot');
      if (s) s.textContent = fmtShot(left(game.shot));
      if (s) s.classList.toggle('running', !!(game.shot && game.shot.running));
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  /* ---- reflect state ---- */
  function setVal(el, v) { if (el && document.activeElement !== el && el !== editing) el.value = v; }
  function ord(p) { var s = ['th', 'st', 'nd', 'rd'], v = p % 100; return p + (s[(v - 20) % 10] || s[v] || s[0]); }
  function render(g) {
    if (!g) return;
    game = g;
    var st = g.style || {};
    $('airState').textContent = g.visible ? 'ON AIR' : 'OFF AIR';
    $('airState').className = 'airstate' + (g.visible ? ' live' : '');

    var basket = (g.sport === 'basketball');
    document.body.className = 'sport-' + (basket ? 'basketball' : 'football');
    // One control, two names. Calling a play clock a shot clock in front of a football operator
    // is the kind of small wrongness that makes people distrust the rest of it.
    $('shotTitle').textContent = basket ? 'Shot clock' : 'Play clock';
    $('stShotLabel').textContent = basket ? 'Show shot clock' : 'Show play clock';
    $('shotHint').textContent = basket
      ? 'NBA 24 / 14 · NCAA 30 / 20 · FIBA 24 / 14. Set both to match your league.'
      : 'NFL 40 / 25 seconds. Set both to match your league.';
    document.querySelectorAll('#sportSel button').forEach(function (b) { b.classList.toggle('on', b.dataset.sport === g.sport); });

    $('btnClock').textContent = (g.clock && g.clock.running) ? 'STOP' : 'START';
    $('btnClock').classList.toggle('on', !!(g.clock && g.clock.running));
    $('btnShot').textContent = (g.shot && g.shot.running) ? 'STOP' : 'START';
    $('btnShot').classList.toggle('on', !!(g.shot && g.shot.running));
    setVal($('lenSet'), fmtClock(g.clock ? g.clock.lengthMs : 0));
    setVal($('shotLen'), String(Math.round((g.shot ? g.shot.lengthMs : 0) / 1000)));
    setVal($('shotLen2'), String(Math.round((g.shot && g.shot.resetMs != null ? g.shot.resetMs : 0) / 1000)));

    g.teams.forEach(function (t, ti) {
      var card = document.querySelector('.teamcard[data-team="' + ti + '"]');
      card.querySelectorAll('input[data-f]').forEach(function (inp) { setVal(inp, t[inp.dataset.f] == null ? '' : t[inp.dataset.f]); });
      $('sw' + ti).style.background = t.color || '#888';
      $('s' + ti).textContent = t.score | 0;
      $('t' + ti).textContent = t.timeouts | 0;
      $('f' + ti).textContent = t.fouls | 0;
      card.querySelectorAll('[data-poss]').forEach(function (b) {
        b.textContent = (g.possession === ti) ? '● Has possession' : 'Give possession';
        b.style.color = (g.possession === ti) ? (st.accent || '#f4a63c') : '';
      });
    });

    $('vPeriod').textContent = g.period;
    setVal($('periods'), String(g.periods));
    setVal($('perCustom'), g.periodLabel || '');
    $('perLabel').textContent = g.periodLabel || (g.period > g.periods ? 'OT' : ord(g.period));
    document.querySelectorAll('[data-down]').forEach(function (b) { b.classList.toggle('on', +b.dataset.down === (g.down | 0)); });
    $('vDist').textContent = g.distance;
    setVal($('ballOn'), g.ballOn || '');
    $('btnFlag').style.color = g.flag ? '#f4d03f' : '';

    setVal($('stPos'), st.position || 'bottom-center');
    curStyle = st;
    showNudge(Math.round(Number(st.offsetX)) || 0, Math.round(Number(st.offsetY)) || 0);
    setVal($('stAnim'), st.animation || 'slide-up');
    if (document.activeElement !== $('stAccent')) $('stAccent').value = st.accent || '#f4a63c';
    setVal($('chromaSel'), st.chroma || '');
    $('stTimeouts').checked = st.showTimeouts !== false;
    $('stDown').checked = st.showDown !== false;
    $('stShot').checked = st.showShotClock !== false;
    $('stFouls').checked = st.showFouls !== false;
  }

  /* ---- connect ---- */
  var conn = $('conn'), connTxt = $('connTxt');
  var es = SGLive('/events');
  es.onopen = function () { conn.classList.add('ok'); connTxt.textContent = 'live'; };
  es.onerror = function () { conn.classList.remove('ok'); connTxt.textContent = 'reconnecting…'; };
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
