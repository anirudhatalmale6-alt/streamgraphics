/* StreamGraphics Pro — Teleprompter control panel.
 * Sends actions, reflects live state, and puts the transport under the operator's fingers
 * with the key layout prompter operators already have in their hands:
 *   left/right = speed, up/down = jump back/ahead, space = start/stop. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var P = null;
  var clockOffset = 0;
  var typing = false;      // the script box has focus — don't clobber it, don't steal its keys

  function send(a) {
    return fetch('/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(a) }).catch(function () {});
  }
  function serverNow() { return Date.now() + clockOffset; }
  function livePx(p, now) {
    var px = p.basePx + ((p.running && p.speed > 0) ? (now - p.anchorServer) * p.speed / 1000 : 0);
    var max = (p.geom && p.geom.sig) ? Math.max(0, p.geom.total) : -1;
    if (!(px > 0)) return 0;
    return (max >= 0 && px > max) ? max : px;
  }
  function mmss(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    var m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return m + ':' + (s < 10 ? '0' + s : s);
  }

  /* ---- output URLs ----
     Built from SGLinks, not location.host: on the StreamGraphics computer that is localhost,
     and a localhost link pasted into OBS on the OTHER machine points it at itself. */
  SGLinks.onbase(function () {
    $('outUrl').textContent = SGLinks.url('/prompter-output');
    $('outUrlM').textContent = SGLinks.url('/prompter-output?mirror=1');
  });
  $('copyBtn').onclick  = function () { SGLinks.copy(SGLinks.url('/prompter-output'), this); };
  $('copyBtnM').onclick = function () { SGLinks.copy(SGLinks.url('/prompter-output?mirror=1'), this); };

  /* ---- on air ---- */
  $('btnShow').onclick = function () { send({ type: 'pr_show' }); };
  $('btnHide').onclick = function () { send({ type: 'pr_hide' }); };

  /* ---- transport ---- */
  function play()   { send({ type: 'pr_play' }); }
  function pause()  { send({ type: 'pr_pause' }); }
  function toggle() { send({ type: 'pr_toggle' }); }
  function jump(dir, big) { send({ type: 'pr_jump', px: dir * (P && P.jumpPx ? P.jumpPx : 220) * (big ? 4 : 1) }); }
  function nudgeSpeed(d) { send({ type: 'pr_speed', delta: d }); }

  $('btnPlay').onclick   = toggle;
  $('btnBack').onclick   = function () { jump(-1); };
  $('btnAhead').onclick  = function () { jump(1); };
  $('btnTop').onclick    = function () { send({ type: 'pr_top' }); };
  $('btnSlower').onclick = function () { nudgeSpeed(-5); };
  $('btnFaster').onclick = function () { nudgeSpeed(5); };
  $('btnPrevMark').onclick = function () { send({ type: 'pr_mark', cmd: 'prev' }); };
  $('btnNextMark').onclick = function () { send({ type: 'pr_mark', cmd: 'next' }); };

  // Scrub bar — click anywhere to send the read there.
  $('bar').onclick = function (e) {
    if (!P || !P.geom || !P.geom.total) return;
    var r = this.getBoundingClientRect();
    var f = Math.max(0, Math.min(1, (e.clientX - r.left) / (r.width || 1)));
    send({ type: 'pr_goto', px: Math.round(f * P.geom.total) });
  };

  /* ---- keyboard ----
     The layout Mark already drives a prompter with. Deliberately inert while the script box
     (or any other field) has focus, or typing "space" into the script would start the scroll. */
  function isTyping(t) {
    if (!t) return false;
    var tag = (t.tagName || '').toLowerCase();
    return tag === 'textarea' || tag === 'input' || tag === 'select' || t.isContentEditable;
  }
  window.addEventListener('keydown', function (e) {
    if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
    var k = e.key, big = e.shiftKey;
    if (k === ' ' || k === 'Spacebar') { toggle(); }
    else if (k === 'ArrowLeft')  { nudgeSpeed(big ? -20 : -5); }
    else if (k === 'ArrowRight') { nudgeSpeed(big ?  20 :  5); }
    else if (k === 'ArrowUp')    { jump(-1, big); }
    else if (k === 'ArrowDown')  { jump(1, big); }
    else if (k === 'Home')       { send({ type: 'pr_top' }); }
    else if (k === 'PageUp')     { send({ type: 'pr_mark', cmd: 'prev' }); }
    else if (k === 'PageDown')   { send({ type: 'pr_mark', cmd: 'next' }); }
    // 1-9 go straight to a section. Guarded on the bookmark actually existing, so pressing 7
    // on a three-section script does nothing instead of throwing the read to the end.
    else if (k >= '1' && k <= '9') {
      var n = +k - 1, ms = (P && P.geom && P.geom.marks) || [];
      if (n >= ms.length) return;
      send({ type: 'pr_goto', mark: n });
    }
    else return;
    e.preventDefault();
  });

  /* ---- script ----
     Debounced: every keystroke would otherwise rebroadcast the whole script to every
     connected page, and re-measure the layout on each of them. */
  var scriptEl = $('script'), sendTimer = null, localScript = null;
  scriptEl.addEventListener('focus', function () { typing = true; });
  scriptEl.addEventListener('blur',  function () { typing = false; });
  scriptEl.addEventListener('input', function () {
    localScript = scriptEl.value;
    stats(localScript);
    clearTimeout(sendTimer);
    sendTimer = setTimeout(function () { send({ type: 'pr_script', text: scriptEl.value }); }, 400);
  });
  function stats(txt) {
    var words = (String(txt || '').match(/\S+/g) || []).length;
    var marks = SGPrompter.marksOf(txt).length;
    $('scriptStats').textContent = words.toLocaleString() + ' words · ' + marks + ' bookmark' + (marks === 1 ? '' : 's');
  }

  /* ---- edit on screen ----
     The same script, edited in the preview at prompter size instead of in the box below.
     The editing surface is the OUTPUT'S stage — 1920 wide, the configured column width, the
     configured type — scaled by the same factor as the preview iframe. That is what makes it
     worth having: a line that wraps here wraps there, so an edit made mid-show can be judged
     for length on the spot rather than after it reaches the talent. */
  var pvEdit = $('pvEdit'), pvStage = $('pvStage'), pvText = $('pvText'), pvWrap = $('pvWrap'),
      pvCue = $('pvCue'), pvHint = $('pvHint'), btnEditPv = $('btnEditPv'), btnGoCursor = $('btnGoCursor');
  var editing = false, pvTimer = null;

  function pvScale() {
    var k = (pvWrap.clientWidth || 640) / SGPrompter.STAGE_W;
    pvStage.style.transform = 'scale(' + k + ')';
  }
  window.addEventListener('resize', pvScale);

  // Dress the textarea exactly as the output dresses .pr-doc, so the two wrap alike.
  function pvDress(p) {
    var s = (p && p.style) || {};
    pvText.style.width = Math.max(20, Math.min(100, Number(s.width) || 82)) + '%';
    pvText.style.fontFamily = s.font || "'Segoe UI', Arial, sans-serif";
    pvText.style.fontSize = (Number(s.size) || 64) + 'px';
    pvText.style.lineHeight = String(Number(s.lineHeight) || 1.45);
    pvText.style.fontWeight = s.bold ? '700' : '400';
    pvText.style.textAlign = (['left', 'center', 'right'].indexOf(s.align) >= 0 ? s.align : 'left');
    pvText.style.color = s.color || '#ffffff';
    var bg = s.chroma || s.bg || '';
    pvEdit.style.background = bg || '#0a0a0a';   // a transparent key has nothing to type on
    var cp = Math.max(0, Math.min(100, Number(s.cuePos) || 0));
    pvCue.style.top = (cp / 100 * SGPrompter.STAGE_H) + 'px';
    pvCue.style.background = s.cueColor || '#7cc4ff';
  }

  function setEditing(on) {
    editing = on;
    pvEdit.classList.toggle('on', on);
    btnGoCursor.style.display = on ? '' : 'none';
    btnEditPv.textContent = on ? '✔ Done' : '✎ Edit on screen';
    pvHint.textContent = on
      ? 'Click a line to edit it. Changes reach the talent as you type; ## makes a bookmark; Esc closes.'
      : 'Live preview of what the talent sees.';
    if (on && P) {
      pvDress(P);
      pvScale();
      pvText.value = P.script || '';
      /* Open where the read IS, with the current line on the same guide it sits on over on the
         glass — otherwise "edit on screen" would drop the operator at the top of a twenty-minute
         script mid-take.
         🚨 And deliberately WITHOUT focusing. Giving a textarea focus makes the browser scroll
         its caret into view, which threw this straight back to the end of the script; worse, it
         would leave a cursor sitting somewhere the operator can't see while the read is live,
         so the first key pressed edits the wrong line. He clicks the line he means. */
      var cp = Math.max(0, Math.min(100, Number((P.style || {}).cuePos) || 0));
      pvText.scrollTop = Math.max(0, livePx(P, serverNow()) - SGPrompter.STAGE_H * (cp / 100));
    } else {
      pvText.blur();
    }
  }
  btnEditPv.onclick = function () { setEditing(!editing); };

  pvText.addEventListener('keydown', function (e) {
    // Escape leaves the editor. The global key map is deliberately inert while a field has
    // focus, so without this there is no way back to the transport keys but the mouse.
    if (e.key === 'Escape') { e.preventDefault(); setEditing(false); }
  });
  pvText.addEventListener('focus', function () { typing = true; });
  pvText.addEventListener('blur',  function () { typing = false; });
  pvText.addEventListener('input', function () {
    localScript = pvText.value;
    scriptEl.value = pvText.value;      // the box below is the same script, keep it honest
    stats(pvText.value);
    clearTimeout(pvTimer);
    pvTimer = setTimeout(function () { send({ type: 'pr_script', text: pvText.value }); }, 400);
  });

  /* Send the read to wherever the cursor is. Measured, not counted: the text before the
     cursor is laid out through the very same renderer the output uses, and its height IS the
     pixel offset — which is the only way to be right about a line that wraps three times. */
  btnGoCursor.onclick = function () {
    if (!P) return;
    var before = pvText.value.slice(0, pvText.selectionStart);
    var padM = SGPrompter.render($('measDoc'), { script: before, style: P.style });
    var h = SGPrompter.measure($('measDoc'), padM).total;
    // That height reaches the END of the cursor's line; back off one line to land on its start.
    var line = (Number((P.style || {}).size) || 64) * (Number((P.style || {}).lineHeight) || 1.45);
    send({ type: 'pr_goto', px: Math.max(0, Math.round(h - line)) });
  };

  /* ---- look ---- */
  function style(o) { send({ type: 'pr_style', style: o }); }
  $('stFont').onchange   = function () { style({ font: this.value }); };
  $('stSize').oninput    = function () { $('szV').textContent = this.value; style({ size: +this.value }); };
  $('stLH').oninput      = function () { $('lhV').textContent = (+this.value).toFixed(2); style({ lineHeight: +this.value }); };
  $('stW').oninput       = function () { $('wV').textContent = this.value; style({ width: +this.value }); };
  $('stAlign').onchange  = function () { style({ align: this.value }); };
  $('stBold').onchange   = function () { style({ bold: this.checked }); };
  $('stColor').oninput   = function () { style({ color: this.value }); };
  $('stCue').onchange    = function () { style({ cue: this.value }); };
  $('stCueColor').oninput = function () { style({ cueColor: this.value }); };
  $('stCuePos').oninput  = function () { $('cpV').textContent = this.value; style({ cuePos: +this.value }); };
  $('stMarks').onchange  = function () { style({ showMarks: this.checked }); };
  $('stMarkColor').oninput = function () { style({ markColor: this.value }); };
  $('stFade').onchange   = function () { style({ fade: this.checked }); };
  $('stChroma').onchange = function () { style({ chroma: this.value }); };
  // Transparent and the background colour are one control in two parts: unticking Transparent
  // has to put a colour BACK, or the picker would look live while doing nothing.
  $('stBg').oninput      = function () { $('stTransparent').checked = false; style({ bg: this.value }); };
  $('stTransparent').onchange = function () { style({ bg: this.checked ? '' : ($('stBg').value || '#0a0a0a') }); };
  $('stJump').onchange   = function () { send({ type: 'pr_jumpsize', px: parseInt(this.value, 10) || 220 }); };

  /* ---- bookmarks ---- */
  var marksKey = '';
  function renderMarks(p) {
    var marks = (p.geom && p.geom.marks) || [];
    var key = marks.map(function (m) { return m.name + '@' + m.y; }).join('|');
    if (key === marksKey) return;
    marksKey = key;
    var box = $('marks');
    if (!marks.length) {
      box.innerHTML = '<span class="nomarks">Start any line in the script with ## and it becomes a bookmark button here.</span>';
      return;
    }
    box.innerHTML = '';
    marks.forEach(function (m, i) {
      var b = document.createElement('button');
      b.className = 'mkbtn';
      // The first nine carry their shortcut number; past that there is no key to show, and a
      // badge with nothing behind it would be a lie.
      if (i < 9) {
        var n = document.createElement('b'); n.textContent = String(i + 1); b.appendChild(n);
      }
      var t = document.createElement('span'); t.className = 't'; t.textContent = m.name;
      b.appendChild(t);
      b.title = i < 9 ? 'Jump to "' + m.name + '"  (press ' + (i + 1) + ')' : 'Jump to "' + m.name + '"';
      b.dataset.y = m.y;
      b.onclick = function () { send({ type: 'pr_goto', mark: i }); };
      box.appendChild(b);
    });
  }
  function highlightMark(px) {
    var btns = $('marks').querySelectorAll('.mkbtn');
    var at = -1;
    for (var i = 0; i < btns.length; i++) if (px >= (+btns[i].dataset.y) - 4) at = i;
    for (var j = 0; j < btns.length; j++) btns[j].classList.toggle('at', j === at);
  }

  /* ---- reflect state ---- */
  function setVal(el, v) { if (el && document.activeElement !== el) el.value = v; }
  function render(p) {
    var s = p.style || {};
    $('airState').textContent = p.visible ? 'ON AIR' : 'OFF AIR';
    $('airState').className = 'airstate' + (p.visible ? ' live' : '');
    $('btnPlay').classList.toggle('on', !!p.running);
    $('btnPlay').firstChild.nodeValue = p.running ? 'Pause' : 'Play';
    $('spdV').textContent = p.speed;

    // The script box is only refilled when this panel isn't the one editing it — otherwise a
    // broadcast triggered by our own debounced save would yank the cursor to the end.
    if (!typing && scriptEl.value !== p.script && localScript !== p.script) { scriptEl.value = p.script || ''; localScript = null; stats(p.script); }
    if (localScript === p.script) localScript = null;
    if (!typing && scriptEl.value === p.script) stats(p.script);

    // The on-screen editor follows the look live, and takes new text only when it isn't the
    // one being typed into — same rule as the box below, for the same reason.
    if (editing) {
      pvDress(p);
      if (document.activeElement !== pvText && pvText.value !== p.script) pvText.value = p.script || '';
    }

    setVal($('stFont'), s.font);
    setVal($('stSize'), s.size); $('szV').textContent = s.size;
    setVal($('stLH'), s.lineHeight); $('lhV').textContent = Number(s.lineHeight).toFixed(2);
    setVal($('stW'), s.width); $('wV').textContent = s.width;
    setVal($('stAlign'), s.align);
    $('stBold').checked = !!s.bold;
    if (document.activeElement !== $('stColor')) $('stColor').value = s.color || '#ffffff';
    if (document.activeElement !== $('stBg')) $('stBg').value = s.bg || '#0a0a0a';
    $('stTransparent').checked = !s.bg;
    setVal($('stChroma'), s.chroma || '');
    setVal($('stCue'), s.cue || 'both');
    if (document.activeElement !== $('stCueColor')) $('stCueColor').value = s.cueColor || '#e03131';
    setVal($('stCuePos'), s.cuePos); $('cpV').textContent = s.cuePos;
    $('stMarks').checked = !!s.showMarks;
    if (document.activeElement !== $('stMarkColor')) $('stMarkColor').value = s.markColor || '#f4a63c';
    $('stFade').checked = !!s.fade;
    setVal($('stJump'), p.jumpPx);

    renderMarks(p);
  }

  /* ---- 60fps readouts (position, time left, marks) ---- */
  function tick() {
    if (P) {
      var total = (P.geom && P.geom.total) || 0;
      var px = livePx(P, serverNow());
      var f = total ? Math.max(0, Math.min(1, px / total)) : 0;
      $('barFill').style.width = (f * 100).toFixed(2) + '%';
      if (total && P.speed > 0) {
        $('posTxt').textContent = mmss(px / P.speed);
        $('leftTxt').textContent = '−' + mmss((total - px) / P.speed);
      } else {
        $('posTxt').textContent = total ? Math.round(f * 100) + '%' : '—';
        $('leftTxt').textContent = P.speed > 0 ? '–:––' : 'paused (speed 0)';
      }
      // Approximate reading rate — the number an operator actually thinks in.
      var words = (String(P.script || '').match(/\S+/g) || []).length;
      $('wpmTxt').textContent = (total && P.speed > 0 && words)
        ? '≈ ' + Math.round(words / ((total / P.speed) / 60)) + ' wpm'
        : '';
      highlightMark(px);
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  /* ---- connect ---- */
  var conn = $('conn'), connTxt = $('connTxt');
  var es = SGLive('/events');
  es.onopen  = function () { conn.classList.add('ok'); connTxt.textContent = 'live'; };
  es.onerror = function () { conn.classList.remove('ok'); connTxt.textContent = 'reconnecting…'; };
  es.onmessage = function (e) {
    try {
      var msg = JSON.parse(e.data);
      var measured = msg.serverTime - Date.now();
      clockOffset = clockOffset === 0 ? measured : Math.round(clockOffset * 0.7 + measured * 0.3);
      if (msg.state && msg.state.prompter) { P = msg.state.prompter; render(P); }
    } catch (err) {}
  };

  // expose for tests
  window.__sgpc = {
    get state() { return P; },
    get editing() { return editing; },
    setEditing: setEditing,
    livePx: livePx
  };
})();
