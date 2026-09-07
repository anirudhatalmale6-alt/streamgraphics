/* StreamGraphics Pro — SGClock: what time is it on the SERVER?
 *
 * The teleprompter never pushes a scroll position. It pushes "you were at N pixels at server
 * time T, moving at S pixels a second", and every screen works out its own frame from that.
 * That is what keeps a confidence monitor, a mirror glass feed and an OBS source on the same
 * word forever. It also means the whole thing rests on one number: how far this browser's
 * clock is from the server's.
 *
 * 🚨 WHY THIS FILE EXISTS — the jerky-prompter bug (Sep 2026).
 * Each page used to work that number out from the state messages themselves:
 *     offset = msg.serverTime - Date.now()
 * and fold it in at 30% a message. Two things are wrong with it, and together they produced
 * exactly what the operator reported: perfectly smooth until you touch a control, then it
 * skips about for a minute and settles.
 *
 *   1. That measurement is NOT the clock difference. It is the clock difference MINUS however
 *      long the message took to arrive — network, then the shared-worker relay, then however
 *      long this tab's main thread was busy before it got round to the message. The error is
 *      one-sided: it can only ever make the offset read LOW, never high.
 *   2. The very first message is measured while the page is still loading and is therefore the
 *      worst sample of the lot — and it was adopted whole, because the "have I got one yet"
 *      test was `clockOffset === 0`.
 *
 * So the page started life with an offset that could be several hundred milliseconds out, and
 * the only thing that walked it back was more state messages — which only arrive when somebody
 * ACTS. Hence: quiet while nobody touches it; the moment the operator starts working, thirty
 * per cent of the remaining error is corrected on each message, and every correction shifts the
 * script under the reader by (error x speed). A minute of nudging later it has converged and
 * looks fine. The talent was reading a jumping script the whole time.
 *
 * What this does instead:
 *   - ASKS. A tiny /clock request, timed both ends, so the round trip is known and can be taken
 *     out: offset = serverT - (sent + received) / 2. Five at startup, one every 20 seconds
 *     after, and a couple more whenever the tab comes back to the foreground.
 *   - Keeps the sample with the SMALLEST round trip out of the last few, because the fastest
 *     exchange is the least contaminated one. This is how every clock sync does it and it is
 *     worth far more than averaging, which just spreads the delay around.
 *   - SLEWS instead of stepping. A correction is never applied in one frame; the clock is walked
 *     towards the truth at no more than 15% of real time. Below 1.0 that is not a jump at all —
 *     it cannot even run the script backwards — it is a few seconds of reading imperceptibly
 *     fast or slow. Only the very first fix, before anything is on screen, is applied whole.
 *
 * State messages are still accepted as a fallback (SGClock.passive), for the case where /clock
 * cannot be reached at all — but because their error is one-sided they are combined by taking
 * the MAXIMUM, not the average: the least-delayed message is the closest to the truth. Any real
 * probe beats all of them.
 */
(function (global) {
  'use strict';

  var PROBES_AT_START = 5;
  var PROBE_GAP_MS    = 120;
  var RESYNC_MS       = 20000;
  var WINDOW          = 8;
  var SLEW            = 0.15;    // never move the clock faster than 15% of real time
  var SLEW_CAP_MS     = 1000;    // a backgrounded tab must not bank hours of slew

  var probes  = [];   // {offset, rtt} from /clock — trustworthy, round trip known
  var passive = [];   // offsets derived from state messages — one-sided, used only as a backup
  var target  = 0;    // the offset we believe
  var applied = 0;    // the offset now() is actually using; walks towards target
  var seeded  = false;
  var lastAt  = 0;

  function recompute() {
    if (probes.length) {
      var best = probes[0];
      for (var i = 1; i < probes.length; i++) if (probes[i].rtt < best.rtt) best = probes[i];
      target = best.offset;
    } else if (passive.length) {
      // Delay only ever drags a passive sample DOWN, so the largest is the least wrong.
      var max = passive[0];
      for (var j = 1; j < passive.length; j++) if (passive[j] > max) max = passive[j];
      target = max;
    } else return;
    if (!seeded) { applied = target; seeded = true; }   // nothing drawn yet: no jump to hide
  }

  function probe() {
    var t0 = Date.now();
    fetch('/clock', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var t1 = Date.now();
        if (!j || typeof j.t !== 'number') return;
        probes.push({ offset: j.t - (t0 + t1) / 2, rtt: t1 - t0 });
        if (probes.length > WINDOW) probes.shift();
        recompute();
      })
      .catch(function () {});
  }

  function burst(n) { for (var i = 0; i < n; i++) setTimeout(probe, i * PROBE_GAP_MS); }

  burst(PROBES_AT_START);
  setInterval(probe, RESYNC_MS);
  if (global.document) {
    document.addEventListener('visibilitychange', function () {
      // Timers are throttled in a hidden tab, so the offset is stale the moment it comes back.
      if (!document.hidden) burst(2);
    });
  }

  global.SGClock = {
    /* Server time, slewed. Safe to call every frame — that is what it is for. */
    now: function () {
      var real = Date.now();
      var d = target - applied;
      if (d) {
        var dt = lastAt ? Math.max(0, Math.min(SLEW_CAP_MS, real - lastAt)) : 0;
        var step = dt * SLEW;
        applied += (Math.abs(d) <= step) ? d : (d > 0 ? step : -step);
      }
      lastAt = real;
      return real + applied;
    },
    /* A state message arrived. Only ever used if /clock is unreachable. */
    passive: function (serverTime) {
      if (probes.length || !(serverTime > 0)) return;
      passive.push(serverTime - Date.now());
      if (passive.length > WINDOW) passive.shift();
      recompute();
    },
    resync: function () { burst(2); },
    // exposed for tests
    _debug: function () { return { target: target, applied: applied, probes: probes.length }; }
  };
})(window);
