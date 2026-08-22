/*
 * StreamGraphics — realtime livestream graphics engine (Milestone 1)
 * Zero dependencies. Pure Node.js.
 *
 * What it does:
 *   - Serves an OUTPUT page  (/output)  -> load this as a Browser Source in OBS/vMix
 *   - Serves a CONTROL panel (/control) -> open this in your browser to drive the graphics
 *   - Keeps the two in sync in realtime over your network using Server-Sent Events (SSE).
 *
 * Why SSE and not WebSockets: it needs no external packages and no build step, so you
 * can run this with nothing but Node installed — no "npm install". The control panel
 * pushes actions with a normal POST; the server broadcasts the new state to every
 * connected output/control instantly.
 *
 * Run:   node server.js         (optionally  PORT=4000 node server.js)
 */

'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const obsGrab = require('./obs-grab');
const vmixGrab = require('./vmix-grab');

const PORT = process.env.PORT || 4000;
const PUBLIC_DIR = path.join(__dirname, 'public');
let VERSION = '?'; try { VERSION = require('./package.json').version; } catch (e) {}

// Update check: the app fetches a small JSON manifest you host
// (→ {"version":"1.0.1","url":"https://...","notes":"..."}) and shows an in-app banner if newer.
// Several names are tried in order: some hosts (SiteGround among them) refuse to serve a file
// literally named "latest.json", so the primary name is sgpro-version.json and the old name is
// kept last as a fallback for anyone already hosting it that way.
const UPDATE_MANIFESTS = process.env.SG_UPDATE_URL
  ? [process.env.SG_UPDATE_URL]
  : ['https://streamgraphicspro.com/sgpro-version.json', 'https://streamgraphicspro.com/latest.json'];
let _updCache = { at: 0, data: null };
function cmpVer(a, b) { const A = String(a).split('.').map(n => parseInt(n, 10) || 0), B = String(b).split('.').map(n => parseInt(n, 10) || 0); for (let i = 0; i < 3; i++) { if ((A[i] || 0) > (B[i] || 0)) return 1; if ((A[i] || 0) < (B[i] || 0)) return -1; } return 0; }
// Fetch one manifest URL. Calls back with the parsed object, or null on any failure.
function fetchManifest(url, cb) {
  let done = false;
  const finish = j => { if (!done) { done = true; cb(j); } };
  try {
    const req = https.get(url, { timeout: 4000 }, res => {
      if (res.statusCode !== 200) { res.resume(); finish(null); return; }
      let d = '';
      res.on('data', c => { d += c; if (d.length > 5000) req.destroy(); });
      res.on('end', () => { let j = null; try { j = JSON.parse(d); } catch (e) {} finish(j && j.version ? j : null); });
    });
    req.on('error', () => finish(null));
    req.on('timeout', () => { req.destroy(); finish(null); });
  } catch (e) { finish(null); }
}
function checkUpdate(cb) {
  if (Date.now() - _updCache.at < 6 * 3600 * 1000) { cb(_updCache.data); return; }
  const tryAt = i => {
    if (i >= UPDATE_MANIFESTS.length) { _updCache = { at: Date.now(), data: null }; cb(null); return; }
    fetchManifest(UPDATE_MANIFESTS[i], j => {
      if (j) { _updCache = { at: Date.now(), data: j }; cb(j); return; }
      tryAt(i + 1);
    });
  };
  tryAt(0);
}

/* ------------------------------------------------------------------ *
 *  LICENSING — offline, signed keys. The app carries the PUBLIC key and
 *  verifies a license key locally (no internet needed). Keys are minted by
 *  the vendor with the matching PRIVATE key (see make-license.js). A valid
 *  key removes the watermark and unlocks whatever features/add-ons it lists.
 * ------------------------------------------------------------------ */
const LICENSE_PUBKEY = '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAJs8woCgSG2s/b0pxFyLszVQSK2EvYlZb3rurwco51lc=\n-----END PUBLIC KEY-----\n';
// A key is "<base64url(payload JSON)>.<base64url(signature)>". Returns the payload if valid, else null.
function verifyLicense(key) {
  try {
    const parts = String(key || '').trim().split('.');
    if (parts.length !== 2) return null;
    const payload = Buffer.from(parts[0], 'base64url');
    const sig = Buffer.from(parts[1], 'base64url');
    if (!crypto.verify(null, payload, LICENSE_PUBKEY, sig)) return null;
    const data = JSON.parse(payload.toString('utf8'));
    if (data.exp && Date.now() > data.exp) return null;   // expired
    return data;   // { name, tier, features:[], exp, upto? }
  } catch (e) { return null; }
}
// A license may cap the MAJOR version it unlocks (data.upto). No upto = covers every version (lifetime).
// e.g. upto:1 unlocks all 1.x; when the app updates to 2.x the key stops unlocking (watermark returns) until upgraded.
function licCoversVersion(lic) {
  if (!lic || lic.upto == null || lic.upto === '') return true;
  const maj = parseInt(String(VERSION).split('.')[0], 10) || 0;
  return maj <= (parseInt(lic.upto, 10) || 0);
}
// "licensed" = key is valid AND it covers the running version.
function isLicensed() { return !!state.license.active && licCoversVersion(state.license); }
const UPLOAD_DIR = path.join(PUBLIC_DIR, 'uploads');
const MEDIA_DIR = path.join(PUBLIC_DIR, 'media');   // CSV images live here, organised in per-show/event subfolders
try { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch (e) {}
try { fs.mkdirSync(MEDIA_DIR, { recursive: true }); } catch (e) {}
let uploadSeq = 0;

const IMG_RE = /\.(png|jpe?g|gif|webp|svg)$/i;
function sanitizeSeg(s) { return String(s || '').replace(/[^a-zA-Z0-9._ -]/g, '_').replace(/^\.+/, '').slice(0, 100); }
// Resolve a media-relative path ("folder/name.jpg" or "name.jpg") to an absolute path inside MEDIA_DIR.
function mediaPath(rel) {
  const parts = String(rel || '').replace(/\\/g, '/').split('/').filter(p => p && p !== '.' && p !== '..').map(sanitizeSeg);
  if (!parts.length) return null;
  const full = path.join(MEDIA_DIR, ...parts);
  return full.startsWith(MEDIA_DIR) ? full : null;
}
// Index of media images (one folder level deep) — kept in memory so the outputs can resolve a
// CSV's bare filename to wherever it actually lives, even inside a show/event folder.
let mediaIndex = [];   // array of relative paths e.g. ["Grad2026/jane.jpg", "logo.png"]
function refreshMediaIndex() {
  const out = [];
  try {
    fs.readdirSync(MEDIA_DIR, { withFileTypes: true }).forEach(e => {
      if (e.isFile() && IMG_RE.test(e.name)) out.push(e.name);
      else if (e.isDirectory()) {
        try { fs.readdirSync(path.join(MEDIA_DIR, e.name)).forEach(f => { if (IMG_RE.test(f)) out.push(e.name + '/' + f); }); } catch (x) {}
      }
    });
  } catch (x) {}
  mediaIndex = out;
}
refreshMediaIndex();

/* ------------------------------------------------------------------ *
 *  State
 *  One graphic for Milestone 1: the timer family (countdown / count-up /
 *  countdown-to-clock-time). State is stored generically so more graphics
 *  and more feeds can be added later without changing the transport.
 * ------------------------------------------------------------------ */
let boardSeq = 0;
function defaultScoreboard(name) {
  return {
    id: 'brd' + (Date.now().toString(36)) + (boardSeq++),
    name: String(name || 'Scoreboard'),
    visible: false,
    title: 'HERMOSA BEACH OPEN 2025',
    presenter: 'WEDBUSH',
    bracketLabel: "MEN'S CONTENDER'S BRACKET",
    eventLogoUrl: '', eventLogoPlacement: 'inline', eventLogoSize: 150,
    gamesCount: 3,
    activeGame: 0,
    teams: [
      { p1: 'Terese Cannon', p2: 'Megan Kraft', seed: '1', color: '#f5c518', rowColor: '', textColor: '', logoUrl: '', games: [0, null, null] },
      { p1: 'Kelly Cheng',   p2: 'Molly Shaw',  seed: '2', color: '#1f7a8c', rowColor: '', textColor: '', logoUrl: '', games: [0, null, null] }
    ],
    style: { position: 'bottom-left', animation: 'slide-up', accent: '#1e64d2', bracketColor: '#7a1420', backdropUrl: '', chroma: '' }
  };
}
// Resolve a board by id (from an action / URL) — falls back to the first board.
function boardOf(id) {
  const list = state.scoreboards || [];
  return (id && list.find(b => b.id === id)) || list[0];
}

function defaultState() {
  return {
    timer: {
      mode: 'down',        // 'down' = countdown, 'up' = count-up, 'tod' = countdown to a clock time
      running: false,
      // Time math is anchored to the SERVER clock so every machine agrees, even if
      // their local clocks differ. The output computes the live value itself at 60fps.
      anchorServer: 0,     // server time (ms) when the timer was last started/resumed
      baseMs: 5 * 60000,   // countdown: remaining at anchor; count-up: elapsed at anchor
      durationMs: 5 * 60000, // the value "Reset" returns a countdown to
      targetEpoch: 0,      // 'tod' mode: absolute clock time to count down to
      showHours: false,    // display hh:mm:ss vs mm:ss
      label: '',           // optional line above the time
      // Speaker / confidence-monitor mode: a warning threshold + optional overtime.
      warnMs: 0,           // 0 = off; >0 = go amber when remaining <= this, red at/under 0
      overtime: false,     // when true, a countdown keeps going NEGATIVE past zero (overtime)
      flash: false,        // flash the background in warning/over (to really get attention)
      visible: false,      // drives the in/out animation on the output
      // Look — all live-editable from the panel.
      style: {
        font: "'Segoe UI', 'Helvetica Neue', Arial, sans-serif",
        color: '#ffffff',
        accent: '#12b886',       // pill / bar accent
        bg: '#0b1f3ae6',         // pill background (8-digit hex = with alpha)
        size: 120,               // px, the time text
        position: 'bottom-center', // one of 9 anchor points
        animation: 'slide-up'    // 'slide-up' | 'fade' | 'scale'
      }
    },

    // The scoreboard graphic. General-purpose (any 2-side match with up to 3 games),
    // shipped configured for the beach-volley board but reusable. Each game score is
    // either a number or null (null renders as "--", i.e. that game hasn't started).
    // Multiple independent scoreboards ("courts"), each with its own control + output URL
    // (…/scoreboard?board=<id> and …/scoreboard-output?board=<id>). Starts with one.
    scoreboards: [defaultScoreboard('Court 1')],

    // The lower-third BUILDER: a free-form canvas (1920x1080) of independent
    // layers (text / box / image). Each layer is positioned + sized by pixel,
    // stacked by z, styled, and animated on its own (with a delay for staggering).
    // This is the WYSIWYG, no-template flexibility — nothing is hard-coded.
    lowerthird: {
      visible: false,
      chroma: '',
      w: 1920, h: 1080,
      vcmd: { id: '', cmd: '', seq: 0 },   // transient video playback command (play/pause/restart)
      editingShowId: '',                   // which library preset (if any) the builder is currently editing
      layers: defaultLowerThirdLayers()
    },

    // The Show Library — saved named graphics, recallable and toggleable on the Program output.
    shows: [],
    // User-made / imported Templates (built-ins are added on top in wireState/allTemplates).
    userTemplates: [],
    // Installed template packs (metadata only — the designs live in userTemplates, tagged by pack id).
    packs: [],
    // Baseball / softball scoreboard — a clock-free sport, so it's the first of the
    // new sports. Innings are adjustable (softball/youth vary by age & level).
    baseball: defaultBaseball(),
    // Teleprompter — its own module: a script, a server-anchored scroll position, and a look.
    prompter: defaultPrompter(),
    // License (free by default → watermark on, add-ons off).
    license: { active: false, key: '', name: '', tier: 'free', features: [] }
  };
}

// Baseball/softball board. Away bats the TOP of an inning, Home the BOTTOM.
// Each team's line[] holds runs per inning (null = not batted yet); total R = sum.
function defaultBaseball() {
  return {
    visible: false,
    innings: 7,                 // adjustable 1..12 (softball 7, baseball 9, youth 6…)
    inning: 1, half: 'top',     // current at-bat
    balls: 0, strikes: 0, outs: 0,
    bases: { first: false, second: false, third: false },
    teams: [
      { name: 'Away', abbr: 'AWY', color: '#1d4e86', logoUrl: '', line: [0, null, null, null, null, null, null], hits: 0, errors: 0 },
      { name: 'Home', abbr: 'HOM', color: '#8a1c1c', logoUrl: '', line: [null, null, null, null, null, null, null], hits: 0, errors: 0 }
    ],
    style: {
      position: 'bottom-left',
      accent: '#f4a63c',
      chroma: '',
      animation: 'slide-up',
      showLine: true,           // show the per-inning line score strip
      showClock: false,         // clock slot (off for baseball; here so clock sports reuse the layout)
      clockText: ''
    }
  };
}
// Keep every team's line[] exactly `innings` long (pad with null, trim extras).
function ensureBaseballShape(bb) {
  var n = Math.max(1, Math.min(12, parseInt(bb.innings, 10) || 7));
  bb.innings = n;
  (bb.teams || []).forEach(function (t) {
    if (!Array.isArray(t.line)) t.line = [];
    while (t.line.length < n) t.line.push(null);
    if (t.line.length > n) t.line.length = n;
  });
  if (bb.inning > n) bb.inning = n;
  if (bb.inning < 1) bb.inning = 1;
}
function baseballRuns(t) { return (t.line || []).reduce(function (s, v) { return s + (v == null ? 0 : (parseInt(v, 10) || 0)); }, 0); }

/* ------------------------------------------------------------------ *
 *  TELEPROMPTER
 *
 *  The scroll POSITION lives here, on the server, exactly like the timer's clock —
 *  not in each browser. Every screen reads the same number and computes its own
 *  frame at 60fps, so a confidence monitor, a mirrored beam-splitter feed and an
 *  OBS browser source cannot drift apart, and a source that reloads mid-take comes
 *  back where the script IS rather than at the top.
 *
 *  Position is carried in the pixels of a REFERENCE layout (`geom.total`), reported
 *  by whichever prompter page rendered last. Each screen converts
 *  position/refTotal -> its own pixels, so screens whose fonts measure slightly
 *  differently (a phone vs the studio PC) still show the same line at the same moment.
 * ------------------------------------------------------------------ */
const PROMPT_STARTER = [
  '## Welcome',
  '',
  'This is the teleprompter. Type or paste your script here, then press Play.',
  '',
  'Left and right arrows change the speed while it runs. Up and down jump back and ahead. The space bar starts and stops.',
  '',
  '## Bookmarks',
  '',
  'Any line starting with two hashes is a bookmark. They show up as buttons on the control panel, so you can jump straight to a section instead of holding an arrow down and hunting for it.',
  '',
  '## Two screens at once',
  '',
  'The mirrored output is a separate address from the normal one, so glass in front of the lens and a confidence monitor at the back of the room can run from this one script at the same time.'
].join('\n');

function defaultPrompter() {
  return {
    visible: false,
    script: PROMPT_STARTER,
    running: false,
    anchorServer: 0,     // server time (ms) when scrolling last started/resumed
    basePx: 0,           // reference-layout scroll offset at the anchor
    speed: 40,           // reference px per second
    jumpPx: 220,         // how far one up/down arrow press moves
    // Reference layout, measured in a browser and reported back (action 'pr_geom').
    geom: { sig: '', src: '', total: 0, marks: [] },
    style: {
      font: "'Segoe UI', 'Helvetica Neue', Arial, sans-serif",
      size: 64,             // px on the 1920x1080 stage
      lineHeight: 1.45,
      bold: true,
      align: 'left',
      width: 82,            // script column, % of stage width
      color: '#ffffff',
      bg: '#0a0a0a',        // '' = transparent (key it over a shot instead)
      chroma: '',
      showMarks: true,      // draw the ## bookmark lines on screen
      markColor: '#f4a63c',
      cue: 'both',          // reading indicator: 'line' | 'arrows' | 'both' | 'none'
      cuePos: 38,           // % down the screen
      cueColor: '#e03131',
      fade: true            // soften the top and bottom edges
    }
  };
}

/* Furthest the script can scroll, in reference pixels.
 * 🚨 -1 means NOTHING HAS MEASURED THIS LAYOUT YET, which is not the same as a measured
 * ceiling of 0. Collapsing the two lets an empty script scroll away forever: there is
 * nothing to show, no ceiling to stop at, and the position runs off while the screen sits
 * blank. A real measurement of 0 is a genuine ceiling and must clamp. */
function promptMaxPx(p) { return (p.geom && p.geom.sig) ? Math.max(0, p.geom.total) : -1; }

function livePromptPx(p, now) {
  const px = p.basePx + ((p.running && p.speed > 0) ? (now - p.anchorServer) * p.speed / 1000 : 0);
  const max = promptMaxPx(p);
  if (!(px > 0)) return 0;
  return (max >= 0 && px > max) ? max : px;
}

// Move to an absolute position and re-anchor. Re-anchoring matters: without it a running
// scroll would replay the elapsed time from the NEW base and jump forward again.
function setPromptPos(p, px, now) {
  const max = promptMaxPx(p);
  let v = Number(px); if (!isFinite(v) || v < 0) v = 0;
  if (max >= 0 && v > max) v = max;
  p.basePx = v;
  p.anchorServer = now;
}

function defaultLowerThirdLayers() {
  // Each layer has an independent ANIMATE-ON (in) and ANIMATE-OFF (out), and each
  // of those has its own delay + duration — so you can stagger (e.g. bring the
  // background on, then reveal the text 500ms later).
  return [
    { id: 'bg',     type: 'box',   x: 150, y: 915, w: 600, h: 96, z: 1, fill: '#0b1f3a', opacity: 95, radius: 12,
      inAnim: 'slide-up', inDelay: 0,   inDur: 550, outAnim: 'slide-up', outDelay: 120, outDur: 400 },
    { id: 'accent', type: 'box',   x: 150, y: 915, w: 8,   h: 96, z: 2, fill: '#e7b53c', opacity: 100, radius: 12,
      inAnim: 'slide-up', inDelay: 80,  inDur: 500, outAnim: 'fade',     outDelay: 80,  outDur: 300 },
    { id: 'name',   type: 'text',  x: 182, y: 928, w: 560, h: 42, z: 3, text: 'Jordan Mitchell', font: "'Segoe UI', Arial, sans-serif", size: 34, bold: true,  italic: false, color: '#ffffff', align: 'left',
      inAnim: 'slide-left', inDelay: 220, inDur: 500, outAnim: 'fade',   outDelay: 0,   outDur: 250 },
    { id: 'title',  type: 'text',  x: 182, y: 972, w: 560, h: 28, z: 4, text: 'HEAD COACH · SEA HAWKS', font: "'Segoe UI', Arial, sans-serif", size: 17, bold: false, italic: false, color: '#e7b53c', align: 'left',
      inAnim: 'slide-left', inDelay: 300, inDur: 500, outAnim: 'fade',   outDelay: 0,   outDur: 250 }
  ];
}

let state = defaultState();

/* ------------------------------------------------------------------ *
 *  Team Library — the operator's saved teams (names, colours, logo, roster).
 *  Loaded from data/library.json if present, otherwise seeded from the sheet
 *  the client sent (data/teams.seed.json). Persisted on import so it survives
 *  restarts. This is the "mail-merge" list: pick a team to fill a match side.
 * ------------------------------------------------------------------ */
const DATA_DIR = path.join(__dirname, 'data');
const LIB_FILE = path.join(DATA_DIR, 'library.json');
const SEED_FILE = path.join(DATA_DIR, 'teams.seed.json');
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {}

function loadLibrary() {
  for (const f of [LIB_FILE, SEED_FILE]) {
    try {
      if (fs.existsSync(f)) {
        const j = JSON.parse(fs.readFileSync(f, 'utf8'));
        if (j && Array.isArray(j.teams)) return j.teams;
      }
    } catch (e) {}
  }
  return [];
}
// Debounced async disk writes — never block the request/broadcast hot path (saving a big
// preset or toggling on/off used to stall while a synchronous write finished).
const _writeTimers = {};
function writeJson(file, getObj) {
  clearTimeout(_writeTimers[file]);
  _writeTimers[file] = setTimeout(function () {
    try { fs.writeFile(file, JSON.stringify(getObj(), null, 2), function () {}); } catch (e) {}
  }, 300);
}
function saveLibrary() { writeJson(LIB_FILE, function () { return { teams: state.library.teams }; }); }
state.library = { teams: loadLibrary() };

// Persist the lower-third design so a saved layout survives a restart.
const LT_FILE = path.join(DATA_DIR, 'lowerthird.json');
(function () {
  try {
    if (fs.existsSync(LT_FILE)) {
      const j = JSON.parse(fs.readFileSync(LT_FILE, 'utf8'));
      if (j && Array.isArray(j.layers)) state.lowerthird.layers = j.layers;
    }
  } catch (e) {}
})();
function saveLowerThird() { writeJson(LT_FILE, function () { return { layers: state.lowerthird.layers }; }); }

// The TELEPROMPTER script + look. The live scroll position is deliberately NOT saved — a
// restart should hand you the script back at the top, not halfway down last night's read.
const PROMPT_FILE = path.join(DATA_DIR, 'prompter.json');
(function () {
  try {
    if (fs.existsSync(PROMPT_FILE)) {
      const j = JSON.parse(fs.readFileSync(PROMPT_FILE, 'utf8'));
      if (j && typeof j.script === 'string') state.prompter.script = j.script;
      if (j && j.style) Object.assign(state.prompter.style, j.style);
      if (j && j.speed != null) state.prompter.speed = Math.max(0, Math.min(600, Number(j.speed) || 0));
      if (j && j.jumpPx != null) state.prompter.jumpPx = Math.max(20, Math.min(2000, Number(j.jumpPx) || 220));
    }
  } catch (e) {}
})();
function savePrompter() {
  writeJson(PROMPT_FILE, function () {
    const p = state.prompter;
    return { script: p.script, style: p.style, speed: p.speed, jumpPx: p.jumpPx };
  });
}

// The SHOW LIBRARY — saved, named graphics ("presets") that can be recalled or toggled on air.
// Each item: { id, name, kind, payload, on }. Persisted so the library survives restarts.
const SHOWS_FILE = path.join(DATA_DIR, 'shows.json');
(function () {
  try {
    if (fs.existsSync(SHOWS_FILE)) {
      const j = JSON.parse(fs.readFileSync(SHOWS_FILE, 'utf8'));
      if (j && Array.isArray(j.items)) state.shows = j.items;
    }
  } catch (e) {}
})();
function saveShows() { writeJson(SHOWS_FILE, function () { return { items: state.shows }; }); }

// TEMPLATES — reusable starting designs you load into the Graphics Builder (distinct from the
// Show Library, which holds finished on-air graphics). Built-ins ship with the app; user-made and
// imported templates persist. Each: { id, name, kind, layers, builtin }.
const TPL_FILE = path.join(DATA_DIR, 'templates.json');
function builtinTemplates() {
  const an = (i, o) => ({ inAnim: i || 'fade', inDelay: 0, inDur: 500, outAnim: o || 'fade', outDelay: 0, outDur: 350 });
  return [
    { id: 'bt_lower3', name: 'Lower Third — Clean', kind: 'lowerthird', builtin: true, layers: [
      Object.assign({ id: 'bg', type: 'box', x: 150, y: 915, w: 620, h: 96, z: 1, fill: '#0b1f3a', opacity: 92, radius: 12 }, an('slide-up', 'slide-up')),
      Object.assign({ id: 'ac', type: 'box', x: 150, y: 915, w: 8, h: 96, z: 2, fill: '#e7b53c', opacity: 100, radius: 12 }, { inAnim: 'slide-up', inDelay: 80, inDur: 500, outAnim: 'fade', outDelay: 60, outDur: 300 }),
      Object.assign({ id: 'nm', type: 'text', x: 182, y: 928, w: 560, h: 42, z: 3, text: 'First Last', field: 'Name', font: "'Segoe UI', Arial, sans-serif", size: 34, bold: true, color: '#ffffff', align: 'left' }, { inAnim: 'slide-left', inDelay: 220, inDur: 480, outAnim: 'fade', outDelay: 0, outDur: 250 }),
      Object.assign({ id: 'tt', type: 'text', x: 182, y: 972, w: 560, h: 28, z: 4, text: 'TITLE / ROLE', field: 'Title', font: "'Segoe UI', Arial, sans-serif", size: 17, color: '#e7b53c', align: 'left' }, { inAnim: 'slide-left', inDelay: 300, inDur: 480, outAnim: 'fade', outDelay: 0, outDur: 250 })
    ] },
    { id: 'bt_namebar', name: 'Name Bar — Minimal', kind: 'lowerthird', builtin: true, layers: [
      Object.assign({ id: 'bg', type: 'box', x: 150, y: 958, w: 540, h: 72, z: 1, fill: '#111418', opacity: 88, radius: 8 }, an('fly-left', 'fly-left')),
      Object.assign({ id: 'nm', type: 'text', x: 176, y: 970, w: 500, h: 48, z: 2, text: 'First Last', field: 'Name', font: "'Segoe UI', Arial, sans-serif", size: 30, bold: true, color: '#ffffff', align: 'left' }, { inAnim: 'none', inDur: 500, outAnim: 'none', outDur: 350 })
    ] },
    { id: 'bt_title', name: 'Title Card — Centered', kind: 'lowerthird', builtin: true, layers: [
      Object.assign({ id: 'ti', type: 'text', x: 260, y: 420, w: 1400, h: 120, z: 2, text: 'MAIN TITLE', field: 'Title', font: 'Impact, Haettenschweiler, sans-serif', size: 92, bold: true, color: '#ffffff', align: 'center' }, an('pop', 'fade')),
      Object.assign({ id: 'su', type: 'text', x: 260, y: 556, w: 1400, h: 50, z: 3, text: 'subtitle goes here', field: 'Subtitle', font: "'Segoe UI', Arial, sans-serif", size: 32, color: '#e7b53c', align: 'center' }, { inAnim: 'fade', inDelay: 180, inDur: 500, outAnim: 'fade', outDelay: 0, outDur: 300 })
    ] },
    { id: 'bt_countdown', name: 'Countdown Card', kind: 'lowerthird', builtin: true, layers: [
      Object.assign({ id: 'bx', type: 'box', x: 760, y: 410, w: 400, h: 250, z: 1, fill: '#101418', opacity: 88, radius: 16 }, an('scale', 'scale')),
      Object.assign({ id: 'lb', type: 'text', x: 760, y: 436, w: 400, h: 40, z: 2, text: 'STARTING IN', font: "'Segoe UI', Arial, sans-serif", size: 24, color: '#9fb0c8', align: 'center' }, an('fade', 'fade')),
      Object.assign({ id: 'tm', type: 'timer', x: 760, y: 480, w: 400, h: 150, z: 3, mode: 'down', durationMs: 300000, baseMs: 300000, running: false, anchorServer: 0, showHours: false, font: "'Segoe UI', Arial, sans-serif", size: 96, bold: true, color: '#ffffff', align: 'center' }, an('fade', 'fade'))
    ] },
    { id: 'bt_ticker', name: 'News Ticker', kind: 'lowerthird', builtin: true, layers: [
      Object.assign({ id: 'tk', type: 'ticker', x: 0, y: 1000, w: 1920, h: 60, z: 1, text: 'BREAKING: your scrolling headline goes here', speed: 120, dir: 'left', font: 'Arial, sans-serif', size: 30, bold: true, color: '#ffffff', fill: '#0b1f3a', opacity: 92, radius: 0 }, an('slide-up', 'slide-up'))
    ] },
    { id: 'bt_bug', name: 'Corner LIVE Bug', kind: 'lowerthird', builtin: true, layers: [
      Object.assign({ id: 'bx', type: 'box', x: 1690, y: 40, w: 160, h: 58, z: 1, fill: '#000000', opacity: 45, radius: 10 }, an('fade', 'fade')),
      Object.assign({ id: 'lv', type: 'text', x: 1706, y: 50, w: 130, h: 38, z: 2, text: '● LIVE', font: "'Segoe UI', Arial, sans-serif", size: 26, bold: true, color: '#ff3b30', align: 'left' }, an('fade', 'fade'))
    ] },
    // --- more lower thirds (varied colours) ---
    { id: 'bt_lt_red', name: 'Lower Third — Crimson', kind: 'lowerthird', builtin: true, layers: [
      Object.assign({ id: 'bg', type: 'box', x: 150, y: 915, w: 620, h: 96, z: 1, fill: '#1a1518', opacity: 93, radius: 12 }, an('slide-up', 'slide-up')),
      Object.assign({ id: 'ac', type: 'box', x: 150, y: 915, w: 8, h: 96, z: 2, fill: '#e23b3b', opacity: 100, radius: 12 }, an('slide-up', 'fade')),
      Object.assign({ id: 'nm', type: 'text', x: 182, y: 928, w: 560, h: 42, z: 3, text: 'First Last', field: 'Name', font: "'Segoe UI', Arial, sans-serif", size: 34, bold: true, color: '#ffffff', align: 'left' }, { inAnim: 'slide-left', inDelay: 220, inDur: 480, outAnim: 'fade', outDur: 250 }),
      Object.assign({ id: 'tt', type: 'text', x: 182, y: 972, w: 560, h: 28, z: 4, text: 'TITLE / ROLE', field: 'Title', font: "'Segoe UI', Arial, sans-serif", size: 17, color: '#e23b3b', align: 'left' }, { inAnim: 'slide-left', inDelay: 300, inDur: 480, outAnim: 'fade', outDur: 250 })
    ] },
    { id: 'bt_lt_teal', name: 'Lower Third — Teal', kind: 'lowerthird', builtin: true, layers: [
      Object.assign({ id: 'bg', type: 'box', x: 150, y: 915, w: 620, h: 96, z: 1, fill: '#0c2b2f', opacity: 93, radius: 12 }, an('fly-left', 'fly-left')),
      Object.assign({ id: 'ac', type: 'box', x: 150, y: 915, w: 8, h: 96, z: 2, fill: '#17b0a3', opacity: 100, radius: 12 }, { inAnim: 'none', outAnim: 'none' }),
      Object.assign({ id: 'nm', type: 'text', x: 182, y: 928, w: 560, h: 42, z: 3, text: 'First Last', field: 'Name', font: "'Segoe UI', Arial, sans-serif", size: 34, bold: true, color: '#ffffff', align: 'left' }, { inAnim: 'none', outAnim: 'none' }),
      Object.assign({ id: 'tt', type: 'text', x: 182, y: 972, w: 560, h: 28, z: 4, text: 'TITLE / ROLE', field: 'Title', font: "'Segoe UI', Arial, sans-serif", size: 17, color: '#17b0a3', align: 'left' }, { inAnim: 'none', outAnim: 'none' })
    ] },
    { id: 'bt_lt_wide', name: 'Lower Third — Wide Bar', kind: 'lowerthird', builtin: true, layers: [
      Object.assign({ id: 'bar', type: 'box', x: 0, y: 980, w: 1920, h: 100, z: 1, fill: '#0b1f3a', opacity: 94, radius: 0 }, an('slide-up', 'slide-up')),
      Object.assign({ id: 'nm', type: 'text', x: 120, y: 992, w: 1000, h: 44, z: 2, text: 'First Last', field: 'Name', font: "'Segoe UI', Arial, sans-serif", size: 36, bold: true, color: '#ffffff', align: 'left' }, { inAnim: 'fade', inDelay: 150, inDur: 400, outAnim: 'fade', outDur: 250 }),
      Object.assign({ id: 'tt', type: 'text', x: 120, y: 1036, w: 1000, h: 30, z: 3, text: 'TITLE / ROLE', field: 'Title', font: "'Segoe UI', Arial, sans-serif", size: 18, color: '#e7b53c', align: 'left' }, { inAnim: 'fade', inDelay: 220, inDur: 400, outAnim: 'fade', outDur: 250 })
    ] },
    // --- big screens / full frames ---
    { id: 'bt_fs_navy', name: 'Full Screen — Navy Title', kind: 'lowerthird', builtin: true, layers: [
      Object.assign({ id: 'bgf', type: 'box', x: 0, y: 0, w: 1920, h: 1080, z: 1, fill: '#0b1f3a', opacity: 100, radius: 0 }, an('fade', 'fade')),
      Object.assign({ id: 'ti', type: 'text', x: 260, y: 430, w: 1400, h: 150, z: 2, text: 'MAIN TITLE', field: 'Title', font: 'Impact, Haettenschweiler, sans-serif', size: 100, bold: true, color: '#ffffff', align: 'center' }, an('pop', 'fade')),
      Object.assign({ id: 'su', type: 'text', x: 260, y: 596, w: 1400, h: 50, z: 3, text: 'subtitle goes here', field: 'Subtitle', font: "'Segoe UI', Arial, sans-serif", size: 34, color: '#e7b53c', align: 'center' }, { inAnim: 'fade', inDelay: 180, inDur: 500, outAnim: 'fade', outDur: 300 })
    ] },
    { id: 'bt_fs_color', name: 'Full Screen — Colour Background', kind: 'lowerthird', builtin: true, layers: [
      Object.assign({ id: 'bgf', type: 'box', x: 0, y: 0, w: 1920, h: 1080, z: 1, fill: '#6d5cf6', opacity: 100, radius: 0 }, an('fade', 'fade')),
      Object.assign({ id: 'ti', type: 'text', x: 260, y: 470, w: 1400, h: 150, z: 2, text: 'YOUR MESSAGE', field: 'Title', font: "'Segoe UI', Arial, sans-serif", size: 96, bold: true, color: '#ffffff', align: 'center' }, an('scale', 'fade'))
    ] },
    { id: 'bt_fs_photo', name: 'Full Screen — Photo Background', kind: 'lowerthird', builtin: true, layers: [
      Object.assign({ id: 'ph', type: 'image', x: 0, y: 0, w: 1920, h: 1080, z: 1, src: '', field: 'Background', shape: 'none', fit: 'cover' }, an('fade', 'fade')),
      Object.assign({ id: 'ov', type: 'box', x: 0, y: 700, w: 1920, h: 380, z: 2, fill: '#000000', opacity: 55, radius: 0 }, an('fade', 'fade')),
      Object.assign({ id: 'ti', type: 'text', x: 120, y: 800, w: 1680, h: 120, z: 3, text: 'MAIN TITLE', field: 'Title', font: "'Segoe UI', Arial, sans-serif", size: 84, bold: true, color: '#ffffff', align: 'left' }, { inAnim: 'slide-up', inDelay: 120, inDur: 500, outAnim: 'fade', outDur: 300 })
    ] },
    { id: 'bt_next', name: 'Coming Up Next', kind: 'lowerthird', builtin: true, layers: [
      Object.assign({ id: 'bx', type: 'box', x: 150, y: 840, w: 940, h: 180, z: 1, fill: '#101418', opacity: 90, radius: 14 }, an('slide-up', 'slide-up')),
      Object.assign({ id: 'lb', type: 'text', x: 182, y: 862, w: 880, h: 34, z: 2, text: 'COMING UP NEXT', font: "'Segoe UI', Arial, sans-serif", size: 22, bold: true, color: '#e7b53c', align: 'left' }, an('fade', 'fade')),
      Object.assign({ id: 'ti', type: 'text', x: 182, y: 902, w: 880, h: 90, z: 3, text: 'Next segment title', field: 'Title', font: "'Segoe UI', Arial, sans-serif", size: 46, bold: true, color: '#ffffff', align: 'left' }, { inAnim: 'slide-left', inDelay: 150, inDur: 450, outAnim: 'fade', outDur: 250 })
    ] },
    { id: 'bt_sponsor', name: 'Sponsor Bar', kind: 'lowerthird', builtin: true, layers: [
      Object.assign({ id: 'bar', type: 'box', x: 0, y: 985, w: 1920, h: 95, z: 1, fill: '#ffffff', opacity: 100, radius: 0 }, an('slide-up', 'slide-up')),
      Object.assign({ id: 'lb', type: 'text', x: 120, y: 1012, w: 700, h: 42, z: 2, text: 'SPONSORED BY', font: "'Segoe UI', Arial, sans-serif", size: 26, bold: true, color: '#111111', align: 'left' }, an('fade', 'fade')),
      Object.assign({ id: 'lg', type: 'image', x: 1470, y: 998, w: 330, h: 70, z: 3, src: '', field: 'Logo', shape: 'none', fit: 'contain' }, an('fade', 'fade'))
    ] }
  ];
}
(function () {
  try { if (fs.existsSync(TPL_FILE)) { const j = JSON.parse(fs.readFileSync(TPL_FILE, 'utf8')); if (j && Array.isArray(j.items)) state.userTemplates = j.items; if (j && Array.isArray(j.packs)) state.packs = j.packs; } } catch (e) {}
})();
function saveTemplates() { writeJson(TPL_FILE, function () { return { items: state.userTemplates, packs: state.packs || [] }; }); }
function allTemplates() { return builtinTemplates().concat(state.userTemplates || []); }

/* TEMPLATE PACKS — a named, shippable bundle of templates. A pack is just a JSON file, so it
 * can be sold, emailed or dropped in a shared folder. Installing one tags each of its templates
 * with the pack id, which is what makes "uninstall the whole pack" possible later — without
 * that tag you could never tell a pack's designs apart from the user's own. */
const PACK_LIMIT = 60;
function packMeta(p) {
  return {
    id: String(p.id || '').slice(0, 64), name: String(p.name || 'Untitled pack').slice(0, 120),
    author: String(p.author || '').slice(0, 120), version: String(p.version || '1.0').slice(0, 20),
    description: String(p.description || '').slice(0, 600),
    installed: p.installed || new Date().toISOString()
  };
}

// Apply a license key to state (verifying it). Returns the (public) status.
const LIC_FILE = path.join(DATA_DIR, 'license.json');
function applyLicense(key) {
  const data = verifyLicense(key);
  if (data) state.license = { active: true, key: key, name: data.name || '', tier: data.tier || 'pro', features: Array.isArray(data.features) ? data.features : [], upto: (data.upto != null ? data.upto : null) };
  else state.license = { active: false, key: '', name: '', tier: 'free', features: [], upto: null };
  return state.license.active;
}
(function () { try { if (fs.existsSync(LIC_FILE)) { const j = JSON.parse(fs.readFileSync(LIC_FILE, 'utf8')); if (j && j.key) applyLicense(j.key); } } catch (e) {} })();
function saveLicense() { writeJson(LIC_FILE, function () { return { key: state.license.key || '' }; }); }
function hasFeature(f) { return isLicensed() && (state.license.features || []).indexOf(f) >= 0; }

// A lighter view of state for the SSE stream: OFF presets travel as metadata only (no big
// payload), so toggling/saving stays snappy no matter how large the library grows. The
// Program output only needs the payloads of presets that are ON; the Library list only
// needs names + on/off. Full payloads are fetched on demand (GET /show-payload?id=).
function wireState() {
  const shows = (state.shows || []).map(function (it) {
    // Reveal transport travels for every preset, on air or not, so the Show Library can offer
    // Next/Previous without pulling the whole payload down for presets that are off.
    const reveals = stepLayers(it).map(function (l) {
      return { id: l.id, name: l.name || '', type: l.type, index: (l.index == null ? -1 : l.index),
               count: stepCount(it, l) };
    });
    if (it.on) return Object.assign({}, it, { reveals: reveals }); // ON: in full (payload + rows) for the Program output
    // OFF: metadata only + light row info (labels for the picker), but not the heavy payload/rows.
    return {
      reveals: reveals,
      id: it.id, name: it.name, kind: it.kind, on: it.on,
      columns: it.columns || [], rowKey: it.rowKey || '', rowIndex: it.rowIndex || 0, rowTransition: it.rowTransition || 'cut', rowDelay: it.rowDelay == null ? 1000 : it.rowDelay,
      rowCount: it.rows ? it.rows.length : 0,
      rowLabels: it.rows ? it.rows.map(function (r) { return it.rowKey ? (r[it.rowKey] || '') : (r[Object.keys(r)[0]] || ''); }) : []
    };
  });
  // Templates travel as metadata only (name/kind/builtin); the layers are fetched on demand.
  const templates = allTemplates().map(function (t) { return { id: t.id, name: t.name, kind: t.kind, builtin: !!t.builtin, pack: t.pack || '' }; });
  // License: expose whether we're licensed + public info (never the key itself) — drives the watermark + gating.
  const covers = licCoversVersion(state.license);
  const lic = { active: !!state.license.active, name: state.license.name || '', tier: state.license.tier || 'free', features: state.license.features || [], upto: (state.license.upto != null ? state.license.upto : null), coversVersion: covers };
  return Object.assign({}, state, { license: lic, licensed: !!state.license.active && covers, shows: shows, media: mediaIndex, templates: templates });
}

/* ------------------------------------------------------------------ *
 *  SSE client registry
 * ------------------------------------------------------------------ */
const clients = new Set();

function broadcast() {
  const payload = JSON.stringify({ serverTime: Date.now(), version: VERSION, state: wireState() });
  const frame = `data: ${payload}\n\n`;
  for (const res of clients) {
    try { res.write(frame); } catch (e) { /* dropped; cleaned on close */ }
  }
}

/* ------------------------------------------------------------------ *
 *  Action reducer — the single place timer logic lives
 * ------------------------------------------------------------------ */
function liveValueMs(t, now) {
  // Current remaining (down/tod) or elapsed (up) in ms, given a server 'now'.
  if (t.mode === 'up') {
    return t.baseMs + (t.running ? now - t.anchorServer : 0);
  }
  if (t.mode === 'tod') {
    return Math.max(0, t.targetEpoch - now);
  }
  // countdown — in overtime mode it may go negative (past zero into overtime)
  const rem = t.baseMs - (t.running ? now - t.anchorServer : 0);
  return t.overtime ? rem : Math.max(0, rem);
}

/* ---- reveal transport, shared by slides and bullets ----
 * Mirrors public/sg-bullets.js step() so the server and every browser land on the same index.
 * slidesStyle: slides stop at the first slide when you step back; bullets step back to blank,
 * because "undo that last bullet" is a thing an operator does and un-showing slide 1 isn't. */
function stepIndex(cmd, index, n, gotoN, slidesStyle) {
  let i = (index == null ? -1 : index);
  if (cmd === 'next') { i = (i < 0 ? 0 : i + 1); i = n ? Math.min(i, n - 1) : -1; }
  else if (cmd === 'prev') { if (i > 0) i = i - 1; else if (i === 0 && !slidesStyle) i = -1; }
  else if (cmd === 'first') { i = n ? 0 : -1; }
  else if (cmd === 'last' || cmd === 'all') { i = n ? n - 1 : -1; }
  else if (cmd === 'blank' || cmd === 'reset') { i = -1; }
  else if (cmd === 'goto') { i = parseInt(gotoN, 10); if (isNaN(i)) i = -1; }
  return Math.max(-1, Math.min(n - 1, i));
}
/* ---- what a CSV-fed bullets layer is ACTUALLY showing right now ----
 * A bullets layer can take its whole list from one spreadsheet cell (the layer's "CSV field"
 * naming a column), split on "//" or a line break — so a "Talking points" column drives a
 * different build for every guest. The output has always drawn it that way; the transport
 * didn't. It counted the placeholder list typed into the design instead, so a row holding six
 * points reported "1 of 1" and Next stopped dead on the first one — and a design that left the
 * list empty on purpose (the spreadsheet supplies it) got no transport at all.
 * These three mirror fillLayers() in public/program-output.js exactly; if that splitting rule
 * ever changes, it changes in both places or the count and the screen disagree again. */
function csvCell(it, field) {
  if (!field || !it || !Array.isArray(it.rows) || !it.rows.length) return null;
  const row = it.rows[Math.max(0, Math.min(it.rows.length - 1, it.rowIndex || 0))];
  if (!row) return null;
  const f = String(field).toLowerCase();
  const k = Object.keys(row).find(x => x.toLowerCase() === f);   // column names are matched case-insensitively
  return k == null ? null : row[k];
}
function bulletItems(it, l) {
  if (!l || l.type !== 'bullets') return [];
  const v = csvCell(it, l.field);
  if (v == null || String(v).trim() === '') return l.items || [];   // no column, or an empty cell: use the design's own list
  return String(v).split(/\s*\/\/\s*|\r?\n/).map(s => s.trim()).filter(s => s.length);
}
// How many steps a layer has at this moment — bullets from the live list, slides from the deck.
function stepCount(it, l) {
  return (l && l.type === 'bullets') ? bulletItems(it, l).length : ((l && l.slides) || []).length;
}
// Every layer in a preset that can be stepped, in z order — what the transport UI and API drive.
function stepLayers(it) {
  if (!it || !it.payload || !Array.isArray(it.payload.layers)) return [];
  return it.payload.layers
    .filter(l => (l.type === 'bullets' || l.type === 'slides') && stepCount(it, l) > 0)
    .sort((a, b) => (a.z || 0) - (b.z || 0));
}

/* Moving to another spreadsheet row swaps the whole list, so the build goes back to the start.
 * Carrying "4 of 4" onto a guest with two points would dump their entire list on screen the
 * instant the row changed. Layers with "reset on air" switched off are left alone (a deliberate
 * static list), and so is any bullets layer the spreadsheet isn't feeding. */
function resetCsvBullets(it) {
  if (!it || !it.payload || !Array.isArray(it.payload.layers)) return;
  it.payload.layers.forEach(l => {
    if (l.type === 'bullets' && l.field && l.resetOnAir !== false && csvCell(it, l.field) != null) l.index = -1;
  });
}
// Editing a cell can shorten the list under a build that's already part-way through it.
function clampReveals(it) {
  if (!it || !it.payload || !Array.isArray(it.payload.layers)) return;
  it.payload.layers.forEach(l => {
    if (l.type !== 'bullets' || l.index == null) return;
    l.index = Math.max(-1, Math.min(l.index, stepCount(it, l) - 1));
  });
}
// Address a steppable layer by its id, or by the name shown in the Layers list, or take the first.
function findStepLayer(it, key) {
  const list = stepLayers(it);
  if (!list.length) return null;
  const k = String(key == null ? '' : key).trim();
  if (!k) return list[0];
  return list.find(l => l.id === k)
      || list.find(l => String(l.name || '').trim().toLowerCase() === k.toLowerCase())
      || null;
}

function applyAction(action) {
  const t = state.timer;
  const now = Date.now();
  switch (action.type) {
    case 'setMode':
      // Freeze the current value, then switch mode cleanly (paused).
      t.baseMs = t.mode === 'up' ? liveValueMs(t, now) : liveValueMs(t, now);
      t.running = false;
      t.mode = action.mode;
      if (t.mode === 'up') t.baseMs = 0;
      if (t.mode === 'down') t.baseMs = t.durationMs;
      break;

    case 'setDuration': // countdown length, in ms
      t.durationMs = Math.max(0, Number(action.ms) || 0);
      t.baseMs = t.durationMs;
      t.running = false;
      t.showHours = t.durationMs >= 3600000;
      break;

    case 'setTarget': // 'tod' target clock time; action.epoch is absolute ms
      // NB: epoch is a ~1.78e12 ms value — never use bitwise ops on it (they
      // truncate to 32-bit and corrupt the time). Keep it as a plain Number.
      t.targetEpoch = Number(action.epoch) || 0;
      t.mode = 'tod';
      t.running = true;
      t.showHours = (t.targetEpoch - now) >= 3600000;
      break;

    case 'start':
      if (!t.running) {
        t.anchorServer = now;
        t.running = true;
      }
      break;

    case 'pause':
      if (t.running) {
        t.baseMs = liveValueMs(t, now); // bank the current value
        t.running = false;
      }
      break;

    case 'reset':
      t.running = false;
      if (t.mode === 'up') t.baseMs = 0;
      else t.baseMs = t.durationMs;
      break;

    case 'adjust': // add/subtract seconds on the fly (e.g. +60, -30)
      {
        const cur = liveValueMs(t, now);
        let next = cur + (action.ms | 0);
        if (next < 0) next = 0;
        t.baseMs = next;
        if (t.running) t.anchorServer = now; // re-anchor so it keeps running smoothly
      }
      break;

    case 'show':  t.visible = true;  break;
    case 'hide':  t.visible = false; break;

    case 'setLabel':   t.label = String(action.value || '').slice(0, 120); break;
    case 'setShowHours': t.showHours = !!action.value; break;
    case 'setWarn':     t.warnMs = Math.max(0, Number(action.ms) || 0); break;
    case 'setOvertime': t.overtime = !!action.value; break;
    case 'setFlash':    t.flash = !!action.value; break;

    case 'setStyle':
      Object.assign(t.style, action.style || {});
      break;

    case 'setState': // bulk (used by control panel restoring a preset later)
      Object.assign(t, action.timer || {});
      break;

    /* -------- scoreboard graphic -------- */
    case 'sb_show': { const sb = boardOf(action.board); if (sb) sb.visible = true; break; }
    case 'sb_hide': { const sb = boardOf(action.board); if (sb) sb.visible = false; break; }

    case 'sb_restart': { const sb = boardOf(action.board); if (sb) { // "Restart Match": game 1 -> 0, later games -> "--"
      sb.teams.forEach(function (tm) { tm.games = [0, null, null].slice(0, sb.gamesCount); });
      sb.activeGame = 0;
    } break; }

    case 'sb_startGame': { const sb = boardOf(action.board); if (sb) { // bring a "--" game to 0 for both teams, make active
      const g = clampGame(action.game);
      sb.teams.forEach(function (tm) { if (tm.games[g] == null) tm.games[g] = 0; });
      sb.activeGame = g;
    } break; }

    case 'sb_backGame': { const sb = boardOf(action.board); if (sb) { // undo Start Next Game
      const g = sb.activeGame | 0;
      if (g > 0) { sb.teams.forEach(function (tm) { tm.games[g] = null; }); sb.activeGame = g - 1; }
    } break; }

    case 'sb_score': { const sb = boardOf(action.board); if (sb) { // +/- a started game's score
      const g = clampGame(action.game), tm = sb.teams[action.team === 1 ? 1 : 0];
      if (tm.games[g] == null) tm.games[g] = 0;
      let v = tm.games[g] + (Number(action.delta) || 0); if (v < 0) v = 0; tm.games[g] = v;
    } break; }

    case 'sb_setScore': { const sb = boardOf(action.board); if (sb) { // direct set; '' or '--' clears to null
      const g = clampGame(action.game), tm = sb.teams[action.team === 1 ? 1 : 0], raw = String(action.value).trim();
      tm.games[g] = (raw === '' || raw === '--') ? null : Math.max(0, parseInt(raw, 10) || 0);
    } break; }

    case 'sb_setActive': { const sb = boardOf(action.board); if (sb) sb.activeGame = clampGame(action.game); break; }

    case 'sb_team': { const sb = boardOf(action.board); if (sb) { // edit a team's name/seed/colour/logo
      const tm = sb.teams[action.team === 1 ? 1 : 0];
      ['p1', 'p2', 'seed', 'color', 'rowColor', 'textColor', 'logoUrl'].forEach(function (k) { if (action[k] != null) tm[k] = String(action[k]).slice(0, 300); });
    } break; }

    case 'sb_meta': { const sb = boardOf(action.board); if (sb) { // title / presenter / bracket / event logo
      if (action.title != null)     sb.title = String(action.title).slice(0, 80);
      if (action.presenter != null) sb.presenter = String(action.presenter).slice(0, 40);
      if (action.bracketLabel != null) sb.bracketLabel = String(action.bracketLabel).slice(0, 80);
      if (action.eventLogoUrl != null) sb.eventLogoUrl = String(action.eventLogoUrl).slice(0, 500);
      if (action.eventLogoPlacement != null) {
        const ok = ['inline','top-left','top-center','top-right','mid-left','mid-center','mid-right','bottom-left','bottom-center','bottom-right'];
        if (ok.indexOf(action.eventLogoPlacement) >= 0) sb.eventLogoPlacement = action.eventLogoPlacement;
      }
      if (action.eventLogoSize != null) sb.eventLogoSize = Math.max(40, Math.min(600, parseInt(action.eventLogoSize, 10) || 150));
    } break; }

    case 'sb_style': { const sb = boardOf(action.board); if (sb) Object.assign(sb.style, styleIn(action.style)); break; }

    /* ---- board management (create / rename / delete scoreboards) ---- */
    case 'sb_board_add': { if ((state.scoreboards || []).length < 24) state.scoreboards.push(defaultScoreboard(String(action.name || ('Court ' + (state.scoreboards.length + 1))).slice(0, 60))); break; }
    case 'sb_board_rename': { const sb = boardOf(action.board); if (sb && action.name != null) sb.name = String(action.name).slice(0, 60); break; }
    case 'sb_board_delete': { if ((state.scoreboards || []).length > 1) state.scoreboards = state.scoreboards.filter(b => b.id !== action.board); break; }

    /* -------- baseball / softball scoreboard -------- */
    case 'bl_show': state.baseball.visible = true;  break;
    case 'bl_hide': state.baseball.visible = false; break;
    case 'bl_team': { // edit a team's name / abbr / colour / logo (team 0 = away, 1 = home)
      const t = state.baseball.teams[action.team]; if (!t) break;
      if (action.name != null)   t.name    = String(action.name).slice(0, 40);
      if (action.abbr != null)   t.abbr    = String(action.abbr).slice(0, 5).toUpperCase();
      if (action.color != null)  t.color   = String(action.color).slice(0, 30);
      if (action.logoUrl != null) t.logoUrl = String(action.logoUrl).slice(0, 400);
      break;
    }
    case 'bl_innings': { state.baseball.innings = Math.max(1, Math.min(12, parseInt(action.n, 10) || 7)); ensureBaseballShape(state.baseball); break; }
    case 'bl_run': { // add/remove a run for a team in the CURRENT inning cell
      const bb = state.baseball; ensureBaseballShape(bb);
      const t = bb.teams[action.team]; if (!t) break;
      const i = bb.inning - 1;
      const cur = (t.line[i] == null) ? 0 : t.line[i];
      t.line[i] = Math.max(0, cur + (parseInt(action.delta, 10) || 0));
      break;
    }
    case 'bl_setRun': { // direct-edit one inning cell ('' clears to null)
      const bb = state.baseball; ensureBaseballShape(bb);
      const t = bb.teams[action.team]; if (!t) break;
      const i = Math.max(0, Math.min(bb.innings - 1, parseInt(action.inning, 10)));
      const v = String(action.value == null ? '' : action.value).trim();
      t.line[i] = (v === '' || v === '--') ? null : Math.max(0, parseInt(v, 10) || 0);
      break;
    }
    case 'bl_stat': { // hits / errors +/-
      const t = state.baseball.teams[action.team]; if (!t) break;
      const f = (action.stat === 'errors') ? 'errors' : 'hits';
      t[f] = Math.max(0, (parseInt(t[f], 10) || 0) + (parseInt(action.delta, 10) || 0));
      break;
    }
    case 'bl_count': { // balls / strikes / outs +/- with sensible caps
      const bb = state.baseball;
      if (action.ball != null)   bb.balls   = Math.max(0, Math.min(3, bb.balls   + (parseInt(action.ball, 10)   || 0)));
      if (action.strike != null) bb.strikes = Math.max(0, Math.min(2, bb.strikes + (parseInt(action.strike, 10) || 0)));
      if (action.out != null)    bb.outs    = Math.max(0, Math.min(3, bb.outs    + (parseInt(action.out, 10)    || 0)));
      break;
    }
    case 'bl_clearCount': { state.baseball.balls = 0; state.baseball.strikes = 0; break; }
    case 'bl_base': { const b = state.baseball.bases; const k = action.base; if (k === 'first' || k === 'second' || k === 'third') b[k] = !b[k]; break; }
    case 'bl_setHalf': { state.baseball.half = (action.half === 'bottom') ? 'bottom' : 'top'; break; }
    case 'bl_advance': { // next half-inning: reset count/outs/bases; open the new batting team's inning cell
      const bb = state.baseball; ensureBaseballShape(bb);
      if (bb.half === 'top') bb.half = 'bottom';
      else { bb.half = 'top'; bb.inning = Math.min(12, bb.inning + 1); ensureBaseballShape(bb); }
      bb.balls = 0; bb.strikes = 0; bb.outs = 0; bb.bases = { first: false, second: false, third: false };
      const t = bb.teams[bb.half === 'top' ? 0 : 1];
      if (t.line[bb.inning - 1] == null) t.line[bb.inning - 1] = 0;   // show 0, not blank, once the half starts
      break;
    }
    case 'bl_back': { // step the half-inning back (undo an accidental advance)
      const bb = state.baseball;
      if (bb.half === 'bottom') bb.half = 'top';
      else if (bb.inning > 1) { bb.inning -= 1; bb.half = 'bottom'; }
      bb.balls = 0; bb.strikes = 0; bb.outs = 0;
      break;
    }
    case 'bl_restart': { // fresh game, keep team names/looks + innings count
      const bb = state.baseball; const n = bb.innings;
      bb.inning = 1; bb.half = 'top'; bb.balls = 0; bb.strikes = 0; bb.outs = 0;
      bb.bases = { first: false, second: false, third: false };
      bb.teams.forEach(function (t, idx) { t.line = new Array(n).fill(null); t.hits = 0; t.errors = 0; if (idx === 0) t.line[0] = 0; });
      break;
    }
    case 'bl_style': { Object.assign(state.baseball.style, styleIn(action.style)); break; }

    /* -------- team library (mail-merge) -------- */
    case 'lib_import': { // replace the library with an imported list of teams
      if (!Array.isArray(action.teams)) return false;
      state.library.teams = action.teams.slice(0, 500).map(function (t) {
        return {
          name: String(t.name || '').slice(0, 80),
          logo: String(t.logo || '').slice(0, 300),
          rowColor: String(t.rowColor || '').slice(0, 30),
          textColor: String(t.textColor || '').slice(0, 30),
          seed: String(t.seed || '').slice(0, 10),
          players: (Array.isArray(t.players) ? t.players : []).slice(0, 12).map(function (p) { return String(p || '').slice(0, 60); }).filter(Boolean)
        };
      });
      saveLibrary();
      break;
    }
    case 'lib_clear': state.library.teams = []; saveLibrary(); break;

    /* -------- lower third builder -------- */
    case 'lt_show': state.lowerthird.visible = true;  break;
    case 'lt_hide': state.lowerthird.visible = false; break;
    case 'lt_chroma': state.lowerthird.chroma = String(action.value || ''); break;
    case 'lt_layers': // control panel sends the full layer array on any edit
      if (Array.isArray(action.layers)) {
        state.lowerthird.layers = action.layers.slice(0, 100);
        if (action.editingShowId !== undefined) state.lowerthird.editingShowId = String(action.editingShowId || '');
        saveLowerThird();
      }
      break;
    case 'lt_reset':
      state.lowerthird.layers = defaultLowerThirdLayers();
      saveLowerThird();
      break;
    case 'lt_vcmd': // video play/pause/restart command to a specific video layer
      state.lowerthird.vcmd = { id: String(action.id || ''), cmd: String(action.cmd || ''), seq: (state.lowerthird.vcmd.seq || 0) + 1 };
      break;
    case 'lt_slides': { // advance a SLIDES layer (next/prev/first/last/blank/goto) — index synced to every machine
      const L = (state.lowerthird.layers || []).find(x => x.id === action.id && x.type === 'slides');
      if (L) {
        L.index = stepIndex(String(action.cmd || ''), L.index, (L.slides || []).length, action.n, true);
        saveLowerThird();
      }
      break;
    }
    case 'lt_bullets': { // advance a BULLETS layer on the builder canvas
      const L = (state.lowerthird.layers || []).find(x => x.id === action.id && x.type === 'bullets');
      if (L) {
        L.index = stepIndex(String(action.cmd || ''), L.index, (L.items || []).length, action.n, false);
        saveLowerThird();
      }
      break;
    }
    case 'show_layercmd': {
      // Advance a bullets/slides layer INSIDE a saved preset. Until this existed a reveal could
      // only be driven from the builder, so anything in the Show Library was frozen on air.
      const it = state.shows.find(x => x.id === action.id);
      if (!it || !it.payload || !Array.isArray(it.payload.layers)) break;
      const L = findStepLayer(it, action.layerId);
      if (!L) break;
      const n = stepCount(it, L);   // the CSV row's list if one feeds this layer, else the design's
      L.index = stepIndex(String(action.cmd || ''), L.index, n, action.n, L.type === 'slides');
      saveShows();
      break;
    }
    case 'lt_timer': { // transport for a TIMER layer — time is stamped on the SERVER so every machine agrees
      const L = (state.lowerthird.layers || []).find(x => x.id === action.id && x.type === 'timer');
      if (L) {
        const now = Date.now(), cmd = String(action.cmd || '');
        if (cmd === 'start') { if (!L.running) { L.running = true; L.anchorServer = now; } }
        else if (cmd === 'pause') { if (L.running) { L.baseMs = liveTimerMs(L, now); L.running = false; } }
        else if (cmd === 'reset') { L.running = false; L.baseMs = (L.mode === 'up') ? 0 : (L.durationMs || 0); }
        else if (cmd === 'set') {
          const p = action.patch || {};
          ['mode', 'durationMs', 'targetEpoch', 'showHours', 'overtime', 'use24h'].forEach(k => { if (p[k] !== undefined) L[k] = p[k]; });
          if (!L.running) { if (L.mode === 'up') L.baseMs = 0; else if (p.durationMs !== undefined) L.baseMs = L.durationMs; }
        }
        saveLowerThird();
      }
      break;
    }

    /* ---- Show Library ---- */
    case 'show_save': { // snapshot a graphic into the library (or overwrite an existing preset by id)
      const name = String(action.name || 'Untitled').slice(0, 120);
      const kind = String(action.kind || 'lowerthird');
      const payload = action.payload && typeof action.payload === 'object' ? action.payload : {};
      const existing = action.id ? state.shows.find(x => x.id === action.id) : null;
      let savedId;
      if (existing) { existing.name = name; existing.kind = kind; existing.payload = payload; savedId = existing.id; }
      else {
        if (state.shows.length >= 300) break;
        savedId = 'S' + Date.now().toString(36) + (state.shows.length);
        state.shows.push({ id: savedId, name, kind, payload, on: false });
      }
      // Link the builder to the preset it just saved, so its next "Save" updates the same one.
      if (kind === 'lowerthird') state.lowerthird.editingShowId = savedId;
      saveShows();
      break;
    }
    case 'show_load': { // pull a preset's design into the Graphics Builder for editing
      const it = state.shows.find(x => x.id === action.id);
      if (it && it.payload && Array.isArray(it.payload.layers)) {
        state.lowerthird.layers = JSON.parse(JSON.stringify(it.payload.layers));
        state.lowerthird.editingShowId = it.id;
        saveLowerThird();
      }
      break;
    }
    case 'show_delete': state.shows = state.shows.filter(x => x.id !== action.id); saveShows(); break;
    case 'show_rename': { const it = state.shows.find(x => x.id === action.id); if (it) { it.name = String(action.name || it.name).slice(0, 120); saveShows(); } break; }
    case 'show_toggle': {
      const it = state.shows.find(x => x.id === action.id);
      if (it) {
        const wasOn = !!it.on;
        it.on = (action.on == null ? !it.on : !!action.on);
        // Taking a build to air starts it from the top. Otherwise a graphic saved with every
        // bullet showing comes back on air fully revealed and the operator has to blank it first,
        // every single show. Switch it off per layer if you want a static list.
        if (it.on && !wasOn && it.payload && Array.isArray(it.payload.layers)) {
          it.payload.layers.forEach(l => { if (l.type === 'bullets' && l.resetOnAir !== false) l.index = -1; });
        }
        saveShows();
      }
      break;
    }
    case 'show_alloff': state.shows.forEach(x => { x.on = false; }); saveShows(); break;
    case 'show_reorder': {   // move a preset up (dir -1) or down (dir +1) in the Library list
      const i = state.shows.findIndex(x => x.id === action.id);
      const j = i + (action.dir < 0 ? -1 : 1);
      if (i >= 0 && j >= 0 && j < state.shows.length) {
        const t = state.shows[i]; state.shows[i] = state.shows[j]; state.shows[j] = t; saveShows();
      }
      break;
    }

    case 'show_import': { // add presets from an exported .sglib / .sgpreset file (merge — never overwrites)
      const list = Array.isArray(action.shows) ? action.shows : (action.show ? [action.show] : []);
      let added = 0;
      list.forEach(function (raw) {
        if (!raw || typeof raw !== 'object' || state.shows.length >= 300) return;
        const name = String(raw.name || 'Imported').slice(0, 120);
        const kind = String(raw.kind || 'lowerthird');
        const payload = (raw.payload && typeof raw.payload === 'object') ? raw.payload : { layers: [] };
        const id = 'S' + Date.now().toString(36) + state.shows.length + '_' + added;
        const item = { id, name, kind, payload, on: false };
        if (Array.isArray(raw.columns)) item.columns = raw.columns.slice(0, 80).map(c => String(c).slice(0, 80));
        if (Array.isArray(raw.rows)) item.rows = raw.rows.slice(0, 3000);
        if (raw.rowKey) item.rowKey = String(raw.rowKey);
        item.rowIndex = 0;
        state.shows.push(item); added++;
      });
      if (added) saveShows();
      break;
    }

    /* ---- Templates (starting designs) ---- */
    case 'tpl_save': { // save a design as a reusable template (or import one)
      const name = String(action.name || 'Template').slice(0, 120);
      const kind = String(action.kind || 'lowerthird');
      const layers = Array.isArray(action.layers) ? action.layers.slice(0, 100) : [];
      if (!state.userTemplates) state.userTemplates = [];
      if (state.userTemplates.length < 500) state.userTemplates.push({ id: 'ut_' + Date.now().toString(36) + state.userTemplates.length, name, kind, layers });
      saveTemplates(); break;
    }
    case 'tpl_delete': state.userTemplates = (state.userTemplates || []).filter(x => x.id !== action.id); saveTemplates(); break;
    case 'tpl_rename': {
      const t = (state.userTemplates || []).find(x => x.id === action.id);
      if (t) { t.name = String(action.name || t.name).slice(0, 120); saveTemplates(); }
      break;
    }
    case 'pack_uninstall': {   // removes the pack AND every design that came in with it
      const id = String(action.id || ''); if (!id) break;
      state.userTemplates = (state.userTemplates || []).filter(x => x.pack !== id);
      state.packs = (state.packs || []).filter(p => p.id !== id);
      saveTemplates(); break;
    }
    case 'tpl_load': { // load a template's design into the Graphics Builder
      const t = allTemplates().find(x => x.id === action.id);
      if (t && Array.isArray(t.layers)) { state.lowerthird.layers = JSON.parse(JSON.stringify(t.layers)); state.lowerthird.editingShowId = ''; saveLowerThird(); }
      break;
    }

    /* ---- CSV mail-merge: attach a spreadsheet to a graphic, one row = one filled version ---- */
    case 'show_import_csv': {
      const it = state.shows.find(x => x.id === action.id); if (!it) break;
      const cols = (Array.isArray(action.columns) ? action.columns : []).map(c => String(c).slice(0, 80)).filter(Boolean);
      const rows = (Array.isArray(action.rows) ? action.rows : []).slice(0, 3000).map(r => {
        const o = {}; cols.forEach(c => { o[c] = String(r[c] == null ? '' : r[c]).slice(0, 600); }); return o;
      });
      it.columns = cols; it.rows = rows; it.rowIndex = 0;
      it.rowKey = (it.rowKey && cols.indexOf(it.rowKey) >= 0) ? it.rowKey : (cols[0] || '');
      resetCsvBullets(it);   // a new spreadsheet means new lists — start every build from the top
      saveShows(); break;
    }
    case 'show_rowselect': {
      const it = state.shows.find(x => x.id === action.id); if (!it || !it.rows || !it.rows.length) break;
      const n = it.rows.length; let i = it.rowIndex || 0; const cmd = String(action.cmd || 'goto');
      if (cmd === 'next') i = Math.min(n - 1, i + 1);
      else if (cmd === 'prev') i = Math.max(0, i - 1);
      else { i = parseInt(action.n, 10); if (isNaN(i)) i = 0; i = Math.max(0, Math.min(n - 1, i)); }
      const moved = (i !== (it.rowIndex || 0));
      it.rowIndex = i;
      if (moved) resetCsvBullets(it);
      saveShows(); break;
    }
    case 'show_setkey': { const it = state.shows.find(x => x.id === action.id); if (it) { it.rowKey = String(action.key || ''); saveShows(); } break; }
    case 'show_rowmode': { const it = state.shows.find(x => x.id === action.id); if (it) { it.rowTransition = (action.mode === 'reanimate') ? 'reanimate' : 'cut'; saveShows(); } break; }
    case 'show_rowdelay': { const it = state.shows.find(x => x.id === action.id); if (it) { let ms = parseInt(action.ms, 10); if (isNaN(ms)) ms = 1000; it.rowDelay = Math.max(0, Math.min(8000, ms)); saveShows(); } break; }
    case 'show_addrow': { // add ONE entry by hand (no CSV needed) — great for a handful of manual items
      const it = state.shows.find(x => x.id === action.id); if (!it) break;
      const row = (action.row && typeof action.row === 'object') ? action.row : {};
      if (!it.rows) it.rows = [];
      if (!it.columns || !it.columns.length) it.columns = Object.keys(row).slice(0, 60);
      const o = {}; it.columns.forEach(c => { o[c] = String(row[c] == null ? '' : row[c]).slice(0, 600); });
      // keepIndex: the row editor appends without yanking whatever is currently on air.
      if (it.rows.length < 3000) { it.rows.push(o); if (!action.keepIndex) it.rowIndex = it.rows.length - 1; }
      if (!it.rowKey) it.rowKey = it.columns[0] || '';
      if (!action.keepIndex) resetCsvBullets(it);
      saveShows(); break;
    }
    case 'show_clear_csv': { const it = state.shows.find(x => x.id === action.id); if (it) { delete it.rows; delete it.columns; delete it.rowKey; it.rowIndex = 0; clampReveals(it); saveShows(); } break; }

    /* ---- Live row editing. A name is too long, an entry is wrong, someone didn't show up —
       the operator fixes it mid-event without re-exporting the spreadsheet and re-importing.
       Edits to the row that's currently on air reach the output immediately: the Program
       output's signature is built from the FILLED layers, so changing a cell re-renders that
       preset in place (a straight swap, not the row-change animation). ---- */
    case 'show_setcell': {
      const it = state.shows.find(x => x.id === action.id); if (!it || !it.rows) break;
      const n = parseInt(action.n, 10); if (isNaN(n) || n < 0 || n >= it.rows.length) break;
      const col = String(action.col || ''); if (!col || (it.columns || []).indexOf(col) < 0) break;
      it.rows[n][col] = String(action.value == null ? '' : action.value).slice(0, 600);
      clampReveals(it);   // shortening a talking-points cell must not leave the build past the end
      saveShows(); break;
    }
    case 'show_delrow': {
      const it = state.shows.find(x => x.id === action.id); if (!it || !it.rows || !it.rows.length) break;
      const n = parseInt(action.n, 10); if (isNaN(n) || n < 0 || n >= it.rows.length) break;
      it.rows.splice(n, 1);
      // Deleting a row ABOVE the one on air would otherwise slide a different person into
      // view without anybody touching the picker. Follow the content, not the slot number.
      let i = it.rowIndex || 0;
      if (n < i) i--;
      it.rowIndex = it.rows.length ? Math.max(0, Math.min(it.rows.length - 1, i)) : 0;
      if (!it.rows.length) { delete it.rows; delete it.columns; delete it.rowKey; }  // last row gone = no spreadsheet
      clampReveals(it);
      saveShows(); break;
    }
    case 'show_moverow': {
      const it = state.shows.find(x => x.id === action.id); if (!it || !it.rows) break;
      const n = parseInt(action.n, 10); const dir = (parseInt(action.dir, 10) < 0) ? -1 : 1;
      const to = n + dir;
      if (isNaN(n) || n < 0 || n >= it.rows.length || to < 0 || to >= it.rows.length) break;
      const cur = it.rowIndex || 0;
      it.rows.splice(to, 0, it.rows.splice(n, 1)[0]);
      if (cur === n) it.rowIndex = to; else if (cur === to) it.rowIndex = n;   // selection travels with the row
      clampReveals(it);
      saveShows(); break;
    }
    case 'show_insertrow': {   // add at a position — also how Undo puts a deleted row back where it was
      const it = state.shows.find(x => x.id === action.id); if (!it) break;
      const row = (action.row && typeof action.row === 'object') ? action.row : {};
      if (!it.rows) it.rows = [];
      if (!it.columns || !it.columns.length) it.columns = Object.keys(row).slice(0, 60);
      if (it.rows.length >= 3000) break;
      let n = parseInt(action.n, 10); if (isNaN(n)) n = it.rows.length;
      n = Math.max(0, Math.min(it.rows.length, n));
      const o = {}; it.columns.forEach(c => { o[c] = String(row[c] == null ? '' : row[c]).slice(0, 600); });
      it.rows.splice(n, 0, o);
      const cur = it.rowIndex || 0;
      it.rowIndex = (n <= cur) ? Math.min(it.rows.length - 1, cur + 1) : cur;   // whatever was on air stays on air
      if (!it.rowKey) it.rowKey = it.columns[0] || '';
      clampReveals(it);
      saveShows(); break;
    }
    case 'show_addcol': {   // a spreadsheet arrived missing a field the design needs
      const it = state.shows.find(x => x.id === action.id); if (!it || !it.rows) break;
      const col = String(action.col || '').trim().slice(0, 80); if (!col) break;
      if (!it.columns) it.columns = [];
      if (it.columns.indexOf(col) >= 0 || it.columns.length >= 80) break;
      it.columns.push(col);
      it.rows.forEach(r => { if (r[col] == null) r[col] = ''; });
      saveShows(); break;
    }

    /* ---------------- Teleprompter ---------------- */
    case 'pr_show': state.prompter.visible = true;  break;
    case 'pr_hide': state.prompter.visible = false; break;

    case 'pr_script': {
      const p = state.prompter;
      const text = String(action.text == null ? '' : action.text).slice(0, 400000);
      if (text === p.script) return false;   // a re-save of identical text is not a change
      p.script = text;
      // The words moved, so the measured layout no longer describes them. Drop the bookmark
      // positions rather than keep stale ones — a bookmark that lands on the wrong line
      // mid-read is worse than one that takes half a second to come back.
      p.geom = { sig: '', src: '', total: 0, marks: [] };
      savePrompter();
      break;
    }

    case 'pr_play':   { const p = state.prompter; if (!p.running) { p.anchorServer = now; p.running = true; } break; }
    case 'pr_pause':  { const p = state.prompter; if (p.running) { p.basePx = livePromptPx(p, now); p.running = false; } break; }
    case 'pr_toggle': { const p = state.prompter; return applyAction({ type: p.running ? 'pr_pause' : 'pr_play' }); }

    case 'pr_speed': {
      const p = state.prompter;
      let v = (action.delta != null) ? p.speed + Number(action.delta) : Number(action.value);
      if (!isFinite(v)) break;
      // Bank the position at the OLD speed first. Changing p.speed while an anchor is
      // outstanding would re-run all the elapsed time at the new rate — the text would leap.
      if (p.running) { p.basePx = livePromptPx(p, now); p.anchorServer = now; }
      p.speed = Math.max(0, Math.min(600, Math.round(v)));
      savePrompter();
      break;
    }

    case 'pr_jump': { // relative move (the up/down arrows), in reference px
      const p = state.prompter;
      let d = Number(action.px);
      if (!isFinite(d)) d = (Number(action.dir) || 0) * (p.jumpPx || 220);
      setPromptPos(p, livePromptPx(p, now) + d, now);
      break;
    }

    case 'pr_goto': { // absolute: a pixel offset, or a bookmark index
      const p = state.prompter;
      if (action.mark != null) {
        const m = (p.geom.marks || [])[parseInt(action.mark, 10)];
        if (!m) break;
        setPromptPos(p, m.y, now);
      } else {
        setPromptPos(p, Number(action.px) || 0, now);
      }
      break;
    }

    case 'pr_mark': { // step to the next / previous bookmark from wherever we are
      const p = state.prompter;
      const marks = p.geom.marks || [];
      if (!marks.length) break;
      const at = livePromptPx(p, now);
      let target = null;
      if (action.cmd === 'prev') {
        // A shade of tolerance, or "previous" lands on the bookmark you are already sitting on.
        for (let i = marks.length - 1; i >= 0; i--) if (marks[i].y < at - 4) { target = marks[i].y; break; }
        if (target == null) target = 0;
      } else {
        for (let i = 0; i < marks.length; i++) if (marks[i].y > at + 4) { target = marks[i].y; break; }
        if (target == null) { const mx = promptMaxPx(p); target = mx >= 0 ? mx : at; }
      }
      setPromptPos(p, target, now);
      break;
    }

    case 'pr_top': setPromptPos(state.prompter, 0, now); break;

    case 'pr_style': {
      const p = state.prompter;
      const s = action.style || {};
      const was = promptSig(p);
      Object.keys(s).forEach(function (k) { if (k in p.style) p.style[k] = s[k]; });
      p.style.size = Math.max(12, Math.min(300, Number(p.style.size) || 64));
      p.style.lineHeight = Math.max(1, Math.min(3, Number(p.style.lineHeight) || 1.45));
      p.style.width = Math.max(20, Math.min(100, Number(p.style.width) || 82));
      p.style.cuePos = Math.max(0, Math.min(100, Number(p.style.cuePos) || 0));
      // Only a change that moves the WRAP invalidates the measurement. Dropping it on every
      // style change would blank the bookmarks and the time-remaining readout every time
      // somebody dragged a colour picker — the signature is what tells the two apart.
      if (promptSig(p) !== was) p.geom = { sig: '', src: '', total: 0, marks: [] };
      savePrompter();
      break;
    }

    case 'pr_jumpsize': {
      const p = state.prompter;
      p.jumpPx = Math.max(20, Math.min(2000, Math.round(Number(action.px) || 220)));
      savePrompter();
      break;
    }

    /* A browser reporting what the script actually measures.
     * Accepted only when it describes the CURRENT script + look (the signature), so a late
     * report from a layout we've moved on from can never shove the talent mid-read.
     *
     * `src` breaks the tie when several pages are open. An OUTPUT page is measuring on the
     * machine and at the size the talent is reading, so its numbers win; a control panel is
     * a stand-in that keeps bookmarks working before any output is open, and it must never
     * overwrite the real thing. Reports that change nothing are dropped, or two open pages
     * would trade near-identical numbers and broadcast forever. */
    case 'pr_geom': {
      const p = state.prompter;
      const sig = String(action.sig || '');
      if (!sig || sig !== promptSig(p)) return false;
      const src = action.src === 'out' ? 'out' : 'ctl';
      if (p.geom.sig === sig && p.geom.src === 'out' && src !== 'out') return false;
      const total = Math.max(0, Math.round(Number(action.total) || 0));
      const marks = (Array.isArray(action.marks) ? action.marks : []).slice(0, 500).map(function (m) {
        return { name: String(m && m.name || '').slice(0, 120), y: Math.max(0, Math.round(Number(m && m.y) || 0)) };
      });
      if (p.geom.sig === sig && p.geom.src === src && p.geom.total === total && p.geom.marks.length === marks.length) return false;
      p.geom = { sig: sig, src: src, total: total, marks: marks };
      break;
    }

    default:
      return false;
  }
  return true;
}

// Identifies a layout: same signature = same wrap, so the same measured pixels apply.
// Everything that can move a line break belongs in here.
/* Identifies a layout: same signature = same wrap, so the same measured pixels apply.
 * Everything that can move a line break belongs in here; anything that cannot (colours, the
 * cue position, the background) must stay OUT, or every colour tweak would throw the
 * measurement away and the bookmark buttons would blink out.
 *
 * The browser computes this too - public/sg-prompter.js, SGPrompter.sig() - and the two MUST
 * agree character for character, or every geometry report is rejected and bookmarks never
 * appear. It is a plain FNV-1a on purpose: SubtleCrypto (sha1/sha256) does not exist over
 * plain http on a LAN address, which is exactly how this app gets used. */
function promptSig(p) {
  const s = p.style || {};
  const str = [p.script || '', s.font, s.size, s.lineHeight, s.bold ? 1 : 0, s.align, s.width, s.showMarks ? 1 : 0].join('\u0000');
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h ^= (c & 0xff);        h = Math.imul(h, 16777619) >>> 0;
    h ^= ((c >> 8) & 0xff); h = Math.imul(h, 16777619) >>> 0;
  }
  return str.length.toString(36) + '-' + h.toString(36);
}

// Live value (ms) of a timer layer at server time `now`. Shared shape with the standalone timer.
function liveTimerMs(t, now) {
  if (t.mode === 'up')  return (t.baseMs || 0) + (t.running ? now - t.anchorServer : 0);
  if (t.mode === 'tod') return Math.max(0, (t.targetEpoch || 0) - now);
  const rem = (t.baseMs || 0) - (t.running ? now - t.anchorServer : 0);
  return t.overtime ? rem : Math.max(0, rem);
}

function clampGame(g) { g = parseInt(g, 10) || 0; return g < 0 ? 0 : (g > 2 ? 2 : g); }

/* Board style, cleaned on the way in.
 * offsetX/offsetY are the position nudge. They end up in a CSS custom property on the output
 * page, so they must be NUMBERS - a string would be pasted straight into the stylesheet.
 * Anything unparseable becomes 0 rather than being kept, and the range is capped so a board
 * can never be nudged so far off-stage that it looks like it vanished and can't be found. */
const NUDGE_MAX = 600;
function styleIn(style) {
  const s = Object.assign({}, style || {});
  for (const k of ['offsetX', 'offsetY']) {
    if (!(k in s)) continue;
    const n = Math.round(Number(s[k]));
    s[k] = !isFinite(n) ? 0 : Math.max(-NUDGE_MAX, Math.min(NUDGE_MAX, n));
  }
  return s;
}

/* ------------------------------------------------------------------ *
 *  HTTP
 * ------------------------------------------------------------------ */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
};

function serveFile(res, file) {
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(file);
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
    // Never cache the app code/markup — a live graphics tool must always run the latest JS,
    // or an operator's stale browser tab silently runs an old build (missing new layer types, etc).
    if (ext === '.html' || ext === '.js' || ext === '.css') headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
    res.writeHead(200, headers);
    res.end(buf);
  });
}

// --- Export/Import helpers: make a preset PORTABLE by inlining its local images as data URIs,
//     so a graphic carries its own logos/photos to another install (images only; big files/videos
//     are left as links to keep the file sane). ---
const EXPORT_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' };
function dataUriForLocal(rel) {
  try {
    if (!/^\/(uploads|media)\//.test(rel)) return null;
    const clean = decodeURIComponent(String(rel).replace(/\?.*$/, ''));
    const full = path.join(PUBLIC_DIR, path.normalize(clean).replace(/^(\.\.[\/\\])+/, ''));
    if (full.indexOf(PUBLIC_DIR) !== 0) return null;               // stay inside /public
    const ext = (full.split('.').pop() || '').toLowerCase();
    const mime = EXPORT_MIME[ext];
    if (!mime) return null;                                        // inline images only (skip video etc.)
    const st = fs.statSync(full);
    if (st.size > 8 * 1024 * 1024) return null;                    // don't bloat the file with huge images
    return 'data:' + mime + ';base64,' + fs.readFileSync(full).toString('base64');
  } catch (e) { return null; }
}
function inlineMedia(node) {
  if (Array.isArray(node)) return node.map(inlineMedia);
  if (node && typeof node === 'object') { const o = {}; for (const k in node) o[k] = inlineMedia(node[k]); return o; }
  if (typeof node === 'string' && /^\/(uploads|media)\//.test(node)) { return dataUriForLocal(node) || node; }
  return node;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  // --- SSE stream ---
  if (pathname === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });
    res.write('retry: 2000\n\n');
    res.write(`data: ${JSON.stringify({ serverTime: Date.now(), version: VERSION, state: wireState() })}\n\n`);
    clients.add(res);
    const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch (e) {} }, 15000);
    req.on('close', () => { clearInterval(ping); clients.delete(res); });
    return;
  }

  // --- action endpoint ---
  if (pathname === '/action' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 1e5) req.destroy(); });
    req.on('end', () => {
      let ok = false;
      try { ok = applyAction(JSON.parse(body || '{}')); } catch (e) { ok = false; }
      if (ok) broadcast();
      res.writeHead(ok ? 200 : 400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ ok }));
    });
    return;
  }

  // --- Control API: simple, NAME-addressable commands for Bitfocus Companion / Stream Deck / any automation.
  //     One URL = one button. GET or POST. Everything is addressed by the name you gave it in the app. ---
  if (pathname.startsWith('/api/')) {
    const q = url.searchParams;
    const seg = pathname.split('/').filter(Boolean); // ['api', group, cmd]
    const group = (seg[1] || '').toLowerCase();
    const cmd = (seg[2] || '').toLowerCase();
    const okJson = (obj, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify(obj)); };
    const fail = (msg, code = 400) => okJson({ ok: false, error: msg }, code);
    const did = (extra) => { broadcast(); okJson(Object.assign({ ok: true }, extra || {})); };
    const findShow = (nm) => { nm = String(nm || '').trim().toLowerCase(); return state.shows.find(s => String(s.name).trim().toLowerCase() === nm); };
    const findBoard = (nm) => { if (!nm) return (state.scoreboards || [])[0]; const k = String(nm).trim().toLowerCase(); return (state.scoreboards || []).find(b => String(b.name).trim().toLowerCase() === k); };
    const teamIdx = () => (String(q.get('team') || '1').trim() === '2') ? 1 : 0;

    // Discovery — lists the names you can drive (powers the Control API help page + lets Companion see names)
    if (group === 'list') {
      return okJson({ ok: true,
        presets: state.shows.map(s => ({ name: s.name, on: !!s.on, csv: !!(s.rows && s.rows.length), rows: (s.rows || []).length, row: (s.rows && s.rows.length) ? (s.rowIndex || 0) + 1 : 0,
          reveals: stepLayers(s).map(l => ({ name: l.name || l.type, type: l.type, at: (l.index == null ? -1 : l.index) + 1, of: stepCount(s, l) })) })),
        scoreboards: (state.scoreboards || []).map(b => ({ name: b.name, visible: !!b.visible })),
        timer: { visible: !!state.timer.visible, mode: state.timer.mode },
        baseball: { visible: !!state.baseball.visible },
        prompter: { visible: !!state.prompter.visible, running: !!state.prompter.running, speed: state.prompter.speed, marks: (state.prompter.geom.marks || []).map(m => m.name) } });
    }

    // Library presets — on / off / toggle, plus CSV row stepping
    if (group === 'preset') {
      if (cmd === 'alloff') { applyAction({ type: 'show_alloff' }); return did(); }
      const it = findShow(q.get('name'));
      if (!it) return fail('preset not found: "' + (q.get('name') || '') + '"', 404);
      if (cmd === 'on')     { applyAction({ type: 'show_toggle', id: it.id, on: true });  return did({ name: it.name, on: true }); }
      if (cmd === 'off')    { applyAction({ type: 'show_toggle', id: it.id, on: false }); return did({ name: it.name, on: false }); }
      if (cmd === 'toggle') { applyAction({ type: 'show_toggle', id: it.id });            return did({ name: it.name, on: !!it.on }); }
      if (cmd === 'next')   { applyAction({ type: 'show_rowselect', id: it.id, cmd: 'next' }); return did({ name: it.name, row: (it.rowIndex || 0) + 1 }); }
      if (cmd === 'prev')   { applyAction({ type: 'show_rowselect', id: it.id, cmd: 'prev' }); return did({ name: it.name, row: (it.rowIndex || 0) + 1 }); }
      if (cmd === 'row')    { applyAction({ type: 'show_rowselect', id: it.id, cmd: 'goto', n: (parseInt(q.get('n'), 10) || 1) - 1 }); return did({ name: it.name, row: (it.rowIndex || 0) + 1 }); }
      return fail('unknown preset command: "' + cmd + '" (use on/off/toggle/next/prev/row)');
    }

    // Bullet / slide reveal inside a preset — the "next bullet" button on a Stream Deck.
    // ?preset=NAME [&layer=NAME]  — layer is optional; without it the first steppable layer wins.
    if (group === 'bullets' || group === 'reveal') {
      const it = findShow(q.get('preset') || q.get('name'));
      if (!it) return fail('preset not found: "' + (q.get('preset') || q.get('name') || '') + '"', 404);
      const L = findStepLayer(it, q.get('layer'));
      if (!L) return fail('preset "' + it.name + '" has no bullets or slides layer to step', 404);
      // Read the total fresh each time: a CSV-fed build is a different length on every row.
      const at = () => ({ preset: it.name, layer: L.name || L.type, type: L.type, at: (L.index == null ? -1 : L.index) + 1, of: stepCount(it, L) });
      if (cmd === 'status') return okJson(Object.assign({ ok: true }, at()));
      if (['next', 'prev', 'first', 'last', 'all', 'blank', 'reset'].indexOf(cmd) >= 0) {
        applyAction({ type: 'show_layercmd', id: it.id, layerId: L.id, cmd });
        return did(at());
      }
      if (cmd === 'goto') {
        const n = parseInt(q.get('n'), 10);
        if (isNaN(n)) return fail('provide ?n=N (1 = first bullet, 0 = blank)');
        applyAction({ type: 'show_layercmd', id: it.id, layerId: L.id, cmd: 'goto', n: n - 1 });
        return did(at());
      }
      return fail('unknown bullets command: "' + cmd + '" (use next/prev/first/last/all/blank/goto/status)');
    }

    // Presenter timer
    if (group === 'timer') {
      if (cmd === 'start') { applyAction({ type: 'start' }); return did(); }
      if (cmd === 'pause' || cmd === 'stop') { applyAction({ type: 'pause' }); return did(); }
      if (cmd === 'reset') { applyAction({ type: 'reset' }); return did(); }
      if (cmd === 'air' || cmd === 'show') { applyAction({ type: 'show' }); return did(); }
      if (cmd === 'off' || cmd === 'hide') { applyAction({ type: 'hide' }); return did(); }
      if (cmd === 'set') {
        let ms = null;
        if (q.get('seconds') != null) ms = Math.round(parseFloat(q.get('seconds')) * 1000);
        else if (q.get('mmss')) { const p = String(q.get('mmss')).split(':').map(n => parseInt(n, 10) || 0); ms = p.length === 3 ? (p[0] * 3600 + p[1] * 60 + p[2]) * 1000 : (p.length === 2 ? (p[0] * 60 + p[1]) * 1000 : 0); }
        if (ms == null || isNaN(ms)) return fail('provide ?seconds=N or ?mmss=MM:SS');
        applyAction({ type: 'setMode', mode: 'down' }); applyAction({ type: 'setDuration', ms }); return did({ ms });
      }
      if (cmd === 'adjust') { const s = parseFloat(q.get('seconds')); if (isNaN(s)) return fail('provide ?seconds=±N'); applyAction({ type: 'adjust', ms: Math.round(s * 1000) }); return did(); }
      return fail('unknown timer command: "' + cmd + '" (use start/pause/reset/air/off/set/adjust)');
    }

    // Scoreboard (beach volleyball), addressed by the board name — points go to the active game
    if (group === 'scoreboard') {
      const b = findBoard(q.get('name'));
      if (!b) return fail('scoreboard not found: "' + (q.get('name') || '') + '"', 404);
      if (cmd === 'point')    { const d = parseInt(q.get('delta'), 10); applyAction({ type: 'sb_score', board: b.id, team: teamIdx(), game: b.activeGame, delta: isNaN(d) ? 1 : d }); return did({ scoreboard: b.name }); }
      if (cmd === 'show')     { applyAction({ type: 'sb_show', board: b.id }); return did({ scoreboard: b.name }); }
      if (cmd === 'hide')     { applyAction({ type: 'sb_hide', board: b.id }); return did({ scoreboard: b.name }); }
      if (cmd === 'nextgame') { applyAction({ type: 'sb_startGame', board: b.id, game: (b.activeGame | 0) + 1 }); return did({ scoreboard: b.name }); }
      if (cmd === 'restart')  { applyAction({ type: 'sb_restart', board: b.id }); return did({ scoreboard: b.name }); }
      return fail('unknown scoreboard command: "' + cmd + '" (use point/show/hide/nextgame/restart)');
    }

    // Baseball / softball
    if (group === 'baseball') {
      if (cmd === 'run')        { applyAction({ type: 'bl_run', team: teamIdx(), delta: (parseInt(q.get('delta'), 10) || 1) }); return did(); }
      if (cmd === 'ball')       { applyAction({ type: 'bl_count', ball: 1 }); return did(); }
      if (cmd === 'strike')     { applyAction({ type: 'bl_count', strike: 1 }); return did(); }
      if (cmd === 'out')        { applyAction({ type: 'bl_count', out: 1 }); return did(); }
      if (cmd === 'clearcount') { applyAction({ type: 'bl_clearCount' }); return did(); }
      if (cmd === 'advance')    { applyAction({ type: 'bl_advance' }); return did(); }
      if (cmd === 'show')       { applyAction({ type: 'bl_show' }); return did(); }
      if (cmd === 'hide')       { applyAction({ type: 'bl_hide' }); return did(); }
      return fail('unknown baseball command: "' + cmd + '" (use run/ball/strike/out/clearcount/advance/show/hide)');
    }

    // Teleprompter — the buttons an operator actually wants under their fingers.
    if (group === 'prompter') {
      const p = state.prompter;
      const at = () => ({ running: !!p.running, speed: p.speed, position: Math.round(livePromptPx(p, Date.now())), of: Math.max(0, promptMaxPx(p)), marks: (p.geom.marks || []).map(m => m.name) });
      if (cmd === 'status') return okJson(Object.assign({ ok: true }, at()));
      if (cmd === 'play')   { applyAction({ type: 'pr_play' });   return did(at()); }
      if (cmd === 'pause' || cmd === 'stop') { applyAction({ type: 'pr_pause' }); return did(at()); }
      if (cmd === 'toggle') { applyAction({ type: 'pr_toggle' }); return did(at()); }
      if (cmd === 'faster') { applyAction({ type: 'pr_speed', delta: (parseFloat(q.get('by')) || 5) });   return did(at()); }
      if (cmd === 'slower') { applyAction({ type: 'pr_speed', delta: -(parseFloat(q.get('by')) || 5) }); return did(at()); }
      if (cmd === 'speed')  { const v = parseFloat(q.get('value')); if (isNaN(v)) return fail('provide ?value=N (pixels per second)'); applyAction({ type: 'pr_speed', value: v }); return did(at()); }
      if (cmd === 'back')    { applyAction({ type: 'pr_jump', dir: -1 }); return did(at()); }
      if (cmd === 'ahead' || cmd === 'forward') { applyAction({ type: 'pr_jump', dir: 1 }); return did(at()); }
      if (cmd === 'top')    { applyAction({ type: 'pr_top' }); return did(at()); }
      if (cmd === 'nextmark') { applyAction({ type: 'pr_mark', cmd: 'next' }); return did(at()); }
      if (cmd === 'prevmark') { applyAction({ type: 'pr_mark', cmd: 'prev' }); return did(at()); }
      if (cmd === 'mark') {
        // ?name=Intro (what it's called in the script) or ?n=2 (the second bookmark)
        const nm = q.get('name');
        if (nm) {
          const k = String(nm).trim().toLowerCase();
          const i = (p.geom.marks || []).findIndex(m => String(m.name).trim().toLowerCase() === k);
          if (i < 0) return fail('bookmark not found: "' + nm + '"', 404);
          applyAction({ type: 'pr_goto', mark: i }); return did(at());
        }
        const n = parseInt(q.get('n'), 10);
        if (isNaN(n)) return fail('provide ?name=NAME or ?n=N');
        applyAction({ type: 'pr_goto', mark: n - 1 }); return did(at());
      }
      if (cmd === 'air' || cmd === 'show') { applyAction({ type: 'pr_show' }); return did(at()); }
      if (cmd === 'off' || cmd === 'hide') { applyAction({ type: 'pr_hide' }); return did(at()); }
      return fail('unknown prompter command: "' + cmd + '" (use play/pause/toggle/faster/slower/speed/back/ahead/top/nextmark/prevmark/mark/air/off/status)');
    }

    return fail('unknown api group: "' + group + '" (use preset/timer/scoreboard/baseball/prompter/list)', 404);
  }

  /* --- grab a still frame out of OBS, to use as the builder's reference image ---
   * The operator's OBS password arrives in this request, is used to answer one challenge, and is
   * never written down: not to disk, not to the state file, not to the log. That is deliberate.
   * Everything here is local — the app talks to OBS directly, nothing leaves the network. */
  if ((pathname === '/obs/scenes' || pathname === '/obs/grab') && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 1e5) req.destroy(); });
    req.on('end', () => {
      const sendJson = (code, obj) => {
        res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify(obj));
      };
      let j;
      try { j = JSON.parse(body || '{}'); } catch (e) { return sendJson(400, { ok: false, error: 'bad request' }); }
      const opts = { host: String(j.host || '127.0.0.1').trim(), port: j.port, password: j.password || '', source: j.source || '', width: j.width };

      if (pathname === '/obs/scenes') {
        return obsGrab.listScenes(opts, (err, info) => {
          if (err) return sendJson(200, { ok: false, error: err.message });
          sendJson(200, Object.assign({ ok: true }, info));
        });
      }
      obsGrab.grabFrame(opts, (err, out) => {
        if (err) return sendJson(200, { ok: false, error: err.message });
        const m = /^data:image\/png;base64,(.*)$/.exec(out.dataUri || '');
        if (!m) return sendJson(200, { ok: false, error: 'OBS answered but sent no picture.' });
        // Same home as a browsed-for reference image, so Clear/opacity/persistence all keep working.
        const fname = 'obs_' + Date.now() + '.png';
        fs.writeFile(path.join(UPLOAD_DIR, fname), Buffer.from(m[1], 'base64'), (e2) => {
          if (e2) return sendJson(200, { ok: false, error: 'Could not save the grabbed frame.' });
          sendJson(200, { ok: true, url: '/uploads/' + fname, source: out.source });
        });
      });
    });
    return;
  }

  /* --- the same grab, from vMix ---
   * vMix cannot hand a picture back over HTTP; its only stills function writes a file to disk on
   * the vMix machine. So we ask it to write into our own uploads folder, which works when
   * StreamGraphics and vMix share a computer and is explained plainly when they do not. */
  if ((pathname === '/vmix/state' || pathname === '/vmix/grab') && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 1e5) req.destroy(); });
    req.on('end', () => {
      const sendJson = (code, obj) => {
        res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify(obj));
      };
      let j;
      try { j = JSON.parse(body || '{}'); } catch (e) { return sendJson(400, { ok: false, error: 'bad request' }); }
      const opts = { host: String(j.host || '').trim(), port: j.port || 8088 };

      if (pathname === '/vmix/state') {
        return vmixGrab.state(opts, (err, st) => {
          if (err) return sendJson(200, { ok: false, error: err.message });
          sendJson(200, Object.assign({ ok: true }, st));
        });
      }
      opts.dir = UPLOAD_DIR;
      if (j.input) opts.input = parseInt(j.input, 10) || 0;
      vmixGrab.grab(opts, (err, out) => {
        if (err) return sendJson(200, { ok: false, error: err.message });
        sendJson(200, { ok: true, url: '/uploads/' + out.name, source: opts.input ? ('input ' + opts.input) : 'the program output' });
      });
    });
    return;
  }

  // --- upload a local image, get back a short URL to use as a logo/backdrop ---
  //     (so the operator can "Browse" for a file instead of typing a URL)
  if (pathname === '/upload' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 90e6) req.destroy(); }); // ~90MB body (~65MB file); big files go in /media instead
    req.on('end', () => {
      try {
        const j = JSON.parse(body || '{}');
        const m = /^data:((?:image|video)\/[a-zA-Z0-9.+-]+);base64,(.*)$/.exec(j.data || '');
        if (!m) throw new Error('bad data');
        const extMap = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg',
          'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov', 'video/ogg': 'ogv', 'video/x-matroska': 'mkv' };
        const ext = extMap[m[1]] || (m[1].indexOf('video') === 0 ? 'mp4' : 'png');
        // keepName: save into /media under the ORIGINAL filename so a CSV that references
        // "photo.jpg" (or C:\...\photo.jpg) finds it — clients never touch the folder themselves.
        let target, urlPath;
        if (j.keepName && j.name) {
          // Save to /media/<folder>/<original name> so a CSV referencing that filename matches.
          const folder = j.folder ? sanitizeSeg(j.folder) : '';
          const base = sanitizeSeg(String(j.name).split(/[\\/]/).pop()) || ('img.' + ext);
          if (folder) { try { fs.mkdirSync(path.join(MEDIA_DIR, folder), { recursive: true }); } catch (x) {} }
          const rel = folder ? folder + '/' + base : base;
          target = mediaPath(rel); urlPath = '/media/' + rel;
        } else {
          const fname = 'up_' + Date.now() + '_' + (uploadSeq++) + '.' + ext;
          target = path.join(UPLOAD_DIR, fname); urlPath = '/uploads/' + fname;
        }
        if (!target) { res.writeHead(400); res.end('{"ok":false}'); return; }
        fs.writeFile(target, Buffer.from(m[2], 'base64'), (err) => {
          if (err) { res.writeHead(500); res.end('{"ok":false}'); return; }
          refreshMediaIndex(); broadcast();
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ ok: true, url: urlPath }));
        });
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end('{"ok":false}');
      }
    });
    return;
  }

  // --- current state (handy for debugging) — full state incl. all payloads + derived lists ---
  if (pathname === '/state') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    const covers = licCoversVersion(state.license);
    const lic = { active: !!state.license.active, name: state.license.name, tier: state.license.tier, features: state.license.features, upto: (state.license.upto != null ? state.license.upto : null), coversVersion: covers };
    res.end(JSON.stringify({ serverTime: Date.now(), state: Object.assign({}, state, { templates: allTemplates(), media: mediaIndex, license: lic, licensed: !!state.license.active && covers }) }));
    return;
  }

  // --- Export the whole library (backup / share / archive) — presets with their images bundled in ---
  if (pathname === '/export/library') {
    const out = { type: 'streamgraphics-library', app: 'StreamGraphics Pro', version: VERSION, exported: new Date().toISOString(), count: state.shows.length, shows: inlineMedia(state.shows) };
    const stamp = new Date().toISOString().slice(0, 10);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Content-Disposition': 'attachment; filename="streamgraphics-library-' + stamp + '.sglib"' });
    res.end(JSON.stringify(out));
    return;
  }

  // --- Export one preset as a shareable file ---
  if (pathname === '/export/preset') {
    const it = state.shows.find(s => s.id === url.searchParams.get('id'));
    if (!it) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end('{"ok":false,"error":"preset not found"}'); return; }
    const out = { type: 'streamgraphics-preset', app: 'StreamGraphics Pro', version: VERSION, exported: new Date().toISOString(), show: inlineMedia(it) };
    const safe = String(it.name || 'preset').replace(/[^a-z0-9._-]+/gi, '_').slice(0, 60) || 'preset';
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Content-Disposition': 'attachment; filename="' + safe + '.sgpreset"' });
    res.end(JSON.stringify(out));
    return;
  }

  // --- Import presets from an exported file (own endpoint so bundled images can exceed the /action body cap) ---
  if (pathname === '/import' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 90e6) req.destroy(); });
    req.on('end', () => {
      let ok = false, added = 0;
      try {
        const j = JSON.parse(body || '{}');
        const list = Array.isArray(j.shows) ? j.shows : (j.show ? [j.show] : (Array.isArray(j) ? j : []));
        if (list.length) { const before = state.shows.length; applyAction({ type: 'show_import', shows: list }); added = state.shows.length - before; ok = added > 0; }
      } catch (e) { ok = false; }
      if (ok) broadcast();
      res.writeHead(ok ? 200 : 400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ ok, added }));
    });
    return;
  }

  // --- Every template WITH its layers, plus installed packs. The SSE stream carries template
  //     metadata only, but the picker needs real layers to draw a preview of each design. ---
  if (pathname === '/templates') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({
      ok: true,
      packs: state.packs || [],
      templates: allTemplates().map(t => ({
        id: t.id, name: t.name, kind: t.kind, builtin: !!t.builtin,
        pack: t.pack || '', desc: t.desc || '', layers: t.layers || []
      }))
    }));
    return;
  }

  // --- Build a .sgpack from chosen templates. Goes through the server so referenced images are
  //     embedded — a pack that points at /media paths would arrive broken on someone else's machine. ---
  if (pathname === '/export/pack' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 5e6) req.destroy(); });
    req.on('end', () => {
      let out = null;
      try {
        const j = JSON.parse(body || '{}');
        const ids = Array.isArray(j.ids) ? j.ids.map(String) : [];
        const picked = allTemplates().filter(t => ids.indexOf(t.id) >= 0);
        if (picked.length) {
          out = {
            type: 'streamgraphics-pack', app: 'StreamGraphics Pro', version: VERSION,
            exported: new Date().toISOString(),
            pack: {
              name: String(j.name || 'Untitled pack').slice(0, 120),
              author: String(j.author || '').slice(0, 120),
              version: String(j.version || '1.0').slice(0, 20),
              description: String(j.description || '').slice(0, 600)
            },
            templates: picked.map(t => inlineMedia({ name: t.name, kind: t.kind || 'lowerthird', desc: t.desc || '', layers: t.layers || [] }))
          };
        }
      } catch (e) { out = null; }
      res.writeHead(out ? 200 : 400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(out || { ok: false, error: 'nothing to export' }));
    });
    return;
  }

  // --- Install a .sgpack (own endpoint: embedded images make these far too big for /action) ---
  if (pathname === '/pack-install' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 90e6) req.destroy(); });
    req.on('end', () => {
      let ok = false, added = 0, name = '', err = '';
      try {
        const j = JSON.parse(body || '{}');
        const list = Array.isArray(j.templates) ? j.templates : [];
        const meta = (j.pack && typeof j.pack === 'object') ? j.pack : {};
        if (!list.length) err = 'that file has no designs in it';
        else if ((state.packs || []).length >= PACK_LIMIT) err = 'too many packs installed';
        else {
          const pid = 'pk_' + Date.now().toString(36) + Math.floor(Date.now() % 997).toString(36);
          if (!state.userTemplates) state.userTemplates = [];
          list.forEach(function (raw, i) {
            if (!raw || typeof raw !== 'object' || !Array.isArray(raw.layers)) return;
            if (state.userTemplates.length >= 500) return;
            state.userTemplates.push({
              id: 'ut_' + Date.now().toString(36) + '_' + i,
              name: String(raw.name || 'Untitled').slice(0, 120),
              kind: String(raw.kind || 'lowerthird'),
              desc: String(raw.desc || '').slice(0, 400),
              layers: raw.layers.slice(0, 100),
              pack: pid
            });
            added++;
          });
          if (added) {
            name = String(meta.name || 'Untitled pack').slice(0, 120);
            state.packs = (state.packs || []).concat([packMeta(Object.assign({}, meta, { id: pid, name }))]);
            saveTemplates(); ok = true;
          } else err = 'none of the designs in that file were usable';
        }
      } catch (e) { err = 'that file is not a valid pack'; }
      if (ok) broadcast();
      res.writeHead(ok ? 200 : 400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ ok, added, name, error: err }));
    });
    return;
  }

  // --- images in /media, grouped by folder (show/event), so users see + tidy their uploads ---
  if (pathname === '/media-list') {
    refreshMediaIndex();
    const folders = [];
    try { fs.readdirSync(MEDIA_DIR, { withFileTypes: true }).forEach(e => { if (e.isDirectory()) folders.push(e.name); }); } catch (x) {}
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ ok: true, files: mediaIndex.slice().sort(), folders: folders.sort() }));
    return;
  }

  // --- rename / delete an image, or make / remove a folder ---
  if (pathname === '/media-manage' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 1e5) req.destroy(); });
    req.on('end', () => {
      let ok = false;
      try {
        const j = JSON.parse(body || '{}'), op = String(j.op || '');
        if (op === 'mkdir' && j.folder) { fs.mkdirSync(path.join(MEDIA_DIR, sanitizeSeg(j.folder)), { recursive: true }); ok = true; }
        else if (op === 'rmdir' && j.folder) { const d = mediaPath(j.folder); if (d && fs.existsSync(d)) { fs.rmSync(d, { recursive: true, force: true }); ok = true; } }
        else if (op === 'delete' && j.path) { const f = mediaPath(j.path); if (f && fs.existsSync(f) && fs.statSync(f).isFile()) { fs.unlinkSync(f); ok = true; } }
        else if (op === 'rename' && j.path && j.name) {
          const f = mediaPath(j.path); if (f && fs.existsSync(f)) {
            const dir = path.dirname(f), ext = path.extname(f);
            let nn = sanitizeSeg(String(j.name)); if (!IMG_RE.test(nn)) nn += ext;
            const dest = path.join(dir, nn);
            if (dest.startsWith(MEDIA_DIR)) { fs.renameSync(f, dest); ok = true; }
          }
        }
      } catch (e) { ok = false; }
      refreshMediaIndex(); if (ok) broadcast();
      res.writeHead(ok ? 200 : 400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ ok: ok }));
    });
    return;
  }

  // --- license status (GET) + activate/clear (POST) ---
  if (pathname === '/license') {
    if (req.method === 'POST') {
      let body = '';
      req.on('data', c => { body += c; if (body.length > 1e5) req.destroy(); });
      req.on('end', () => {
        let ok = false;
        try {
          const j = JSON.parse(body || '{}');
          if (j.clear) { state.license = { active: false, key: '', name: '', tier: 'free', features: [], upto: null }; ok = true; }
          else { ok = applyLicense(String(j.key || '')); }
          saveLicense(); broadcast();
        } catch (e) {}
        const covers = licCoversVersion(state.license);
        let err = '';
        if (!state.license.active) err = 'invalid or expired key';
        else if (!covers) err = 'This key covers StreamGraphics Pro up to v' + state.license.upto + '.x — you are on v' + VERSION + '. An upgrade is needed to keep the full version license-free.';
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ ok: !!state.license.active && covers, active: !!state.license.active, licensed: !!state.license.active && covers, name: state.license.name, tier: state.license.tier, features: state.license.features, upto: (state.license.upto != null ? state.license.upto : null), coversVersion: covers, error: err }));
      });
      return;
    }
    const covers = licCoversVersion(state.license);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ active: !!state.license.active, licensed: !!state.license.active && covers, name: state.license.name, tier: state.license.tier, features: state.license.features, upto: (state.license.upto != null ? state.license.upto : null), coversVersion: covers }));
    return;
  }

  // --- update check: fetch the vendor's version manifest and compare (cached 6h; silent if offline) ---
  if (pathname === '/update-check') {
    checkUpdate(function (m) {
      const latest = m && m.version;
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ current: VERSION, latest: latest || null, url: (m && m.url) || '', notes: (m && m.notes) || '', updateAvailable: latest ? cmpVer(latest, VERSION) > 0 : false }));
    });
    return;
  }

  // --- app version (shown in the UI so you know if you're on the latest) ---
  if (pathname === '/version') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ version: VERSION }));
    return;
  }

  // --- this machine's LAN address(es), so other devices on the network can connect ---
  if (pathname === '/netinfo') {
    const nets = require('os').networkInterfaces();
    const ips = [];
    for (const name of Object.keys(nets)) {
      for (const ni of nets[name] || []) {
        if (ni.family === 'IPv4' && !ni.internal) ips.push(ni.address);
      }
    }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ port: PORT, ips: ips }));
    return;
  }

  // --- one template's full layers on demand (for loading / exporting) ---
  if (pathname === '/template-payload') {
    const id = url.searchParams.get('id');
    const t = allTemplates().find(x => x.id === id);
    res.writeHead(t ? 200 : 404, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(t ? { ok: true, template: { name: t.name, kind: t.kind, layers: t.layers || [] } } : { ok: false }));
    return;
  }

  // --- one preset's full payload on demand (used by Load, since OFF presets omit payload over SSE) ---
  if (pathname === '/show-payload') {
    const id = url.searchParams.get('id');
    const it = (state.shows || []).find(x => x.id === id);
    res.writeHead(it ? 200 : 404, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(it ? { ok: true, payload: it.payload || {} } : { ok: false }));
    return;
  }

  // Full spreadsheet rows for the row editor. Kept off /show-payload on purpose — that one is
  // hit every time somebody opens a preset in the builder, and a 3000-row sheet would ride along.
  if (pathname === '/show-rows') {
    const id = url.searchParams.get('id');
    const it = (state.shows || []).find(x => x.id === id);
    res.writeHead(it ? 200 : 404, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(it
      ? { ok: true, name: it.name, columns: it.columns || [], rows: it.rows || [], rowKey: it.rowKey || '', rowIndex: it.rowIndex || 0, on: !!it.on }
      : { ok: false }));
    return;
  }

  // --- static pages ---
  let rel = pathname === '/' ? '/home.html'
          : pathname === '/output' ? '/output.html'
          : pathname === '/control' ? '/control.html'
          : pathname === '/scoreboards' ? '/scoreboards.html'
          : pathname === '/baseball' ? '/baseball.html'
          : pathname === '/baseball-output' ? '/baseball-output.html'
          : pathname === '/scoreboard' ? '/scoreboard.html'
          : pathname === '/scoreboard-output' ? '/scoreboard-output.html'
          : pathname === '/scorer' ? '/scorer.html'
          : pathname === '/lowerthird' ? '/lowerthird.html'
          : pathname === '/lowerthird-output' ? '/lowerthird-output.html'
          : pathname === '/shows' ? '/shows.html'
          : pathname === '/program-output' ? '/program-output.html'
          : pathname === '/prompter' ? '/prompter.html'
          : pathname === '/prompter-output' ? '/prompter-output.html'
          : pathname === '/control-api' ? '/control-api.html'
          : pathname === '/links' ? '/links.html'
          : pathname;
  // decode %20 etc. so files/folders with spaces (e.g. /media/Grad 2026/jane.jpg) resolve
  try { rel = decodeURIComponent(rel); } catch (e) {}
  // prevent path traversal
  const file = path.join(PUBLIC_DIR, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end('Forbidden'); return; }
  serveFile(res, file);
});

// Friendly message instead of a scary stack trace if the port is already taken
// (usually another copy of StreamGraphics is still running in another window).
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    // StreamGraphics is already running (another window / a previous launch). Instead of
    // failing silently, just open the running app in the browser — so clicking the shortcut
    // again brings it up instead of "doing nothing".
    console.error('\n  ⚠  Port ' + PORT + ' is already in use — StreamGraphics is already running.');
    console.error('     Opening it in your browser:  http://localhost:' + PORT + '/\n');
    openBrowser('http://localhost:' + PORT + '/');
    setTimeout(function () { process.exit(0); }, 2000);  // give the browser a moment to launch, then exit cleanly
    return;
  }
  throw err;
});

server.listen(PORT, () => {
  const nets = require('os').networkInterfaces();
  let lan = 'localhost';
  for (const name of Object.keys(nets)) {
    for (const ni of nets[name] || []) {
      if (ni.family === 'IPv4' && !ni.internal) { lan = ni.address; break; }
    }
  }
  console.log(`\n  StreamGraphics Pro is running.  Open the control panels in your browser:`);
  console.log(`  ---------------------------------------------------------------`);
  console.log(`  Home (all graphics):         http://localhost:${PORT}/`);
  console.log(`  PRESENTER'S TIMER control:   http://localhost:${PORT}/control          · output: /output`);
  console.log(`  BEACH VOLLEYBALL SCOREBOARD: http://localhost:${PORT}/scoreboard       · output: /scoreboard-output`);
  console.log(`     big-button Scorer:        http://localhost:${PORT}/scorer`);
  console.log(`  LOWER THIRD / GRAPHICS:      http://localhost:${PORT}/lowerthird       · output: /lowerthird-output`);
  console.log(`  SHOW LIBRARY:                http://localhost:${PORT}/shows            · output: /program-output`);
  console.log(`  TELEPROMPTER:                http://localhost:${PORT}/prompter         · output: /prompter-output (add ?mirror=1 for glass)`);
  console.log(`  ---------------------------------------------------------------`);
  console.log(`  From ANOTHER computer, swap "localhost" for  ${lan}`);
  console.log(`  e.g. OBS/vMix Browser Source:  http://${lan}:${PORT}/lowerthird-output`);
  console.log(`  Every link, ready to copy or email:  http://localhost:${PORT}/links\n`);
  openBrowser('http://localhost:' + PORT + '/');
});

// Pop the control panel open in the default browser on launch, so double-clicking a
// launcher feels like opening an app. Set SG_NO_OPEN=1 to skip (e.g. on a headless box).
function openBrowser(url) {
  if (process.env.SG_NO_OPEN) return;
  try {
    const cp = require('child_process');
    const plat = process.platform;
    if (plat === 'win32') {
      // Primary: the shell 'start' command. If that fails to spawn (some locked-down
      // setups block it), fall back to explorer.exe, which reliably opens the default browser.
      const c = cp.spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' });
      c.on('error', function () {
        try { cp.spawn('explorer.exe', [url], { detached: true, stdio: 'ignore' }).unref(); } catch (e) {}
      });
      c.unref();
    }
    else if (plat === 'darwin') cp.spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    else cp.spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  } catch (e) { /* no browser (headless) — the URLs above still work */ }
}
