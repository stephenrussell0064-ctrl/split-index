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
 *      caller) can read another athlete's activities, and
 *   2. adding another blanket backfill that flips deliberate opt-outs back
 *      to visible — migration 032 did exactly that once, which was only
 *      harmless because no athlete could have opted out yet.
 */

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
    const sql = stripComments(readMigration("046_private_account_visibility.sql"));
    expect(sql).toMatch(/ALTER COLUMN share_activities_with_friends SET DEFAULT true/i);
  });

  describe("activity_is_visible_to() — the enforcement predicate", () => {
    const predicate = stripComments(
      readMigration("046_private_account_visibility.sql")
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
    const sql = stripComments(readMigration("046_private_account_visibility.sql"));
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
});
