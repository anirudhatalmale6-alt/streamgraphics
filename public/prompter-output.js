/* StreamGraphics Pro — Teleprompter output.
 *
 * Draws the script and scrolls it at 60fps from a SERVER-anchored position. Nothing about
 * where we are lives in this page: the position is computed from (server clock, anchor,
 * speed) every frame. Two consequences, both of them the point of the module —
 *   1. A confidence monitor, a mirrored glass feed and an OBS browser source cannot drift
 *      apart, however long the read runs.
 *   2. If this page reloads mid-take (source restarted, machine hiccup, cache purge) it
 *      comes back where the script IS, not at the top.
 *
 * URL options:
 *   ?mirror=1   flip left-to-right, for a beam splitter
 *   ?flip=1     flip top-to-bottom, for a rig that reflects vertically
 *   ?bg=green   render on a solid chroma colour instead of the configured background
 *   ?preview=1  always draw, even when the prompter is off air (the control panel preview)
 */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var fitEl = $('fit'), stage = $('stage'), scroll = $('scroll'), doc = $('doc');
  var cue = $('cue'), cueLine = $('cueLine'), cueL = $('cueL'), cueR = $('cueR');
  var fadeTop = $('fadeTop'), fadeBot = $('fadeBot');

  var Q = new URLSearchParams(location.search);
  var FORCE = Q.get('preview') === '1';
  var CMAP = { green: '#00b140', magenta: '#ff00ff', blue: '#0000ff' };
  var urlChroma = (function () { var m = Q.get('bg'); return m ? (CMAP[m] || m) : null; })();
  if (Q.get('mirror') === '1') stage.classList.add('mirror-h');
  if (Q.get('flip') === '1') stage.classList.add('mirror-v');

  var P = null;            // latest prompter state from the server
  var clockOffset = 0;     // serverTime - clientTime
  var pad = 0;             // lead-in height of the current layout
  var ownTotal = 0;        // how far THIS page can scroll (its own metrics)
  var lastLayout = null;   // what this page last DREW (see layoutKey)

  function serverNow() { return Date.now() + clockOffset; }

  /* Same arithmetic as the server's livePromptPx. Kept here so the frame is computed
     locally at 60fps instead of waiting on a network message per frame. */
  function livePx(p, now) {
    var px = p.basePx + ((p.running && p.speed > 0) ? (now - p.anchorServer) * p.speed / 1000 : 0);
    // -1 = not measured yet (don't clamp); a measured 0 is a real ceiling. See server.js.
    var max = (p.geom && p.geom.sig) ? Math.max(0, p.geom.total) : -1;
    if (!(px > 0)) return 0;
    return (max >= 0 && px > max) ? max : px;
  }

  function send(a) {
    return fetch('/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(a) }).catch(function () {});
  }

  function applyChrome(p) {
    var s = p.style || {};
    var bg = urlChroma || (s.chroma ? (CMAP[s.chroma] || s.chroma) : (s.bg || ''));
    if (bg) { document.body.classList.add('solid'); document.body.style.setProperty('--pbg', bg); }
    else { document.body.classList.remove('solid'); }

    // Reading indicator
    var cp = Math.max(0, Math.min(100, Number(s.cuePos) || 0));
    var mode = s.cue || 'both';
    cue.style.display = (mode === 'none') ? 'none' : '';
    cue.style.top = (cp / 100 * SGPrompter.STAGE_H) + 'px';
    cue.style.height = '0';
    cue.style.color = s.cueColor || '#e03131';
    cueLine.style.background = s.cueColor || '#e03131';
    cueLine.style.display = (mode === 'line' || mode === 'both') ? '' : 'none';
    cueL.style.display = cueR.style.display = (mode === 'arrows' || mode === 'both') ? '' : 'none';

    // Soft edges. Fading to the background colour only works when there IS one; over a
    // transparent key we fade the TEXT out instead by masking, which OBS composites correctly.
    var on = !!s.fade;
    fadeTop.style.display = fadeBot.style.display = on ? '' : 'none';
    if (on) {
      if (bg) {
        fadeTop.style.background = 'linear-gradient(' + bg + ', transparent)';
        fadeBot.style.background = 'linear-gradient(transparent, ' + bg + ')';
        scroll.style.webkitMaskImage = scroll.style.maskImage = '';
      } else {
        fadeTop.style.background = fadeBot.style.background = '';
        var mask = 'linear-gradient(to bottom, transparent 0, #000 13%, #000 87%, transparent 100%)';
        scroll.style.webkitMaskImage = scroll.style.maskImage = mask;
      }
    } else {
      scroll.style.webkitMaskImage = scroll.style.maskImage = '';
    }
  }

  /* Re-lay the script out, measure it, and tell the server what it measured — but only when
     what the server holds isn't already a real measurement of THIS layout.
     🚨 Deliberately keyed on the server's stored geometry rather than "have I reported this
     signature before". A local one-shot flag looks equivalent and isn't: edit the script and
     put it back exactly as it was, and the signature returns to one this page has already
     reported, so it stays silent — while the server, which threw its measurement away when
     the text changed, waits for a report that never comes. Bookmarks and the time-remaining
     readout are then gone until something else moves. */
  function reportGeom(p) {
    var sg = SGPrompter.sig(p);
    if (p.geom && p.geom.sig === sg && p.geom.src === 'out') return;
    var m = SGPrompter.measure(doc, pad);
    send({ type: 'pr_geom', sig: sg, src: 'out', total: m.total, marks: m.marks });
  }

  function relayout(p) {
    pad = SGPrompter.render(doc, p);
    ownTotal = SGPrompter.measure(doc, pad).total;
  }

  /* What has to be REDRAWN, which is not the same list as what has to be RE-MEASURED.
     sig() covers everything that moves a line break, and the server keys its stored geometry
     on it. Cue position belongs here and not there: it changes the lead-in pad, so the page
     must draw again — but the pads always add up to one screen height and bookmark offsets are
     stored relative to the content, so nothing it changes is measurable. Left out of this key
     it produced a quiet fault: dragging the reading indicator moved the line and the arrows
     while the text stayed put, so the first line no longer began at the cue. */
  function layoutKey(p) {
    return SGPrompter.sig(p) + '|' + (Number((p.style || {}).cuePos) || 0);
  }

  function onState(msg) {
    var measured = msg.serverTime - Date.now();
    clockOffset = clockOffset === 0 ? measured : Math.round(clockOffset * 0.7 + measured * 0.3);
    var p = msg.state && msg.state.prompter;
    if (!p) return;
    P = p;
    var lk = layoutKey(p);
    applyChrome(p);
    if (lk !== lastLayout) { lastLayout = lk; relayout(p); }
    // Unconditionally, and after any re-layout: the colours are the part that must follow a
    // picker in real time without ever costing a measurement.
    SGPrompter.colors(doc, p);
    reportGeom(p);
    /* Off air hides the stage AND drops the solid background — a browser source left in a
       scene must key to nothing, not to a black rectangle. The watermark lives outside #fit
       so it is never hidden along with the script. */
    var live = !!(p.visible || FORCE);
    fitEl.style.visibility = live ? '' : 'hidden';
    if (!live) document.body.classList.remove('solid');
  }

  var lastY = -1;
  function tick() {
    if (P) {
      var px = livePx(P, serverNow());
      /* Map the shared position onto THIS screen's pixels. The two are the same on the
         machine that measured, and near enough on any other; what matters is that a screen
         whose font measures 2% taller still shows the same LINE at the same moment, rather
         than slowly sliding a paragraph out of step. */
      var refTotal = (P.geom && P.geom.total > 0) ? P.geom.total : 0;
      var y = (refTotal && ownTotal) ? (px / refTotal) * ownTotal : px;
      y = Math.round(y * 100) / 100;
      if (y !== lastY) { lastY = y; scroll.style.transform = 'translate3d(0,' + (-y) + 'px,0)'; }
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  /* The same keys as the control panel, so a confidence monitor showing this page can be
     driven from the keyboard next to it without switching windows. Harmless in OBS/vMix,
     which never send this page a key. */
  window.addEventListener('keydown', function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var k = e.key, big = e.shiftKey;
    var step = (P && P.jumpPx ? P.jumpPx : 220) * (big ? 4 : 1);
    if (k === ' ' || k === 'Spacebar') send({ type: 'pr_toggle' });
    else if (k === 'ArrowLeft')  send({ type: 'pr_speed', delta: big ? -20 : -5 });
    else if (k === 'ArrowRight') send({ type: 'pr_speed', delta: big ?  20 :  5 });
    else if (k === 'ArrowUp')    send({ type: 'pr_jump', px: -step });
    else if (k === 'ArrowDown')  send({ type: 'pr_jump', px: step });
    else if (k === 'Home')       send({ type: 'pr_top' });
    else if (k === 'PageUp')     send({ type: 'pr_mark', cmd: 'prev' });
    else if (k === 'PageDown')   send({ type: 'pr_mark', cmd: 'next' });
    else if (k >= '1' && k <= '9') {
      var n = +k - 1, ms = (P && P.geom && P.geom.marks) || [];
      if (n >= ms.length) return;
      send({ type: 'pr_goto', mark: n });
    }
    else return;
    e.preventDefault();
  });

  function refit() { SGPrompter.fit(fitEl, stage); }
  window.addEventListener('resize', refit);
  refit();

  var es = SGLive('/events');
  es.onmessage = function (e) { try { onState(JSON.parse(e.data)); } catch (err) {} };

  // expose for tests
  window.__sgp = {
    get state() { return P; },
    get y() { return lastY; },
    get ownTotal() { return ownTotal; },
    livePx: livePx
  };
})();
