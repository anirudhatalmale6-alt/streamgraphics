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

  /* 🚨 The phone remote's address is the one that CANNOT be localhost — the whole point is a
     second device — yet the nav link was a plain relative href, so clicking it here opened
     localhost and reading it off the screen gave the operator an address that sends the phone
     to itself. phoneLink() points the link, the text and the QR at the reachable address. */
  SGLinks.phoneLink({
    path: '/prompter-remote',
    link: $('navRemote'),
    out:  $('outUrlR'),
    copy: $('copyBtnR'),
    qr:   $('qrBtnR'),
    box:  $('qrBoxR')
  });

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

  /* ---- open a document as the script ----
     The file is posted to the app, which does the reading. A .docx is a zip and a .rtf is a
     control-word stream; Node has had the tools for both since forever, whereas doing it here
     would rest on DecompressionStream — a much younger API than the browser that happens to
     be on a studio PC. */
  var docFile = $('docFile'), docMsg = $('docMsg'), dropzone = $('dropzone'), dropVeil = $('dropVeil');

  function docSay(text, good) {
    docMsg.textContent = text;
    docMsg.className = 'mini ' + (good ? 'ok' : 'bad');
    docMsg.style.display = '';
  }

  function importFile(f) {
    if (!f) return;
    // Say no here rather than after pushing twelve megabytes across the room's Wi-Fi.
    if (f.size > 12 * 1024 * 1024) { docSay(f.name + ' is too big — the limit is 12 MB.', false); return; }
    // Replacing a script that is on air is not something to do on a stray drag.
    var cur = (P && P.script) || '';
    if (cur.trim() && !window.confirm('Replace the script that is loaded with "' + f.name + '"?')) return;
    docSay('Reading ' + f.name + '…', true);
    fetch('/prompter/import?name=' + encodeURIComponent(f.name), { method: 'POST', body: f })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j || !j.ok) { docSay(f.name + ': ' + ((j && j.error) || 'could not be read'), false); return; }
        scriptEl.value = j.text;
        localScript = j.text;
        if (editing) pvText.value = j.text;
        stats(j.text);
        send({ type: 'pr_script', text: j.text });
        var marks = SGPrompter.marksOf(j.text).length;
        docSay('Loaded ' + f.name + ' — ' + j.words.toLocaleString() + ' words, ' +
               marks + ' bookmark' + (marks === 1 ? '' : 's') +
               (marks ? '.' : '. Start a line with ## to add one.'), true);
      })
      .catch(function () { docSay('Could not reach the app to read that file.', false); });
  }

  $('btnOpenDoc').onclick = function () { docFile.value = ''; docFile.click(); };
  docFile.onchange = function () { importFile(this.files && this.files[0]); };

  // Drag a document straight onto the script box.
  ['dragenter', 'dragover'].forEach(function (ev) {
    dropzone.addEventListener(ev, function (e) { e.preventDefault(); dropzone.classList.add('over'); });
  });
  ['dragleave', 'dragend'].forEach(function (ev) {
    // 🚨 relatedTarget, not a plain remove: dragging ACROSS the textarea inside the zone fires
    // dragleave on the child, and the veil would flicker off under the operator's cursor.
    dropzone.addEventListener(ev, function (e) {
      if (!e.relatedTarget || !dropzone.contains(e.relatedTarget)) dropzone.classList.remove('over');
    });
  });
  dropzone.addEventListener('drop', function (e) {
    e.preventDefault();
    dropzone.classList.remove('over');
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) importFile(f);
  });

  /* ---- Word, arriving by the other two routes ----
   *
   * 🚨 The importer is not the only way a script gets in here. Most of the time it is pasted,
   * and a paste out of Word carries the same fault the importer had: every paragraph arrives
   * as a plain line break with no blank line between, so the "Paragraph gap" slider has
   * nothing to stretch and appears to do nothing at all.
   *
   * Word puts a full HTML copy on the clipboard alongside the plain text, and THAT still knows
   * what a paragraph is. So when the plain text has no paragraph spacing in it but the HTML
   * does, the HTML is used. Anything else — a plain-text paste, a paste that already has blank
   * lines in it, a paste this yields nothing better for — is left exactly alone. */
  var BLOCK = /^(P|DIV|H1|H2|H3|H4|H5|H6|LI|TR|BLOCKQUOTE|PRE|SECTION|ARTICLE|ADDRESS)$/;
  /* Markers. Control characters on purpose: neither can occur in text a person pasted,
     so splitting on them cannot cut a script in half. Written as escapes so this file
     itself stays plain ASCII - the installer build refuses stray control bytes. */
  var PARA = '\u0000', HEAD = '\u0001';

  function walkHtml(node, out) {
    if (node.nodeType === 3) { out.push(String(node.nodeValue).replace(/\s+/g, ' ')); return; }
    if (node.nodeType !== 1) return;
    var tag = String(node.nodeName || '').toUpperCase();
    if (tag === 'BR') { out.push('\n'); return; }     // Shift+Enter: a line break, not a paragraph
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return;
    var block = BLOCK.test(tag);
    // Word writes headings as <p class=MsoHeading1>, not as <h1>, when it exports HTML.
    var head = /^H[1-4]$/.test(tag) || /Mso(Title|Subtitle|Heading[1-4])/i.test(node.className || '');
    if (block) out.push(PARA);
    if (head) out.push(HEAD);
    for (var c = node.firstChild; c; c = c.nextSibling) walkHtml(c, out);
    if (block) out.push(PARA);
  }

  function htmlToScript(html) {
    var d;
    try { d = new DOMParser().parseFromString(String(html), 'text/html'); } catch (e) { return ''; }
    if (!d || !d.body) return '';
    var out = [];
    walkHtml(d.body, out);
    return out.join('').split(PARA).map(function (chunk) {
      var heading = chunk.indexOf(HEAD) >= 0;
      var t = chunk.split(HEAD).join('').replace(/\u00a0/g, ' ');
      if (heading) t = t.replace(/\s+/g, ' ');       // a bookmark name is one line by definition
      t = t.replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').replace(/^[ \t]+|[ \t]+$/g, '');
      if (heading && t && !/^\s*##/.test(t)) t = '## ' + t;
      return t;
    }).filter(function (t) {
      /* Every block pushes a marker on the way in AND on the way out, so nesting leaves empty
         chunks between the real ones. They carry nothing: the blank line between paragraphs
         comes from the join below, not from these. */
      return t !== '';
    }).join('\n\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '').replace(/\s+$/, '');
  }

  /* Put text in without destroying the undo history — a paste the operator cannot Ctrl+Z is
     worse than the fault this fixes. execCommand is deprecated and still the only way to do it
     in a textarea; the manual splice is there for the day it is removed. */
  function insertText(el, text) {
    el.focus();
    var done = false;
    try { done = document.execCommand('insertText', false, text); } catch (e) { done = false; }
    if (!done) {
      var a = el.selectionStart, b = el.selectionEnd;
      el.value = el.value.slice(0, a) + text + el.value.slice(b);
      el.selectionStart = el.selectionEnd = a + text.length;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function onPaste(e) {
    var cb = e.clipboardData || window.clipboardData;
    if (!cb || !cb.getData) return;
    var html = '';
    try { html = cb.getData('text/html') || ''; } catch (err) { html = ''; }
    if (!html) return;                                  // plain text: nothing to improve
    var plain = '';
    try { plain = cb.getData('text/plain') || ''; } catch (err) { plain = ''; }
    if (/\n[ \t]*\n/.test(plain)) return;               // already has paragraph spacing — hands off
    var text = htmlToScript(html);
    if (!text || text.indexOf('\n\n') < 0) return;      // no paragraphs found: leave the browser to it
    e.preventDefault();
    insertText(e.target, text);
    docSay('Pasted from Word — ' + (text.split(/\n[ \t]*\n/).length) +
           ' paragraphs, with the blank lines the Paragraph gap slider needs.', true);
  }
  scriptEl.addEventListener('paste', onPaste);
  pvText.addEventListener('paste', onPaste);

  /* ---- and for the scripts that are already in here ----
     The two fixes above only help the next document. This one repairs the script on screen,
     so nothing has to be imported again. Idempotent on purpose: a paragraph that already has
     a gap after it is not given a second one, so pressing it twice changes nothing. */
  function spaceOutParagraphs(t) {
    var lines = String(t == null ? '' : t).replace(/\r\n|\r/g, '\n').split('\n'), out = [], added = 0;
    for (var i = 0; i < lines.length; i++) {
      out.push(lines[i]);
      if (i + 1 < lines.length && lines[i].trim() && lines[i + 1].trim()) { out.push(''); added++; }
    }
    return { text: out.join('\n'), added: added };
  }

  $('btnSpaceOut').onclick = function () {
    var cur = scriptEl.value;
    if (!cur.trim()) { docSay('There is no script to space out yet.', false); return; }
    var r = spaceOutParagraphs(cur);
    if (!r.added) { docSay('Every paragraph already has a blank line after it — nothing to change.', true); return; }
    var el = (editing ? pvText : scriptEl);
    el.focus();
    el.setSelectionRange(0, el.value.length);
    insertText(el, r.text);                    // replaces the lot, and Ctrl+Z still puts it back
    scriptEl.value = r.text; pvText.value = r.text;
    localScript = r.text;
    stats(r.text);
    send({ type: 'pr_script', text: r.text });
    docSay('Added a blank line after ' + r.added + ' paragraph' + (r.added === 1 ? '' : 's') +
           '. The Paragraph gap slider now has something to stretch — Ctrl+Z undoes it.', true);
  };

  /* ---- put the output on a monitor ----
     Uses the Window Management API, which needs a secure context — on the StreamGraphics PC
     itself http://localhost counts as one, which is exactly where this is used. From a tablet
     across the network it does not, and could not anyway: no browser can place a window on a
     different computer's monitor. The fallback says so instead of failing quietly. */
  var screenPick = $('screenPick'), screenHint = $('screenHint');
  var screens = [], SKEY = 'sg.prompter.screen';

  function canPlace() { return typeof window.getScreenDetails === 'function' && window.isSecureContext; }

  /* 🚨 Sending the output to a monitor used to be a one-way trip: the window handle lived in a
     local var that vanished when the function returned, so nothing could ever close it again.
     The operator's only way out was to find the window and close it by hand — and a prompter
     output is a black full-screen window with no title bar showing, which is exactly the thing
     you cannot find in a hurry. So: keep the handles, and offer to close them.

     OPEN_KEY survives a reload of THIS page. That matters — reloading the control page during a
     show is normal, and before this the handles were lost and the window was orphaned again. */
  var sentWins = {}, OPEN_KEY = 'sg.prompter.sent';

  function openNames() {
    try { return JSON.parse(localStorage.getItem(OPEN_KEY) || '[]') || []; } catch (e) { return []; }
  }
  function rememberOpen(name, yes) {
    var list = openNames().filter(function (n) { return n !== name; });
    if (yes) list.push(name);
    try { localStorage.setItem(OPEN_KEY, JSON.stringify(list)); } catch (e) {}
  }
  function liveCount() {
    var n = 0;
    Object.keys(sentWins).forEach(function (k) {
      var w = sentWins[k];
      // A window the operator closed by hand must not keep the button lit.
      if (!w || w.closed) { delete sentWins[k]; rememberOpen(k, false); } else n++;
    });
    return n;
  }
  function refreshCloseBtn() {
    // Either we hold a live handle, or a previous page-load left one behind that we can reclaim.
    var show = liveCount() > 0 || openNames().length > 0;
    $('btnCloseSent').style.display = show ? '' : 'none';
  }

  function closeSent() {
    var names = {}, k;
    for (k in sentWins) names[k] = 1;
    openNames().forEach(function (n) { names[n] = 1; });
    Object.keys(names).forEach(function (name) {
      var w = sentWins[name];
      /* No live handle — this page was reloaded since sending. Re-opening by NAME with an empty
         url hands back the existing window without navigating it, so we can close it. If no such
         window exists we get a blank one instead, which we close on the same line. */
      if (!w || w.closed) { try { w = window.open('', name); } catch (e) { w = null; } }
      if (w) { try { w.close(); } catch (e) {} }
      delete sentWins[name];
      rememberOpen(name, false);
    });
    screenHint.textContent = 'Prompter window closed. The monitor is yours again.';
    refreshCloseBtn();
  }

  function openOn(mirrored) {
    var i = Math.max(0, Math.min(screens.length - 1, +screenPick.value || 0));
    var s = screens[i];
    // Both: the name is what survives a monitor being unplugged, the index is the fallback
    // for a screen whose name the browser would not tell us.
    try {
      localStorage.setItem(SKEY, String(i));
      localStorage.setItem(SKEY + '.name', s ? s.label : '');
    } catch (e) {}
    var url = SGLinks.url('/prompter-output?fs=1' + (mirrored ? '&mirror=1' : ''));
    var feat = s
      ? 'popup=yes,left=' + s.left + ',top=' + s.top + ',width=' + s.width + ',height=' + s.height
      : 'popup=yes';
    // A distinct name per output, so re-sending replaces that window rather than piling up.
    var name = 'sgprompter-' + (mirrored ? 'mirror' : 'normal');
    var w = window.open(url, name, feat);
    if (!w) { screenHint.textContent = 'Your browser blocked that pop-up. Allow pop-ups for this address and try again.'; return; }
    sentWins[name] = w;
    rememberOpen(name, true);
    // Chrome sizes a re-used window to its old bounds, so say it again once it is there.
    if (s) { try { w.moveTo(s.left, s.top); w.resizeTo(s.width, s.height); } catch (e) {} }
    try { w.focus(); } catch (e) {}
    screenHint.textContent = 'Sent to ' + (s ? s.label : 'a new window') +
      '. If it is not full screen, click the window once and press F11.';
    refreshCloseBtn();
  }

  /* ---- collapsible panels ----
     🚨 Mark's actual complaint: "How it looks" sits underneath the two tallest panels on the
     page, so reaching the formatting controls means scrolling past a full script editor and the
     saved-script list every time. Folding a panel away is the fix; remembering the choice is
     what makes it worth doing, because otherwise he refolds them every session.

     Done in script rather than markup so every panel with a heading gets it, including any
     added later — there is no list here to forget to update. */
  var FOLD_KEY = 'sg.prompter.folded';

  function foldedSet() {
    try { return JSON.parse(localStorage.getItem(FOLD_KEY) || '[]') || []; } catch (e) { return []; }
  }
  function rememberFold(key, folded) {
    var list = foldedSet().filter(function (k) { return k !== key; });
    if (folded) list.push(key);
    try { localStorage.setItem(FOLD_KEY, JSON.stringify(list)); } catch (e) {}
  }

  (function setUpFolding() {
    var open = foldedSet();
    var panels = document.querySelectorAll('section.panel');
    Array.prototype.forEach.call(panels, function (panel) {
      // Direct child only, and without :scope — this has to work in whatever browser the
      // operator happens to have open, not just the one I test in.
      var h = null;
      for (var i = 0; i < panel.children.length; i++) {
        if (panel.children[i].tagName === 'H3') { h = panel.children[i]; break; }
      }
      if (!h) return;                       // the preview panel has no heading — leave it alone
      var key = (h.textContent || '').trim();
      if (!key) return;

      // Everything after the heading becomes the body, so one class can hide it.
      var body = document.createElement('div');
      body.className = 'panelbody';
      while (h.nextSibling) body.appendChild(h.nextSibling);
      panel.appendChild(body);

      h.classList.add('fold');
      // 🚨 Store the key rather than re-deriving it later: the caret and "(hidden)" spans below
      // become part of h3.textContent, so reading the name back out would give a DIFFERENT
      // string and quietly write a second entry that never matches on reload.
      h.setAttribute('data-fold', key);
      var car = document.createElement('span');
      car.className = 'car';
      car.textContent = '▼';
      h.insertBefore(car, h.firstChild);
      var tag = document.createElement('span');
      tag.className = 'folded';
      tag.textContent = '(hidden)';
      h.appendChild(tag);

      if (open.indexOf(key) >= 0) panel.classList.add('collapsed');

      h.addEventListener('click', function () {
        var nowFolded = panel.classList.toggle('collapsed');
        rememberFold(key, nowFolded);
        syncFoldAll();
      });
    });
    syncFoldAll();
  })();

  function syncFoldAll() {
    var b = $('btnFoldAll');
    if (!b) return;
    var panels = document.querySelectorAll('section.panel > h3.fold');
    var folded = document.querySelectorAll('section.panel.collapsed > h3.fold');
    b.textContent = (panels.length && folded.length >= panels.length) ? 'Expand all' : 'Collapse all';
  }

  if ($('btnFoldAll')) {
    $('btnFoldAll').onclick = function () {
      var expandAll = $('btnFoldAll').textContent === 'Expand all';
      Array.prototype.forEach.call(document.querySelectorAll('section.panel > h3.fold'), function (h) {
        var panel = h.parentNode, key = h.getAttribute('data-fold') || '';
        panel.classList.toggle('collapsed', !expandAll);
        rememberFold(key, !expandAll);
      });
      syncFoldAll();
    };
  }

  /* ---- the SCRIPT LIBRARY ----
     The prompter holds one live script. This is the drawer everything else lives in.

     🚨 The whole point is that nothing here can lose work by accident, so loading over an
     unsaved script always asks first. Built with DOM nodes rather than innerHTML because
     script names are free text the operator types. */
  var libItems = [];

  function libDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d)) return '';
    var today = new Date();
    var sameDay = d.toDateString() === today.toDateString();
    return sameDay
      ? 'today ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
      : d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
  }

  // Is there work on air that isn't in the library? Drives the "are you sure" on load.
  function liveIsUnsaved() {
    if (!P) return false;
    if (P.libId) return !!P.libDirty;
    return !!(P.script || '').trim();
  }

  function renderLib(list, p) {
    libItems = list || [];
    var wrap = $('libList');
    wrap.innerHTML = '';
    $('libEmpty').style.display = libItems.length ? 'none' : '';

    libItems.forEach(function (it) {
      var live = p && p.libId === it.id;
      var row = document.createElement('div');
      row.className = 'librow' + (live ? ' on' : '');
      row.setAttribute('data-id', it.id);

      var box = document.createElement('div');
      var nm = document.createElement('div');
      nm.className = 'nm';
      nm.textContent = it.name;
      box.appendChild(nm);

      var meta = document.createElement('div');
      meta.className = 'meta';
      var bits = [it.words + (it.words === 1 ? ' word' : ' words')];
      if (libDate(it.updated)) bits.push('saved ' + libDate(it.updated));
      meta.textContent = bits.join(' · ');
      box.appendChild(meta);
      row.appendChild(box);

      if (live) {
        var tag = document.createElement('span');
        tag.className = p.libDirty ? 'dirty' : 'live';
        tag.textContent = p.libDirty ? 'on air · edited' : 'on air';
        row.appendChild(tag);
      }

      var sp = document.createElement('span');
      sp.className = 'sp';
      row.appendChild(sp);

      function btn(label, cls, fn) {
        var b = document.createElement('button');
        b.textContent = label;
        if (cls) b.className = cls;
        b.onclick = fn;
        row.appendChild(b);
        return b;
      }

      btn('Load', 'load', function () {
        if (liveIsUnsaved()) {
          var what = P.libId
            ? 'The script on air has been edited since it was saved.'
            : 'The script on air has never been saved.';
          if (!confirm(what + '\n\nLoading "' + it.name + '" will replace it.\n\nLoad anyway?')) return;
        }
        send({ type: 'pr_lib_load', id: it.id });
      });

      btn('Rename', '', function () {
        var n = prompt('Rename this script:', it.name);
        if (n == null) return;
        n = n.trim();
        if (n) send({ type: 'pr_lib_rename', id: it.id, name: n });
      });

      btn('Duplicate', '', function () { send({ type: 'pr_lib_dup', id: it.id }); });

      /* 🚨 Export matters more than it looks. Without it a prepared script only exists inside
         one installation of the app — no copy to email a presenter, nothing to keep when the
         machine is replaced. Plain .txt with the ## headings intact, so what comes out is
         exactly what goes back in. */
      btn('Export', '', function () {
        var a = document.createElement('a');
        a.href = '/prompter/script?id=' + encodeURIComponent(it.id);
        a.download = '';                    // the server names it; this just forces a download
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      });

      btn('Delete', '', function () {
        // Naming it in the prompt: "are you sure?" on the wrong row is how scripts vanish.
        if (!confirm('Delete "' + it.name + '" from the library?\n\nThis cannot be undone. '
          + 'Anything currently on air stays on air.')) return;
        send({ type: 'pr_lib_delete', id: it.id });
      });

      wrap.appendChild(row);
    });

    // What is loaded right now, said in words above the list.
    var now = $('libNow');
    if (p && p.libId && p.libName) {
      now.textContent = p.libDirty
        ? 'On air: "' + p.libName + '" — edited since saving. Save to keep the changes.'
        : 'On air: "' + p.libName + '" — saved.';
    } else if (p && (p.script || '').trim()) {
      now.textContent = 'The script on air is not saved anywhere yet.';
    } else {
      now.textContent = '';
    }
    $('btnLibSave').textContent = (p && p.libId) ? '💾 Save changes' : '💾 Save this script';
  }

  function suggestedName() {
    var first = (scriptEl.value || '').split('\n').find(function (l) { return l.trim(); });
    return (first || '').replace(/^#+\s*/, '').trim().slice(0, 60) || 'Untitled script';
  }

  $('btnLibSave').onclick = function () {
    // Loaded from the library → this is an overwrite of that entry, no question asked.
    if (P && P.libId) { send({ type: 'pr_lib_save', id: P.libId, text: scriptEl.value }); return; }
    var n = prompt('Save this script as:', suggestedName());
    if (n == null) return;
    send({ type: 'pr_lib_save', name: n.trim(), text: scriptEl.value });
  };

  $('btnLibSaveAs').onclick = function () {
    var n = prompt('Save as a new script called:', suggestedName());
    if (n == null) return;
    // No id, so the server makes a new entry rather than overwriting the loaded one.
    send({ type: 'pr_lib_save', name: n.trim(), text: scriptEl.value });
  };

  /* Put a document straight into the library WITHOUT touching what is on air. The existing
     "Open a document" button loads into the prompter, which is right when you are about to read
     it and wrong when you are preparing next week's. Both now exist, and they are separate. */
  $('btnLibAddDoc').onclick = function () { $('libFile').value = ''; $('libFile').click(); };
  $('libFile').onchange = function () {
    var f = this.files && this.files[0];
    if (!f) return;
    $('libNow').textContent = 'Reading ' + f.name + '…';
    fetch('/prompter/import?name=' + encodeURIComponent(f.name), { method: 'POST', body: f })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j || !j.ok) { $('libNow').textContent = f.name + ': ' + ((j && j.error) || 'could not be read'); return; }
        // Name it after the file, minus the extension — that is what the operator called it.
        var nm = f.name.replace(/\.[^.]+$/, '');
        send({ type: 'pr_lib_save', name: nm, text: j.text });
        $('libNow').textContent = 'Added "' + nm + '" — ' + j.words.toLocaleString() + ' words.';
      })
      .catch(function () { $('libNow').textContent = 'Could not reach the app to read that file.'; });
  };

  $('btnCloseSent').onclick = closeSent;
  // Catches the operator closing the output by hand, so the button does not lie.
  setInterval(refreshCloseBtn, 1000);
  refreshCloseBtn();

  function fillScreens(list) {
    var before = screens.length;
    screens = list;
    screenPick.innerHTML = '';
    list.forEach(function (s, i) {
      var o = document.createElement('option');
      o.value = String(i); o.textContent = s.label;
      screenPick.appendChild(o);
    });
    /* 🚨 The choice used to be remembered as a POSITION IN THIS LIST, which is only stable
       while the monitors are. Unplug the second of three and the saved "2" now points at a
       different physical screen — so the prompter opens on the wrong monitor, in a room where
       that means it opens in front of the audience. Remembered by name now, with the old
       stored index still honoured once so nobody's existing choice is thrown away. */
    var want = -1, savedName = '';
    try { savedName = localStorage.getItem(SKEY + '.name') || ''; } catch (e) {}
    if (savedName) {
      for (var i = 0; i < list.length; i++) if (list[i].label === savedName) { want = i; break; }
    }
    if (want < 0) {
      var savedIdx = 0;
      try { savedIdx = parseInt(localStorage.getItem(SKEY), 10) || 0; } catch (e) {}
      want = Math.max(0, Math.min(list.length - 1, savedIdx));
    }
    screenPick.value = String(want);
    screenPick.style.display = list.length ? '' : 'none';
    $('btnSendNormal').style.display = '';
    $('btnSendMirror').style.display = '';
    /* 🚨 Mark's bug, in one line: this button used to hide itself the moment it worked. Plug in
       a monitor after that and there was no way to look again short of restarting the app. It
       stays. */
    $('btnFindScreens').style.display = '';
    $('btnFindScreens').textContent = list.length ? 'Check for monitor changes' : 'Find my monitors';
    if (!list.length) return;
    var changed = before && before !== list.length;
    screenHint.textContent = (changed ? 'Monitor list updated — ' + list.length + ' connected. ' : '') +
      (list.length > 1
        ? 'Pick the monitor and send it. The choice is remembered by name.'
        : 'Only one monitor is connected, so this will open on it.') +
      (savedName && want >= 0 && list[want] && list[want].label === savedName ? '' :
       (savedName ? ' ("' + savedName + '" is not connected right now.)' : ''));
  }

  /* Ask the browser to tell us when a monitor is plugged in or unplugged, so the list is right
     without anybody having to think about it. Attached to the ScreenDetails object we already
     hold; the button remains for the cases where the event does not fire (and for the operator
     who simply wants to be sure). */
  var screenDetails = null;
  function watchScreens(d) {
    if (!d || d === screenDetails) return;
    screenDetails = d;
    if (typeof d.addEventListener !== 'function') return;
    d.addEventListener('screenschange', function () { fillScreens(mapScreens(d)); });
  }
  function mapScreens(d) {
    return (d.screens || []).map(function (s, i) {
      return {
        left: s.availLeft, top: s.availTop, width: s.availWidth, height: s.availHeight,
        label: (s.label || ('Monitor ' + (i + 1))) + ' — ' + s.width + '×' + s.height + (s.isPrimary ? ' (main)' : '')
      };
    });
  }

  $('btnFindScreens').onclick = function () {
    if (!canPlace()) {
      // Deliberately explicit about WHY, because the reason changes what the operator does.
      screenHint.textContent = window.isSecureContext
        ? 'This browser cannot place windows on a chosen monitor (Chrome and Edge can). Open the output link and drag that window to the monitor, then press F11.'
        : 'Placing a window on a chosen monitor only works on the StreamGraphics computer itself. From another device, open the output link over there and drag it across, or use it as a browser source.';
      fillScreens([]);
      $('btnSendNormal').style.display = '';
      $('btnSendMirror').style.display = '';
      screenPick.style.display = 'none';
      return;
    }
    window.getScreenDetails().then(function (d) {
      watchScreens(d);
      fillScreens(mapScreens(d));
    }).catch(function () {
      screenHint.textContent = 'Permission to see your monitors was declined. Allow it in the address bar, or open the output link and drag the window across.';
    });
  };
  screenPick.onchange = function () {
    var s = screens[+this.value];
    try { localStorage.setItem(SKEY + '.name', s ? s.label : ''); localStorage.setItem(SKEY, this.value); } catch (e) {}
  };
  $('btnSendNormal').onclick = function () { openOn(false); };
  $('btnSendMirror').onclick = function () { openOn(true); };
  if (!canPlace()) {
    $('btnFindScreens').textContent = 'Open the output in its own window';
  } else if (navigator.permissions && navigator.permissions.query) {
    /* Permission for this is remembered by the browser, so on the studio PC it has usually
       already been given. Where it has, fill the list in on load and keep watching — then a
       monitor swapped between shows is simply right, with nothing to press. Where it has not,
       nothing happens and the button behaves as it always did: asking is the operator's move,
       not something to spring on them the moment the page opens. */
    try {
      navigator.permissions.query({ name: 'window-management' }).then(function (st) {
        if (!st || st.state !== 'granted') return;
        window.getScreenDetails().then(function (d) { watchScreens(d); fillScreens(mapScreens(d)); })
          .catch(function () {});
      }).catch(function () {});
    } catch (e) {}
  }

  /* ---- look ---- */
  function style(o) { send({ type: 'pr_style', style: o }); }
  $('stFont').onchange   = function () { style({ font: this.value }); };
  $('stSize').oninput    = function () { $('szV').textContent = this.value; style({ size: +this.value }); };
  $('stLH').oninput      = function () { $('lhV').textContent = (+this.value).toFixed(2); style({ lineHeight: +this.value }); };
  /* Paragraph gap: how tall a blank line in the script is, as a % of one line. The talent
     complains about this before anything else — text with no air between thoughts is hard to
     read aloud — and until now the only answer was "add more blank lines". */
  $('stGap').oninput     = function () { $('gapV').textContent = this.value + '%'; style({ paraGap: +this.value }); };
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
    var gp = (s.paraGap == null ? 100 : Number(s.paraGap));
    setVal($('stGap'), gp); $('gapV').textContent = Math.round(gp) + '%';
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
      if (msg.state && msg.state.scripts) renderLib(msg.state.scripts, msg.state.prompter);
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
