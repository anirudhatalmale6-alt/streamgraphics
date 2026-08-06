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
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 4000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOAD_DIR = path.join(PUBLIC_DIR, 'uploads');
try { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch (e) {}
let uploadSeq = 0;

/* ------------------------------------------------------------------ *
 *  State
 *  One graphic for Milestone 1: the timer family (countdown / count-up /
 *  countdown-to-clock-time). State is stored generically so more graphics
 *  and more feeds can be added later without changing the transport.
 * ------------------------------------------------------------------ */
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
    scoreboard: {
      visible: false,
      title: 'HERMOSA BEACH OPEN 2025',
      presenter: 'WEDBUSH',
      bracketLabel: "MEN'S CONTENDER'S BRACKET",
      eventLogoUrl: '',        // big event logo (e.g. the Hermosa Beach Open mark)
      eventLogoPlacement: 'inline', // 'inline' (inside the board) OR one of the 9 screen anchors = free overlay
      eventLogoSize: 150,      // px height when used as a free overlay
      gamesCount: 3,
      activeGame: 0,           // which game column is "current" (highlighted)
      teams: [
        { p1: 'Terese Cannon', p2: 'Megan Kraft', seed: '1', color: '#f5c518', rowColor: '', textColor: '', logoUrl: '', games: [0, null, null] },
        { p1: 'Kelly Cheng',   p2: 'Molly Shaw',  seed: '2', color: '#1f7a8c', rowColor: '', textColor: '', logoUrl: '', games: [0, null, null] }
      ],
      style: {
        position: 'bottom-left',
        animation: 'slide-up',
        accent: '#1e64d2',       // active-cell highlight
        bracketColor: '#7a1420', // the round-label strip
        backdropUrl: '',         // optional Photoshop backdrop image (replaces the coded frame)
        chroma: ''               // '' = transparent (OBS/vMix key) | 'green'|'magenta'|'blue'|#hex for a hardware switcher
      }
    },

    // The lower-third BUILDER: a free-form canvas (1920x1080) of independent
    // layers (text / box / image). Each layer is positioned + sized by pixel,
    // stacked by z, styled, and animated on its own (with a delay for staggering).
    // This is the WYSIWYG, no-template flexibility — nothing is hard-coded.
    lowerthird: {
      visible: false,
      chroma: '',
      w: 1920, h: 1080,
      vcmd: { id: '', cmd: '', seq: 0 },   // transient video playback command (play/pause/restart)
      layers: defaultLowerThirdLayers()
    },

    // The Show Library — saved named graphics, recallable and toggleable on the Program output.
    shows: []
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
    { id: 'title',  type: 'text',  x: 182, y: 972, w: 560, h: 28, z: 3, text: 'HEAD COACH · SEA HAWKS', font: "'Segoe UI', Arial, sans-serif", size: 17, bold: false, italic: false, color: '#e7b53c', align: 'left',
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
function saveLibrary() {
  try { fs.writeFileSync(LIB_FILE, JSON.stringify({ teams: state.library.teams }, null, 2)); } catch (e) {}
}
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
function saveLowerThird() {
  try { fs.writeFileSync(LT_FILE, JSON.stringify({ layers: state.lowerthird.layers }, null, 2)); } catch (e) {}
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
function saveShows() {
  try { fs.writeFileSync(SHOWS_FILE, JSON.stringify({ items: state.shows }, null, 2)); } catch (e) {}
}

/* ------------------------------------------------------------------ *
 *  SSE client registry
 * ------------------------------------------------------------------ */
const clients = new Set();

function broadcast() {
  const payload = JSON.stringify({ serverTime: Date.now(), state });
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
    case 'sb_show': state.scoreboard.visible = true;  break;
    case 'sb_hide': state.scoreboard.visible = false; break;

    case 'sb_restart': // "Restart Match": game 1 -> 0, later games -> "--"
      state.scoreboard.teams.forEach(function (tm) {
        tm.games = [0, null, null].slice(0, state.scoreboard.gamesCount);
      });
      state.scoreboard.activeGame = 0;
      break;

    case 'sb_startGame': { // bring a "--" game to 0 for both teams and make it active
      const g = clampGame(action.game);
      state.scoreboard.teams.forEach(function (tm) { if (tm.games[g] == null) tm.games[g] = 0; });
      state.scoreboard.activeGame = g;
      break;
    }

    case 'sb_backGame': { // undo Start Next Game — reset the active game to "--" and step back
      const g = state.scoreboard.activeGame | 0;
      if (g > 0) {
        state.scoreboard.teams.forEach(function (tm) { tm.games[g] = null; });
        state.scoreboard.activeGame = g - 1;
      }
      break;
    }

    case 'sb_score': { // +/- a started game's score (null games ignored)
      const g = clampGame(action.game);
      const tm = state.scoreboard.teams[action.team === 1 ? 1 : 0];
      if (tm.games[g] == null) tm.games[g] = 0;
      let v = tm.games[g] + (Number(action.delta) || 0);
      if (v < 0) v = 0;
      tm.games[g] = v;
      break;
    }

    case 'sb_setScore': { // direct set; value '' or '--' clears to null
      const g = clampGame(action.game);
      const tm = state.scoreboard.teams[action.team === 1 ? 1 : 0];
      const raw = String(action.value).trim();
      tm.games[g] = (raw === '' || raw === '--') ? null : Math.max(0, parseInt(raw, 10) || 0);
      break;
    }

    case 'sb_setActive': state.scoreboard.activeGame = clampGame(action.game); break;

    case 'sb_team': { // edit a team's name/seed/colour/logo fields
      const tm = state.scoreboard.teams[action.team === 1 ? 1 : 0];
      ['p1', 'p2', 'seed', 'color', 'rowColor', 'textColor', 'logoUrl'].forEach(function (k) {
        if (action[k] != null) tm[k] = String(action[k]).slice(0, 300);
      });
      break;
    }

    case 'sb_meta': // title / presenter / bracket label / event logo
      if (action.title != null)     state.scoreboard.title = String(action.title).slice(0, 80);
      if (action.presenter != null) state.scoreboard.presenter = String(action.presenter).slice(0, 40);
      if (action.bracketLabel != null) state.scoreboard.bracketLabel = String(action.bracketLabel).slice(0, 80);
      if (action.eventLogoUrl != null) state.scoreboard.eventLogoUrl = String(action.eventLogoUrl).slice(0, 500);
      if (action.eventLogoPlacement != null) {
        var ok = ['inline','top-left','top-center','top-right','mid-left','mid-center','mid-right','bottom-left','bottom-center','bottom-right'];
        if (ok.indexOf(action.eventLogoPlacement) >= 0) state.scoreboard.eventLogoPlacement = action.eventLogoPlacement;
      }
      if (action.eventLogoSize != null) {
        var sz = parseInt(action.eventLogoSize, 10) || 150;
        state.scoreboard.eventLogoSize = Math.max(40, Math.min(600, sz));
      }
      break;

    case 'sb_style': Object.assign(state.scoreboard.style, action.style || {}); break;

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
      if (existing) { existing.name = name; existing.kind = kind; existing.payload = payload; }
      else {
        if (state.shows.length >= 300) break;
        state.shows.push({ id: 'S' + Date.now().toString(36) + (state.shows.length), name, kind, payload, on: false });
      }
      saveShows();
      break;
    }
    case 'show_delete': state.shows = state.shows.filter(x => x.id !== action.id); saveShows(); break;
    case 'show_rename': { const it = state.shows.find(x => x.id === action.id); if (it) { it.name = String(action.name || it.name).slice(0, 120); saveShows(); } break; }
    case 'show_toggle': { const it = state.shows.find(x => x.id === action.id); if (it) { it.on = (action.on == null ? !it.on : !!action.on); saveShows(); } break; }
    case 'show_alloff': state.shows.forEach(x => { x.on = false; }); saveShows(); break;

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
    res.write(`data: ${JSON.stringify({ serverTime: Date.now(), state })}\n\n`);
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
        const fname = 'up_' + Date.now() + '_' + (uploadSeq++) + '.' + ext;
        fs.writeFile(path.join(UPLOAD_DIR, fname), Buffer.from(m[2], 'base64'), (err) => {
          if (err) { res.writeHead(500); res.end('{"ok":false}'); return; }
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ ok: true, url: '/uploads/' + fname }));
        });
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end('{"ok":false}');
      }
    });
    return;
  }

  // --- current state (handy for debugging) ---
  if (pathname === '/state') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ serverTime: Date.now(), state }));
    return;
  }

  // --- static pages ---
  let rel = pathname === '/' ? '/home.html'
          : pathname === '/output' ? '/output.html'
          : pathname === '/control' ? '/control.html'
          : pathname === '/scoreboard' ? '/scoreboard.html'
          : pathname === '/scoreboard-output' ? '/scoreboard-output.html'
          : pathname === '/lowerthird' ? '/lowerthird.html'
          : pathname === '/lowerthird-output' ? '/lowerthird-output.html'
          : pathname === '/shows' ? '/shows.html'
          : pathname === '/program-output' ? '/program-output.html'
          : pathname;
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
  console.log(`\n  StreamGraphics is running.  Open the control panels in your browser:`);
  console.log(`  ---------------------------------------------------------------`);
  console.log(`  Home (all graphics):         http://localhost:${PORT}/`);
  console.log(`  PRESENTER'S TIMER control:   http://localhost:${PORT}/control          · output: /output`);
  console.log(`  BEACH VOLLEYBALL SCOREBOARD: http://localhost:${PORT}/scoreboard       · output: /scoreboard-output`);
  console.log(`  LOWER THIRD / GRAPHICS:      http://localhost:${PORT}/lowerthird       · output: /lowerthird-output`);
  console.log(`  SHOW LIBRARY:                http://localhost:${PORT}/shows            · output: /program-output`);
  console.log(`  ---------------------------------------------------------------`);
  console.log(`  From ANOTHER computer, swap "localhost" for  ${lan}`);
  console.log(`  e.g. OBS/vMix Browser Source:  http://${lan}:${PORT}/lowerthird-output\n`);
});
