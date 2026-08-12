global.window = {};
require(__dirname + '/../../public/sg-qr.js');
const SGQR = global.window.SGQR;
const payload = JSON.parse(process.argv[2]);
const out = payload.map(p => {
  const q = SGQR.build(p.text, p.level);
  if (!q) return { ok: false };
  return { ok: true, version: q.version, mask: q.mask, mode: q.mode, size: q.size,
           grid: q.grid.map(r => Array.from(r).join('')) };
});
console.log(JSON.stringify(out));
