/* StreamGraphics — Lower Third BUILDER control.
 * A WYSIWYG canvas of layers (text / box / image). Drag to move, edit properties,
 * animate each layer. The full layer array is pushed to the server on every change. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var SCALE = 0.375;                 // canvas is 1920x1080 shown at 720x405
  var layers = [], selId = null, selIds = [], loaded = false, seq = 0;
  var cstage = $('cstage');

  function uid() { return 'L' + Date.now().toString(36) + (seq++); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }
  function rgba(hex, pct) {
    hex = String(hex || '#000').replace(/^#/, ''); if (hex.length === 3) hex = hex.replace(/(.)/g, '$1$1');
    var r = parseInt(hex.slice(0, 2), 16) || 0, g = parseInt(hex.slice(2, 4), 16) || 0, b = parseInt(hex.slice(4, 6), 16) || 0;
    return 'rgba(' + r + ',' + g + ',' + b + ',' + (pct == null ? 1 : pct / 100) + ')';
  }
  function byId(id) { for (var i = 0; i < layers.length; i++) if (layers[i].id === id) return layers[i]; return null; }
  function selected() { return byId(selId); }

  function push() {
    fetch('/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'lt_layers', layers: layers }) }).catch(function () {});
  }

  /* ---- render the canvas ---- */
  function innerHtml(l) {
    if (l.type === 'box') return '<div class="li ly-box" style="width:100%;height:100%;background:' + rgba(l.fill, l.opacity) + ';border-radius:' + (l.radius || 0) + 'px"></div>';
    if (l.type === 'text') {
      var st = 'font-family:' + (l.font || 'Arial') + ';font-size:' + (l.size || 24) + 'px;color:' + esc(l.color || '#fff')
        + ';font-weight:' + (l.bold ? '800' : '400') + ';font-style:' + (l.italic ? 'italic' : 'normal') + ';text-align:' + (l.align || 'left')
        + ';align-items:' + (l.align === 'center' ? 'center' : (l.align === 'right' ? 'flex-end' : 'flex-start'));
      return '<div class="li ly-text" style="' + st + '">' + esc(l.text || '') + '</div>';
    }
    if (l.type === 'image') {
      if (!l.src) return '<div class="li" style="width:100%;height:100%;border:2px dashed #6b7a90;border-radius:' + (l.shape === 'circle' ? '50%' : '10px') + ';display:flex;align-items:center;justify-content:center;color:#9fb0c8;font-size:26px">IMAGE</div>';
      return '<img class="li ly-img ' + (l.fit === 'cover' ? 'cover ' : '') + (l.shape || 'none') + '" src="' + esc(l.src) + '" style="width:100%;height:100%">';
    }
    if (l.type === 'video') {
      if (!l.src) return '<div class="li" style="width:100%;height:100%;border:2px dashed #6b7a90;border-radius:10px;display:flex;align-items:center;justify-content:center;color:#9fb0c8;font-size:26px">▶ VIDEO</div>';
      return '<video class="li" src="' + esc(l.src) + '" muted autoplay loop playsinline style="width:100%;height:100%;object-fit:' + (l.fit === 'cover' ? 'cover' : 'contain') + '"></video>';
    }
    if (l.type === 'ticker') {
      var tk = 'font-family:' + (l.font || 'Arial') + ';font-size:' + (l.size || 28) + 'px;color:' + esc(l.color || '#fff') + ';font-weight:' + (l.bold ? '800' : '600');
      return '<div class="li" style="width:100%;height:100%;background:' + rgba(l.fill, l.opacity) + ';border-radius:' + (l.radius || 0) + 'px;overflow:hidden;display:flex;align-items:center;padding:0 12px"><span style="white-space:nowrap;' + tk + '">' + esc(l.text || 'scrolling text') + '</span></div>';
    }
    return '';
  }
  function renderCanvas() {
    var byZ = layers.slice().sort(function (a, b) { return (a.z || 0) - (b.z || 0); });
    cstage.innerHTML = byZ.map(function (l) {
      var t = l.rot ? ';transform:rotate(' + l.rot + 'deg);transform-origin:center' : '';
      return '<div class="ly' + (selIds.indexOf(l.id) >= 0 ? ' sel' : '') + '" data-id="' + l.id + '" style="left:' + l.x + 'px;top:' + l.y + 'px;width:' + l.w + 'px;height:' + l.h + 'px;z-index:' + (l.z || 0) + t + '">' + innerHtml(l) + '</div>';
    }).join('');
    cstage.querySelectorAll('.ly').forEach(function (el) { el.addEventListener('mousedown', startDrag); });
    renderHandles();
  }
  function renderList() {
    var byZ = layers.slice().sort(function (a, b) { return (b.z || 0) - (a.z || 0); }); // top layer first
    $('layerList').innerHTML = byZ.map(function (l) {
      var name = (l.type === 'text' || l.type === 'ticker') ? (l.text || (l.type === 'ticker' ? 'Ticker' : 'Text'))
               : l.type === 'box' ? 'Box' : l.type === 'video' ? 'Video' : 'Image';
      return '<div class="llrow' + (l.id === selId ? ' sel' : '') + '" data-id="' + l.id + '">'
           + '<span class="t">' + esc(name) + '</span><span class="mini2">' + l.type + '</span>'
           + '<button data-mv="up" title="move up">▲</button><button data-mv="down" title="move down">▼</button></div>';
    }).join('') || '<div class="llrow"><span class="mini2">No layers — add one above.</span></div>';
    $('layerList').querySelectorAll('.llrow[data-id]').forEach(function (row) {
      row.onclick = function (e) { if (e.target.dataset.mv) return; select(row.dataset.id, e.shiftKey); };
      row.querySelectorAll('[data-mv]').forEach(function (btn) {
        btn.onclick = function (e) { e.stopPropagation(); reorder(row.dataset.id, btn.dataset.mv === 'up' ? -1 : 1); };
      });
    });
  }
  // Move a layer up/down in the stack (renumbers z so order is stable).
  function reorder(id, dir) {
    var sorted = layers.slice().sort(function (a, b) { return (b.z || 0) - (a.z || 0); }); // top first
    var i = -1; for (var k = 0; k < sorted.length; k++) if (sorted[k].id === id) i = k;
    var j = i + dir; if (i < 0 || j < 0 || j >= sorted.length) return;
    var t = sorted[i]; sorted[i] = sorted[j]; sorted[j] = t;
    var n = sorted.length; sorted.forEach(function (l, idx) { l.z = n - idx; }); // top -> highest z
    renderCanvas(); renderList(); push();
  }

  /* ---- selection + properties ----
     IMPORTANT: selecting must NOT rebuild the canvas (that detaches the element
     you're about to drag). Just toggle the highlight on the existing elements. */
  function groupMembers(gid) { return layers.filter(function (x) { return x.group && x.group === gid; }).map(function (x) { return x.id; }); }
  function select(id, additive) {
    var l = byId(id);
    if (additive) {
      var i = selIds.indexOf(id);
      if (i >= 0) selIds.splice(i, 1); else selIds.push(id);
      selId = selIds[selIds.length - 1] || null;
    } else {
      selIds = (l && l.group) ? groupMembers(l.group) : (id ? [id] : []);
      selId = id || null;
    }
    cstage.querySelectorAll('.ly').forEach(function (el) { el.classList.toggle('sel', selIds.indexOf(el.dataset.id) >= 0); });
    renderList(); syncProps(); renderHandles();
  }
  function show(sel, on) { document.querySelectorAll(sel).forEach(function (e) { e.style.display = on ? '' : 'none'; }); }
  function syncProps() {
    var multi = selIds.length > 1;
    var l = selId ? byId(selId) : (selIds.length ? byId(selIds[0]) : null);
    if (!l) { $('propTitle').textContent = 'No layer selected'; $('propBody').classList.add('hidden'); return; }
    $('propBody').classList.remove('hidden');
    show('.multi-only', multi); show('.single-only', !multi);
    if (multi) {
      var grouped = selIds.every(function (id) { var m = byId(id); return m && m.group && m.group === l.group; });
      $('propTitle').textContent = selIds.length + ' layers selected' + (grouped ? ' (grouped)' : '');
      show('.only-text', false); show('.only-box', false); show('.only-image', false); show('.only-video', false); show('.only-ticker', false);
    } else {
      $('propTitle').textContent = l.type.charAt(0).toUpperCase() + l.type.slice(1) + ' layer' + (l.group ? ' (grouped)' : '');
      show('.only-text', l.type === 'text'); show('.only-box', l.type === 'box'); show('.only-image', l.type === 'image');
      show('.only-video', l.type === 'video'); show('.only-ticker', l.type === 'ticker');
    }
    if (l.type === 'text') { $('pText').value = l.text || ''; $('pFont').value = l.font || "'Segoe UI', Arial, sans-serif"; $('pSize').value = l.size || 34; $('pBold').checked = !!l.bold; $('pItalic').checked = !!l.italic; $('pColor').value = l.color || '#ffffff'; $('pAlign').value = l.align || 'left'; }
    if (l.type === 'box') { $('pFill').value = l.fill || '#0b1f3a'; $('pOpacity').value = l.opacity == null ? 95 : l.opacity; $('pRadius').value = l.radius || 0; $('pRadiusV').textContent = l.radius || 0; }
    if (l.type === 'image') { $('pSrc').value = l.src || ''; $('pShape').value = l.shape || 'none'; $('pFit').value = l.fit || 'contain'; }
    if (l.type === 'video') { $('pVSrc').value = l.src || ''; $('pAutoplay').checked = l.autoplay !== false; $('pLoop').checked = !!l.loop; $('pMuted').checked = l.muted !== false; $('pVFit').value = l.fit || 'contain'; }
    if (l.type === 'ticker') { $('pTkText').value = l.text || ''; $('pTkSpeed').value = l.speed == null ? 120 : l.speed; $('pTkSpeedV').textContent = l.speed == null ? 120 : l.speed; $('pTkDir').value = l.dir || 'left'; $('pTkColor').value = l.color || '#ffffff'; $('pTkSize').value = l.size || 28; $('pTkBold').checked = !!l.bold; $('pTkFill').value = l.fill || '#0b1f3a'; $('pTkOpacity').value = l.opacity == null ? 90 : l.opacity; $('pTkRadius').value = l.radius || 0; }
    $('pX').value = l.x; $('pY').value = l.y; $('pW').value = l.w; $('pH').value = l.h;
    $('pInAnim').value = l.inAnim || 'fade'; $('pInDelay').value = l.inDelay || 0; $('pInDur').value = l.inDur == null ? 500 : l.inDur;
    $('pOutAnim').value = l.outAnim || 'fade'; $('pOutDelay').value = l.outDelay || 0; $('pOutDur').value = l.outDur == null ? 350 : l.outDur;
  }
  function mutate(fn) { var l = selected(); if (!l) return; fn(l); renderCanvas(); renderList(); push(); }
  // apply to EVERY selected layer (so a group's animation is set together)
  function mutateSel(fn) { (selIds.length ? selIds : (selId ? [selId] : [])).forEach(function (id) { var l = byId(id); if (l) fn(l); }); renderCanvas(); renderList(); push(); }

  // wire property inputs
  $('pText').oninput = function () { mutate(function (l) { l.text = $('pText').value; }); };
  $('pFont').onchange = function () { mutate(function (l) { l.font = $('pFont').value; }); };
  $('pSize').oninput = function () { mutate(function (l) { l.size = +$('pSize').value; }); };
  $('pBold').onchange = function () { mutate(function (l) { l.bold = $('pBold').checked; }); };
  $('pItalic').onchange = function () { mutate(function (l) { l.italic = $('pItalic').checked; }); };
  $('pColor').oninput = function () { mutate(function (l) { l.color = $('pColor').value; }); };
  $('pAlign').onchange = function () { mutate(function (l) { l.align = $('pAlign').value; }); };
  $('pFill').oninput = function () { mutate(function (l) { l.fill = $('pFill').value; }); };
  $('pOpacity').oninput = function () { mutate(function (l) { l.opacity = +$('pOpacity').value; }); };
  $('pRadius').oninput = function () { $('pRadiusV').textContent = $('pRadius').value; mutate(function (l) { l.radius = +$('pRadius').value; }); };
  $('pSrc').oninput = function () { mutate(function (l) { l.src = $('pSrc').value; }); };
  $('pShape').onchange = function () { mutate(function (l) { l.shape = $('pShape').value; }); };
  $('pFit').onchange = function () { mutate(function (l) { l.fit = $('pFit').value; }); };
  // video props
  $('pVSrc').oninput = function () { mutate(function (l) { l.src = $('pVSrc').value; }); };
  $('pAutoplay').onchange = function () { mutate(function (l) { l.autoplay = $('pAutoplay').checked; }); };
  $('pLoop').onchange = function () { mutate(function (l) { l.loop = $('pLoop').checked; }); };
  $('pMuted').onchange = function () { mutate(function (l) { l.muted = $('pMuted').checked; }); };
  $('pVFit').onchange = function () { mutate(function (l) { l.fit = $('pVFit').value; }); };
  function vcmd(cmd) { if (selId) fetch('/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'lt_vcmd', id: selId, cmd: cmd }) }); }
  $('pVPlay').onclick = function () { vcmd('play'); };
  $('pVPause').onclick = function () { vcmd('pause'); };
  $('pVRestart').onclick = function () { vcmd('restart'); };
  $('pVFile').onchange = function () {
    var f = $('pVFile').files[0]; if (!f) return; var r = new FileReader();
    r.onload = function () { fetch('/upload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: f.name, data: r.result }) }).then(function (x) { return x.json(); }).then(function (res) { if (res && res.ok) mutate(function (l) { l.src = res.url; $('pVSrc').value = res.url; }); else alert('Upload failed. Use a web-friendly video (mp4/H.264 or webm) under ~150 MB.'); }).catch(function () { alert('Upload failed.'); }); };
    r.readAsDataURL(f); $('pVFile').value = '';
  };
  // ticker props
  $('pTkText').oninput = function () { mutate(function (l) { l.text = $('pTkText').value; }); };
  // pop-out editor for long ticker text (live)
  $('pTkExpand').onclick = function () { $('tkModalText').value = $('pTkText').value; $('tkModal').style.display = 'flex'; $('tkModalText').focus(); };
  $('tkModalText').oninput = function () { $('pTkText').value = $('tkModalText').value; mutate(function (l) { l.text = $('tkModalText').value; }); };
  $('tkModalClose').onclick = function () { $('tkModal').style.display = 'none'; };
  $('tkModal').onclick = function (e) { if (e.target === $('tkModal')) $('tkModal').style.display = 'none'; };
  $('pTkSpeed').oninput = function () { $('pTkSpeedV').textContent = $('pTkSpeed').value; mutate(function (l) { l.speed = +$('pTkSpeed').value; }); };
  $('pTkDir').onchange = function () { mutate(function (l) { l.dir = $('pTkDir').value; }); };
  $('pTkColor').oninput = function () { mutate(function (l) { l.color = $('pTkColor').value; }); };
  $('pTkSize').oninput = function () { mutate(function (l) { l.size = +$('pTkSize').value; }); };
  $('pTkBold').onchange = function () { mutate(function (l) { l.bold = $('pTkBold').checked; }); };
  $('pTkFill').oninput = function () { mutate(function (l) { l.fill = $('pTkFill').value; }); };
  $('pTkOpacity').oninput = function () { mutate(function (l) { l.opacity = +$('pTkOpacity').value; }); };
  $('pTkRadius').oninput = function () { mutate(function (l) { l.radius = +$('pTkRadius').value; }); };
  ['pX', 'pY', 'pW', 'pH'].forEach(function (id) { $(id).oninput = function () { mutate(function (l) { l[id.slice(1).toLowerCase()] = Math.round(+$(id).value); }); }; });
  $('pInAnim').onchange = function () { mutateSel(function (l) { l.inAnim = $('pInAnim').value; }); };
  $('pInDelay').oninput = function () { mutateSel(function (l) { l.inDelay = +$('pInDelay').value; }); };
  $('pInDur').oninput = function () { mutateSel(function (l) { l.inDur = +$('pInDur').value; }); };
  $('pOutAnim').onchange = function () { mutateSel(function (l) { l.outAnim = $('pOutAnim').value; }); };
  $('pOutDelay').oninput = function () { mutateSel(function (l) { l.outDelay = +$('pOutDelay').value; }); };
  $('pOutDur').oninput = function () { mutateSel(function (l) { l.outDur = +$('pOutDur').value; }); };
  $('pBack').onclick = function () { mutate(function (l) { l.z = Math.min.apply(null, layers.map(function (x) { return x.z || 0; })) - 1; }); };
  $('pFront').onclick = function () { mutate(function (l) { l.z = Math.max.apply(null, layers.map(function (x) { return x.z || 0; })) + 1; }); };
  function deleteSelected() { var ids = selIds.length ? selIds.slice() : (selId ? [selId] : []); layers = layers.filter(function (x) { return ids.indexOf(x.id) < 0; }); selId = null; selIds = []; renderCanvas(); renderList(); syncProps(); push(); }
  $('pDelete').onclick = deleteSelected;
  $('btnGroup').onclick = function () { if (selIds.length < 2) { alert('Shift-click two or more layers first, then Group.'); return; } var gid = uid(); selIds.forEach(function (id) { var l = byId(id); if (l) l.group = gid; }); renderList(); syncProps(); push(); };
  $('btnUngroup').onclick = function () { (selIds.length ? selIds : (selId ? [selId] : [])).forEach(function (id) { var l = byId(id); if (l) delete l.group; }); renderList(); syncProps(); push(); };

  $('pFile').onchange = function () {
    var f = $('pFile').files[0]; if (!f) return; var r = new FileReader();
    r.onload = function () {
      fetch('/upload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: f.name, data: r.result }) })
        .then(function (x) { return x.json(); }).then(function (res) { if (res && res.ok) mutate(function (l) { l.src = res.url; $('pSrc').value = res.url; }); else alert('Upload failed.'); });
    };
    r.readAsDataURL(f); $('pFile').value = '';
  };

  /* ---- add layers ---- */
  function topZ() { return layers.length ? Math.max.apply(null, layers.map(function (l) { return l.z || 0; })) + 1 : 1; }
  function add(l) { l.id = uid(); l.z = topZ(); layers.push(l); selId = l.id; selIds = [l.id]; renderCanvas(); renderList(); syncProps(); push(); }
  var A = function (inA) { return { inAnim: inA, inDelay: 0, inDur: 500, outAnim: 'fade', outDelay: 0, outDur: 300 }; };
  function merge(a, b) { for (var k in b) a[k] = b[k]; return a; }
  $('addText').onclick = function () { add(merge({ type: 'text', x: 200, y: 500, w: 560, h: 60, text: 'New text', font: 'Arial, Helvetica, sans-serif', size: 40, bold: true, italic: false, color: '#ffffff', align: 'left' }, A('fade'))); };
  $('addBox').onclick = function () { add(merge({ type: 'box', x: 160, y: 900, w: 620, h: 100, fill: '#0b1f3a', opacity: 95, radius: 12 }, A('slide-up'))); };
  $('addImage').onclick = function () { add(merge({ type: 'image', x: 120, y: 860, w: 140, h: 140, src: '', shape: 'circle', fit: 'contain' }, A('scale'))); };
  $('addVideo').onclick = function () { add(merge({ type: 'video', x: 660, y: 340, w: 600, h: 338, src: '', autoplay: true, loop: false, muted: true, fit: 'contain', shape: 'none' }, A('fade'))); };
  $('addTicker').onclick = function () { add(merge({ type: 'ticker', x: 0, y: 1000, w: 1920, h: 60, text: 'BREAKING: your scrolling headline goes here', speed: 120, dir: 'left', font: 'Arial, Helvetica, sans-serif', size: 30, bold: true, color: '#ffffff', fill: '#0b1f3a', opacity: 92, radius: 0 }, A('slide-up'))); };
  // full-screen background colour box (goes to the very back)
  $('addBg').onclick = function () {
    var bg = merge({ type: 'box', x: 0, y: 0, w: 1920, h: 1080, fill: '#0b1f3a', opacity: 100, radius: 0 }, A('fade'));
    bg.id = uid(); bg.z = layers.length ? Math.min.apply(null, layers.map(function (l) { return l.z || 0; })) - 1 : 0;
    layers.push(bg); selId = bg.id; renderCanvas(); renderList(); syncProps(); push();
  };

  /* ---- reference image: a design aid shown only in the builder (never on air) ---- */
  var refimg = $('refimg');
  function loadRef() { try { var r = JSON.parse(localStorage.getItem('lt_ref') || '{}'); if (r.url) { refimg.src = r.url; refimg.style.display = 'block'; } refimg.style.opacity = (r.opacity == null ? 50 : r.opacity) / 100; $('refOpacity').value = r.opacity == null ? 50 : r.opacity; } catch (e) {} }
  function saveRef(o) { try { localStorage.setItem('lt_ref', JSON.stringify(o)); } catch (e) {} }
  $('refFile').onchange = function () {
    var f = $('refFile').files[0]; if (!f) return; var r = new FileReader();
    r.onload = function () {
      fetch('/upload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: f.name, data: r.result }) })
        .then(function (x) { return x.json(); }).then(function (res) { if (res && res.ok) { refimg.src = res.url; refimg.style.display = 'block'; saveRef({ url: res.url, opacity: +$('refOpacity').value }); } });
    };
    r.readAsDataURL(f); $('refFile').value = '';
  };
  $('refOpacity').oninput = function () { refimg.style.opacity = $('refOpacity').value / 100; var r = JSON.parse(localStorage.getItem('lt_ref') || '{}'); r.opacity = +$('refOpacity').value; saveRef(r); };
  $('refClear').onclick = function () { refimg.removeAttribute('src'); refimg.style.display = 'none'; localStorage.removeItem('lt_ref'); };
  loadRef();
  $('btnReset').onclick = function () { if (confirm('Reset the lower third to the default design?')) fetch('/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'lt_reset' }) }); };

  /* ---- drag on canvas ---- */
  var drag = null;
  function startDrag(e) {
    var id = e.currentTarget.dataset.id;
    if (e.shiftKey) { select(id, true); e.preventDefault(); return; }   // shift-click toggles selection, no drag
    if (selIds.indexOf(id) < 0) select(id, false);                       // selects the layer (or its whole group)
    var ids = selIds.slice(), orig = {};
    ids.forEach(function (lid) { var l = byId(lid); if (l) orig[lid] = { x: l.x, y: l.y }; });
    drag = { ids: ids, orig: orig, sx: e.clientX, sy: e.clientY };
    e.preventDefault();
  }
  document.addEventListener('mousemove', function (e) {
    if (!drag) return;
    var dx = (e.clientX - drag.sx) / SCALE, dy = (e.clientY - drag.sy) / SCALE;
    drag.ids.forEach(function (lid) {
      var l = byId(lid); if (!l || !drag.orig[lid]) return;
      l.x = Math.round(drag.orig[lid].x + dx); l.y = Math.round(drag.orig[lid].y + dy);
      var el = cstage.querySelector('.ly[data-id="' + lid + '"]');
      if (el) { el.style.left = l.x + 'px'; el.style.top = l.y + 'px'; }
    });
    if (selId) { var pl = byId(selId); if (pl) { $('pX').value = pl.x; $('pY').value = pl.y; } }
    renderHandles();
  });
  document.addEventListener('mouseup', function () { if (drag) { drag = null; push(); } });

  /* ---- select / resize / rotate handles on the canvas ---- */
  var canvasEl = $('canvas');
  var handles = document.createElement('div');
  handles.id = 'handles';
  handles.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:9999';
  canvasEl.appendChild(handles);
  var DIRS = [[-1,-1],[0,-1],[1,-1],[1,0],[1,1],[0,1],[-1,1],[-1,0]]; // nw,n,ne,e,se,s,sw,w
  function rot2(x, y, rad) { var c = Math.cos(rad), s = Math.sin(rad); return { x: x * c - y * s, y: x * s + y * c }; }

  function renderHandles() {
    handles.innerHTML = '';
    // multi-select / group: just draw a dashed bounding box around all (drag to move together)
    if (selIds.length > 1) {
      var xs = [], ys = [], xe = [], ye = [];
      selIds.forEach(function (id) { var m = byId(id); if (!m) return; xs.push(m.x); ys.push(m.y); xe.push(m.x + m.w); ye.push(m.y + m.h); });
      if (!xs.length) return;
      var bx = Math.min.apply(null, xs) * SCALE, by = Math.min.apply(null, ys) * SCALE;
      var bw = (Math.max.apply(null, xe) - Math.min.apply(null, xs)) * SCALE, bh = (Math.max.apply(null, ye) - Math.min.apply(null, ys)) * SCALE;
      var d = document.createElement('div');
      d.style.cssText = 'position:absolute;left:' + bx + 'px;top:' + by + 'px;width:' + bw + 'px;height:' + bh + 'px;border:2px dashed #3b82f6;border-radius:3px;pointer-events:none;box-shadow:0 0 0 9999px rgba(59,130,246,.04) inset';
      handles.appendChild(d);
      return;
    }
    var l = selected(); if (!l) return;
    var rad = (l.rot || 0) * Math.PI / 180;
    var Cx = l.x + l.w / 2, Cy = l.y + l.h / 2;
    function scr(wx, wy) { return { x: wx * SCALE, y: wy * SCALE }; }
    function handleAt(wx, wy, cls, cursor) {
      var s = scr(wx, wy);
      var h = document.createElement('div');
      h.className = 'gh ' + cls;
      h.style.cssText = 'position:absolute;width:12px;height:12px;margin:-6px 0 0 -6px;left:' + s.x + 'px;top:' + s.y + 'px;background:#fff;border:2px solid #3b82f6;border-radius:2px;pointer-events:auto;cursor:' + cursor + '';
      return h;
    }
    // outline
    var corners = [[-1,-1],[1,-1],[1,1],[-1,1]].map(function (d) { var p = rot2(d[0]*l.w/2, d[1]*l.h/2, rad); return scr(Cx+p.x, Cy+p.y); });
    var svgns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(svgns, 'svg'); svg.setAttribute('style', 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible');
    var poly = document.createElementNS(svgns, 'polygon');
    poly.setAttribute('points', corners.map(function (c) { return c.x + ',' + c.y; }).join(' '));
    poly.setAttribute('fill', 'none'); poly.setAttribute('stroke', '#3b82f6'); poly.setAttribute('stroke-width', '1.5'); poly.setAttribute('stroke-dasharray', '4 3');
    // rotate connector
    var topC = rot2(0, -l.h/2, rad); var tcS = scr(Cx+topC.x, Cy+topC.y);
    var up = rot2(0, -1, rad); var rotS = { x: tcS.x + up.x * 26, y: tcS.y + up.y * 26 };
    var line = document.createElementNS(svgns, 'line'); line.setAttribute('x1', tcS.x); line.setAttribute('y1', tcS.y); line.setAttribute('x2', rotS.x); line.setAttribute('y2', rotS.y);
    line.setAttribute('stroke', '#3b82f6'); line.setAttribute('stroke-width', '1.5');
    svg.appendChild(poly); svg.appendChild(line); handles.appendChild(svg);
    // resize handles
    var CURS = ['nwse-resize','ns-resize','nesw-resize','ew-resize','nwse-resize','ns-resize','nesw-resize','ew-resize'];
    DIRS.forEach(function (d, i) {
      var p = rot2(d[0]*l.w/2, d[1]*l.h/2, rad);
      var h = handleAt(Cx+p.x, Cy+p.y, 'rs', CURS[i]);
      h.addEventListener('mousedown', function (e) { e.stopPropagation(); e.preventDefault(); startResize(l.id, d, e); });
      handles.appendChild(h);
    });
    // rotate handle
    var rh = document.createElement('div');
    rh.className = 'gh-rot';
    rh.style.cssText = 'position:absolute;width:14px;height:14px;margin:-7px 0 0 -7px;left:' + rotS.x + 'px;top:' + rotS.y + 'px;background:#3b82f6;border:2px solid #fff;border-radius:50%;pointer-events:auto;cursor:grab';
    rh.addEventListener('mousedown', function (e) { e.stopPropagation(); e.preventDefault(); startRotate(l.id, e); });
    handles.appendChild(rh);
  }

  var hop = null;
  function canvasPoint(e) { var r = canvasEl.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  function startResize(id, dir, e) {
    var l = byId(id); var rad = (l.rot || 0) * Math.PI / 180;
    var Cx = l.x + l.w / 2, Cy = l.y + l.h / 2;
    var aLocal = { x: -dir[0]*l.w/2, y: -dir[1]*l.h/2 };            // opposite handle (stays fixed)
    var aWorld = rot2(aLocal.x, aLocal.y, rad); aWorld = { x: Cx + aWorld.x, y: Cy + aWorld.y };
    hop = { kind: 'resize', id: id, dir: dir, rad: rad, aWorld: aWorld, startW: l.w, startH: l.h, start: canvasPoint(e) };
  }
  function startRotate(id, e) {
    var l = byId(id); var Cx = (l.x + l.w / 2) * SCALE, Cy = (l.y + l.h / 2) * SCALE; var p = canvasPoint(e);
    var a0 = Math.atan2(p.y - Cy, p.x - Cx);
    hop = { kind: 'rotate', id: id, cx: Cx, cy: Cy, a0: a0, startRot: l.rot || 0 };
  }
  document.addEventListener('mousemove', function (e) {
    if (!hop) return; var l = byId(hop.id); if (!l) return;
    var p = canvasPoint(e);
    if (hop.kind === 'resize') {
      var dsx = (p.x - hop.start.x) / SCALE, dsy = (p.y - hop.start.y) / SCALE;
      var ld = rot2(dsx, dsy, -hop.rad);                          // delta in the layer's local frame
      var nw = Math.max(10, Math.round(hop.startW + hop.dir[0] * ld.x));
      var nh = Math.max(10, Math.round(hop.startH + hop.dir[1] * ld.y));
      var naLocal = { x: -hop.dir[0]*nw/2, y: -hop.dir[1]*nh/2 };
      var naW = rot2(naLocal.x, naLocal.y, hop.rad);
      var nc = { x: hop.aWorld.x - naW.x, y: hop.aWorld.y - naW.y };
      l.w = nw; l.h = nh; l.x = Math.round(nc.x - nw/2); l.y = Math.round(nc.y - nh/2);
    } else {
      var ang = Math.atan2(p.y - hop.cy, p.x - hop.cx);
      l.rot = Math.round((hop.startRot + (ang - hop.a0) * 180 / Math.PI) % 360);
    }
    var el = cstage.querySelector('.ly[data-id="' + l.id + '"]');
    if (el) { el.style.left = l.x + 'px'; el.style.top = l.y + 'px'; el.style.width = l.w + 'px'; el.style.height = l.h + 'px'; el.style.transform = l.rot ? 'rotate(' + l.rot + 'deg)' : ''; }
    syncNum(l); renderHandles();
  });
  document.addEventListener('mouseup', function () { if (hop) { hop = null; push(); } });
  function syncNum(l) { if (selId === l.id) { $('pX').value = l.x; $('pY').value = l.y; $('pW').value = l.w; $('pH').value = l.h; } }

  // Delete key removes the selected layer (when not typing in a field)
  document.addEventListener('keydown', function (e) {
    if ((e.key === 'Delete' || e.key === 'Backspace') && (selIds.length || selId)) {
      var t = document.activeElement && document.activeElement.tagName;
      if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT') return;
      e.preventDefault(); deleteSelected();
    }
  });

  /* ---- air / chroma / copy ---- */
  $('btnShow').onclick = function () { fetch('/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'lt_show' }) }); };
  $('btnHide').onclick = function () { fetch('/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'lt_hide' }) }); };
  $('chroma').onchange = function () { fetch('/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'lt_chroma', value: $('chroma').checked ? 'green' : '' }) }); };
  $('copyBtn').onclick = function () {
    var url = $('outUrl').textContent, b = $('copyBtn'), old = b.textContent, ok = function () { b.textContent = 'Copied!'; setTimeout(function () { b.textContent = old; }, 1200); };
    if (navigator.clipboard) navigator.clipboard.writeText(url).then(ok, ok);
  };

  /* ---- server state ---- */
  function connect() {
    var es = new EventSource('/events');
    es.onopen = function () { $('conn').className = 'conn ok'; $('connTxt').textContent = 'live'; };
    es.onmessage = function (e) {
      try {
        var m = JSON.parse(e.data); if (!m.state || !m.state.lowerthird) return; var lt = m.state.lowerthird;
        $('airState').textContent = lt.visible ? 'ON AIR' : 'OFF AIR'; $('airState').classList.toggle('live', !!lt.visible);
        $('chroma').checked = !!lt.chroma;
        if (!loaded) { loaded = true; layers = (lt.layers || []).map(function (l) { return l; }); if (layers.length) selId = layers[0].id; renderCanvas(); renderList(); syncProps(); }
        else if (JSON.stringify(lt.layers) !== JSON.stringify(layers) && !drag) {
          // reset (or another operator) changed layers — reload
          layers = (lt.layers || []); if (!byId(selId)) selId = layers.length ? layers[0].id : null; renderCanvas(); renderList(); syncProps();
        }
      } catch (x) {}
    };
    es.onerror = function () { $('conn').className = 'conn off'; $('connTxt').textContent = 'reconnecting…'; };
  }
  connect();
  $('outUrl').textContent = location.protocol + '//' + location.host + '/lowerthird-output';
})();
