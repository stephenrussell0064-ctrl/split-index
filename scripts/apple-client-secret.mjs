#!/usr/bin/env node
/**
 * Generate the Apple client secret that Supabase asks for.
 *
 * Supabase's Apple provider has a field labelled "Secret Key". It is not a key
 * and it is not a password: it is a **JWT you generate**, signed with the .p8
 * private key Apple gave you, asserting that you are the team that owns the
 * Services ID. Pasting the .p8 itself into that box is the single most common
 * way this is got wrong, and it fails with an unhelpful error.
 *
 * Two details this gets right that hand-rolled versions usually do not:
 *
 *   · **The signature must be raw r‖s, not DER.** Node signs ECDSA in DER by
 *     default, which is a valid signature of the right thing in the wrong
 *     encoding — Apple rejects it, and the error says nothing about encoding.
 *     `dsaEncoding: 'ieee-p1363'` is what JWS requires.
 *   · **Apple caps the lifetime at six months.** Ask for a year and the token
 *     is refused outright. This asks for just under the cap and prints the
 *     expiry date, because the thing nobody plans for is that Sign in with
 *     Apple silently stops working two quarters from now and by then everyone
 *     has forgotten this file exists.
 *
 * Your private key is read at runtime and never stored, logged or transmitted.
 * It does not appear in the output. Keep the .p8 out of the repository — Apple
 * lets you download it exactly once.
 *
 * Usage:
 *   node scripts/apple-client-secret.mjs \
 *     --key ~/Downloads/AuthKey_ABC123XYZ.p8 \
 *     --team 1A2B3C4D5E \
 *     --services-id com.splitindex.signin
 *
 * The Key ID is read from the filename when it looks like Apple's
 * `AuthKey_<KEYID>.p8`; pass --key-id to override.
 */

import { createPrivateKey, createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

/** Apple refuses anything longer. Just under, so clock skew cannot push it over. */
const SIX_MONTHS_SECONDS = 15_777_000 - 3600;

const base64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function appleClientSecret({ privateKeyPem, keyId, teamId, servicesId, now = new Date() }) {
  for (const [name, value] of Object.entries({ privateKeyPem, keyId, teamId, servicesId })) {
    if (!value) throw new Error(`Missing ${name}`);
  }

  const iat = Math.floor(now.getTime() / 1000);
  const exp = iat + SIX_MONTHS_SECONDS;

  const header = { alg: 'ES256', kid: keyId, typ: 'JWT' };
  const claims = {
    iss: teamId,
    iat,
    exp,
    aud: 'https://appleid.apple.com',
    // The Services ID, not the app's bundle ID. They look alike and are not
    // interchangeable: the bundle ID identifies the app, the Services ID
    // identifies the web sign-in configuration that Supabase redirects through.
    sub: servicesId,
  };

  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;

  const signature = createSign('SHA256')
    .update(signingInput)
    .sign({
      key: createPrivateKey(privateKeyPem),
      // JWS wants the raw 64-byte r‖s pair. Node's default is DER, which Apple
      // rejects without saying why.
      dsaEncoding: 'ieee-p1363',
    });

  return { token: `${signingInput}.${base64url(signature)}`, expiresAt: new Date(exp * 1000) };
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

function main() {
  const keyPath = arg('key');
  const teamId = arg('team');
  const servicesId = arg('services-id');
  const keyId = arg('key-id') ?? (keyPath ? /AuthKey_([A-Z0-9]+)\.p8$/i.exec(basename(keyPath))?.[1] : undefined);

  if (!keyPath || !teamId || !servicesId || !keyId) {
    process.stderr.write(
      '\n  Usage: node scripts/apple-client-secret.mjs --key <AuthKey_XXX.p8> --team <TeamID> --services-id <com.example.signin>\n' +
        '\n  --key-id is read from the filename when it looks like AuthKey_<KEYID>.p8.\n' +
        '\n  Where each value comes from:\n' +
        '    .p8 and Key ID   developer.apple.com → Certificates, Identifiers & Profiles → Keys\n' +
        '    Team ID          top right of the Apple Developer portal, or Membership details\n' +
        '    Services ID      the identifier you created of type "Services IDs"\n\n',
    );
    process.exitCode = 1;
    return;
  }

  let privateKeyPem;
  try {
    privateKeyPem = readFileSync(keyPath, 'utf8');
  } catch (err) {
    process.stderr.write(`\n  Could not read ${keyPath}: ${err.message}\n\n`);
    process.exitCode = 1;
    return;
  }

  let result;
  try {
    result = appleClientSecret({ privateKeyPem, keyId, teamId, servicesId });
  } catch (err) {
    process.stderr.write(`\n  Could not sign: ${err.message}\n\n`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write(
    `\n${result.token}\n\n` +
      `  Paste that into Supabase → Authentication → Providers → Apple → "Secret Key".\n` +
      `  Client ID for that same form is the Services ID: ${servicesId}\n\n` +
      `  EXPIRES ${result.expiresAt.toDateString()}. Sign in with Apple stops working\n` +
      `  that day with no warning. Put it in the calendar now — re-run this command\n` +
      `  and paste the new value; nothing else needs to change.\n\n`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) main();
