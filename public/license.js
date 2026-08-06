/* License card on the home page — activate / clear a key and show status. */
(function () {
  var $ = function (id) { return document.getElementById(id); };
  function paint(s) {
    if (s && s.active) {
      $('licStatus').textContent = '✓ Licensed';
      $('licStatus').style.color = '#12b886';
      $('licInfo').textContent = 'Licensed to ' + (s.name || '—') + ' · tier: ' + (s.tier || 'pro') + (s.features && s.features.length ? ' · add-ons: ' + s.features.join(', ') : '') + '. Watermark removed.';
    } else {
      $('licStatus').textContent = 'Free version';
      $('licStatus').style.color = '#8a97a8';
      $('licInfo').textContent = 'The free version shows a small watermark on the output. Enter a license key to unlock the full version and any add-ons.';
    }
  }
  function refresh() { fetch('/license').then(function (r) { return r.json(); }).then(paint).catch(function () {}); }
  $('licActivate').onclick = function () {
    var key = ($('licKey').value || '').trim(); if (!key) return;
    var b = $('licActivate'); b.textContent = '…';
    fetch('/license', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: key }) })
      .then(function (r) { return r.json(); }).then(function (s) { b.textContent = 'Activate'; if (!s.active) alert('That key is not valid or has expired.'); else $('licKey').value = ''; paint(s); })
      .catch(function () { b.textContent = 'Activate'; alert('Could not reach the app.'); });
  };
  $('licClear').onclick = function () {
    if (!confirm('Remove the license and go back to the free version?')) return;
    fetch('/license', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clear: true }) }).then(function (r) { return r.json(); }).then(paint);
  };
  refresh();
})();
