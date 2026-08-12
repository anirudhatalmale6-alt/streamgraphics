/* StreamGraphics — QR CODE layer: the whole encoder, in the app.
 *
 * Deliberately NOT a call to a QR web service. A graphics machine in a control room is often
 * on a locked-down network or no network at all, and a QR that fails to draw ten seconds before
 * you cut to it is worse than no QR at all. Everything below runs offline, in the browser, in
 * about a millisecond — and it is the same code in the builder and on both outputs, so what you
 * previewed is exactly what goes to air.
 *
 * Implements ISO/IEC 18004: numeric / alphanumeric / byte modes, versions 1-40, all four error
 * correction levels, Reed-Solomon over GF(256), all eight data masks scored by the standard's
 * four penalty rules.
 *
 * The two big tables (RS block structure, alignment-pattern centres) were generated from a
 * reference implementation rather than typed by hand, and the output is checked module-for-
 * module against one — see tools/qr-verify. A QR that is subtly wrong still LOOKS like a QR,
 * which is exactly why it gets verified rather than eyeballed.
 *
 * Shorter payload = fewer modules = bigger squares = scans from further back in the room. So
 * the mode is chosen automatically: digits pack tighter than upper-case, which packs tighter
 * than free text. Keep URLs short and upper-case if you want the biggest possible squares.
 */
(function () {
  'use strict';

  // version 1..40; each row is L|M|Q|H; each level is one or two groups of 'blocks,totalCodewords,dataCodewords'
  var RS = [
    '1,26,19|1,26,16|1,26,13|1,26,9',   // v1
    '1,44,34|1,44,28|1,44,22|1,44,16',   // v2
    '1,70,55|1,70,44|2,35,17|2,35,13',   // v3
    '1,100,80|2,50,32|2,50,24|4,25,9',   // v4
    '1,134,108|2,67,43|2,33,15;2,34,16|2,33,11;2,34,12',   // v5
    '2,86,68|4,43,27|4,43,19|4,43,15',   // v6
    '2,98,78|4,49,31|2,32,14;4,33,15|4,39,13;1,40,14',   // v7
    '2,121,97|2,60,38;2,61,39|4,40,18;2,41,19|4,40,14;2,41,15',   // v8
    '2,146,116|3,58,36;2,59,37|4,36,16;4,37,17|4,36,12;4,37,13',   // v9
    '2,86,68;2,87,69|4,69,43;1,70,44|6,43,19;2,44,20|6,43,15;2,44,16',   // v10
    '4,101,81|1,80,50;4,81,51|4,50,22;4,51,23|3,36,12;8,37,13',   // v11
    '2,116,92;2,117,93|6,58,36;2,59,37|4,46,20;6,47,21|7,42,14;4,43,15',   // v12
    '4,133,107|8,59,37;1,60,38|8,44,20;4,45,21|12,33,11;4,34,12',   // v13
    '3,145,115;1,146,116|4,64,40;5,65,41|11,36,16;5,37,17|11,36,12;5,37,13',   // v14
    '5,109,87;1,110,88|5,65,41;5,66,42|5,54,24;7,55,25|11,36,12;7,37,13',   // v15
    '5,122,98;1,123,99|7,73,45;3,74,46|15,43,19;2,44,20|3,45,15;13,46,16',   // v16
    '1,135,107;5,136,108|10,74,46;1,75,47|1,50,22;15,51,23|2,42,14;17,43,15',   // v17
    '5,150,120;1,151,121|9,69,43;4,70,44|17,50,22;1,51,23|2,42,14;19,43,15',   // v18
    '3,141,113;4,142,114|3,70,44;11,71,45|17,47,21;4,48,22|9,39,13;16,40,14',   // v19
    '3,135,107;5,136,108|3,67,41;13,68,42|15,54,24;5,55,25|15,43,15;10,44,16',   // v20
    '4,144,116;4,145,117|17,68,42|17,50,22;6,51,23|19,46,16;6,47,17',   // v21
    '2,139,111;7,140,112|17,74,46|7,54,24;16,55,25|34,37,13',   // v22
    '4,151,121;5,152,122|4,75,47;14,76,48|11,54,24;14,55,25|16,45,15;14,46,16',   // v23
    '6,147,117;4,148,118|6,73,45;14,74,46|11,54,24;16,55,25|30,46,16;2,47,17',   // v24
    '8,132,106;4,133,107|8,75,47;13,76,48|7,54,24;22,55,25|22,45,15;13,46,16',   // v25
    '10,142,114;2,143,115|19,74,46;4,75,47|28,50,22;6,51,23|33,46,16;4,47,17',   // v26
    '8,152,122;4,153,123|22,73,45;3,74,46|8,53,23;26,54,24|12,45,15;28,46,16',   // v27
    '3,147,117;10,148,118|3,73,45;23,74,46|4,54,24;31,55,25|11,45,15;31,46,16',   // v28
    '7,146,116;7,147,117|21,73,45;7,74,46|1,53,23;37,54,24|19,45,15;26,46,16',   // v29
    '5,145,115;10,146,116|19,75,47;10,76,48|15,54,24;25,55,25|23,45,15;25,46,16',   // v30
    '13,145,115;3,146,116|2,74,46;29,75,47|42,54,24;1,55,25|23,45,15;28,46,16',   // v31
    '17,145,115|10,74,46;23,75,47|10,54,24;35,55,25|19,45,15;35,46,16',   // v32
    '17,145,115;1,146,116|14,74,46;21,75,47|29,54,24;19,55,25|11,45,15;46,46,16',   // v33
    '13,145,115;6,146,116|14,74,46;23,75,47|44,54,24;7,55,25|59,46,16;1,47,17',   // v34
    '12,151,121;7,152,122|12,75,47;26,76,48|39,54,24;14,55,25|22,45,15;41,46,16',   // v35
    '6,151,121;14,152,122|6,75,47;34,76,48|46,54,24;10,55,25|2,45,15;64,46,16',   // v36
    '17,152,122;4,153,123|29,74,46;14,75,47|49,54,24;10,55,25|24,45,15;46,46,16',   // v37
    '4,152,122;18,153,123|13,74,46;32,75,47|48,54,24;14,55,25|42,45,15;32,46,16',   // v38
    '20,147,117;4,148,118|40,75,47;7,76,48|43,54,24;22,55,25|10,45,15;67,46,16',   // v39
    '19,148,118;6,149,119|18,75,47;31,76,48|34,54,24;34,55,25|20,45,15;61,46,16'   // v40
  ];

  // alignment-pattern centre coordinates, version 1..40 (version 1 has none)
  var ALIGN = [
    [],   // v1
    [6,18],   // v2
    [6,22],   // v3
    [6,26],   // v4
    [6,30],   // v5
    [6,34],   // v6
    [6,22,38],   // v7
    [6,24,42],   // v8
    [6,26,46],   // v9
    [6,28,50],   // v10
    [6,30,54],   // v11
    [6,32,58],   // v12
    [6,34,62],   // v13
    [6,26,46,66],   // v14
    [6,26,48,70],   // v15
    [6,26,50,74],   // v16
    [6,30,54,78],   // v17
    [6,30,56,82],   // v18
    [6,30,58,86],   // v19
    [6,34,62,90],   // v20
    [6,28,50,72,94],   // v21
    [6,26,50,74,98],   // v22
    [6,30,54,78,102],   // v23
    [6,28,54,80,106],   // v24
    [6,32,58,84,110],   // v25
    [6,30,58,86,114],   // v26
    [6,34,62,90,118],   // v27
    [6,26,50,74,98,122],   // v28
    [6,30,54,78,102,126],   // v29
    [6,26,52,78,104,130],   // v30
    [6,30,56,82,108,134],   // v31
    [6,34,60,86,112,138],   // v32
    [6,30,58,86,114,142],   // v33
    [6,34,62,90,118,146],   // v34
    [6,30,54,78,102,126,150],   // v35
    [6,24,50,76,102,128,154],   // v36
    [6,28,54,80,106,132,158],   // v37
    [6,32,58,84,110,136,162],   // v38
    [6,26,54,82,110,138,166],   // v39
    [6,30,58,86,114,142,170]   // v40
  ];

  /* ---- GF(256) arithmetic, the field QR's Reed-Solomon lives in (primitive polynomial 0x11d) ---- */
  var EXP = new Uint8Array(512), LOG = new Uint8Array(256);
  (function () {
    for (var i = 0, x = 1; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
    for (var j = 255; j < 512; j++) EXP[j] = EXP[j - 255];
  })();
  function gmul(a, b) { return (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]]; }

  // Generator polynomial for n error-correction codewords.
  function rsPoly(n) {
    var p = [1];
    for (var i = 0; i < n; i++) {
      var q = p.concat([0]);
      for (var j = 0; j < p.length; j++) q[j + 1] ^= gmul(p[j], EXP[i]);
      p = q;
    }
    return p;
  }
  // The n ECC codewords for one block of data.
  function ecc(data, n) {
    var gen = rsPoly(n), rem = new Array(n);
    for (var i = 0; i < n; i++) rem[i] = 0;
    for (var d = 0; d < data.length; d++) {
      var factor = data[d] ^ rem[0];
      rem.shift(); rem.push(0);
      for (var k = 0; k < n; k++) rem[k] ^= gmul(gen[k + 1], factor);
    }
    return rem;
  }

  /* ---- what kind of data is this? cheapest mode wins ---- */
  var ALNUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
  function utf8(s) {
    var out = [];
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {           // surrogate pair
        var cp = 0x10000 + ((c - 0xd800) << 10) + (s.charCodeAt(++i) - 0xdc00);
        out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
      } else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return out;
  }
  function pickMode(s) {
    if (/^[0-9]*$/.test(s)) return 'numeric';
    for (var i = 0; i < s.length; i++) if (ALNUM.indexOf(s[i]) < 0) return 'byte';
    return 'alnum';
  }

  /* ---- bit stream ---- */
  function Bits() { this.buf = []; this.len = 0; }
  Bits.prototype.put = function (val, n) {
    for (var i = n - 1; i >= 0; i--) {
      var bit = (val >>> i) & 1;
      var byteI = this.len >> 3;
      if (this.buf.length <= byteI) this.buf.push(0);
      if (bit) this.buf[byteI] |= 0x80 >>> (this.len & 7);
      this.len++;
    }
  };

  var MODE_BITS = { numeric: 1, alnum: 2, byte: 4 };
  function countBits(mode, ver) {
    if (ver < 10) return mode === 'numeric' ? 10 : mode === 'alnum' ? 9 : 8;
    if (ver < 27) return mode === 'numeric' ? 12 : mode === 'alnum' ? 11 : 16;
    return mode === 'numeric' ? 14 : mode === 'alnum' ? 13 : 16;
  }
  // Blocks for a version+level: [{total, data}, ...]
  function blocksFor(ver, level) {
    var lv = 'LMQH'.indexOf(level); if (lv < 0) lv = 1;
    var out = [];
    RS[ver - 1].split('|')[lv].split(';').forEach(function (g) {
      var p = g.split(',');
      for (var i = 0; i < +p[0]; i++) out.push({ total: +p[1], data: +p[2] });
    });
    return out;
  }
  function dataCapacityBits(ver, level) {
    var n = 0; blocksFor(ver, level).forEach(function (b) { n += b.data; });
    return n * 8;
  }

  function encodeData(text, mode, ver, level) {
    var b = new Bits();
    b.put(MODE_BITS[mode], 4);
    if (mode === 'numeric') {
      b.put(text.length, countBits(mode, ver));
      for (var i = 0; i < text.length; i += 3) {
        var chunk = text.substr(i, 3);
        b.put(parseInt(chunk, 10), chunk.length === 3 ? 10 : chunk.length === 2 ? 7 : 4);
      }
    } else if (mode === 'alnum') {
      b.put(text.length, countBits(mode, ver));
      for (var j = 0; j < text.length; j += 2) {
        if (j + 1 < text.length) b.put(ALNUM.indexOf(text[j]) * 45 + ALNUM.indexOf(text[j + 1]), 11);
        else b.put(ALNUM.indexOf(text[j]), 6);
      }
    } else {
      var bytes = utf8(text);
      b.put(bytes.length, countBits(mode, ver));
      for (var k = 0; k < bytes.length; k++) b.put(bytes[k], 8);
    }
    var cap = dataCapacityBits(ver, level);
    // Terminator, then pad to a whole byte, then the standard alternating pad bytes.
    b.put(0, Math.min(4, cap - b.len));
    while (b.len % 8) b.put(0, 1);
    var padA = 0xEC, padB = 0x11, alt = true;
    while (b.len < cap) { b.put(alt ? padA : padB, 8); alt = !alt; }
    return b.buf;
  }

  // Smallest version that fits, at the requested level.
  function pickVersion(text, mode, level, minVer) {
    for (var v = Math.max(1, minVer || 1); v <= 40; v++) {
      var need = 4 + countBits(mode, v);
      if (mode === 'numeric') need += 10 * Math.floor(text.length / 3) + [0, 4, 7][text.length % 3];
      else if (mode === 'alnum') need += 11 * Math.floor(text.length / 2) + 6 * (text.length % 2);
      else need += 8 * utf8(text).length;
      if (need <= dataCapacityBits(v, level)) return v;
    }
    return 0;   // too much data even for version 40
  }

  // Split into blocks, add ECC, then interleave exactly as the standard requires.
  function finalCodewords(dataBytes, ver, level) {
    var blocks = blocksFor(ver, level), pos = 0, dat = [], ecs = [];
    blocks.forEach(function (b) {
      var chunk = dataBytes.slice(pos, pos + b.data); pos += b.data;
      dat.push(chunk); ecs.push(ecc(chunk, b.total - b.data));
    });
    var out = [], i, j;
    var maxData = Math.max.apply(null, dat.map(function (d) { return d.length; }));
    for (i = 0; i < maxData; i++) for (j = 0; j < dat.length; j++) if (i < dat[j].length) out.push(dat[j][i]);
    var maxEc = Math.max.apply(null, ecs.map(function (e) { return e.length; }));
    for (i = 0; i < maxEc; i++) for (j = 0; j < ecs.length; j++) if (i < ecs[j].length) out.push(ecs[j][i]);
    return out;
  }

  /* ---- the module grid ---- */
  function newGrid(size) {
    var g = [];
    for (var y = 0; y < size; y++) { g.push(new Int8Array(size)); g[y].fill(-1); }   // -1 = not yet set
    return g;
  }
  function placeFinder(g, x, y) {
    for (var dy = -1; dy <= 7; dy++) for (var dx = -1; dx <= 7; dx++) {
      var px = x + dx, py = y + dy;
      if (px < 0 || py < 0 || px >= g.length || py >= g.length) continue;
      var on = (dx >= 0 && dx <= 6 && (dy === 0 || dy === 6)) ||
               (dy >= 0 && dy <= 6 && (dx === 0 || dx === 6)) ||
               (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4);
      g[py][px] = on ? 1 : 0;
    }
  }
  function placeAlignment(g, ver) {
    var pos = ALIGN[ver - 1], size = g.length;
    for (var a = 0; a < pos.length; a++) for (var b = 0; b < pos.length; b++) {
      var cx = pos[a], cy = pos[b];
      if (g[cy][cx] !== -1) continue;                      // skips the three finder corners
      for (var dy = -2; dy <= 2; dy++) for (var dx = -2; dx <= 2; dx++) {
        var on = Math.max(Math.abs(dx), Math.abs(dy)) !== 1;
        g[cy + dy][cx + dx] = on ? 1 : 0;
      }
    }
  }
  function placeTiming(g) {
    for (var i = 8; i < g.length - 8; i++) {
      if (g[6][i] === -1) g[6][i] = (i % 2 === 0) ? 1 : 0;
      if (g[i][6] === -1) g[i][6] = (i % 2 === 0) ? 1 : 0;
    }
  }
  // Reserve the format/version areas so data placement skips them.
  function reserve(g, ver) {
    var size = g.length, i;
    for (i = 0; i <= 8; i++) { if (g[8][i] === -1) g[8][i] = 0; if (g[i][8] === -1) g[i][8] = 0; }
    for (i = 0; i < 8; i++) { if (g[8][size - 1 - i] === -1) g[8][size - 1 - i] = 0; if (g[size - 1 - i][8] === -1) g[size - 1 - i][8] = 0; }
    g[size - 8][8] = 1;                                    // the always-dark module
    if (ver >= 7) for (i = 0; i < 6; i++) for (var j = 0; j < 3; j++) { g[i][size - 11 + j] = 0; g[size - 11 + j][i] = 0; }
  }
  // Zigzag up-and-down in two-module-wide columns, skipping the vertical timing line.
  function placeData(g, cw) {
    var size = g.length, bit = 0, dir = -1, row = size - 1;
    for (var col = size - 1; col > 0; col -= 2) {
      if (col === 6) col--;                                // column 6 is the timing pattern
      for (;;) {
        for (var c = 0; c < 2; c++) {
          var x = col - c;
          if (g[row][x] === -1) {
            var v = 0;
            if (bit < cw.length * 8) v = (cw[bit >> 3] >>> (7 - (bit & 7))) & 1;
            g[row][x] = v; bit++;
          }
        }
        row += dir;
        if (row < 0 || row >= size) { row -= dir; dir = -dir; break; }
      }
    }
  }

  var MASKS = [
    function (x, y) { return (x + y) % 2 === 0; },
    function (x, y) { return y % 2 === 0; },
    function (x, y) { return x % 3 === 0; },
    function (x, y) { return (x + y) % 3 === 0; },
    function (x, y) { return (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0; },
    function (x, y) { return ((x * y) % 2) + ((x * y) % 3) === 0; },
    function (x, y) { return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; },
    function (x, y) { return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0; }
  ];
  // Format information: 5 bits of level+mask, BCH(15,5), XORed with the fixed 0x5412 mask.
  var LEVEL_BITS = { L: 1, M: 0, Q: 3, H: 2 };
  function formatBits(level, mask) {
    var v = (LEVEL_BITS[level] << 3) | mask, d = v << 10;
    for (var i = 4; i >= 0; i--) if (d & (1 << (i + 10))) d ^= 0x537 << i;
    return ((v << 10) | d) ^ 0x5412;
  }
  function versionBits(ver) {
    var d = ver << 12;
    for (var i = 5; i >= 0; i--) if (d & (1 << (i + 12))) d ^= 0x1f25 << i;
    return (ver << 12) | d;
  }
  /* The 15 format bits are written twice, and the two copies run in OPPOSITE bit orders — the
   * one place in the spec where an off-by-one reads as a perfectly plausible QR code that no
   * scanner will accept, because the data modules are all still correct. Bit 14 is the MSB. */
  function applyFormat(g, level, mask) {
    var size = g.length, f = formatBits(level, mask), i;
    var bit = function (n) { return (f >> n) & 1; };
    // copy 1 — along the top-left finder
    for (i = 0; i <= 5; i++) g[8][i] = bit(14 - i);
    g[8][7] = bit(8); g[8][8] = bit(7); g[7][8] = bit(6);
    for (i = 0; i <= 5; i++) g[i][8] = bit(i);
    // copy 2 — bottom-left going up, and top-right going left
    for (i = 0; i <= 7; i++) g[8][size - 1 - i] = bit(i);
    for (i = 0; i <= 6; i++) g[size - 1 - i][8] = bit(14 - i);
    g[size - 8][8] = 1;                                   // the always-dark module
  }
  function applyVersion(g, ver) {
    if (ver < 7) return;
    var size = g.length, v = versionBits(ver);
    for (var i = 0; i < 18; i++) {
      var bit = (v >> i) & 1, a = Math.floor(i / 3), b = i % 3;
      g[a][size - 11 + b] = bit; g[size - 11 + b][a] = bit;
    }
  }

  /* ---- mask penalty, the standard's four rules ---- */
  function penalty(g) {
    var size = g.length, score = 0, x, y, i, run, last, dark = 0;
    for (y = 0; y < size; y++) {                                   // rule 1: runs of five or more
      run = 1; last = -1;
      for (x = 0; x < size; x++) {
        if (g[y][x] === last) { run++; if (run === 5) score += 3; else if (run > 5) score++; }
        else { run = 1; last = g[y][x]; }
      }
    }
    for (x = 0; x < size; x++) {
      run = 1; last = -1;
      for (y = 0; y < size; y++) {
        if (g[y][x] === last) { run++; if (run === 5) score += 3; else if (run > 5) score++; }
        else { run = 1; last = g[y][x]; }
      }
    }
    for (y = 0; y < size - 1; y++) for (x = 0; x < size - 1; x++) {  // rule 2: 2x2 blocks
      var v = g[y][x];
      if (v === g[y][x + 1] && v === g[y + 1][x] && v === g[y + 1][x + 1]) score += 3;
    }
    var P1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0], P2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
    function match(get, n, pat) {
      for (i = 0; i < pat.length; i++) if (get(n + i) !== pat[i]) return false;
      return true;
    }
    for (y = 0; y < size; y++) for (x = 0; x <= size - 11; x++) {    // rule 3: finder-like patterns
      var rowGet = function (k) { return g[y][k]; };
      if (match(rowGet, x, P1) || match(rowGet, x, P2)) score += 40;
    }
    for (x = 0; x < size; x++) for (y = 0; y <= size - 11; y++) {
      var colGet = function (k) { return g[k][x]; };
      if (match(colGet, y, P1) || match(colGet, y, P2)) score += 40;
    }
    for (y = 0; y < size; y++) for (x = 0; x < size; x++) if (g[y][x]) dark++;   // rule 4: dark/light balance
    score += Math.floor(Math.abs(dark * 100 / (size * size) - 50) / 5) * 10;
    return score;
  }

  /* ---- put it all together: text in, module grid out ---- */
  function build(text, level, minVer) {
    text = String(text == null ? '' : text);
    level = ('LMQH'.indexOf(level) >= 0) ? level : 'M';
    var mode = pickMode(text);
    var ver = pickVersion(text, mode, level, minVer);
    if (!ver) return null;                                  // more data than a QR code can hold
    var cw = finalCodewords(encodeData(text, mode, ver, level), ver, level);
    var size = ver * 4 + 17;

    var base = newGrid(size);
    placeFinder(base, 0, 0); placeFinder(base, size - 7, 0); placeFinder(base, 0, size - 7);
    placeAlignment(base, ver); placeTiming(base); reserve(base, ver);
    // Remember which modules are function patterns BEFORE the data goes in - the mask must not
    // touch them, and the format bits get written over the reserved areas afterwards.
    var fixed = base.map(function (r) { return r.map(function (v) { return v === -1 ? 0 : 1; }); });
    placeData(base, cw);

    var best = null;
    for (var m = 0; m < 8; m++) {
      var g = base.map(function (r) { return Int8Array.from(r); });
      for (var y = 0; y < size; y++) for (var x = 0; x < size; x++) if (!fixed[y][x] && MASKS[m](x, y)) g[y][x] ^= 1;
      applyFormat(g, level, m); applyVersion(g, ver);
      var p = penalty(g);
      if (!best || p < best.p) best = { p: p, g: g, m: m };
    }
    return { size: size, version: ver, mask: best.m, level: level, mode: mode, grid: best.g };
  }

  /* ---- draw it ----
   * SVG, not canvas: it stays razor sharp at any size (a QR scaled up from a bitmap picks up
   * soft edges, and a soft-edged QR is a QR that takes three tries to scan), it costs nothing
   * to redraw, and it drops straight into the same markup as every other layer.
   * The quiet zone is not decoration - the spec requires 4 modules of clear space, and scanners
   * really do fail without it. It is included by default and can only be made larger. */
  function svg(text, opts) {
    opts = opts || {};
    var q = build(text, opts.level || 'M', opts.minVersion || 1);
    if (!q) return null;
    var quiet = Math.max(4, opts.quiet == null ? 4 : +opts.quiet);
    var total = q.size + quiet * 2;
    var dark = opts.dark || '#000000', light = opts.light || '#ffffff';
    var d = '';
    for (var y = 0; y < q.size; y++) {
      var x = 0;
      while (x < q.size) {
        if (!q.grid[y][x]) { x++; continue; }
        var run = 1;
        while (x + run < q.size && q.grid[y][x + run]) run++;      // one path segment per run, not per module
        d += 'M' + (x + quiet) + ' ' + (y + quiet) + 'h' + run + 'v1h-' + run + 'z';
        x += run;
      }
    }
    var bg = (light === 'none' || opts.transparent) ? '' : '<rect width="' + total + '" height="' + total + '" fill="' + light + '"/>';
    return { svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + total + ' ' + total + '" shape-rendering="crispEdges" preserveAspectRatio="xMidYMid meet" style="width:100%;height:100%;display:block">'
      + bg + '<path d="' + d + '" fill="' + dark + '"/></svg>', version: q.version, size: q.size, mode: q.mode, level: q.level, mask: q.mask };
  }

  /* The QR as a LAYER, the same on the builder canvas and on both outputs.
   * Empty payload: the builder shows a hint, the outputs show nothing at all. A half-drawn
   * placeholder is the last thing you want appearing on air because a spreadsheet cell was blank. */
  function layerHtml(l, isBuilder) {
    var text = String(l.text == null ? '' : l.text).trim();
    if (!text) {
      if (!isBuilder) return '';
      return '<div class="li" style="width:100%;height:100%;border:2px dashed #6b7a90;border-radius:10px;display:flex;align-items:center;justify-content:center;text-align:center;color:#9fb0c8;font-size:18px;padding:8px">QR — type a link<br>in the panel</div>';
    }
    var r = svg(text, { level: l.level || 'M', dark: l.dark || '#000000', light: l.light || '#ffffff',
                        transparent: !!l.transparent, quiet: l.quiet });
    if (!r) {
      if (!isBuilder) return '';
      return '<div class="li" style="width:100%;height:100%;border:2px dashed #b4553d;border-radius:10px;display:flex;align-items:center;justify-content:center;text-align:center;color:#e08a72;font-size:16px;padding:8px">Too much text for one QR code — shorten it, or use a link.</div>';
    }
    // drop-shadow, not box-shadow: the code is square inside a layer that may not be, and on a
    // transparent QR the shadow has to follow the modules rather than trace the layer's box.
    var sh = l.shadow ? 'filter:drop-shadow(0 ' + (l.shadowY == null ? 4 : +l.shadowY) + 'px ' + (l.shadowBlur == null ? 14 : +l.shadowBlur) + 'px rgba(0,0,0,' + ((l.shadowOpacity == null ? 55 : +l.shadowOpacity) / 100) + '));' : '';
    return '<div class="li ly-qr" data-qr-v="' + r.version + '" style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;' + sh + '">' + r.svg + '</div>';
  }

  window.SGQR = { build: build, svg: svg, layerHtml: layerHtml };
})();
