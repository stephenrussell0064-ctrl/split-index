#!/usr/bin/env node
/**
 * Generate the "Secret Key" that Supabase's Apple provider asks for.
 *
 * Supabase does not want the .p8 file itself. It wants a client secret, which
 * Apple defines as a short-lived ES256 JWT signed BY that .p8 — so the field in
 * the dashboard takes a token, not a key, and pasting the .p8 contents in is the
 * single most common reason Apple sign-in still fails after "enabling" it.
 *
 * Runs on Node's built-in crypto, no dependencies, and never transmits
 * anything. The alternative is one of the "paste your Apple private key here"
 * websites, which is a signing key for your entire developer account.
 *
 * USAGE
 *   node scripts/apple-client-secret.mjs \
 *     --p8 ~/Downloads/AuthKey_ABC123XYZ.p8 \
 *     --key-id ABC123XYZ \
 *     --team-id PC423ABD82 \
 *     --services-id co.uk.splitindex.app.signin
 *
 * The token Apple issues is capped at six months, so this has to be re-run and
 * the dashboard field re-pasted before it expires. The expiry is printed.
 */

import { createSign, createPrivateKey } from "node:crypto";
import { readFileSync } from "node:fs";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, arg, i, all) => {
    if (arg.startsWith("--")) acc.push([arg.slice(2), all[i + 1]]);
    return acc;
  }, []),
);

const required = ["p8", "key-id", "team-id", "services-id"];
const missing = required.filter((k) => !args[k]);
if (missing.length) {
  console.error(`Missing: ${missing.map((m) => "--" + m).join(", ")}`);
  console.error("\nUsage:\n  node scripts/apple-client-secret.mjs \\");
  console.error("    --p8 ~/Downloads/AuthKey_XXXX.p8 --key-id XXXX \\");
  console.error("    --team-id PC423ABD82 --services-id co.uk.splitindex.app.signin");
  process.exit(2);
}

const b64url = (buf) =>
  Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

let pem;
try {
  pem = readFileSync(args.p8.replace(/^~/, process.env.HOME), "utf8");
} catch (e) {
  console.error(`Cannot read ${args.p8}: ${e.message}`);
  process.exit(1);
}

let privateKey;
try {
  privateKey = createPrivateKey(pem);
} catch {
  console.error("That file is not a readable private key. It should start with");
  console.error("-----BEGIN PRIVATE KEY----- and be the .p8 Apple gave you.");
  process.exit(1);
}
if (privateKey.asymmetricKeyType !== "ec") {
  console.error(`Expected an EC key (Apple issues P-256); got ${privateKey.asymmetricKeyType}.`);
  process.exit(1);
}

const now = Math.floor(Date.now() / 1000);
const SIX_MONTHS = 15777000; // Apple's hard ceiling; anything larger is rejected.
const exp = now + SIX_MONTHS;

const header = { alg: "ES256", kid: args["key-id"] };
const payload = {
  iss: args["team-id"],
  iat: now,
  exp,
  aud: "https://appleid.apple.com",
  sub: args["services-id"], // the Services ID, NOT the app's bundle identifier
};

const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;

// ES256 in a JWT is the raw r||s pair, not the DER envelope OpenSSL emits by
// default — "ieee-p1363" is what asks for the former. A DER signature here
// produces a token Apple rejects with an unhelpful invalid_client.
const signature = createSign("SHA256").update(signingInput).sign({
  key: privateKey,
  dsaEncoding: "ieee-p1363",
});

console.log(`${signingInput}.${b64url(signature)}`);
console.error(`\nExpires ${new Date(exp * 1000).toISOString().slice(0, 10)} — re-run before then.`);
