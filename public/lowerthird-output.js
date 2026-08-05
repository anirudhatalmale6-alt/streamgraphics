/* StreamGraphics — Lower Third BUILDER output. Renders a stack of layers on a
 * 1920x1080 canvas and plays each layer's own in/out animation (staggered by delay).
 * Editing layers re-renders instantly (no re-animate); only take-to-air / off-air animate. */
(function () {
  'use strict';
  var stage = document.getElementById('stage');
  var visibleNow = false, sig = '';
  var CMAP = { green: '#00b140', magenta: '#ff00ff', blue: '#0000ff' };
  var urlChroma = (function () { var m = new URLSearchParams(location.search).get('bg'); return m ? (CMAP[m] || m) : null; })();

  function scaleStage() { var s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080); stage.style.transform = 'scale(' + s + ')'; }
  window.addEventListener('resize', scaleStage); scaleStage();

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }
  function rgba(hex, pct) {
    hex = String(hex || '#000').replace(/^#/, '');
    if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    var r = parseInt(hex.slice(0, 2), 16) || 0, g = parseInt(hex.slice(2, 4), 16) || 0, b = parseInt(hex.slice(4, 6), 16) || 0;
    return 'rgba(' + r + ',' + g + ',' + b + ',' + (pct == null ? 1 : pct / 100) + ')';
  }

  function buildLayers(layers) {
    layers = layers.slice().sort(function (a, b) { return (a.z || 0) - (b.z || 0); });
    var html = '';
    layers.forEach(function (l) {
      var box = 'left:' + (l.x || 0) + 'px;top:' + (l.y || 0) + 'px;width:' + (l.w || 0) + 'px;height:' + (l.h || 0) + 'px;z-index:' + (l.z || 0) + ';';
      var inner = '';
      if (l.type === 'box') {
        inner = '<div class="li ly-box out" style="width:100%;height:100%;background:' + rgba(l.fill, l.opacity) + ';border-radius:' + (l.radius || 0) + 'px"></div>';
      } else if (l.type === 'text') {
        var st = 'font-family:' + (l.font || 'Arial') + ';font-size:' + (l.size || 24) + 'px;color:' + esc(l.color || '#fff')
               + ';font-weight:' + (l.bold ? '800' : '400') + ';font-style:' + (l.italic ? 'italic' : 'normal')
               + ';text-align:' + (l.align || 'left')
               + ';align-items:' + (l.align === 'center' ? 'center' : (l.align === 'right' ? 'flex-end' : 'flex-start'))
               + ';text-shadow:0 2px 8px rgba(0,0,0,.35)';
        inner = '<div class="li ly-text out" style="' + st + '">' + esc(l.text || '') + '</div>';
      } else if (l.type === 'image') {
        var cls = 'li ly-img out ' + (l.fit === 'cover' ? 'cover ' : '') + (l.shape || 'none');
        inner = '<img class="' + cls + '" src="' + esc(l.src || '') + '" style="width:100%;height:100%">';
      }
      html += '<div class="ly" data-anim="' + esc(l.animIn || 'fade') + '" data-delay="' + (l.delay || 0) + '" style="' + box + '">' + inner + '</div>';
    });
    stage.innerHTML = html;
  }

  function snap(v) { // instant, no animation (used after an edit)
    var lis = stage.querySelectorAll('.li');
    lis.forEach(function (li) { li.style.transition = 'none'; li.style.transitionDelay = '0ms'; li.classList.toggle('out', !v); });
    void stage.offsetWidth;
    lis.forEach(function (li) { li.style.transition = ''; });
  }
  function animateTo(v) {
    stage.querySelectorAll('.ly').forEach(function (ly) {
      var li = ly.querySelector('.li'); if (!li) return;
      if (v) { li.style.transitionDelay = (ly.getAttribute('data-delay') || 0) + 'ms'; li.classList.remove('out'); }
      else { li.style.transitionDelay = '0ms'; li.classList.add('out'); }
    });
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
    if (!!lt.visible !== visibleNow) { visibleNow = !!lt.visible; requestAnimationFrame(function () { animateTo(visibleNow); }); }
  }

  var es = new EventSource('/events');
  es.onmessage = function (e) { try { var m = JSON.parse(e.data); if (m.state && m.state.lowerthird) render(m.state.lowerthird); } catch (x) {} };
})();
