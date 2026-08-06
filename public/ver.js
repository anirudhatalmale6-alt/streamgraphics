/* Shows the running app version. Fills any .appver element; otherwise drops a small corner badge. */
(function () {
  fetch('/version').then(function (r) { return r.json(); }).then(function (j) {
    var v = 'v' + j.version;
    var els = document.querySelectorAll('.appver');
    if (els.length) { els.forEach(function (e) { e.textContent = v; }); return; }
    var b = document.createElement('div');
    b.textContent = v + '  ·  StreamGraphics Pro';
    b.style.cssText = 'position:fixed;right:8px;bottom:6px;font:600 11px system-ui,sans-serif;color:#8a97a8;background:rgba(20,26,34,.7);padding:3px 8px;border-radius:8px;z-index:99999;pointer-events:none';
    document.body.appendChild(b);
  }).catch(function () {});
})();
