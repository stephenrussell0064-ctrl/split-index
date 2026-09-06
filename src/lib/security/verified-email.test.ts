import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SUPABASE_AUTH_RATE_LIMITS } from "./config";

/**
 * WP13 — authentication hardening, for the parts that live in this repository.
 *
 * BE CLEAR ABOUT WHAT CANNOT BE TESTED HERE, because the brief's acceptance
 * list reads as though it all can.
 *
 * "Expired session rejected", "refresh rotation", "token revoked after logout",
 * "reset token reuse rejected", "OTP reuse rejected" are all GoTrue behaviours.
 * Split Index does not implement any of them: `createBrowserClient` calls
 * Supabase directly and this application never sees the credential, the token,
 * or the refresh. There is no code here to unit test, and a test that mocked
 * Supabase and asserted the mock behaved would be theatre — it would pass just
 * as happily if the real settings were wrong.
 *
 * Those need an integration test against a live project, which is an open
 * finding rather than a thing quietly skipped. What IS testable here:
 *
 *   * the verification requirement, which is ours, in RLS (migration 058)
 *   * the OAuth callback establishing a session, which is our route
 *   * the auth limits being written down rather than living only in a dashboard
 */

const MIGRATIONS = fileURLToPath(new URL("../../../supabase/migrations", import.meta.url));

function migration(name: string): string {
  return readFileSync(`${MIGRATIONS}/${name}`, "utf8")
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");
}

const SQL = migration("058_require_verified_email.sql");

describe("an unverified account cannot log a session", () => {
  /**
   * The requirement has to be RESTRICTIVE. Postgres ORs permissive policies
   * together, so a second permissive policy would WIDEN access — a mistake
   * that would look exactly like this migration and do the opposite of it.
   */
  it.each(["activities", "gym_exercises", "workout_scores"])(
    "adds a RESTRICTIVE insert policy on %s",
    (table) => {
      const policy = new RegExp(
        `CREATE POLICY "[^"]+" ON ${table}\\s+AS RESTRICTIVE\\s+FOR INSERT\\s+TO authenticated\\s+WITH CHECK \\(public\\.caller_email_verified\\(\\)\\)`,
        "i"
      );
      expect(SQL).toMatch(policy);
    }
  );

  it("constrains INSERT only, so an athlete never loses their own history", () => {
    // Losing access to your training log because of a mail-server problem
    // would be a far worse bug than the one being fixed.
    for (const verb of ["FOR SELECT", "FOR UPDATE", "FOR DELETE", "FOR ALL"]) {
      expect(
        new RegExp(`AS RESTRICTIVE\\s+${verb}`, "i").test(SQL),
        `a RESTRICTIVE ${verb} policy would lock athletes out of their own rows`
      ).toBe(false);
    }
  });

  it("checks the caller and cannot be asked about anybody else", () => {
    // Same rule as activity_is_visible_to() in 049 and
    // withdraw_article9_health_data() in 057: a SECURITY DEFINER function that
    // accepts a user id answers questions about other people's accounts, which
    // is the enumeration oracle WP5 closed on the sign-in path.
    expect(SQL).toMatch(/FUNCTION public\.caller_email_verified\(\)/);
    expect(SQL).not.toMatch(/FUNCTION public\.caller_email_verified\(\s*[a-z_]+\s+UUID/i);
    expect(SQL).toMatch(/u\.id = auth\.uid\(\)/);
  });

  it("is granted to authenticated and revoked from everyone else", () => {
    expect(SQL).toMatch(/REVOKE ALL ON FUNCTION public\.caller_email_verified\(\) FROM PUBLIC/i);
    expect(SQL).toMatch(/GRANT EXECUTE ON FUNCTION public\.caller_email_verified\(\) TO authenticated/i);
  });
});

describe("an unverified account does not appear in public", () => {
  it("gates every public projection on a confirmed address", () => {
    // An unverified account on a public list is a spam vector, and a way to
    // occupy a username without proving you can receive mail at the address.
    const profileViews = SQL.split(/CREATE VIEW (public_profiles|leaderboard_profiles)\b/);
    expect(profileViews.length).toBeGreaterThan(2);

    for (const view of ["public_profiles", "leaderboard_profiles"]) {
      const body = SQL.split(new RegExp(`CREATE VIEW ${view}\\b`))[1] ?? "";
      const definition = body.split(";")[0];
      expect(definition, `${view} does not join auth.users`).toMatch(/JOIN auth\.users u ON u\.id = p\.user_id/);
      expect(definition, `${view} does not require a confirmed address`).toMatch(
        /u\.email_confirmed_at IS NOT NULL/
      );
    }
  });

  it("derives the score projections from public_profiles rather than repeating the rule", () => {
    // Repeating `email_confirmed_at IS NOT NULL` in six places is six places to
    // forget it. Deriving means the rule is stated once.
    for (const view of [
      "public_strength_scores",
      "public_workout_scores",
      "public_index_history",
      "public_leaderboard_entries",
    ]) {
      const body = SQL.split(new RegExp(`CREATE VIEW ${view}\\b`))[1] ?? "";
      const definition = body.split(";")[0];
      expect(definition, `${view} does not derive from public_profiles`).toMatch(
        /FROM public_profiles pp WHERE pp\.user_id/
      );
    }
  });

  /**
   * The failure mode of recreating a view: the definition is obviously
   * different and the permissions silently reset to nothing. DROP VIEW discards
   * grants, so every recreated view needs its grant restated or the leaderboard
   * goes blank for everyone.
   */
  it("restates every grant it dropped", () => {
    for (const view of [
      "public_profiles",
      "leaderboard_profiles",
      "public_strength_scores",
      "public_workout_scores",
      "public_index_history",
      "public_leaderboard_entries",
    ]) {
      expect(SQL, `${view} is recreated without a grant`).toMatch(
        new RegExp(`GRANT SELECT ON ${view} TO`, "i")
      );
    }
    // And the anon exposure is still exactly one view.
    expect(SQL).toMatch(/GRANT SELECT ON public_profiles TO anon, authenticated;/);
    for (const view of ["leaderboard_profiles", "public_strength_scores", "public_index_history"]) {
      expect(SQL).toMatch(new RegExp(`REVOKE ALL ON ${view} FROM anon;`, "i"));
    }
  });

  it("keeps security_invoker off, so the views can read auth.users at all", () => {
    // With security_invoker on, the view would re-apply the CALLER's rights —
    // and `authenticated` cannot read auth.users, so every projection would
    // return nothing and the failure would look like a data problem.
    for (const view of [
      "public_profiles",
      "leaderboard_profiles",
      "public_strength_scores",
      "public_workout_scores",
      "public_index_history",
      "public_leaderboard_entries",
    ]) {
      expect(SQL).toMatch(new RegExp(`ALTER VIEW ${view} SET \\(security_invoker = off\\);`, "i"));
    }
  });
});

describe("the migration says how to check it is safe before applying", () => {
  it("carries the impact query and the backfill caveat", () => {
    // This migration can silently stop every athlete logging if
    // email_confirmed_at is not actually populated. A migration that dangerous
    // has to arrive with the query that tells you whether it is.
    const raw = readFileSync(`${MIGRATIONS}/058_require_verified_email.sql`, "utf8");
    expect(raw).toContain("email_confirmed_at IS NULL");
    expect(raw).toMatch(/RUN THIS BEFORE APPLYING/i);
    expect(raw).toMatch(/Do not backfill blindly/i);
  });
});

describe("auth rate limits are written down, not only configured", () => {
  /**
   * These are enforced by GoTrue, not by this app — sign-in and OTP never
   * reach this origin. WP13.5 asks that the two mechanisms be coordinated so
   * they cannot silently disagree, and the way to guarantee that is to have one
   * mechanism. What this repository owes is the record: a number that lives
   * only in a dashboard is a number nobody reviews.
   */
  it("records a value for every auth limit the brief names", () => {
    expect(SUPABASE_AUTH_RATE_LIMITS.signInSignUpPerHourPerIp).toBeGreaterThan(0);
    expect(SUPABASE_AUTH_RATE_LIMITS.otpSendPerHour).toBeGreaterThan(0);
    expect(SUPABASE_AUTH_RATE_LIMITS.otpVerifyAttempts).toBeGreaterThan(0);
    expect(SUPABASE_AUTH_RATE_LIMITS.passwordResetPerHour).toBeGreaterThan(0);
  });

  it("keeps OTP sends tight enough to matter", () => {
    // The brief's RATE_LIMIT_OTP_RESEND_PER_HOUR is 3, per email address. A
    // generous OTP send limit is a way to have somebody else's inbox filled.
    expect(SUPABASE_AUTH_RATE_LIMITS.otpSendPerHour).toBeLessThanOrEqual(5);
    expect(SUPABASE_AUTH_RATE_LIMITS.otpVerifyAttempts).toBeLessThanOrEqual(10);
  });
});

/*
 * A migration-number uniqueness test was written here and then removed. It
 * already exists, correctly, in src/lib/social/activity-visibility.test.ts
 * ("gives every migration a unique number") — the one migration 049's comment
 * points at. The version drafted here also got 002b wrong, treating the
 * deliberate letter suffix as a collision with 002.
 *
 * Recorded rather than silently dropped: the check matters (049 exists because
 * two files shared a number and a privacy fix therefore never reached any
 * database), and the next person to notice it is missing from the security
 * tests should find this note instead of writing a third copy.
 */
