import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// Imported from the build gate so both use one definition of "key-shaped".
import { findSecrets } from "./check-client-bundle.mjs";

/**
 * No key-shaped literal in tracked source.
 *
 * WHY THIS EXISTS — a real incident, not a hypothesis.
 *
 * The WP2 gate's own test file used realistic Stripe fixtures — the live-key
 * prefix followed by a real-looking account segment. GitHub's push protection
 * read them as live keys and rejected every push to the branch. They were
 * fabricated and always had been, but push protection scans commits rather than
 * tips, so the whole branch was stuck behind a commit that could not be amended
 * without a rebase — including several days of unrelated work on top of it.
 *
 * The cost was not a leak. It was hours of history surgery to remove two
 * strings that never mattered.
 *
 * NOTE THE SHAPE OF THIS COMMENT. The first version quoted the offending
 * fixture verbatim to explain it, and push protection rejected the commit
 * containing THIS FILE for that reason — a note about not writing key-shaped
 * literals, blocked for containing a key-shaped literal. Describe them; do not
 * reproduce them. The same mistake, in the same session, took out the WP2
 * bundle scanner, the WP5 error guard and the WP12 gating test: prose about a
 * pattern is not exempt from the pattern.
 *
 * WHY IT IS SEPARATE FROM THE BUNDLE GATE
 * ---------------------------------------
 * A peer suggested extending check-client-bundle.mjs to scan test files. It
 * should not, and the distinction is worth stating because it is the difference
 * between a gate people keep and a gate people delete.
 *
 * The bundle gate answers "did a secret reach the browser". Its input is
 * `.next/static` and its patterns include env-name references, because a client
 * chunk mentioning `process.env.STRIPE_SECRET_KEY` means a server module was
 * bundled. Pointed at source, that same rule fires on every server file in the
 * app doing exactly what it should.
 *
 * This answers a different question — "will this commit be pushable, and is
 * anything key-shaped sitting in the repository" — so it uses the VALUE
 * patterns only, via `findSecrets(..., { valuesOnly: true })`. Same definition
 * of key-shaped, different scope, different verdict.
 *
 * It is a test rather than a build step because it needs to run before a push,
 * and CI runs tests. A build-time check would fire after the point it is
 * useful.
 */

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/**
 * Everything git would let you commit: tracked files AND new files that are not
 * ignored.
 *
 * `--others --exclude-standard` is the important half and it was missing from
 * the first version, which used plain `git ls-files`. That scans only TRACKED
 * files — so a brand-new file is invisible to this check until after it has
 * been committed, which is exactly one step too late. This very file proved it:
 * the gate passed while the file was untracked, then caught its own comment the
 * moment it was committed, by which point push protection had already refused
 * the push.
 *
 * Ignored files are still excluded. An untracked-and-ignored scratch file with
 * a real key in it is a different problem, and `.gitignore` is the control for
 * that one.
 */
function trackedFiles(): string[] {
  return execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .filter(Boolean)
    .filter((f) => /\.(ts|tsx|js|jsx|mjs|cjs|json|sql|md|yml|yaml|env\.example)$/.test(f))
    // package-lock is generated, enormous, and contains integrity hashes that
    // are not secrets. Scanning it is minutes of CPU for no signal.
    .filter((f) => f !== "package-lock.json");
}

describe("no key-shaped literal is committed", () => {
  it("finds none in tracked source", () => {
    const offenders: string[] = [];

    for (const file of trackedFiles()) {
      let content: string;
      try {
        content = readFileSync(join(ROOT, file), "utf8");
      } catch {
        continue; // binary, or removed between listing and reading
      }

      const findings = findSecrets(content, file, { valuesOnly: true });
      for (const finding of findings) {
        // Never print the match itself — same rule as the build gate. A CI log
        // is not a safe place to put the thing you are complaining about being
        // in an unsafe place.
        offenders.push(`${file} — ${finding.kind}`);
      }
    }

    expect(
      offenders,
      "these contain something shaped like a real credential. If it is a test " +
        "fixture, BUILD it rather than writing the literal — see the Stripe " +
        "fixtures in check-client-bundle.test.ts, which are assembled at " +
        "runtime for exactly this reason. If it is a real key, rotate it:\n  " +
        offenders.join("\n  ")
    ).toEqual([]);
  });

  /**
   * The check has to actually fire, or it is a green tick that means nothing.
   * Both of these are constructed at runtime so this file does not become the
   * thing it is testing for.
   */
  it("would catch a literal that got committed", () => {
    const planted = "sk_live_" + "1".repeat(24);
    expect(findSecrets(planted, "fixture.ts", { valuesOnly: true }).length).toBeGreaterThan(0);

    const jwtish =
      "eyJhbGciOiJIUzI1NiJ9." +
      Buffer.from(JSON.stringify({ role: "service_role" }))
        .toString("base64")
        .replace(/=+$/, "") +
      // The JWT pattern needs 8+ characters in every segment; a short "sig"
      // silently fails to match and the assertion would pass for the wrong
      // reason.
      "." + "s".repeat(16);
    expect(findSecrets(jwtish, "fixture.ts", { valuesOnly: true }).length).toBeGreaterThan(0);
  });

  it("leaves ordinary server code alone", () => {
    // The whole reason this uses valuesOnly. Every server module in the app
    // reads one of these, and none of them is a finding.
    const serverModule = `
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
      const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!);
      if (secret !== process.env.CRON_SECRET) return unauthorized();
    `;
    expect(findSecrets(serverModule, "route.ts", { valuesOnly: true })).toEqual([]);
  });

  it("leaves documentation naming the variables alone", () => {
    // SECURITY.md lists every secret by name. That is the point of it.
    const security = readFileSync(join(ROOT, "SECURITY.md"), "utf8");
    expect(findSecrets(security, "SECURITY.md", { valuesOnly: true })).toEqual([]);
  });
});
