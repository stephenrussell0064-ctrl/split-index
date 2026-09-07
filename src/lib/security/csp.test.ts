import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DYNAMIC_BY_FORCE,
  NONCE_PATH_PREFIXES,
  generateNonce,
  needsNonce,
  publicCsp,
  strictCsp,
} from "./csp";
import {
  readNonTestSources,
  stripComments,
  walkSource,
} from "@/lib/testing/source-scan";

/**
 * M9 — the CSP split.
 *
 * The finding was `script-src 'self' 'unsafe-inline'` in production. The fix is
 * a nonce, and the reason it took a decision rather than a commit is that
 * nonces force dynamic rendering: the docs are explicit, and a build of this
 * app prerenders `/` along with the privacy and terms pages.
 *
 * So the policy is split by path. These tests cover the two halves and, more
 * importantly, the seam between them — which is where this breaks, silently,
 * with a blank screen.
 */

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));

describe("which paths get which policy", () => {
  /**
   * Read as a table. The right-hand column is the one that matters: everything
   * false here keeps `'unsafe-inline'`, and that is a deliberate acceptance of
   * risk on pages that render no athlete data, not an oversight.
   */
  const CASES: [string, boolean][] = [
    // The authenticated surface — already dynamic, so nonces are free.
    ["/dashboard", true],
    ["/activities", true],
    ["/activities/abc-123", true],
    ["/activities/abc-123/edit", true],
    ["/gym/log", true],
    ["/cardio/gps-run", true],
    ["/hybrid-plan/intake", true],
    ["/profile", true],
    ["/reports", true],
    ["/settings", true],
    ["/settings/billing", true],
    ["/social", true],
    ["/api/activities", true],

    // The public surface — statically rendered, keeps the previous policy.
    ["/", false],
    ["/privacy", false],
    ["/terms", false],
    ["/accessibility", false],
    ["/how-scoring-works", false],
    ["/login", false],
    ["/signup", false],
    ["/forgot-password", false],
    ["/reset-password", false],
    ["/email-confirmed", false],
    ["/robots.txt", false],
    ["/sitemap.xml", false],
  ];

  it.each(CASES)("%s → nonce: %s", (path, expected) => {
    expect(needsNonce(path)).toBe(expected);
  });

  /**
   * Prefix matching must be on path SEGMENTS. `/settings-export` is not under
   * `/settings`, and a naive `startsWith` would hand it a nonce policy it
   * cannot satisfy — the blank-screen failure, arriving from a route somebody
   * added without ever reading this file.
   */
  it("does not match a prefix that is only a string prefix", () => {
    expect(needsNonce("/settingsomething")).toBe(false);
    expect(needsNonce("/apiary")).toBe(false);
    expect(needsNonce("/social-proof")).toBe(false);
  });
});

describe("the strict policy", () => {
  const csp = strictCsp("TESTNONCE", false);

  /** The finding itself. This is the assertion M9 exists for. */
  it("does not allow inline script", () => {
    const scriptSrc = csp.match(/script-src([^;]*);/)![1];
    expect(scriptSrc).not.toContain("unsafe-inline");
  });

  it("carries the nonce and strict-dynamic", () => {
    expect(csp).toContain("'nonce-TESTNONCE'");
    // Without strict-dynamic, an injected <script src="/anything"> still
    // satisfies 'self' and the nonce has bought very little.
    expect(csp).toContain("'strict-dynamic'");
  });

  it("keeps unsafe-eval out of production", () => {
    expect(strictCsp("N", false)).not.toContain("unsafe-eval");
    // React uses eval in development to rebuild server error stacks.
    expect(strictCsp("N", true)).toContain("unsafe-eval");
  });

  it("still denies the things the old policy denied", () => {
    for (const clause of [
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "upgrade-insecure-requests",
    ]) {
      expect(csp).toContain(clause);
    }
  });
});

describe("the public policy", () => {
  /**
   * A regression test in the literal sense: the marketing pages must behave
   * exactly as they did before the split. If this changes, something was
   * altered on the public surface while nobody was looking at it.
   */
  it("is byte-identical to the policy that shipped before M9", () => {
    expect(publicCsp(false)).toBe(
      "default-src 'self'; script-src 'self' 'unsafe-inline'; " +
        "style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; " +
        "font-src 'self' data:; connect-src 'self' ; object-src 'none'; " +
        "base-uri 'self'; form-action 'self'; frame-ancestors 'none'; " +
        "upgrade-insecure-requests;"
    );
  });

  /**
   * Stated, not hidden. The public pages keep the weaker clause, and the audit
   * says so. This test exists so that changing it is a deliberate act.
   */
  it("still allows inline script, deliberately", () => {
    expect(publicCsp(false)).toContain("'unsafe-inline'");
  });
});

describe("nonces", () => {
  it("are different every time", () => {
    const seen = new Set(Array.from({ length: 200 }, () => generateNonce()));
    expect(seen.size).toBe(200);
  });

  it("are long enough to be worth generating", () => {
    // A guessable nonce is the same as no nonce. randomUUID is 122 bits.
    expect(generateNonce().length).toBeGreaterThan(20);
  });
});

describe("the seam — prerendered routes must never get a nonce", () => {
  /**
   * THE FAILING-BEFORE TEST.
   *
   * Before this change the build prerendered thirteen routes, and three of them
   * sit under prefixes that now receive the strict policy. Had the policy
   * shipped without opting those three into dynamic rendering, each would have
   * been served with a nonce it could not have — script tags baked at build
   * time, `'strict-dynamic'` refusing everything without a nonce, and an
   * athlete looking at a blank page with nothing in the console naming a
   * header set in a proxy.
   *
   * This is the exact route list from `npm run build` on the parent commit.
   */
  const PRERENDERED_BEFORE_THE_FIX = [
    "/",
    "/_not-found",
    "/accessibility",
    "/cardio/gps-run",
    "/email-confirmed",
    "/forgot-password",
    "/privacy",
    "/reset-password",
    "/robots.txt",
    "/settings",
    "/settings/billing",
    "/sitemap.xml",
    "/terms",
  ];

  it("catches the three routes that would have broken", () => {
    const offenders = PRERENDERED_BEFORE_THE_FIX.filter(needsNonce);
    expect(offenders.sort()).toEqual([
      "/cardio/gps-run",
      "/settings",
      "/settings/billing",
    ]);
  });

  it("names those three as forced dynamic", () => {
    // Same three, and the reason they each carry a server shell calling
    // connection(). If a fourth appears, it belongs here too.
    expect([...DYNAMIC_BY_FORCE].sort()).toEqual([
      "/cardio/gps-run",
      "/settings",
      "/settings/billing",
    ]);
  });

  /**
   * Each of the three has a server `page.tsx` that awaits `connection()`.
   *
   * Asserted on the source because the alternative — route segment config —
   * was tried first, is accepted silently from a "use client" module, and does
   * nothing at all. The build output was the only thing that revealed it. A
   * test that the file says `connection()` is a poor substitute for a build,
   * which is why scripts/check-csp-routes.mjs exists; this one catches the
   * cheap regression of somebody deleting the shell.
   */
  it.each([
    ["src/app/(app)/settings/page.tsx"],
    ["src/app/(app)/settings/billing/page.tsx"],
    ["src/app/(app)/cardio/gps-run/page.tsx"],
  ])("%s awaits connection()", (file) => {
    /*
     * Comments stripped first — the SIXTH time in this codebase, and the first
     * where the prose being matched sits in the file under test rather than in
     * the scanner. Each shell's header explains that `force-dynamic` exported
     * from a "use client" module does nothing, so it necessarily contains both
     * of the strings it is being checked for. Prose describing a mistake is not
     * the mistake.
     */
    const code = stripComments(readFileSync(join(ROOT, file), "utf8"));
    expect(code).toContain("await connection()");
    expect(code).not.toContain("use client");
    expect(code).not.toContain("force-dynamic");
  });
});

describe("the build gate agrees with the module", () => {
  /**
   * scripts/check-csp-routes.mjs duplicates NONCE_PATH_PREFIXES, because it is
   * a plain node script that cannot resolve `@/` or TypeScript. Duplication is
   * only acceptable while something notices it drifting, so: this.
   */
  it("uses the same prefix list", () => {
    const script = readFileSync(join(ROOT, "scripts/check-csp-routes.mjs"), "utf8");
    const block = script.match(/const NONCE_PATH_PREFIXES = \[([^\]]*)\]/)![1];
    const fromScript = [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(fromScript).toEqual([...NONCE_PATH_PREFIXES]);
  });

  it("is wired into the build, not just present", () => {
    // A gate nobody runs is a comment. WP2's scanner earned this check.
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    expect(pkg.scripts.build).toContain("check:csp");
    expect(pkg.scripts["check:csp"]).toContain("check-csp-routes.mjs");
  });
});

describe("no inline script can reach a nonce-policy route", () => {
  /**
   * Next applies the nonce to its OWN script tags — framework bundles, page
   * chunks, `<Script>` components. A hand-written `<script>` in a component
   * gets nothing, so under the strict policy it is silently dropped.
   *
   * This is how the fix nearly broke the JSON-LD: the Organization block lived
   * in the ROOT LAYOUT, which renders on every route including all of the
   * authenticated ones. Moving it to `/` was not tidying — it was the only
   * option that did not either lose the structured data or force every route
   * in the application to be dynamically rendered.
   */
  function routeFor(file: string): string {
    const rel = relative(join(ROOT, "src/app"), file);
    return (
      "/" +
      rel
        .replace(/\/(page|layout|template|default)\.tsx?$/, "")
        .split("/")
        .filter((seg) => !seg.startsWith("(")) // route groups are not URL segments
        .join("/")
    ).replace(/\/$/, "") || "/";
  }

  it("keeps raw script tags off the authenticated surface", () => {
    const offenders: string[] = [];

    for (const { file, code } of readNonTestSources(join(ROOT, "src"))) {
      if (!/dangerouslySetInnerHTML/.test(code)) continue;

      // Shared components can be rendered from anywhere, so there is no safe
      // route to attribute them to.
      if (file.includes("/src/components/")) {
        offenders.push(`${relative(ROOT, file)} (a shared component — reachable from any route)`);
        continue;
      }
      if (!file.includes("/src/app/")) continue;

      const route = routeFor(file);
      if (needsNonce(route)) {
        offenders.push(`${relative(ROOT, file)} → ${route}`);
      }
    }

    expect(
      offenders,
      "these render raw HTML on a route served with a nonce CSP, so the browser " +
        "will silently drop it. Move the markup to a public route, or give it a " +
        "nonce — which for a layout means reading headers and making every route " +
        "dynamic, so read src/lib/security/csp.ts before choosing that:\n  " +
        offenders.join("\n  ")
    ).toEqual([]);
  });

  it("keeps the root layout free of them, since it renders everywhere", () => {
    const layout = readFileSync(join(ROOT, "src/app/layout.tsx"), "utf8");
    expect(layout).not.toContain("dangerouslySetInnerHTML");
  });

  it("checks every app route, not an empty set", () => {
    // Guard against the scan above passing because it found nothing to scan.
    const pages = walkSource(join(ROOT, "src/app")).filter((f) =>
      /\/page\.tsx$/.test(f)
    );
    expect(pages.length).toBeGreaterThan(30);
    expect(pages.map(routeFor)).toContain("/dashboard");
    expect(pages.map(routeFor)).toContain("/settings/billing");
  });
});
