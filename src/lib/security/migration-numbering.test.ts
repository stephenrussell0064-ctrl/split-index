import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * No two migrations may share a number.
 *
 * WHY THIS IS A SECURITY TEST AND NOT REPO TIDINESS
 * --------------------------------------------------
 * A duplicated number is how a migration that has already been superseded gets
 * applied a second time, after the thing that superseded it.
 *
 * Measured on the day this was written: FIVE of the seven unmerged branches
 * carried numbers that collide with main, because main renumbered 057-061 when
 * the hardening work landed and those branches predate it. On one of them —
 * `venture/b1-b2-iap-routing`, the branch carrying App Store IAP routing and so
 * the one most likely to be merged in a hurry — the collision at 061 is an
 * early variant of `display_name_is_never_an_email` that:
 *
 *   * rebuilds `public_profiles` and `leaderboard_profiles` with NO
 *     `email_confirmed_at IS NOT NULL` clause, and
 *   * masks display_name in one of the two views instead of both.
 *
 * That branch orders it AFTER its own `058_require_verified_email`. So applying
 * that branch's migrations in order would rebuild both public views and drop
 * the verified-email gate that had just been added, re-exposing unverified
 * accounts, and leave `leaderboard_profiles.display_name` unmasked — the column
 * that held athletes' email addresses.
 *
 * Nothing detects that at merge time. Git merges two differently-named files
 * without a conflict; only the NUMBER collides, and numbers are not something
 * git knows about. This test is the thing that notices.
 *
 * It also catches the milder version, which has already happened twice here:
 * two sessions independently writing 062, and a rename that briefly left a
 * migration without its descriptive suffix.
 */

const MIGRATIONS = fileURLToPath(
  new URL("../../../supabase/migrations", import.meta.url)
);

/*
  A letter suffix is legitimate and already in use: `002b_apply_missing.sql`
  lands after 002 without claiming 003. It counts as its own number for the
  duplicate check below ("002b" != "002"), which is the behaviour we want.
*/
const FILENAME = /^\d{3}[a-z]?_[a-z0-9_]+\.sql$/;

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

describe("the migration directory", () => {
  it("gives every migration its own number", () => {
    const byNumber = new Map<string, string[]>();
    for (const file of migrationFiles()) {
      const number = file.slice(0, file.indexOf("_"));
      byNumber.set(number, [...(byNumber.get(number) ?? []), file]);
    }

    const collisions = [...byNumber.entries()]
      .filter(([, files]) => files.length > 1)
      .map(([number, files]) => `${number}: ${files.join(" AND ")}`);

    // Named in the failure rather than counted, because the fix depends on
    // which two files collided — one may already be applied in production.
    expect(collisions).toEqual([]);
  });

  it("names every migration <number>_<description>.sql", () => {
    // A file that loses its suffix sorts and applies the same but tells the
    // next reader nothing, and is easy to mistake for a duplicate.
    const malformed = migrationFiles().filter((f) => !FILENAME.test(f));
    expect(malformed).toEqual([]);
  });

  it("leaves no gaps, so an absent number means a deleted migration", () => {
    /*
      A gap is not automatically wrong — a number can be abandoned before it
      ever lands. But it is worth seeing, because the usual cause is a
      migration that was renamed or dropped after being applied somewhere, and
      that is exactly the state this file exists to make visible.
    */
    const numbers = migrationFiles()
      .map((f) => Number(f.slice(0, f.indexOf("_"))))
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b);

    const gaps: number[] = [];
    for (let i = 1; i < numbers.length; i++) {
      for (let missing = numbers[i - 1]! + 1; missing < numbers[i]!; missing++) {
        gaps.push(missing);
      }
    }
    expect(gaps).toEqual([]);
  });
});
