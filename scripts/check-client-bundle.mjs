#!/usr/bin/env node
/**
 * WP2 — fail the build if a server-side secret reached the client bundle.
 *
 * The failure this exists for is narrow and unrecoverable: a Supabase
 * `service_role` key, which bypasses row level security entirely, or a payment
 * provider's secret key, ending up in JavaScript the browser downloads. There
 * is no fixing that after the fact except rotation, and no way to know who
 * took a copy in between.
 *
 * The brief is specific that this must be a BUILD-TIME GATE and not a code
 * review convention, because the whole class of mistake is one somebody makes
 * while not thinking about secrets. `import "server-only"` catches the common
 * shape — a server module imported from a client component — and this catches
 * the rest: a key pasted into a constant, inlined by a bundler, or reaching the
 * client through a route nobody expected to be client-side.
 *
 * WHY THIS CANNOT JUST GREP FOR "eyJ"
 * -----------------------------------
 * The Supabase anon key and the service-role key are both JWTs, both signed
 * with the same algorithm, and both therefore start with exactly the same
 * base64 header: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9`. The anon key is
 * SUPPOSED to be in the bundle — that is how the client library works — so a
 * prefix match would fail every build on a correctly configured app, and an
 * always-red gate gets disabled within a week.
 *
 * So JWTs are decoded and judged on their payload: `role: "service_role"` is
 * the thing that must never ship. `role: "anon"` is expected and passes.
 *
 * Usage:
 *   node scripts/check-client-bundle.mjs [buildDir]
 * Exits 0 when clean, 1 when a secret is found or the build output is missing.
 */

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, extname } from "node:path";

/** Directories inside the build output that the browser can actually fetch. */
const CLIENT_DIRS = ["static"];

/** File types worth scanning. Source maps count: they carry the original text. */
const SCANNED_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".map", ".json", ".css", ".html"]);

/**
 * Literal patterns that are secrets wherever they appear.
 *
 * Deliberately not including a bare `sk_` or `pk_`: `pk_` is the publishable
 * Stripe key and belongs in the bundle, and a loose `sk_` matches enough
 * minified identifiers to be useless.
 */
const VALUE_PATTERNS = [
  /*
   * The account-prefix form, caught at a SHORTER length than the general
   * patterns below.
   *
   * GitHub's push protection recognises a Stripe key by its `51` account
   * prefix and does not wait for a full-length key. Ours required 16+
   * characters, so a truncated example in a comment — the prefix plus a few
   * characters and an ellipsis — passed here and was rejected there. That gap
   * cost a blocked push and is what this pattern closes: the point of a local
   * gate is to catch what the remote will refuse, before the refusal.
   *
   * Four characters after the prefix is enough to be distinctive and short
   * enough to catch an abbreviation.
   */
  { name: "Stripe key with an account prefix", re: /\bsk_(?:live|test)_51[A-Za-z0-9]{4,}/ },
  { name: "Stripe live secret key", re: /\bsk_live_[A-Za-z0-9]{16,}/ },
  { name: "Stripe test secret key", re: /\bsk_test_[A-Za-z0-9]{16,}/ },
  { name: "Stripe restricted key", re: /\brk_live_[A-Za-z0-9]{16,}/ },
  { name: "Stripe webhook signing secret", re: /\bwhsec_[A-Za-z0-9]{16,}/ },
  { name: "OpenAI API key", re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/ },
  { name: "Private key block", re: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/ },
];

/**
 * Every pattern, for scanning built client output. The env-reference patterns
 * are appended below.
 *
 * The split matters because the two kinds apply to different things. A CLIENT
 * CHUNK reading `process.env.STRIPE_SECRET_KEY` has had a server module bundled
 * into it. A SOURCE file reading the same thing is an ordinary server module
 * doing its job. So a source scan must use the value patterns only, which is
 * what `findSecrets(..., { valuesOnly: true })` exists for.
 */
const SECRET_PATTERNS = [...VALUE_PATTERNS];

/**
 * Secret-bearing environment variables, matched only in their ACCESS form.
 *
 * The first version of this matched the bare name, and it was wrong. It fired
 * on three client chunks that contain the string "Stripe not configured. Add
 * STRIPE_SECRET_KEY and STRIPE_PRICE_ID to .env.local" — a help message shown
 * to the operator when checkout is misconfigured. No secret, no server module,
 * nothing to fix. That is exactly the failure this file's header warns about:
 * a gate that fires on legitimate content is a gate somebody disables, and
 * then it never fires on the real thing either.
 *
 * `process.env.NAME` is the form that means a server module got bundled for
 * the browser. Prose mentioning the name does not.
 *
 * BE HONEST ABOUT HOW MUCH THIS CATCHES. Next.js replaces non-`NEXT_PUBLIC_`
 * `process.env` reads in client bundles at build time, so the identifier
 * usually does not survive to be found. This is a backstop for the cases where
 * it does — a dynamic read, a copied `.env` parsed at runtime, a
 * differently-configured bundler. The load-bearing checks are the value-based
 * ones above and the JWT role check below, which look for the secret itself
 * rather than for a reference to it.
 *
 * Names taken from `grep -rhoE "process\.env\.[A-Z_0-9]+" src scripts`, not
 * from .env.example — two of them (REVENUECAT_WEBHOOK_SECRET,
 * DEMO_ACCOUNT_PASSWORD) are used in code and undocumented there.
 */
const SECRET_ENV_NAMES = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "REVENUECAT_WEBHOOK_SECRET",
  "OPENAI_API_KEY",
  "CRON_SECRET",
  "DEMO_ACCOUNT_PASSWORD",
];

for (const name of SECRET_ENV_NAMES) {
  SECRET_PATTERNS.push({
    name: `${name} read from a client chunk`,
    re: new RegExp(`process\\.env\\.${name}\\b|process\\.env\\[["']${name}["']\\]`),
  });
}

/** Anything JWT-shaped, so the payload can be inspected rather than guessed at. */
const JWT_RE = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;

function decodeJwtPayload(token) {
  try {
    const [, payload] = token.split(".");
    const json = Buffer.from(
      payload.replace(/-/g, "+").replace(/_/g, "/"),
      "base64"
    ).toString("utf8");
    return JSON.parse(json);
  } catch {
    // Not a JWT after all — a base64 blob that happened to match the shape.
    return null;
  }
}

/** Roles that must never appear in anything the browser can fetch. */
const FORBIDDEN_JWT_ROLES = new Set(["service_role", "supabase_admin"]);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else if (SCANNED_EXTENSIONS.has(extname(full))) out.push(full);
  }
  return out;
}

/**
 * Scan one string. Exported shape kept simple so the unit test can drive this
 * directly with fixtures rather than needing a real build.
 */
export function findSecrets(content, label = "<string>", options = {}) {
  const findings = [];
  const patterns = options.valuesOnly ? VALUE_PATTERNS : SECRET_PATTERNS;

  for (const { name, re } of patterns) {
    const match = content.match(re);
    if (match) {
      findings.push({
        file: label,
        kind: name,
        // Never print the secret. A CI log is not a safe place to put the thing
        // you are complaining about being in an unsafe place.
        evidence: `${match[0].slice(0, 8)}… (${match[0].length} chars)`,
      });
    }
  }

  for (const token of content.match(JWT_RE) ?? []) {
    const payload = decodeJwtPayload(token);
    if (!payload) continue;
    const role = typeof payload.role === "string" ? payload.role : null;
    if (role && FORBIDDEN_JWT_ROLES.has(role)) {
      findings.push({
        file: label,
        kind: `Supabase JWT with role "${role}"`,
        evidence: `iss=${payload.iss ?? "?"} ref=${payload.ref ?? "?"}`,
      });
    }
  }

  return findings;
}

function main() {
  const buildDir = process.argv[2] ?? ".next";

  if (!existsSync(buildDir)) {
    console.error(
      `[check-client-bundle] No build output at ${buildDir}. Run the build first — ` +
        `a gate that silently passes when it cannot find anything to check is not a gate.`
    );
    process.exit(1);
  }

  const roots = CLIENT_DIRS.map((d) => join(buildDir, d)).filter((d) => existsSync(d));
  if (roots.length === 0) {
    console.error(
      `[check-client-bundle] No client directories under ${buildDir} (looked for ${CLIENT_DIRS.join(", ")}).`
    );
    process.exit(1);
  }

  const files = roots.flatMap((root) => walk(root));
  const findings = files.flatMap((file) =>
    findSecrets(readFileSync(file, "utf8"), file)
  );

  if (findings.length > 0) {
    console.error("\n[check-client-bundle] SECRETS FOUND IN THE CLIENT BUNDLE\n");
    for (const f of findings) {
      console.error(`  ${f.kind}\n    in ${f.file}\n    ${f.evidence}\n`);
    }
    console.error(
      "This build is not safe to deploy. Every key found above must be treated as\n" +
        "compromised and ROTATED — a build that got this far may already have been\n" +
        "published, and there is no way to tell who fetched it.\n\n" +
        "See SECURITY.md for which key is which and how to rotate each one.\n"
    );
    process.exit(1);
  }

  console.log(
    `[check-client-bundle] Clean — scanned ${files.length} client files, no server secrets found.`
  );
}

// Only run when invoked directly, so the test can import findSecrets.
if (process.argv[1] && process.argv[1].endsWith("check-client-bundle.mjs")) {
  main();
}
