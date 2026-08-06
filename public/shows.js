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

  // Minimal CSV parser — handles quoted fields, embedded commas, and "" escapes.
  function parseCSV(text) {
    text = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    var rows = [], row = [], cur = '', inQ = false, i = 0, ch;
    for (; i < text.length; i++) {
      ch = text[i];
      if (inQ) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false; } else cur += ch; }
      else if (ch === '"') inQ = true;
      else if (ch === ',') { row.push(cur); cur = ''; }
      else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
      else cur += ch;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (c) { return String(c).trim() !== ''; }); });
  }
  function importCsv(id, file) {
    if (!file) return;
    var r = new FileReader();
    r.onload = function () {
      var grid = parseCSV(r.result);
      if (grid.length < 2) { alert('That CSV needs a header row plus at least one data row.'); return; }
      var cols = grid[0].map(function (c) { return String(c).trim(); });
      var rows = grid.slice(1).map(function (line) { var o = {}; cols.forEach(function (c, ci) { o[c] = (line[ci] == null ? '' : String(line[ci]).trim()); }); return o; });
      post({ type: 'show_import_csv', id: id, columns: cols, rows: rows });
    };
    r.readAsText(file);
  }

  function render() {
    var box = $('lib');
    if (!shows.length) { box.innerHTML = '<div class="empty">No saved graphics yet. Build one in the Graphics Builder, then hit "＋ Save to Library" there.</div>'; return; }
    box.innerHTML = shows.map(function (it) {
      var rowCount = it.rowCount != null ? it.rowCount : (it.rows ? it.rows.length : 0);
      var idx = it.rowIndex || 0, cols = it.columns || [], key = it.rowKey || (cols[0] || '');
      var labels = it.rowLabels || (it.rows ? it.rows.map(function (r) { return key ? (r[key] || '') : (r[Object.keys(r)[0]] || ''); }) : []);
      var main = '<div class="libmain" style="display:flex;align-items:center;gap:10px">'
        + '<div class="sw' + (it.on ? ' on' : '') + '" data-act="toggle" title="on / off air"></div>'
        + '<div class="nm">' + esc(it.name) + (rowCount ? ' <span class="kind" style="color:#7c9cff">' + rowCount + ' rows</span>' : '') + '</div>'
        + '<label class="minibtn" title="attach a CSV to mail-merge into this graphic">Import CSV<input type="file" accept=".csv,text/csv" data-act="csvfile" style="display:none"></label>'
        + '<button class="minibtn" data-act="load" title="open this preset in the Graphics Builder to edit">Edit</button>'
        + '<button class="minibtn" data-act="rename">Rename</button>'
        + '<button class="minibtn danger" data-act="delete">Delete</button>'
        + '</div>';
      var csv = '';
      if (rowCount) {
        csv = '<div class="csvrow" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:10px;padding-top:10px;border-top:1px solid var(--line)">'
          + '<span class="kind">Row by</span>'
          + '<select class="inp" data-act="key" style="width:auto">' + cols.map(function (c) { return '<option' + (c === key ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select>'
          + '<button class="minibtn" data-act="prev" title="previous row">◀</button>'
          + '<select class="inp" data-act="rowsel" style="min-width:180px">' + labels.map(function (lb, i) { return '<option value="' + i + '"' + (i === idx ? ' selected' : '') + '>' + esc(lb || ('Row ' + (i + 1))) + '</option>'; }).join('') + '</select>'
          + '<button class="minibtn" data-act="next" title="next row">▶</button>'
          + '<span class="mono" style="color:var(--muted)">' + (idx + 1) + ' / ' + rowCount + '</span>'
          + '<button class="minibtn danger" data-act="clearcsv" title="remove the CSV">Clear CSV</button>'
          + '</div>';
      }
      return '<div class="libitem' + (it.on ? ' on' : '') + '" data-id="' + it.id + '" style="flex-direction:column;align-items:stretch">' + main + csv + '</div>';
    }).join('');
    box.querySelectorAll('.libitem').forEach(function (row) {
      var id = row.dataset.id, it = shows.filter(function (x) { return x.id === id; })[0];
      row.querySelector('[data-act="toggle"]').onclick = function () { post({ type: 'show_toggle', id: id, on: !it.on }); };
      row.querySelector('[data-act="csvfile"]').onchange = function (e) { importCsv(id, e.target.files[0]); };
      var keySel = row.querySelector('[data-act="key"]'); if (keySel) keySel.onchange = function () { post({ type: 'show_setkey', id: id, key: keySel.value }); };
      var pv = row.querySelector('[data-act="prev"]'); if (pv) pv.onclick = function () { post({ type: 'show_rowselect', id: id, cmd: 'prev' }); };
      var nx = row.querySelector('[data-act="next"]'); if (nx) nx.onclick = function () { post({ type: 'show_rowselect', id: id, cmd: 'next' }); };
      var rs = row.querySelector('[data-act="rowsel"]'); if (rs) rs.onchange = function () { post({ type: 'show_rowselect', id: id, cmd: 'goto', n: +rs.value }); };
      var cc = row.querySelector('[data-act="clearcsv"]'); if (cc) cc.onclick = function () { if (confirm('Remove the CSV from "' + it.name + '"?')) post({ type: 'show_clear_csv', id: id }); };
      row.querySelector('[data-act="load"]').onclick = function () {
        var b = row.querySelector('[data-act="load"]'); b.textContent = '…';
        // OFF presets don't carry their payload over the live stream — fetch it on demand.
        fetch('/show-payload?id=' + encodeURIComponent(id)).then(function (r) { return r.json(); }).then(function (res) {
          if (!res.ok || !res.payload || !Array.isArray(res.payload.layers)) { alert('This preset has no editable layers.'); b.textContent = 'Edit'; return; }
          post({ type: 'show_load', id: id }).then(function () {
            b.textContent = 'Opened ✓'; setTimeout(function () { b.textContent = 'Edit'; }, 1400);
            window.open('/lowerthird', 'sg_builder');   // bring the builder up so the edit is obvious
          });
        }).catch(function () { b.textContent = 'Edit'; });
      };
      row.querySelector('[data-act="rename"]').onclick = function () { var n = prompt('Rename preset:', it.name); if (n != null && n.trim()) post({ type: 'show_rename', id: id, name: n.trim() }); };
      row.querySelector('[data-act="delete"]').onclick = function () { if (confirm('Delete "' + it.name + '" from the library?')) post({ type: 'show_delete', id: id }); };
    });
  }

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
        var sig = shows.map(function (x) { return x.id + '|' + x.name + '|' + (x.on ? 1 : 0) + '|' + (x.rowCount != null ? x.rowCount : (x.rows ? x.rows.length : 0)) + '|' + (x.rowIndex || 0) + '|' + (x.rowKey || ''); }).join(',');
        if (sig !== lastSig) { lastSig = sig; render(); }
      } catch (x) {}
    };
    es.onerror = function () { $('conn').className = 'conn off'; $('connTxt').textContent = 'reconnecting…'; };
  }
  connect();
  $('outUrl').textContent = location.protocol + '//' + location.host + '/program-output';
})();
