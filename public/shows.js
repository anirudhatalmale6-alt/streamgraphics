/* StreamGraphics — Show Library control.
 * Save the current Graphics Builder design as a named preset, then toggle presets
 * on/off on the Program output, recall them into the builder, rename, or delete. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var shows = [], ltLayers = [], lastSig = '';
  var revPick = {};   // preset id -> which bullets/slides layer its transport is driving

  function post(action) {
    return fetch('/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(action) }).catch(function () {});
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  var escA = esc;   // esc() already escapes the double quote, so attribute values are safe with it

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
  /* ---- FILL IN ---------------------------------------------------------------------------
   *
   * A design can declare the handful of things that change between showings — a name, a title,
   * a headshot, a team colour — and this turns that declaration into a form. The operator sees
   * those boxes and nothing else.
   *
   * It writes into the preset's ROWS, which is the mechanism the CSV mail-merge has always used,
   * so there is one substitution path rather than two. A form entry and a spreadsheet row are
   * the same thing; "keep this and add another" is literally an extra row. That means a design
   * filled in by hand today can be handed a 400-row spreadsheet tomorrow with nothing to change.
   */
  var fill = null;              // { id, name, fields, columns, rows, cur } while the form is open
  var fillTimers = {};

  function fillPost(a) { return post(a); }

  // Same debounce as the row editor: typing must not fire a request per keystroke, and whatever
  // is pending has to be flushed before the form is closed or re-read, or the last few letters
  // typed are lost at exactly the moment they matter.
  function fillSet(col, value) {
    var k = col;
    if (fillTimers[k]) clearTimeout(fillTimers[k].id);
    var fire = function () {
      delete fillTimers[k];
      if (fill) fillPost({ type: 'show_setcell', id: fill.id, n: fill.cur, col: col, value: value });
    };
    fillTimers[k] = { id: setTimeout(fire, 220), fire: fire };
    if (fill && fill.rows[fill.cur]) fill.rows[fill.cur][col] = value;
  }
  function flushFill() {
    Object.keys(fillTimers).forEach(function (k) { var t = fillTimers[k]; if (t) { clearTimeout(t.id); t.fire(); } });
  }

  function fillLabel(i) {
    var r = fill.rows[i] || {}, key = fill.fields.length ? fill.fields[0].key : (fill.columns[0] || '');
    var v = String(r[key] == null ? '' : r[key]).trim();
    return v || ('Version ' + (i + 1));
  }

  function renderFill() {
    var box = $('fillForm'), row = fill.rows[fill.cur] || {};
    // Media names, so an image field offers what has actually been uploaded instead of asking
    // the operator to remember a filename.
    var media = (window.__sgMedia || []).map(function (m) { return m.rel || m.name || ''; }).filter(Boolean);
    box.innerHTML = '<datalist id="fillMedia">' + media.map(function (m) { return '<option value="' + escA(m) + '"></option>'; }).join('') + '</datalist>'
      + fill.fields.map(function (f, i) {
      var v = row[f.key] == null ? '' : String(row[f.key]);
      var ctl;
      if (f.type === 'multiline') {
        ctl = '<textarea class="inp" data-f="' + escA(f.key) + '" rows="3" style="width:100%;resize:vertical">' + esc(v) + '</textarea>';
      } else if (f.type === 'colour') {
        // A colour box cannot be empty, so the hex is offered as text as well — that is the
        // only way to clear it back to whatever the design itself says.
        ctl = '<span style="display:flex;gap:8px;align-items:center">'
            + '<input type="color" data-f="' + escA(f.key) + '" data-colour="1" value="' + escA(/^#[0-9a-f]{6}$/i.test(v) ? v : '#ffffff') + '" style="width:44px;height:34px;padding:2px">'
            + '<input class="inp" data-fx="' + escA(f.key) + '" value="' + escA(v) + '" placeholder="#rrggbb — blank leaves the design’s own colour" style="flex:1">'
            + '</span>';
      } else if (f.type === 'image') {
        ctl = '<input class="inp" data-f="' + escA(f.key) + '" list="fillMedia" value="' + escA(v) + '" placeholder="file name, e.g. headshot.jpg — upload images below" style="width:100%">';
      } else {
        ctl = '<input class="inp" data-f="' + escA(f.key) + '"' + (f.type === 'number' ? ' type="number"' : '') + ' value="' + escA(v) + '" style="width:100%">';
      }
      return '<div style="display:flex;flex-direction:column;gap:4px;margin-bottom:12px">'
        + '<label style="color:var(--muted);font-size:12px">' + esc(f.label || f.key)
        + (f.hint ? ' <span style="color:var(--muted2)">— ' + esc(f.hint) + '</span>' : '') + '</label>'
        + ctl + '</div>';
    }).join('');

    box.querySelectorAll('[data-f]').forEach(function (inp) {
      var col = inp.getAttribute('data-f');
      inp.oninput = function () {
        fillSet(col, inp.value);
        // The colour picker and its hex box are two views of one value; move them together or
        // the operator reads a colour off one that the graphic is not using.
        if (inp.dataset.colour) {
          var tx = box.querySelector('[data-fx="' + CSS.escape(col) + '"]');
          if (tx) tx.value = inp.value;
        }
      };
    });
    box.querySelectorAll('[data-fx]').forEach(function (inp) {
      var col = inp.getAttribute('data-fx');
      inp.oninput = function () {
        fillSet(col, inp.value);
        var sw = box.querySelector('[data-f="' + CSS.escape(col) + '"]');
        if (sw && /^#[0-9a-f]{6}$/i.test(inp.value)) sw.value = inp.value;
      };
    });

    var many = fill.rows.length > 1;
    $('fillVersions').style.display = many ? 'flex' : 'none';
    if (many) {
      $('fillSel').innerHTML = fill.rows.map(function (r, i) {
        return '<option value="' + i + '"' + (i === fill.cur ? ' selected' : '') + '>' + esc(fillLabel(i)) + '</option>';
      }).join('');
      $('fillCount').textContent = (fill.cur + 1) + ' / ' + fill.rows.length;
    }
    paintFillAir();
  }

  function paintFillAir() {
    if (!fill) return;
    var me = shows.filter(function (x) { return x.id === fill.id; })[0];
    var on = !!(me && me.on);
    var el = $('fillAir');
    el.textContent = on ? 'ON AIR' : 'OFF AIR';
    el.className = 'airstate' + (on ? ' live' : '');
  }

  /* Open the form. A design can declare a field the spreadsheet behind it has never heard of —
   * someone added "Sponsor" to the design after the CSV was imported — so the columns are
   * squared up FIRST. Without that, show_setcell silently refuses an unknown column and the
   * operator types into a box that does nothing. */
  function openFill(id, it) {
    var fields = it.fields || [];
    if (!fields.length) return;
    $('fillMsg').textContent = '';
    fetch('/show-rows?id=' + encodeURIComponent(id)).then(function (r) { return r.json(); }).then(function (res) {
      var cols = res.columns || [], rows = res.rows || [];
      var missing = fields.filter(function (f) {
        return !cols.some(function (c) { return String(c).toLowerCase() === String(f.key).toLowerCase(); });
      });
      var work = missing.map(function (f) { return fillPost({ type: 'show_addcol', id: id, col: f.key }); });
      if (!rows.length) {
        var seed = {}; fields.forEach(function (f) { seed[f.key] = f.default || ''; });
        work.push(fillPost({ type: 'show_addrow', id: id, row: seed }));
      }
      var after = work.length
        ? Promise.all(work).then(function () { return fetch('/show-rows?id=' + encodeURIComponent(id)).then(function (r) { return r.json(); }); })
        : Promise.resolve(res);
      return after;
    }).then(function (res) {
      fill = { id: id, name: it.name, fields: fields, columns: res.columns || [], rows: res.rows || [],
               cur: Math.max(0, Math.min((res.rowIndex || 0), (res.rows || []).length - 1)) };
      $('fillTitle').textContent = 'Fill in — ' + fill.name;
      $('fillModal').style.display = 'flex';
      renderFill();
    }).catch(function () { alert('Could not reach the app.'); });
  }

  function closeFill() { flushFill(); fill = null; $('fillModal').style.display = 'none'; }

  function fillGoto(n) {
    if (!fill) return;
    flushFill();
    fill.cur = Math.max(0, Math.min(n, fill.rows.length - 1));
    fillPost({ type: 'show_rowselect', id: fill.id, cmd: 'goto', n: fill.cur });
    renderFill();
  }

  $('fillDone').onclick = closeFill;
  $('fillModal').onclick = function (e) { if (e.target === $('fillModal')) closeFill(); };
  $('fillOn').onclick = function () { if (fill) fillPost({ type: 'show_toggle', id: fill.id, on: true }); };
  $('fillOff').onclick = function () { if (fill) fillPost({ type: 'show_toggle', id: fill.id, on: false }); };
  $('fillPrev').onclick = function () { if (fill) fillGoto(fill.cur - 1); };
  $('fillNext').onclick = function () { if (fill) fillGoto(fill.cur + 1); };
  $('fillSel').onchange = function () { fillGoto(+this.value); };
  $('fillAddVer').onclick = function () {
    if (!fill) return;
    flushFill();
    // Copies what is on screen rather than starting blank: the next guest usually shares the
    // event name, the sponsor and the colours, and only the person changes.
    var seed = Object.assign({}, fill.rows[fill.cur] || {});
    fillPost({ type: 'show_addrow', id: fill.id, row: seed }).then(function () {
      return fetch('/show-rows?id=' + encodeURIComponent(fill.id)).then(function (r) { return r.json(); });
    }).then(function (res) {
      if (!fill) return;
      fill.rows = res.rows || []; fill.columns = res.columns || [];
      fill.cur = fill.rows.length - 1;
      $('fillMsg').textContent = 'Added version ' + fill.rows.length + ' — edit it below.';
      renderFill();
    }).catch(function () {});
  };

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
      paintRowsAir();
      $('rowsModal').style.display = 'flex';
    }).catch(function () { alert('Could not reach the app.'); });
  }

  /* The on-air state of the graphic being edited. Read from `shows` rather than remembered
     locally: it can be switched from a Stream Deck, a phone or another operator's browser
     while this window is open, and a button that lies about what is on screen is worse than
     no button at all. */
  function paintRowsAir() {
    if (!rowsEdit) return;
    var me = shows.filter(function (x) { return x.id === rowsEdit.id; })[0];
    var on = !!(me && me.on);
    var badge = $('rowsAir');
    badge.textContent = on ? 'ON AIR' : 'OFF AIR';
    badge.className = 'airstate' + (on ? ' live' : '');
    $('rowsOn').style.display = on ? 'none' : '';
    $('rowsOff').style.display = on ? '' : 'none';
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
  $('rowsOn').onclick  = function () { if (rowsEdit) rowsPost({ type: 'show_toggle', id: rowsEdit.id, on: true }); };
  $('rowsOff').onclick = function () { if (rowsEdit) rowsPost({ type: 'show_toggle', id: rowsEdit.id, on: false }); };
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
        + ((it.fields && it.fields.length) ? '<button class="minibtn" data-act="fill" title="fill in this design\'s own fields" style="border-color:#7c9cff;color:#cfe0f5;font-weight:700">✎ Fill in</button>' : '')
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
      // Reveal transport — bullet builds and slide decks stepped while the preset is on air.
      // Before this the index could only be moved from inside the builder, so anything saved
      // to the Library was frozen on whatever bullet it happened to be showing.
      var rev = '';
      var reveals = it.reveals || [];
      if (reveals.length) {
        var pick = revPick[it.id];
        var cur = reveals.filter(function (r) { return r.id === pick; })[0] || reveals[0];
        var picker = reveals.length > 1
          ? '<select class="inp" data-act="revsel" style="width:auto">' + reveals.map(function (r) {
              return '<option value="' + esc(r.id) + '"' + (r.id === cur.id ? ' selected' : '') + '>' + esc(r.name || (r.type === 'bullets' ? 'Bullets' : 'Slides')) + '</option>';
            }).join('') + '</select>'
          : '<span class="kind">' + esc(cur.name || (cur.type === 'bullets' ? 'bullets' : 'slides')) + '</span>';
        rev = '<div class="revrow" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:10px;padding-top:10px;border-top:1px solid var(--line)">'
          + '<span class="kind">Reveal</span>' + picker
          + '<button class="minibtn" data-act="revfirst" title="back to the first one">⏮</button>'
          + '<button class="minibtn" data-act="revprev" title="step back">◀</button>'
          + '<span class="mono" style="color:var(--muted);min-width:56px;text-align:center">' + (cur.index < 0 ? '–' : (cur.index + 1)) + ' / ' + cur.count + '</span>'
          + '<button class="minibtn" data-act="revnext" title="reveal the next one" style="border-color:#2f7d5a;color:#7ee2b0">Next ▶</button>'
          + '<button class="minibtn" data-act="revall" title="reveal everything at once">All</button>'
          + '<button class="minibtn" data-act="revblank" title="back to nothing revealed">Blank</button>'
          + '</div>';
      }
      return '<div class="libitem' + (it.on ? ' on' : '') + '" data-id="' + it.id + '" style="flex-direction:column;align-items:stretch">' + main + csv + rev + '</div>';
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
      var fi = row.querySelector('[data-act="fill"]'); if (fi) fi.onclick = function () { openFill(id, it); };
      row.querySelector('[data-act="manual"]').onclick = function () { openManual(id, it); };
      var an = row.querySelector('[data-act="anim"]'); if (an) an.onchange = function () { post({ type: 'show_rowmode', id: id, mode: an.checked ? 'reanimate' : 'cut' }); };
      var dl = row.querySelector('[data-act="delay"]'); if (dl) dl.onchange = function () { post({ type: 'show_rowdelay', id: id, ms: +dl.value }); };
      var er = row.querySelector('[data-act="editrows"]'); if (er) er.onclick = function () { openRows(id); };
      var rvSel = row.querySelector('[data-act="revsel"]'); if (rvSel) rvSel.onchange = function () { revPick[id] = rvSel.value; render(); };
      ['first', 'prev', 'next', 'all', 'blank'].forEach(function (cmd) {
        var b = row.querySelector('[data-act="rev' + cmd + '"]'); if (!b) return;
        b.onclick = function () {
          var picked = revPick[id] || ((it.reveals || [])[0] || {}).id;
          post({ type: 'show_layercmd', id: id, layerId: picked, cmd: cmd });
        };
      });
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
      window.__sgMedia = files.map(function (p) { return { rel: p }; });   // offered to image fields on the fill-in form
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
  $('copyBtn').onclick = function () { SGLinks.copy($('outUrl').textContent, this); };

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
        // The fill-in form shows an ON AIR badge and a version picker; both can be moved from a
        // Stream Deck or another browser, so they follow the server rather than this page.
        if (fill) {
          var fme = shows.filter(function (x) { return x.id === fill.id; })[0];
          if (!fme) closeFill();
          else {
            paintFillAir();
            var fi2 = fme.rowIndex || 0;
            if (fi2 !== fill.cur && !Object.keys(fillTimers).length) {
              fill.cur = fi2;
              fetch('/show-rows?id=' + encodeURIComponent(fill.id)).then(function (r) { return r.json(); })
                .then(function (res) { if (fill) { fill.rows = res.rows || []; fill.columns = res.columns || []; renderFill(); } })
                .catch(function () {});
            }
          }
        }
        if (rowsEdit) {
          var me = shows.filter(function (x) { return x.id === rowsEdit.id; })[0];
          if (me) {
            paintRowsAir();
            var ci = me.rowIndex || 0;
            if (ci !== rowsEdit.cur) { rowsEdit.cur = ci; paintCurrent(); }
            var cnt = me.rowCount != null ? me.rowCount : ((me.rows || []).length);
            if (cnt !== rowsEdit.rows.length && Date.now() > (rowsEdit.busyUntil || 0)) openRows(rowsEdit.id);
          } else { closeRows(); }   // the preset was deleted out from under us
        }

        // Only rebuild the list when the library actually changed (not on every unrelated update).
        var sig = shows.map(function (x) {
          // Reveal position is in the signature so the transport's "3 / 6" keeps up with whoever
          // pressed Next — this page, another operator's browser, or a Companion button.
          var rv = (x.reveals || []).map(function (r) { return r.id + ':' + r.index + '/' + r.count + ':' + (r.name || ''); }).join('~');
          return x.id + '|' + x.name + '|' + (x.on ? 1 : 0) + '|' + (x.rowCount != null ? x.rowCount : (x.rows ? x.rows.length : 0)) + '|' + (x.rowIndex || 0) + '|' + (x.rowKey || '') + '|' + (x.rowTransition || 'cut') + '|' + rv;
        }).join(',');
        if (sig !== lastSig) { lastSig = sig; render(); }
      } catch (x) {}
    };
    es.onerror = function () { $('conn').className = 'conn off'; $('connTxt').textContent = 'reconnecting…'; };
  }
  connect();
  // The address another computer can reach, not localhost — see sg-links.js.
  SGLinks.onbase(function () { $('outUrl').textContent = SGLinks.url('/program-output'); });

  /* ---- put this output on a chosen monitor (sg-screens.js) ----
   * The panel supplies an empty row and a hint line; the module draws the controls, remembers
   * the monitor BY NAME, keeps the window handle across a reload of this page, and offers a way
   * to close the window again. One implementation for every panel that has an output. */
  if (window.SGScreens && document.getElementById('screenRow')) {
    SGScreens.mount({
      root: document.getElementById('screenRow'),
      hint: document.getElementById('screenHint'),
      key: 'sg.program.screen',
      what: 'Program',
      outputs: [{ label: 'Open the Program output there ▸', path: '/program-output', name: 'sgout-program' }]
    });
  }
})();
