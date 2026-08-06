/* StreamGraphics — Lower Third BUILDER output.
 * Each layer has an independent ANIMATE-ON and ANIMATE-OFF, and each of those has
 * its own delay + duration — so layers stagger on and off exactly as designed. */
(function () {
  'use strict';
  var stage = document.getElementById('stage');
  var visibleNow = false, sig = '', LMAP = {};
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
  // the "hidden" state (from-state for ON, to-state for OFF) of an animation type
  var BOUNCE = 'cubic-bezier(.34,1.62,.5,1)';   // overshoot for bounce/pop
  function hidden(type) {
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
      case 'none': return { o: 1, t: 'none' };
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
      if (l.type === 'box') inner = '<div class="li ly-box" style="width:100%;height:100%;background:' + rgba(l.fill, l.opacity) + ';border-radius:' + (l.radius || 0) + 'px"></div>';
      else if (l.type === 'text') {
        var st = 'font-family:' + (l.font || 'Arial') + ';font-size:' + (l.size || 24) + 'px;color:' + esc(l.color || '#fff')
          + ';font-weight:' + (l.bold ? '800' : '400') + ';font-style:' + (l.italic ? 'italic' : 'normal') + ';text-align:' + (l.align || 'left')
          + ';align-items:' + (l.align === 'center' ? 'center' : (l.align === 'right' ? 'flex-end' : 'flex-start')) + ';text-shadow:0 2px 8px rgba(0,0,0,.35)';
        inner = '<div class="li ly-text" style="' + st + '">' + esc(l.text || '') + '</div>';
      } else if (l.type === 'image') inner = '<img class="li ly-img ' + (l.fit === 'cover' ? 'cover ' : '') + (l.shape || 'none') + '" src="' + esc(l.src || '') + '" style="width:100%;height:100%">';
      else if (l.type === 'video') {
        var vrad = l.shape === 'circle' ? '50%' : (l.shape === 'rounded' ? '16px' : '0');
        inner = '<video class="li ly-vid" data-vid="' + l.id + '" src="' + esc(l.src || '') + '"' + (l.loop ? ' loop' : '') + (l.muted === false ? '' : ' muted') + ' playsinline preload="auto" style="width:100%;height:100%;object-fit:' + (l.fit === 'cover' ? 'cover' : 'contain') + ';border-radius:' + vrad + '"></video>';
      } else if (l.type === 'ticker') {
        var ts = 'font-family:' + (l.font || 'Arial') + ';font-size:' + (l.size || 28) + 'px;color:' + esc(l.color || '#fff') + ';font-weight:' + (l.bold ? '800' : '600');
        var gap = '&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;';
        inner = '<div class="li ly-ticker" style="width:100%;height:100%;background:' + rgba(l.fill, l.opacity) + ';border-radius:' + (l.radius || 0) + 'px;overflow:hidden;display:flex;align-items:center">' + '<div class="tick-track" style="display:inline-flex;white-space:nowrap;will-change:transform;' + ts + '">' + '<span class="tc">' + esc(l.text || '') + gap + '</span><span class="tc">' + esc(l.text || '') + gap + '</span></div></div>';
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

  function animateOn() {
    eachLi(function (li, l) {
      var h = hidden(l.inAnim || 'fade'), dur = l.inDur == null ? 500 : l.inDur, del = l.inDelay || 0;
      li.style.transition = 'none'; setState(li, h.o, h.t); void li.offsetWidth;
      li.style.transition = 'transform ' + dur + 'ms ' + (h.ease || EASE) + ' ' + del + 'ms, opacity ' + dur + 'ms ease ' + del + 'ms';
      setState(li, 1, 'none');
    });
  }
  function animateOff() {
    eachLi(function (li, l) {
      var h = hidden(l.outAnim || 'fade'), dur = l.outDur == null ? 350 : l.outDur, del = l.outDelay || 0;
      li.style.transition = 'transform ' + dur + 'ms ' + (h.ease || EASE) + ' ' + del + 'ms, opacity ' + dur + 'ms ease ' + del + 'ms';
      setState(li, h.o, h.t);
    });
  }
  function snap(v) { // instant reflect after an edit (no animation)
    eachLi(function (li, l) { li.style.transition = 'none'; if (v) setState(li, 1, 'none'); else { var h = hidden(l.inAnim || 'fade'); setState(li, h.o, h.t); } });
  }

  function applyChroma(c) {
    var col = urlChroma || (c ? (CMAP[c] || c) : '');
    if (col) { document.documentElement.style.setProperty('--chroma', col); document.body.classList.add('chroma'); }
    else document.body.classList.remove('chroma');
  }

  function render(lt) {
    applyChroma(lt.chroma);
    var newSig = JSON.stringify(lt.layers);
    if (newSig !== sig) { sig = newSig; buildLayers(lt.layers || []); snap(visibleNow); }
    if (!!lt.visible !== visibleNow) { visibleNow = !!lt.visible; requestAnimationFrame(function () { if (visibleNow) { animateOn(); playAutoVideos(); } else { animateOff(); pauseVideos(); } }); }
    applyVcmd(lt.vcmd);
  }

  var es = new EventSource('/events');
  es.onmessage = function (e) { try { var m = JSON.parse(e.data); if (m.state && m.state.lowerthird) render(m.state.lowerthird); } catch (x) {} };
})();
