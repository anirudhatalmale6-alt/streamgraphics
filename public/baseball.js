/* StreamGraphics — Baseball / softball control panel. Sends actions; reflects live state. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var editing = null;   // a field being typed into (don't clobber it on refresh)

  function send(a) {
    return fetch('/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(a) }).catch(function () {});
  }

  /* ---- output URL (use this machine's address for OBS/vMix) ----
     location.hostname is localhost when the panel is open on the StreamGraphics
     computer, and a copied localhost link sends the far machine to itself. SGLinks
     swaps in this computer's LAN address as soon as /netinfo answers. */
  (function () {
    SGLinks.onbase(function () {
      var url = SGLinks.url('/baseball-output');
      var a = $('outUrl'), b = $('outUrl2'); if (a) a.textContent = url; if (b) b.textContent = url;
    });
    $('copyBtn').onclick = function () { SGLinks.copy(SGLinks.url('/baseball-output'), this); };
  })();

  /* ---- on-air ---- */
  $('btnShow').onclick = function () { send({ type: 'bl_show' }); };
  $('btnHide').onclick = function () { send({ type: 'bl_hide' }); };

  /* ---- game setup ---- */
  $('innings').onchange = function () { send({ type: 'bl_innings', n: +this.value }); };
  $('stPos').onchange   = function () { send({ type: 'bl_style', style: { position: this.value } }); };

  /* ---- fine position nudge ----
   * Walks the board off whichever of the 9 anchors is selected. Steps apply to the last value
   * the SERVER sent back rather than to a local counter, so two panels on the same board stay
   * in step. See scoreboard.js - same control, same reasoning. */
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
      send({ type: 'bl_style', style: { offsetX: x, offsetY: y } });
    };
  });
  $('stAnim').onchange  = function () { send({ type: 'bl_style', style: { animation: this.value } }); };
  $('stAccent').oninput = function () { send({ type: 'bl_style', style: { accent: this.value } }); };
  $('chromaSel').onchange = function () { send({ type: 'bl_style', style: { chroma: this.value } }); };
  $('stLine').onchange  = function () { send({ type: 'bl_style', style: { showLine: this.checked } }); };
  $('stClock').onchange = function () { $('stClockText').style.display = this.checked ? '' : 'none'; send({ type: 'bl_style', style: { showClock: this.checked } }); };
  $('stClockText').oninput = function () { send({ type: 'bl_style', style: { clockText: this.value } }); };

  /* ---- team fields ---- */
  document.querySelectorAll('.teamcard').forEach(function (card) {
    var ti = +card.dataset.team;
    card.querySelectorAll('input[data-f]').forEach(function (inp) {
      inp.addEventListener('focus', function () { editing = inp; });
      inp.addEventListener('blur', function () { editing = null; });
      var ev = (inp.type === 'color') ? 'input' : 'input';
      inp.addEventListener(ev, function () { var a = { type: 'bl_team', team: ti }; a[inp.dataset.f] = inp.value; send(a); });
    });
    card.querySelectorAll('[data-run]').forEach(function (b) { b.onclick = function () { send({ type: 'bl_run', team: ti, delta: +b.dataset.run }); }; });
    card.querySelectorAll('[data-stat]').forEach(function (b) { b.onclick = function () { send({ type: 'bl_stat', team: ti, stat: b.dataset.stat, delta: +b.dataset.d }); }; });
  });

  /* ---- browse for a logo ---- */
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
    inp.onchange = function () { var f = inp.files[0]; if (!f) return; var ti = +inp.dataset.browseTeam; uploadFile(f, function (url) { send({ type: 'bl_team', team: ti, logoUrl: url }); }); inp.value = ''; };
  });

  /* ---- situation ---- */
  document.querySelectorAll('[data-count]').forEach(function (b) { b.onclick = function () { var a = { type: 'bl_count' }; a[b.dataset.count] = +b.dataset.d; send(a); }; });
  document.querySelectorAll('[data-base]').forEach(function (b) { b.onclick = function () { send({ type: 'bl_base', base: b.dataset.base }); }; });
  $('btnAdvance').onclick = function () { send({ type: 'bl_advance' }); };
  $('btnBack').onclick    = function () { send({ type: 'bl_back' }); };
  $('btnClear').onclick   = function () { send({ type: 'bl_clearCount' }); };
  $('btnRestart').onclick = function () { if (confirm('Restart the game? Scores, count and innings reset (team names & looks stay).')) send({ type: 'bl_restart' }); };

  /* ---- editable line score ---- */
  function buildLineScore(bb) {
    var t = $('lstable');
    if (editing && editing.classList && editing.classList.contains('lscell')) return;   // don't rebuild while typing a cell
    var n = bb.innings, head = '<tr><th></th>';
    for (var i = 1; i <= n; i++) head += '<th>' + i + '</th>';
    head += '<th>R</th><th>H</th><th>E</th></tr>';
    function row(team, ti) {
      var tds = '<td class="tm">' + (team.abbr || team.name || (ti ? 'HOME' : 'AWAY')) + '</td>';
      for (var k = 0; k < n; k++) {
        var v = team.line[k] == null ? '' : team.line[k];
        tds += '<td><input class="lscell" data-team="' + ti + '" data-inning="' + k + '" value="' + v + '" inputmode="numeric"></td>';
      }
      var R = team.line.reduce(function (s, x) { return s + (x == null ? 0 : (+x || 0)); }, 0);
      tds += '<td style="font-weight:900">' + R + '</td><td>' + (team.hits || 0) + '</td><td>' + (team.errors || 0) + '</td>';
      return '<tr>' + tds + '</tr>';
    }
    t.innerHTML = '<thead>' + head + '</thead><tbody>' + row(bb.teams[0], 0) + row(bb.teams[1], 1) + '</tbody>';
    t.querySelectorAll('.lscell').forEach(function (inp) {
      inp.addEventListener('focus', function () { editing = inp; });
      inp.addEventListener('blur', function () { editing = null; send({ type: 'bl_setRun', team: +inp.dataset.team, inning: +inp.dataset.inning, value: inp.value }); });
      inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') inp.blur(); });
    });
  }

  /* ---- reflect state ---- */
  function setVal(el, v) { if (el && document.activeElement !== el && el !== editing) el.value = v; }
  function render(bb) {
    if (!bb) return;
    var st = bb.style || {};
    $('airState').textContent = bb.visible ? 'ON AIR' : 'OFF AIR';
    $('airState').className = 'airstate' + (bb.visible ? ' live' : '');
    setVal($('innings'), String(bb.innings));
    setVal($('stPos'), st.position || 'bottom-left');
    curStyle = st;
    showNudge(Math.round(Number(st.offsetX)) || 0, Math.round(Number(st.offsetY)) || 0);
    setVal($('stAnim'), st.animation || 'slide-up');
    if (document.activeElement !== $('stAccent')) $('stAccent').value = st.accent || '#f4a63c';
    setVal($('chromaSel'), st.chroma || '');
    $('stLine').checked = !!st.showLine;
    $('stClock').checked = !!st.showClock;
    $('stClockText').style.display = st.showClock ? '' : 'none';
    setVal($('stClockText'), st.clockText || '');

    bb.teams.forEach(function (t, ti) {
      var card = document.querySelector('.teamcard[data-team="' + ti + '"]');
      card.querySelectorAll('input[data-f]').forEach(function (inp) { setVal(inp, t[inp.dataset.f] == null ? '' : t[inp.dataset.f]); });
      $('sw' + ti).style.background = t.color || '#888';
      $('h' + ti).textContent = t.hits || 0;
      $('e' + ti).textContent = t.errors || 0;
    });

    $('vBalls').textContent = bb.balls;
    $('vStrikes').textContent = bb.strikes;
    $('vOuts').textContent = bb.outs;
    document.querySelectorAll('[data-base]').forEach(function (b) { b.classList.toggle('on', !!(bb.bases && bb.bases[b.dataset.base])); });
    $('halfLabel').textContent = (bb.half === 'bottom' ? 'Bottom ' : 'Top ') + bb.inning;

    buildLineScore(bb);
  }

  /* ---- connect ---- */
  var conn = $('conn'), connTxt = $('connTxt');
  var es = SGLive('/events');
  es.onopen = function () { conn.classList.add('ok'); connTxt.textContent = 'live'; };
  es.onerror = function () { conn.classList.remove('ok'); connTxt.textContent = 'reconnecting…'; };
  es.onmessage = function (e) { try { var msg = JSON.parse(e.data); if (msg.state && msg.state.baseball) render(msg.state.baseball); } catch (err) {} };
})();
