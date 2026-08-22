/* StreamGraphics Pro — shared teleprompter layout.
 *
 * One place that knows how a script turns into lines and pixels, used by BOTH the output
 * page and the control panel. If these two ever laid the script out differently, the pixel
 * positions the panel sends would not describe what the talent is actually reading.
 *
 * Nothing here talks to the server or animates; it renders, and it measures. */
(function (global) {
  'use strict';

  var STAGE_W = 1920, STAGE_H = 1080;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c];
    });
  }

  /* A script is just lines. A line that starts with ## is a bookmark, and the rest of that
     line is its name. Bookmarks live IN the text on purpose: the operator can move one by
     moving a line, and nothing can drift out of step with the words the way a stored
     character-offset would the moment somebody edits a paragraph above it. */
  function parse(script) {
    var raw0 = String(script == null ? '' : script);
    if (!raw0.trim()) return [];   // nothing to read: render no lines at all, so the script
                                   // measures as zero rather than one blank line's worth
    var out = [], lines = raw0.split(/\r\n|\r|\n/);
    for (var i = 0; i < lines.length; i++) {
      var raw = lines[i];
      var m = /^\s*##\s?(.*)$/.exec(raw);
      if (m) out.push({ type: 'mark', text: m[1].trim() || 'Bookmark' });
      else if (!raw.trim()) out.push({ type: 'blank', text: '' });
      else out.push({ type: 'line', text: raw });
    }
    return out;
  }

  function marksOf(script) {
    return parse(script).filter(function (b) { return b.type === 'mark'; }).map(function (b) { return b.text; });
  }

  /* Signature of everything that can move a line break.
     🚨 server.js promptSig() computes this too and the two MUST agree exactly, or the server
     rejects every geometry report and no bookmark ever gets a position. Plain FNV-1a, not
     SubtleCrypto: crypto.subtle does not exist over plain http on a LAN address, which is
     precisely how this app is used at a venue. */
  function sig(p) {
    var s = (p && p.style) || {};
    var str = [(p && p.script) || '', s.font, s.size, s.lineHeight, s.bold ? 1 : 0, s.align, s.width, s.showMarks ? 1 : 0].join('\u0000');
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      h ^= (c & 0xff);        h = Math.imul(h, 16777619) >>> 0;
      h ^= ((c >> 8) & 0xff); h = Math.imul(h, 16777619) >>> 0;
    }
    return str.length.toString(36) + '-' + h.toString(36);
  }

  /* Build the document. `docEl` is the column; it gets the type styling, the lines, and a
     lead-in / run-out pad so line one starts at the reading indicator and the last line can
     still reach it. Returns the pad height, which callers need to convert offsets. */
  function render(docEl, p) {
    var s = (p && p.style) || {};
    var size = Number(s.size) || 64;
    var lh = Number(s.lineHeight) || 1.45;
    var pad = Math.round(STAGE_H * (Math.max(0, Math.min(100, Number(s.cuePos) || 0)) / 100));

    docEl.style.width = Math.max(20, Math.min(100, Number(s.width) || 82)) + '%';
    docEl.style.fontFamily = s.font || "'Segoe UI', Arial, sans-serif";
    docEl.style.fontSize = size + 'px';
    docEl.style.lineHeight = String(lh);
    docEl.style.fontWeight = s.bold ? '700' : '400';
    docEl.style.textAlign = (['left', 'center', 'right'].indexOf(s.align) >= 0 ? s.align : 'left');

    var blocks = parse(p && p.script);
    var html = '<div class="pr-pad" style="height:' + pad + 'px"></div>';
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      if (b.type === 'mark') {
        if (!s.showMarks) continue;   // operator-only bookmark: keep it off the talent's screen
        html += '<div class="pr-l pr-mark" data-mark="' + esc(b.text) + '">' + esc(b.text) + '</div>';
      } else if (b.type === 'blank') {
        html += '<div class="pr-l blank">&nbsp;</div>';
      } else {
        html += '<div class="pr-l">' + esc(b.text) + '</div>';
      }
    }
    html += '<div class="pr-pad" style="height:' + (STAGE_H - pad) + 'px"></div>';
    docEl.innerHTML = html;
    colors(docEl, p);
    return pad;
  }

  /* Colours, applied to an ALREADY-RENDERED document.
     🚨 Split out of render() on purpose. Text colour and bookmark colour are deliberately not
     part of sig() — they cannot move a line break, so making them invalidate the measurement
     would blank the bookmarks every time somebody dragged a colour picker. But the output page
     only re-renders when sig() changes, so while these two were set inside render() they were
     the one pair of controls that did nothing until something ELSE forced a re-layout. Every
     page that draws a script must call this on every state, not only when the layout changes. */
  function colors(docEl, p) {
    var s = (p && p.style) || {};
    docEl.style.color = s.color || '#ffffff';
    var mk = docEl.querySelectorAll ? docEl.querySelectorAll('.pr-mark') : [];
    for (var i = 0; i < mk.length; i++) mk[i].style.color = s.markColor || '#f4a63c';
  }

  /* Measure a rendered document.
     `total` is how far the script can scroll: the content height, so position 0 puts the
     first line on the cue and position `total` puts the end of the script there.
     Bookmark positions are stored relative to the CONTENT, not the screen, so moving the
     reading indicator up or down never invalidates them. */
  function measure(docEl, pad) {
    var kids = docEl.children;
    var total = Math.max(0, docEl.scrollHeight - STAGE_H);
    var marks = [];
    for (var i = 0; i < kids.length; i++) {
      var el = kids[i];
      if (!el.hasAttribute || !el.hasAttribute('data-mark')) continue;
      marks.push({ name: el.getAttribute('data-mark'), y: Math.max(0, Math.round(el.offsetTop - pad)) });
    }
    return { total: Math.round(total), marks: marks };
  }

  /* Scale the 1920x1080 stage to fill the window without distorting it. An OBS browser
     source sized 1920x1080 lands on scale 1; a confidence monitor or a phone gets the same
     layout, just smaller. */
  function fit(fitEl, stageEl) {
    var w = fitEl.clientWidth || STAGE_W, h = fitEl.clientHeight || STAGE_H;
    var k = Math.min(w / STAGE_W, h / STAGE_H);
    var mirrored = stageEl.classList.contains('mirror-h') || stageEl.classList.contains('mirror-v');
    var mx = stageEl.classList.contains('mirror-h') ? -1 : 1;
    var my = stageEl.classList.contains('mirror-v') ? -1 : 1;
    // Centre it, then scale. Mirroring is folded into the same transform so the two don't
    // fight over transform-origin (a separate CSS transform on the same element would win).
    var ox = Math.round((w - STAGE_W * k) / 2), oy = Math.round((h - STAGE_H * k) / 2);
    stageEl.style.transformOrigin = 'top left';
    stageEl.style.transform = 'translate(' + ox + 'px,' + oy + 'px) scale(' + (k * mx) + ',' + (k * my) + ')'
      + (mirrored ? ' translate(' + (mx < 0 ? -STAGE_W : 0) + 'px,' + (my < 0 ? -STAGE_H : 0) + 'px)' : '');
    return k;
  }

  global.SGPrompter = {
    STAGE_W: STAGE_W, STAGE_H: STAGE_H,
    parse: parse, marksOf: marksOf, sig: sig, render: render, colors: colors,
    measure: measure, fit: fit, esc: esc
  };
})(window);
