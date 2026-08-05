/* StreamGraphics — Lower Third output renderer. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var card = $('ltCard'), accent = $('ltAccent'), logo = $('ltLogo'),
      l1 = $('ltLine1'), l2 = $('ltLine2'), textBox = card.querySelector('.lt-text');
  var POSITIONS = ['top-left','top-center','top-right','mid-left','mid-center','mid-right','bottom-left','bottom-center','bottom-right'];
  var visibleNow = false, hideTimer = null, urlChroma = null;

  (function () { // ?bg=green forces chroma regardless of the toggle
    var m = new URLSearchParams(location.search).get('bg');
    if (m) { var map = { green: '#00b140', magenta: '#ff00ff', blue: '#0000ff' }; urlChroma = map[m] || m; }
  })();

  function applyChroma(styleChroma) {
    var c = urlChroma || (styleChroma ? ({ green: '#00b140', magenta: '#ff00ff', blue: '#0000ff' }[styleChroma] || styleChroma) : '');
    if (c) { document.documentElement.style.setProperty('--chroma', c); document.body.classList.add('chroma'); }
    else document.body.classList.remove('chroma');
  }

  function setVisible(v) {
    if (v === visibleNow) return;
    visibleNow = v;
    if (v) { if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; } card.classList.remove('is-hidden'); void card.offsetWidth; card.classList.remove('is-out'); }
    else { card.classList.add('is-out'); hideTimer = setTimeout(function () { card.classList.add('is-hidden'); }, 650); }
  }

  function render(lt) {
    l1.textContent = lt.line1 || '';
    l2.textContent = lt.line2 || '';
    if (lt.logoUrl) { logo.src = lt.logoUrl; logo.style.display = 'block'; }
    else logo.style.display = 'none';
    var s = lt.style || {};
    if (s.accent) { accent.style.background = s.accent; accent.style.color = s.accent; l2.style.color = s.accent; }
    if (s.bg) textBox.style.background = s.bg;
    if (s.text) l1.style.color = s.text;
    if (s.size) l1.style.fontSize = s.size + 'px';
    if (s.position && POSITIONS.indexOf(s.position) >= 0) {
      POSITIONS.forEach(function (p) { card.classList.remove('pos-' + p); });
      card.classList.add('pos-' + s.position);
    }
    if (s.animation) card.setAttribute('data-anim', s.animation);
    applyChroma(s.chroma);
    setVisible(!!lt.visible);
  }

  function connect() {
    var es = new EventSource('/events');
    es.onmessage = function (e) { try { var m = JSON.parse(e.data); if (m.state && m.state.lowerthird) render(m.state.lowerthird); } catch (x) {} };
  }
  connect();
})();
