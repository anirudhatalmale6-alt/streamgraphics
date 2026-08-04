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
    }
  };
}

let state = defaultState();

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
  // countdown
  const rem = t.baseMs - (t.running ? now - t.anchorServer : 0);
  return Math.max(0, rem);
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

    case 'setStyle':
      Object.assign(t.style, action.style || {});
      break;

    case 'setState': // bulk (used by control panel restoring a preset later)
      Object.assign(t, action.timer || {});
      break;

    default:
      return false;
  }
  return true;
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
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
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

  // --- current state (handy for debugging) ---
  if (pathname === '/state') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ serverTime: Date.now(), state }));
    return;
  }

  // --- static pages ---
  let rel = pathname === '/' ? '/control.html'
          : pathname === '/output' ? '/output.html'
          : pathname === '/control' ? '/control.html'
          : pathname;
  // prevent path traversal
  const file = path.join(PUBLIC_DIR, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end('Forbidden'); return; }
  serveFile(res, file);
});

server.listen(PORT, () => {
  const nets = require('os').networkInterfaces();
  let lan = 'localhost';
  for (const name of Object.keys(nets)) {
    for (const ni of nets[name] || []) {
      if (ni.family === 'IPv4' && !ni.internal) { lan = ni.address; break; }
    }
  }
  console.log(`\n  StreamGraphics is running.`);
  console.log(`  ------------------------------------------`);
  console.log(`  Control panel (this computer):  http://localhost:${PORT}/control`);
  console.log(`  Output for OBS/vMix (this PC):   http://localhost:${PORT}/output`);
  console.log(`  Output from ANOTHER computer:    http://${lan}:${PORT}/output`);
  console.log(`  ------------------------------------------\n`);
});
