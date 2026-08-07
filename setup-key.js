/*
 * StreamGraphics Pro — ONE-TIME signing-key setup (VENDOR ONLY).
 * Run this once, on the computer you'll make license keys from.
 *
 *   node setup-key.js
 *
 * It creates your SECRET signing key (.license-private-key.pem) and prints your
 * PUBLIC key. Send the PUBLIC key to your developer (it's safe to share); it gets
 * baked into the app so the app trusts the keys you sign. Your PRIVATE key never
 * leaves this computer — keep it safe and never share it or ship it with the app.
 */
'use strict';
const fs = require('fs');
const crypto = require('crypto');
const KEY = '.license-private-key.pem';

if (fs.existsSync(KEY)) {
  console.log('\nYou already have a signing key (' + KEY + ') — keeping it. (Delete it only if you want to start over; existing license keys would stop working.)');
} else {
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  fs.writeFileSync(KEY, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  console.log('\nCreated your secret signing key: ' + KEY);
  console.log('   -> Keep this file safe. Never share it, never put it in the app download.');
}

// Print the matching PUBLIC key (safe to share).
const priv = crypto.createPrivateKey(fs.readFileSync(KEY));
const pub = crypto.createPublicKey(priv).export({ type: 'spki', format: 'pem' });
console.log('\n================  YOUR PUBLIC KEY — send this to your developer  ================\n');
process.stdout.write(pub);
console.log('\n================================================================================\n');
console.log('Next: send the block above to your developer. Then use  node make-license.js  to make keys.\n');
