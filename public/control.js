/* StreamGraphics — Control panel.
 * Sends actions to the server and reflects live state (so multiple operators,
 * or a reload mid-show, always show the true current state). */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };

  var timer = null, clockOffset = 0;

  function serverNow() { return Date.now() + clockOffset; }
  function liveValueMs(t, now) {
    if (t.mode === 'up')  return t.baseMs + (t.running ? now - t.anchorServer : 0);
    if (t.mode === 'tod') return Math.max(0, t.targetEpoch - now);
    return Math.max(0, t.baseMs - (t.running ? now - t.anchorServer : 0));
  }
  function fmt(ms, showHours) {
    var total = Math.floor(ms / 1000), h = Math.floor(total / 3600),
        m = Math.floor((total % 3600) / 60), s = total % 60,
        p = function (n) { return n < 10 ? '0' + n : '' + n; };
    return (showHours || h > 0) ? p(h) + ':' + p(m) + ':' + p(s) : p(m) + ':' + p(s);
  }

  /* ---- send an action ---- */
  function send(action) {
    return fetch('/action', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(action)
    }).catch(function () {});
  }

  /* ---- hex + opacity -> 8-digit hex ---- */
  function bgHex() {
    var hex = $('stBg').value; // #rrggbb
    var a = Math.round(Math.max(0, Math.min(100, +$('stBgA').value)) * 255 / 100);
    var ah = a.toString(16); if (ah.length < 2) ah = '0' + ah;
    return hex + ah;
  }
  function pushStyle() {
    send({ type: 'setStyle', style: {
      color: $('stColor').value,
      accent: $('stAccent').value,
      bg: bgHex(),
      // Read the typed box, not the slider — the slider tops out at 760 and would
      // silently throw away a bigger number the moment you typed one.
      size: (function () { var v = parseInt($('stSizeV').value, 10); return isFinite(v) ? Math.max(24, Math.min(1000, v)) : +$('stSize').value; })(),
      font: $('stFont').value,
      animation: $('stAnim').value
    }});
  }

  /* ---- wire timer controls ---- */
  document.querySelectorAll('.chip').forEach(function (c) {
    c.onclick = function () { send({ type: 'setMode', mode: c.dataset.mode }); };
  });
  $('setDur').onclick = function () {
    var ms = ((+$('durMin').value || 0) * 60 + (+$('durSec').value || 0)) * 1000;
    send({ type: 'setDuration', ms: ms });
  };
  $('setTod').onclick = function () {
    var parts = ($('todTime').value || '00:00:00').split(':').map(Number);
    var d = new Date();
    d.setHours(parts[0] || 0, parts[1] || 0, parts[2] || 0, 0);
    var epoch = d.getTime();
    if (epoch <= serverNow()) epoch += 86400000; // next day if the time already passed
    send({ type: 'setTarget', epoch: epoch });
  };
  $('btnStart').onclick = function () { send({ type: 'start' }); };
  $('btnPause').onclick = function () { send({ type: 'pause' }); };
  $('btnReset').onclick = function () { send({ type: 'reset' }); };
  document.querySelectorAll('[data-adj]').forEach(function (b) {
    b.onclick = function () { send({ type: 'adjust', ms: +b.dataset.adj }); };
  });
  $('label').oninput = function () { send({ type: 'setLabel', value: $('label').value }); };

  // speaker / confidence timer: warning threshold + overtime
  $('setWarn').onclick = function () {
    var ms = ((+$('warnMin').value || 0) * 60 + (+$('warnSec').value || 0)) * 1000;
    send({ type: 'setWarn', ms: ms });
  };
  $('warnOff').onclick = function () { send({ type: 'setWarn', ms: 0 }); };
  $('overtime').onchange = function () { send({ type: 'setOvertime', value: $('overtime').checked }); };
  $('flash').onchange = function () { send({ type: 'setFlash', value: $('flash').checked }); };

  $('btnOnAir').onclick = function () { send({ type: 'show' }); };
  $('btnOffAir').onclick = function () { send({ type: 'hide' }); };

  /* ---- wire look controls ---- */
  ['stColor','stAccent','stBg','stBgA','stFont','stAnim'].forEach(function (id) {
    $(id).oninput = pushStyle;
  });
  // Slider for a quick look, number box for an exact value. A presenter countdown on a
  // full-screen slide wants 500px+, which no sensible slider range covers on its own.
  $('stSize').oninput = function () { $('stSizeV').value = $('stSize').value; pushStyle(); };
  $('stSizeV').oninput = function () {
    var v = parseInt($('stSizeV').value, 10);
    if (!isFinite(v)) return;                       // mid-typing, leave it alone
    v = Math.max(24, Math.min(1000, v));
    $('stSize').value = Math.min(760, v);           // the slider just tracks it as far as it goes
    pushStyle();
  };
  document.querySelectorAll('#posGrid button').forEach(function (b) {
    b.onclick = function () {
      document.querySelectorAll('#posGrid button').forEach(function (x) { x.classList.remove('on'); });
      b.classList.add('on');
      send({ type: 'setStyle', style: { position: b.dataset.pos } });
    };
  });

  /* ---- reflect server state into the UI ---- */
  var editingLook = false; // avoid clobbering a control the user is dragging
  ['stColor','stAccent','stBg','stBgA','stSize','stSizeV','stFont','stAnim'].forEach(function (id) {
    $(id).addEventListener('focus', function () { editingLook = true; });
    $(id).addEventListener('blur', function () { editingLook = false; });
    $(id).addEventListener('change', function () { editingLook = false; });
  });

  function reflect(t) {
    // mode chips + mode blocks
    document.querySelectorAll('.chip').forEach(function (c) { c.classList.toggle('on', c.dataset.mode === t.mode); });
    document.querySelectorAll('.modeblock').forEach(function (mb) {
      mb.style.display = (mb.dataset.for === t.mode) ? 'flex' : 'none';
    });
    // on-air state
    var live = !!t.visible;
    $('btnOnAir').classList.toggle('live', live); $('btnOffAir').classList.toggle('standby', !live);
    // speaker timer reflect
    if (document.activeElement !== $('overtime')) $('overtime').checked = !!t.overtime;
    if (document.activeElement !== $('flash')) $('flash').checked = !!t.flash;
    $('pvLabel').textContent = t.label || '';
    // look controls (only when the user isn't actively editing them)
    if (!editingLook && t.style) {
      var s = t.style;
      if (s.color) $('stColor').value = s.color;
      if (s.accent) $('stAccent').value = s.accent;
      if (s.bg && /^#[0-9a-f]{8}$/i.test(s.bg)) {
        $('stBg').value = s.bg.slice(0, 7);
        $('stBgA').value = Math.round(parseInt(s.bg.slice(7), 16) / 255 * 100);
      }
      if (s.size) { $('stSize').value = Math.min(760, s.size); $('stSizeV').value = s.size; }
      if (s.font) $('stFont').value = s.font;
      if (s.animation) $('stAnim').value = s.animation;
      if (s.position) document.querySelectorAll('#posGrid button').forEach(function (b) {
        b.classList.toggle('on', b.dataset.pos === s.position);
      });
    }
  }

  function previewLoop() {
    if (timer) {
      $('pvTime').textContent = fmt(liveValueMs(timer, serverNow()), timer.showHours);
    }
    requestAnimationFrame(previewLoop);
  }
  requestAnimationFrame(previewLoop);

  /* ---- connection ---- */
  function connect() {
    var es = SGLive('/events');
    es.onopen = function () { $('conn').className = 'conn ok'; $('connTxt').textContent = 'live'; };
    es.onmessage = function (e) {
      try {
        var msg = JSON.parse(e.data);
        var measured = msg.serverTime - Date.now();
        clockOffset = clockOffset === 0 ? measured : Math.round(clockOffset * 0.7 + measured * 0.3);
        timer = msg.state.timer;
        reflect(timer);
      } catch (err) {}
    };
    es.onerror = function () { $('conn').className = 'conn off'; $('connTxt').textContent = 'reconnecting…'; };
  }
  connect();

  // fill the OBS output URL hint with the real host
  // Show (and copy) the address another computer can actually reach — a localhost
  // link points the far machine at itself. SGLinks upgrades this once /netinfo answers.
  SGLinks.onbase(function () { $('outUrl').textContent = SGLinks.url('/output'); });
  if ($('copyOut')) $('copyOut').onclick = function () { SGLinks.copy($('outUrl').textContent, this); };
})();
