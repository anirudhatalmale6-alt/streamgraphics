/* StreamGraphics — BOX surface: fill, gradient, drop shadow, soft edges.
 *
 * One place, three consumers: the builder canvas, the lower-third output and the program output.
 * Those three used to carry their own copy of the box markup, which is how a box ends up looking
 * one way in the builder and another way on air. Anything that decides how a filled rectangle
 * looks belongs in here.
 *
 * The ticker draws its bar through here too, so a gradient or a shadow set on a ticker behaves
 * exactly like one set on a box, with no second implementation to keep in step.
 */
(function () {
  'use strict';

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function num(v, d) { var n = (v == null || v === '') ? NaN : +v; return isFinite(n) ? n : d; }
  function rgba(hex, pct) {
    hex = String(hex || '#000').replace(/^#/, '');
    if (hex.length === 3) hex = hex.replace(/(.)/g, '$1$1');
    var r = parseInt(hex.slice(0, 2), 16) || 0, g = parseInt(hex.slice(2, 4), 16) || 0, b = parseInt(hex.slice(4, 6), 16) || 0;
    return 'rgba(' + r + ',' + g + ',' + b + ',' + (pct == null ? 1 : Math.max(0, Math.min(100, pct)) / 100) + ')';
  }

  /* The fill: one colour, or a gradient between two.
   * Each end has its OWN opacity, which is what makes the most useful lower-third background of
   * all — a solid bar that fades out to nothing at one end — a matter of dragging the second
   * opacity to zero rather than a Photoshop job. */
  function fill(l) {
    var mode = l.fillMode || 'solid';
    var c1 = rgba(l.fill, l.opacity == null ? 100 : l.opacity);
    if (mode === 'solid') return c1;
    var c2 = rgba(l.fill2 || l.fill, l.opacity2 == null ? (l.opacity == null ? 100 : l.opacity) : l.opacity2);
    if (mode === 'radial') return 'radial-gradient(circle at ' + (l.gradX == null ? 50 : num(l.gradX, 50)) + '% ' + (l.gradY == null ? 50 : num(l.gradY, 50)) + '%, ' + c1 + ', ' + c2 + ')';
    // CSS angles run clockwise from "up", which is what the dial in the builder shows.
    return 'linear-gradient(' + num(l.gradAngle, 90) + 'deg, ' + c1 + ', ' + c2 + ')';
  }

  /* Soft edges: feather the rectangle away instead of ending it on a hard line.
   * Done with a mask rather than a blur - a blur would soften the CONTENTS too, and the whole
   * point is a crisp graphic whose edge melts into the picture. Two gradients intersected, so
   * corners feather in both directions at once instead of going square. */
  function maskCss(l) {
    var f = num(l.feather, 0);
    if (!(f > 0)) return '';
    var edges = l.featherEdges || 'all';
    var h = (edges === 'all' || edges === 'sides' || edges === 'left' || edges === 'right');
    var v = (edges === 'all' || edges === 'topbottom' || edges === 'top' || edges === 'bottom');
    var parts = [];
    function ramp(dir, from, to) {
      // `from`/`to` say which ends actually fade — a bar feathered only on its right edge keeps
      // its left edge hard against whatever it is anchored to.
      var stops = [];
      stops.push(from ? 'transparent 0' : '#000 0');
      stops.push('#000 ' + f + 'px');
      stops.push('#000 calc(100% - ' + f + 'px)');
      stops.push(to ? 'transparent 100%' : '#000 100%');
      return 'linear-gradient(to ' + dir + ', ' + stops.join(', ') + ')';
    }
    if (h) parts.push(ramp('right', edges !== 'right', edges !== 'left'));
    if (v) parts.push(ramp('bottom', edges !== 'bottom', edges !== 'top'));
    if (!parts.length) return '';
    var img = parts.join(', ');
    var css = '-webkit-mask-image:' + img + ';mask-image:' + img + ';';
    if (parts.length > 1) css += '-webkit-mask-composite:source-in;mask-composite:intersect;';
    return css;
  }

  /* Shadow.
   * box-shadow when the edges are hard: cheap, crisp, and it does not create a filter layer on
   * a 1920x1080 element. Once the edges are feathered box-shadow is wrong - it would trace the
   * rectangle the mask just dissolved - so it becomes a drop-shadow filter, which follows the
   * mask and gives the soft edge a soft shadow to match. */
  function shadowCss(l, feathered) {
    if (!l.shadow) return '';
    var blur = num(l.shadowBlur, 18), y = num(l.shadowY, 6), x = num(l.shadowX, 0);
    var col = rgba(l.shadowColor || '#000000', l.shadowOpacity == null ? 55 : l.shadowOpacity);
    if (feathered) return 'filter:drop-shadow(' + x + 'px ' + y + 'px ' + blur + 'px ' + col + ');';
    var spread = num(l.shadowSpread, 0);
    return 'box-shadow:' + x + 'px ' + y + 'px ' + blur + 'px ' + spread + 'px ' + col + ';';
  }

  // Everything that makes a filled rectangle look the way it looks, as one inline style string.
  function surfaceStyle(l) {
    var m = maskCss(l);
    return 'background:' + fill(l) + ';border-radius:' + num(l.radius, 0) + 'px;' + m + shadowCss(l, !!m);
  }

  // A plain box layer.
  function html(l, cls) {
    return '<div class="li ly-box ' + (cls || '') + '" style="width:100%;height:100%;' + surfaceStyle(l) + '"></div>';
  }

  window.SGBox = { style: surfaceStyle, html: html, fill: fill, rgba: rgba, esc: esc };
})();
