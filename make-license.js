/*
 * StreamGraphics Pro — license key generator (VENDOR ONLY).
 * Signs a license with your private key so the app can verify it offline.
 * Keep .license-private-key.pem secret and NEVER ship it with the app.
 *
 * Usage:
 *   node make-license.js "Customer Name" <tier> <features> [expiryYYYY-MM-DD]
 * Examples:
 *   node make-license.js "Hermosa Beach Club" pro ""                       (never expires, no add-ons)
 *   node make-license.js "Acme Sports" pro remote,extra_courts 2026-12-31  (with add-ons + expiry)
 */
'use strict';
const fs = require('fs');
const crypto = require('crypto');

const name = process.argv[2] || 'Unnamed';
const tier = process.argv[3] || 'pro';
const features = (process.argv[4] || '').split(',').map(s => s.trim()).filter(Boolean);
const expArg = process.argv[5] || '';
const exp = expArg ? Date.parse(expArg + 'T23:59:59') : 0;

let priv;
try { priv = fs.readFileSync('.license-private-key.pem', 'utf8'); }
catch (e) { console.error('Missing .license-private-key.pem (your secret signing key).'); process.exit(1); }

const payload = Buffer.from(JSON.stringify({ name, tier, features, exp }), 'utf8');
const sig = crypto.sign(null, payload, priv);
const key = payload.toString('base64url') + '.' + sig.toString('base64url');

console.log('\nLicense for: ' + name + '  |  tier: ' + tier + '  |  features: [' + features.join(', ') + ']' + (exp ? '  |  expires: ' + expArg : '  |  no expiry'));
console.log('\n' + key + '\n');
