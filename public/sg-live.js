/* StreamGraphics Pro — SGLive('/events'): a drop-in replacement for  new EventSource('/events')
 * that shares ONE connection across every tab (via sg-sse-worker.js), so opening lots of pages
 * never trips the browser's per-site connection limit. Returns an object with the same
 * .onopen / .onmessage / .onerror / .close surface as EventSource. Falls back to a real
 * EventSource when SharedWorker isn't available (e.g. some embedded browser sources). */
(function () {
  function SharedSource() {
    var self = this;
    this.onopen = null; this.onmessage = null; this.onerror = null; this.readyState = 0;
    var w = new SharedWorker('/sg-sse-worker.js');
    this._port = w.port;
    w.port.onmessage = function (ev) {
      var d = ev.data || {};
      if (d.type === 'open') { self.readyState = 1; if (self.onopen) self.onopen({}); }
      else if (d.type === 'message') { if (self.onmessage) self.onmessage({ data: d.data }); }
      else if (d.type === 'error') { self.readyState = 0; if (self.onerror) self.onerror({}); }
    };
    w.port.start();
    window.addEventListener('pagehide', function () {
      try { self._port.postMessage({ cmd: 'bye' }); } catch (e) {}
    });
  }
  SharedSource.prototype.close = function () {
    try { this._port.postMessage({ cmd: 'bye' }); } catch (e) {}
  };

  window.SGLive = function (url) {
    url = url || '/events';
    if (('SharedWorker' in self) && String(url).indexOf('/events') !== -1) {
      try { return new SharedSource(); } catch (e) { /* fall through to native */ }
    }
    return new EventSource(url);
  };
})();
