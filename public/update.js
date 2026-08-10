/* In-app "update available" banner. Checks the vendor's version manifest via the server. */
(function () {
  fetch('/update-check').then(function (r) { return r.json(); }).then(function (u) {
    if (!u || !u.updateAvailable) return;
    var bar = document.createElement('div');
    // Top, not bottom — it's news you want noticed before you start a show, and the bottom of
    // these pages is where the working controls live.
    bar.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:2147483000;background:#12b886;color:#04231a;font:600 14px system-ui,Arial,sans-serif;padding:10px 16px;display:flex;align-items:center;gap:12px;justify-content:center;box-shadow:0 4px 14px rgba(0,0,0,.25)';
    var msg = document.createElement('span');
    msg.textContent = 'Update available — StreamGraphics Pro v' + u.latest + ' is out (you have v' + u.current + ').';
    bar.appendChild(msg);
    if (u.notes) { var n = document.createElement('span'); n.textContent = u.notes; n.style.cssText = 'font-weight:500;opacity:.85;max-width:40vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'; n.title = u.notes; bar.appendChild(n); }
    if (u.url) { var a = document.createElement('a'); a.href = u.url; a.target = '_blank'; a.textContent = 'Download →'; a.style.cssText = 'color:#04231a;font-weight:800;text-decoration:underline'; bar.appendChild(a); }
    var x = document.createElement('button'); x.textContent = '✕'; x.title = 'dismiss';
    x.style.cssText = 'background:none;border:none;color:#04231a;font-weight:800;cursor:pointer;font-size:15px';
    bar.appendChild(x);
    document.body.appendChild(bar);

    // Make room for it. The page header is sticky at top:0, so without this the banner would
    // sit on top of the nav and swallow the buttons underneath.
    var heads = document.querySelectorAll('.top, header.top');
    function shift(px) {
      document.body.style.paddingTop = px ? px + 'px' : '';
      heads.forEach(function (h) { h.style.top = px ? px + 'px' : ''; });
    }
    function reflow() { shift(bar.offsetHeight); }
    reflow();
    window.addEventListener('resize', reflow);
    x.onclick = function () { window.removeEventListener('resize', reflow); shift(0); bar.remove(); };
  }).catch(function () {});
})();
