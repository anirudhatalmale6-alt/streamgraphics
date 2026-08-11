/* StreamGraphics — BULLETS layer: progressive reveal, PowerPoint style.
 *
 * Shared by the builder canvas, the lower-third output and the program output so the four
 * looks can never drift apart between the three places a bullet list gets drawn.
 *
 * The four behaviours are one mechanism: a list of lines plus how far down it we are.
 * The mode only decides how an already-revealed line is drawn, and whether the lines you
 * haven't reached yet are on screen at all.
 *
 *   replace   — earlier lines gone, each one lands in the same spot
 *   build     — earlier lines stay at full strength, new one appears beneath (PowerPoint build)
 *   fade      — earlier lines stay but dimmed
 *   highlight — every line on screen from the start, dimmed, current one lit
 *
 * index is -1 before the first Next (nothing revealed yet).
 */
(function () {
  'use strict';

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }
  function rgba(hex, pct) {
    hex = String(hex || '#000').replace(/^#/, ''); if (hex.length === 3) hex = hex.replace(/(.)/g, '$1$1');
    var r = parseInt(hex.slice(0, 2), 16) || 0, g = parseInt(hex.slice(2, 4), 16) || 0, b = parseInt(hex.slice(4, 6), 16) || 0;
    return 'rgba(' + r + ',' + g + ',' + b + ',' + (pct == null ? 1 : pct / 100) + ')';
  }
  function num(v, d) { var n = (v == null ? NaN : +v); return isFinite(n) ? n : d; }

  function items(l) { return (l && Array.isArray(l.items)) ? l.items : []; }
  function idxOf(l) { var i = num(l && l.index, -1); return i; }
  function count(l) { return items(l).length; }

  /* How one line is drawn at the current reveal position. */
  function look(l, i) {
    var mode = l.mode || 'build';
    var idx = idxOf(l);
    var dim = num(l.dimOpacity, 45) / 100;
    var st = i < idx ? 'past' : (i === idx ? 'cur' : 'future');
    if (st === 'cur') {
      return {
        show: true, opacity: 1,
        color: (mode === 'highlight' ? (l.hlColor || null) : null),
        scale: (mode === 'highlight' ? num(l.hlScale, 1) : 1)
      };
    }
    if (st === 'past') {
      if (mode === 'replace') return { show: false, opacity: 0, color: null, scale: 1 };
      if (mode === 'build') return { show: true, opacity: 1, color: null, scale: 1 };
      return { show: true, opacity: dim, color: null, scale: 1 };            // fade + highlight
    }
    if (mode === 'highlight') return { show: true, opacity: dim, color: null, scale: 1 };
    return { show: false, opacity: 0, color: null, scale: 1 };               // not reached yet
  }

  function markerHtml(l, i) {
    var m = l.marker || 'bullet';
    if (m === 'none') return '';
    var ch = m === 'dash' ? '–' : m === 'check' ? '✓' : m === 'arrow' ? '▸' : m === 'number' ? ((i + 1) + '.') : '•';
    // No colour of its own unless one was chosen — so the highlight colour lights the marker too.
    var col = l.markerColor ? ('color:' + esc(l.markerColor) + ';') : '';
    return '<span class="bm" style="' + col + 'flex:none;margin-right:' + num(l.markerGap, 18) + 'px">' + ch + '</span>';
  }

  function originOf(l) { return l.align === 'right' ? 'right center' : (l.align === 'center' ? 'center' : 'left center'); }

  function itemStyle(l, k) {
    // In replace mode every line lives in the SAME grid cell, so the outgoing and incoming lines
    // overlap instead of briefly both taking up room — otherwise the list re-centres itself
    // mid-transition and the new line visibly drops in low and then snaps up.
    var stacked = (l.mode || 'build') === 'replace' ? 'grid-area:1/1;align-self:center;' : '';
    return stacked + 'display:' + (k.show ? 'flex' : 'none') + ';align-items:baseline'
      + ';opacity:' + k.opacity
      + ';transform:' + (k.scale !== 1 ? 'scale(' + k.scale + ')' : 'none')
      + ';transform-origin:' + originOf(l)
      + ';transition:opacity 220ms ease, color 220ms ease, transform 220ms ease'
      + (k.color ? ';color:' + esc(k.color) : '');
  }

  // Typography is the same whichever way the lines are laid out.
  function fontStyle(l) {
    return ';font-family:' + (l.font || "'Segoe UI', Arial, sans-serif") + ';font-size:' + num(l.size, 44) + 'px'
      + ';color:' + esc(l.color || '#ffffff')
      + ';font-weight:' + (l.bold ? '800' : '600') + ';font-style:' + (l.italic ? 'italic' : 'normal') + ';line-height:1.2'
      + ((l.bgOpacity > 0) ? '' : ';text-shadow:0 2px 8px rgba(0,0,0,.45)');
  }

  function listStyle(l) {
    var mode = l.mode || 'build';
    var av = l.align === 'right' ? 'flex-end' : (l.align === 'center' ? 'center' : 'flex-start');
    var base = ';text-align:' + (l.align || 'left') + ';padding:' + num(l.pad, 24) + 'px;box-sizing:border-box;overflow:visible';
    // replace lands every line in one spot — a single grid cell they all share, so nothing reflows.
    if (mode === 'replace') {
      return 'position:absolute;inset:0;display:grid;grid-template-columns:1fr;align-content:center'
        + ';justify-items:' + (l.align === 'right' ? 'end' : (l.align === 'center' ? 'center' : 'start')) + base
        + fontStyle(l);
    }
    // a build anchors to whichever edge it grows away from
    var jc = l.grow === 'up' ? 'flex-end' : 'flex-start';
    return 'position:absolute;inset:0;display:flex;flex-direction:column;justify-content:' + jc
      + ';align-items:' + av + ';gap:' + num(l.gap, 14) + 'px' + base
      + fontStyle(l);
  }

  function bgHtml(l) {
    if (!(l.bgOpacity > 0 && l.bg)) return '';
    return '<div style="position:absolute;inset:0;background:' + rgba(l.bg, l.bgOpacity) + ';border-radius:' + num(l.radius, 0) + 'px"></div>';
  }

  /* Full markup for a bullets layer, at its current reveal position (no animation). */
  function html(l) {
    var its = items(l);
    var lines = its.map(function (t, i) {
      return '<div class="bi" data-i="' + i + '" style="' + itemStyle(l, look(l, i)) + '">'
        + markerHtml(l, i) + '<span class="bt">' + esc(t) + '</span></div>';
    }).join('');
    var body = lines || '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#6b7a90;font-size:24px">(no bullets yet)</div>';
    return '<div class="li ly-bul" data-idx="' + idxOf(l) + '" style="position:relative;width:100%;height:100%;overflow:visible">'
      + bgHtml(l) + '<div class="bul-list" style="' + listStyle(l) + '">' + body + '</div></div>';
  }

  /* Where a line starts from when it reveals.
   * The travel scales with the type size. A fixed 26px was half a line at 44px text and
   * almost nothing at 90px, so on a big build the move was too small to read as a move —
   * it looked like the line simply cut in. */
  function revealFrom(tr, l) {
    var size = num(l && l.size, 44);
    var v = Math.round(Math.max(26, Math.min(90, size * 0.66)));    // vertical travel
    var h = Math.round(v * 1.7);                                     // horizontal reads shorter, so give it more
    return tr === 'slide-up' ? 'translateY(' + v + 'px)' : tr === 'slide-down' ? 'translateY(-' + v + 'px)'
      : tr === 'slide-left' ? 'translateX(-' + h + 'px)' : tr === 'slide-right' ? 'translateX(' + h + 'px)'
      : tr === 'pop' ? 'scale(.72)' : 'none';
  }

  /* Move an existing bullets element to the layer's current index, animating only what changed.
   * Rebuilding the DOM instead would hard-cut every line and restart anything else in the preset. */
  function refresh(root, l) {
    if (!root || !l || l.type !== 'bullets') return false;
    var el = root.querySelector('.ly[data-id="' + l.id + '"] .ly-bul');
    if (!el) return false;
    var idx = idxOf(l);
    if (String(idx) === el.getAttribute('data-idx')) return true;
    el.setAttribute('data-idx', String(idx));

    var dur = Math.max(0, num(l.revealDur, 380));
    var tr = l.reveal || 'fade';
    // In replace mode the two lines are on top of each other, so the old one has to fade at the
    // same rate the new one arrives — otherwise the spot goes dark in the middle of the swap.
    var outMs = (l.mode === 'replace') ? dur : 220;
    var lines = el.querySelectorAll('.bi');
    for (var j = 0; j < lines.length; j++) {
      (function (bi) {
        var i = num(bi.getAttribute('data-i'), 0);
        var k = look(l, i);
        var wasShown = bi.style.display !== 'none';
        if (bi._bulHide) { clearTimeout(bi._bulHide); bi._bulHide = null; }
        var scale = k.scale !== 1 ? 'scale(' + k.scale + ')' : 'none';
        bi.style.color = k.color || '';

        if (k.show && !wasShown) {
          bi.style.display = 'flex';
          if (dur && tr !== 'none') {
            bi.style.transition = 'none';
            bi.style.opacity = 0;
            bi.style.transform = revealFrom(tr, l);
            void bi.offsetWidth;                                    // commit the start state
            bi.style.transition = 'opacity ' + dur + 'ms ease, transform ' + dur + 'ms cubic-bezier(.16,1,.3,1), color 220ms ease';
          }
          bi.style.opacity = k.opacity;
          bi.style.transform = scale;
          return;
        }
        var ms = (!k.show && wasShown) ? outMs : 220;
        bi.style.transition = 'opacity ' + ms + 'ms ease, color 220ms ease, transform ' + ms + 'ms ease';
        bi.style.opacity = k.opacity;
        bi.style.transform = scale;
        if (!k.show && wasShown) {
          // Let it fade before it stops taking up space, or a build would jump as you step back.
          bi._bulHide = setTimeout(function () { bi.style.display = 'none'; bi._bulHide = null; }, ms + 20);
        }
      })(lines[j]);
    }
    return true;
  }

  /* Apply a transport command to an index. Shared with the server so both agree exactly. */
  function step(cmd, index, n) {
    var i = (index == null ? -1 : index);
    if (cmd === 'next') { i = (i < 0 ? 0 : i + 1); i = n ? Math.min(i, n - 1) : -1; }
    else if (cmd === 'prev') { i = (i > 0) ? i - 1 : (i === 0 ? -1 : i); }
    else if (cmd === 'first') { i = n ? 0 : -1; }
    else if (cmd === 'last' || cmd === 'all') { i = n ? n - 1 : -1; }
    else if (cmd === 'blank' || cmd === 'reset') { i = -1; }
    return Math.max(-1, Math.min(n - 1, i));
  }

  window.SGBullets = { html: html, look: look, refresh: refresh, step: step, count: count, index: idxOf, items: items };
})();
