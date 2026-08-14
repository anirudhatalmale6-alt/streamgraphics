/*
 * A stand-in for vMix's Web API, so vmix-grab.js can be tested without vMix.
 *
 * DEV TOOL. Never shipped. It copies the behaviours that actually caused trouble:
 *   - answers /api/ with a real captured vMix XML document
 *   - reports success for Snapshot IMMEDIATELY, then writes the file a moment later,
 *     which is exactly the race the real thing has
 *   - refuses loopback callers with vMix's own wording
 *   - SLOW=1 makes the write take longer; JPEG=1 makes it write JPEG bytes into a .png name,
 *     the way a switcher that ignores your extension would
 *
 *   node tools/vmix-stub/stub.js <port> [bindAddress]
 */
'use strict';
const http = require('http');
const fs = require('fs');
const zlib = require('zlib');

const PORT = parseInt(process.argv[2], 10) || 8088;
const BIND = process.argv[3] || '127.0.0.5';

const XML = '<vmix><version>29.0.0.48</version><edition>4K</edition>'
  + '<preset>C:\\Users\\test\\last.vmix</preset>'
  + '<inputs>'
  + '<input key="44f4a5f4" number="1" type="Colour" title="Camera 1" state="Running">Camera 1</input>'
  + '<input key="85799a28" number="2" type="Colour" title="Camera 2" state="Running">Camera 2</input>'
  + '<input key="99aa11bb" number="3" type="Video" title="Highlight Reel" state="Paused">Highlight Reel</input>'
  + '</inputs>'
  + '<overlays><overlay number="1"/></overlays>'
  + '<preview>2</preview><active>1</active>'
  + '<fadeToBlack>False</fadeToBlack><recording>False</recording><streaming>False</streaming>'
  + '</vmix>';

function png(w, h, tint) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const row = y * (w * 3 + 1);
    for (let x = 0; x < w; x++) {
      raw[row + 1 + x * 3] = (x + tint) & 255;
      raw[row + 2 + x * 3] = (y + tint) & 255;
      raw[row + 3 + x * 3] = (x ^ y) & 255;
    }
  }
  const crcTable = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c; } return t; })();
  const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td), 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// Minimal but genuinely decodable JPEG is a lot of work; the point of JPEG=1 is only that the
// first bytes say JPEG, which is what the client sniffs on.
function fakeJpeg() { return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2048, 0x5a), Buffer.from([0xff, 0xd9])]); }

let shot = 0;

http.createServer((req, res) => {
  // Judged on the address the CALLER asked for, not the socket source — a connection to any
  // 127.x address still arrives from 127.0.0.1, which would refuse the tests themselves.
  const asked = String(req.headers.host || '').split(':')[0];
  const q = req.url.indexOf('?') >= 0 ? req.url.slice(req.url.indexOf('?') + 1) : '';
  const p = {};
  q.split('&').filter(Boolean).forEach(kv => { const i = kv.indexOf('='); p[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1)); });

  if (asked === '127.0.0.1' || asked === 'localhost') {   // vMix's real refusal, verbatim
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('Browser script access not permitted');
  }
  if (!p.Function) {
    res.writeHead(200, { 'Content-Type': 'text/xml' });
    return res.end(XML);
  }
  if (p.Function === 'Snapshot' || p.Function === 'SnapshotInput') {
    const file = p.Value;
    // Success is reported NOW; the file shows up later. This is the race worth testing.
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Function completed successfully');
    if (!file) return;
    const delay = process.env.SLOW ? 2500 : 350;
    shot++;
    setTimeout(() => {
      const body = process.env.JPEG ? fakeJpeg() : png(320, 180, shot * 40);
      // Written in two goes, so a client that pounces on first sight sees a half-file.
      try {
        fs.writeFileSync(file, body.slice(0, Math.floor(body.length / 2)));
        setTimeout(() => { try { fs.appendFileSync(file, body.slice(Math.floor(body.length / 2))); } catch (e) {} }, 150);
      } catch (e) { console.log('[stub] could not write', file, e.message); }
    }, delay);
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Function completed successfully');
}).listen(PORT, BIND, () => console.log('[stub] pretending to be vMix on ' + BIND + ':' + PORT));
