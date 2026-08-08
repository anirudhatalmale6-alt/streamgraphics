/* StreamGraphics Pro — shared live-events worker.
 * Holds ONE EventSource('/events') connection for ALL open tabs of the app, and fans every
 * update out to each tab. Without this, each tab opened its own connection and a handful of
 * tabs would exhaust the browser's ~6-connections-per-site limit and everything would freeze.
 * Falls back gracefully: pages use a normal EventSource if SharedWorker isn't available. */
'use strict';
var ports = [];
var last = null;      // most recent state frame, so a newly-opened tab gets current state at once
var opened = false;
var es = null;

function fanout(msg) {
  for (var i = ports.length - 1; i >= 0; i--) {
    try { ports[i].postMessage(msg); } catch (e) { ports.splice(i, 1); }
  }
}

function connect() {
  try { es = new EventSource('/events'); } catch (e) { return; }
  es.onopen = function () { opened = true; fanout({ type: 'open' }); };
  es.onmessage = function (e) { last = e.data; fanout({ type: 'message', data: e.data }); };
  es.onerror = function () { opened = false; fanout({ type: 'error' }); };
  // EventSource auto-reconnects on its own; nothing else to do here.
}
connect();

self.onconnect = function (e) {
  var port = e.ports[0];
  ports.push(port);
  port.start();
  port.onmessage = function (ev) {
    var d = ev.data || {};
    if (d.cmd === 'bye') { var i = ports.indexOf(port); if (i >= 0) ports.splice(i, 1); }
  };
  // Bring the new tab up to speed immediately.
  if (opened) port.postMessage({ type: 'open' });
  if (last != null) port.postMessage({ type: 'message', data: last });
};
