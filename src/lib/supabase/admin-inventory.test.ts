import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * WP2 — the elevated-credential inventory, kept honest.
 *
 * The brief's acceptance criterion for WP2 is two things: a build that fails on
 * a planted service-role key, and "a report listing every elevated-credential
 * call site with its justification". The report exists in SECURITY.md and in
 * the header of admin.ts.
 *
 * A report is only worth having if it is true, and a hand-maintained list of
 * call sites is exactly the kind of thing that stops being true on the first
 * busy afternoon. So this test derives the list from the code and fails if
 * either document has fallen behind.
 *
 * It is deliberately not a count. Counting would pass a change that removed one
 * call site and added another somewhere worse.
 */

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const SRC = join(ROOT, "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(full) && !/\.test\.tsx?$/.test(full)) out.push(full);
  }
  return out;
}

/** Every module that constructs the service-role client, excluding the factory itself. */
function elevatedCallSites(): string[] {
  return walk(SRC)
    .filter((file) => {
      const rel = relative(SRC, file);
      if (rel === join("lib", "supabase", "admin.ts")) return false;
      return /\bcreateAdminClient\b/.test(readFileSync(file, "utf8"));
    })
    .map((file) => relative(SRC, file).replace(/\\/g, "/").replace(/\.tsx?$/, ""))
    // Both documents name routes the way a URL does — `api/races`, not
    // `app/api/races/route` — so normalise to that: drop the App Router's
    // `app/` prefix and the `/route` filename.
    .map((p) => p.replace(/^app\//, "").replace(/\/route$/, ""))
    .sort();
}

const SECURITY_MD = readFileSync(join(ROOT, "SECURITY.md"), "utf8");
const ADMIN_TS = readFileSync(join(SRC, "lib/supabase/admin.ts"), "utf8");

describe("the service-role client", () => {
  it("is only constructed in one place", () => {
    // The Stripe webhook used to carry its own inline copy reading
    // SUPABASE_SERVICE_ROLE_KEY directly. A duplicated factory is one that the
    // `server-only` guard and this inventory both miss.
    const directReads = walk(SRC).filter((file) => {
      const rel = relative(SRC, file).replace(/\\/g, "/");
      if (rel === "lib/supabase/admin.ts") return false;
      // The ACCESS form, not the bare name. Matching the name alone flagged a
      // comment in the Stripe webhook explaining that it used to read the key
      // directly — the same false positive the bundle scanner hit on an error
      // message. Prose naming a secret is not a use of it.
      return /process\.env\.SUPABASE_SERVICE_ROLE_KEY/.test(readFileSync(file, "utf8"));
    });

    // admin-role.ts legitimately checks whether the key is *present* before
    // deciding it cannot verify anything — it never builds a client of its own.
    const allowed = new Set(["lib/auth/admin-role.ts"]);
    const unexpected = directReads
      .map((f) => relative(SRC, f).replace(/\\/g, "/"))
      .filter((f) => !allowed.has(f));

    expect(
      unexpected,
      `these read SUPABASE_SERVICE_ROLE_KEY directly instead of using createAdminClient: ${unexpected.join(", ")}`
    ).toEqual([]);
  });

  it("cannot be imported into a client bundle", () => {
    // `import "server-only"` throws at build time in a browser environment, so
    // this is the line that turns a convention into a gate.
    expect(ADMIN_TS.startsWith('import "server-only";')).toBe(true);
  });

  it("has every call site documented in SECURITY.md", () => {
    const missing = elevatedCallSites().filter((site) => !SECURITY_MD.includes(site));
    expect(
      missing,
      `undocumented elevated-credential call sites — add them to SECURITY.md ` +
        `with the reason the user's own client will not do:\n  ${missing.join("\n  ")}`
    ).toEqual([]);
  });

  it("has every call site documented beside the code, in admin.ts", () => {
    const missing = elevatedCallSites().filter((site) => !ADMIN_TS.includes(site));
    expect(
      missing,
      `call sites missing from the admin.ts header:\n  ${missing.join("\n  ")}`
    ).toEqual([]);
  });

  it("does not document call sites that no longer exist", () => {
    // The other direction. A justification left behind for a route that was
    // deleted makes the report look thorough while describing nothing.
    const live = new Set(elevatedCallSites());
    const documented = [...ADMIN_TS.matchAll(/^ \*\s{3}((?:api|lib)\/[a-z0-9/[\]_-]+)/gim)].map(
      (m) => m[1].trim()
    );
    const stale = documented.filter((d) => !live.has(d));
    expect(stale, `documented but no longer present: ${stale.join(", ")}`).toEqual([]);
  });
});
