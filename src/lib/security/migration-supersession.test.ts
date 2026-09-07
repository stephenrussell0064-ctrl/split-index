import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

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

/** Every `.test.ts` under src, with the migration filenames it names. */
function testsReferencingMigrations(): { test: string; migration: string }[] {
  const found: { test: string; migration: string }[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".test.ts")) {
        const src = readFileSync(full, "utf8");
        for (const [, migration] of src.matchAll(/migrations\/(\d{3}[a-z]?_[a-z0-9_]+\.sql)/g)) {
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

    for (const { test, migration } of testsReferencingMigrations()) {
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
