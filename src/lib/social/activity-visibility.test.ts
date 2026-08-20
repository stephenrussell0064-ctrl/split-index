import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * RLS is the real enforcement boundary for activity visibility, so these
 * tests assert against the migration SQL itself rather than the TypeScript
 * that sits on top of it. They exist to catch the two changes that would
 * quietly hurt real people:
 *
 *   1. widening activity_is_visible_to() so a non-friend (or an anonymous
 *      caller) can read another athlete's activities,
 *   2. adding another blanket backfill that flips deliberate opt-outs back
 *      to visible — migration 032 did exactly that once, which was only
 *      harmless because no athlete could have opted out yet, and
 *   3. giving two migrations the same number, which is how the privacy fix
 *      shipped once already without ever reaching a database.
 */

const PRIVACY_MIGRATION = "049_private_account_visibility.sql";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../supabase/migrations", import.meta.url));

function readMigration(name: string): string {
  return readFileSync(`${MIGRATIONS_DIR}/${name}`, "utf8");
}

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

/** Leading migration number, e.g. "032_share..." -> 32. */
function migrationNumber(file: string): number {
  return Number.parseInt(file.slice(0, 3), 10);
}

/** SQL with `--` line comments removed, so prose in a comment can't satisfy an assertion. */
function stripComments(sql: string): string {
  return sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

describe("activity visibility migrations", () => {
  it("defaults new athletes to visible-to-friends", () => {
    const sql = stripComments(readMigration(PRIVACY_MIGRATION));
    expect(sql).toMatch(/ALTER COLUMN share_activities_with_friends SET DEFAULT true/i);
  });

  describe("activity_is_visible_to() — the enforcement predicate", () => {
    const predicate = stripComments(
      readMigration(PRIVACY_MIGRATION)
    ).split(/CREATE OR REPLACE FUNCTION activity_is_visible_to/i)[1];

    it("requires the owner to be sharing before any friend can read", () => {
      expect(predicate).toMatch(/p\.share_activities_with_friends = true/);
    });

    it("requires an ACCEPTED friendship — not pending, not blocked", () => {
      expect(predicate).toMatch(/f\.status = 'accepted'/);
    });

    it("only answers for the authenticated caller, so it can't be used as a probe", () => {
      expect(predicate).toMatch(/viewer_id = auth\.uid\(\)/);
    });

    it("never exposes drafts", () => {
      expect(predicate).toMatch(/a\.is_draft = false/);
    });

    it("has no branch that returns true without either ownership or friendship", () => {
      // The only two ways through are `a.user_id = viewer_id` (owner) and the
      // sharing-plus-accepted-friend branch. Guard against a stray `OR true`
      // or a public-read escape hatch of the kind workout_scores has.
      expect(predicate).not.toMatch(/OR\s+true/i);
      expect(predicate).not.toMatch(/USING\s*\(\s*true\s*\)/i);
    });
  });

  it("does not backfill the privacy column — a false value is a deliberate choice", () => {
    const sql = stripComments(readMigration(PRIVACY_MIGRATION));
    expect(sql).not.toMatch(/UPDATE\s+profiles/i);
    expect(sql).not.toMatch(/DELETE\s+FROM\s+profiles/i);
  });

  it("no migration after 032 flips an explicitly-private athlete back to visible", () => {
    // 032 is the one historical blanket backfill, and it predates the opt-out
    // ever being reachable in the UI. Anything newer that writes this column
    // en masse would un-private real people.
    const offenders = migrationFiles()
      .filter((file) => migrationNumber(file) > 32)
      .filter((file) => {
        const sql = stripComments(readMigration(file));
        return /UPDATE\s+profiles[\s\S]*share_activities_with_friends/i.test(sql);
      });

    expect(offenders).toEqual([]);
  });

  it("keeps the column NOT NULL with a true default, so a new row is never ambiguously private", () => {
    const sql = stripComments(readMigration("031_social_activity_feed.sql"));
    expect(sql).toMatch(
      /share_activities_with_friends BOOLEAN NOT NULL DEFAULT true/i
    );
  });

  it("never gates a profile read on the sharing flag — the owner must always reach their own switch", () => {
    // The failure mode this guards is the one that would make the reported bug
    // unfixable: a SELECT policy on `profiles` of the shape
    // `USING (share_activities_with_friends = true)` locks a private athlete
    // out of reading the row that holds the switch they used to go private,
    // and Settings then cannot load. Privacy decides who may see an athlete,
    // never what that athlete may see.
    const offenders = migrationFiles().filter((file) => {
      const sql = stripComments(readMigration(file));
      return /CREATE\s+POLICY[\s\S]{0,400}?ON\s+(public\.)?profiles[\s\S]{0,400}?share_activities_with_friends/i.test(
        sql
      );
    });

    expect(offenders).toEqual([]);
  });

  it("re-asserts the activities SELECT policy, without which no feed can ever return a row", () => {
    // "Users manage own activities" (001) is owner-only. If 031's
    // "Friends view shared activities" is missing, every friend-feed query
    // comes back empty under RLS with no error to explain it.
    const sql = stripComments(readMigration(PRIVACY_MIGRATION));
    expect(sql).toMatch(/CREATE POLICY "Friends view shared activities" ON activities FOR SELECT/i);
    expect(sql).toMatch(/activity_is_visible_to\(id, auth\.uid\(\)\)/);
  });

  it("survives being applied twice, and on a database that missed 031", () => {
    // It is renumbered from 046, so a database that did take it as 046 gets it
    // again as 049 — every statement in it has to be replayable.
    const sql = stripComments(readMigration(PRIVACY_MIGRATION));
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS share_activities_with_friends/i);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION activity_is_visible_to/i);
    // The policy is created only when absent — a bare CREATE POLICY would
    // raise 42710 on the second run and abort the whole push.
    expect(sql).toMatch(/IF NOT EXISTS \(\s*SELECT 1 FROM pg_policies/i);
  });
});

describe("migration numbering", () => {
  /**
   * `supabase_migrations.schema_migrations.version` is a PRIMARY KEY, and the
   * version is the leading number of the filename. Two migrations sharing a
   * number means `supabase db push` either aborts on the duplicate key or
   * counts the version as already applied and silently skips the second file —
   * so one of them never reaches any database.
   *
   * This is not hypothetical: the private-account fix shipped as a second
   * `046_`, lost the race to `046_hpe_safety_capped_outcome.sql` (which sorts
   * first), and was reported as still broken because the migration behind the
   * fix had never run.
   */
  it("gives every migration a unique number", () => {
    const byNumber = new Map<string, string[]>();
    for (const file of migrationFiles()) {
      // 002 and 002b are a deliberate pair — 002b is the idempotent remainder
      // of 002 for databases created between 001 and 002, and is applied by
      // hand from the SQL editor rather than by `db push`.
      const version = file.slice(0, file.indexOf("_"));
      byNumber.set(version, [...(byNumber.get(version) ?? []), file]);
    }

    const duplicates = [...byNumber.entries()].filter(([, files]) => files.length > 1);

    expect(duplicates).toEqual([]);
  });
});
