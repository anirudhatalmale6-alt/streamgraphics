/* StreamGraphics — Output renderer.
 * Subscribes to server state via SSE, then draws the live timer at 60fps.
 * The time value is computed locally from a server-anchored clock, so it stays
 * perfectly smooth and every machine agrees even if their clocks differ slightly. */
(function () {
  'use strict';

  var card = document.getElementById('timerCard');
  var animEl = card.querySelector('.anim');
  var timeEl = document.getElementById('time');
  var labelEl = document.getElementById('label');
  var accentEl = document.getElementById('accentbar');

  var POSITIONS = ['top-left','top-center','top-right','mid-left','mid-center','mid-right','bottom-left','bottom-center','bottom-right'];

  var timer = null;        // latest server timer state
  var clockOffset = 0;     // serverTime - clientTime
  var visibleNow = false;  // what the DOM currently reflects
  var hideTimer = null;

  function serverNow() { return Date.now() + clockOffset; }

  function liveValueMs(t, now) {
    if (t.mode === 'up')  return t.baseMs + (t.running ? now - t.anchorServer : 0);
    if (t.mode === 'tod') return Math.max(0, t.targetEpoch - now);
    return Math.max(0, t.baseMs - (t.running ? now - t.anchorServer : 0));
  }

  function fmt(ms, showHours) {
    var total = Math.floor(ms / 1000);
    var h = Math.floor(total / 3600);
    var m = Math.floor((total % 3600) / 60);
    var s = total % 60;
    var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
    if (showHours || h > 0) return pad(h) + ':' + pad(m) + ':' + pad(s);
    return pad(m) + ':' + pad(s);
  }

  function applyStyle(st) {
    if (!st) return;
    if (st.font)   { timeEl.style.fontFamily = st.font; labelEl.style.fontFamily = st.font; }
    if (st.color)  timeEl.style.color = st.color;
    if (st.size)   timeEl.style.fontSize = st.size + 'px';
    if (st.bg)     card.style.background = st.bg;
    if (st.accent) { accentEl.style.background = st.accent; accentEl.style.color = st.accent; }
    if (st.position && POSITIONS.indexOf(st.position) >= 0) {
      POSITIONS.forEach(function (p) { card.classList.remove('pos-' + p); });
      card.classList.add('pos-' + st.position);
    }
    if (st.animation) card.setAttribute('data-anim', st.animation);
  }

  function setVisible(v) {
    if (v === visibleNow) return;
    visibleNow = v;
    if (v) {
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
      card.classList.remove('is-hidden');
      // force reflow so the transition plays from the out state
      void card.offsetWidth;
      card.classList.remove('is-out');
    } else {
      card.classList.add('is-out');
      hideTimer = setTimeout(function () { card.classList.add('is-hidden'); }, 600);
    }
  }

  function onState(msg) {
    // smooth the clock offset a little to avoid jumps
    var measured = msg.serverTime - Date.now();
    clockOffset = clockOffset === 0 ? measured : Math.round(clockOffset * 0.7 + measured * 0.3);
    timer = msg.state.timer;
    applyStyle(timer.style);
    labelEl.textContent = timer.label || '';
    setVisible(!!timer.visible);
  }

  function tick() {
    if (timer) {
      var v = liveValueMs(timer, serverNow());
      timeEl.textContent = fmt(v, timer.showHours);
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  /* ---- SSE connection with auto-reconnect ---- */
  function connect() {
    var es = new EventSource('/events');
    es.onmessage = function (e) {
      try { onState(JSON.parse(e.data)); } catch (err) {}
    };
    es.onerror = function () { /* EventSource auto-reconnects; nothing to do */ };
  }
  connect();

  // expose for tests
  window.__sg = { get timer() { return timer; }, liveValueMs: liveValueMs, fmt: fmt };
})();
