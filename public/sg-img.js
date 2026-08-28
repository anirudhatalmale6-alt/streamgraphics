/* sg-img.js — how an IMAGE layer is drawn, in one place.
 *
 * The builder canvas, the lower-third output and the Program output each had their own copy of
 * the same `<img>` string. Three copies was survivable while an image was only ever an image;
 * it stopped being survivable the moment images could be RECOLOURED, because a graphic that
 * looks right in the builder and wrong on air is worse than one that is wrong in both.
 *
 * ---- Recolouring ----------------------------------------------------------------------------
 * Two modes, because they suit different artwork and neither one covers both:
 *
 *   HUE   `filter: hue-rotate()`. Spins the colours of a full-colour image by an angle. Good for
 *         a photographic or multi-coloured graphic where you want a different flavour of the
 *         same picture. It cannot turn an arbitrary image into a specific colour — a hue angle
 *         is a rotation, not a destination.
 *
 *   TINT  The image is used as a MASK and the colour is painted through it. This is the one for
 *         the angled panels, swooshes and bars a sports pack is made of: draw the shape once as
 *         a white or grey PNG, and any club's colour fills it. It reads the artwork's ALPHA, so
 *         a shape on a transparent background comes out perfectly and a photo on a solid white
 *         background comes out as a solid rectangle — which is the honest behaviour, not a bug,
 *         and is why the two modes are offered separately rather than guessed between.
 *
 * The tint colour can come from a declared field (`fieldTint`), so a team colour arrives from
 * the fill-in form or a spreadsheet column like any other value.
 */
(function () {
  'use strict';

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  function isHex(c) { return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(c || '').trim()); }

  function shadow(l) { return l.shadow ? 'filter:drop-shadow(0 3px 10px rgba(0,0,0,.55));' : ''; }
  function radius(l) { return l.shape === 'circle' ? 'border-radius:50%;' : (l.shape === 'rounded' ? 'border-radius:16px;' : ''); }

  /* The inner markup for an image layer. `cls` is the class every renderer already puts on the
     element it drops into a layer. */
  /* `builder` = true when this is the design canvas rather than an output.
     An <img> with no src draws a BROKEN-IMAGE frame, which on air is a grey box with a torn
     icon in it — a template whose photo has not been filled in yet would go out looking faulty.
     On an output an empty image layer draws nothing at all; in the builder it draws a dashed
     placeholder, because a layer you cannot see is a layer you cannot position. */
  function html(l, builder) {
    var src = l.src || '';
    var cls = 'li ly-img ' + (l.fit === 'cover' ? 'cover ' : '') + (l.shape || 'none');

    if (!src) {
      return builder
        ? '<div class="' + cls + '" style="width:100%;height:100%;border:2px dashed rgba(255,255,255,.28);border-radius:' + (l.shape === 'circle' ? '50%' : '10px') + ';box-sizing:border-box"></div>'
        : '<div class="' + cls + '" style="width:100%;height:100%"></div>';
    }

    if (l.recolor === 'tint' && src && isHex(l.tint)) {
      /* Mask, not a filter. A filter chain that lands on an exact colour does not exist for
         arbitrary artwork; a mask does the thing the designer actually means — "this shape, in
         this colour". Both spellings: -webkit- is still required by Safari and by the WebView
         inside some capture tools. */
      var size = (l.fit === 'cover') ? 'cover' : 'contain';
      var st = 'width:100%;height:100%;background-color:' + esc(l.tint) + ';'
        + 'mask-image:url(' + esc(src) + ');-webkit-mask-image:url(' + esc(src) + ');'
        + 'mask-size:' + size + ';-webkit-mask-size:' + size + ';'
        + 'mask-repeat:no-repeat;-webkit-mask-repeat:no-repeat;'
        + 'mask-position:center;-webkit-mask-position:center;'
        + radius(l) + shadow(l);
      return '<div class="' + cls + '" style="' + st + '"></div>';
    }

    var filt = '';
    if (l.recolor === 'hue') {
      var deg = Math.round(Number(l.hue));
      if (!isFinite(deg)) deg = 0;
      // Wrapped rather than clamped: 370 degrees is 10 degrees, and an operator dragging a dial
      // past the end should come round again, not stick.
      deg = ((deg % 360) + 360) % 360;
      if (deg) filt = 'filter:hue-rotate(' + deg + 'deg)' + (l.shadow ? ' drop-shadow(0 3px 10px rgba(0,0,0,.55))' : '') + ';';
    }
    if (!filt) filt = shadow(l);

    return '<img class="' + cls + '" src="' + esc(src) + '" style="width:100%;height:100%;' + filt + '">';
  }

  window.SGImg = { html: html, isHex: isHex };
})();
