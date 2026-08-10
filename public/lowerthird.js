/* StreamGraphics — Lower Third BUILDER control.
 * A WYSIWYG canvas of layers (text / box / image). Drag to move, edit properties,
 * animate each layer. The full layer array is pushed to the server on every change. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var SCALE = 0.375;                 // 1920x1080 stage shown inside a fluid 16:9 canvas — recomputed by fitStage()
  var layers = [], selId = null, selIds = [], loaded = false, seq = 0, editing = false;
  var showsMeta = [], editingShowId = '', templates = [];   // Show-Library metadata, editing link, Templates list
  var cstage = $('cstage');

  // The canvas resizes with the window (so the side panel never gets pushed off the edge).
  // Every mouse<->stage conversion reads SCALE at call time, so re-scaling here is enough.
  function fitStage() {
    var c = $('canvas'); if (!c) return;
    var w = c.clientWidth; if (!w) return;
    SCALE = w / 1920;
    cstage.style.transform = 'scale(' + SCALE + ')';
    if (typeof renderHandles === 'function' && loaded) renderHandles();
  }
  if (window.ResizeObserver) { try { new ResizeObserver(fitStage).observe($('canvas')); } catch (e) {} }
  window.addEventListener('resize', fitStage);
  fitStage();

  function uid() { return 'L' + Date.now().toString(36) + (seq++); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }
  function rgba(hex, pct) {
    hex = String(hex || '#000').replace(/^#/, ''); if (hex.length === 3) hex = hex.replace(/(.)/g, '$1$1');
    var r = parseInt(hex.slice(0, 2), 16) || 0, g = parseInt(hex.slice(2, 4), 16) || 0, b = parseInt(hex.slice(4, 6), 16) || 0;
    return 'rgba(' + r + ',' + g + ',' + b + ',' + (pct == null ? 1 : pct / 100) + ')';
  }
  function byId(id) { for (var i = 0; i < layers.length; i++) if (layers[i].id === id) return layers[i]; return null; }
  function selected() { return byId(selId); }
  // Slide text: "//" or a real newline = line break; a line starting with - or * = bullet.
  function slideHtml(txt) { return esc(txt).replace(/\s*\/\/\s*/g, '\n').replace(/\n/g, '<br>').replace(/(^|<br>)\s*[-*•]\s+/g, '$1• '); }
  function slideTextStyle(l) {
    var shadow = (l.bgOpacity > 0) ? '' : ';text-shadow:0 2px 8px rgba(0,0,0,.45)';
    var av = l.align === 'left' ? 'flex-start' : (l.align === 'right' ? 'flex-end' : 'center');
    return 'position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;align-items:' + av
      + ';text-align:' + (l.align || 'center') + ';padding:' + (l.pad == null ? 0 : l.pad) + 'px;box-sizing:border-box;overflow:visible'
      + ';font-family:' + (l.font || "'Segoe UI', Arial, sans-serif") + ';font-size:' + (l.size || 54) + 'px;color:' + esc(l.color || '#fff')
      + ';font-weight:' + (l.bold ? '800' : '600') + ';font-style:' + (l.italic ? 'italic' : 'normal') + ';line-height:1.22' + shadow;
  }
  function slideBgHtml(l) {
    if (!(l.bgOpacity > 0 && l.bg)) return '';
    return '<div style="position:absolute;inset:0;background:' + rgba(l.bg, l.bgOpacity) + ';border-radius:' + (l.radius || 0) + 'px"></div>';
  }

  // ---- timer/clock helpers (same math as the output + server) ----
  var clockOffset = 0;
  function serverNow() { return Date.now() + clockOffset; }
  function liveTimerMs(t, now) {
    if (t.mode === 'up')  return (t.baseMs || 0) + (t.running ? now - t.anchorServer : 0);
    if (t.mode === 'tod') return Math.max(0, (t.targetEpoch || 0) - now);
    var rem = (t.baseMs || 0) - (t.running ? now - t.anchorServer : 0);
    return t.overtime ? rem : Math.max(0, rem);
  }
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function fmtDur(ms, showHours) {
    var neg = ms < 0; if (neg) ms = -ms;
    var tot = Math.floor(ms / 1000), h = Math.floor(tot / 3600), m = Math.floor((tot % 3600) / 60), s = tot % 60;
    var str = (showHours || h > 0) ? pad2(h) + ':' + pad2(m) + ':' + pad2(s) : pad2(m) + ':' + pad2(s);
    return (neg ? '-' : '') + str;
  }
  function clockStr(d, use24h) {
    var h = d.getHours(), m = d.getMinutes(), s = d.getSeconds(), ap = '';
    if (!use24h) { ap = h < 12 ? ' AM' : ' PM'; h = h % 12; if (h === 0) h = 12; }
    return (use24h ? pad2(h) : h) + ':' + pad2(m) + ':' + pad2(s) + ap;
  }
  function fmtTimer(l, now) {
    now = now || serverNow();
    if (l.mode === 'clock') return clockStr(new Date(now), !!l.use24h);
    return fmtDur(liveTimerMs(l, now), !!l.showHours);
  }
  // Countdown warning (matches the on-air output): red + flash near/after zero.
  function timerWarn(l, now) {
    if (!l || l.type !== 'timer' || (l.mode !== 'down' && l.mode !== 'tod')) return null;
    var warnMs = (l.warnMs == null ? 10000 : l.warnMs);
    if (warnMs <= 0) return null;
    var rem = liveTimerMs(l, now);
    if (rem > warnMs) return null;
    var over = (l.mode === 'down') && rem <= 0;
    var flash = (l.flash !== false);
    var period = over ? 300 : 450;
    var on = flash ? (Math.floor(now / period) % 2 === 0) : true;
    return { color: (l.warnColor || '#ff3b30'), opacity: on ? 1 : 0.28 };
  }
  function timerCmd(cmd, patch) {
    if (!selId) return; var l = byId(selId); if (!l || l.type !== 'timer') return;
    fetch('/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'lt_timer', id: selId, cmd: cmd, patch: patch || null }) }).catch(function () {});
  }
  function parseSlides(v) { return String(v || '').split(/\n\s*\n/).map(function (s) { return s.replace(/^\s*\n|\n\s*$/g, '').trim(); }).filter(function (s) { return s.length; }); }
  function slidesCmd(cmd, n) {
    if (!selId) return; var l = byId(selId); if (!l || l.type !== 'slides') return;
    var cnt = (l.slides || []).length, i = (l.index == null ? -1 : l.index);   // optimistic local update for instant preview
    if (cmd === 'next') { i = (i < 0 ? 0 : i + 1); i = cnt ? Math.min(i, cnt - 1) : -1; }
    else if (cmd === 'prev') { if (i > 0) i = i - 1; }
    else if (cmd === 'first') { i = cnt ? 0 : -1; }
    else if (cmd === 'blank') { i = -1; }
    else if (cmd === 'goto') { i = Math.max(-1, Math.min(cnt - 1, n)); }
    var prev = l.index; l.index = i;
    // Animate the swap in place. A full renderCanvas() would rebuild the DOM and hard-cut,
    // which is why the "Between slides" setting never appeared to do anything in the builder.
    if (!animateSlideTo(l, prev)) renderCanvas();
    updateSlideIdxLabel();
    fetch('/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'lt_slides', id: selId, cmd: cmd, n: n }) }).catch(function () {});
  }

  // ---- between-slide transition, shown live in the builder preview ----
  // Kept in step with the same three offsets used by lowerthird-output.js / program-output.js.
  function transOut(tr) {
    return tr === 'slide-up' ? 'translateY(-26px)' : tr === 'slide-down' ? 'translateY(26px)'
      : tr === 'slide-left' ? 'translateX(-44px)' : tr === 'slide-right' ? 'translateX(44px)'
      : tr === 'zoom' ? 'scale(1.12)' : 'none';
  }
  function transIn(tr) {
    return tr === 'slide-up' ? 'translateY(26px)' : tr === 'slide-down' ? 'translateY(-26px)'
      : tr === 'slide-left' ? 'translateX(44px)' : tr === 'slide-right' ? 'translateX(-44px)'
      : tr === 'zoom' ? 'scale(.88)' : 'none';
  }
  function transDurOf(l) { var d = (l && l.transDur != null) ? +l.transDur : 220; return (isFinite(d) && d >= 0) ? d : 220; }

  // Cross-fades the .slide-text of a slides layer to its current index.
  // Returns false when it can't (no element yet) so the caller can fall back to a full render.
  function animateSlideTo(l, prevIdx) {
    var el = cstage.querySelector('.ly[data-id="' + l.id + '"] .slide-text');
    var wrap = cstage.querySelector('.ly[data-id="' + l.id + '"] .li');
    if (!el || !wrap) return false;
    var idx = (l.index == null ? -1 : l.index);
    if (idx === prevIdx) return true;
    var txt = (idx >= 0 && l.slides && l.slides[idx] != null) ? l.slides[idx] : '';
    var html = txt ? slideHtml(txt) : '';
    var tr = l.trans || 'fade', dur = transDurOf(l);
    // Going to/from a blank index changes the placeholder too — cheapest to just rebuild.
    if (idx < 0 || prevIdx < 0 || prevIdx == null) { renderCanvas(); return true; }
    if (tr === 'none' || dur === 0) { el.innerHTML = html; return true; }
    var out = Math.round(dur * 0.45), inn = Math.max(dur - out, 40);
    el.style.transition = 'transform ' + out + 'ms ease, opacity ' + out + 'ms ease';
    el.style.opacity = '0'; el.style.transform = transOut(tr);
    setTimeout(function () {
      el.innerHTML = html;
      el.style.transition = 'none'; el.style.opacity = '0'; el.style.transform = transIn(tr); void el.offsetWidth;
      el.style.transition = 'transform ' + inn + 'ms ease, opacity ' + inn + 'ms ease';
      el.style.opacity = '1'; el.style.transform = 'none';
    }, out);
    return true;
  }

  // Replays the current slide's transition on the spot, so tweaking style/speed is visible.
  function previewSlideTrans() {
    var l = selected(); if (!l || l.type !== 'slides') return;
    var el = cstage.querySelector('.ly[data-id="' + l.id + '"] .slide-text'); if (!el) return;
    var tr = l.trans || 'fade', dur = transDurOf(l);
    if (tr === 'none' || dur === 0) return;
    var out = Math.round(dur * 0.45), inn = Math.max(dur - out, 40);
    el.style.transition = 'transform ' + out + 'ms ease, opacity ' + out + 'ms ease';
    el.style.opacity = '0'; el.style.transform = transOut(tr);
    setTimeout(function () {
      el.style.transition = 'none'; el.style.opacity = '0'; el.style.transform = transIn(tr); void el.offsetWidth;
      el.style.transition = 'transform ' + inn + 'ms ease, opacity ' + inn + 'ms ease';
      el.style.opacity = '1'; el.style.transform = 'none';
    }, out);
  }
  function updateSlideIdxLabel() { var l = selected(); if (!l || l.type !== 'slides') return; var n = (l.slides || []).length, i = (l.index == null ? -1 : l.index); if ($('pSlIdx')) $('pSlIdx').textContent = (i < 0 ? 'blank' : (i + 1)) + ' / ' + n; }

  // ---- animation preview in the builder (mirrors the output's animateOn/Off) ----
  var A_BOUNCE = 'cubic-bezier(.34,1.62,.5,1)', A_EASE = 'cubic-bezier(.16,1,.3,1)';
  function animHidden(type) {
    switch (type) {
      case 'slide-up': return { o: 0, t: 'translateY(46px)' };
      case 'slide-down': return { o: 0, t: 'translateY(-46px)' };
      case 'slide-left': return { o: 0, t: 'translateX(-60px)' };
      case 'slide-right': return { o: 0, t: 'translateX(60px)' };
      case 'fly-left': return { o: 0, t: 'translateX(-1280px)' };
      case 'fly-right': return { o: 0, t: 'translateX(1280px)' };
      case 'bounce': return { o: 0, t: 'translateY(64px) scale(.9)', ease: A_BOUNCE };
      case 'pop': return { o: 0, t: 'scale(.3)', ease: A_BOUNCE };
      case 'rotate': return { o: 0, t: 'rotate(-180deg) scale(.4)' };
      case 'scale': return { o: 0, t: 'scale(.86)' };
      case 'none': return { o: 1, t: 'none' };
      default: return { o: 0, t: 'none' }; // fade
    }
  }
  // Grouped layer with own animation "none" inherits its group's animation (whole group moves as one).
  function groupLead(gid, dir) {
    for (var i = 0; i < layers.length; i++) { var m = layers[i]; if (m.group !== gid) continue; var a = dir === 'in' ? (m.inAnim || 'none') : (m.outAnim || 'none'); if (a && a !== 'none') return dir === 'in' ? { anim: a, dur: m.inDur == null ? 500 : m.inDur, del: m.inDelay || 0 } : { anim: a, dur: m.outDur == null ? 350 : m.outDur, del: m.outDelay || 0 }; }
    return null;
  }
  function effAnim(l, dir) {
    var own = dir === 'in' ? (l.inAnim || 'fade') : (l.outAnim || 'fade');
    if (l.group && own === 'none') { var g = groupLead(l.group, dir); if (g) return g; }
    return dir === 'in' ? { anim: own, dur: l.inDur == null ? 500 : l.inDur, del: l.inDelay || 0 } : { anim: own, dur: l.outDur == null ? 350 : l.outDur, del: l.outDelay || 0 };
  }
  function previewAnim() {
    var ids = selIds.length ? selIds : (selId ? [selId] : []);
    ids.forEach(function (id) {
      var el = cstage.querySelector('.ly[data-id="' + id + '"]'); if (!el) return;
      var li = el.querySelector('.li'); if (!li) return;
      var l = byId(id); if (!l) return;
      var eIn = effAnim(l, 'in'), eOut = effAnim(l, 'out');
      var hIn = animHidden(eIn.anim), inDur = eIn.dur, inDel = eIn.del;
      var hOut = animHidden(eOut.anim), outDur = eOut.dur;
      li.style.transition = 'none'; li.style.opacity = hIn.o; li.style.transform = hIn.t; void li.offsetWidth;   // snap to IN start
      li.style.transition = 'transform ' + inDur + 'ms ' + (hIn.ease || A_EASE) + ' ' + inDel + 'ms, opacity ' + inDur + 'ms ease ' + inDel + 'ms';
      li.style.opacity = 1; li.style.transform = 'none';
      setTimeout(function () {   // then play the OUT animation after it holds a beat
        li.style.transition = 'transform ' + outDur + 'ms ' + (hOut.ease || A_EASE) + ', opacity ' + outDur + 'ms ease';
        li.style.opacity = hOut.o; li.style.transform = hOut.t;
        setTimeout(function () { li.style.transition = 'none'; li.style.opacity = ''; li.style.transform = ''; }, outDur + 200);
      }, inDel + inDur + 900);
    });
  }

  function push() {
    fetch('/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'lt_layers', layers: layers }) }).catch(function () {});
  }

  /* ---- render the canvas ---- */
  function innerHtml(l) {
    if (l.type === 'box') return '<div class="li ly-box" style="width:100%;height:100%;background:' + rgba(l.fill, l.opacity) + ';border-radius:' + (l.radius || 0) + 'px"></div>';
    if (l.type === 'text') {
      var st = 'font-family:' + (l.font || 'Arial') + ';font-size:' + (l.size || 24) + 'px;color:' + esc(l.color || '#fff')
        + ';font-weight:' + (l.bold ? '800' : '400') + ';font-style:' + (l.italic ? 'italic' : 'normal') + ';text-align:' + (l.align || 'left')
        + ';align-items:' + (l.align === 'center' ? 'center' : (l.align === 'right' ? 'flex-end' : 'flex-start'))
        + (l.shadow === false ? '' : ';text-shadow:0 2px 8px rgba(0,0,0,.55)');
      return '<div class="li ly-text" style="' + st + '">' + esc(l.text || '') + '</div>';
    }
    if (l.type === 'image') {
      if (!l.src) return '<div class="li" style="width:100%;height:100%;border:2px dashed #6b7a90;border-radius:' + (l.shape === 'circle' ? '50%' : '10px') + ';display:flex;align-items:center;justify-content:center;color:#9fb0c8;font-size:26px">IMAGE</div>';
      return '<img class="li ly-img ' + (l.fit === 'cover' ? 'cover ' : '') + (l.shape || 'none') + '" src="' + esc(l.src) + '" style="width:100%;height:100%' + (l.shadow ? ';filter:drop-shadow(0 3px 10px rgba(0,0,0,.55))' : '') + '">';
    }
    if (l.type === 'video') {
      if (!l.src) return '<div class="li" style="width:100%;height:100%;border:2px dashed #6b7a90;border-radius:10px;display:flex;align-items:center;justify-content:center;color:#9fb0c8;font-size:26px">▶ VIDEO</div>';
      // Builder preview shows the video PAUSED on its first frame — it doesn't play in the
      // editor. Live playback only happens on the output. This keeps the canvas snappy.
      return '<video class="li libvid" src="' + esc(l.src) + '" muted preload="auto" playsinline style="width:100%;height:100%;object-fit:' + (l.fit === 'cover' ? 'cover' : 'contain') + '"></video>';
    }
    if (l.type === 'ticker') {
      var tk = 'font-family:' + (l.font || 'Arial') + ';font-size:' + (l.size || 28) + 'px;color:' + esc(l.color || '#fff') + ';font-weight:' + (l.bold ? '800' : '600');
      return '<div class="li" style="width:100%;height:100%;background:' + rgba(l.fill, l.opacity) + ';border-radius:' + (l.radius || 0) + 'px;overflow:hidden;display:flex;align-items:center;padding:0 12px"><span style="white-space:nowrap;' + tk + '">' + esc(l.text || 'scrolling text') + '</span></div>';
    }
    if (l.type === 'slides') {
      var sidx = (l.index == null ? -1 : l.index);
      var stxt = (sidx >= 0 && l.slides && l.slides[sidx] != null) ? l.slides[sidx] : '';
      var swrap = 'position:relative;width:100%;height:100%;overflow:visible';
      if (!stxt) return '<div class="li" style="' + swrap + '">' + slideBgHtml(l) + '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#6b7a90;font-size:26px">(blank — Next to show a slide)</div></div>';
      return '<div class="li ly-slide" style="' + swrap + '">' + slideBgHtml(l) + '<div class="slide-text" style="' + slideTextStyle(l) + '">' + slideHtml(stxt) + '</div></div>';
    }
    if (l.type === 'timer') {
      var tmst = 'font-family:' + (l.font || "'Segoe UI', Arial, sans-serif") + ';font-size:' + (l.size || 96) + 'px;color:' + esc(l.color || '#fff')
        + ';font-weight:' + (l.bold ? '800' : '600') + ';font-style:' + (l.italic ? 'italic' : 'normal') + ';text-align:' + (l.align || 'center')
        + ';align-items:' + (l.align === 'center' ? 'center' : (l.align === 'right' ? 'flex-end' : 'flex-start')) + ';font-variant-numeric:tabular-nums';
      return '<div class="li ly-timer" style="' + tmst + '">' + esc(fmtTimer(l)) + '</div>';
    }
    return '';
  }
  function renderCanvas() {
    var byZ = layers.slice().sort(function (a, b) { return (a.z || 0) - (b.z || 0); });
    cstage.innerHTML = byZ.map(function (l) {
      var t = l.rot ? ';transform:rotate(' + l.rot + 'deg);transform-origin:center' : '';
      var hid = l.hidden ? ';opacity:.28' : '';   // dimmed in the builder so you can still see it
      // Hidden OR locked layers let clicks pass through, so you can select whatever is underneath.
      var clickthru = (l.hidden || l.locked) ? ';pointer-events:none' : '';
      return '<div class="ly' + (selIds.indexOf(l.id) >= 0 ? ' sel' : '') + (l.locked ? ' locked' : '') + '" data-id="' + l.id + '" style="left:' + l.x + 'px;top:' + l.y + 'px;width:' + l.w + 'px;height:' + l.h + 'px;z-index:' + (l.z || 0) + t + hid + clickthru + '">' + innerHtml(l) + '</div>';
    }).join('');
    cstage.querySelectorAll('.ly').forEach(function (el) { el.addEventListener('mousedown', startDrag); el.addEventListener('dblclick', onDblClick); });
    // Paint the first frame of each builder-preview video, then keep it paused (no continuous decode).
    cstage.querySelectorAll('video.libvid').forEach(function (v) {
      var f = function () { try { v.pause(); if (v.currentTime < 0.05) v.currentTime = 0.05; } catch (e) {} };
      if (v.readyState >= 2) f(); else v.addEventListener('loadeddata', f, { once: true });
    });
    renderHandles();
  }
  function layerName(l) {
    if (l.name) return l.name;
    if (l.type === 'text' || l.type === 'ticker') return l.text || (l.type === 'ticker' ? 'Ticker' : 'Text');
    if (l.type === 'timer') return l.mode === 'clock' ? 'Clock' : (l.mode === 'up' ? 'Count-up' : l.mode === 'tod' ? 'Countdown to' : 'Countdown');
    if (l.type === 'slides') return (l.slides && l.slides.length) ? ('Slides (' + l.slides.length + ')') : 'Slides';
    return l.type === 'box' ? 'Box' : l.type === 'video' ? 'Video' : 'Image';
  }
  function renderList() {
    var byZ = layers.slice().sort(function (a, b) { return (b.z || 0) - (a.z || 0); }); // top layer first
    $('layerList').innerHTML = byZ.map(function (l) {
      var eye = l.hidden ? '🚫' : '👁';
      var lock = l.locked ? '🔒' : '🔓';
      return '<div class="llrow' + (selIds.indexOf(l.id) >= 0 ? ' sel' : '') + (l.hidden ? ' off' : '') + (l.locked ? ' locked' : '') + '" data-id="' + l.id + '">'
           + '<button class="eye" data-eye title="show / hide">' + eye + '</button>'
           + '<button class="eye" data-lock title="lock / unlock (locked = can\'t be selected or moved on the canvas)">' + lock + '</button>'
           + '<span class="t" data-name title="double-click to rename">' + esc(layerName(l)) + '</span>'
           + '<span class="mini2">' + l.type + (l.group ? ' ⧉' : '') + '</span>'
           + '<button data-mv="up" title="move up">▲</button><button data-mv="down" title="move down">▼</button></div>';
    }).join('') || '<div class="llrow"><span class="mini2">No layers — add one above.</span></div>';
    $('layerList').querySelectorAll('.llrow[data-id]').forEach(function (row) {
      var id = row.dataset.id;
      // Clicking a row (incl. its name) selects it; double-clicking the name renames.
      // select() no longer rebuilds the list, so the dblclick target survives the single clicks.
      row.onclick = function (e) { if (e.target.closest('[data-mv],[data-eye],[data-lock]')) return; select(id, e.shiftKey || e.ctrlKey || e.metaKey); };
      row.querySelector('[data-eye]').onclick = function (e) {
        e.stopPropagation(); var l = byId(id); if (!l) return;
        var nv = !l.hidden, ids = l.group ? groupMembers(l.group) : [id];   // a grouped layer hides the whole group
        ids.forEach(function (x) { var m = byId(x); if (m) m.hidden = nv; });
        renderCanvas(); renderList(); push();
      };
      row.querySelector('[data-lock]').onclick = function (e) {
        e.stopPropagation(); var l = byId(id); if (!l) return;
        var nv = !l.locked, ids = l.group ? groupMembers(l.group) : [id];   // lock the whole group together
        ids.forEach(function (x) { var m = byId(x); if (m) m.locked = nv; });
        if (nv) { selIds = selIds.filter(function (x) { return ids.indexOf(x) < 0; }); selId = selIds[selIds.length - 1] || null; syncProps(); }
        renderCanvas(); renderList(); push();
      };
      row.querySelector('[data-name]').ondblclick = function (e) { e.stopPropagation(); renameLayer(id, e.currentTarget); };
      row.querySelectorAll('[data-mv]').forEach(function (btn) {
        btn.onclick = function (e) { e.stopPropagation(); reorder(id, btn.dataset.mv === 'up' ? -1 : 1); };
      });
    });
  }
  function renameLayer(id, span) {
    var l = byId(id); if (!l) return;
    var inp = document.createElement('input');
    inp.className = 'inp'; inp.value = l.name || layerName(l);
    inp.style.cssText = 'height:24px;padding:2px 6px;font-size:13px;flex:1;min-width:0';
    span.replaceWith(inp); inp.focus(); inp.select();
    function done() { l.name = inp.value.trim(); if (!l.name) delete l.name; renderList(); renderCanvas(); push(); }
    inp.onblur = done;
    inp.onkeydown = function (e) { if (e.key === 'Enter') inp.blur(); else if (e.key === 'Escape') { inp.value = l.name || layerName(l); inp.blur(); } };
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
    // Update list highlights in place — do NOT rebuild the list here, or an in-progress
    // double-click (rename) loses its target element between the two clicks.
    document.querySelectorAll('#layerList .llrow[data-id]').forEach(function (r) { r.classList.toggle('sel', selIds.indexOf(r.dataset.id) >= 0); });
    syncProps(); renderHandles();
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
      show('.only-text', false); show('.only-box', false); show('.only-image', false); show('.only-video', false); show('.only-ticker', false); show('.only-timer', false); show('.only-slides', false); show('.fieldrow', false);
    } else {
      $('propTitle').textContent = l.type.charAt(0).toUpperCase() + l.type.slice(1) + ' layer' + (l.group ? ' (grouped)' : '');
      show('.only-text', l.type === 'text'); show('.only-box', l.type === 'box'); show('.only-image', l.type === 'image');
      show('.only-video', l.type === 'video'); show('.only-ticker', l.type === 'ticker'); show('.only-timer', l.type === 'timer'); show('.only-slides', l.type === 'slides');
      show('.fieldrow', l.type === 'text' || l.type === 'image');   // CSV field only for text/image
    }
    if (l.type === 'text') { $('pText').value = l.text || ''; $('pFont').value = l.font || "'Segoe UI', Arial, sans-serif"; $('pSize').value = l.size || 34; $('pBold').checked = !!l.bold; $('pItalic').checked = !!l.italic; $('pShadow').checked = (l.shadow !== false); $('pColor').value = l.color || '#ffffff'; $('pAlign').value = l.align || 'left'; }
    if (l.type === 'box') { $('pFill').value = l.fill || '#0b1f3a'; $('pOpacity').value = l.opacity == null ? 95 : l.opacity; $('pRadius').value = l.radius || 0; $('pRadiusV').textContent = l.radius || 0; }
    if (l.type === 'image') { $('pSrc').value = l.src || ''; $('pShape').value = l.shape || 'none'; $('pFit').value = l.fit || 'contain'; $('pImgShadow').checked = !!l.shadow; }
    if (l.type === 'text' || l.type === 'image') { $('pField').value = l.field || ''; }
    if (l.type === 'video') { $('pVSrc').value = l.src || ''; $('pAutoplay').checked = l.autoplay !== false; $('pLoop').checked = !!l.loop; $('pMuted').checked = l.muted !== false; $('pVFit').value = l.fit || 'contain'; $('pWhenDone').value = l.whenDone || 'hold'; }
    if (l.type === 'ticker') { $('pTkText').value = l.text || ''; $('pTkSpeed').value = l.speed == null ? 120 : l.speed; $('pTkSpeedV').textContent = l.speed == null ? 120 : l.speed; $('pTkDir').value = l.dir || 'left'; $('pTkColor').value = l.color || '#ffffff'; $('pTkSize').value = l.size || 28; $('pTkBold').checked = !!l.bold; $('pTkFill').value = l.fill || '#0b1f3a'; $('pTkOpacity').value = l.opacity == null ? 90 : l.opacity; $('pTkRadius').value = l.radius || 0; }
    if (l.type === 'timer') {
      var mode = l.mode || 'down';
      $('pTmMode').value = mode;
      var dm = Math.max(0, Math.floor((l.durationMs || 0) / 60000)), ds = Math.floor(((l.durationMs || 0) % 60000) / 1000);
      $('pTmMin').value = dm; $('pTmSec').value = pad2(ds);
      if (l.targetEpoch) { var td = new Date(l.targetEpoch); $('pTmTod').value = pad2(td.getHours()) + ':' + pad2(td.getMinutes()) + ':' + pad2(td.getSeconds()); }
      $('pTmHours').checked = !!l.showHours; $('pTmOver').checked = !!l.overtime; $('pTm24').checked = !!l.use24h;
      $('pTmColor').value = l.color || '#ffffff'; $('pTmSize').value = l.size || 110; $('pTmBold').checked = l.bold !== false; $('pTmAlign').value = l.align || 'center'; $('pTmFont').value = l.font || "'Segoe UI', 'Helvetica Neue', Arial, sans-serif";
      // show only the sub-rows relevant to the chosen mode
      $('pTmDurRow').style.display = (mode === 'down' || mode === 'up') ? '' : 'none';
      $('pTmTodRow').style.display = (mode === 'tod') ? '' : 'none';
      $('pTmRunRow').style.display = (mode === 'clock') ? 'none' : '';
      $('pTmOverLbl').style.display = (mode === 'down') ? '' : 'none';
      $('pTm24Lbl').style.display = (mode === 'clock') ? '' : 'none';
      $('pTmFlash').checked = (l.flash !== false);
      $('pTmWarnSec').value = (l.warnMs == null ? 10 : Math.round(l.warnMs / 1000));
      $('pTmWarnColor').value = l.warnColor || '#ff3b30';
      $('pTmWarnRow').style.display = (mode === 'down' || mode === 'tod') ? '' : 'none';
    }
    if (l.type === 'slides') {
      $('pSlText').value = (l.slides || []).join('\n\n');
      $('pSlColor').value = l.color || '#ffffff'; $('pSlSize').value = l.size || 54; $('pSlBold').checked = l.bold !== false; $('pSlAlign').value = l.align || 'center'; $('pSlFont').value = l.font || "'Segoe UI', 'Helvetica Neue', Arial, sans-serif";
      $('pSlBg').value = l.bg || '#0b1f3a'; $('pSlBgA').value = l.bgOpacity == null ? 0 : l.bgOpacity; $('pSlPad').value = l.pad == null ? 28 : l.pad; $('pSlRadius').value = l.radius || 0;
      $('pSlTrans').value = l.trans || 'fade'; $('pSlTransDur').value = transDurOf(l);
      updateSlideIdxLabel();
    }
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
  $('pShadow').onchange = function () { mutate(function (l) { l.shadow = $('pShadow').checked; }); };
  $('pColor').oninput = function () { mutate(function (l) { l.color = $('pColor').value; }); };
  $('pAlign').onchange = function () { mutate(function (l) { l.align = $('pAlign').value; }); };
  $('pFill').oninput = function () { mutate(function (l) { l.fill = $('pFill').value; }); };
  $('pOpacity').oninput = function () { mutate(function (l) { l.opacity = +$('pOpacity').value; }); };
  $('pRadius').oninput = function () { $('pRadiusV').textContent = $('pRadius').value; mutate(function (l) { l.radius = +$('pRadius').value; }); };
  $('pSrc').oninput = function () { mutate(function (l) { l.src = $('pSrc').value; }); };
  $('pField').oninput = function () { mutate(function (l) { var v = $('pField').value.trim(); if (v) l.field = v; else delete l.field; }); };
  $('pShape').onchange = function () { mutate(function (l) { l.shape = $('pShape').value; }); };
  $('pFit').onchange = function () { mutate(function (l) { l.fit = $('pFit').value; }); };
  $('pImgShadow').onchange = function () { mutate(function (l) { l.shadow = $('pImgShadow').checked; }); };
  // video props
  $('pVSrc').oninput = function () { mutate(function (l) { l.src = $('pVSrc').value; }); };
  $('pAutoplay').onchange = function () { mutate(function (l) { l.autoplay = $('pAutoplay').checked; }); };
  $('pLoop').onchange = function () { mutate(function (l) { l.loop = $('pLoop').checked; }); };
  $('pMuted').onchange = function () { mutate(function (l) { l.muted = $('pMuted').checked; }); };
  $('pVFit').onchange = function () { mutate(function (l) { l.fit = $('pVFit').value; }); };
  $('pWhenDone').onchange = function () { mutate(function (l) { l.whenDone = $('pWhenDone').value; }); };
  function vcmd(cmd) { if (selId) fetch('/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'lt_vcmd', id: selId, cmd: cmd }) }); }
  $('pVPlay').onclick = function () { vcmd('play'); };
  $('pVPause').onclick = function () { vcmd('pause'); };
  $('pVRestart').onclick = function () { vcmd('restart'); };
  $('pVFile').onchange = function () {
    var f = $('pVFile').files[0]; if (!f) return;
    if (f.size > 50 * 1024 * 1024) {   // guard: reading a huge file into memory crashes the tab
      alert('That video is ' + Math.round(f.size / 1048576) + ' MB. Browser upload is capped at ~50 MB, because it has to load the whole file into memory (that\'s what crashed the tab before).\n\nFor a clip this big, drop the file into the "media" folder next to the app and reference it in the Video field by URL - for example:  /media/' + f.name + '\n\nThat streams straight from the app with no size limit.');
      $('pVFile').value = ''; return;
    }
    var r = new FileReader();
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
  /* ---- timer layer: transport (server-stamped) + look ---- */
  $('pTmMode').onchange = function () { var m = $('pTmMode').value; timerCmd('set', { mode: m }); mutate(function (l) { l.mode = m; }); syncProps(); };
  $('pTmSetDur').onclick = function () { var ms = ((+$('pTmMin').value || 0) * 60 + (+$('pTmSec').value || 0)) * 1000; timerCmd('set', { durationMs: ms }); mutate(function (l) { l.durationMs = ms; if (!l.running) l.baseMs = ms; }); };
  $('pTmSetTod').onclick = function () {
    var parts = ($('pTmTod').value || '12:00:00').split(':'), d = new Date();
    d.setHours(+parts[0] || 0, +parts[1] || 0, +parts[2] || 0, 0);
    var ep = d.getTime(); if (ep <= serverNow()) ep += 86400000;   // already passed today -> tomorrow
    timerCmd('set', { targetEpoch: ep }); mutate(function (l) { l.targetEpoch = ep; });
  };
  $('pTmStart').onclick = function () { timerCmd('start'); };
  $('pTmPause').onclick = function () { timerCmd('pause'); };
  $('pTmReset').onclick = function () { timerCmd('reset'); };
  $('pTmHours').onchange = function () { timerCmd('set', { showHours: $('pTmHours').checked }); mutate(function (l) { l.showHours = $('pTmHours').checked; }); };
  $('pTmOver').onchange = function () { timerCmd('set', { overtime: $('pTmOver').checked }); mutate(function (l) { l.overtime = $('pTmOver').checked; }); };
  $('pTm24').onchange = function () { timerCmd('set', { use24h: $('pTm24').checked }); mutate(function (l) { l.use24h = $('pTm24').checked; }); };
  $('pTmFlash').onchange = function () { mutate(function (l) { l.flash = $('pTmFlash').checked; }); };
  $('pTmWarnSec').oninput = function () { mutate(function (l) { l.warnMs = Math.max(0, (+$('pTmWarnSec').value || 0)) * 1000; }); };
  $('pTmWarnColor').oninput = function () { mutate(function (l) { l.warnColor = $('pTmWarnColor').value; }); };
  $('pTmColor').oninput = function () { mutate(function (l) { l.color = $('pTmColor').value; }); };
  $('pTmSize').oninput = function () { mutate(function (l) { l.size = +$('pTmSize').value; }); };
  $('pTmBold').onchange = function () { mutate(function (l) { l.bold = $('pTmBold').checked; }); };
  $('pTmAlign').onchange = function () { mutate(function (l) { l.align = $('pTmAlign').value; }); };
  $('pTmFont').onchange = function () { mutate(function (l) { l.font = $('pTmFont').value; }); };
  /* ---- slides layer: content + transport (index synced to every machine) + look ---- */
  $('pSlText').oninput = function () { mutate(function (l) { l.slides = parseSlides($('pSlText').value); if (l.index != null && l.index > l.slides.length - 1) l.index = l.slides.length - 1; }); updateSlideIdxLabel(); };
  $('pSlFirst').onclick = function () { slidesCmd('first'); };
  $('pSlPrev').onclick = function () { slidesCmd('prev'); };
  $('pSlNext').onclick = function () { slidesCmd('next'); };
  $('pSlBlank').onclick = function () { slidesCmd('blank'); };
  $('pSlColor').oninput = function () { mutate(function (l) { l.color = $('pSlColor').value; }); };
  $('pSlSize').oninput = function () { mutate(function (l) { l.size = +$('pSlSize').value; }); };
  $('pSlBold').onchange = function () { mutate(function (l) { l.bold = $('pSlBold').checked; }); };
  $('pSlAlign').onchange = function () { mutate(function (l) { l.align = $('pSlAlign').value; }); };
  $('pSlFont').onchange = function () { mutate(function (l) { l.font = $('pSlFont').value; }); };
  $('pSlBg').oninput = function () { mutate(function (l) { l.bg = $('pSlBg').value; }); };
  $('pSlBgA').oninput = function () { mutate(function (l) { l.bgOpacity = +$('pSlBgA').value; }); };
  $('pSlPad').oninput = function () { mutate(function (l) { l.pad = +$('pSlPad').value; }); };
  $('pSlRadius').oninput = function () { mutate(function (l) { l.radius = +$('pSlRadius').value; }); };
  // Changing the style or the speed plays it back straight away, so the setting is visibly doing something.
  $('pSlTrans').onchange = function () { mutate(function (l) { l.trans = $('pSlTrans').value; }); previewSlideTrans(); };
  $('pSlTransDur').oninput = function () { mutate(function (l) { l.transDur = Math.max(0, Math.min(3000, +$('pSlTransDur').value || 0)); }); };
  $('pSlTransDur').onchange = function () { previewSlideTrans(); };
  $('pSlTransTest').onclick = function () { previewSlideTrans(); };
  ['pX', 'pY', 'pW', 'pH'].forEach(function (id) { $(id).oninput = function () { mutate(function (l) { l[id.slice(1).toLowerCase()] = Math.round(+$(id).value); }); }; });
  $('pInAnim').onchange = function () { mutateSel(function (l) { l.inAnim = $('pInAnim').value; }); };
  $('pInDelay').oninput = function () { mutateSel(function (l) { l.inDelay = +$('pInDelay').value; }); };
  $('pInDur').oninput = function () { mutateSel(function (l) { l.inDur = +$('pInDur').value; }); };
  $('pOutAnim').onchange = function () { mutateSel(function (l) { l.outAnim = $('pOutAnim').value; }); };
  $('pOutDelay').oninput = function () { mutateSel(function (l) { l.outDelay = +$('pOutDelay').value; }); };
  $('pOutDur').oninput = function () { mutateSel(function (l) { l.outDur = +$('pOutDur').value; }); };
  $('pPreview').onclick = previewAnim;
  $('pBack').onclick = function () { mutate(function (l) { l.z = Math.min.apply(null, layers.map(function (x) { return x.z || 0; })) - 1; }); };
  $('pFront').onclick = function () { mutate(function (l) { l.z = Math.max.apply(null, layers.map(function (x) { return x.z || 0; })) + 1; }); };
  function deleteSelected() { var ids = selIds.length ? selIds.slice() : (selId ? [selId] : []); layers = layers.filter(function (x) { return ids.indexOf(x.id) < 0; }); selId = null; selIds = []; renderCanvas(); renderList(); syncProps(); push(); }
  $('pDelete').onclick = deleteSelected;
  $('btnGroup').onclick = function () { if (selIds.length < 2) { alert('Shift-click two or more layers first, then Group.'); return; } var gid = uid(); selIds.forEach(function (id) { var l = byId(id); if (l) l.group = gid; }); renderList(); syncProps(); push(); };
  $('btnUngroup').onclick = function () { (selIds.length ? selIds : (selId ? [selId] : [])).forEach(function (id) { var l = byId(id); if (l) delete l.group; }); renderList(); syncProps(); push(); };

  function tooBigImage(f) { if (f.size > 25 * 1024 * 1024) { alert('That image is ' + Math.round(f.size / 1048576) + ' MB - too large to load in the browser. Use one under 25 MB, or drop it in the "media" folder and reference it by URL (/media/' + f.name + ').'); return true; } return false; }
  $('pFile').onchange = function () {
    var f = $('pFile').files[0]; if (!f) return; if (tooBigImage(f)) { $('pFile').value = ''; return; } var r = new FileReader();
    r.onload = function () {
      fetch('/upload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: f.name, data: r.result }) })
        .then(function (x) { return x.json(); }).then(function (res) { if (res && res.ok) mutate(function (l) { l.src = res.url; $('pSrc').value = res.url; }); else alert('Upload failed.'); });
    };
    r.readAsDataURL(f); $('pFile').value = '';
  };

  /* ---- add layers ---- */
  function topZ() { return layers.length ? Math.max.apply(null, layers.map(function (l) { return l.z || 0; })) + 1 : 1; }
  function add(l) {
    l.id = uid(); l.z = topZ();
    // Cascade a new layer so it doesn't land exactly on top of an existing one (which would
    // hide/block it). Nudge down-right until its top-left is clear of other layers.
    var guard = 0;
    while (guard++ < 12 && layers.some(function (o) { return Math.abs((o.x || 0) - l.x) < 18 && Math.abs((o.y || 0) - l.y) < 18; })) { l.x += 40; l.y += 40; }
    layers.push(l); selId = l.id; selIds = [l.id]; renderCanvas(); renderList(); syncProps(); push();
  }
  /* ---- Templates (starting designs) ---- */
  function tplAct(a) { fetch('/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(a) }).catch(function () {}); }
  function renderTemplates() {
    var box = $('tplList');
    box.innerHTML = templates.map(function (t) {
      return '<div style="display:flex;align-items:center;gap:8px;background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:9px 12px" data-id="' + t.id + '">'
        + '<div style="flex:1;font-weight:700;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(t.name) + (t.builtin ? ' <span class="mini2" style="color:var(--muted)">built-in</span>' : '') + '</div>'
        + '<button class="btn ghost tuse" style="font-size:12px">Use</button>'
        + '<button class="btn ghost texp" style="font-size:12px">Export</button>'
        + (t.builtin ? '' : '<button class="btn ghost tdel" style="font-size:12px;color:#e06">Delete</button>')
        + '</div>';
    }).join('') || '<div class="mini" style="color:var(--muted)">No templates yet.</div>';
    box.querySelectorAll('[data-id]').forEach(function (row) {
      var id = row.dataset.id, t = templates.filter(function (x) { return x.id === id; })[0] || {};
      row.querySelector('.tuse').onclick = function () { if (!confirm('Load "' + t.name + '" into the builder? Your current design will be replaced (Save to Library first if you want to keep it).')) return; tplAct({ type: 'tpl_load', id: id }); closeTpl(); };
      row.querySelector('.texp').onclick = function () { exportTemplate(id); };
      var d = row.querySelector('.tdel'); if (d) d.onclick = function () { if (confirm('Delete template "' + t.name + '"?')) tplAct({ type: 'tpl_delete', id: id }); };
    });
  }
  function openTpl() { renderTemplates(); $('tplModal').style.display = 'flex'; }
  function closeTpl() { $('tplModal').style.display = 'none'; }
  function exportTemplate(id) {
    fetch('/template-payload?id=' + encodeURIComponent(id)).then(function (r) { return r.json(); }).then(function (res) {
      if (!res.ok) return;
      var data = JSON.stringify({ streamgraphicsTemplate: 1, name: res.template.name, kind: res.template.kind, layers: res.template.layers }, null, 2);
      var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
      a.download = (res.template.name || 'template').replace(/[^a-z0-9._-]+/gi, '_') + '.sgtemplate.json'; a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    });
  }
  $('tplBtn').onclick = openTpl;
  $('tplClose').onclick = closeTpl;
  $('tplModal').onclick = function (e) { if (e.target === $('tplModal')) closeTpl(); };
  $('tplSaveCur').onclick = function () {
    var name = prompt('Save the current design as a template named:', 'My Template'); if (name == null) return;
    tplAct({ type: 'tpl_save', name: name.trim() || 'My Template', kind: 'lowerthird', layers: layers });
    var b = $('tplSaveCur'), o = b.textContent; b.textContent = 'Saved ✓'; setTimeout(function () { b.textContent = o; }, 1400);
  };
  $('tplImport').onchange = function () {
    var f = this.files[0]; this.value = ''; if (!f) return;
    var r = new FileReader();
    r.onload = function () { try { var j = JSON.parse(r.result); var lys = j.layers || (j.template && j.template.layers); if (!Array.isArray(lys)) throw 0; tplAct({ type: 'tpl_save', name: j.name || 'Imported Template', kind: j.kind || 'lowerthird', layers: lys }); } catch (e) { alert("That doesn't look like a valid template file."); } };
    r.readAsText(f);
  };
  function saveToLibrary() {
    // If we loaded a preset (or already saved one), offer to UPDATE it instead of making a copy.
    var linked = editingShowId ? showsMeta.filter(function (s) { return s.id === editingShowId; })[0] : null;
    var updateId = null, name;
    if (linked && confirm('Update the existing preset "' + linked.name + '"?\n\nOK = update it   ·   Cancel = save as a new copy')) {
      updateId = linked.id; name = linked.name;
    } else {
      var suggested = linked ? linked.name : '';
      if (!suggested) for (var i = 0; i < layers.length; i++) { if (layers[i].type === 'text' && layers[i].text) { suggested = layers[i].text; break; } }
      name = prompt('Save this design to the Show Library as:', suggested || 'Untitled graphic');
      if (name == null) return; name = name.trim() || 'Untitled graphic';
    }
    var act = { type: 'show_save', name: name, kind: 'lowerthird', payload: { layers: layers } };
    if (updateId) act.id = updateId;
    fetch('/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(act) })
      .then(function () {
        var b = $('saveToLib'), old = b.textContent; b.textContent = updateId ? 'Updated ✓' : 'Saved ✓'; setTimeout(function () { b.textContent = old; }, 1500);
        if (!updateId && confirm('Saved "' + name + '" to the Show Library.\n\nStart a new blank design so you can build the next one?')) {
          fetch('/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'lt_layers', layers: [], editingShowId: '' }) });
        }
      }).catch(function () { alert('Save failed — is the server running?'); });
  }
  var A = function (inA) { return { inAnim: inA, inDelay: 0, inDur: 500, outAnim: 'fade', outDelay: 0, outDur: 300 }; };
  function merge(a, b) { for (var k in b) a[k] = b[k]; return a; }
  $('addText').onclick = function () { add(merge({ type: 'text', x: 200, y: 500, w: 560, h: 60, text: 'New text', font: 'Arial, Helvetica, sans-serif', size: 40, bold: true, italic: false, color: '#ffffff', align: 'left' }, A('fade'))); };
  $('addBox').onclick = function () { add(merge({ type: 'box', x: 160, y: 900, w: 620, h: 100, fill: '#0b1f3a', opacity: 95, radius: 12 }, A('slide-up'))); };
  $('addImage').onclick = function () { add(merge({ type: 'image', x: 120, y: 860, w: 140, h: 140, src: '', shape: 'circle', fit: 'contain' }, A('scale'))); };
  $('addVideo').onclick = function () { add(merge({ type: 'video', x: 660, y: 340, w: 600, h: 338, src: '', autoplay: true, loop: false, muted: true, fit: 'contain', shape: 'none' }, A('fade'))); };
  $('addTicker').onclick = function () { add(merge({ type: 'ticker', x: 0, y: 1000, w: 1920, h: 60, text: 'BREAKING: your scrolling headline goes here', speed: 120, dir: 'left', font: 'Arial, Helvetica, sans-serif', size: 30, bold: true, color: '#ffffff', fill: '#0b1f3a', opacity: 92, radius: 0 }, A('slide-up'))); };
  $('addTimer').onclick = function () { add(merge({ type: 'timer', x: 710, y: 440, w: 500, h: 160, mode: 'down', durationMs: 300000, baseMs: 300000, running: false, anchorServer: 0, targetEpoch: 0, showHours: false, overtime: false, use24h: false, warnMs: 10000, warnColor: '#ff3b30', flash: true, font: "'Segoe UI', Arial, sans-serif", size: 110, bold: true, italic: false, color: '#ffffff', align: 'center' }, A('fade'))); };
  $('addSlides').onclick = function () { add(merge({ type: 'slides', x: 360, y: 300, w: 1200, h: 480, slides: ['Amazing grace, how sweet the sound', 'That saved a wretch like me', 'I once was lost, but now am found'], index: 0, font: "'Segoe UI', 'Helvetica Neue', Arial, sans-serif", size: 64, bold: true, italic: false, color: '#ffffff', align: 'center', bg: '#0b1f3a', bgOpacity: 0, pad: 28, radius: 14, trans: 'fade' }, A('fade'))); };
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
    var f = $('refFile').files[0]; if (!f) return; if (tooBigImage(f)) { $('refFile').value = ''; return; } var r = new FileReader();
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
    if (editing) return;                                                 // don't drag while inline-editing text
    var id = e.currentTarget.dataset.id;
    if (e.altKey) { cycleUnder(e); e.preventDefault(); return; }         // alt-click digs to the layer beneath
    if (e.shiftKey) { select(id, true); e.preventDefault(); return; }   // shift-click toggles selection, no drag
    if (selIds.indexOf(id) < 0) select(id, false);                       // selects the layer (or its whole group)
    var ids = selIds.slice(), orig = {};
    ids.forEach(function (lid) { var l = byId(lid); if (l) orig[lid] = { x: l.x, y: l.y }; });
    drag = { ids: ids, orig: orig, sx: e.clientX, sy: e.clientY };
    e.preventDefault();
  }
  // Alt-click cycles through layers stacked under the pointer (top -> next down -> ... -> wrap).
  function cycleUnder(e) {
    var r = canvasEl.getBoundingClientRect();
    var wx = (e.clientX - r.left) / SCALE, wy = (e.clientY - r.top) / SCALE;
    var hits = layers.filter(function (l) { return wx >= l.x && wx <= l.x + l.w && wy >= l.y && wy <= l.y + l.h; })
      .sort(function (a, b) { return (b.z || 0) - (a.z || 0); });   // topmost first
    if (!hits.length) return;
    var cur = selId || (selIds.length ? selIds[selIds.length - 1] : null);
    var i = -1; for (var k = 0; k < hits.length; k++) if (hits[k].id === cur) i = k;
    select(hits[(i + 1) % hits.length].id, false);
  }
  // Double-click a layer to select JUST that one (even inside a group, so you can edit a single
  // grouped layer without ungrouping); if it's text, jump straight into inline editing.
  function onDblClick(e) {
    e.preventDefault(); e.stopPropagation();
    var id = e.currentTarget.dataset.id, l = byId(id); if (!l) return;
    selIds = [id]; selId = id;
    cstage.querySelectorAll('.ly').forEach(function (el) { el.classList.toggle('sel', el.dataset.id === id); });
    document.querySelectorAll('#layerList .llrow[data-id]').forEach(function (r) { r.classList.toggle('sel', r.dataset.id === id); });
    syncProps(); renderHandles();
    if (l.type === 'text') startInlineEdit(id, e.currentTarget);
  }
  function startInlineEdit(id, lyEl) {
    var l = byId(id); if (!l) return;
    var txtEl = lyEl.querySelector('.ly-text'); if (!txtEl) return;
    editing = true; drag = null; hop = null;
    txtEl.setAttribute('contenteditable', 'true');
    txtEl.style.pointerEvents = 'auto'; txtEl.style.cursor = 'text'; txtEl.style.outline = '2px solid #7c5cff';
    txtEl.focus();
    var range = document.createRange(); range.selectNodeContents(txtEl);
    var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
    function finish() {
      txtEl.removeEventListener('keydown', onKey);
      txtEl.removeAttribute('contenteditable'); txtEl.style.outline = ''; txtEl.style.pointerEvents = ''; txtEl.style.cursor = '';
      editing = false;
      var newText = txtEl.innerText.replace(/\n$/, '');
      if (newText !== (l.text || '')) mutate(function (m) { m.text = newText; });   // save + push + re-render
    }
    function onKey(ev) {
      ev.stopPropagation();   // keep Delete/arrows from hitting the canvas shortcuts
      if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); txtEl.blur(); }
      else if (ev.key === 'Escape') { ev.preventDefault(); txtEl.textContent = l.text || ''; txtEl.blur(); }
    }
    txtEl.addEventListener('keydown', onKey);
    txtEl.addEventListener('blur', finish, { once: true });
  }
  document.addEventListener('mousemove', function (e) {
    if (!drag) return;
    var dx = (e.clientX - drag.sx) / SCALE, dy = (e.clientY - drag.sy) / SCALE;
    if (Math.abs(e.clientX - drag.sx) > 2 || Math.abs(e.clientY - drag.sy) > 2) drag.moved = true;
    drag.ids.forEach(function (lid) {
      var l = byId(lid); if (!l || !drag.orig[lid]) return;
      l.x = Math.round(drag.orig[lid].x + dx); l.y = Math.round(drag.orig[lid].y + dy);
      var el = cstage.querySelector('.ly[data-id="' + lid + '"]');
      if (el) { el.style.left = l.x + 'px'; el.style.top = l.y + 'px'; }
    });
    if (selId) { var pl = byId(selId); if (pl) { $('pX').value = pl.x; $('pY').value = pl.y; } }
    renderHandles();
  });
  document.addEventListener('mouseup', function () { if (drag) { var moved = drag.moved; drag = null; if (moved) push(); } });   // a plain click just selects — no state push, no network churn

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
    var l = selected(); if (!l || l.locked) return;   // locked layers get no drag/resize handles
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
    hop = { kind: 'resize', id: id, dir: dir, rad: rad, aWorld: aWorld, startW: l.w, startH: l.h, startSize: l.size, start: canvasPoint(e) };
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
      // text auto-fits the box: scale the font with the box on a CORNER drag (both dims change),
      // so it stays proportional. A pure vertical/horizontal edge drag just resizes the box
      // (no font change) — otherwise the font grew while the width stayed fixed and text overflowed.
      if (hop.startSize != null && hop.startH > 0 && hop.dir[0] !== 0 && hop.dir[1] !== 0) l.size = Math.max(6, Math.round(hop.startSize * nh / hop.startH));
    } else {
      var ang = Math.atan2(p.y - hop.cy, p.x - hop.cx);
      l.rot = Math.round((hop.startRot + (ang - hop.a0) * 180 / Math.PI) % 360);
    }
    var el = cstage.querySelector('.ly[data-id="' + l.id + '"]');
    if (el) { el.style.left = l.x + 'px'; el.style.top = l.y + 'px'; el.style.width = l.w + 'px'; el.style.height = l.h + 'px'; el.style.transform = l.rot ? 'rotate(' + l.rot + 'deg)' : ''; }
    if (el && hop.kind === 'resize' && hop.startSize != null) { var _inr = el.querySelector('.li'); if (_inr) _inr.style.fontSize = l.size + 'px'; }
    syncNum(l); renderHandles();
  });
  document.addEventListener('mouseup', function () { if (hop) { var wasResize = hop.kind === 'resize'; hop = null; push(); if (wasResize) syncProps(); } });
  function syncNum(l) { if (selId === l.id) { $('pX').value = l.x; $('pY').value = l.y; $('pW').value = l.w; $('pH').value = l.h; } }

  // Delete removes the selected layer; arrow keys nudge it (Shift = 10px). Not while typing.
  document.addEventListener('keydown', function (e) {
    if (editing) return;                                                 // typing into an inline-edited text layer
    var t = document.activeElement && document.activeElement.tagName;
    if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT') return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && (selIds.length || selId)) { e.preventDefault(); deleteSelected(); return; }
    var d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (d && (selIds.length || selId)) {
      e.preventDefault(); var step = e.shiftKey ? 10 : 1;
      mutateSel(function (l) { l.x = Math.round((l.x || 0) + d[0] * step); l.y = Math.round((l.y || 0) + d[1] * step); });
    }
  });
  // Align the selected layer(s): to the whole 1920x1080 frame when one is selected,
  // or relative to the selection's bounding box when several are selected.
  function align(edge) {
    var ids = selIds.length ? selIds : (selId ? [selId] : []); if (!ids.length) return;
    var b;
    if (ids.length > 1) {
      var xs = [], ys = [], xe = [], ye = [];
      ids.forEach(function (id) { var m = byId(id); if (!m) return; xs.push(m.x); ys.push(m.y); xe.push(m.x + m.w); ye.push(m.y + m.h); });
      b = { x: Math.min.apply(null, xs), y: Math.min.apply(null, ys), w: Math.max.apply(null, xe) - Math.min.apply(null, xs), h: Math.max.apply(null, ye) - Math.min.apply(null, ys) };
    } else { b = { x: 0, y: 0, w: 1920, h: 1080 }; }
    ids.forEach(function (id) {
      var l = byId(id); if (!l) return;
      if (edge === 'left') l.x = Math.round(b.x);
      else if (edge === 'hcenter') l.x = Math.round(b.x + (b.w - l.w) / 2);
      else if (edge === 'right') l.x = Math.round(b.x + b.w - l.w);
      else if (edge === 'top') l.y = Math.round(b.y);
      else if (edge === 'vmiddle') l.y = Math.round(b.y + (b.h - l.h) / 2);
      else if (edge === 'bottom') l.y = Math.round(b.y + b.h - l.h);
    });
    renderCanvas(); renderList(); push();
  }
  ['alL', 'alC', 'alR', 'alT', 'alM', 'alB'].forEach(function (id, i) {
    var edges = ['left', 'hcenter', 'right', 'top', 'vmiddle', 'bottom'];
    if ($(id)) $(id).onclick = function () { align(edges[i]); };
  });

  /* ---- air / chroma / copy ---- */
  $('btnOnAir').onclick = function () { fetch('/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'lt_show' }) }); };
  $('btnOffAir').onclick = function () { fetch('/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'lt_hide' }) }); };
  $('saveToLib').onclick = saveToLibrary;
  $('newDesign').onclick = function () { if (confirm('Start a new blank design? (Save to Library first if you want to keep the current one.)')) fetch('/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'lt_layers', layers: [], editingShowId: '' }) }); };
  function sendChroma() {
    var v = $('chromaSel').value;
    $('chromaColor').style.display = (v === 'custom') ? '' : 'none';
    if (v === 'custom') v = $('chromaColor').value;
    fetch('/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'lt_chroma', value: v }) });
  }
  $('chromaSel').onchange = sendChroma;
  $('chromaColor').oninput = sendChroma;
  $('copyBtn').onclick = function () {
    var url = $('outUrl').textContent, b = $('copyBtn'), old = b.textContent, ok = function () { b.textContent = 'Copied!'; setTimeout(function () { b.textContent = old; }, 1200); };
    if (navigator.clipboard) navigator.clipboard.writeText(url).then(ok, ok);
  };

  /* ---- server state ---- */
  function connect() {
    var es = SGLive('/events');
    es.onopen = function () { $('conn').className = 'conn ok'; $('connTxt').textContent = 'live'; };
    es.onmessage = function (e) {
      try {
        var m = JSON.parse(e.data);
        if (m.serverTime) { var meas = m.serverTime - Date.now(); clockOffset = clockOffset === 0 ? meas : Math.round(clockOffset * 0.7 + meas * 0.3); }
        if (m.state) { showsMeta = m.state.shows || []; templates = m.state.templates || []; if (m.state.lowerthird) editingShowId = m.state.lowerthird.editingShowId || ''; if ($('tplModal').style.display === 'flex') renderTemplates(); }
        if (!m.state || !m.state.lowerthird) return; var lt = m.state.lowerthird;
        var _live = !!lt.visible; $('btnOnAir').classList.toggle('live', _live); $('btnOffAir').classList.toggle('standby', !_live);
        if (document.activeElement !== $('chromaSel') && document.activeElement !== $('chromaColor')) {
          var cv = lt.chroma || '', preset = ['', '#00b140', '#0047ff', '#ff00ff', '#ffffff', '#000000', '#ff0000'];
          if (preset.indexOf(cv) >= 0) { $('chromaSel').value = cv; $('chromaColor').style.display = 'none'; }
          else { $('chromaSel').value = 'custom'; $('chromaColor').value = cv; $('chromaColor').style.display = ''; }
        }
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
  // Collapsible Layers panel — frees vertical room so the long properties + canvas stay in view.
  (function () {
    var t = $('layersToggle'), body = $('layersBody'), caret = $('layersCaret'); if (!t) return;
    var collapsed = false; try { collapsed = localStorage.getItem('lt_layers_collapsed') === '1'; } catch (e) {}
    function apply() { body.style.display = collapsed ? 'none' : ''; caret.textContent = collapsed ? '▸' : '▾'; }
    apply();
    t.onclick = function () { collapsed = !collapsed; try { localStorage.setItem('lt_layers_collapsed', collapsed ? '1' : '0'); } catch (e) {} apply(); };
  })();
  // Keep timer/clock previews ticking live in the builder canvas (same clock as the output).
  (function builderTick() {
    var els = cstage.querySelectorAll('.ly-timer');
    if (els.length) { var now = serverNow(); els.forEach(function (el) {
      var l = byId(el.parentNode.dataset.id); if (!l) return;
      el.textContent = fmtTimer(l, now);
      var w = timerWarn(l, now);
      if (w) { el.style.color = w.color; el.style.opacity = w.opacity; }
      else { el.style.color = (l.color || '#fff'); el.style.opacity = 1; }
    }); }
    requestAnimationFrame(builderTick);
  })();
  $('outUrl').textContent = location.protocol + '//' + location.host + '/lowerthird-output';
})();
