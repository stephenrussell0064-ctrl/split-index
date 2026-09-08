import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * THE SIGNUP ESTIMATE MUST NOT OUTRANK REAL TRAINING.
 *
 * Onboarding calibration writes one `split_index_history` row from
 * self-reported bests. It has no `activity_id`, so nothing in the application
 * could ever find it again — every other writer of that table deletes and
 * re-inserts BY activity_id — and it is stamped with signup time, while every
 * real session carries its own (usually back-dated) activity date. Migration
 * 054's trigger picks the newest row by date and copies it onto
 * `profiles.current_*_index`, which is what the leaderboard and every rank
 * badge read.
 *
 * So the athlete who signs up and then logs the training they have already been
 * doing — the ordinary path for a new user, and every one of those sessions is
 * back-dated — kept the signup guess as their public index for ever.
 *
 * This is asserted against the migration SQL rather than a live database
 * because the ordering IS the fix, and it is the sort of line that gets
 * "tidied" by someone who does not know why the extra term is there. The
 * repair statements are checked for the same reason: without them, everyone
 * already pinned stays pinned.
 */

/*
 * Migrations are resolved by what they contain, never named.
 *
 * A hardcoded filename is the failure mode migration-supersession.test.ts
 * exists to catch: the moment a later migration supersedes the one named here,
 * this test carries on asserting against SQL the database no longer runs, and
 * it goes quiet rather than failing. That already happened once to
 * leaderboard-brackets.test.ts, and it nearly happened here — 070 redefines the
 * trigger and was first drafted without 059's `is_provisional` ordering.
 */
const MIGRATIONS_DIR = join(process.cwd(), "supabase/migrations");

function migrationsSorted(): string[] {
  return readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
}

/** The LAST migration matching `pattern` — later files supersede earlier ones. */
function latestMigrationMatching(pattern: RegExp, what: string): string {
  const hit = migrationsSorted()
    .filter((f) => pattern.test(readFileSync(join(MIGRATIONS_DIR, f), "utf8")))
    .pop();
  if (!hit) throw new Error(`No migration ${what} — has it been renamed?`);
  return readFileSync(join(MIGRATIONS_DIR, hit), "utf8");
}

/** The one-time column add, backfill and repair — not a definition, so not superseded. */
const MIGRATION = latestMigrationMatching(
  /ADD COLUMN IF NOT EXISTS is_provisional/i,
  "adds split_index_history.is_provisional",
);

/*
 * The trigger function is resolved, not named.
 *
 * 059 introduced the `is_provisional ASC` ordering, but 070 redefines the whole
 * function to make account deletion work, and the last CREATE OR REPLACE is
 * what actually runs. Asserting the ordering against 059 would keep passing
 * while the live definition lost the term — which nearly happened: 070 was
 * first drafted from 054's body, silently dropping it.
 *
 * Resolving the latest definition is the same pattern leaderboard-brackets.test.ts
 * uses, and for the same reason migration-supersession.test.ts exists: a test
 * that hardcodes a migration filename goes quiet the moment a later one
 * supersedes it, rather than failing.
 */
function latestFunctionDefinition(fn: string): string {
  return latestMigrationMatching(
    new RegExp(`CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+(?:public\\.)?${fn}\\b`, "i"),
    `defines ${fn}`,
  );
}

const LIVE_TRIGGER = latestFunctionDefinition("sync_profile_current_index");

describe("migration 059 — the estimate is ranked below every scored session", () => {
  it("adds the column that makes the estimate findable at all", () => {
    expect(MIGRATION).toMatch(/ALTER TABLE split_index_history\s+ADD COLUMN IF NOT EXISTS is_provisional BOOLEAN/i);
  });

  it("marks the rows already in the table", () => {
    // Existing calibration rows predate the column and would otherwise default
    // to FALSE — i.e. keep outranking real sessions, which is the bug.
    expect(MIGRATION).toMatch(
      /UPDATE split_index_history SET is_provisional = TRUE WHERE activity_id IS NULL/i
    );
  });

  it("orders provisional rows last in the trigger, ahead of the date term", () => {
    /*
      `is_provisional ASC` must come FIRST in the ORDER BY. Putting it after
      `recorded_at DESC` would sort by date first and change nothing at all —
      which is exactly the shape of edit someone makes while "cleaning up" an
      ordering they do not have the context for.
    */
    const orderBy = LIVE_TRIGGER.match(
      /ORDER BY h\.is_provisional ASC, h\.recorded_at DESC NULLS LAST, h\.id DESC/
    );
    expect(orderBy).not.toBeNull();
  });

  it("still skips the sync when the athlete is being deleted", () => {
    // The guard added by 070. Without it a single history row makes account
    // deletion fail outright, because the trigger updates a profiles row the
    // same cascade is deleting — Guideline 5.1.1(v) territory.
    expect(LIVE_TRIGGER).toMatch(
      /NOT EXISTS \(SELECT 1 FROM auth\.users u WHERE u\.id = target_user\)/
    );
  });

  it("re-syncs profiles with the corrected ordering, not the old one", () => {
    // The trigger only fires on write. Everyone already pinned to their signup
    // estimate stays pinned until something recomputes them.
    expect(MIGRATION).toMatch(
      /ORDER BY sh\.is_provisional ASC, sh\.recorded_at DESC NULLS LAST, sh\.id DESC/
    );
  });

  it("clears estimates that a real session has already superseded", () => {
    // Ranking stops the estimate deciding the headline number; deleting it
    // stops it sitting on the trend chart as a fabricated data point.
    expect(MIGRATION).toMatch(/DELETE FROM split_index_history h\s+WHERE h\.is_provisional/i);
  });
});

describe("the application clears the estimate when real training arrives", () => {
  const sources = [
    "src/app/api/activities/route.ts",
    "src/lib/activities/score-and-persist.ts",
  ];

  it.each(sources)("%s clears it after writing a real history row", (path) => {
    const source = readFileSync(join(process.cwd(), path), "utf8");
    expect(source).toContain("clearProvisionalIndexHistory");
  });

  it("calibration writes it flagged, and replaces rather than stacks", () => {
    const source = readFileSync(
      join(process.cwd(), "src/app/api/onboarding/calibrate/route.ts"),
      "utf8"
    );
    // Flagged on the way in…
    expect(source).toContain("is_provisional: true");
    // …and the previous one removed first, or re-running calibration piles up
    // rows nothing can delete.
    expect(source).toMatch(/\.delete\(\)[\s\S]{0,120}is_provisional", true\)/);
  });
});
