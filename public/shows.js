/* StreamGraphics — Show Library control.
 * Save the current Graphics Builder design as a named preset, then toggle presets
 * on/off on the Program output, recall them into the builder, rename, or delete. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var shows = [], ltLayers = [], lastSig = '';

  function post(action) {
    return fetch('/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(action) }).catch(function () {});
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function render() {
    var box = $('lib');
    if (!shows.length) { box.innerHTML = '<div class="empty">No saved graphics yet. Build one, then save it above.</div>'; return; }
    box.innerHTML = shows.map(function (it) {
      return '<div class="libitem' + (it.on ? ' on' : '') + '" data-id="' + it.id + '">'
        + '<div class="sw' + (it.on ? ' on' : '') + '" data-act="toggle" title="on / off air"></div>'
        + '<div class="nm">' + esc(it.name) + '</div>'
        + '<span class="kind">' + esc(it.kind || 'lowerthird') + '</span>'
        + '<button class="minibtn" data-act="load" title="load into the Graphics Builder to edit">Load</button>'
        + '<button class="minibtn" data-act="rename">Rename</button>'
        + '<button class="minibtn danger" data-act="delete">Delete</button>'
        + '</div>';
    }).join('');
    box.querySelectorAll('.libitem').forEach(function (row) {
      var id = row.dataset.id, it = shows.filter(function (x) { return x.id === id; })[0];
      row.querySelector('[data-act="toggle"]').onclick = function () { post({ type: 'show_toggle', id: id, on: !it.on }); };
      row.querySelector('[data-act="load"]').onclick = function () {
        var b = row.querySelector('[data-act="load"]'); b.textContent = '…';
        // OFF presets don't carry their payload over the live stream — fetch it on demand.
        fetch('/show-payload?id=' + encodeURIComponent(id)).then(function (r) { return r.json(); }).then(function (res) {
          if (!res.ok || !res.payload || !Array.isArray(res.payload.layers)) { alert('This preset has no editable layers.'); b.textContent = 'Load'; return; }
          post({ type: 'show_load', id: id }).then(function () { b.textContent = 'Loaded ✓'; setTimeout(function () { b.textContent = 'Load'; }, 1400); });
        }).catch(function () { b.textContent = 'Load'; });
      };
      row.querySelector('[data-act="rename"]').onclick = function () { var n = prompt('Rename preset:', it.name); if (n != null && n.trim()) post({ type: 'show_rename', id: id, name: n.trim() }); };
      row.querySelector('[data-act="delete"]').onclick = function () { if (confirm('Delete "' + it.name + '" from the library?')) post({ type: 'show_delete', id: id }); };
    });
  }

  $('saveBtn').onclick = function () {
    var name = ($('saveName').value || '').trim();
    if (!name) { name = 'Preset ' + (shows.length + 1); }
    if (!ltLayers.length) { if (!confirm('The Graphics Builder looks empty. Save it anyway?')) return; }
    post({ type: 'show_save', name: name, kind: 'lowerthird', payload: { layers: ltLayers } }).then(function () {
      $('saveName').value = '';
      var b = $('saveBtn'); var old = b.textContent; b.textContent = 'Saved ✓'; setTimeout(function () { b.textContent = old; }, 1400);
    });
  };
  $('allOff').onclick = function () { post({ type: 'show_alloff' }); };
  $('copyBtn').onclick = function () {
    var url = $('outUrl').textContent, b = $('copyBtn'), old = b.textContent, ok = function () { b.textContent = 'Copied!'; setTimeout(function () { b.textContent = old; }, 1200); };
    if (navigator.clipboard) navigator.clipboard.writeText(url).then(ok, ok);
  };

  function connect() {
    var es = new EventSource('/events');
    es.onopen = function () { $('conn').className = 'conn ok'; $('connTxt').textContent = 'live'; };
    es.onmessage = function (e) {
      try {
        var m = JSON.parse(e.data); if (!m.state) return;
        shows = m.state.shows || [];
        ltLayers = (m.state.lowerthird && m.state.lowerthird.layers) || [];
        var n = ltLayers.length;
        $('saveHint').textContent = 'Snapshots the Graphics Builder — currently ' + n + ' layer' + (n === 1 ? '' : 's') + '.';
        // Only rebuild the list when the library actually changed (not on every unrelated update).
        var sig = shows.map(function (x) { return x.id + '|' + x.name + '|' + (x.on ? 1 : 0); }).join(',');
        if (sig !== lastSig) { lastSig = sig; render(); }
      } catch (x) {}
    };
    es.onerror = function () { $('conn').className = 'conn off'; $('connTxt').textContent = 'reconnecting…'; };
  }
  connect();
  $('outUrl').textContent = location.protocol + '//' + location.host + '/program-output';
})();
