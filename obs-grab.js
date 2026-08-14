/*
 * StreamGraphics Pro — grab a still frame out of OBS.
 *
 * Why this file exists: aligning a lower third against the actual video beats aligning it against
 * an empty canvas. OBS already knows what is on screen, so we ask it, rather than making the
 * operator alt-tab, hit Win+Shift+S and paste.
 *
 * OBS ships with obs-websocket built in (Tools > WebSocket Server Settings). It speaks WebSocket,
 * and the image comes back down the same connection as base64 — which is what makes OBS work from
 * ANOTHER computer, where a file written to disk would not.
 *
 * Zero dependencies, like the rest of this app: the WebSocket client below is written against
 * RFC 6455 with nothing but `net` and `crypto`. That is a deliberate cost. Pulling in a websocket
 * library would be three lines, and would also be the first third-party code in a product whose
 * selling point is that there is none.
 *
 * The password never comes near this file's author: it is typed into the app by the operator,
 * held in memory for the length of one request, and used only to answer OBS's challenge.
 */
'use strict';
const net = require('net');
const crypto = require('crypto');

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/* ---------------------------------------------------------------------------
 * A minimal RFC 6455 client. Text frames only in, text frames only out — which
 * is all obs-websocket uses. Big payloads matter here: a 1920x1080 PNG comes
 * back base64'd, comfortably past the 64KB mark, so the 64-bit length case is
 * not theoretical and neither is reassembly across TCP reads.
 * ------------------------------------------------------------------------- */
function WsClient(host, port) {
  this.host = host; this.port = port;
  this.sock = null; this.open = false;
  this.buf = Buffer.alloc(0);
  this.frag = null; this.fragOp = 0;
  this.onmessage = null; this.onerror = null; this.onclose = null;
}

WsClient.prototype.connect = function (cb) {
  const self = this;
  const key = crypto.randomBytes(16).toString('base64');
  const expect = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
  let handshakeDone = false, head = '';

  const sock = net.connect({ host: this.host, port: this.port });
  this.sock = sock;
  sock.setNoDelay(true);
  sock.setTimeout(15000, function () { self.fail(new Error('OBS did not answer within 15 seconds'), cb); });

  sock.on('error', function (e) { self.fail(e, cb); });
  sock.on('close', function () {
    self.open = false;
    if (self.onclose) self.onclose();
  });

  sock.on('connect', function () {
    sock.write(
      'GET / HTTP/1.1\r\n' +
      'Host: ' + self.host + ':' + self.port + '\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      'Sec-WebSocket-Key: ' + key + '\r\n' +
      'Sec-WebSocket-Version: 13\r\n\r\n');
  });

  sock.on('data', function (chunk) {
    if (!handshakeDone) {
      head += chunk.toString('latin1');
      const end = head.indexOf('\r\n\r\n');
      if (end < 0) { if (head.length > 16384) self.fail(new Error('OBS sent a malformed reply'), cb); return; }
      const raw = head.slice(0, end);
      const rest = Buffer.from(head.slice(end + 4), 'latin1');
      if (!/^HTTP\/1\.1 101/.test(raw)) {
        return self.fail(new Error('That address answered, but it is not the OBS WebSocket server.'), cb);
      }
      const m = /sec-websocket-accept:\s*(\S+)/i.exec(raw);
      if (!m || m[1] !== expect) return self.fail(new Error('That address answered, but not as a WebSocket server.'), cb);
      handshakeDone = true; self.open = true;
      sock.setTimeout(0);
      cb(null);
      if (rest.length) self.feed(rest);
      return;
    }
    self.feed(chunk);
  });
};

WsClient.prototype.fail = function (err, cb) {
  if (this.failed) return;
  this.failed = true;
  try { this.sock.destroy(); } catch (e) {}
  if (cb) cb(err); else if (this.onerror) this.onerror(err);
};

WsClient.prototype.feed = function (chunk) {
  this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
  for (;;) {
    const f = this.readFrame();
    if (!f) return;
    if (f.opcode === 0x9) { this.sendFrame(0xA, f.payload); continue; }   // ping -> pong
    if (f.opcode === 0xA) continue;                                       // pong
    if (f.opcode === 0x8) { try { this.sock.end(); } catch (e) {} return; }

    if (f.opcode === 0x0) {                                               // continuation
      if (!this.frag) continue;
      this.frag = Buffer.concat([this.frag, f.payload]);
    } else {
      this.frag = f.payload; this.fragOp = f.opcode;
    }
    if (!f.fin) continue;
    const whole = this.frag; this.frag = null;
    if (this.fragOp === 0x1 && this.onmessage) this.onmessage(whole.toString('utf8'));
  }
};

// Returns null when the buffer does not yet hold a whole frame — the normal case mid-download.
WsClient.prototype.readFrame = function () {
  const b = this.buf;
  if (b.length < 2) return null;
  const fin = (b[0] & 0x80) !== 0, opcode = b[0] & 0x0f;
  const masked = (b[1] & 0x80) !== 0;
  let len = b[1] & 0x7f, off = 2;
  if (len === 126) { if (b.length < 4) return null; len = b.readUInt16BE(2); off = 4; }
  else if (len === 127) {
    if (b.length < 10) return null;
    const hi = b.readUInt32BE(2), lo = b.readUInt32BE(6);
    if (hi !== 0) { this.fail(new Error('OBS sent an implausibly large frame')); return null; }
    len = lo; off = 10;
  }
  let mask = null;
  if (masked) { if (b.length < off + 4) return null; mask = b.slice(off, off + 4); off += 4; }
  if (b.length < off + len) return null;
  let payload = b.slice(off, off + len);
  if (mask) { payload = Buffer.from(payload); for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3]; }
  this.buf = b.slice(off + len);
  return { fin: fin, opcode: opcode, payload: payload };
};

WsClient.prototype.sendFrame = function (opcode, payload) {
  if (!this.sock || this.sock.destroyed) return;
  const len = payload.length;
  let header;
  if (len < 126) { header = Buffer.alloc(2); header[1] = 0x80 | len; }
  else if (len < 65536) { header = Buffer.alloc(4); header[1] = 0x80 | 126; header.writeUInt16BE(len, 2); }
  else { header = Buffer.alloc(10); header[1] = 0x80 | 127; header.writeUInt32BE(0, 2); header.writeUInt32BE(len, 6); }
  header[0] = 0x80 | opcode;
  // A client MUST mask. OBS closes the connection on an unmasked frame rather than tolerating it.
  const mask = crypto.randomBytes(4);
  const out = Buffer.from(payload);
  for (let i = 0; i < out.length; i++) out[i] ^= mask[i & 3];
  this.sock.write(Buffer.concat([header, mask, out]));
};

WsClient.prototype.sendText = function (s) { this.sendFrame(0x1, Buffer.from(s, 'utf8')); };
WsClient.prototype.close = function () { try { this.sendFrame(0x8, Buffer.alloc(0)); this.sock.end(); } catch (e) {} };

/* ---------------------------------------------------------------------------
 * obs-websocket v5 conversation.
 *   op 0 Hello       -> may carry an auth challenge
 *   op 1 Identify    <- we answer it
 *   op 2 Identified
 *   op 6 Request     <- ours
 *   op 7 RequestResponse
 * ------------------------------------------------------------------------- */
function authString(password, salt, challenge) {
  const secret = crypto.createHash('sha256').update(String(password) + salt).digest('base64');
  return crypto.createHash('sha256').update(secret + challenge).digest('base64');
}

/* Opens a connection, identifies, runs `steps` one request at a time, then closes.
 * Each step is {type, data} and the results arrive as an array in the same order. */
function session(opts, steps, done) {
  const host = opts.host || '127.0.0.1';
  const port = parseInt(opts.port, 10) || 4455;
  const ws = new WsClient(host, port);
  let finished = false, i = 0;
  const results = [];

  function finish(err, val) {
    if (finished) return;
    finished = true;
    try { ws.close(); } catch (e) {}
    done(err, val);
  }
  // Nothing in this protocol is slow. If we are still waiting after 20s something is wrong at the
  // other end, and an operator staring at a spinner mid-show deserves to be told so.
  const timer = setTimeout(function () { finish(new Error('OBS connected but stopped responding.')); }, 20000);
  const clear = function () { clearTimeout(timer); };

  ws.onclose = function () { if (!finished) { clear(); finish(new Error('OBS closed the connection. If it has a password set, check it is right.')); } };
  ws.onerror = function (e) { clear(); finish(e); };

  function next() {
    if (i >= steps.length) { clear(); return finish(null, results); }
    const s = steps[i];
    ws.sendText(JSON.stringify({ op: 6, d: { requestType: s.type, requestId: 'r' + i, requestData: s.data || {} } }));
  }

  ws.onmessage = function (txt) {
    let msg;
    try { msg = JSON.parse(txt); } catch (e) { return; }

    if (msg.op === 0) {
      const d = msg.d || {};
      const ident = { rpcVersion: d.rpcVersion || 1, eventSubscriptions: 0 };
      if (d.authentication) {
        if (!opts.password) { clear(); return finish(new Error('OBS is asking for a password. Copy it from OBS: Tools > WebSocket Server Settings > Show Connect Info.')); }
        ident.authentication = authString(opts.password, d.authentication.salt, d.authentication.challenge);
      }
      ws.sendText(JSON.stringify({ op: 1, d: ident }));
      return;
    }
    if (msg.op === 2) { next(); return; }
    if (msg.op === 7) {
      const d = msg.d || {}, st = d.requestStatus || {};
      if (!st.result) {
        clear();
        return finish(new Error(friendlyRequestError(d.requestType, st)));
      }
      results.push(d.responseData || {});
      i++; next(); return;
    }
  };

  ws.connect(function (err) {
    if (err) { clear(); return finish(friendlyConnectError(err, host, port)); }
  });
}

function friendlyConnectError(err, host, port) {
  const code = err && err.code;
  if (code === 'ECONNREFUSED') {
    return new Error('Nothing is listening on ' + host + ':' + port + '. In OBS: Tools > WebSocket Server Settings, tick "Enable WebSocket server".');
  }
  if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH' || code === 'ENOTFOUND') {
    return new Error('Could not reach ' + host + '. Check the address of the computer running OBS.');
  }
  if (code === 'ETIMEDOUT') {
    return new Error(host + ' did not answer. If OBS is on another computer, its firewall is the usual reason.');
  }
  return err;
}

function friendlyRequestError(type, st) {
  // 600 is obs-websocket's "you asked about something that isn't there".
  if (st.code === 600 && type === 'GetSourceScreenshot') {
    return 'OBS could not find that scene or source to grab.';
  }
  return 'OBS refused the request' + (st.comment ? ': ' + st.comment : ' (code ' + st.code + ').');
}

/* ---------------------------------------------------------------------------
 * The two things the app actually wants.
 * ------------------------------------------------------------------------- */

// What can be grabbed: every scene, and which one is live.
function listScenes(opts, done) {
  session(opts, [{ type: 'GetVersion' }, { type: 'GetSceneList' }], function (err, res) {
    if (err) return done(err);
    const ver = res[0] || {}, list = res[1] || {};
    const scenes = (list.scenes || []).map(function (s) { return s.sceneName; }).filter(Boolean);
    done(null, {
      obsVersion: ver.obsVersion || '',
      websocketVersion: ver.obsWebSocketVersion || '',
      current: list.currentProgramSceneName || '',
      scenes: scenes.reverse()      // OBS hands them back bottom-up; humans read them top-down
    });
  });
}

/* One still frame, as a data URI ready to drop straight into the builder's reference slot.
 * No source name given = whatever is on program right now, which is what "grab what I'm looking
 * at" means to everyone except a programmer. */
function grabFrame(opts, done) {
  const width = Math.min(3840, Math.max(320, parseInt(opts.width, 10) || 1920));
  const shot = {
    imageFormat: 'png',
    imageWidth: width,
    imageHeight: Math.round(width * 9 / 16)
  };
  if (opts.source) {
    shot.sourceName = opts.source;
    return session(opts, [{ type: 'GetSourceScreenshot', data: shot }], function (err, res) {
      if (err) return done(err);
      done(null, { dataUri: (res[0] || {}).imageData || '', source: opts.source });
    });
  }
  session(opts, [{ type: 'GetCurrentProgramScene' }], function (err, res) {
    if (err) return done(err);
    const r0 = res[0] || {};
    // The field was renamed between obs-websocket 5.0 and 5.1; accept either rather than
    // breaking for whoever has not updated OBS.
    const scene = r0.sceneName || r0.currentProgramSceneName || '';
    if (!scene) return done(new Error('OBS did not say which scene is live.'));
    shot.sourceName = scene;
    session(opts, [{ type: 'GetSourceScreenshot', data: shot }], function (err2, res2) {
      if (err2) return done(err2);
      done(null, { dataUri: (res2[0] || {}).imageData || '', source: scene });
    });
  });
}

module.exports = { listScenes: listScenes, grabFrame: grabFrame, _WsClient: WsClient, _authString: authString };
