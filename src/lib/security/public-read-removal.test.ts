import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { stripComments, stripSqlComments, walkSource } from "@/lib/testing/source-scan";

/**
 * Nothing reads an athlete's row out of a base table across accounts.
 *
 * WHY THIS IS A TEST AND NOT A NOTE. 056 removed the policies that let any
 * caller — the anon role included — read any profile with a username, along
 * with the matching policies on four other tables. It was never applied. The
 * projections it introduced DID arrive, because 061 and 064 recreate them, so
 * for months the app looked like it was reading through curated views while
 * `profiles` sat open behind them: every row, every column, including
 * date_of_birth, weight_kg, height_cm, gender, max_hr, resting_hr,
 * injury_status and stripe_customer_id, to anyone holding the key that ships
 * in the client bundle. Measured through PostgREST, not inferred.
 *
 * 073 applies the removal. The risk of applying it is the opposite failure —
 * a legitimate cross-athlete read that quietly starts returning nothing —
 * so every such read was enumerated one at a time before writing it, and this
 * is that enumeration, kept.
 *
 * The rule: a read of one of these tables through a USER-scoped client must be
 * scoped to the caller, or be listed below with the reason it is safe.
 */

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const SRC = join(ROOT, "src");
const MIGRATIONS_DIR = join(ROOT, "supabase/migrations");

/** The tables whose public-read policies 073 removes. */
const OWNER_ONLY_TABLES = [
  "profiles",
  "workout_scores",
  "split_index_history",
  "strength_scores",
  "challenge_participants",
  "leaderboard_entries",
];

const LEGACY_PUBLIC_POLICIES = [
  "Public profiles readable",
  "Public leaderboard strength scores",
  "Public leaderboard scores",
  "Public leaderboard index",
  "Public challenge progress",
  "Anyone can view leaderboards",
];

/**
 * Unscoped reads that are safe, each checked by hand.
 *
 * Two kinds only. The service-role client bypasses RLS entirely, so a cron job
 * is unaffected by any policy. And a read filtered by `activity_id` reaches
 * only rows attached to an activity the caller already owns, which the owner
 * policies still allow — those policies are not what 073 touches.
 */
const ALLOWED_UNSCOPED: Record<string, string> = {
  "/app/api/cron/hybrid-reports/route.ts": "service role — RLS does not apply",
  "/app/api/cron/leaderboard/route.ts": "service role — RLS does not apply",
  "/app/(app)/activities/[id]/page.tsx": "filtered by activity_id, an activity the caller owns",
  "/app/api/activities/[id]/route.ts": "filtered by activity_id, an activity the caller owns",
  "/lib/activities/logbook-query.ts": "filtered by the caller's own activity ids",
};

interface Read {
  file: string;
  table: string;
  scoped: boolean;
}

function baseTableReads(): Read[] {
  const reads: Read[] = [];
  for (const path of walkSource(SRC)) {
    if (/\.test\.tsx?$/.test(path)) continue;
    const code = stripComments(readFileSync(path, "utf8"));
    const file = path.slice(SRC.length).replace(/\\/g, "/");
    const pattern = new RegExp(`\\.from\\("(${OWNER_ONLY_TABLES.join("|")})"\\)`, "g");
    for (const match of code.matchAll(pattern)) {
      const chain = code.slice(match.index).split(";")[0]!;
      if (/\.(insert|update|upsert|delete)\(/.test(chain)) continue; // writes have their own policies
      const scoped =
        /\.eq\(\s*"(user_id|id)"\s*,\s*(user\.id|userId|session\.user\.id|authUser\.id|viewerUserId|targetUserId)/.test(
          chain
        );
      reads.push({ file, table: match[1]!, scoped });
    }
  }
  return reads;
}

describe("reads of the tables 073 closes", () => {
  it("are scoped to the caller, or listed with a reason", () => {
    const unexplained = baseTableReads()
      .filter((r) => !r.scoped && !ALLOWED_UNSCOPED[r.file])
      .map((r) => `${r.file} reads ${r.table} across accounts`);

    // Named, because each one is either a privacy hole while the old policies
    // stand or a feature that breaks the moment they are dropped — and which
    // of the two it is depends on the query, so a person has to look.
    expect(unexplained).toEqual([]);
  });

  it("still finds reads to check", () => {
    // A pattern that stops matching reports a clean tree forever.
    expect(baseTableReads().length).toBeGreaterThan(20);
  });

  it("keeps the two routes that were moved onto views", () => {
    /*
      The two that would otherwise have broken, pinned so neither drifts back.
      They go to DIFFERENT views on purpose: a friend lookup should not find an
      account that cannot receive mail, while a uniqueness check has to see
      every account or it reports a taken name as free and the save fails on a
      constraint the athlete cannot do anything about.
    */
    const friends = readFileSync(join(SRC, "app/api/friends/route.ts"), "utf8");
    expect(friends).toContain('.from("public_profiles")');
    expect(friends).not.toContain('.from("profiles")');

    const check = readFileSync(join(SRC, "app/api/profile/username-check/route.ts"), "utf8");
    expect(check).toContain('.from("profile_usernames")');
    expect(check).not.toContain('.from("profiles")');
  });
});

describe("the migration that removes public read", () => {
  const sql = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => stripSqlComments(readFileSync(join(MIGRATIONS_DIR, f), "utf8")))
    .join("\n");

  it("drops every policy 056 named", () => {
    for (const policy of LEGACY_PUBLIC_POLICIES) {
      expect(sql, `"${policy}" is never dropped`).toMatch(
        new RegExp(`DROP POLICY IF EXISTS "${policy}"`, "i")
      );
    }
  });

  it("does not put any of them back", () => {
    for (const policy of LEGACY_PUBLIC_POLICIES) {
      expect(
        new RegExp(`CREATE POLICY "${policy}"`, "i").test(
          // Only what runs after the drop matters; 001 and 053 legitimately
          // created these before 056 removed them.
          readdirSync(MIGRATIONS_DIR)
            .filter((f) => f.endsWith(".sql") && f >= "056")
            .map((f) => stripSqlComments(readFileSync(join(MIGRATIONS_DIR, f), "utf8")))
            .join("\n")
        ),
        `"${policy}" is recreated after 056`
      ).toBe(false);
    }
  });

  it("gives the uniqueness check a view that sees unverified accounts too", () => {
    // The reason profile_usernames exists rather than reusing public_profiles.
    expect(sql).toMatch(/CREATE VIEW profile_usernames/i);
    expect(sql).not.toMatch(/CREATE VIEW profile_usernames[\s\S]{0,400}email_confirmed_at/i);
  });
});
