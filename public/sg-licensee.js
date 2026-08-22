/* StreamGraphics Pro — who this copy is licensed to, on every control panel.
 *
 * The deterrent, and the only one that costs a real customer nothing: a key that gets passed
 * around carries the buyer's name and email with it, in front of whoever is using it, all day.
 *
 * 🚨 CONTROL PANELS ONLY — never the output pages. The outputs go to air. Putting a customer's
 * email on a browser source would put it on their livestream, on their scoreboard, in front of
 * their crowd. That is not a deterrent, it is a data leak with the paying customer as the
 * victim. The output pages deliberately do not load this file.
 */
(function () {
  'use strict';
  if (window.__sgLicenseeDone) return;
  window.__sgLicenseeDone = true;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c];
    });
  }

  fetch('/license').then(function (r) { return r.json(); }).then(function (s) {
    if (!s) return;

    // A revoked key is worth saying plainly, and worth saying it is not the customer's fault
    // if it wasn't — the wording never accuses anyone.
    if (s.revoked) {
      var bar = document.createElement('div');
      bar.setAttribute('style', 'position:fixed;left:0;right:0;bottom:0;z-index:2147483000;' +
        'background:#8a1220;color:#fff;font:600 13.5px/1.45 system-ui,Segoe UI,Arial,sans-serif;' +
        'padding:10px 16px;text-align:center;box-shadow:0 -4px 14px rgba(0,0,0,.3)');
      bar.textContent = 'This license key is no longer valid, so the watermark is back. '
        + 'If you believe that is a mistake, get in touch and it will be sorted out.';
      document.body.appendChild(bar);
      return;
    }

    if (!s.active || !s.name) return;

    /* Quiet on purpose. This has to be permanent and unmissable to somebody using a key that
       is not theirs, while being something the person who actually paid stops noticing by the
       end of the first week. A banner would fail both halves. */
    var who = esc(s.name) + (s.email ? ' &middot; ' + esc(s.email) : '');
    var el = document.createElement('div');
    el.id = 'sgLicensee';
    el.innerHTML = 'Licensed to ' + who;
    el.setAttribute('style', 'position:fixed;right:10px;bottom:8px;z-index:2147482000;' +
      'font:500 11px/1.3 system-ui,Segoe UI,Arial,sans-serif;color:#8a97a8;opacity:.72;' +
      'background:rgba(10,14,20,.55);border:1px solid rgba(255,255,255,.07);border-radius:6px;' +
      'padding:3px 8px;pointer-events:none;max-width:46vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap');
    document.body.appendChild(el);
  }).catch(function () { /* the app is the only thing that can answer this; silence is fine */ });
})();
