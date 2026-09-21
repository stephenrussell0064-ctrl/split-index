import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/lib/testing/source-scan";

/**
 * N9 — every use of the service-role client is recorded.
 *
 * WP7 lists elevated-credential queries among the events to record, and one of
 * twelve call sites was recording one. The obvious fix — add a
 * `logSecurityEvent` call to the other eleven — records the eleven that exist
 * and nothing about the thirteenth, which will be written by somebody who has
 * never read `admin.ts`.
 *
 * So the record moved INTO `createAdminClient`, and `source` became a required
 * argument. The compiler refuses a call that does not say where it is from, so
 * the record cannot be forgotten; it can only be wrong, and a wrong one shows
 * up in review in a way a missing one does not.
 *
 * These tests hold the two properties that a type signature alone does not:
 * that the logging is still in there, and that no call site has quietly gone
 * back to a bare invocation.
 */

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(full) && !/\.test\.tsx?$/.test(full)) out.push(full);
  }
  return out;
}

describe("obtaining the elevated client is itself the record", () => {
  const admin = stripComments(
    readFileSync(`${ROOT}/src/lib/supabase/admin.ts`, "utf8")
  );

  it("logs an elevated_query event", () => {
    expect(admin).toContain('type: "elevated_query"');
    expect(admin).toContain("logSecurityEvent");
    // Audit retention, not security: the question "who could have read this,
    // and when" is asked on a longer horizon than "was there a brute-force
    // attempt in March".
    expect(admin).toContain('retention: "audit"');
  });

  it("takes source as a required argument, which is what makes it unforgettable", () => {
    // `source: string` and not `source?: string`. An optional one would let a
    // thirteenth call site compile without saying anything about itself.
    expect(admin).toMatch(/createAdminClient\(\s*source: string/);
  });

  /**
   * The recursion question, asked once here so nobody has to rediscover it:
   * `admin-audit` uses this client to write `admin_access_log`, so logging from
   * inside the factory would loop if the logger touched a table. It does not —
   * `logSecurityEvent` writes to stdout.
   */
  it("logs somewhere that cannot call back into this function", () => {
    const logger = stripComments(
      readFileSync(`${ROOT}/src/lib/observability/security-log.ts`, "utf8")
    );
    expect(logger).not.toContain("createAdminClient");
    expect(logger).not.toMatch(/\.from\(/);
  });
});

describe("no call site obtains it anonymously", () => {
  it("passes a source everywhere", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(join(ROOT, "src"))) {
      if (file.endsWith("/lib/supabase/admin.ts")) continue;
      const code = stripComments(readFileSync(file, "utf8"));
      if (/createAdminClient\(\s*\)/.test(code)) {
        offenders.push(file.slice(ROOT.length + 1));
      }
    }
    expect(
      offenders,
      "these obtain the service-role client without saying where from, so the " +
        "event records nothing useful:\n  " + offenders.join("\n  ")
    ).toEqual([]);
  });

  it("finds the call sites, so the check is not vacuous", () => {
    const users = sourceFiles(join(ROOT, "src")).filter((f) =>
      /createAdminClient\(/.test(stripComments(readFileSync(f, "utf8")))
    );
    // Twelve documented sites plus the factory itself.
    expect(users.length).toBeGreaterThanOrEqual(12);
  });
});
