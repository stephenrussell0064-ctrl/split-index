#!/usr/bin/env node
/**
 * Tests for the Apple client-secret generator.
 *
 * Signed with a throwaway EC key generated here, so no real Apple key is
 * involved and none is needed to run these.
 *
 * The one that earns its place is the signature encoding. Node signs ECDSA in
 * DER by default, which produces a *valid signature of the right thing in the
 * wrong format* — it verifies fine with Node's own verifier and Apple rejects
 * it, with an error that says nothing about encoding. It is the kind of bug you
 * only find at the point where you cannot debug it.
 */

import { generateKeyPairSync, createVerify } from 'node:crypto';
import { appleClientSecret } from './apple-client-secret.mjs';

const { privateKey, publicKey } = generateKeyPairSync('ec', {
  namedCurve: 'P-256',
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const NOW = new Date('2026-09-08T12:00:00Z');
const make = (over = {}) =>
  appleClientSecret({
    privateKeyPem: privateKey,
    keyId: 'ABC123XYZ',
    teamId: '1A2B3C4D5E',
    servicesId: 'com.splitindex.signin',
    now: NOW,
    ...over,
  });

let failures = 0;
function check(description, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  process.stdout.write(
    `  ${ok ? 'ok  ' : 'FAIL'} ${description}\n` +
      (ok ? '' : `       expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}\n`),
  );
}

const decode = (part) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
const { token, expiresAt } = make();
const [h, c, s] = token.split('.');
const header = decode(h);
const claims = decode(c);

check('header names ES256 and the key id', [header.alg, header.kid], ['ES256', 'ABC123XYZ']);
check('issuer is the team id', claims.iss, '1A2B3C4D5E');
check('subject is the Services ID, not a bundle id', claims.sub, 'com.splitindex.signin');
check('audience is Apple', claims.aud, 'https://appleid.apple.com');

// Apple refuses a lifetime over six months outright.
const sixMonths = 15_777_000;
check('expiry is inside Apple’s six-month cap', claims.exp - claims.iat <= sixMonths, true);
check('and is not needlessly short', claims.exp - claims.iat > sixMonths - 7200, true);
check('the reported expiry matches the claim', expiresAt.getTime(), claims.exp * 1000);

/*
 * The encoding test. A raw P-256 signature is exactly 64 bytes — r and s, 32
 * each. DER is variable-length and starts with 0x30. Checking the length is
 * what catches the default-encoding mistake; verifying the signature does not,
 * because the DER one verifies perfectly well and Apple still says no.
 */
const sig = Buffer.from(s, 'base64url');
check('signature is raw r‖s, 64 bytes', sig.length, 64);
check('signature is not DER', sig[0] === 0x30 && sig.length !== 64, false);

check(
  'the signature actually verifies against the public key',
  createVerify('SHA256')
    .update(`${h}.${c}`)
    .verify({ key: publicKey, dsaEncoding: 'ieee-p1363' }, sig),
  true,
);

for (const missing of ['privateKeyPem', 'keyId', 'teamId', 'servicesId']) {
  let threw = false;
  try {
    make({ [missing]: undefined });
  } catch {
    threw = true;
  }
  check(`refuses to sign without ${missing}`, threw, true);
}

process.stdout.write(`\n  ${failures ? `${failures} failed` : 'all passed'}\n\n`);
process.exit(failures ? 1 : 0);
