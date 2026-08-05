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
  function hidden(type) {
    switch (type) {
      case 'slide-up': return { o: 0, t: 'translateY(46px)' };
      case 'slide-down': return { o: 0, t: 'translateY(-46px)' };
      case 'slide-left': return { o: 0, t: 'translateX(-60px)' };
      case 'slide-right': return { o: 0, t: 'translateX(60px)' };
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
      html += '<div class="ly" data-id="' + l.id + '" style="' + box + '">' + inner + '</div>';
    });
    stage.innerHTML = html;
  }

  function eachLi(fn) { stage.querySelectorAll('.ly').forEach(function (ly) { var li = ly.querySelector('.li'); var l = LMAP[ly.dataset.id]; if (li && l) fn(li, l); }); }

  function animateOn() {
    eachLi(function (li, l) {
      var h = hidden(l.inAnim || 'fade'), dur = l.inDur == null ? 500 : l.inDur, del = l.inDelay || 0;
      li.style.transition = 'none'; setState(li, h.o, h.t); void li.offsetWidth;
      li.style.transition = 'transform ' + dur + 'ms ' + EASE + ' ' + del + 'ms, opacity ' + dur + 'ms ease ' + del + 'ms';
      setState(li, 1, 'none');
    });
  }
  function animateOff() {
    eachLi(function (li, l) {
      var h = hidden(l.outAnim || 'fade'), dur = l.outDur == null ? 350 : l.outDur, del = l.outDelay || 0;
      li.style.transition = 'transform ' + dur + 'ms ' + EASE + ' ' + del + 'ms, opacity ' + dur + 'ms ease ' + del + 'ms';
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
    if (!!lt.visible !== visibleNow) { visibleNow = !!lt.visible; requestAnimationFrame(function () { visibleNow ? animateOn() : animateOff(); }); }
  }

  var es = new EventSource('/events');
  es.onmessage = function (e) { try { var m = JSON.parse(e.data); if (m.state && m.state.lowerthird) render(m.state.lowerthird); } catch (x) {} };
})();
