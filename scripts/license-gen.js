#!/usr/bin/env node
/**
 * License key generator (VENDOR-ONLY — keep private; do NOT bundle into the app).
 *
 * Signs a license payload with the Ed25519 PRIVATE key in scripts/license-keys/.
 * The app verifies it offline with the embedded public key (license-verifier.ts).
 *
 * Usage:
 *   node scripts/license-gen.js --name "Cong ty ABC"                # floating/shared, perpetual
 *   node scripts/license-gen.js --name "ABC" --days 365             # expires in 365 days
 *   node scripts/license-gen.js --name "ABC" --machine <machineId>  # locked to one machine
 *
 * Output: the license key string to give to the customer.
 */
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const PRIV_PATH = path.join(__dirname, 'license-keys', 'ed25519-private.pem');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--name') out.name = argv[++i];
    else if (a === '--days') out.days = parseInt(argv[++i], 10);
    else if (a === '--machine') out.machine = argv[++i];
  }
  return out;
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function main() {
  if (!fs.existsSync(PRIV_PATH)) {
    console.error(`Private key not found at ${PRIV_PATH}. Generate the keypair first.`);
    process.exit(1);
  }
  const args = parseArgs(process.argv.slice(2));
  if (!args.name) {
    console.error('Missing --name "<customer>"');
    process.exit(1);
  }

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    v: 1,
    sub: args.name,
    iat: now,
    exp: args.days ? now + args.days * 86400 : null,
    mid: args.machine || null,
  };

  const payloadB64 = b64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  const privateKey = crypto.createPrivateKey(fs.readFileSync(PRIV_PATH, 'utf8'));
  const signature = crypto.sign(null, Buffer.from(payloadB64), privateKey);
  const key = `${payloadB64}.${b64url(signature)}`;

  console.log('\n=== LICENSE PAYLOAD ===');
  console.log(JSON.stringify(payload, null, 2));
  console.log('\n=== LICENSE KEY (give this to the customer) ===');
  console.log(key);
  console.log('');
}

main();
