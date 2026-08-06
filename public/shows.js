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
        + '<button class="minibtn" data-act="manual" title="add one entry by hand (fill the fields)">Manual Add</button>'
        + '<button class="minibtn" data-act="load" title="open this preset in the Graphics Builder to edit its design">Edit Preset</button>'
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
      row.querySelector('[data-act="manual"]').onclick = function () { openManual(id, it); };
      var an = row.querySelector('[data-act="anim"]'); if (an) an.onchange = function () { post({ type: 'show_rowmode', id: id, mode: an.checked ? 'reanimate' : 'cut' }); };
      var dl = row.querySelector('[data-act="delay"]'); if (dl) dl.onchange = function () { post({ type: 'show_rowdelay', id: id, ms: +dl.value }); };
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
        var sig = shows.map(function (x) { return x.id + '|' + x.name + '|' + (x.on ? 1 : 0) + '|' + (x.rowCount != null ? x.rowCount : (x.rows ? x.rows.length : 0)) + '|' + (x.rowIndex || 0) + '|' + (x.rowKey || '') + '|' + (x.rowTransition || 'cut'); }).join(',');
        if (sig !== lastSig) { lastSig = sig; render(); }
      } catch (x) {}
    };
    es.onerror = function () { $('conn').className = 'conn off'; $('connTxt').textContent = 'reconnecting…'; };
  }
  connect();
  $('outUrl').textContent = location.protocol + '//' + location.host + '/program-output';
})();
