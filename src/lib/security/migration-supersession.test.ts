import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/lib/testing/source-scan";

/**
 * A test that reads a migration by name must read the one that still runs.
 *
 * Several tests in this codebase hold TypeScript and SQL to each other by
 * reading a migration file and asserting the two agree. That works exactly
 * until a later migration redefines the same object, at which point the test
 * is reading a definition the database no longer has — and it does not fail.
 * It goes quiet.
 *
 * THIS HAS ALREADY HAPPENED HERE. `leaderboard-brackets.test.ts` read
 * `056_public_projections.sql` to check that the age and weight bands in the
 * view match the TypeScript constants. Its own docblock says what is at stake:
 * "if the SQL bands 34 as '35-44' and this file bands it as '25-34', athletes
 * are silently filed into the wrong bracket and nothing anywhere errors."
 *
 * `leaderboard_profiles` was then rebuilt twice — by 061 for the
 * verified-email gate and by 064 to stop `display_name` publishing an email
 * address. Neither touched the bands, so the test stayed green while watching
 * a file that was no longer the live definition. An edit to the bands in any
 * migration after 056 would have passed.
 *
 * That test now resolves the latest definition itself. This one stops the next
 * one being written the old way.
 *
 * SCOPE: redefinition only — CREATE VIEW and CREATE OR REPLACE FUNCTION. A
 * later GRANT or REVOKE on the same object is not a redefinition and is
 * deliberately out of scope; grants have their own guard in
 * function-grants.test.ts, and folding them in here would fail on files whose
 * grants were legitimately tightened later.
 */

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const MIGRATIONS_DIR = join(ROOT, "supabase/migrations");
const SRC_DIR = join(ROOT, "src");

/** `CREATE VIEW x` / `CREATE OR REPLACE FUNCTION x` — the forms that replace a definition wholesale. */
const DEFINES = /CREATE\s+(?:OR\s+REPLACE\s+)?(VIEW|FUNCTION)\s+(?:public\.)?([a-z_][a-z0-9_]*)/gi;

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
}

function definedObjects(file: string): Set<string> {
  const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
  const names = new Set<string>();
  for (const [, kind, name] of sql.matchAll(DEFINES)) {
    names.add(`${kind.toLowerCase()} ${name.toLowerCase()}`);
  }
  return names;
}

/**
 * Every `.test.ts` under src, with the migration filenames it names.
 *
 * A BARE FILENAME COUNTS. This looked for `migrations/NNN_name.sql`, the path
 * form, and so never saw `activity-visibility.test.ts` — whose migration is a
 * constant, `const PRIVACY_MIGRATION = "049_..."`, with the directory joined
 * on separately. That file reads a definition by name and would have gone
 * quiet on a redefinition exactly as described above, while this guard
 * reported the tree clean.
 *
 * Found through a peer session's message about the grants half of this
 * problem: its guard triggers on the same path form and had inherited the same
 * blind spot. Widening this one immediately surfaced two real findings.
 *
 * Comments are stripped first, because the widened pattern otherwise matches
 * prose. `leaderboard-brackets.test.ts` explains at length that it USED to
 * read 056 by name and no longer does — matching that sentence would fail the
 * one file that has already learned this lesson.
 */
function testsReferencingMigrations(): { test: string; migration: string }[] {
  const found: { test: string; migration: string }[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".test.ts")) {
        const src = stripComments(readFileSync(full, "utf8"));
        for (const [, migration] of src.matchAll(/(\d{3}[a-z]?_[a-z0-9_]+\.sql)/g)) {
          found.push({ test: full.slice(ROOT.length), migration });
        }
      }
    }
  };
  walk(SRC_DIR);
  return found;
}

describe("a test that names a migration", () => {
  it("names one whose definitions have not been superseded", () => {
    const all = migrationFiles();
    const stale: string[] = [];

    /*
      A test that ENUMERATES the migrations directory is trusted to resolve the
      live definition itself; one that can only read the files it names is not.
      That line is what separates the two real cases this widening found.

      `verified-email.test.ts` named 061 and nothing else while 064 had rebuilt
      both public views underneath it. Had 064 dropped
      `email_confirmed_at IS NOT NULL` on the way past, every assertion in that
      file would still have passed and unverified accounts would have been
      public again. It now scans the directory and reads whichever migration
      last defines each view — and still names 061, correctly, for the policies
      and the function that live there and that nothing has touched.

      `activity-visibility.test.ts` names 031 for a column it declares, which
      nothing has redefined, and separately names 049 for the function that 031
      also happened to define. Flagging it would be telling it to stop reading
      031 for the one thing 031 is still the authority on.

      Deliberately approximate, and approximate in this direction on purpose:
      it cannot tell which assertion reads which file, so a file that resolves
      one object and pins another gets the benefit of the doubt. A false
      positive here is worse than a miss, because it trains people to widen the
      rule until it catches nothing.
    */
    const RESOLVES_LATEST = /readdirSync\s*\(\s*MIGRATIONS/;

    for (const { test, migration } of testsReferencingMigrations()) {
      if (RESOLVES_LATEST.test(readFileSync(join(ROOT, test), "utf8"))) continue;

      const defined = definedObjects(migration);
      if (defined.size === 0) continue; // reads a table or data, not a definition

      const later = all.filter((f) => f > migration);
      for (const object of defined) {
        const redefinedIn = later.find((f) => definedObjects(f).has(object));
        if (redefinedIn) {
          stale.push(
            `${test} reads ${migration}, but ${object} is redefined later in ${redefinedIn}`
          );
        }
      }
    }

    // Named rather than counted: the fix is to resolve the latest definition,
    // and knowing which object moved is what tells you whether the assertions
    // in that test still mean anything.
    expect(stale).toEqual([]);
  });

  it("names a migration that exists", () => {
    // A renumbering breaks these references with ENOENT at read time, which is
    // a confusing way to find out. Two renumberings happened in one day here.
    const missing = testsReferencingMigrations()
      .filter(({ migration }) => !migrationFiles().includes(migration))
      .map(({ test, migration }) => `${test} reads ${migration}, which does not exist`);
    expect(missing).toEqual([]);
  });
});
