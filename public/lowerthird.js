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
  // A blank number box reads as NaN, which would otherwise be written into the layer and render
  // as nothing at all. Fall back to the low end rather than storing a value that breaks the CSS.
  function clamp(v, lo, hi) { v = +v; if (!isFinite(v)) v = lo; return Math.max(lo, Math.min(hi, v)); }
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

  /* ---- bullets layer: one line per point, stepped like slides but with four looks ---- */
  function parseBullets(v) { return String(v || '').split(/\r?\n/).map(function (s) { return s.trim(); }).filter(function (s) { return s.length; }); }
  function updateBulletIdxLabel() {
    var l = selected(); if (!l || l.type !== 'bullets') return;
    var n = (l.items || []).length, i = (l.index == null ? -1 : l.index);
    if ($('pBuIdx')) $('pBuIdx').textContent = (i < 0 ? 'blank' : (i + 1)) + ' / ' + n;
  }
  function bulletsCmd(cmd, n) {
    if (!selId) return; var l = byId(selId); if (!l || l.type !== 'bullets') return;
    // Move locally first so the canvas reacts on the click, then tell the server (which is what
    // every other machine, and the output, is actually watching).
    l.index = SGBullets.step(cmd, l.index, (l.items || []).length, n);
    if (!SGBullets.refresh(cstage, l)) renderCanvas();
    updateBulletIdxLabel();
    fetch('/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'lt_bullets', id: selId, cmd: cmd, n: n }) }).catch(function () {});
  }
  // Replays the whole build in the preview so the arrival style and speed are visibly doing something.
  function previewBulletBuild() {
    var l = selected(); if (!l || l.type !== 'bullets') return;
    var n = (l.items || []).length; if (!n) return;
    var was = (l.index == null ? -1 : l.index);
    var step = Math.max(120, Math.min(600, (l.revealDur == null ? 380 : +l.revealDur) + 90));
    l.index = -1; if (!SGBullets.refresh(cstage, l)) renderCanvas();
    var i = 0;
    (function go() {
      if (i >= n) { l.index = was; SGBullets.refresh(cstage, l); updateBulletIdxLabel(); return; }
      l.index = i++; SGBullets.refresh(cstage, l); updateBulletIdxLabel();
      setTimeout(go, step);
    })();
  }

  // ---- animation preview in the builder (mirrors the output's animateOn/Off) ----
  var A_BOUNCE = 'cubic-bezier(.34,1.62,.5,1)', A_EASE = 'cubic-bezier(.16,1,.3,1)';
  function animHidden(type, dir) {
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
      // "None" is an instant appear coming on and an instant cut going off — the preview has to
      // show that, or Animate Off = None looks like it works here and sticks on air.
      case 'none': return dir === 'out' ? { o: 0, t: 'none', cut: true } : { o: 1, t: 'none' };
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
      var hIn = animHidden(eIn.anim, 'in'), inDur = eIn.dur, inDel = eIn.del;
      var hOut = animHidden(eOut.anim, 'out'), outDur = hOut.cut ? 0 : eOut.dur;
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
    if (l.type === 'box') return SGBox.html(l);
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
      return '<div class="li" style="width:100%;height:100%;' + SGBox.style(l) + 'overflow:hidden;display:flex;align-items:center;padding:0 12px"><span style="white-space:nowrap;' + tk + '">' + esc(l.text || 'scrolling text') + '</span></div>';
    }
    if (l.type === 'slides') {
      var sidx = (l.index == null ? -1 : l.index);
      var stxt = (sidx >= 0 && l.slides && l.slides[sidx] != null) ? l.slides[sidx] : '';
      var swrap = 'position:relative;width:100%;height:100%;overflow:visible';
      if (!stxt) return '<div class="li" style="' + swrap + '">' + slideBgHtml(l) + '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#6b7a90;font-size:26px">(blank — Next to show a slide)</div></div>';
      return '<div class="li ly-slide" style="' + swrap + '">' + slideBgHtml(l) + '<div class="slide-text" style="' + slideTextStyle(l) + '">' + slideHtml(stxt) + '</div></div>';
    }
    if (l.type === 'bullets') return SGBullets.html(l);
    if (l.type === 'qr') return SGQR.layerHtml(l, true);
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
    if (l.type === 'bullets') return (l.items && l.items.length) ? ('Bullets (' + l.items.length + ')') : 'Bullets';
    if (l.type === 'qr') return l.text ? ('QR — ' + String(l.text).replace(/^https?:\/\//, '').slice(0, 28)) : 'QR code';
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
      show('.only-text', false); show('.only-box', false); show('.only-image', false); show('.only-video', false); show('.only-ticker', false); show('.only-timer', false); show('.only-slides', false); show('.only-bullets', false); show('.only-qr', false); show('.only-surface', false); show('.fieldrow', false);
    } else {
      $('propTitle').textContent = l.type.charAt(0).toUpperCase() + l.type.slice(1) + ' layer' + (l.group ? ' (grouped)' : '');
      show('.only-text', l.type === 'text'); show('.only-box', l.type === 'box'); show('.only-image', l.type === 'image');
      show('.only-video', l.type === 'video'); show('.only-ticker', l.type === 'ticker'); show('.only-timer', l.type === 'timer'); show('.only-slides', l.type === 'slides');
      show('.only-bullets', l.type === 'bullets');
      show('.only-qr', l.type === 'qr');
      // A ticker is a filled rectangle with words scrolling in it, so it gets the same gradient,
      // soft-edge and shadow controls a box does - one implementation, one set of controls.
      show('.only-surface', l.type === 'box' || l.type === 'ticker');
      show('.fieldrow', l.type === 'text' || l.type === 'image' || l.type === 'bullets' || l.type === 'qr');   // CSV field: text, image, a whole bullet list, or a per-row QR
    }
    if (l.type === 'text') { $('pText').value = l.text || ''; $('pFont').value = l.font || "'Segoe UI', Arial, sans-serif"; $('pSize').value = l.size || 34; $('pBold').checked = !!l.bold; $('pItalic').checked = !!l.italic; $('pShadow').checked = (l.shadow !== false); $('pColor').value = l.color || '#ffffff'; $('pAlign').value = l.align || 'left'; }
    if (l.type === 'box') { $('pFill').value = l.fill || '#0b1f3a'; $('pOpacity').value = l.opacity == null ? 95 : l.opacity; $('pRadius').value = l.radius || 0; $('pRadiusV').textContent = l.radius || 0; }
    if (l.type === 'image') { $('pSrc').value = l.src || ''; $('pShape').value = l.shape || 'none'; $('pFit').value = l.fit || 'contain'; $('pImgShadow').checked = !!l.shadow; }
    if (l.type === 'text' || l.type === 'image' || l.type === 'bullets' || l.type === 'qr') { $('pField').value = l.field || ''; }
    if (l.type === 'box' || l.type === 'ticker') {
      $('pFillMode').value = l.fillMode || 'solid';
      $('pFill2').value = l.fill2 || '#12b886';
      $('pOpacity2').value = l.opacity2 == null ? 0 : l.opacity2;
      $('pGradAngle').value = l.gradAngle == null ? 90 : l.gradAngle; $('pGradAngleV').textContent = (l.gradAngle == null ? 90 : l.gradAngle) + '\u00b0';
      $('pFeather').value = l.feather || 0; $('pFeatherV').textContent = l.feather || 0;
      $('pFeatherEdges').value = l.featherEdges || 'all';
      $('pBoxShadow').checked = !!l.shadow;
      $('pShadowBlur').value = l.shadowBlur == null ? 18 : l.shadowBlur;
      $('pShadowY').value = l.shadowY == null ? 6 : l.shadowY;
      $('pShadowOpacity').value = l.shadowOpacity == null ? 55 : l.shadowOpacity;
      surfaceRows();
    }
    if (l.type === 'qr') {
      $('pQrText').value = l.text || '';
      $('pQrDark').value = l.dark || '#000000'; $('pQrLight').value = l.light || '#ffffff';
      $('pQrTransparent').checked = !!l.transparent;
      $('pQrLevel').value = l.level || 'M';
      $('pQrShadow').checked = !!l.shadow;
      qrInfo(l);
    }
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
    if (l.type === 'bullets') {
      $('pBuText').value = (l.items || []).join('\n');
      $('pBuMode').value = l.mode || 'build';
      $('pBuDim').value = l.dimOpacity == null ? 45 : l.dimOpacity;
      $('pBuHl').value = l.hlColor || '#ffd166'; $('pBuHlScale').value = l.hlScale == null ? 1 : l.hlScale;
      $('pBuGrow').value = l.grow || 'down'; $('pBuGap').value = l.gap == null ? 14 : l.gap;
      $('pBuMarker').value = l.marker || 'bullet'; $('pBuMarkerColor').value = l.markerColor || l.color || '#ffffff';
      // Show the duration that will actually play, not the stored 0 an old template may carry.
      $('pBuReveal').value = l.reveal || 'fade'; $('pBuRevealDur').value = SGBullets.revealMs(l);
      $('pBuColor').value = l.color || '#ffffff'; $('pBuSize').value = l.size || 44;
      $('pBuBold').checked = l.bold !== false; $('pBuAlign').value = l.align || 'left';
      $('pBuFont').value = l.font || "'Segoe UI', 'Helvetica Neue', Arial, sans-serif";
      $('pBuBg').value = l.bg || '#0b1f3a'; $('pBuBgA').value = l.bgOpacity == null ? 0 : l.bgOpacity;
      $('pBuPad').value = l.pad == null ? 24 : l.pad; $('pBuRadius').value = l.radius || 0;
      $('pBuReset').checked = (l.resetOnAir !== false);
      // Dimming and the highlight colour only mean something in the modes that use them.
      var md = l.mode || 'build';
      $('pBuDimRow').style.display = (md === 'fade' || md === 'highlight') ? '' : 'none';
      var hl = (md === 'highlight');
      $('pBuHl').style.display = hl ? '' : 'none'; $('pBuHlScale').style.display = hl ? '' : 'none'; $('pBuHlWrap').style.display = hl ? '' : 'none';
      updateBulletIdxLabel();
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

  /* ---- surface controls: gradient, soft edges, drop shadow (boxes and tickers) ---- */
  // Only show the sub-controls that are doing anything, so the panel doesn't grow a row of
  // gradient settings for a solid colour.
  function surfaceRows() {
    var grad = $('pFillMode').value !== 'solid';
    $('pGradWrap').style.display = grad ? 'inline-flex' : 'none';
    $('pGradAngleRow').style.display = ($('pFillMode').value === 'linear') ? '' : 'none';
    $('pGradHint').style.display = grad ? '' : 'none';
    $('pShadowWrap').style.display = $('pBoxShadow').checked ? 'inline-flex' : 'none';
  }
  $('pFillMode').onchange = function () { mutate(function (l) { l.fillMode = $('pFillMode').value; }); surfaceRows(); };
  $('pFill2').oninput = function () { mutate(function (l) { l.fill2 = $('pFill2').value; }); };
  $('pOpacity2').oninput = function () { mutate(function (l) { l.opacity2 = clamp(+$('pOpacity2').value, 0, 100); }); };
  $('pGradAngle').oninput = function () { var v = +$('pGradAngle').value; $('pGradAngleV').textContent = v + '\u00b0'; mutate(function (l) { l.gradAngle = v; }); };
  $('pFeather').oninput = function () { var v = +$('pFeather').value; $('pFeatherV').textContent = v; mutate(function (l) { l.feather = v; }); };
  $('pFeatherEdges').onchange = function () { mutate(function (l) { l.featherEdges = $('pFeatherEdges').value; }); };
  $('pBoxShadow').onchange = function () { mutate(function (l) { l.shadow = $('pBoxShadow').checked; }); surfaceRows(); };
  $('pShadowBlur').oninput = function () { mutate(function (l) { l.shadowBlur = clamp(+$('pShadowBlur').value, 0, 200); }); };
  $('pShadowY').oninput = function () { mutate(function (l) { l.shadowY = clamp(+$('pShadowY').value, -100, 100); }); };
  $('pShadowOpacity').oninput = function () { mutate(function (l) { l.shadowOpacity = clamp(+$('pShadowOpacity').value, 0, 100); }); };

  /* ---- QR ----
   * The readout is the useful part: it tells you how dense the code came out and, when the code
   * is a tight one, that shortening the link would make the squares bigger. A QR nobody's phone
   * can lock onto from the sofa is just a grey square on the screen. */
  function qrInfo(l) {
    var box = $('pQrInfo'); if (!box) return;
    var txt = String((l && l.text) || '').trim();
    if (!txt) { box.textContent = 'Point it at a page you control, so you can change where it goes later without re-recording.'; box.style.color = 'var(--muted2)'; return; }
    var r = window.SGQR && SGQR.build(txt, (l && l.level) || 'M');
    if (!r) { box.textContent = 'That is too much text for a single QR code. Shorten it, or point it at a link instead.'; box.style.color = '#e08a72'; return; }
    var modes = { numeric: 'numbers', alnum: 'upper-case', byte: 'plain text' };
    var px = Math.round(Math.min(l.w || 300, l.h || 300) / (r.size + 8) * 10) / 10;
    box.textContent = r.size + '\u00d7' + r.size + ' squares (' + modes[r.mode] + ', version ' + r.version + ') \u00b7 about ' + px + 'px per square on screen'
      + (px < 4 ? ' \u2014 make the layer bigger or shorten the link, this will be hard to scan' : '');
    box.style.color = px < 4 ? '#e08a72' : 'var(--muted2)';
  }
  $('pQrText').oninput = function () { mutate(function (l) { l.text = $('pQrText').value; }); qrInfo(byId(selId)); };
  $('pQrDark').oninput = function () { mutate(function (l) { l.dark = $('pQrDark').value; }); };
  $('pQrLight').oninput = function () { mutate(function (l) { l.light = $('pQrLight').value; }); };
  $('pQrTransparent').onchange = function () { mutate(function (l) { l.transparent = $('pQrTransparent').checked; }); };
  $('pQrLevel').onchange = function () { mutate(function (l) { l.level = $('pQrLevel').value; }); qrInfo(byId(selId)); };
  $('pQrShadow').onchange = function () { mutate(function (l) { l.shadow = $('pQrShadow').checked; }); };
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
  /* ---- bullets layer: content + transport + the four reveal styles ---- */
  $('pBuText').oninput = function () {
    mutate(function (l) {
      l.items = parseBullets($('pBuText').value);
      if (l.index != null && l.index > l.items.length - 1) l.index = l.items.length - 1;
    });
    updateBulletIdxLabel();
  };
  $('pBuFirst').onclick = function () { bulletsCmd('first'); };
  $('pBuPrev').onclick = function () { bulletsCmd('prev'); };
  $('pBuNext').onclick = function () { bulletsCmd('next'); };
  $('pBuAll').onclick = function () { bulletsCmd('all'); };
  $('pBuBlank').onclick = function () { bulletsCmd('blank'); };
  // Changing the mode re-renders rather than refreshes: which lines are on screen changes wholesale.
  $('pBuMode').onchange = function () { mutate(function (l) { l.mode = $('pBuMode').value; }); syncProps(); };
  $('pBuDim').oninput = function () { mutate(function (l) { l.dimOpacity = Math.max(0, Math.min(100, +$('pBuDim').value || 0)); }); };
  $('pBuHl').oninput = function () { mutate(function (l) { l.hlColor = $('pBuHl').value; }); };
  $('pBuHlScale').oninput = function () { mutate(function (l) { l.hlScale = Math.max(1, Math.min(1.6, +$('pBuHlScale').value || 1)); }); };
  $('pBuGrow').onchange = function () { mutate(function (l) { l.grow = $('pBuGrow').value; }); };
  $('pBuGap').oninput = function () { mutate(function (l) { l.gap = Math.max(0, +$('pBuGap').value || 0); }); };
  $('pBuMarker').onchange = function () { mutate(function (l) { l.marker = $('pBuMarker').value; }); };
  $('pBuMarkerColor').oninput = function () { mutate(function (l) { l.markerColor = $('pBuMarkerColor').value; }); };
  $('pBuReveal').onchange = function () { mutate(function (l) { l.reveal = $('pBuReveal').value; }); previewBulletBuild(); };
  // Clearing the box used to leave the layer at 0ms, which silently turned the reveal into a hard
  // cut with the style dropdown still saying "Slide up". If you want a cut there's an option for it.
  $('pBuRevealDur').oninput = function () {
    var v = parseInt($('pBuRevealDur').value, 10);
    if (!isFinite(v)) v = 380;
    mutate(function (l) { l.revealDur = Math.max(0, Math.min(3000, v)); });
  };
  $('pBuRevealDur').onchange = function () { previewBulletBuild(); };
  $('pBuRevealTest').onclick = function () { previewBulletBuild(); };
  $('pBuColor').oninput = function () { mutate(function (l) { l.color = $('pBuColor').value; }); };
  $('pBuSize').oninput = function () { mutate(function (l) { l.size = +$('pBuSize').value; }); };
  $('pBuBold').onchange = function () { mutate(function (l) { l.bold = $('pBuBold').checked; }); };
  $('pBuAlign').onchange = function () { mutate(function (l) { l.align = $('pBuAlign').value; }); };
  $('pBuFont').onchange = function () { mutate(function (l) { l.font = $('pBuFont').value; }); };
  $('pBuBg').oninput = function () { mutate(function (l) { l.bg = $('pBuBg').value; }); };
  $('pBuBgA').oninput = function () { mutate(function (l) { l.bgOpacity = +$('pBuBgA').value; }); };
  $('pBuPad').oninput = function () { mutate(function (l) { l.pad = +$('pBuPad').value; }); };
  $('pBuRadius').oninput = function () { mutate(function (l) { l.radius = +$('pBuRadius').value; }); };
  $('pBuReset').onchange = function () { mutate(function (l) { l.resetOnAir = $('pBuReset').checked; }); };
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
  var tplFull = [];        // templates WITH layers (fetched on open — the SSE stream carries metadata only)
  var tplPacks = [];       // installed packs
  var tplFilter = 'all';   // 'all' | 'builtin' | 'mine' | a pack id
  var tplQuery = '';
  var tplPicked = {};      // id -> true, while building a pack

  function tplFetch(cb) {
    fetch('/templates').then(function (r) { return r.json(); }).then(function (res) {
      if (!res || !res.ok) return;
      tplFull = res.templates || []; tplPacks = res.packs || [];
      if (tplFilter !== 'all' && tplFilter !== 'builtin' && tplFilter !== 'mine'
          && !tplPacks.some(function (p) { return p.id === tplFilter; })) tplFilter = 'all';
      if (cb) cb();
    }).catch(function () {});
  }

  // Draw a design into a card at whatever size the card happens to be. Uses the builder's own
  // innerHtml(), so a preview can never drift from what actually lands on the canvas.
  function paintPreview(el, tpl) {
    var stage = document.createElement('div');
    stage.className = 'tstage';
    stage.innerHTML = (tpl.layers || []).slice().sort(function (a, b) { return (a.z || 0) - (b.z || 0); })
      .filter(function (l) { return !l.hidden; })
      .map(function (l) {
        var rot = l.rot ? ';transform:rotate(' + l.rot + 'deg);transform-origin:center' : '';
        return '<div class="ly" style="left:' + (l.x || 0) + 'px;top:' + (l.y || 0) + 'px;width:' + (l.w || 0) + 'px;height:' + (l.h || 0) + 'px;z-index:' + (l.z || 0) + rot + '">' + innerHtml(l) + '</div>';
      }).join('');
    el.innerHTML = ''; el.appendChild(stage);
    // Real pixel height, not CSS aspect-ratio. A ratio-derived height doesn't count towards a
    // grid row's intrinsic size, so the row came out ~100px tall while the preview painted 196
    // and the card's name and buttons were clipped off the bottom.
    var fit = function () {
      var w = el.clientWidth; if (!w) return;
      el.style.height = Math.round(w * 9 / 16) + 'px';
      stage.style.transform = 'scale(' + (w / 1920) + ')';
    };
    fit();
    if (window.ResizeObserver) { try { new ResizeObserver(fit).observe(el.parentNode); } catch (e) {} }
    // Previews are still pictures: stop any video from decoding in the background.
    stage.querySelectorAll('video').forEach(function (v) { try { v.autoplay = false; v.pause(); } catch (e) {} });
  }

  function tplVisible() {
    var q = tplQuery.trim().toLowerCase();
    return tplFull.filter(function (t) {
      if (tplFilter === 'builtin' && !t.builtin) return false;
      if (tplFilter === 'mine' && (t.builtin || t.pack)) return false;
      if (tplFilter !== 'all' && tplFilter !== 'builtin' && tplFilter !== 'mine' && t.pack !== tplFilter) return false;
      if (q && String(t.name || '').toLowerCase().indexOf(q) < 0 && String(t.desc || '').toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  }

  function renderFilters() {
    var mine = tplFull.filter(function (t) { return !t.builtin && !t.pack; }).length;
    var chips = [['all', 'All (' + tplFull.length + ')'], ['builtin', 'Built-in']];
    if (mine) chips.push(['mine', 'My designs (' + mine + ')']);
    tplPacks.forEach(function (p) {
      chips.push([p.id, p.name + ' (' + tplFull.filter(function (t) { return t.pack === p.id; }).length + ')']);
    });
    $('tplFilters').innerHTML = chips.map(function (c) {
      return '<button class="tchip' + (tplFilter === c[0] ? ' on' : '') + '" data-f="' + esc(c[0]) + '">' + esc(c[1]) + '</button>';
    }).join('');
    $('tplFilters').querySelectorAll('[data-f]').forEach(function (b) {
      b.onclick = function () { tplFilter = b.dataset.f; renderTemplates(); };
    });
    // Pack details bar, with the uninstall that takes its designs with it.
    var pk = tplPacks.filter(function (p) { return p.id === tplFilter; })[0];
    $('tplPackBar').style.display = pk ? 'flex' : 'none';
    if (pk) {
      $('tplPackTitle').textContent = pk.name;
      $('tplPackMeta').textContent = [pk.author ? 'by ' + pk.author : '', pk.version ? 'v' + pk.version : '', pk.description || '']
        .filter(Boolean).join(' · ');
      $('tplPackRemove').onclick = function () {
        var n = tplFull.filter(function (t) { return t.pack === pk.id; }).length;
        if (!confirm('Uninstall "' + pk.name + '"?\n\nThis removes the pack and its ' + n + ' design' + (n === 1 ? '' : 's') + '. Anything you already saved to your Library stays put.')) return;
        tplAct({ type: 'pack_uninstall', id: pk.id });
        tplFilter = 'all';
        setTimeout(function () { tplFetch(renderTemplates); }, 250);
      };
    }
  }

  function renderTemplates() {
    renderFilters();
    var box = $('tplGrid'), list = tplVisible();
    if (!list.length) {
      box.innerHTML = '<div class="mini" style="color:var(--muted);padding:26px;text-align:center">' + (tplQuery ? 'Nothing matches that search.' : 'Nothing here yet.') + '</div>';
      return;
    }
    box.className = 'tplgrid';
    box.innerHTML = list.map(function (t) {
      var pk = tplPacks.filter(function (p) { return p.id === t.pack; })[0];
      var badge = t.builtin ? 'built-in' : (pk ? pk.name : 'mine');
      return '<div class="tcard' + (tplPicked[t.id] ? ' picked' : '') + '" data-id="' + t.id + '">'
        + '<input type="checkbox" class="tpick" data-pick="' + t.id + '"' + (tplPicked[t.id] ? ' checked' : '') + ' title="tick to include in a pack">'
        + '<div class="tprev" data-prev="' + t.id + '"></div>'
        + '<div class="tmeta"><span class="tnm" title="' + esc(t.name) + '">' + esc(t.name) + '</span><span class="tbadge">' + esc(badge) + '</span></div>'
        + '<div class="tacts">'
        +   '<button class="minibtn tuse">Use</button>'
        +   '<button class="minibtn texp">Export</button>'
        +   (t.builtin ? '' : '<button class="minibtn tren">Rename</button><button class="minibtn danger tdel">Delete</button>')
        + '</div></div>';
    }).join('');

    box.querySelectorAll('.tcard').forEach(function (card) {
      var id = card.dataset.id, t = tplFull.filter(function (x) { return x.id === id; })[0] || {};
      paintPreview(card.querySelector('.tprev'), t);
      var use = function () {
        if (!confirm('Load "' + t.name + '" into the builder?\n\nYour current design will be replaced — save it to the Library first if you want to keep it.')) return;
        tplAct({ type: 'tpl_load', id: id }); closeTpl();
      };
      card.querySelector('.tprev').onclick = use;
      card.querySelector('.tuse').onclick = use;
      card.querySelector('.texp').onclick = function () { exportTemplate(id); };
      var ren = card.querySelector('.tren');
      if (ren) ren.onclick = function () {
        var n = prompt('Rename this design:', t.name); if (n == null || !n.trim()) return;
        tplAct({ type: 'tpl_rename', id: id, name: n.trim() });
        setTimeout(function () { tplFetch(renderTemplates); }, 250);
      };
      var d = card.querySelector('.tdel');
      if (d) d.onclick = function () {
        if (!confirm('Delete "' + t.name + '"?')) return;
        tplAct({ type: 'tpl_delete', id: id }); delete tplPicked[id];
        setTimeout(function () { tplFetch(renderTemplates); }, 250);
      };
      var cb = card.querySelector('.tpick');
      cb.onclick = function (e) { e.stopPropagation(); };
      cb.onchange = function () { if (cb.checked) tplPicked[id] = true; else delete tplPicked[id]; card.classList.toggle('picked', !!tplPicked[id]); };
    });
  }
  function openTpl() { tplFetch(renderTemplates); $('tplModal').style.display = 'flex'; }
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
    setTimeout(function () { tplFetch(renderTemplates); }, 250);
  };
  $('tplImport').onchange = function () {
    var f = this.files[0]; this.value = ''; if (!f) return;
    var r = new FileReader();
    r.onload = function () {
      try {
        var j = JSON.parse(r.result);
        // A pack dropped on the single-design slot should still work — send it the right way.
        if (j && Array.isArray(j.templates)) { installPack(j); return; }
        var lys = j.layers || (j.template && j.template.layers); if (!Array.isArray(lys)) throw 0;
        tplAct({ type: 'tpl_save', name: j.name || 'Imported Template', kind: j.kind || 'lowerthird', layers: lys });
        setTimeout(function () { tplFetch(renderTemplates); }, 250);
      } catch (e) { alert("That doesn't look like a valid template file."); }
    };
    r.readAsText(f);
  };

  /* ---- Template packs ---- */
  function installPack(json) {
    fetch('/pack-install', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(json) })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (!res || !res.ok) { alert('That pack could not be installed.' + (res && res.error ? '\n\n' + res.error : '')); return; }
        tplFetch(function () {
          var pk = tplPacks.filter(function (p) { return p.name === res.name; }).pop();
          if (pk) tplFilter = pk.id;   // drop them straight into what they just installed
          renderTemplates();
        });
      })
      .catch(function () { alert('Could not reach the app.'); });
  }
  $('tplPackImport').onchange = function () {
    var f = this.files[0]; this.value = ''; if (!f) return;
    var r = new FileReader();
    r.onload = function () {
      try {
        var j = JSON.parse(r.result);
        if (!j || !Array.isArray(j.templates)) throw 0;
        installPack(j);
      } catch (e) { alert("That doesn't look like a template pack.\n\nA pack is a .sgpack file — if you have a single design instead, use “Import single”."); }
    };
    r.readAsText(f);
  };
  $('tplMake').onclick = function () {
    var ids = Object.keys(tplPicked);
    if (!ids.length) { alert('Tick the designs you want in the pack first — the little box in the top-left of each preview.'); return; }
    $('pkCount').textContent = ids.length + ' design' + (ids.length === 1 ? '' : 's') + ' selected.';
    $('packModal').style.display = 'flex';
    $('pkName').focus();
  };
  $('pkCancel').onclick = function () { $('packModal').style.display = 'none'; };
  $('packModal').onclick = function (e) { if (e.target === $('packModal')) $('packModal').style.display = 'none'; };
  $('pkSave').onclick = function () {
    var ids = Object.keys(tplPicked);
    if (!ids.length) return;
    var name = ($('pkName').value || '').trim();
    if (!name) { alert('Give the pack a name.'); $('pkName').focus(); return; }
    var b = $('pkSave'), old = b.textContent; b.textContent = 'Building…';
    fetch('/export/pack', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: ids, name: name, author: ($('pkAuthor').value || '').trim(), version: ($('pkVersion').value || '1.0').trim(), description: ($('pkDesc').value || '').trim() })
    }).then(function (r) { return r.json(); }).then(function (res) {
      b.textContent = old;
      if (!res || !res.templates) { alert('Could not build that pack.'); return; }
      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(res, null, 2)], { type: 'application/json' }));
      a.download = name.replace(/[^a-z0-9._-]+/gi, '_').slice(0, 60) + '.sgpack';
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
      $('packModal').style.display = 'none';
      tplPicked = {}; renderTemplates();
    }).catch(function () { b.textContent = old; alert('Could not reach the app.'); });
  };
  $('tplSearch').oninput = function () { tplQuery = this.value; renderTemplates(); };
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
  $('addBullets').onclick = function () { add(merge({ type: 'bullets', x: 200, y: 260, w: 1100, h: 560, items: ['Opening point of the segment', 'The thing everyone came to hear', 'What it means for next season', 'Where to find the full story'], index: -1, mode: 'build', grow: 'down', gap: 18, marker: 'bullet', markerGap: 18, reveal: 'slide-up', revealDur: 520, dimOpacity: 45, hlColor: '#ffd166', hlScale: 1, font: "'Segoe UI', 'Helvetica Neue', Arial, sans-serif", size: 44, bold: true, italic: false, color: '#ffffff', align: 'left', bg: '#0b1f3a', bgOpacity: 0, pad: 24, radius: 14 }, A('fade'))); };
  $('addSlides').onclick = function () { add(merge({ type: 'slides', x: 360, y: 300, w: 1200, h: 480, slides: ['Amazing grace, how sweet the sound', 'That saved a wretch like me', 'I once was lost, but now am found'], index: 0, font: "'Segoe UI', 'Helvetica Neue', Arial, sans-serif", size: 64, bold: true, italic: false, color: '#ffffff', align: 'center', bg: '#0b1f3a', bgOpacity: 0, pad: 28, radius: 14, trans: 'fade' }, A('fade'))); };
  // full-screen background colour box (goes to the very back)
  $('addQR').onclick = function () { add(merge({ type: 'qr', x: 1500, y: 700, w: 300, h: 300, text: '', level: 'M', dark: '#000000', light: '#ffffff', transparent: false, shadow: false }, A('fade'))); };
  $('addBg').onclick = function () {
    var bg = merge({ type: 'box', x: 0, y: 0, w: 1920, h: 1080, fill: '#0b1f3a', opacity: 100, radius: 0 }, A('fade'));
    bg.id = uid(); bg.z = layers.length ? Math.min.apply(null, layers.map(function (l) { return l.z || 0; })) - 1 : 0;
    layers.push(bg); selId = bg.id; renderCanvas(); renderList(); syncProps(); push();
  };

  /* ---- framing guides: title safe, action safe, centre, thirds, crop markings ----
   * Which of them are drawn is one operator's preference, not part of the design, so it is kept
   * in localStorage and never written into the layer array. That is the whole reason none of it
   * can leak on air: the output page renders layers, and there is no guide layer. */
  (function () {
    var g = $('guides'), row = $('guideRow');
    if (!g || !row) return;
    var KEYS = ['title', 'action', 'center', 'thirds', 'crop'];
    var on = { title: true, action: false, center: false, thirds: false, crop: false };
    try {
      var saved = JSON.parse(localStorage.getItem('lt_guides') || 'null');
      if (saved) KEYS.forEach(function (k) { on[k] = !!saved[k]; });
    } catch (e) {}
    var hidden = null;              // what was showing before G hid it all

    function apply(save) {
      KEYS.forEach(function (k) {
        g.classList.toggle('on-' + k, !!on[k]);
        var b = row.querySelector('.gchip[data-g="' + k + '"]');
        if (b) { b.classList.toggle('on', !!on[k]); b.setAttribute('aria-pressed', on[k] ? 'true' : 'false'); }
      });
      if (save !== false) { try { localStorage.setItem('lt_guides', JSON.stringify(on)); } catch (e) {} }
    }

    row.querySelectorAll('.gchip').forEach(function (b) {
      b.setAttribute('type', 'button');
      b.onclick = function () { on[b.dataset.g] = !on[b.dataset.g]; hidden = null; apply(); };
    });

    /* G clears the canvas to look at the design, and puts back exactly what was there. Ignored
       while a field has focus, or the letter would disappear out of the middle of a caption. */
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'g' && e.key !== 'G') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      var t = document.activeElement, tag = (t && t.tagName || '').toUpperCase();
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable)) return;
      if (typeof editing !== 'undefined' && editing) return;
      e.preventDefault();
      var showing = KEYS.filter(function (k) { return on[k]; });
      if (showing.length) { hidden = showing; KEYS.forEach(function (k) { on[k] = false; }); }
      else { (hidden && hidden.length ? hidden : ['title']).forEach(function (k) { on[k] = true; }); hidden = null; }
      apply();
    });

    apply(false);
  })();

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

  /* ---- grab the reference image straight out of OBS ----
   * Same end result as Browse or Ctrl+V, minus the alt-tabbing. Address and port are remembered;
   * the password is held in sessionStorage so it dies with the browser session and never reaches
   * localStorage or the server's state file. */
  (function obsRef() {
    var panel = $('obsPanel'), msg = $('obsMsg'), pick = $('obsScene'), grabBtn = $('obsGrab');
    if (!panel) return;
    try {
      $('obsHost').value = localStorage.getItem('obs_host') || '';
      $('obsPort').value = localStorage.getItem('obs_port') || '';
      $('obsPass').value = sessionStorage.getItem('obs_pass') || '';
    } catch (e) {}

    function conn() {
      var o = { host: $('obsHost').value.trim() || '127.0.0.1', port: $('obsPort').value.trim() || 4455, password: $('obsPass').value };
      try {
        localStorage.setItem('obs_host', $('obsHost').value.trim());
        localStorage.setItem('obs_port', $('obsPort').value.trim());
        if (o.password) sessionStorage.setItem('obs_pass', o.password); else sessionStorage.removeItem('obs_pass');
      } catch (e) {}
      return o;
    }
    function say(t, bad) { msg.textContent = t; msg.style.color = bad ? '#e08a72' : 'var(--muted2)'; }

    /* OBS or vMix. Remembered, because nobody switches brand of switcher mid-season. */
    function showTab(which) {
      var isV = which === 'vmix';
      $('obsFields').style.display = isV ? 'none' : '';
      $('vmixFields').style.display = isV ? '' : 'none';
      $('tabObs').classList.toggle('on', !isV);
      $('tabVmix').classList.toggle('on', isV);
      $('tabObs').style.opacity = isV ? '.55' : '1';
      $('tabVmix').style.opacity = isV ? '1' : '.55';
      try { localStorage.setItem('grab_switcher', which); } catch (e) {}
    }
    $('tabObs').onclick = function () { showTab('obs'); };
    $('tabVmix').onclick = function () { showTab('vmix'); };
    var startTab = 'obs';
    try { startTab = localStorage.getItem('grab_switcher') || 'obs'; } catch (e) {}
    showTab(startTab);

    $('obsBtn').onclick = function () {
      panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
      if (panel.style.display !== 'block') return;
      if (startTab === 'vmix') { if (!$('vmixSource').options.length && $('vmixHost').value) $('vmixTest').click(); return; }
      if (!pick.options.length) $('obsTest').click();
    };

    $('obsTest').onclick = function () {
      say('Connecting…');
      pick.style.display = grabBtn.style.display = 'none';
      fetch('/obs/scenes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(conn()) })
        .then(function (r) { return r.json(); })
        .then(function (res) {
          if (!res.ok) return say(res.error || 'Could not reach OBS.', true);
          pick.innerHTML = '';
          // "What's on air" first, because that is what the operator means nine times out of ten.
          var live = document.createElement('option');
          live.value = ''; live.textContent = 'What’s on air' + (res.current ? ' (' + res.current + ')' : '');
          pick.appendChild(live);
          (res.scenes || []).forEach(function (n) {
            var o = document.createElement('option'); o.value = n; o.textContent = n; pick.appendChild(o);
          });
          pick.style.display = grabBtn.style.display = '';
          say('OBS ' + (res.obsVersion || '') + ' connected.');
        })
        .catch(function () { say('Could not reach OBS.', true); });
    };

    grabBtn.onclick = function () {
      say('Grabbing…');
      var body = conn(); body.source = pick.value || '';
      fetch('/obs/grab', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        .then(function (r) { return r.json(); })
        .then(function (res) {
          if (!res.ok) return say(res.error || 'Grab failed.', true);
          refimg.src = res.url + '?t=' + Date.now();     // same name never repeats, but be certain
          refimg.style.display = 'block';
          refimg.style.opacity = $('refOpacity').value / 100;
          saveRef({ url: res.url, opacity: +$('refOpacity').value });
          say('Grabbed ' + (res.source || 'the live scene') + '.');
        })
        .catch(function () { say('Grab failed.', true); });
    };

    /* ---- the vMix side ----
     * Different mechanics entirely: vMix cannot hand a picture back down the wire, it writes one
     * to disk. No password here — vMix's API has no login of its own for this. */
    var vMsg = $('vmixMsg'), vPick = $('vmixSource'), vGrab = $('vmixGrab');
    function vsay(t, bad) { vMsg.textContent = t; vMsg.style.color = bad ? '#e08a72' : 'var(--muted2)'; }
    function vconn() {
      var o = { host: $('vmixHost').value.trim(), port: $('vmixPort').value.trim() || 8088 };
      try {
        localStorage.setItem('vmix_host', o.host);
        localStorage.setItem('vmix_port', String(o.port));
      } catch (e) {}
      return o;
    }
    try {
      $('vmixHost').value = localStorage.getItem('vmix_host') || '';
      $('vmixPort').value = localStorage.getItem('vmix_port') || '';
    } catch (e) {}

    $('vmixTest').onclick = function () {
      if (!$('vmixHost').value.trim()) return vsay('Put in the address vMix shows under Settings > Web Controller.', true);
      vsay('Connecting…');
      vPick.style.display = vGrab.style.display = 'none';
      fetch('/vmix/state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(vconn()) })
        .then(function (r) { return r.json(); })
        .then(function (res) {
          if (!res.ok) return vsay(res.error || 'Could not reach vMix.', true);
          vPick.innerHTML = '';
          // Program output first: it is the composited picture, overlays and all, which is the
          // thing you are actually trying to line a graphic up against.
          var prog = document.createElement('option');
          prog.value = ''; prog.textContent = 'Program output (what’s on air)';
          vPick.appendChild(prog);
          (res.inputs || []).forEach(function (inp) {
            var o = document.createElement('option');
            o.value = inp.number;
            o.textContent = inp.number + '. ' + inp.title + (inp.number === res.active ? '  — on air' : (inp.number === res.preview ? '  — preview' : ''));
            vPick.appendChild(o);
          });
          vPick.style.display = vGrab.style.display = '';
          vsay('vMix ' + (res.version || '') + (res.edition ? ' ' + res.edition : '') + ' connected.');
        })
        .catch(function () { vsay('Could not reach vMix.', true); });
    };

    vGrab.onclick = function () {
      vsay('Asking vMix for a frame…');
      var body = vconn(); body.input = vPick.value || '';
      fetch('/vmix/grab', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        .then(function (r) { return r.json(); })
        .then(function (res) {
          if (!res.ok) return vsay(res.error || 'Grab failed.', true);
          refimg.src = res.url;
          refimg.style.display = 'block';
          refimg.style.opacity = $('refOpacity').value / 100;
          saveRef({ url: res.url, opacity: +$('refOpacity').value });
          vsay('Grabbed ' + (res.source || 'the program output') + '.');
        })
        .catch(function () { vsay('Grab failed.', true); });
    };
  })();

  // Same job as the Browse button, from a File the user got here some other way.
  function useAsRef(f) {
    if (!f || !/^image\//.test(f.type || '')) return false;
    if (tooBigImage(f)) return true;                       // it WAS an image, we just refused it
    var r = new FileReader();
    r.onload = function () {
      fetch('/upload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: f.name || 'reference.png', data: r.result }) })
        .then(function (x) { return x.json(); }).then(function (res) {
          if (!res || !res.ok) return;
          refimg.src = res.url; refimg.style.display = 'block';
          saveRef({ url: res.url, opacity: +$('refOpacity').value });
          var h = $('refHint'); if (h) { var was = h.innerHTML; h.textContent = 'Reference image set.'; setTimeout(function () { h.innerHTML = was; }, 2500); }
        });
    };
    r.readAsDataURL(f);
    return true;
  }

  // Ctrl+V a screen grab straight in. This is the one that works with EVERY switcher - vMix,
  // OBS, an ATEM multiviewer, a photo of a whiteboard - with nothing to configure. Windows'
  // own Win+Shift+S puts the grab on the clipboard; this catches it.
  // Ignored while a text layer is being edited, so pasting words into a caption still pastes words.
  document.addEventListener('paste', function (e) {
    if (editing) return;
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    var items = (e.clipboardData && e.clipboardData.items) || [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].kind === 'file') {
        if (useAsRef(items[i].getAsFile())) { e.preventDefault(); return; }
      }
    }
  });

  // Drag an image file onto the canvas for the same result.
  (function () {
    var zone = $('cstage') || document.body;
    ['dragover', 'drop'].forEach(function (ev) {
      zone.addEventListener(ev, function (e) {
        e.preventDefault();
        if (ev !== 'drop') return;
        var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        useAsRef(f);
      });
    });
  })();

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
  $('copyBtn').onclick = function () { SGLinks.copy($('outUrl').textContent, this); };

  /* ---- server state ---- */
  function connect() {
    var es = SGLive('/events');
    es.onopen = function () { $('conn').className = 'conn ok'; $('connTxt').textContent = 'live'; };
    es.onmessage = function (e) {
      try {
        var m = JSON.parse(e.data);
        if (m.serverTime) { var meas = m.serverTime - Date.now(); clockOffset = clockOffset === 0 ? meas : Math.round(clockOffset * 0.7 + meas * 0.3); }
        if (m.state) { showsMeta = m.state.shows || []; templates = m.state.templates || []; if (m.state.lowerthird) editingShowId = m.state.lowerthird.editingShowId || '';  }
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
  // The address another computer can reach, not localhost — see sg-links.js.
  SGLinks.onbase(function () { $('outUrl').textContent = SGLinks.url('/lowerthird-output'); });

  /* ---- key + fill panel ----
   * Two more views of the SAME graphic for a hardware switcher (see sg-key.js). The URLs are
   * built through SGLinks for the same reason every other link on this page is: the switcher PC
   * is not this PC, and a localhost link copied onto it points that machine at itself. */
  (function () {
    var btn = $('keyfillBtn'), panel = $('keyfillPanel');
    if (!btn || !panel) return;
    var PATHS = { Fill: '/lowerthird-output?key=fill', Key: '/lowerthird-output?key=key' };

    function paint() {
      Object.keys(PATHS).forEach(function (k) {
        var u = SGLinks.url(PATHS[k]);
        $('kf' + k).textContent = u;
        $('kf' + k + 'Open').href = u;
      });
    }
    ['Fill', 'Key'].forEach(function (k) {
      $('kf' + k + 'Copy').onclick = function () { SGLinks.copy($('kf' + k).textContent, this); };
    });
    SGLinks.onbase(paint);

    var open = false;
    try { open = localStorage.getItem('lt_keyfill_open') === '1'; } catch (e) {}
    function apply() {
      panel.style.display = open ? '' : 'none';
      btn.classList.toggle('on', open);
      if (open) paint();          // an address chosen on another panel may have moved on
    }
    btn.onclick = function () {
      open = !open;
      try { localStorage.setItem('lt_keyfill_open', open ? '1' : '0'); } catch (e) {}
      apply();
      if (open) panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    };
    apply();
  })();
})();
