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
  function closeManual() { $('manualModal').style.display = 'none'; }
  function openManual(id, it) {
    function build(cols) {
      if (!cols.length) { alert('This graphic has no fillable fields yet.\n\nIn the Graphics Builder, select a text or image layer and set its "CSV field" name (e.g. PlayerName), then try again.'); return; }
      $('manTitle').textContent = 'Manual Add — ' + it.name;
      $('manFields').innerHTML = cols.map(function (c) { return '<div style="display:flex;flex-direction:column;gap:3px;margin-bottom:8px"><label style="color:var(--muted);font-size:12px">' + esc(c) + '</label><input class="inp" data-col="' + esc(c) + '" style="width:100%"></div>'; }).join('');
      $('manSave').onclick = function () { var r = {}; $('manFields').querySelectorAll('[data-col]').forEach(function (inp) { r[inp.dataset.col] = inp.value; }); post({ type: 'show_addrow', id: id, row: r }); closeManual(); };
      $('manualModal').style.display = 'flex';
    }
    if (it.columns && it.columns.length) { build(it.columns); return; }
    fetch('/show-payload?id=' + encodeURIComponent(id)).then(function (r) { return r.json(); }).then(function (res) {
      var flds = []; if (res.ok && res.payload && res.payload.layers) res.payload.layers.forEach(function (l) { if (l.field && flds.indexOf(l.field) < 0) flds.push(l.field); });
      build(flds);
    }).catch(function () { build([]); });
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

  /* ---------------------------------------------------------------- *
   *  ROW EDITOR — fix the spreadsheet mid-show.
   *  A name runs off the lower third, someone scratched, a late entry turns up: the
   *  operator shouldn't have to go back to Excel, re-export and re-import while the
   *  event is running. Every change is sent the moment it's made, so there is no Save
   *  button to forget. Editing the row that's on air updates the output in place.
   * ---------------------------------------------------------------- */
  var rowsEdit = null;          // { id, name, columns, rows, cur } while the editor is open
  var cellTimers = {};          // per-cell debounce so typing isn't one POST per keystroke
  var lastDeleted = null;       // { n, row } — backs the Undo button
  var undoTimer = null;
  var LONG = 26;                // chars past which a cell gets an amber edge — "this may not fit"

  var STRUCTURAL = { show_insertrow: 1, show_delrow: 1, show_moverow: 1, show_addcol: 1 };
  function rowsPost(a) {
    // Row count / order is about to change on the server; ignore incoming state for a moment
    // so our own edit isn't mistaken for another operator's and trigger a re-fetch mid-type.
    if (rowsEdit && STRUCTURAL[a.type]) rowsEdit.busyUntil = Date.now() + 1500;
    return post(a);
  }

  function flushCells() {
    Object.keys(cellTimers).forEach(function (k) { var t = cellTimers[k]; if (t) { clearTimeout(t.id); t.fire(); } });
    cellTimers = {};
  }

  function setCell(n, col, value) {
    if (!rowsEdit || !rowsEdit.rows[n]) return;
    rowsEdit.rows[n][col] = value;
    var k = n + '|' + col;
    if (cellTimers[k]) clearTimeout(cellTimers[k].id);
    var fire = function () { delete cellTimers[k]; rowsPost({ type: 'show_setcell', id: rowsEdit.id, n: n, col: col, value: value }); };
    cellTimers[k] = { fire: fire, id: setTimeout(fire, 200) };
  }

  function showUndo(on) {
    var b = $('rowsUndo'); b.style.display = on ? '' : 'none';
    if (undoTimer) clearTimeout(undoTimer);
    if (on) undoTimer = setTimeout(function () { lastDeleted = null; b.style.display = 'none'; }, 15000);
  }

  function paintCurrent() {
    var wrap = $('rowsTableWrap');
    wrap.querySelectorAll('tr[data-n]').forEach(function (tr) {
      tr.classList.toggle('cur', +tr.dataset.n === (rowsEdit ? rowsEdit.cur : -1));
    });
  }

  function renderRows() {
    var d = rowsEdit, wrap = $('rowsTableWrap');
    if (!d) return;
    if (!d.rows.length) {
      $('rowsCount').textContent = '';
      wrap.innerHTML = '<div class="empty" style="border:0">Every row is gone, so the spreadsheet has been removed from this graphic. Add a row below to start a new one, or close this and import a CSV.</div>';
      return;
    }
    // Filtering hides rows but never renumbers them — data-n stays the row's real position,
    // so an edit made while filtered still lands on the right entry.
    var q = (d.q || '').trim().toLowerCase();
    var vis = [];
    d.rows.forEach(function (r, n) {
      if (!q || d.columns.some(function (c) { return String(r[c] == null ? '' : r[c]).toLowerCase().indexOf(q) >= 0; })) vis.push([r, n]);
    });
    $('rowsCount').textContent = (q ? vis.length + ' of ' + d.rows.length + ' rows' : d.rows.length + ' row' + (d.rows.length === 1 ? '' : 's'))
      + ' · ' + d.columns.length + ' field' + (d.columns.length === 1 ? '' : 's');
    if (!vis.length) { wrap.innerHTML = '<div class="empty" style="border:0">Nothing matches "' + esc(d.q) + '".</div>'; return; }
    var head = '<thead><tr><th>#</th><th></th>' + d.columns.map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('') + '<th>Order</th><th></th></tr></thead>';
    var body = vis.map(function (pair) {
      var r = pair[0], n = pair[1];
      var cells = d.columns.map(function (c) {
        var v = r[c] == null ? '' : String(r[c]);
        return '<td><input class="cell' + (v.length > LONG ? ' long' : '') + '" data-n="' + n + '" data-col="' + esc(c) + '" value="' + esc(v) + '"></td>';
      }).join('');
      return '<tr data-n="' + n + '"' + (n === d.cur ? ' class="cur"' : '') + '>'
        + '<td class="num">' + (n + 1) + '</td>'
        + '<td class="ops"><button class="minibtn" data-go="' + n + '" title="put this entry on air">▶</button></td>'
        + cells
        // Reordering is disabled while a filter is on: the row would move relative to entries
        // you can't see, which is a good way to scramble a running order by accident.
        + '<td class="ops"><button class="minibtn" data-mv="' + n + '" data-dir="-1" title="' + (q ? 'clear the filter to reorder' : 'move up') + '"' + (q || n === 0 ? ' disabled' : '') + '>▲</button> '
        + '<button class="minibtn" data-mv="' + n + '" data-dir="1" title="' + (q ? 'clear the filter to reorder' : 'move down') + '"' + (q || n === d.rows.length - 1 ? ' disabled' : '') + '>▼</button></td>'
        + '<td class="ops"><button class="minibtn danger" data-del="' + n + '" title="delete this entry">✕</button></td>'
        + '</tr>';
    }).join('');
    wrap.innerHTML = '<table class="rtbl">' + head + '<tbody>' + body + '</tbody></table>';

    wrap.querySelectorAll('input.cell').forEach(function (inp) {
      var n = +inp.dataset.n, col = inp.dataset.col;
      inp.oninput = function () { inp.classList.toggle('long', inp.value.length > LONG); setCell(n, col, inp.value); };
      inp.onfocus = function () { $('rowsCount').textContent = col + ' · ' + inp.value.length + ' characters'; };
      inp.onkeyup = function () { if (document.activeElement === inp) $('rowsCount').textContent = col + ' · ' + inp.value.length + ' characters'; };
      inp.onblur = function () {
        var k = n + '|' + col; if (cellTimers[k]) { clearTimeout(cellTimers[k].id); cellTimers[k].fire(); }
        $('rowsCount').textContent = rowsEdit.rows.length + ' row' + (rowsEdit.rows.length === 1 ? '' : 's') + ' · ' + rowsEdit.columns.length + ' fields';
      };
    });
    wrap.querySelectorAll('[data-go]').forEach(function (b) {
      b.onclick = function () { var n = +b.dataset.go; rowsEdit.cur = n; paintCurrent(); rowsPost({ type: 'show_rowselect', id: rowsEdit.id, cmd: 'goto', n: n }); };
    });
    wrap.querySelectorAll('[data-mv]').forEach(function (b) {
      b.onclick = function () {
        flushCells();
        var n = +b.dataset.mv, dir = +b.dataset.dir, to = n + dir;
        if (to < 0 || to >= rowsEdit.rows.length) return;
        rowsEdit.rows.splice(to, 0, rowsEdit.rows.splice(n, 1)[0]);
        if (rowsEdit.cur === n) rowsEdit.cur = to; else if (rowsEdit.cur === to) rowsEdit.cur = n;
        rowsPost({ type: 'show_moverow', id: rowsEdit.id, n: n, dir: dir });
        renderRows();
      };
    });
    wrap.querySelectorAll('[data-del]').forEach(function (b) {
      b.onclick = function () {
        flushCells();
        var n = +b.dataset.del;
        lastDeleted = { n: n, row: JSON.parse(JSON.stringify(rowsEdit.rows[n])) };
        rowsEdit.rows.splice(n, 1);
        if (n < rowsEdit.cur) rowsEdit.cur--;
        rowsEdit.cur = rowsEdit.rows.length ? Math.max(0, Math.min(rowsEdit.rows.length - 1, rowsEdit.cur)) : 0;
        rowsPost({ type: 'show_delrow', id: rowsEdit.id, n: n });
        showUndo(true);
        renderRows();
      };
    });
  }

  function openRows(id) {
    fetch('/show-rows?id=' + encodeURIComponent(id)).then(function (r) { return r.json(); }).then(function (res) {
      if (!res || !res.ok) { alert('Could not read this spreadsheet.'); return; }
      var keepQ = (rowsEdit && rowsEdit.id === id) ? rowsEdit.q : '';   // a re-fetch mid-edit keeps your filter
      rowsEdit = { id: id, name: res.name || '', columns: res.columns || [], rows: res.rows || [], cur: res.rowIndex || 0, q: keepQ };
      $('rowsFilter').value = keepQ || '';
      lastDeleted = null; showUndo(false);
      $('rowsTitle').textContent = 'Edit rows — ' + rowsEdit.name;
      renderRows();
      $('rowsModal').style.display = 'flex';
    }).catch(function () { alert('Could not reach the app.'); });
  }

  function closeRows() {
    flushCells();
    $('rowsModal').style.display = 'none';
    rowsEdit = null; lastDeleted = null; showUndo(false);
    lastSig = '';        // force the library list to redraw with the new row count/labels
    render();
  }

  $('rowsFilter').oninput = function () { if (!rowsEdit) return; flushCells(); rowsEdit.q = this.value; renderRows(); };
  $('rowsGoCur').onclick = function () {
    if (!rowsEdit) return;
    if (rowsEdit.q) { rowsEdit.q = ''; $('rowsFilter').value = ''; renderRows(); }   // it may be filtered out
    var tr = $('rowsTableWrap').querySelector('tr[data-n="' + rowsEdit.cur + '"]');
    if (tr) tr.scrollIntoView({ block: 'center' });
  };
  $('rowsDone').onclick = closeRows;
  $('rowsModal').onclick = function (e) { if (e.target === $('rowsModal')) closeRows(); };
  $('rowsAdd').onclick = function () {
    if (!rowsEdit) return;
    flushCells();
    if (rowsEdit.q) { rowsEdit.q = ''; $('rowsFilter').value = ''; }   // a new empty row would be filtered straight out of view
    var o = {}; rowsEdit.columns.forEach(function (c) { o[c] = ''; });
    var at = rowsEdit.rows.length;
    rowsEdit.rows.push(o);
    rowsPost({ type: 'show_insertrow', id: rowsEdit.id, n: at, row: o });
    renderRows();
    var wrap = $('rowsTableWrap'); wrap.scrollTop = wrap.scrollHeight;
    var first = wrap.querySelector('tr[data-n="' + at + '"] input.cell'); if (first) first.focus();
  };
  $('rowsAddCol').onclick = function () {
    if (!rowsEdit) return;
    var c = prompt('Field name — this must match the "CSV field" on a layer in the Graphics Builder:', '');
    if (c == null) return; c = c.trim(); if (!c) return;
    if (rowsEdit.columns.indexOf(c) >= 0) { alert('That field already exists.'); return; }
    rowsEdit.columns.push(c);
    rowsEdit.rows.forEach(function (r) { r[c] = ''; });
    rowsPost({ type: 'show_addcol', id: rowsEdit.id, col: c });
    renderRows();
  };
  $('rowsUndo').onclick = function () {
    if (!rowsEdit || !lastDeleted) return;
    var d = lastDeleted; lastDeleted = null; showUndo(false);
    rowsEdit.rows.splice(d.n, 0, d.row);
    if (d.n <= rowsEdit.cur) rowsEdit.cur = Math.min(rowsEdit.rows.length - 1, rowsEdit.cur + 1);
    rowsPost({ type: 'show_insertrow', id: rowsEdit.id, n: d.n, row: d.row });
    renderRows();
  };

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
        + '<button class="minibtn" data-act="up" title="move up in the list" style="width:26px">▲</button>'
        + '<button class="minibtn" data-act="down" title="move down in the list" style="width:26px">▼</button>'
        + '<label class="minibtn" title="attach a CSV to mail-merge into this graphic">Import CSV<input type="file" accept=".csv,text/csv" data-act="csvfile" style="display:none"></label>'
        + '<button class="minibtn" data-act="manual" title="add one entry by hand (fill the fields)">Manual Add</button>'
        + '<button class="minibtn" data-act="load" title="open this preset in the Graphics Builder to edit its design">Edit Preset</button>'
        + '<button class="minibtn" data-act="export" title="download this preset (with its images) as a file to share or back up">Export</button>'
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
          + '<label style="display:inline-flex;align-items:center;gap:5px;font-size:12px;color:var(--muted)" title="off = cut instantly to the next entry; on = animate off, change, animate back on"><input type="checkbox" data-act="anim"' + (it.rowTransition === 'reanimate' ? ' checked' : '') + '> animate change</label>'
          + '<label style="display:inline-flex;align-items:center;gap:4px;font-size:12px;color:var(--muted)" title="pause between the old graphic leaving and the new one arriving (animated change)">delay <input class="inp t" data-act="delay" type="number" min="0" max="8000" step="100" value="' + (it.rowDelay == null ? 1000 : it.rowDelay) + '" style="width:64px"> ms</label>'
          + '<button class="minibtn" data-act="editrows" title="fix the spreadsheet without leaving the app — shorten text, delete an entry, add one, reorder">✎ Edit rows</button>'
          + '<button class="minibtn danger" data-act="clearcsv" title="remove the CSV">Clear CSV</button>'
          + '</div>';
      }
      return '<div class="libitem' + (it.on ? ' on' : '') + '" data-id="' + it.id + '" style="flex-direction:column;align-items:stretch">' + main + csv + '</div>';
    }).join('');
    box.querySelectorAll('.libitem').forEach(function (row) {
      var id = row.dataset.id, it = shows.filter(function (x) { return x.id === id; })[0];
      row.querySelector('[data-act="toggle"]').onclick = function () { post({ type: 'show_toggle', id: id, on: !it.on }); };
      var upB = row.querySelector('[data-act="up"]'); if (upB) upB.onclick = function () { post({ type: 'show_reorder', id: id, dir: -1 }); };
      var dnB = row.querySelector('[data-act="down"]'); if (dnB) dnB.onclick = function () { post({ type: 'show_reorder', id: id, dir: 1 }); };
      row.querySelector('[data-act="csvfile"]').onchange = function (e) { importCsv(id, e.target.files[0]); };
      var keySel = row.querySelector('[data-act="key"]'); if (keySel) keySel.onchange = function () { post({ type: 'show_setkey', id: id, key: keySel.value }); };
      var pv = row.querySelector('[data-act="prev"]'); if (pv) pv.onclick = function () { post({ type: 'show_rowselect', id: id, cmd: 'prev' }); };
      var nx = row.querySelector('[data-act="next"]'); if (nx) nx.onclick = function () { post({ type: 'show_rowselect', id: id, cmd: 'next' }); };
      var rs = row.querySelector('[data-act="rowsel"]'); if (rs) rs.onchange = function () { post({ type: 'show_rowselect', id: id, cmd: 'goto', n: +rs.value }); };
      row.querySelector('[data-act="manual"]').onclick = function () { openManual(id, it); };
      var an = row.querySelector('[data-act="anim"]'); if (an) an.onchange = function () { post({ type: 'show_rowmode', id: id, mode: an.checked ? 'reanimate' : 'cut' }); };
      var dl = row.querySelector('[data-act="delay"]'); if (dl) dl.onchange = function () { post({ type: 'show_rowdelay', id: id, ms: +dl.value }); };
      var er = row.querySelector('[data-act="editrows"]'); if (er) er.onclick = function () { openRows(id); };
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
      var ex = row.querySelector('[data-act="export"]'); if (ex) ex.onclick = function () { window.location = '/export/preset?id=' + encodeURIComponent(id); };
      row.querySelector('[data-act="rename"]').onclick = function () { var n = prompt('Rename preset:', it.name); if (n != null && n.trim()) post({ type: 'show_rename', id: id, name: n.trim() }); };
      row.querySelector('[data-act="delete"]').onclick = function () { if (confirm('Delete "' + it.name + '" from the library?')) post({ type: 'show_delete', id: id }); };
    });
  }

  $('allOff').onclick = function () { post({ type: 'show_alloff' }); };

  // Export the whole library as one file (backup / move to another computer)
  $('exportLib').onclick = function () { window.location = '/export/library'; };

  // Import presets from an exported file — merges in, never overwrites
  $('importLib').onchange = function (e) {
    var f = e.target.files[0]; if (!f) return;
    var r = new FileReader();
    r.onload = function () {
      fetch('/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: r.result })
        .then(function (x) { return x.json(); })
        .then(function (res) {
          if (res && res.ok) { var t = $('importLibTxt'); var old = t.textContent; t.textContent = 'Added ' + res.added + ' ✓'; setTimeout(function () { t.textContent = old; }, 1600); }
          else alert("That doesn't look like a StreamGraphics library or preset file (or it was empty).");
        })
        .catch(function () { alert('Import failed.'); });
      e.target.value = '';
    };
    r.readAsText(f);
  };
  $('manCancel').onclick = closeManual;
  $('manualModal').onclick = function (e) { if (e.target === $('manualModal')) closeManual(); };

  /* ---- media manager: upload/organise images into per-show/event folders (no filesystem access) ---- */
  function manageMedia(op, extra) { return fetch('/media-manage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ op: op }, extra || {})) }).then(function (r) { return r.json(); }); }
  function refreshMediaList() {
    fetch('/media-list').then(function (r) { return r.json(); }).then(function (res) {
      var files = (res && res.files) || [], folders = (res && res.folders) || [];
      // keep the upload-target dropdown in sync (preserve selection)
      var sel = $('mediaFolder'), cur = sel.value;
      sel.innerHTML = '<option value="">(top level)</option>' + folders.map(function (f) { return '<option value="' + esc(f) + '">' + esc(f) + '</option>'; }).join('');
      if (folders.indexOf(cur) >= 0) sel.value = cur;
      // group files by folder
      var groups = { '': [] }; folders.forEach(function (f) { groups[f] = []; });
      files.forEach(function (p) { var i = p.indexOf('/'); if (i < 0) groups[''].push(p); else { var fo = p.slice(0, i); (groups[fo] = groups[fo] || []).push(p); } });
      var html = '';
      Object.keys(groups).forEach(function (fo) {
        var list = groups[fo]; if (fo === '' && !list.length) return;
        html += '<div style="margin-bottom:10px"><div class="mini" style="color:var(--muted2);font-weight:700;margin-bottom:4px">' + (fo ? '📁 ' + esc(fo) : 'Top level') + (fo ? ' <button class="minibtn danger" data-rmdir="' + esc(fo) + '" style="padding:2px 7px" title="delete this folder and its images">✕ folder</button>' : '') + '</div>';
        html += list.length ? list.map(function (p) {
          var name = p.split('/').pop();
          return '<span class="mediachip" style="display:inline-flex;align-items:center;gap:6px;background:var(--panel2);border:1px solid var(--line);border-radius:6px;padding:3px 6px 3px 9px;color:var(--txt);margin:0 6px 6px 0">' + esc(name)
            + '<button class="minibtn" data-ren="' + esc(p) + '" style="padding:1px 6px" title="rename">✎</button>'
            + '<button class="minibtn danger" data-del="' + esc(p) + '" style="padding:1px 6px" title="delete">🗑</button></span>';
        }).join('') : '<span class="mini" style="color:var(--muted)">empty</span>';
        html += '</div>';
      });
      $('mediaList').innerHTML = html || '<span class="mini" style="color:var(--muted)">No images uploaded yet.</span>';
      $('mediaList').querySelectorAll('[data-del]').forEach(function (btn) { btn.onclick = function () { if (confirm('Delete ' + btn.dataset.del.split('/').pop() + '?')) manageMedia('delete', { path: btn.dataset.del }).then(refreshMediaList); }; });
      $('mediaList').querySelectorAll('[data-ren]').forEach(function (btn) { btn.onclick = function () { var n = prompt('Rename to:', btn.dataset.ren.split('/').pop()); if (n && n.trim()) manageMedia('rename', { path: btn.dataset.ren, name: n.trim() }).then(refreshMediaList); }; });
      $('mediaList').querySelectorAll('[data-rmdir]').forEach(function (btn) { btn.onclick = function () { if (confirm('Delete the folder "' + btn.dataset.rmdir + '" and everything in it?')) manageMedia('rmdir', { folder: btn.dataset.rmdir }).then(refreshMediaList); }; });
    }).catch(function () {});
  }
  function uploadMedia(files) {
    files = Array.prototype.slice.call(files).filter(function (f) { return /^image\//.test(f.type); });
    if (!files.length) return;
    var folder = $('mediaFolder').value, done = 0, fail = 0;
    $('mediaStatus').textContent = 'Uploading ' + files.length + ' image' + (files.length === 1 ? '' : 's') + (folder ? ' into ' + folder : '') + '…';
    files.forEach(function (f) {
      if (f.size > 25 * 1024 * 1024) { fail++; step(); return; }
      var r = new FileReader();
      r.onload = function () {
        fetch('/upload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: f.name, data: r.result, keepName: true, folder: folder }) })
          .then(function (x) { return x.json(); }).then(function (res) { if (!res || !res.ok) fail++; step(); }).catch(function () { fail++; step(); });
      };
      r.onerror = function () { fail++; step(); };
      r.readAsDataURL(f);
    });
    function step() { done++; if (done >= files.length) { $('mediaStatus').textContent = 'Done — ' + (done - fail) + ' uploaded' + (fail ? ', ' + fail + ' skipped (too large or unreadable)' : '') + '.'; refreshMediaList(); } }
  }
  $('mediaFiles').onchange = function () { uploadMedia(this.files); this.value = ''; };
  $('mkFolder').onclick = function () { var n = ($('newFolder').value || '').trim(); if (!n) return; manageMedia('mkdir', { folder: n }).then(function () { $('newFolder').value = ''; refreshMediaList().then ? null : null; refreshMediaList(); setTimeout(function () { $('mediaFolder').value = n.replace(/[^a-zA-Z0-9._ -]/g, '_'); }, 150); }); };
  var dz = $('dropZone');
  ['dragenter', 'dragover'].forEach(function (ev) { dz.addEventListener(ev, function (e) { e.preventDefault(); dz.style.borderColor = 'var(--accent)'; }); });
  ['dragleave', 'drop'].forEach(function (ev) { dz.addEventListener(ev, function (e) { e.preventDefault(); dz.style.borderColor = ''; }); });
  dz.addEventListener('drop', function (e) { if (e.dataTransfer && e.dataTransfer.files) uploadMedia(e.dataTransfer.files); });
  refreshMediaList();
  $('copyBtn').onclick = function () {
    var url = $('outUrl').textContent, b = $('copyBtn'), old = b.textContent, ok = function () { b.textContent = 'Copied!'; setTimeout(function () { b.textContent = old; }, 1200); };
    if (navigator.clipboard) navigator.clipboard.writeText(url).then(ok, ok);
  };

  function connect() {
    var es = SGLive('/events');
    es.onopen = function () { $('conn').className = 'conn ok'; $('connTxt').textContent = 'live'; };
    es.onmessage = function (e) {
      try {
        var m = JSON.parse(e.data); if (!m.state) return;
        shows = m.state.shows || [];
        ltLayers = (m.state.lowerthird && m.state.lowerthird.layers) || [];
        var n = ltLayers.length;
        $('saveHint').textContent = 'Snapshots the Graphics Builder — currently ' + n + ' layer' + (n === 1 ? '' : 's') + '.';
        // Keep the open row editor honest: the current row can move from a Stream Deck, the
        // Companion module or a phone, and row numbers must match the server or edits land on
        // the wrong entry. Structural edits of our own get a grace window so our in-flight
        // POST doesn't look like somebody else's change.
        if (rowsEdit) {
          var me = shows.filter(function (x) { return x.id === rowsEdit.id; })[0];
          if (me) {
            var ci = me.rowIndex || 0;
            if (ci !== rowsEdit.cur) { rowsEdit.cur = ci; paintCurrent(); }
            var cnt = me.rowCount != null ? me.rowCount : ((me.rows || []).length);
            if (cnt !== rowsEdit.rows.length && Date.now() > (rowsEdit.busyUntil || 0)) openRows(rowsEdit.id);
          } else { closeRows(); }   // the preset was deleted out from under us
        }

        // Only rebuild the list when the library actually changed (not on every unrelated update).
        var sig = shows.map(function (x) { return x.id + '|' + x.name + '|' + (x.on ? 1 : 0) + '|' + (x.rowCount != null ? x.rowCount : (x.rows ? x.rows.length : 0)) + '|' + (x.rowIndex || 0) + '|' + (x.rowKey || '') + '|' + (x.rowTransition || 'cut'); }).join(',');
        if (sig !== lastSig) { lastSig = sig; render(); }
      } catch (x) {}
    };
    es.onerror = function () { $('conn').className = 'conn off'; $('connTxt').textContent = 'reconnecting…'; };
  }
  connect();
  $('outUrl').textContent = location.protocol + '//' + location.host + '/program-output';
})();
