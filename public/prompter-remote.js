/* StreamGraphics Pro — Prompter Remote.
 *
 * A phone or tablet held in one hand, driving the teleprompter from anywhere in the room.
 * Same state, same actions as the full control panel; only the surface is different.
 *
 * 🚨 The one thing that is NOT like the control panel: the position has to be worked out here,
 * every frame, from an anchor and a speed. The app deliberately does not push the scroll
 * position — it pushes "started at time T, moving at N px/s" — so a remote that only redrew on
 * a state message would show a frozen progress bar through an entire read and look broken.
 */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var P = null;
  var clockOffset = 0;

  function send(a) {
    return fetch('/action', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(a)
    }).catch(function () {});
  }

  function livePx(p, now) {
    var px = p.basePx + ((p.running && p.speed > 0) ? (now - p.anchorServer) * p.speed / 1000 : 0);
    var max = (p.geom && p.geom.sig) ? Math.max(0, p.geom.total) : -1;
    if (!(px > 0)) return 0;
    return (max >= 0 && px > max) ? max : px;
  }

  function mmss(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    var m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return m + ':' + (s < 10 ? '0' + s : s);
  }

  /* ---- transport ---- */
  $('btnPlay').onclick   = function () { send({ type: 'pr_toggle' }); };
  $('btnBack').onclick   = function () { send({ type: 'pr_jump', px: -(P && P.jumpPx ? P.jumpPx : 220) }); };
  $('btnAhead').onclick  = function () { send({ type: 'pr_jump', px: (P && P.jumpPx ? P.jumpPx : 220) }); };
  $('btnTop').onclick    = function () { send({ type: 'pr_top' }); };
  $('btnShow').onclick   = function () { send({ type: 'pr_show' }); };
  $('btnHide').onclick   = function () { send({ type: 'pr_hide' }); };

  /* ---- speed ----
     🚨 Mark hit this live: "you have to tap the buttons super fast over and over to change
     speed". He was right — going 40 to 140 was twenty separate taps on a phone. Two fixes,
     because they answer different needs:

       the SLIDER  — get roughly to a speed in one thumb drag
       HOLDING ±   — creep the last few units without overshooting

     Holding accelerates: slow at first so a normal tap is still exactly one step, then faster,
     so a long hold covers ground without the first press being twitchy. */
  var HOLD_FIRST = 420, HOLD_FAST = 110, HOLD_FLOOR = 45;

  function holdRepeat(el, step) {
    var timer = null, delay = HOLD_FIRST;

    function fire() {
      send({ type: 'pr_speed', delta: step });
      delay = Math.max(HOLD_FLOOR, delay === HOLD_FIRST ? HOLD_FAST : delay - 8);
      timer = setTimeout(fire, delay);
    }
    function start(e) {
      // Stop the browser turning a long press into a text selection or a callout.
      if (e.cancelable) e.preventDefault();
      if (timer) return;
      send({ type: 'pr_speed', delta: step });     // the tap itself, immediately
      delay = HOLD_FIRST;
      timer = setTimeout(fire, HOLD_FIRST);
    }
    function stop() {
      if (timer) { clearTimeout(timer); timer = null; }
      delay = HOLD_FIRST;
    }

    // Pointer events cover touch, pen and mouse in one path. pointercancel matters on iOS:
    // a scroll gesture starting on the button fires it, and without it the speed would keep
    // climbing after the thumb has gone.
    el.addEventListener('pointerdown', start);
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (ev) {
      el.addEventListener(ev, stop);
    });
    el.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  }
  holdRepeat($('btnSlower'), -5);
  holdRepeat($('btnFaster'), 5);

  /* The slider. While a thumb is on it the incoming state must NOT move it — the app echoes
     every change back, and a slider that jumps under the finger is unusable. */
  var slider = $('spdSlider'), dragging = false, lastSent = 0, sendTimer = null;

  function pushSpeed(v) {
    var now = Date.now();
    clearTimeout(sendTimer);
    if (now - lastSent > 90) { lastSent = now; send({ type: 'pr_speed', value: v }); }
    // Always land on the final value even if the last move was inside the throttle window.
    else sendTimer = setTimeout(function () { lastSent = Date.now(); send({ type: 'pr_speed', value: v }); }, 90);
  }

  slider.addEventListener('pointerdown', function () { dragging = true; });
  slider.addEventListener('input', function () {
    dragging = true;
    $('spdV').textContent = slider.value;         // the number follows the thumb straight away
    pushSpeed(Number(slider.value));
  });
  ['pointerup', 'pointercancel', 'change'].forEach(function (ev) {
    slider.addEventListener(ev, function () {
      dragging = false;
      pushSpeed(Number(slider.value));
    });
  });

  /* ---- preview ----
     What the talent is actually reading, on the phone. Built only when first opened: an iframe
     holds its own connection to the app, and a remote sitting closed in someone's pocket should
     not be running one. */
  var PV_KEY = 'sg.remote.preview';
  function setPreview(on) {
    $('pvBox').classList.toggle('on', on);
    $('btnPreview').classList.toggle('on', on);
    $('btnPreview').textContent = on ? '👁 Hide the preview' : '👁 Show what the talent sees';
    try { localStorage.setItem(PV_KEY, on ? '1' : '0'); } catch (e) {}
    if (on && !$('pvFrame').firstChild) {
      var f = document.createElement('iframe');
      // preview=1 draws even when the prompter is off air, which is the point on a rehearsal.
      f.src = '/prompter-output?preview=1';
      f.setAttribute('scrolling', 'no');
      f.setAttribute('title', 'What the talent sees');
      $('pvFrame').appendChild(f);
    }
  }
  $('btnPreview').onclick = function () { setPreview(!$('pvBox').classList.contains('on')); };
  (function () {
    var want = '0';
    try { want = localStorage.getItem(PV_KEY) || '0'; } catch (e) {}
    setPreview(want === '1');
  })();

  // Tap anywhere on the bar to send the read there. Uses touch coordinates as well as mouse,
  // because a tap on iOS reports through the same click event but the bar is only 14px tall —
  // the generous hit area comes from padding on the parent, so read the bar's own box.
  $('bar').onclick = function (e) {
    if (!P || !P.geom || !P.geom.total) return;
    var r = this.getBoundingClientRect();
    var f = Math.max(0, Math.min(1, (e.clientX - r.left) / (r.width || 1)));
    send({ type: 'pr_goto', px: Math.round(f * P.geom.total) });
  };

  /* ---- sections ----
     Rebuilt only when the NAMES change. Rebuilding on every frame would replace the button
     under the operator's thumb mid-tap, which on a touch screen cancels the tap. */
  var secKey = '';
  function renderSections(p) {
    var marks = (p && p.geom && p.geom.marks) || [];
    var key = marks.map(function (m) { return m.name; }).join(' ');
    if (key === secKey) return;
    secKey = key;

    var wrap = $('secs');
    wrap.innerHTML = '';
    $('noSecs').style.display = marks.length ? 'none' : '';
    marks.forEach(function (m, i) {
      var b = document.createElement('button');
      b.textContent = m.name;
      b.setAttribute('data-i', String(i));
      b.onclick = function () { send({ type: 'pr_goto', mark: i }); };
      wrap.appendChild(b);
    });
  }

  function currentSection(p, px) {
    var marks = (p && p.geom && p.geom.marks) || [];
    var i = -1;
    for (var k = 0; k < marks.length; k++) if (px + 1 >= (marks[k].y || 0)) i = k;
    return i;
  }

  /* ---- the frame ----
     Runs continuously, not only on state pushes — see the note at the top of the file. */
  function frame() {
    if (P) {
      var now = Date.now() + clockOffset;
      var px = livePx(P, now);
      var max = (P.geom && P.geom.sig) ? Math.max(0, P.geom.total) : -1;

      var pct = max > 0 ? Math.min(100, (px / max) * 100) : 0;
      $('barFill').style.width = pct + '%';
      $('posTxt').textContent = max > 0 ? Math.round(pct) + '%' : '—';
      $('leftTxt').textContent = (max > 0 && P.speed > 0) ? mmss((max - px) / P.speed) : '–:––';

      var cur = currentSection(P, px);
      var btns = $('secs').children;
      for (var i = 0; i < btns.length; i++) btns[i].classList.toggle('on', i === cur);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  function render(p) {
    P = p;
    var spd = Math.round(p.speed || 0);
    if (!dragging) {
      $('spdV').textContent = spd;
      /* Keep the track honest. The app allows far higher speeds than anyone reads at, so the
         slider covers the useful range and only stretches if the speed is actually set beyond
         it — a slider pinned at max while the number says 340 would simply be lying. */
      var max = Math.max(200, Math.ceil(spd / 50) * 50);
      if (Number(slider.max) !== max) slider.max = String(max);
      if (Number(slider.value) !== spd) slider.value = String(spd);
    }
    $('btnPlay').textContent = p.running ? 'HOLD' : 'PLAY';
    $('btnPlay').classList.toggle('on', !!p.running);
    $('airState').textContent = p.visible ? 'ON AIR' : 'OFF AIR';
    $('airState').classList.toggle('live', !!p.visible);
    $('btnShow').classList.toggle('live', !!p.visible);

    var nm = p.libName || '';
    $('scriptName').textContent = nm || 'Unsaved script';
    if (nm && p.libDirty) {
      var e = document.createElement('span');
      e.className = 'ed';
      e.textContent = 'edited';
      $('scriptName').appendChild(e);
    }

    var words = (String(p.script || '').match(/\S+/g) || []).length;
    $('wpmTxt').textContent = words ? words.toLocaleString() + ' words' : '';

    renderSections(p);
  }

  /* ---- stay awake ----
     A phone that sleeps mid-read is a remote that has stopped working. Best effort: not every
     browser has this, and it is dropped when the tab is backgrounded, so re-take it on return. */
  var lock = null;
  function keepAwake() {
    if (!navigator.wakeLock || document.visibilityState !== 'visible') return;
    navigator.wakeLock.request('screen').then(function (l) { lock = l; }).catch(function () {});
  }
  document.addEventListener('visibilitychange', keepAwake);
  keepAwake();

  function connect() {
    var es = SGLive('/events');
    es.onopen = function () { $('conn').className = 'conn ok'; };
    es.onmessage = function (e) {
      try {
        var m = JSON.parse(e.data);
        var measured = m.serverTime - Date.now();
        clockOffset = clockOffset === 0 ? measured : Math.round(clockOffset * 0.7 + measured * 0.3);
        if (m.state && m.state.prompter) render(m.state.prompter);
      } catch (x) {}
    };
    es.onerror = function () { $('conn').className = 'conn off'; };
  }
  connect();
})();
