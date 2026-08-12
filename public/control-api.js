/* Control API help page — lists ready-to-paste command URLs and keeps names live. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var baseInput = $('base');

  // Default to however this page was opened (localhost or the PC's IP), so URLs are copy-ready.
  baseInput.value = location.protocol + '//' + location.host;

  // Offer this machine's REAL network address rather than printing a made-up example one.
  // A sample address in the text was being read as "the address you should use", which it
  // never is - every network hands out different ones. Ask the app what it actually has.
  (function () {
    var hint = $('lanHint'); if (!hint) return;
    fetch('/netinfo').then(function (r) { return r.json(); }).then(function (n) {
      var ips = (n && n.ips) || [], port = (n && n.port) || 4000;
      if (!ips.length) { hint.textContent = 'This computer has no network address right now — connect it to Wi-Fi or Ethernet and reload this page.'; return; }
      hint.textContent = 'On this computer that address is ';
      ips.forEach(function (ip, i) {
        var url = 'http://' + ip + ':' + port;
        var a = document.createElement('a');
        a.href = '#'; a.textContent = url;
        a.addEventListener('click', function (e) {
          e.preventDefault();
          baseInput.value = url;
          baseInput.dispatchEvent(new Event('input'));   // rebuild every URL on the page
        });
        if (i) hint.appendChild(document.createTextNode(' or '));
        hint.appendChild(a);
      });
      hint.appendChild(document.createTextNode(' — click it to fill the box.'));
    }).catch(function () { hint.textContent = ''; });
  })();

  function base() { return baseInput.value.replace(/\/+$/, ''); }
  function enc(s) { return encodeURIComponent(s); }

  // Build one command row: label + URL + Copy + Test
  function row(label, url) {
    var d = document.createElement('div'); d.className = 'cmd';
    var l = document.createElement('div'); l.className = 'lbl'; l.textContent = label;
    var u = document.createElement('div'); u.className = 'u'; u.textContent = url;
    var copy = document.createElement('button'); copy.textContent = 'Copy';
    copy.onclick = function () {
      (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(function () {
        copy.textContent = 'Copied'; copy.classList.add('ok'); setTimeout(function () { copy.textContent = 'Copy'; copy.classList.remove('ok'); }, 1100);
      }).catch(function () { /* clipboard blocked — user can select the text */ });
    };
    var test = document.createElement('button'); test.textContent = 'Test';
    test.title = 'Fire this command now';
    test.onclick = function () {
      fetch(url).then(function (r) { return r.json(); }).then(function (j) {
        test.textContent = j && j.ok ? 'Sent ✓' : 'Err'; test.classList.toggle('ok', !!(j && j.ok));
        setTimeout(function () { test.textContent = 'Test'; test.classList.remove('ok'); }, 1100);
      }).catch(function () { test.textContent = 'Err'; setTimeout(function () { test.textContent = 'Test'; }, 1100); });
    };
    d.appendChild(l); d.appendChild(u); d.appendChild(copy); d.appendChild(test);
    return d;
  }

  function fill(el, rows) { el.innerHTML = ''; if (!rows.length) { el.innerHTML = '<div class="empty">Nothing here yet — create some in the app, then hit Refresh.</div>'; return; } rows.forEach(function (r) { el.appendChild(r); }); }

  function renderStatic() {
    var b = base();
    fill($('timer'), [
      row('Start', b + '/api/timer/start'),
      row('Pause', b + '/api/timer/pause'),
      row('Reset', b + '/api/timer/reset'),
      row('Set to 5:00', b + '/api/timer/set?mmss=5:00'),
      row('Add 60 sec', b + '/api/timer/adjust?seconds=60'),
      row('Take to air', b + '/api/timer/air'),
      row('Off air', b + '/api/timer/off')
    ]);
    fill($('baseball'), [
      row('Run — Team 1', b + '/api/baseball/run?team=1'),
      row('Run — Team 2', b + '/api/baseball/run?team=2'),
      row('Ball', b + '/api/baseball/ball'),
      row('Strike', b + '/api/baseball/strike'),
      row('Out', b + '/api/baseball/out'),
      row('Clear count', b + '/api/baseball/clearcount'),
      row('Next half-inning', b + '/api/baseball/advance'),
      row('Take to air', b + '/api/baseball/show'),
      row('Off air', b + '/api/baseball/hide')
    ]);
  }

  function renderLive(data) {
    var b = base();
    // Presets
    var pr = [];
    (data.presets || []).forEach(function (p) {
      var nm = p.name, e = enc(nm);
      var head = document.createElement('div'); head.style.margin = '14px 0 4px'; head.style.fontWeight = '800';
      head.innerHTML = nm + '<span class="pill ' + (p.on ? 'on' : 'off') + '">' + (p.on ? 'ON AIR' : 'off') + '</span>' + (p.csv ? '<span class="pill off">CSV · row ' + p.row + '/' + p.rows + '</span>' : '');
      pr.push({ el: head });
      pr.push({ el: row('On', b + '/api/preset/on?name=' + e) });
      pr.push({ el: row('Off', b + '/api/preset/off?name=' + e) });
      pr.push({ el: row('Toggle', b + '/api/preset/toggle?name=' + e) });
      if (p.csv) {
        pr.push({ el: row('Next row', b + '/api/preset/next?name=' + e) });
        pr.push({ el: row('Previous row', b + '/api/preset/prev?name=' + e) });
      }
      // Bullet / slide reveal. Only shown for graphics that actually have something to step,
      // and the layer name is only added to the URL when the graphic holds more than one list.
      (p.reveals || []).forEach(function (r, i) {
        var multi = (p.reveals.length > 1);
        var suffix = multi ? '&layer=' + enc(r.name) : '';
        var what = (r.type === 'slides' ? 'slide' : 'bullet');
        var tag = multi ? (' — ' + r.name) : '';
        pr.push({ el: row('Next ' + what + tag + '   (' + r.at + '/' + r.of + ')', b + '/api/bullets/next?preset=' + e + suffix) });
        pr.push({ el: row('Previous ' + what + tag, b + '/api/bullets/prev?preset=' + e + suffix) });
        pr.push({ el: row('Reveal all' + tag, b + '/api/bullets/all?preset=' + e + suffix) });
        pr.push({ el: row('Back to blank' + tag, b + '/api/bullets/blank?preset=' + e + suffix) });
      });
    });
    var pel = $('presets'); pel.innerHTML = '';
    if (!pr.length) pel.innerHTML = '<div class="empty">No saved presets yet. Save graphics in the Show Library, then Refresh.</div>';
    else pr.forEach(function (x) { pel.appendChild(x.el); });

    // Scoreboards
    var sel = $('scoreboards'); sel.innerHTML = '';
    var boards = data.scoreboards || [];
    if (!boards.length) sel.innerHTML = '<div class="empty">No scoreboards yet.</div>';
    else boards.forEach(function (bd) {
      var nm = bd.name, e = enc(nm);
      var head = document.createElement('div'); head.style.margin = '14px 0 4px'; head.style.fontWeight = '800';
      head.innerHTML = nm + '<span class="pill ' + (bd.visible ? 'on' : 'off') + '">' + (bd.visible ? 'ON AIR' : 'off') + '</span>';
      sel.appendChild(head);
      sel.appendChild(row('Point + Team 1', b + '/api/scoreboard/point?name=' + e + '&team=1&delta=1'));
      sel.appendChild(row('Point − Team 1', b + '/api/scoreboard/point?name=' + e + '&team=1&delta=-1'));
      sel.appendChild(row('Point + Team 2', b + '/api/scoreboard/point?name=' + e + '&team=2&delta=1'));
      sel.appendChild(row('Point − Team 2', b + '/api/scoreboard/point?name=' + e + '&team=2&delta=-1'));
      sel.appendChild(row('Next game', b + '/api/scoreboard/nextgame?name=' + e));
      sel.appendChild(row('Take to air', b + '/api/scoreboard/show?name=' + e));
      sel.appendChild(row('Off air', b + '/api/scoreboard/hide?name=' + e));
    });
  }

  function load() {
    fetch(base() + '/api/list').then(function (r) { return r.json(); }).then(renderLive).catch(function () {
      $('presets').innerHTML = '<div class="empty">Could not reach the app at that address — check the address above.</div>';
    });
  }

  baseInput.addEventListener('input', function () { renderStatic(); load(); });
  $('refresh').onclick = load;
  renderStatic(); load();
  setInterval(load, 5000); // keep on-air pills + row counters fresh
})();
