/* Free-version watermark on the OUTPUT. Removed automatically when a valid license is active.
 *
 * It used to sit in the bottom-right corner, which turned out to be no deterrent at all: a
 * browser source can be cropped in OBS/vMix in about five seconds, and the corner is the first
 * thing anyone trims. Two people spotted that within one demo.
 *
 * So the mark no longer lives at an edge. Two things carry it:
 *
 *   1. A mark centred on EVERY graphic on screen. To crop this one away you have to crop the
 *      lower third or the scoreboard away with it, which defeats the point of running the app.
 *      Covering it with a box in OBS means covering your own graphic.
 *   2. A mark in the middle of frame, drifting slowly on a long loop. A static crop or a
 *      parked cover-up box cannot sit on a moving target, and with nothing on air it is still
 *      obvious the output is unlicensed.
 *
 * It also puts itself back if it is deleted from the page. That stops the casual "open dev
 * tools and remove the element" trick. It is NOT meant to stop someone determined - this is
 * ordinary client-side JavaScript on the customer's own machine and anyone who edits the file
 * can take it out. The job here is to make the free version obviously free, not to be DRM.
 */
(function () {
  'use strict';

  var TEXT = 'StreamGraphics Pro';
  var TICK = 250;          // how often the marks are re-measured, ms
  var DRIFT_MS = 23000;    // one full loop of the centre mark's wander
  var MIN_BOX = 70;        // ignore anything smaller than this - not a real graphic

  var root = null, centre = null, on = false, timer = null, t0 = Date.now();

  function css(el, s) { el.style.cssText = s; }

  function markStyle(size) {
    return 'position:absolute;left:0;top:0;white-space:nowrap;'
         + 'font:700 ' + size + 'px system-ui,Arial,sans-serif;'
         + 'color:rgba(255,255,255,.62);'
         + 'text-shadow:0 2px 10px rgba(0,0,0,.85),0 0 2px rgba(0,0,0,.9);'
         + 'letter-spacing:.02em;pointer-events:none;will-change:transform';
  }

  function build() {
    root = document.createElement('div');
    root.id = 'sgpro-wm';
    css(root, 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;overflow:hidden');
    centre = document.createElement('div');
    centre.textContent = TEXT;
    css(centre, markStyle(46));
    root.appendChild(centre);
    document.body.appendChild(root);
  }

  /* Put it back if something removes it. */
  function guard() {
    var mo = new MutationObserver(function () {
      if (on && root && !document.body.contains(root)) document.body.appendChild(root);
    });
    mo.observe(document.body, { childList: true });
  }

  /* Every graphic currently on screen: the visible children of the stage, plus the stage's
   * grandchildren for pages that wrap each graphic in a positioning layer. */
  function graphics() {
    var stage = document.getElementById('stage');
    if (!stage) return [];
    var out = [], seen = [];
    var kids = stage.children;
    for (var i = 0; i < kids.length; i++) {
      var el = kids[i];
      if (el === root || el.id === 'sgpro-wm') continue;
      var cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.05) continue;
      var r = el.getBoundingClientRect();
      if (r.width < MIN_BOX || r.height < MIN_BOX) continue;
      if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
      out.push(r); seen.push(el);
    }
    return out;
  }

  /* Marks are pooled: reused between ticks so we are not churning DOM nodes 4x a second. */
  var pool = [];
  function markAt(i, rect) {
    var m = pool[i];
    if (!m) {
      m = document.createElement('div');
      m.textContent = TEXT;
      pool[i] = m;
      root.appendChild(m);
    }
    // Size the mark to the graphic it sits on, so it stays legible on a small bug and does not
    // overflow a wide lower third.
    var size = Math.max(18, Math.min(44, Math.round(rect.width / 11)));
    m.style.cssText = markStyle(size);
    m.style.display = 'block';
    var w = m.offsetWidth, h = m.offsetHeight;
    var x = rect.left + (rect.width - w) / 2;
    var y = rect.top + (rect.height - h) / 2;
    m.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px)';
    return m;
  }

  function tick() {
    if (!on) return;
    var boxes = graphics();
    for (var i = 0; i < boxes.length; i++) markAt(i, boxes[i]);
    for (var j = boxes.length; j < pool.length; j++) if (pool[j]) pool[j].style.display = 'none';

    // the drifting centre mark - a slow Lissajous so it never repeats a straight line
    var p = ((Date.now() - t0) % DRIFT_MS) / DRIFT_MS * Math.PI * 2;
    var cw = centre.offsetWidth, ch = centre.offsetHeight;
    var cx = (innerWidth - cw) / 2 + Math.cos(p) * innerWidth * 0.16;
    var cy = (innerHeight - ch) / 2 + Math.sin(p * 2) * innerHeight * 0.13;
    centre.style.transform = 'translate(' + Math.round(cx) + 'px,' + Math.round(cy) + 'px)';
  }

  function apply(licensed) {
    if (licensed) {
      on = false;
      if (timer) { clearInterval(timer); timer = null; }
      if (root) root.style.display = 'none';
      return;
    }
    if (!root) { build(); guard(); }
    on = true;
    root.style.display = 'block';
    tick();
    if (!timer) timer = setInterval(tick, TICK);
  }

  var es = SGLive('/events');
  es.onmessage = function (e) {
    try {
      var m = JSON.parse(e.data);
      if (m.state && typeof m.state.licensed !== 'undefined') apply(!!m.state.licensed);
    } catch (x) {}
  };
})();
