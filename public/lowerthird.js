/* StreamGraphics — Lower Third control panel. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var editing = null;
  function send(a) { return fetch('/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(a) }).catch(function () {}); }

  function bgHex() {
    var a = Math.round(Math.max(0, Math.min(100, +$('stBgA').value)) * 255 / 100).toString(16);
    if (a.length < 2) a = '0' + a;
    return $('stBg').value + a;
  }
  function pushStyle() {
    send({ type: 'lt_style', style: {
      text: $('stText').value, accent: $('stAccent').value, bg: bgHex(),
      size: +$('stSize').value, animation: $('stAnim').value
    }});
  }

  // content fields
  [['line1', 'line1'], ['line2', 'line2'], ['logoUrl', 'logoUrl']].forEach(function (p) {
    var el = $(p[0]);
    el.addEventListener('focus', function () { editing = p[0]; });
    el.addEventListener('blur', function () { editing = null; });
    el.addEventListener('input', function () { var a = { type: 'lt_set' }; a[p[1]] = el.value; send(a); });
  });

  // look controls
  ['stText', 'stAccent', 'stBg', 'stBgA', 'stAnim'].forEach(function (id) {
    $(id).addEventListener('focus', function () { editing = id; });
    $(id).addEventListener('blur', function () { editing = null; });
    $(id).oninput = pushStyle;
  });
  $('stSize').oninput = function () { $('stSizeV').textContent = $('stSize').value; pushStyle(); };
  document.querySelectorAll('#posGrid button').forEach(function (b) {
    b.onclick = function () {
      document.querySelectorAll('#posGrid button').forEach(function (x) { x.classList.remove('on'); });
      b.classList.add('on'); send({ type: 'lt_style', style: { position: b.dataset.pos } });
    };
  });

  // on air
  $('btnShow').onclick = function () { send({ type: 'lt_show' }); };
  $('btnHide').onclick = function () { send({ type: 'lt_hide' }); };

  // green-screen toggle + copy link
  $('chroma').onchange = function () { send({ type: 'lt_style', style: { chroma: $('chroma').checked ? 'green' : '' } }); };
  $('copyBtn').onclick = function () {
    var url = $('outUrl').textContent;
    if (navigator.clipboard) navigator.clipboard.writeText(url).then(function () { flash('Copied!'); }, function () { flash('Copy failed'); });
    else { var t = document.createElement('textarea'); t.value = url; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); flash('Copied!'); } catch (e) {} t.remove(); }
  };
  function flash(msg) { var b = $('copyBtn'), old = b.textContent; b.textContent = msg; setTimeout(function () { b.textContent = old; }, 1200); }

  // Browse a local logo
  $('logoFile').onchange = function () {
    var f = $('logoFile').files[0]; if (!f) return;
    var r = new FileReader();
    r.onload = function () {
      fetch('/upload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: f.name, data: r.result }) })
        .then(function (x) { return x.json(); }).then(function (res) { if (res && res.ok) send({ type: 'lt_set', logoUrl: res.url }); else alert('Upload failed.'); })
        .catch(function () { alert('Upload failed.'); });
    };
    r.readAsDataURL(f); $('logoFile').value = '';
  };

  function reflect(lt) {
    $('airState').textContent = lt.visible ? 'ON AIR' : 'OFF AIR';
    $('airState').classList.toggle('live', !!lt.visible);
    if (editing !== 'line1') $('line1').value = lt.line1 || '';
    if (editing !== 'line2') $('line2').value = lt.line2 || '';
    if (editing !== 'logoUrl') $('logoUrl').value = lt.logoUrl || '';
    $('pvL1').textContent = lt.line1 || '';
    $('pvL2').textContent = lt.line2 || '';
    var s = lt.style || {};
    $('pvL1').style.color = s.text || '#fff';
    $('pvL2').style.color = s.accent || '#e7b53c';
    if (editing !== 'stText' && s.text) $('stText').value = s.text;
    if (editing !== 'stAccent' && s.accent) $('stAccent').value = s.accent;
    if (editing !== 'stBg' && s.bg && /^#[0-9a-f]{8}$/i.test(s.bg)) { $('stBg').value = s.bg.slice(0, 7); $('stBgA').value = Math.round(parseInt(s.bg.slice(7), 16) / 255 * 100); }
    if (editing !== 'stSize' && s.size) { $('stSize').value = s.size; $('stSizeV').textContent = s.size; }
    if (editing !== 'stAnim' && s.animation) $('stAnim').value = s.animation;
    $('chroma').checked = !!s.chroma;
    if (s.position) document.querySelectorAll('#posGrid button').forEach(function (b) { b.classList.toggle('on', b.dataset.pos === s.position); });
  }

  function connect() {
    var es = new EventSource('/events');
    es.onopen = function () { $('conn').className = 'conn ok'; $('connTxt').textContent = 'live'; };
    es.onmessage = function (e) { try { var m = JSON.parse(e.data); if (m.state && m.state.lowerthird) reflect(m.state.lowerthird); } catch (x) {} };
    es.onerror = function () { $('conn').className = 'conn off'; $('connTxt').textContent = 'reconnecting…'; };
  }
  connect();
  $('outUrl').textContent = location.protocol + '//' + location.host + '/lowerthird-output';
})();
