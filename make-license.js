/*
 * StreamGraphics Pro — license key generator (VENDOR ONLY).
 * Signs a license with your private key so the app can verify it offline.
 * Keep .license-private-key.pem secret and NEVER ship it with the app.
 *
 * EASIEST: just run it with no arguments and answer the questions:
 *   node make-license.js
 *
 * Or all at once:
 *   node make-license.js "Customer Name" [tier] [features] [expiryYYYY-MM-DD] [upto=N | all]
 * Examples:
 *   node make-license.js "Hermosa Beach Club"                     (good for THIS version — the safe default)
 *   node make-license.js "Acme Sports" pro remote 2026-12-31      (add-on + expiry, this version)
 *   node make-license.js "Big Church" pro "" all                  (ALL versions, forever — a premium "lifetime" key)
 *
 * VERSION LIMIT: by default a key unlocks only the CURRENT major version, so you can never
 * accidentally give away every future upgrade. Add the word "all" (or upto=N) to change that.
 */
'use strict';
const fs = require('fs');
const crypto = require('crypto');

let pkgMajor = 0;
try { pkgMajor = parseInt(String(require('./package.json').version).split('.')[0], 10) || 0; } catch (e) {}

function sign(name, tier, features, exp, upto) {
  let priv;
  try { priv = fs.readFileSync('.license-private-key.pem', 'utf8'); }
  catch (e) {
    console.error('\nMissing .license-private-key.pem (your secret signing key).');
    console.error('Run  node setup-key.js  first to create it.\n');
    process.exit(1);
  }
  const claims = { name, tier, features, exp };
  if (upto != null) claims.upto = upto;            // omit entirely for an all-versions (lifetime) key
  const payload = Buffer.from(JSON.stringify(claims), 'utf8');
  const sig = crypto.sign(null, payload, priv);
  const key = payload.toString('base64url') + '.' + sig.toString('base64url');

  console.log('\nLicense for: ' + name + '  |  tier: ' + tier + '  |  features: [' + features.join(', ') + ']'
    + (exp ? '  |  expires: ' + new Date(exp).toISOString().slice(0, 10) : '  |  no expiry')
    + (upto != null ? '  |  unlocks up to v' + upto + '.x' : '  |  ALL versions (lifetime)'));
  console.log('\n' + key + '\n');
  console.log('Copy the line above and email it to the customer. They paste it into the app\'s License card.\n');
}

// Decide the version limit from args/answers: default = current major; "all"/"lifetime" = no limit.
function resolveUpto(tokens) {
  for (const t of tokens) {
    const s = String(t).trim().toLowerCase();
    if (s === 'all' || s === 'lifetime' || s === 'upto=all' || s === '--all-versions') return null;
    const m = /^upto=(\d+)$/.exec(s);
    if (m) return parseInt(m[1], 10);
  }
  return pkgMajor;   // safe default
}

const argv = process.argv.slice(2);

if (argv.length === 0) {
  // Friendly interactive mode — no quotes or argument order to remember.
  const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise(res => rl.question(q, a => res(a.trim())));
  (async () => {
    const name = (await ask('Customer name: ')) || 'Unnamed';
    const addons = await ask('Add-ons (comma-separated, or blank): ');
    const expIn = await ask('Expiry date YYYY-MM-DD (or blank for none): ');
    const allAns = (await ask('Good for ALL future versions? (y/N): ')).toLowerCase();
    rl.close();
    const features = addons.split(',').map(s => s.trim()).filter(Boolean);
    const exp = expIn ? Date.parse(expIn + 'T23:59:59') : 0;
    const upto = (allAns === 'y' || allAns === 'yes') ? null : pkgMajor;
    sign(name, 'pro', features, exp, upto);
  })();
} else {
  // Positional mode
  const upto = resolveUpto(argv);
  const positional = argv.filter(a => !/^(upto=|all$|lifetime$|--all-versions$)/i.test(a));
  const name = positional[0] || 'Unnamed';
  const tier = positional[1] || 'pro';
  const features = (positional[2] || '').split(',').map(s => s.trim()).filter(Boolean);
  const exp = positional[3] ? Date.parse(positional[3] + 'T23:59:59') : 0;
  sign(name, tier, features, exp, upto);
}
