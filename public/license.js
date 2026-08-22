/* License card on the home page — activate / clear a key and show status. */
(function () {
  var $ = function (id) { return document.getElementById(id); };
  function paint(s) {
    if (s && s.active) {
      $('licStatus').textContent = '✓ Licensed';
      $('licStatus').style.color = '#12b886';
      $('licInfo').textContent = 'Licensed to ' + (s.name || '—') + (s.email ? ' (' + s.email + ')' : '')
        + ' · tier: ' + (s.tier || 'pro')
        + (s.features && s.features.length ? ' · add-ons: ' + s.features.join(', ') : '') + '. Watermark removed.';
    } else if (s && s.revoked) {
      /* Said plainly, and without accusing anyone. A key can end up on the revoked list
         because it was shared - or because somebody typed the wrong one into the list. The
         person reading this may be the customer who paid, so the wording has to work for
         them too, and it has to tell them what to do next. */
      $('licStatus').textContent = 'Key no longer valid';
      $('licStatus').style.color = '#ff9aa8';
      $('licInfo').textContent = 'This license key has been withdrawn, so the watermark is back. '
        + 'If you think that is a mistake, get in touch and we will sort it out.';
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
    $('licKey').value = '';   // also clear the input box, not just the active license
    fetch('/license', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clear: true }) }).then(function (r) { return r.json(); }).then(paint);
  };
  refresh();
})();
