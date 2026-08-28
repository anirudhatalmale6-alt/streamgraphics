/* sg-output.js — "Choose your output", in one control, on every panel.
 *
 * Before this, one decision was spread over three places with three names: a box called
 * "Chroma key" that also held Off (which means transparent) and Black (which means a luma key),
 * and a separate "Key + fill" panel somewhere else. Three names for one question — what am I
 * feeding, and what do I paste into it?
 *
 * So it is one list now, in the order of how much the receiving end can do:
 *
 *   Transparent   OBS / vMix take the alpha channel. Nothing to key.
 *   Chroma        a solid colour behind the graphic, for a switcher that keys on colour.
 *   Luma (black)  the same idea, keyed on brightness. Cheap, and wrong wherever the graphic
 *                 itself is dark — which is why it is listed as its own thing and not hidden
 *                 inside the colour list as "Black".
 *   Key + fill    two feeds, nothing guessed. The right answer for a hardware switcher.
 *
 * The control also hands over THE LINK. That is the point of putting them together: the mode
 * and the address you paste are the same decision, and having to look them up in two places is
 * how an operator ends up pasting the plain output into a switcher that cannot key it.
 *
 * The chosen MODE is remembered in this browser, per panel. The server only ever stores a
 * background colour — key+fill is a property of the URL you open, not of the graphic, so there
 * is nothing to store and a key window cannot change what anyone else is seeing.
 */
(function () {
  'use strict';

  var MODES = [
    ['transparent', 'Transparent — OBS / vMix'],
    ['chroma',      'Chroma colour — hardware keyer'],
    ['luma',        'Luma key — black background'],
    ['keyfill',     'Key + fill — two outputs']
  ];
  var PRESETS = [['#00b140', 'Green'], ['#0047ff', 'Blue'], ['#ff00ff', 'Magenta'], ['#ff0000', 'Red'], ['custom', 'Custom…']];

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  function addParam(p, kv) { return p + (p.indexOf('?') >= 0 ? '&' : '?') + kv; }

  /* opts: { root, hint, path, key, onChange }
   *   path     the output this controls, e.g. '/lowerthird-output'. May be a FUNCTION: a named
   *            scoreboard's URL carries ?board=, and switching court has to move the link this
   *            control hands over. A captured string would keep pointing at the old court.
   *   onChange called with the background colour to store ('' = transparent)
   *   .set(chroma) is called by the panel whenever server state arrives. */
  function mount(opts) {
    var root = opts.root;
    if (!root) return null;
    var LS = (opts.key || 'sg.output') + '.mode';

    root.innerHTML =
      '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">'
      + '<span class="mini" style="color:var(--muted);font-weight:600">Output</span>'
      + '<select class="inp sgo-mode" style="width:auto">'
      + MODES.map(function (m) { return '<option value="' + m[0] + '">' + m[1] + '</option>'; }).join('')
      + '</select>'
      + '<select class="inp sgo-col" style="width:auto;display:none">'
      + PRESETS.map(function (c) { return '<option value="' + c[0] + '">' + c[1] + '</option>'; }).join('')
      + '</select>'
      + '<input type="color" class="sgo-cus" value="#ff8800" style="display:none;width:36px;height:30px">'
      + '</div>'
      + '<div class="sgo-links" style="margin-top:10px"></div>';

    var mode = root.querySelector('.sgo-mode'),
        col = root.querySelector('.sgo-col'),
        cus = root.querySelector('.sgo-cus'),
        links = root.querySelector('.sgo-links');

    var chroma = '';                    // what the server holds
    var saved = 'transparent';
    try { saved = localStorage.getItem(LS) || 'transparent'; } catch (e) {}

    function linkRow(label, note, path) {
      var id = 'sgo' + Math.abs((label + path).split('').reduce(function (a, c) { return (a * 31 + c.charCodeAt(0)) | 0; }, 7));
      return '<div style="display:flex;align-items:center;gap:10px;background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:9px 11px;margin-bottom:6px;flex-wrap:wrap">'
        + '<div style="font-weight:800;min-width:74px">' + esc(label)
        + (note ? '<div class="mini" style="font-weight:400;color:var(--muted)">' + esc(note) + '</div>' : '') + '</div>'
        + '<code class="sgo-lk" data-path="' + esc(path) + '" id="' + id + '" style="flex:1;min-width:200px;font-family:Consolas,Menlo,monospace;font-size:12.5px;color:#cfe0f5;background:#0a0e14;border:1px solid var(--line);border-radius:7px;padding:7px 9px;overflow:auto;white-space:nowrap;user-select:all"></code>'
        + '<button class="btn ghost sgo-copy" type="button" data-for="' + id + '" style="font-size:12px">Copy</button>'
        + '</div>';
    }

    function outPath() { return (typeof opts.path === 'function') ? opts.path() : opts.path; }

    function paint() {
      var m = mode.value;
      col.style.display = (m === 'chroma') ? '' : 'none';
      cus.style.display = (m === 'chroma' && col.value === 'custom') ? '' : 'none';

      var html = '';
      if (m === 'keyfill') {
        html = linkRow('FILL', 'the graphic, on black', addParam(outPath(), 'key=fill'))
             + linkRow('KEY', 'the matte — white where the graphic is', addParam(outPath(), 'key=key'))
             + '<p class="mini" style="color:var(--muted);line-height:1.6;margin:2px 0 0">Send these out of two video outputs and wire them to the switcher’s fill and key inputs. On an ATEM, turn <b>pre-multiplied key</b> on. Needs two video outputs from this computer; with one, use Luma or Chroma above.</p>';
      } else {
        var note = m === 'transparent' ? 'add as a Browser Source, 1920 × 1080 — the transparency is automatic'
                 : m === 'luma' ? 'renders on solid black; key it out with a luma keyer'
                 : 'renders on the colour above; key it out with a chroma keyer';
        html = linkRow('Output', note, outPath());
        if (m === 'luma') {
          html += '<p class="mini" style="color:var(--muted);line-height:1.6;margin:2px 0 0">A luma key decides transparency from brightness, so anything <b>dark</b> in the graphic goes see-through with the background — drop shadows, a dark bar, the shaded edge of a letter. Fine for bright text; for a full-colour graphic use Key + fill.</p>';
        }
      }
      links.innerHTML = html;
      links.querySelectorAll('.sgo-lk').forEach(function (el) {
        el.textContent = window.SGLinks ? SGLinks.url(el.dataset.path) : el.dataset.path;
      });
      links.querySelectorAll('.sgo-copy').forEach(function (b) {
        b.onclick = function () {
          var el = document.getElementById(b.dataset.for);
          if (el && window.SGLinks) SGLinks.copy(el.textContent, b);
        };
      });
    }

    // What the server should hold for the chosen mode. Key+fill forces black on the pages
    // themselves, so it stores nothing — leaving the graphic exactly as it was.
    function wanted() {
      var m = mode.value;
      if (m === 'transparent' || m === 'keyfill') return '';
      if (m === 'luma') return '#000000';
      var v = col.value;
      return (v === 'custom') ? cus.value : v;
    }
    function push() {
      /* 🚨 `saved` has to move too, not just the stored copy. It is what set() consults to
         resolve the two ambiguous cases — an empty colour could be Transparent or Key+fill, and
         black could be Luma or a black Chroma. Leaving it stale meant the state broadcast that
         follows every change immediately threw the operator back into the PREVIOUS mode: pick
         Key + fill, and half a second later you are on Transparent with one link. */
      saved = mode.value;
      try { localStorage.setItem(LS, mode.value); } catch (e) {}
      paint();
      var w = wanted();
      if (w !== chroma) { chroma = w; if (opts.onChange) opts.onChange(w); }
    }

    mode.onchange = push;
    col.onchange = push;
    cus.oninput = push;
    if (window.SGLinks) SGLinks.onbase(paint);

    /* Called from the panel's render(). The MODE is not stored on the server, so it is worked
       out from the colour — with one exception that has to be respected: a black background is
       ambiguous. It is what Luma needs, and it is also just a black background. If this browser
       last chose key+fill, that choice stands, because key+fill leaves the colour empty and
       "empty" would otherwise read as Transparent and silently drop the operator out of the
       mode they set up in. */
    function set(c) {
      // The volleyball board has stored its background as a WORD since long before this control
      // existed ('green'), and the output pages still map those. Normalise on the way in so the
      // picker shows Green rather than falling through to Custom and an unreadable colour box.
      var WORDS = { green: '#00b140', blue: '#0047ff', magenta: '#ff00ff', red: '#ff0000', black: '#000000' };
      if (c && WORDS[String(c).toLowerCase()]) c = WORDS[String(c).toLowerCase()];
      chroma = c || '';
      if (document.activeElement === mode || document.activeElement === col || document.activeElement === cus) return;
      var m;
      if (saved === 'keyfill' && !chroma) m = 'keyfill';
      else if (!chroma) m = 'transparent';
      else if (String(chroma).toLowerCase() === '#000000') m = (saved === 'chroma') ? 'chroma' : 'luma';
      else m = 'chroma';
      mode.value = m;
      if (m === 'chroma') {
        var known = PRESETS.some(function (p) { return p[0] === chroma; });
        col.value = known ? chroma : 'custom';
        if (!known) cus.value = chroma;
      }
      saved = m;
      try { localStorage.setItem(LS, m); } catch (e) {}
      paint();
    }

    mode.value = saved;
    paint();
    return { set: set, refresh: paint, mode: function () { return mode.value; } };
  }

  window.SGOutput = { mount: mount };
})();
