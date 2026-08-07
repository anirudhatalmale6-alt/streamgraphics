/*
 * StreamGraphics Pro — license key generator (VENDOR ONLY).
 * Signs a license with your private key so the app can verify it offline.
 * Keep .license-private-key.pem secret and NEVER ship it with the app.
 *
 * Usage:
 *   node make-license.js "Customer Name" <tier> <features> [expiryYYYY-MM-DD] [upto=N]
 * Examples:
 *   node make-license.js "Hermosa Beach Club" pro ""                       (lifetime, all versions, no add-ons)
 *   node make-license.js "Acme Sports" pro remote,extra_courts 2026-12-31  (add-ons + expiry date)
 *   node make-license.js "Beach Club" pro "" upto=1                        (unlocks v1.x only; v2 needs a paid upgrade)
 *
 * upto=N caps the MAJOR version the key unlocks. Leave it OFF for a lifetime/all-versions key.
 * You can start selling lifetime keys today and add upto=N to NEW keys later — existing keys stay lifetime.
 */
'use strict';
const fs = require('fs');
const crypto = require('crypto');

// pull an optional "upto=N" from anywhere in the args; the rest stay positional
const argv = process.argv.slice(2);
let upto = null;
for (let i = argv.length - 1; i >= 0; i--) {
  const m = /^upto=(\d+)$/.exec(argv[i]);
  if (m) { upto = parseInt(m[1], 10); argv.splice(i, 1); }
}

const name = argv[0] || 'Unnamed';
const tier = argv[1] || 'pro';
const features = (argv[2] || '').split(',').map(s => s.trim()).filter(Boolean);
const expArg = argv[3] || '';
const exp = expArg ? Date.parse(expArg + 'T23:59:59') : 0;

let priv;
try { priv = fs.readFileSync('.license-private-key.pem', 'utf8'); }
catch (e) { console.error('Missing .license-private-key.pem (your secret signing key).'); process.exit(1); }

const claims = { name, tier, features, exp };
if (upto != null) claims.upto = upto;   // omit entirely for lifetime keys
const payload = Buffer.from(JSON.stringify(claims), 'utf8');
const sig = crypto.sign(null, payload, priv);
const key = payload.toString('base64url') + '.' + sig.toString('base64url');

console.log('\nLicense for: ' + name + '  |  tier: ' + tier + '  |  features: [' + features.join(', ') + ']'
  + (exp ? '  |  expires: ' + expArg : '  |  no expiry')
  + (upto != null ? '  |  unlocks up to v' + upto + '.x' : '  |  all versions (lifetime)'));
console.log('\n' + key + '\n');
