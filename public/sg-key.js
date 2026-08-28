/* sg-key.js — KEY + FILL outputs, for feeding a hardware switcher over HDMI/SDI.
 *
 * A browser source in OBS or vMix gets a real alpha channel, so a graphic simply sits over the
 * video. HDMI carries no alpha. A hardware switcher — ATEM, Tricaster, a vMix box taking a
 * physical input — has to be told which pixels are transparent some other way, and there are
 * only two ways to tell it:
 *
 *   CHROMA / LUMA — one feed, and the switcher GUESSES transparency from colour or brightness.
 *     Already in the app (the Chroma key box; pick Black and luma-key it). The guess is wrong
 *     wherever the graphic itself contains what is being keyed on — for luma that means every
 *     dark pixel: a drop shadow, a dark brand bar, the shaded edge of an anti-aliased letter.
 *
 *   KEY + FILL — two feeds, and nothing is guessed. The FILL carries colour, the KEY is a
 *     greyscale matte where white means opaque and black means transparent. Soft edges and
 *     semi-transparent panels survive exactly as they look in OBS.
 *
 * This file makes the second one possible without a second copy of anything: the SAME output
 * page renders as the fill or as the key depending on one URL parameter.
 *
 *   /lowerthird-output?key=fill    the graphic on solid black         -> switcher FILL input
 *   /lowerthird-output?key=key     a white matte of that same graphic -> switcher KEY input
 *
 * The matte is `brightness(0) invert(1)`. brightness(0) drives every colour channel to black
 * and leaves alpha alone; invert(1) then drives them to white and STILL leaves alpha alone.
 * White at alpha A, drawn over a black page, renders as a grey of exactly A — which is the
 * definition of a linear key matte. Doing it in CSS over the whole stage means it covers text,
 * images, video, QR codes and anything added later with no per-layer code to keep in step.
 *
 * The fill is the graphic composited over black, i.e. already multiplied by its own alpha, so
 * on an ATEM this pair is a PRE-MULTIPLIED (shaped) key. Tick that box or the edges bloom.
 *
 * The watermark is deliberately left OUTSIDE the filter. It lives on <body>, not in #stage, so
 * it renders as itself on both feeds — a key mode must not be a way to shed it.
 *
 * Nothing here is stored on the server or broadcast. The mode lives in the URL of one browser
 * window, so opening a key window cannot change what any other output is showing, and a plain
 * output URL renders byte-for-byte what it did before.
 */
(function () {
  'use strict';

  var mode = '';
  try { mode = String(new URLSearchParams(location.search).get('key') || '').toLowerCase(); } catch (e) {}
  if (mode !== 'fill' && mode !== 'key') return;

  var root = document.documentElement;

  /* `html.sgkey body` has to out-specify `body.chroma`, which is also !important — if the
     chroma rule won, a fill feed set to green would go out green and the switcher would key
     the graphic away along with the background. */
  var css =
    'html.sgkey body{background:#000 !important}' +
    'html.sgkey-key #stage{filter:brightness(0) invert(1)}';

  var st = document.createElement('style');
  st.id = 'sgpro-keyfill';
  st.textContent = css;
  (document.head || root).appendChild(st);

  root.classList.add('sgkey');
  if (mode === 'key') root.classList.add('sgkey-key');
  root.setAttribute('data-sgkey', mode);   // so the mode is visible to a test, and in dev tools
})();
