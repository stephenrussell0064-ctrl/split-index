import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { stripSqlComments } from "@/lib/testing/source-scan";

/**
 * A migration that drops a view with CASCADE must put back everything CASCADE
 * took with it.
 *
 * THIS HAPPENED, AND IT REACHED PRODUCTION. 064 rebuilt `public_profiles` to
 * stop `display_name` publishing an email address, and opened the way every
 * view rebuild in this repository opens:
 *
 *   DROP VIEW IF EXISTS public_profiles CASCADE;
 *
 * CASCADE is necessary there — two views depend on that one — and it does
 * exactly what it says. `public_strength_scores`, `public_workout_scores`,
 * `public_index_history` and `public_leaderboard_entries` each carry
 * `WHERE EXISTS (SELECT 1 FROM public_profiles pp ...)`, so all four went with
 * it. 064 recreated the two views it was rewriting and not the four it took
 * down on the way past.
 *
 * NOTHING SAID SO. Postgres reports a cascaded drop as a NOTICE, the migration
 * applied cleanly, `npx next build` does not query a database, and every test
 * that reads these views reads their SQL rather than asking whether they
 * exist. The whole social surface — the feed, both leaderboards, the dimension
 * leaderboards, the index-history comparison — reads these four and nothing
 * else provides them. It was found by widening an unrelated guard, and
 * confirmed against production, which answered PGRST205 "Could not find the
 * table" for all four.
 *
 * The rule is mechanical and so is the check: if a migration drops V with
 * CASCADE, every view that referenced V has to be created again in that same
 * migration. Restoring them in a LATER migration is not enough for this test
 * to pass, and should not be — between the two, the views do not exist.
 */

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const MIGRATIONS_DIR = join(ROOT, "supabase/migrations");

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
}

function sqlOf(file: string): string {
  return stripSqlComments(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
}

/** `CREATE VIEW x (...) AS ...;` — name mapped to the body, per migration. */
function viewsDefinedIn(file: string): Map<string, string> {
  const sql = sqlOf(file);
  const out = new Map<string, string>();
  for (const match of sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+(?:public\.)?([a-z_][a-z0-9_]*)/gi)) {
    const name = match[1]!.toLowerCase();
    out.set(name, sql.slice(match.index).split(";")[0]!);
  }
  return out;
}

/** Views dropped with CASCADE by this migration. */
function cascadeDropsIn(file: string): string[] {
  return [
    ...sqlOf(file).matchAll(
      /DROP\s+VIEW\s+(?:IF\s+EXISTS\s+)?(?:public\.)?([a-z_][a-z0-9_]*)[^;]*\bCASCADE\b/gi
    ),
  ].map((m) => m[1]!.toLowerCase());
}

/**
 * Already applied, already remediated, and NOT rewritten.
 *
 * 064 is in every database that has run it. Editing an applied migration to
 * make a test pass would leave this repository describing a history no
 * database has, which is a worse problem than the one it tidies away. So the
 * defect stays in 064, the repair is 070, and the exception is recorded here
 * with the migration that repairs it — asserted below, so this entry cannot
 * outlive its fix or be used to wave through a repair that was never written.
 *
 * A NEW migration doing the same thing gets no such entry. The rule for
 * anything written from now on is the strict one: recreate what you cascade,
 * in the same migration, because between two migrations the views do not
 * exist.
 */
const REMEDIATED: Record<string, { restoredBy: string; views: string[] }> = {
  "064_display_name_is_never_an_email.sql": {
    restoredBy: "071_restore_score_projections.sql",
    views: [
      "public_strength_scores",
      "public_workout_scores",
      "public_index_history",
      "public_leaderboard_entries",
    ],
  },
};

describe("a cascaded drop", () => {
  it("recreates every view it takes down with it", () => {
    const files = migrationFiles();
    const broken: string[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i]!;
      const dropped = cascadeDropsIn(file);
      if (dropped.length === 0) continue;

      // The view definitions as they stood immediately BEFORE this migration:
      // last definition wins, exactly as the database has them.
      const before = new Map<string, string>();
      for (const earlier of files.slice(0, i)) {
        for (const [name, body] of viewsDefinedIn(earlier)) before.set(name, body);
      }

      const recreated = new Set(viewsDefinedIn(file).keys());

      for (const target of dropped) {
        for (const [name, body] of before) {
          if (name === target || recreated.has(name)) continue;
          // A dependent view is one whose own definition selects from the
          // dropped one. CASCADE removes it without further warning.
          if (!new RegExp(`\\b${target}\\b`, "i").test(body)) continue;
          if (REMEDIATED[file]?.views.includes(name)) continue;
          broken.push(
            `${file} drops ${target} CASCADE, which also drops ${name} — and does not recreate it`
          );
        }
      }
    }

    // Named, because the name is the outage: it says which view is missing from
    // the database and therefore which part of the app is answering nothing.
    expect(broken).toEqual([]);
  });

  it("repairs every drop it excuses", () => {
    /*
      The exception above is only tolerable while the repair exists. If 070 is
      ever removed, renamed, or written without one of the four, this says so
      rather than letting a recorded outage quietly become an unrecorded one.
    */
    for (const [file, { restoredBy, views }] of Object.entries(REMEDIATED)) {
      expect(migrationFiles(), `${file} names a repair that does not exist`).toContain(restoredBy);
      const recreated = viewsDefinedIn(restoredBy);
      for (const view of views) {
        expect(recreated.has(view), `${restoredBy} does not recreate ${view}`).toBe(true);
      }
      // And after the repair, nothing else drops them again.
      const after = migrationFiles().filter((f) => f > restoredBy);
      for (const later of after) {
        for (const dropped of cascadeDropsIn(later)) {
          expect(views, `${later} drops ${dropped} again`).not.toContain(dropped);
        }
      }
    }
  });

  it("still finds the cascaded drops it is checking", () => {
    /*
      The silent-pass failure mode for a scanner like this one. If the DROP
      pattern stops matching, there is nothing to check, nothing to report, and
      a permanently green test. There are real CASCADE drops in this tree — a
      zero here means the pattern is broken, not that the migrations changed.
    */
    const withCascade = migrationFiles().filter((f) => cascadeDropsIn(f).length > 0);
    expect(withCascade.length).toBeGreaterThan(0);
  });

  it("knows which views depend on public_profiles", () => {
    // The specific dependency that caused the outage, pinned so a refactor
    // that stops these four deriving from public_profiles has to come here and
    // say so — that derivation is also what carries the email-verification
    // gate into all four.
    const files = migrationFiles();
    const live = new Map<string, string>();
    for (const f of files) for (const [n, b] of viewsDefinedIn(f)) live.set(n, b);

    for (const view of [
      "public_strength_scores",
      "public_workout_scores",
      "public_index_history",
      "public_leaderboard_entries",
    ]) {
      expect(live.get(view), `${view} is not defined by any migration`).toBeDefined();
      expect(live.get(view), `${view} no longer derives from public_profiles`).toMatch(
        /\bpublic_profiles\b/
      );
    }
  });
});
