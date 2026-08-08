/* StreamGraphics Pro — auto-reload on update.
 * Every live-events frame carries the app's version. When the app is updated and relaunched,
 * the connection reconnects to the new server and the version changes — so any open page
 * (an output window left running in OBS, a control tab, etc.) reloads itself to pick up the new
 * code. No more manually refreshing output windows after an update. Uses the shared connection. */
(function () {
  var known = null;
  function saw(v) {
    if (!v) return;
    if (known === null) { known = v; return; }   // first sighting just sets the baseline
    if (v !== known) { known = v; location.reload(); }
  }
  // Fast path: every live-events frame carries the version — reload the instant it changes.
  var es = SGLive('/events');
  es.onmessage = function (e) { try { var m = JSON.parse(e.data); if (m) saw(m.version); } catch (x) {} };
  // Backstop: also poll /version every 20s, so an update is caught even if the live
  // connection's reconnect is slow. A tiny request; does nothing while the version is unchanged.
  setInterval(function () {
    fetch('/version').then(function (r) { return r.json(); }).then(function (j) { if (j) saw(j.version); }).catch(function () {});
  }, 20000);
})();
