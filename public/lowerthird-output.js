/* StreamGraphics — Lower Third BUILDER output.
 * Each layer has an independent ANIMATE-ON and ANIMATE-OFF, and each of those has
 * its own delay + duration — so layers stagger on and off exactly as designed. */
(function () {
  'use strict';
  var stage = document.getElementById('stage');
  var visibleNow = false, sig = '', LMAP = {}, clockOffset = 0;
  function serverNow() { return Date.now() + clockOffset; }
  var CMAP = { green: '#00b140', magenta: '#ff00ff', blue: '#0000ff' };
  var EASE = 'cubic-bezier(.16,1,.3,1)';
  var urlChroma = (function () { var m = new URLSearchParams(location.search).get('bg'); return m ? (CMAP[m] || m) : null; })();

  function scaleStage() { var s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080); stage.style.transform = 'scale(' + s + ')'; }
  window.addEventListener('resize', scaleStage); scaleStage();

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }
  function rgba(hex, pct) {
    hex = String(hex || '#000').replace(/^#/, ''); if (hex.length === 3) hex = hex.replace(/(.)/g, '$1$1');
    var r = parseInt(hex.slice(0, 2), 16) || 0, g = parseInt(hex.slice(2, 4), 16) || 0, b = parseInt(hex.slice(4, 6), 16) || 0;
    return 'rgba(' + r + ',' + g + ',' + b + ',' + (pct == null ? 1 : pct / 100) + ')';
  }
  // Render one slide's text: "//" or a real newline = line break; a line starting with - or * = bullet.
  function slideHtml(txt) {
    return esc(txt).replace(/\s*\/\/\s*/g, '\n').replace(/\n/g, '<br>').replace(/(^|<br>)\s*[-*•]\s+/g, '$1• ');
  }
  // The text block inside a slide — fills the (fixed) background box, aligned + padded.
  function slideTextStyle(l) {
    var shadow = (l.bgOpacity > 0) ? '' : ';text-shadow:0 2px 8px rgba(0,0,0,.45)';
    var av = l.align === 'left' ? 'flex-start' : (l.align === 'right' ? 'flex-end' : 'center');
    return 'position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;align-items:' + av
      + ';text-align:' + (l.align || 'center') + ';padding:' + (l.pad == null ? 0 : l.pad) + 'px;box-sizing:border-box;overflow:visible'
      + ';font-family:' + (l.font || "'Segoe UI', Arial, sans-serif") + ';font-size:' + (l.size || 54) + 'px;color:' + esc(l.color || '#fff')
      + ';font-weight:' + (l.bold ? '800' : '600') + ';font-style:' + (l.italic ? 'italic' : 'normal') + ';line-height:1.22' + shadow;
  }
  // The background PANEL is fixed (sized by the layer box) and stays put; only the text animates between slides.
  function slideBgHtml(l) {
    if (!(l.bgOpacity > 0 && l.bg)) return '';
    return '<div class="slide-bg" style="position:absolute;inset:0;background:' + rgba(l.bg, l.bgOpacity) + ';border-radius:' + (l.radius || 0) + 'px"></div>';
  }
  function slideWrap(l, idx, innerHtmlStr) {
    var hide = innerHtmlStr ? '' : 'display:none;';
    return '<div class="li ly-slide" data-idx="' + idx + '" style="position:relative;overflow:visible;width:100%;height:100%">'
      + slideBgHtml(l)
      + '<div class="slide-text" style="' + hide + slideTextStyle(l) + ';transition:transform .22s ease,opacity .22s ease">' + innerHtmlStr + '</div></div>';
  }
  // Between-slide transition offsets (text only): out-state and in-from-state.
  function transOut(tr) { return tr === 'slide-up' ? 'translateY(-26px)' : tr === 'slide-down' ? 'translateY(26px)' : tr === 'slide-left' ? 'translateX(-44px)' : tr === 'slide-right' ? 'translateX(44px)' : tr === 'zoom' ? 'scale(1.12)' : 'none'; }
  function transIn(tr) { return tr === 'slide-up' ? 'translateY(26px)' : tr === 'slide-down' ? 'translateY(-26px)' : tr === 'slide-left' ? 'translateX(44px)' : tr === 'slide-right' ? 'translateX(-44px)' : tr === 'zoom' ? 'scale(.88)' : 'none'; }
  function transDurOf(l) { var d = (l && l.transDur != null) ? +l.transDur : 220; return (isFinite(d) && d >= 0) ? d : 220; }

  // ---- timer layer math (shared shape with the standalone timer + server) ----
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
  // Countdown warning: as a down/target timer nears zero it turns red and flashes, and
  // stays red (flashing faster) once it runs into overtime — so "time's up" reads on air.
  // Returns {color, opacity} to apply this frame, or null for the normal look.
  function timerWarn(l, now) {
    if (!l || l.type !== 'timer' || (l.mode !== 'down' && l.mode !== 'tod')) return null;
    var warnMs = (l.warnMs == null ? 10000 : l.warnMs);
    if (warnMs <= 0) return null;
    var rem = liveTimerMs(l, now);                 // down: negative in overtime; tod: clamped >=0
    if (rem > warnMs) return null;                 // not in the warning window yet
    var over = (l.mode === 'down') && rem <= 0;
    var flash = (l.flash !== false);               // flashing on by default
    var period = over ? 300 : 450;                 // faster blink once time is up
    var on = flash ? (Math.floor(now / period) % 2 === 0) : true;
    return { color: (l.warnColor || '#ff3b30'), opacity: on ? 1 : 0.28 };
  }

  // the "hidden" state (from-state for ON, to-state for OFF) of an animation type
  var BOUNCE = 'cubic-bezier(.34,1.62,.5,1)';   // overshoot for bounce/pop
  function hidden(type, dir) {
    switch (type) {
      case 'slide-up': return { o: 0, t: 'translateY(46px)' };
      case 'slide-down': return { o: 0, t: 'translateY(-46px)' };
      case 'slide-left': return { o: 0, t: 'translateX(-60px)' };
      case 'slide-right': return { o: 0, t: 'translateX(60px)' };
      case 'fly-left': return { o: 0, t: 'translateX(-1280px)' };   // in from off-screen left
      case 'fly-right': return { o: 0, t: 'translateX(1280px)' };   // in from off-screen right
      case 'bounce': return { o: 0, t: 'translateY(64px) scale(.9)', ease: BOUNCE };
      case 'pop': return { o: 0, t: 'scale(.3)', ease: BOUNCE };
      case 'rotate': return { o: 0, t: 'rotate(-180deg) scale(.4)' };  // spin in
      case 'scale': return { o: 0, t: 'scale(.86)' };
      // "None" means no animation — it does NOT mean "stay on screen". Coming on that's an
      // instant appear; going off it has to be an instant disappear, or the layer never leaves
      // air and sits over everything until you delete it.
      case 'none': return dir === 'out' ? { o: 0, t: 'none', cut: true } : { o: 1, t: 'none' };
      default: return { o: 0, t: 'none' }; // fade
    }
  }
  function setState(li, o, t) { li.style.opacity = o; li.style.transform = t; }

  function buildLayers(layers) {
    LMAP = {};
    layers = layers.slice().sort(function (a, b) { return (a.z || 0) - (b.z || 0); });
    var html = '';
    layers.forEach(function (l) {
      if (l.hidden) return;   // a layer switched off in the explorer never renders on air
      LMAP[l.id] = l;
      var box = 'left:' + (l.x || 0) + 'px;top:' + (l.y || 0) + 'px;width:' + (l.w || 0) + 'px;height:' + (l.h || 0) + 'px;z-index:' + (l.z || 0) + ';';
      if (l.rot) box += 'transform:rotate(' + l.rot + 'deg);transform-origin:center;';
      var inner = '';
      if (l.type === 'box') inner = SGBox.html(l);
      else if (l.type === 'text') {
        var st = 'font-family:' + (l.font || 'Arial') + ';font-size:' + (l.size || 24) + 'px;color:' + esc(l.color || '#fff')
          + ';font-weight:' + (l.bold ? '800' : '400') + ';font-style:' + (l.italic ? 'italic' : 'normal') + ';text-align:' + (l.align || 'left')
          + ';align-items:' + (l.align === 'center' ? 'center' : (l.align === 'right' ? 'flex-end' : 'flex-start')) + (l.shadow === false ? '' : ';text-shadow:0 2px 8px rgba(0,0,0,.55)');
        inner = '<div class="li ly-text" style="' + st + '">' + esc(l.text || '') + '</div>';
      } else if (l.type === 'image') inner = SGImg.html(l);
      else if (l.type === 'video') {
        var vrad = l.shape === 'circle' ? '50%' : (l.shape === 'rounded' ? '16px' : '0');
        inner = '<video class="li ly-vid" data-vid="' + l.id + '" src="' + esc(l.src || '') + '"' + (l.loop ? ' loop' : '') + (l.muted === false ? '' : ' muted') + ' playsinline preload="auto" style="width:100%;height:100%;object-fit:' + (l.fit === 'cover' ? 'cover' : 'contain') + ';border-radius:' + vrad + '"></video>';
      } else if (l.type === 'ticker') {
        var ts = 'font-family:' + (l.font || 'Arial') + ';font-size:' + (l.size || 28) + 'px;color:' + esc(l.color || '#fff') + ';font-weight:' + (l.bold ? '800' : '600');
        var gap = '&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;';
        inner = '<div class="li ly-ticker" style="width:100%;height:100%;' + SGBox.style(l) + 'overflow:hidden;display:flex;align-items:center">' + '<div class="tick-track" style="display:inline-flex;white-space:nowrap;will-change:transform;' + ts + '">' + '<span class="tc">' + esc(l.text || '') + gap + '</span><span class="tc">' + esc(l.text || '') + gap + '</span></div></div>';
      } else if (l.type === 'slides') {
        var sidx = (l.index == null ? -1 : l.index);
        var stxt = (sidx >= 0 && l.slides && l.slides[sidx] != null) ? l.slides[sidx] : '';
        inner = slideWrap(l, sidx, slideHtml(stxt));
      } else if (l.type === 'qr') {
        inner = SGQR.layerHtml(l, false);
      } else if (l.type === 'bullets') {
        inner = SGBullets.html(l);
      } else if (l.type === 'timer') {
        var tmst = 'font-family:' + (l.font || "'Segoe UI', Arial, sans-serif") + ';font-size:' + (l.size || 96) + 'px;color:' + esc(l.color || '#fff')
          + ';font-weight:' + (l.bold ? '800' : '600') + ';font-style:' + (l.italic ? 'italic' : 'normal') + ';text-align:' + (l.align || 'center')
          + ';align-items:' + (l.align === 'center' ? 'center' : (l.align === 'right' ? 'flex-end' : 'flex-start'))
          + ';font-variant-numeric:tabular-nums;font-feature-settings:\'tnum\' 1;text-shadow:0 2px 8px rgba(0,0,0,.35)';
        inner = '<div class="li ly-timer" style="' + tmst + '">' + esc(fmtTimer(l)) + '</div>';
      }
      html += '<div class="ly" data-id="' + l.id + '" style="' + box + '">' + inner + '</div>';
    });
    stage.innerHTML = html;
    setupTickers();
    primeVideos();
  }
  // Decode the first frame while off-air so taking to air shows real footage, not a black flash.
  function primeVideos() {
    stage.querySelectorAll('video.ly-vid').forEach(function (v) {
      var prime = function () { try { v.pause(); if (v.currentTime > 0.05) v.currentTime = 0; } catch (e) {} };
      if (v.readyState >= 2) prime(); else v.addEventListener('loadeddata', prime, { once: true });
      // A non-looping clip that finishes must NOT leave a black box on air.
      v.addEventListener('ended', function () {
        if (v.loop) return;
        var l = LMAP[v.parentNode.dataset.id] || {};
        if (l.whenDone === 'hide') { v.style.transition = 'opacity .3s ease'; v.style.opacity = '0'; }
        // 'hold': re-seek to the final frame so the browser repaints it instead of showing black.
        else { try { if (isFinite(v.duration) && v.duration > 0.1) v.currentTime = Math.max(0, v.duration - 0.05); } catch (e) {} }
      });
    });
  }

  /* ---- ticker scrollers (continuous, seamless) ---- */
  var tickers = [];
  function setupTickers() {
    tickers = [];
    stage.querySelectorAll('.ly').forEach(function (ly) {
      var l = LMAP[ly.dataset.id]; if (!l || l.type !== 'ticker') return;
      var track = ly.querySelector('.tick-track'); if (!track) return;
      var copies = track.querySelectorAll('.tc');
      var copyW = copies.length > 1 ? (copies[1].offsetLeft - copies[0].offsetLeft) : copies[0].offsetWidth;
      var speed = (l.speed == null ? 120 : l.speed);
      tickers.push({ track: track, copyW: copyW || 1, speed: speed, dir: l.dir === 'right' ? 1 : -1, off: l.dir === 'right' ? -(copyW || 1) : 0 });
    });
  }
  var lastT = 0;
  function tickLoop(t) {
    var dt = lastT ? (t - lastT) / 1000 : 0; lastT = t;
    // Live timer/clock layers — recompute their text every frame from the server-anchored clock.
    var tnow = serverNow(), tmr = stage.querySelectorAll('.ly-timer');
    if (tmr.length) tmr.forEach(function (el) {
      var l = LMAP[el.parentNode.dataset.id]; if (!l) return;
      el.textContent = fmtTimer(l, tnow);
      var w = timerWarn(l, tnow);
      if (w) { el.style.color = w.color; el.style.opacity = w.opacity; }
      else { el.style.color = (l.color || '#fff'); el.style.opacity = 1; }
    });
    tickers.forEach(function (tk) {
      tk.off += tk.dir * tk.speed * dt;
      if (tk.off <= -tk.copyW) tk.off += tk.copyW;
      if (tk.dir === 1 && tk.off >= 0) tk.off -= tk.copyW;
      tk.track.style.transform = 'translateX(' + tk.off + 'px)';
    });
    requestAnimationFrame(tickLoop);
  }
  requestAnimationFrame(tickLoop);

  function playAutoVideos() {
    stage.querySelectorAll('video.ly-vid').forEach(function (v) {
      var l = LMAP[v.parentNode.dataset.id];
      if (!l || l.autoplay === false) return;
      v.style.opacity = '';   // clear any "hide on end" from a previous run
      var go = function () { try { if (v.currentTime > 0.05) v.currentTime = 0; var p = v.play(); if (p && p.catch) p.catch(function () {}); } catch (e) {} };
      if (v.readyState >= 2) go(); else v.addEventListener('loadeddata', go, { once: true });
    });
  }
  function pauseVideos() { stage.querySelectorAll('video.ly-vid').forEach(function (v) { try { v.pause(); } catch (e) {} }); }
  var lastVcmd = 0;
  function applyVcmd(vc) {
    if (!vc || vc.seq === lastVcmd) return; lastVcmd = vc.seq;
    var v = stage.querySelector('video.ly-vid[data-vid="' + vc.id + '"]'); if (!v) return;
    try { if (vc.cmd === 'pause') { v.pause(); return; } v.style.opacity = ''; if (vc.cmd === 'restart') v.currentTime = 0; v.play(); } catch (e) {}
  }

  function eachLi(fn) { stage.querySelectorAll('.ly').forEach(function (ly) { var li = ly.querySelector('.li'); var l = LMAP[ly.dataset.id]; if (li && l) fn(li, l); }); }

  // A grouped layer whose OWN animation is "none" inherits its group's animation (+timing),
  // so the whole group flies in/out together as one — even the plain background box.
  function groupLead(gid, dir) {
    for (var k in LMAP) { var m = LMAP[k]; if (m.group !== gid) continue; var a = dir === 'in' ? (m.inAnim || 'none') : (m.outAnim || 'none'); if (a && a !== 'none') return dir === 'in' ? { anim: a, dur: m.inDur == null ? 500 : m.inDur, del: m.inDelay || 0 } : { anim: a, dur: m.outDur == null ? 350 : m.outDur, del: m.outDelay || 0 }; }
    return null;
  }
  function effAnim(l, dir) {
    var own = dir === 'in' ? (l.inAnim || 'fade') : (l.outAnim || 'fade');
    if (l.group && own === 'none') { var g = groupLead(l.group, dir); if (g) return g; }
    return dir === 'in' ? { anim: own, dur: l.inDur == null ? 500 : l.inDur, del: l.inDelay || 0 } : { anim: own, dur: l.outDur == null ? 350 : l.outDur, del: l.outDelay || 0 };
  }
  function animateOn() {
    eachLi(function (li, l) {
      var e = effAnim(l, 'in'), h = hidden(e.anim, 'in');
      li.style.transition = 'none'; setState(li, h.o, h.t); void li.offsetWidth;
      li.style.transition = 'transform ' + e.dur + 'ms ' + (h.ease || EASE) + ' ' + e.del + 'ms, opacity ' + e.dur + 'ms ease ' + e.del + 'ms';
      setState(li, 1, 'none');
    });
  }
  function animateOff() {
    eachLi(function (li, l) {
      var e = effAnim(l, 'out'), h = hidden(e.anim, 'out');
      if (h.cut) { li.style.transition = 'none'; setState(li, h.o, h.t); return; }   // "None" = cut, not a fade
      li.style.transition = 'transform ' + e.dur + 'ms ' + (h.ease || EASE) + ' ' + e.del + 'ms, opacity ' + e.dur + 'ms ease ' + e.del + 'ms';
      setState(li, h.o, h.t);
    });
  }
  // Instantly reflect an edit with no animation. Off air, the resting state is the ON animation's
  // start pose (so the next take plays from the right place) — but asked for it as an OUT state,
  // because off air has to be invisible whatever animation the layer was given.
  function snap(v) {
    eachLi(function (li, l) { li.style.transition = 'none'; if (v) setState(li, 1, 'none'); else { var h = hidden(effAnim(l, 'in').anim, 'out'); setState(li, h.o, h.t); } });
  }

  function applyChroma(c) {
    var col = urlChroma || (c ? (CMAP[c] || c) : '');
    if (col) { document.documentElement.style.setProperty('--chroma', col); document.body.classList.add('chroma'); }
    else document.body.classList.remove('chroma');
  }

  // Advancing a slide changes only its `index` — cross-fade the text in place instead of
  // rebuilding the whole layer, so it glides like lyrics/scripture rather than hard-cutting.
  function refreshSlides(lt) {
    (lt.layers || []).forEach(function (l) {
      if (l.type !== 'slides') return;
      var el = stage.querySelector('.ly[data-id="' + l.id + '"] .ly-slide'); if (!el) return;
      var text = el.querySelector('.slide-text'); if (!text) return;
      var idx = (l.index == null ? -1 : l.index);
      if (String(idx) === el.getAttribute('data-idx')) return;
      var txt = (idx >= 0 && l.slides && l.slides[idx] != null) ? l.slides[idx] : '';
      var html = slideHtml(txt), tr = l.trans || 'fade', dur = transDurOf(l);
      if (tr === 'none' || dur === 0) {   // hard cut, on purpose
        text.innerHTML = html; text.style.display = html ? 'flex' : 'none';
        text.style.transition = 'none'; text.style.opacity = '1'; text.style.transform = 'none';
        el.setAttribute('data-idx', String(idx)); return;
      }
      var out = Math.round(dur * 0.45), inn = Math.max(dur - out, 40);
      // Animate the TEXT out (background panel stays put), swap, animate the new text in.
      text.style.transition = 'transform ' + out + 'ms ease, opacity ' + out + 'ms ease';
      text.style.opacity = '0'; text.style.transform = transOut(tr);
      setTimeout(function () {
        text.innerHTML = html; text.style.display = html ? 'flex' : 'none';   // keep the flex layout so text stays centered (was '' which reverted to block = jumped to top)
        text.style.transition = 'none'; text.style.opacity = '0'; text.style.transform = transIn(tr); void text.offsetWidth;
        text.style.transition = 'transform ' + inn + 'ms ease, opacity ' + inn + 'ms ease';
        text.style.opacity = '1'; text.style.transform = 'none';
        el.setAttribute('data-idx', String(idx));
      }, out);
    });
  }
  function render(lt) {
    applyChroma(lt.chroma);
    // Neutralise slide `index` so advancing a slide does NOT trigger a full rebuild.
    var newSig = JSON.stringify(lt.layers, function (k, v) { return k === 'index' ? 0 : v; });
    if (newSig !== sig) { sig = newSig; buildLayers(lt.layers || []); snap(visibleNow); }
    refreshSlides(lt);
    // Same idea for a bullet build: only the newly-revealed line animates, everything else stays put.
    (lt.layers || []).forEach(function (l) { if (l.type === 'bullets') SGBullets.refresh(stage, l); });
    if (!!lt.visible !== visibleNow) { visibleNow = !!lt.visible; requestAnimationFrame(function () { if (visibleNow) { animateOn(); playAutoVideos(); } else { animateOff(); pauseVideos(); } }); }
    applyVcmd(lt.vcmd);
  }

  var es = SGLive('/events');
  es.onmessage = function (e) {
    try {
      var m = JSON.parse(e.data);
      if (m.serverTime) { var meas = m.serverTime - Date.now(); clockOffset = clockOffset === 0 ? meas : Math.round(clockOffset * 0.7 + meas * 0.3); }
      if (m.state && m.state.lowerthird) render(m.state.lowerthird);
    } catch (x) {}
  };
})();
