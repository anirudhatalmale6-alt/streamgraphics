/* StreamGraphics — PROGRAM output.
 * Composites every Show-Library preset that is toggled ON, transparent, for OBS/vMix.
 * Each preset is its own layer-set; toggling on/off fades the whole preset in/out.
 * Timers, tickers and slide backgrounds render live. */
(function () {
  'use strict';
  var stage = document.getElementById('stage');
  var CMAP = { green: '#00b140', magenta: '#ff00ff', blue: '#0000ff' };
  var urlChroma = (function () { var m = new URLSearchParams(location.search).get('bg'); return m ? (CMAP[m] || m) : null; })();
  var clockOffset = 0;
  function serverNow() { return Date.now() + clockOffset; }
  function scaleStage() { var s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080); stage.style.transform = 'scale(' + s + ')'; }
  window.addEventListener('resize', scaleStage); scaleStage();

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }
  function rgba(hex, pct) {
    hex = String(hex || '#000').replace(/^#/, ''); if (hex.length === 3) hex = hex.replace(/(.)/g, '$1$1');
    var r = parseInt(hex.slice(0, 2), 16) || 0, g = parseInt(hex.slice(2, 4), 16) || 0, b = parseInt(hex.slice(4, 6), 16) || 0;
    return 'rgba(' + r + ',' + g + ',' + b + ',' + (pct == null ? 1 : pct / 100) + ')';
  }
  function slideHtml(txt) { return esc(txt).replace(/\s*\/\/\s*/g, '\n').replace(/\n/g, '<br>').replace(/(^|<br>)\s*[-*•]\s+/g, '$1• '); }

  // ---- timer math (shared shape with the rest of the app) ----
  function liveTimerMs(t, now) {
    if (t.mode === 'up') return (t.baseMs || 0) + (t.running ? now - t.anchorServer : 0);
    if (t.mode === 'tod') return Math.max(0, (t.targetEpoch || 0) - now);
    var rem = (t.baseMs || 0) - (t.running ? now - t.anchorServer : 0);
    return t.overtime ? rem : Math.max(0, rem);
  }
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function fmtDur(ms, sh) { var neg = ms < 0; if (neg) ms = -ms; var tot = Math.floor(ms / 1000), h = Math.floor(tot / 3600), m = Math.floor((tot % 3600) / 60), s = tot % 60; var str = (sh || h > 0) ? pad2(h) + ':' + pad2(m) + ':' + pad2(s) : pad2(m) + ':' + pad2(s); return (neg ? '-' : '') + str; }
  function clockStr(d, u) { var h = d.getHours(), m = d.getMinutes(), s = d.getSeconds(), ap = ''; if (!u) { ap = h < 12 ? ' AM' : ' PM'; h = h % 12; if (h === 0) h = 12; } return (u ? pad2(h) : h) + ':' + pad2(m) + ':' + pad2(s) + ap; }
  function fmtTimer(l, now) { now = now || serverNow(); if (l.mode === 'clock') return clockStr(new Date(now), !!l.use24h); return fmtDur(liveTimerMs(l, now), !!l.showHours); }

  function slideTextStyle(l) {
    var shadow = (l.bgOpacity > 0) ? '' : ';text-shadow:0 2px 8px rgba(0,0,0,.45)';
    var av = l.align === 'left' ? 'flex-start' : (l.align === 'right' ? 'flex-end' : 'center');
    return 'position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;align-items:' + av
      + ';text-align:' + (l.align || 'center') + ';padding:' + (l.pad == null ? 0 : l.pad) + 'px;box-sizing:border-box;overflow:visible'
      + ';font-family:' + (l.font || "'Segoe UI', Arial, sans-serif") + ';font-size:' + (l.size || 54) + 'px;color:' + esc(l.color || '#fff')
      + ';font-weight:' + (l.bold ? '800' : '600') + ';font-style:' + (l.italic ? 'italic' : 'normal') + ';line-height:1.22' + shadow;
  }

  // Build one preset's layers into a container element.
  function buildInto(container, layers) {
    layers = (layers || []).slice().sort(function (a, b) { return (a.z || 0) - (b.z || 0); });
    var html = '';
    layers.forEach(function (l) {
      if (l.hidden) return;
      var box = 'left:' + (l.x || 0) + 'px;top:' + (l.y || 0) + 'px;width:' + (l.w || 0) + 'px;height:' + (l.h || 0) + 'px;z-index:' + (l.z || 0) + ';';
      if (l.rot) box += 'transform:rotate(' + l.rot + 'deg);transform-origin:center;';
      var inner = '';
      if (l.type === 'box') inner = '<div class="li" style="width:100%;height:100%;background:' + rgba(l.fill, l.opacity) + ';border-radius:' + (l.radius || 0) + 'px"></div>';
      else if (l.type === 'text') {
        var st = 'font-family:' + (l.font || 'Arial') + ';font-size:' + (l.size || 24) + 'px;color:' + esc(l.color || '#fff')
          + ';font-weight:' + (l.bold ? '800' : '400') + ';font-style:' + (l.italic ? 'italic' : 'normal') + ';text-align:' + (l.align || 'left')
          + ';align-items:' + (l.align === 'center' ? 'center' : (l.align === 'right' ? 'flex-end' : 'flex-start')) + ';text-shadow:0 2px 8px rgba(0,0,0,.35)';
        inner = '<div class="li ly-text" style="' + st + '">' + esc(l.text || '') + '</div>';
      } else if (l.type === 'image') inner = '<img class="li ly-img ' + (l.fit === 'cover' ? 'cover ' : '') + (l.shape || 'none') + '" src="' + esc(l.src || '') + '" style="width:100%;height:100%">';
      else if (l.type === 'video') {
        var vrad = l.shape === 'circle' ? '50%' : (l.shape === 'rounded' ? '16px' : '0');
        inner = '<video class="li ly-vid" src="' + esc(l.src || '') + '"' + (l.loop ? ' loop' : '') + (l.muted === false ? '' : ' muted') + ' autoplay playsinline preload="auto" style="width:100%;height:100%;object-fit:' + (l.fit === 'cover' ? 'cover' : 'contain') + ';border-radius:' + vrad + '"></video>';
      } else if (l.type === 'ticker') {
        var ts = 'font-family:' + (l.font || 'Arial') + ';font-size:' + (l.size || 28) + 'px;color:' + esc(l.color || '#fff') + ';font-weight:' + (l.bold ? '800' : '600');
        var gap = '&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;';
        inner = '<div class="li" style="width:100%;height:100%;background:' + rgba(l.fill, l.opacity) + ';border-radius:' + (l.radius || 0) + 'px;overflow:hidden;display:flex;align-items:center"><div class="tick-track" style="display:inline-flex;white-space:nowrap;will-change:transform;' + ts + '"><span class="tc">' + esc(l.text || '') + gap + '</span><span class="tc">' + esc(l.text || '') + gap + '</span></div></div>';
      } else if (l.type === 'timer') {
        var tmst = 'font-family:' + (l.font || "'Segoe UI', Arial, sans-serif") + ';font-size:' + (l.size || 96) + 'px;color:' + esc(l.color || '#fff')
          + ';font-weight:' + (l.bold ? '800' : '600') + ';text-align:' + (l.align || 'center')
          + ';align-items:' + (l.align === 'center' ? 'center' : (l.align === 'right' ? 'flex-end' : 'flex-start')) + ';font-variant-numeric:tabular-nums;text-shadow:0 2px 8px rgba(0,0,0,.35)';
        inner = '<div class="li ly-timer" style="' + tmst + '">' + esc(fmtTimer(l)) + '</div>';
      } else if (l.type === 'slides') {
        var sidx = (l.index == null ? -1 : l.index);
        var stxt = (sidx >= 0 && l.slides && l.slides[sidx] != null) ? l.slides[sidx] : '';
        var bg = (l.bgOpacity > 0 && l.bg) ? '<div style="position:absolute;inset:0;background:' + rgba(l.bg, l.bgOpacity) + ';border-radius:' + (l.radius || 0) + 'px"></div>' : '';
        inner = '<div class="li" style="position:relative;overflow:visible;width:100%;height:100%">' + bg + '<div class="ly-slide-text" style="' + (stxt ? '' : 'display:none;') + slideTextStyle(l) + '">' + slideHtml(stxt) + '</div></div>';
      }
      html += '<div class="ly" data-id="' + l.id + '" style="' + box + '">' + inner + '</div>';
    });
    container.innerHTML = html;
    container._lmap = {}; layers.forEach(function (l) { container._lmap[l.id] = l; });   // for per-layer animation
    setupTickers(container);
  }

  // ---- per-layer in/out animation (same design as the builder output) ----
  var EASE = 'cubic-bezier(.16,1,.3,1)', BOUNCE = 'cubic-bezier(.34,1.62,.5,1)';
  function hidden(type) {
    switch (type) {
      case 'slide-up': return { o: 0, t: 'translateY(46px)' };
      case 'slide-down': return { o: 0, t: 'translateY(-46px)' };
      case 'slide-left': return { o: 0, t: 'translateX(-60px)' };
      case 'slide-right': return { o: 0, t: 'translateX(60px)' };
      case 'fly-left': return { o: 0, t: 'translateX(-1280px)' };
      case 'fly-right': return { o: 0, t: 'translateX(1280px)' };
      case 'bounce': return { o: 0, t: 'translateY(64px) scale(.9)', ease: BOUNCE };
      case 'pop': return { o: 0, t: 'scale(.3)', ease: BOUNCE };
      case 'rotate': return { o: 0, t: 'rotate(-180deg) scale(.4)' };
      case 'scale': return { o: 0, t: 'scale(.86)' };
      case 'none': return { o: 1, t: 'none' };
      default: return { o: 0, t: 'none' };
    }
  }
  function setState(li, o, t) { li.style.opacity = o; li.style.transform = t; }
  // Grouped layer with own animation "none" inherits its group's animation (move as one unit).
  function groupLead(map, gid, dir) {
    for (var k in map) { var m = map[k]; if (m.group !== gid) continue; var a = dir === 'in' ? (m.inAnim || 'none') : (m.outAnim || 'none'); if (a && a !== 'none') return dir === 'in' ? { anim: a, dur: m.inDur == null ? 500 : m.inDur, del: m.inDelay || 0 } : { anim: a, dur: m.outDur == null ? 350 : m.outDur, del: m.outDelay || 0 }; }
    return null;
  }
  function effAnim(map, l, dir) {
    var own = dir === 'in' ? (l.inAnim || 'fade') : (l.outAnim || 'fade');
    if (l.group && own === 'none') { var g = groupLead(map, l.group, dir); if (g) return g; }
    return dir === 'in' ? { anim: own, dur: l.inDur == null ? 500 : l.inDur, del: l.inDelay || 0 } : { anim: own, dur: l.outDur == null ? 350 : l.outDur, del: l.outDelay || 0 };
  }
  function animatePreset(container, dir) {
    var maxOut = 0, map = container._lmap || {};
    container.querySelectorAll('.ly').forEach(function (ly) {
      var l = map[ly.dataset.id]; var li = ly.querySelector('.li'); if (!l || !li) return;
      var e = effAnim(map, l, dir), h = hidden(e.anim);
      if (dir === 'in') {
        li.style.transition = 'none'; setState(li, h.o, h.t); void li.offsetWidth;
        li.style.transition = 'transform ' + e.dur + 'ms ' + (h.ease || EASE) + ' ' + e.del + 'ms, opacity ' + e.dur + 'ms ease ' + e.del + 'ms';
        setState(li, 1, 'none');
      } else {
        li.style.transition = 'transform ' + e.dur + 'ms ' + (h.ease || EASE) + ' ' + e.del + 'ms, opacity ' + e.dur + 'ms ease ' + e.del + 'ms';
        setState(li, h.o, h.t);
        maxOut = Math.max(maxOut, e.dur + e.del);
      }
    });
    return maxOut;
  }

  // ---- ticker scrolling (per container) ----
  var tickers = [];
  function setupTickers(container) {
    container.querySelectorAll('.tick-track').forEach(function (track) {
      var copies = track.querySelectorAll('.tc');
      var copyW = copies.length > 1 ? (copies[1].offsetLeft - copies[0].offsetLeft) : copies[0].offsetWidth;
      tickers.push({ track: track, copyW: copyW || 1, off: 0 });
    });
  }
  var lastT = 0;
  function tick(t) {
    var dt = lastT ? (t - lastT) / 1000 : 0; lastT = t;
    var now = serverNow();
    stage.querySelectorAll('.ly-timer').forEach(function (el) { var d = el.getAttribute('data-t'); if (d) el.textContent = fmtTimer(JSON.parse(d), now); });
    tickers = tickers.filter(function (tk) { return tk.track.isConnected; });
    tickers.forEach(function (tk) { tk.off -= 120 * dt; if (tk.off <= -tk.copyW) tk.off += tk.copyW; tk.track.style.transform = 'translateX(' + tk.off + 'px)'; });
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // Store each timer layer's data on its element so the tick loop can recompute it live.
  function tagTimers(container, layers) {
    var timerLayers = (layers || []).filter(function (l) { return l.type === 'timer' && !l.hidden; });
    var els = container.querySelectorAll('.ly-timer');
    timerLayers.forEach(function (l, i) { if (els[i]) els[i].setAttribute('data-t', JSON.stringify(l)); });
  }

  // Mail-merge: fill a template's field-layers (l.field) from a CSV row (matched by column name).
  function fillLayers(layers, row) {
    if (!row) return layers;
    var keys = Object.keys(row);
    function val(field) { var f = String(field || '').toLowerCase(); for (var i = 0; i < keys.length; i++) if (keys[i].toLowerCase() === f) return row[keys[i]]; return null; }
    return layers.map(function (l) {
      if (!l.field) return l;
      var v = val(l.field); if (v == null) return l;
      if (l.type === 'text') return Object.assign({}, l, { text: v });
      if (l.type === 'image') return Object.assign({}, l, { src: v });
      return l;
    });
  }

  var active = {};   // id -> { el, sig }
  function applyChroma(c) {
    var col = urlChroma || (c ? (CMAP[c] || c) : '');
    if (col) { document.documentElement.style.setProperty('--chroma', col); document.body.classList.add('chroma'); }
    else document.body.classList.remove('chroma');
  }

  function render(state) {
    applyChroma(state.lowerthird && state.lowerthird.chroma);
    var shows = state.shows || [];
    var onIds = {};
    shows.forEach(function (it) {
      if (!it.on || it.kind !== 'lowerthird' || !it.payload || !Array.isArray(it.payload.layers)) return;
      onIds[it.id] = true;
      var row = (it.rows && it.rows.length) ? it.rows[Math.max(0, Math.min(it.rows.length - 1, it.rowIndex || 0))] : null;
      var layers = fillLayers(it.payload.layers, row);
      var sig = JSON.stringify(layers), rowSig = it.rowIndex || 0;
      var a = active[it.id];
      if (!a) {
        var el = document.createElement('div'); el.className = 'preset in'; el.setAttribute('data-id', it.id);
        stage.appendChild(el); buildInto(el, layers); tagTimers(el, layers);
        active[it.id] = { el: el, sig: sig, rowSig: rowSig };
        requestAnimationFrame(function () { animatePreset(el, 'in'); });   // play each layer's Animate-ON
      } else if (a.sig !== sig) {
        // Already on air (row step or live edit): swap contents in place, no re-animation.
        buildInto(a.el, layers); tagTimers(a.el, layers); a.sig = sig; a.rowSig = rowSig;
      }
    });
    // Turn OFF: play each layer's Animate-OFF, then remove after the longest exit finishes.
    Object.keys(active).forEach(function (id) {
      if (onIds[id]) return;
      var a = active[id]; delete active[id];
      var maxOut = animatePreset(a.el, 'out');
      setTimeout(function () { if (a.el.parentNode) a.el.parentNode.removeChild(a.el); }, maxOut + 120);
    });
  }

  var es = new EventSource('/events');
  es.onmessage = function (e) {
    try {
      var m = JSON.parse(e.data);
      if (m.serverTime) { var meas = m.serverTime - Date.now(); clockOffset = clockOffset === 0 ? meas : Math.round(clockOffset * 0.7 + meas * 0.3); }
      if (m.state) render(m.state);
    } catch (x) {}
  };
})();
