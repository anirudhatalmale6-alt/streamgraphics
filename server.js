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

const PORT = process.env.PORT || 4000;
const PUBLIC_DIR = path.join(__dirname, 'public');
let VERSION = '?'; try { VERSION = require('./package.json').version; } catch (e) {}

// Update check: the app fetches a small JSON manifest you host (e.g. streamgraphicspro.com/latest.json
// → {"version":"0.40.0","url":"https://...","notes":"..."}) and shows an in-app banner if newer.
const UPDATE_MANIFEST = process.env.SG_UPDATE_URL || 'https://streamgraphicspro.com/latest.json';
let _updCache = { at: 0, data: null };
function cmpVer(a, b) { const A = String(a).split('.').map(n => parseInt(n, 10) || 0), B = String(b).split('.').map(n => parseInt(n, 10) || 0); for (let i = 0; i < 3; i++) { if ((A[i] || 0) > (B[i] || 0)) return 1; if ((A[i] || 0) < (B[i] || 0)) return -1; } return 0; }
function checkUpdate(cb) {
  if (Date.now() - _updCache.at < 6 * 3600 * 1000) { cb(_updCache.data); return; }
  try {
    const req = https.get(UPDATE_MANIFEST, { timeout: 4000 }, res => {
      let d = ''; res.on('data', c => { d += c; if (d.length > 5000) req.destroy(); }); res.on('end', () => { let j = null; try { j = JSON.parse(d); } catch (e) {} _updCache = { at: Date.now(), data: j }; cb(j); });
    });
    req.on('error', () => { _updCache = { at: Date.now(), data: null }; cb(null); });
    req.on('timeout', () => { req.destroy(); cb(null); });
  } catch (e) { cb(null); }
}

/* ------------------------------------------------------------------ *
 *  LICENSING — offline, signed keys. The app carries the PUBLIC key and
 *  verifies a license key locally (no internet needed). Keys are minted by
 *  the vendor with the matching PRIVATE key (see make-license.js). A valid
 *  key removes the watermark and unlocks whatever features/add-ons it lists.
 * ------------------------------------------------------------------ */
const LICENSE_PUBKEY = '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAxJCY9hxwDyCcX68yfaIsFewPUgFhn9haZeUrMfD7vrc=\n-----END PUBLIC KEY-----\n';
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
    // License (free by default → watermark on, add-ons off).
    license: { active: false, key: '', name: '', tier: 'free', features: [] }
  };
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
  try { if (fs.existsSync(TPL_FILE)) { const j = JSON.parse(fs.readFileSync(TPL_FILE, 'utf8')); if (j && Array.isArray(j.items)) state.userTemplates = j.items; } } catch (e) {}
})();
function saveTemplates() { writeJson(TPL_FILE, function () { return { items: state.userTemplates }; }); }
function allTemplates() { return builtinTemplates().concat(state.userTemplates || []); }

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
    if (it.on) return it; // ON presets travel in full (payload + rows) for the Program output
    // OFF: metadata only + light row info (labels for the picker), but not the heavy payload/rows.
    return {
      id: it.id, name: it.name, kind: it.kind, on: it.on,
      columns: it.columns || [], rowKey: it.rowKey || '', rowIndex: it.rowIndex || 0, rowTransition: it.rowTransition || 'cut', rowDelay: it.rowDelay == null ? 1000 : it.rowDelay,
      rowCount: it.rows ? it.rows.length : 0,
      rowLabels: it.rows ? it.rows.map(function (r) { return it.rowKey ? (r[it.rowKey] || '') : (r[Object.keys(r)[0]] || ''); }) : []
    };
  });
  // Templates travel as metadata only (name/kind/builtin); the layers are fetched on demand.
  const templates = allTemplates().map(function (t) { return { id: t.id, name: t.name, kind: t.kind, builtin: !!t.builtin }; });
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

    case 'sb_style': { const sb = boardOf(action.board); if (sb) Object.assign(sb.style, action.style || {}); break; }

    /* ---- board management (create / rename / delete scoreboards) ---- */
    case 'sb_board_add': { if ((state.scoreboards || []).length < 24) state.scoreboards.push(defaultScoreboard(String(action.name || ('Court ' + (state.scoreboards.length + 1))).slice(0, 60))); break; }
    case 'sb_board_rename': { const sb = boardOf(action.board); if (sb && action.name != null) sb.name = String(action.name).slice(0, 60); break; }
    case 'sb_board_delete': { if ((state.scoreboards || []).length > 1) state.scoreboards = state.scoreboards.filter(b => b.id !== action.board); break; }

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
        const n = (L.slides || []).length, cmd = String(action.cmd || '');
        let i = (L.index == null ? -1 : L.index);
        if (cmd === 'next') { i = (i < 0 ? 0 : i + 1); i = n ? Math.min(i, n - 1) : -1; }
        else if (cmd === 'prev') { if (i > 0) i = i - 1; }
        else if (cmd === 'first') { i = n ? 0 : -1; }
        else if (cmd === 'last') { i = n ? n - 1 : -1; }
        else if (cmd === 'blank') { i = -1; }
        else if (cmd === 'goto') { i = parseInt(action.n, 10); if (isNaN(i)) i = -1; i = Math.max(-1, Math.min(n - 1, i)); }
        L.index = i;
        saveLowerThird();
      }
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
    case 'show_toggle': { const it = state.shows.find(x => x.id === action.id); if (it) { it.on = (action.on == null ? !it.on : !!action.on); saveShows(); } break; }
    case 'show_alloff': state.shows.forEach(x => { x.on = false; }); saveShows(); break;

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
      saveShows(); break;
    }
    case 'show_rowselect': {
      const it = state.shows.find(x => x.id === action.id); if (!it || !it.rows || !it.rows.length) break;
      const n = it.rows.length; let i = it.rowIndex || 0; const cmd = String(action.cmd || 'goto');
      if (cmd === 'next') i = Math.min(n - 1, i + 1);
      else if (cmd === 'prev') i = Math.max(0, i - 1);
      else { i = parseInt(action.n, 10); if (isNaN(i)) i = 0; i = Math.max(0, Math.min(n - 1, i)); }
      it.rowIndex = i; saveShows(); break;
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
      if (it.rows.length < 3000) { it.rows.push(o); it.rowIndex = it.rows.length - 1; }
      if (!it.rowKey) it.rowKey = it.columns[0] || '';
      saveShows(); break;
    }
    case 'show_clear_csv': { const it = state.shows.find(x => x.id === action.id); if (it) { delete it.rows; delete it.columns; delete it.rowKey; it.rowIndex = 0; saveShows(); } break; }

    default:
      return false;
  }
  return true;
}

// Live value (ms) of a timer layer at server time `now`. Shared shape with the standalone timer.
function liveTimerMs(t, now) {
  if (t.mode === 'up')  return (t.baseMs || 0) + (t.running ? now - t.anchorServer : 0);
  if (t.mode === 'tod') return Math.max(0, (t.targetEpoch || 0) - now);
  const rem = (t.baseMs || 0) - (t.running ? now - t.anchorServer : 0);
  return t.overtime ? rem : Math.max(0, rem);
}

function clampGame(g) { g = parseInt(g, 10) || 0; return g < 0 ? 0 : (g > 2 ? 2 : g); }

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

  // --- static pages ---
  let rel = pathname === '/' ? '/home.html'
          : pathname === '/output' ? '/output.html'
          : pathname === '/control' ? '/control.html'
          : pathname === '/scoreboard' ? '/scoreboard.html'
          : pathname === '/scoreboard-output' ? '/scoreboard-output.html'
          : pathname === '/scorer' ? '/scorer.html'
          : pathname === '/lowerthird' ? '/lowerthird.html'
          : pathname === '/lowerthird-output' ? '/lowerthird-output.html'
          : pathname === '/shows' ? '/shows.html'
          : pathname === '/program-output' ? '/program-output.html'
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
    console.error('\n  ⚠  Port ' + PORT + ' is already in use.');
    console.error('     StreamGraphics is probably already running in another window.');
    console.error('     • Just use that one (open http://localhost:' + PORT + '/ ), OR');
    console.error('     • close the other window (click it, press Ctrl+C), then run this again, OR');
    console.error('     • start this copy on a different port:');
    console.error('         PowerShell:   $env:PORT=4001; node server.js');
    console.error('         Mac/Linux:    PORT=4001 node server.js\n');
    process.exit(1);
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
  console.log(`  ---------------------------------------------------------------`);
  console.log(`  From ANOTHER computer, swap "localhost" for  ${lan}`);
  console.log(`  e.g. OBS/vMix Browser Source:  http://${lan}:${PORT}/lowerthird-output\n`);
  openBrowser('http://localhost:' + PORT + '/');
});

// Pop the control panel open in the default browser on launch, so double-clicking a
// launcher feels like opening an app. Set SG_NO_OPEN=1 to skip (e.g. on a headless box).
function openBrowser(url) {
  if (process.env.SG_NO_OPEN) return;
  try {
    const cp = require('child_process');
    const plat = process.platform;
    if (plat === 'win32') cp.spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    else if (plat === 'darwin') cp.spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    else cp.spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  } catch (e) { /* no browser (headless) — the URLs above still work */ }
}
