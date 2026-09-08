import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { stripSqlComments } from "@/lib/testing/source-scan";

/**
 * A recreated view must REVOKE, not merely GRANT.
 *
 * THE SAME DEFAULT, A THIRD TIME. `function-grants.test.ts` documents the
 * function half: a Supabase project bootstraps with
 *
 *   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, ...
 *
 * so a new function is granted to `anon` by name and a revoke aimed at PUBLIC
 * leaves that standing. There is a second line in that bootstrap for TABLES,
 * which covers views, and it does exactly the same thing.
 *
 * 061 wrote three statements per view — revoke from anon, revoke from
 * authenticated, grant to authenticated. 064 recreated two of those views and
 * restated only the grant. That reads like the careful thing and is the
 * opposite: the grant adds nothing the default had not already given, and the
 * missing revoke is the whole of the access control. `leaderboard_profiles`
 * was readable with the public anon key — username, avatar, injury_status,
 * all three indices, age band, weight band, sex — until 071.
 *
 * I wrote 064 having already found the function half twice that day, and did
 * not carry it across. So this is the check rather than the knowledge.
 *
 * Asserted against the migration that LAST defines each view, because that is
 * the one whose grants the database is running. Checking 061 forever would
 * only ever prove that 061 was careful.
 */

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const MIGRATIONS_DIR = join(ROOT, "supabase/migrations");

/** The single view anon is meant to reach: the logged-out profile page needs it. */
const ANON_READABLE = "public_profiles";

const PROJECTIONS = [
  "public_profiles",
  "leaderboard_profiles",
  "public_strength_scores",
  "public_workout_scores",
  "public_index_history",
  "public_leaderboard_entries",
];

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
}

function sqlOf(file: string): string {
  return stripSqlComments(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
}

/** The migration that last runs `CREATE VIEW <view>`. */
function lastDefinerOf(view: string): string {
  const defining = migrationFiles().filter((f) =>
    new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?VIEW\\s+(?:public\\.)?${view}\\b`, "i").test(sqlOf(f))
  );
  const last = defining[defining.length - 1];
  if (!last) throw new Error(`No migration defines ${view}`);
  return last;
}

/** Every migration from the one that last defines `view` onwards. */
function sqlFromDefinitionOnwards(view: string): string {
  const from = lastDefinerOf(view);
  return migrationFiles()
    .filter((f) => f >= from)
    .map(sqlOf)
    .join("\n");
}

describe("a view that has been recreated", () => {
  it("revokes from anon rather than trusting a narrow grant", () => {
    const exposed: string[] = [];

    for (const view of PROJECTIONS) {
      if (view === ANON_READABLE) continue;
      const sql = sqlFromDefinitionOnwards(view);
      const revoked = new RegExp(
        `REVOKE\\s+(?:ALL|SELECT)[^;]*\\bON\\s+(?:public\\.)?${view}\\b[^;]*\\banon\\b`,
        "i"
      ).test(sql);
      if (!revoked) exposed.push(view);
    }

    // Named, because the name is what is readable with a key that ships in the
    // client bundle.
    expect(exposed).toEqual([]);
  });

  it("never hands one of them back to anon afterwards", () => {
    const handedBack: string[] = [];
    for (const view of PROJECTIONS) {
      if (view === ANON_READABLE) continue;
      // A GRANT naming anon, anywhere from the definition onwards, undoes it.
      if (
        new RegExp(`GRANT[^;]*\\bON\\s+(?:public\\.)?${view}\\b[^;]*\\banon\\b`, "i").test(
          sqlFromDefinitionOnwards(view)
        )
      ) {
        handedBack.push(view);
      }
    }
    expect(handedBack).toEqual([]);
  });

  it("keeps the one view the logged-out profile page needs", () => {
    // The rule is "exactly one", not "none". Closing this one would break
    // /social/profile/[username] for visitors, which is a real feature and not
    // an oversight.
    expect(
      new RegExp(`GRANT SELECT ON ${ANON_READABLE} TO[^;]*anon`, "i").test(
        sqlFromDefinitionOnwards(ANON_READABLE)
      ),
      `${ANON_READABLE} is no longer readable by anon — the logged-out profile page needs it`
    ).toBe(true);
  });

  it("restates the grant it dropped, for every projection", () => {
    // DROP VIEW discards grants. A recreated view with no GRANT is invisible to
    // the app rather than over-exposed — the other failure direction, and the
    // one that looks like a data problem instead of a permissions one.
    for (const view of PROJECTIONS) {
      expect(
        new RegExp(`GRANT SELECT ON ${view} TO`, "i").test(sqlFromDefinitionOnwards(view)),
        `${view} is recreated without restating its grant`
      ).toBe(true);
    }
  });
});
