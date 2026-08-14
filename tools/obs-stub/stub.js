/*
 * A stand-in for OBS, so obs-grab.js can be tested without OBS.
 *
 * DEV TOOL. Never shipped. It speaks just enough of obs-websocket v5 to prove the client's
 * handshake, masking, auth challenge and large-frame reassembly are right — the parts that are
 * tedious to debug against a real OBS on someone else's computer.
 *
 *   node tools/obs-stub/stub.js [port] [password]
 */
'use strict';
const net = require('net');
const crypto = require('crypto');
const zlib = require('zlib');

const PORT = parseInt(process.argv[2], 10) || 4455;
const PASSWORD = process.argv[3] || '';
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

// A real PNG, big enough that its base64 crosses the 64KB frame boundary and forces the
// client down the 64-bit length path. Solid colour, so it compresses — hence the padding.
function bigPng(w, h) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const row = y * (w * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < w; x++) {
      raw[row + 1 + x * 3] = (x * 7 + y * 3) & 255;      // noise, so it does NOT compress away
      raw[row + 2 + x * 3] = (x * 13 + y * 5) & 255;
      raw[row + 3 + x * 3] = (x ^ y) & 255;
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0, 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))
  ]);
}
let CRC_T = null;
function crc32(buf) {
  if (!CRC_T) {
    CRC_T = new Int32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1); CRC_T[n] = c; }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_T[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff);
}

const SHOT = 'data:image/png;base64,' + bigPng(640, 360).toString('base64');
const SCENES = ['Intro', 'Camera 1', 'Camera 2', 'Program'];

function frame(opcode, payload) {                    // server -> client: never masked
  const len = payload.length;
  let head;
  if (len < 126) { head = Buffer.alloc(2); head[1] = len; }
  else if (len < 65536) { head = Buffer.alloc(4); head[1] = 126; head.writeUInt16BE(len, 2); }
  else { head = Buffer.alloc(10); head[1] = 127; head.writeUInt32BE(0, 2); head.writeUInt32BE(len, 6); }
  head[0] = 0x80 | opcode;
  return Buffer.concat([head, payload]);
}

net.createServer(function (sock) {
  let up = false, head = '', buf = Buffer.alloc(0), identified = false;
  let challenge = '', salt = '';

  /* FRAGMENT=1 makes the stub split every message across continuation frames. Nothing forces a
   * real OBS to do that, but nothing forbids it either, and reassembly bugs only ever show up
   * on the one machine you cannot debug. */
  const send = (obj) => {
    const pay = Buffer.from(JSON.stringify(obj), 'utf8');
    if (!process.env.FRAGMENT || pay.length < 4) return sock.write(frame(0x1, pay));
    const cut = Math.floor(pay.length / 3);
    sock.write(Buffer.concat([frame(0x1, pay.slice(0, cut))].map(b => { b[0] &= 0x7f; return b; })));      // fin=0, text
    sock.write(Buffer.concat([frame(0x0, pay.slice(cut, cut * 2))].map(b => { b[0] &= 0x7f; return b; }))); // fin=0, continuation
    sock.write(frame(0x0, pay.slice(cut * 2)));                                                            // fin=1, continuation
  };

  sock.on('error', function () {});
  sock.on('data', function (chunk) {
    if (!up) {
      head += chunk.toString('latin1');
      const e = head.indexOf('\r\n\r\n');
      if (e < 0) return;
      const key = (/sec-websocket-key:\s*(\S+)/i.exec(head) || [])[1] || '';
      const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
      sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
      up = true;
      const d = { rpcVersion: 1, obsWebSocketVersion: '5.5.0' };
      if (PASSWORD) {
        challenge = crypto.randomBytes(16).toString('base64');
        salt = crypto.randomBytes(16).toString('base64');
        d.authentication = { challenge: challenge, salt: salt };
      }
      send({ op: 0, d: d });
      const rest = Buffer.from(head.slice(e + 4), 'latin1');
      head = '';
      if (rest.length) { buf = rest; drain(); }
      return;
    }
    buf = Buffer.concat([buf, chunk]);
    drain();
  });

  function drain() {
    for (;;) {
      if (buf.length < 2) return;
      const opcode = buf[0] & 0x0f, masked = (buf[1] & 0x80) !== 0;
      let len = buf[1] & 0x7f, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = buf.readUInt32BE(6); off = 10; }
      let mask = null;
      if (masked) { if (buf.length < off + 4) return; mask = buf.slice(off, off + 4); off += 4; }
      if (buf.length < off + len) return;
      let pay = Buffer.from(buf.slice(off, off + len));
      if (mask) for (let i = 0; i < pay.length; i++) pay[i] ^= mask[i & 3];
      buf = buf.slice(off + len);
      if (opcode === 0x8) { sock.end(); return; }
      if (!masked) { console.log('[stub] client sent an UNMASKED frame — real OBS would drop this'); sock.destroy(); return; }
      if (opcode === 0x1) handle(pay.toString('utf8'));
    }
  }

  function handle(txt) {
    let m; try { m = JSON.parse(txt); } catch (e) { return; }
    if (m.op === 1) {
      if (PASSWORD) {
        const secret = crypto.createHash('sha256').update(PASSWORD + salt).digest('base64');
        const want = crypto.createHash('sha256').update(secret + challenge).digest('base64');
        if ((m.d || {}).authentication !== want) { console.log('[stub] bad password -> closing, like OBS does'); sock.end(); return; }
      }
      identified = true;
      send({ op: 2, d: { negotiatedRpcVersion: 1 } });
      return;
    }
    if (m.op === 6 && identified) {
      const d = m.d || {}, id = d.requestId, t = d.requestType;
      const ok = (data) => send({ op: 7, d: { requestType: t, requestId: id, requestStatus: { result: true, code: 100 }, responseData: data } });
      const no = (code, comment) => send({ op: 7, d: { requestType: t, requestId: id, requestStatus: { result: false, code: code, comment: comment } } });
      if (t === 'GetVersion') return ok({ obsVersion: '31.0.2', obsWebSocketVersion: '5.5.0' });
      if (t === 'GetSceneList') return ok({ currentProgramSceneName: 'Program', scenes: SCENES.map((n, i) => ({ sceneIndex: i, sceneName: n })) });
      if (t === 'GetCurrentProgramScene') return ok({ sceneName: 'Program', currentProgramSceneName: 'Program' });
      if (t === 'GetSourceScreenshot') {
        const want = (d.requestData || {}).sourceName;
        if (SCENES.indexOf(want) < 0) return no(600, 'No source was found by the name of `' + want + '`.');
        return ok({ imageData: SHOT });
      }
      return no(204, 'unknown request');
    }
  }
}).listen(PORT, '127.0.0.1', function () {
  console.log('[stub] pretending to be OBS on 127.0.0.1:' + PORT + (PASSWORD ? ' (password required)' : ' (no password)'));
});
