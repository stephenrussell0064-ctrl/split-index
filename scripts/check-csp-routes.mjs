#!/usr/bin/env node
/**
 * Build gate: no prerendered route may receive the nonce-based CSP (M9).
 *
 * WHY THIS IS A BUILD GATE AND NOT A UNIT TEST
 * -------------------------------------------
 * The invariant is "this route is server-rendered", and only a build knows
 * that. A route becomes prerendered by the ABSENCE of something — no cookie
 * read, no header read, no `connection()` — so it can flip to static because
 * somebody deleted a line in a component three levels down, with nothing in
 * the diff that looks like a rendering change.
 *
 * The failure it prevents is bad and silent. A prerendered page's script tags
 * are generated at build time and carry no nonce; served under a nonce policy
 * with 'strict-dynamic', the browser refuses to execute the page's own
 * JavaScript. The athlete gets a blank screen. There is no server error, no
 * failed request, and nothing in the console that names a header set in a
 * proxy — it looks like the app is broken, not like the CSP is wrong.
 *
 * So it runs where a build runs: `npm run build`, therefore Vercel, therefore
 * a deploy that would serve that blank screen fails instead of publishing.
 * Same shape and same reasoning as scripts/check-client-bundle.mjs. It cannot
 * run in CI because CI has no build job, deliberately — see .github/workflows/
 * ci.yml, which makes the same argument about the bundle scanner.
 *
 * `src/lib/security/csp.test.ts` covers the parts that do not need a build.
 */

import { readFileSync } from "node:fs";

/*
 * Duplicated from src/lib/security/csp.ts rather than imported: this is a plain
 * node script run outside the bundler, and it cannot resolve `@/` or TypeScript.
 * The duplication is guarded — csp.test.ts parses THIS file and fails if the two
 * lists diverge, which is the only reason it is acceptable to have two copies.
 */
const NONCE_PATH_PREFIXES = [
  "/activities",
  "/analytics",
  "/api",
  "/cardio",
  "/dashboard",
  "/gym",
  "/hybrid-plan",
  "/interference",
  "/onboarding",
  "/profile",
  "/reports",
  "/settings",
  "/social",
];

const MANIFEST = ".next/prerender-manifest.json";

function main() {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
  } catch {
    /*
     * Loud, and a failure rather than a skip. A missing manifest means the
     * build shape changed, and a gate that quietly passes when it cannot find
     * its input is worse than no gate — it reports success for the one reason
     * that should worry you.
     */
    console.error(
      `[check-csp-routes] Could not read ${MANIFEST}. This script must run ` +
        `after \`next build\`. If the build no longer emits this file, this ` +
        `gate needs rewriting, not deleting.`
    );
    process.exit(1);
  }

  const prerendered = Object.keys(manifest.routes ?? {});
  const offenders = prerendered.filter((route) =>
    NONCE_PATH_PREFIXES.some(
      (prefix) => route === prefix || route.startsWith(`${prefix}/`)
    )
  );

  if (offenders.length > 0) {
    console.error(
      "\n[check-csp-routes] These routes are PRERENDERED but receive the " +
        "nonce-based CSP:\n" +
        offenders.map((r) => `  ${r}`).join("\n") +
        "\n\nServed as-is they would be blank screens: their script tags were " +
        "generated at build time and carry no nonce, so 'strict-dynamic' " +
        "blocks the page's own JavaScript.\n\n" +
        "Two ways out, and they are not equivalent:\n" +
        "  1. Opt the route into dynamic rendering — a server page.tsx that " +
        "awaits connection() before rendering the client component. See " +
        "src/app/(app)/settings/page.tsx. Note that `export const dynamic = " +
        '"force-dynamic"` does NOT work from a "use client" module: it is ' +
        "accepted silently and the route stays prerendered.\n" +
        "  2. Remove the prefix from NONCE_PATH_PREFIXES here AND in " +
        "src/lib/security/csp.ts. That is a decision to serve that page under " +
        "the weaker policy, so make it knowingly.\n"
    );
    process.exit(1);
  }

  console.log(
    `[check-csp-routes] Clean — ${prerendered.length} prerendered routes, ` +
      `none under a nonce prefix.`
  );
}

main();
