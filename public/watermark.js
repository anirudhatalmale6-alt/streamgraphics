/* Free-version watermark on the OUTPUT. Removed automatically when a valid license is active. */
(function () {
  var el = null;
  function ensure() {
    if (el) return el;
    el = document.createElement('div');
    el.textContent = 'StreamGraphics Pro';
    el.style.cssText = 'position:fixed;right:16px;bottom:12px;font:600 15px system-ui,Arial,sans-serif;color:rgba(255,255,255,.72);text-shadow:0 1px 4px rgba(0,0,0,.65);letter-spacing:.02em;z-index:2147483647;pointer-events:none';
    document.body.appendChild(el);
    return el;
  }
  function apply(licensed) { if (licensed) { if (el) el.style.display = 'none'; } else { ensure().style.display = 'block'; } }
  var es = new EventSource('/events');
  es.onmessage = function (e) { try { var m = JSON.parse(e.data); if (m.state && typeof m.state.licensed !== 'undefined') apply(!!m.state.licensed); } catch (x) {} };
})();
