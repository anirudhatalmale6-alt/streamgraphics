/*
 * StreamGraphics Pro — grab a still frame out of vMix.
 *
 * The counterpart to obs-grab.js, and a different shape of problem. OBS hands the picture back
 * down the connection; vMix does not. vMix's only way to produce a still is to SAVE ONE TO DISK
 * on the vMix machine. So this asks vMix to write a file and then reads that file. When
 * StreamGraphics is running on the vMix computer that is seamless. When it is not, the file lands
 * on a computer we cannot see, and the honest thing is to say so rather than time out mysteriously.
 *
 * Two vMix functions matter, and confusing them costs an afternoon:
 *   Snapshot        — the current OUTPUT. The program feed. What you actually want.
 *   SnapshotInput   — one specific input, ignoring what is on air.
 *
 * One more trap, learned the hard way: vMix answers "success" the instant it accepts the command,
 * before the file exists. And if you reuse a filename, every viewer downstream caches the old
 * picture and you spend an hour convinced vMix is broken. So: a fresh filename every single time.
 *
 * vMix only answers its API on the machine's own network address, never on 127.0.0.1 — it treats
 * loopback callers as browser scripts and refuses them ("Browser script access not permitted").
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const DEFAULT_PORT = 8088;

function api(opts, query, cb) {
  const host = String(opts.host || '').trim();
  const port = parseInt(opts.port, 10) || DEFAULT_PORT;
  // Only the three a person actually types. vMix refuses loopback callers outright, and being told
  // that up front beats being told "Browser script access not permitted" by vMix a second later.
  if (!host || /^(127\.0\.0\.1|localhost|::1)$/i.test(host)) {
    return cb(new Error('vMix will not answer on localhost. Use the address vMix shows you under Settings > Web Controller — it looks like 192.168.x.x.'));
  }
  const req = http.get({ host: host, port: port, path: '/api/' + (query || ''), timeout: 8000 }, (res) => {
    let body = '';
    res.setEncoding('utf8');
    res.on('data', c => { body += c; if (body.length > 8e6) req.destroy(); });
    res.on('end', () => {
      if (res.statusCode !== 200) return cb(new Error('vMix answered with status ' + res.statusCode + '.'));
      if (/Browser script access not permitted/i.test(body)) {
        return cb(new Error('vMix refused the request as a browser script. Use the machine\'s network address rather than localhost.'));
      }
      cb(null, body);
    });
  });
  req.on('timeout', () => { req.destroy(new Error('timeout')); });
  req.on('error', (e) => {
    if (e.code === 'ECONNREFUSED') return cb(new Error('Nothing is listening on ' + host + ':' + port + '. In vMix: Settings > Web Controller, tick Enabled.'));
    if (e.code === 'EHOSTUNREACH' || e.code === 'ENETUNREACH') return cb(new Error('Could not reach ' + host + '. Check the address of the computer running vMix.'));
    if (e.code === 'ENOTFOUND') return cb(new Error('No computer found at "' + host + '".'));
    cb(new Error(host + ' did not answer. If vMix is on another computer, its firewall is the usual reason.'));
  });
}

// Small enough that a regex beats dragging in an XML parser — and dragging one in would be the
// first third-party dependency in this product.
function parseState(xml) {
  const one = (tag) => { const m = new RegExp('<' + tag + '>([\\s\\S]*?)</' + tag + '>').exec(xml); return m ? m[1].trim() : ''; };
  const inputs = [];
  const re = /<input\b([^>]*)>([\s\S]*?)<\/input>|<input\b([^>]*)\/>/g;
  let m;
  while ((m = re.exec(xml))) {
    const attrs = m[1] || m[3] || '';
    const a = {};
    let am; const ar = /(\w+)="([^"]*)"/g;
    while ((am = ar.exec(attrs))) a[am[1]] = am[2];
    if (!a.number) continue;
    inputs.push({
      number: parseInt(a.number, 10),
      title: (m[2] != null ? m[2].trim() : '') || a.title || ('Input ' + a.number),
      type: a.type || '',
      state: a.state || ''
    });
  }
  return {
    version: one('version'),
    edition: one('edition'),
    active: parseInt(one('active'), 10) || 0,
    preview: parseInt(one('preview'), 10) || 0,
    inputs: inputs
  };
}

function state(opts, cb) {
  api(opts, '', (err, xml) => {
    if (err) return cb(err);
    if (!/<vmix>/i.test(xml)) return cb(new Error('That address answered, but it does not look like vMix.'));
    cb(null, parseState(xml));
  });
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const JPG = Buffer.from([0xff, 0xd8, 0xff]);

/* Waits for vMix to actually finish writing. vMix reports success the moment it accepts the
 * command, so the file is not there yet — and a file that has appeared may still be half written,
 * hence waiting for the size to settle rather than pouncing on first sight. */
function waitForFile(file, done) {
  const started = Date.now();
  let lastSize = -1, stableFor = 0;
  (function poll() {
    fs.stat(file, (err, st) => {
      if (err || !st.size) {
        if (Date.now() - started > 6000) return done(new Error('timeout'));
        return setTimeout(poll, 120);
      }
      if (st.size === lastSize) {
        stableFor++;
        if (stableFor >= 2) return done(null, st.size);
      } else { stableFor = 0; lastSize = st.size; }
      if (Date.now() - started > 8000) return done(null, st.size);   // written, just slowly
      setTimeout(poll, 120);
    });
  })();
}

/* Ask vMix for a still and hand back the file it wrote.
 *   opts.dir     where to write (must be reachable from BOTH vMix and us — i.e. same computer)
 *   opts.input   a specific input number; omit for the program output
 */
function grab(opts, cb) {
  const dir = opts.dir;
  const stamp = Date.now() + '_' + Math.floor(process.hrtime()[1] / 1000);
  const base = 'vmix_' + stamp;
  let file = path.join(dir, base + '.png');

  const q = opts.input
    ? '?Function=SnapshotInput&Input=' + encodeURIComponent(opts.input) + '&Value=' + encodeURIComponent(file)
    : '?Function=Snapshot&Value=' + encodeURIComponent(file);

  api(opts, q, (err) => {
    if (err) return cb(err);
    waitForFile(file, (werr) => {
      if (werr) {
        return cb(new Error('vMix accepted the request but no picture appeared. vMix saves the still on its own computer — '
          + 'if StreamGraphics is running somewhere else, point both at a shared folder, or run them on the same machine.'));
      }
      // Trust the bytes, not the extension: whether vMix honours ".png" is its business, not ours.
      fs.open(file, 'r', (oe, fd) => {
        if (oe) return cb(new Error('The picture was written but could not be opened.'));
        const head = Buffer.alloc(4);
        fs.read(fd, head, 0, 4, 0, () => {
          fs.close(fd, () => {
            const isPng = head.slice(0, 4).equals(PNG);
            const isJpg = head.slice(0, 3).equals(JPG);
            if (!isPng && !isJpg) return cb(new Error('vMix wrote a file that is not a picture.'));
            if (isJpg) {
              const jpgFile = path.join(dir, base + '.jpg');
              return fs.rename(file, jpgFile, (re) => {
                if (re) return cb(null, { file: file, name: base + '.png' });   // wrong name, right bytes
                cb(null, { file: jpgFile, name: base + '.jpg' });
              });
            }
            cb(null, { file: file, name: base + '.png' });
          });
        });
      });
    });
  });
}

module.exports = { state: state, grab: grab, _parseState: parseState };
