import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
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

const MIGRATION = readFileSync(
  join(process.cwd(), "supabase/migrations/059_provisional_index_history.sql"),
  "utf8"
);

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
    const orderBy = MIGRATION.match(
      /ORDER BY h\.is_provisional ASC, h\.recorded_at DESC NULLS LAST, h\.id DESC/
    );
    expect(orderBy).not.toBeNull();
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
