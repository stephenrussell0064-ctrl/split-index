import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * WP1 — what the anon key can read.
 *
 * These assert against the migration SQL rather than the TypeScript, for the
 * same reason activity-visibility.test.ts does: RLS is the enforcement
 * boundary, and a query in application code is a description of what we happen
 * to ask for, not a limit on what anyone else can ask for. Someone holding the
 * public anon key — which is in the client bundle by design — can issue their
 * own PostgREST query against any table whose policy lets them. So the policy
 * is the thing under test.
 *
 * WHAT THESE WOULD HAVE CAUGHT
 * ----------------------------
 * Four policies, live since migrations 001 and 012, returned whole user-owned
 * rows to the anon role:
 *
 *   profiles             USING (username IS NOT NULL)
 *   strength_scores      USING (true)
 *   split_index_history  USING (true)
 *   workout_scores       USING (true)
 *
 * Each was written to power a public leaderboard and each is row-scoped but
 * not column-scoped, because RLS has no column dimension. The result was
 * bodyweight, height, age, sex, Stripe customer ID, per-set bodyweight history
 * and readiness/fatigue scores readable by anyone who opened the network tab.
 *
 * THE RULE THESE ENCODE
 * ---------------------
 * A table with a user_id column is owner-only. Anything another athlete is
 * meant to see reaches them through a view that names its columns, never
 * through a policy on the underlying table. Deliberately public reference data
 * (sports, scoring standards) is allowed a permissive policy and is listed
 * explicitly below, so "checked, deliberately public" is distinguishable from
 * "nobody looked".
 */

const MIGRATIONS_DIR = fileURLToPath(
  new URL("../../../supabase/migrations", import.meta.url)
);

/** SQL with `--` line comments removed, so prose in a comment can't satisfy — or trip — an assertion. */
function stripComments(sql: string): string {
  return sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

/** Every migration concatenated in apply order, comments stripped. */
function allSql(): string {
  return migrationFiles()
    .map((f) => stripComments(readFileSync(`${MIGRATIONS_DIR}/${f}`, "utf8")))
    .join("\n");
}

/**
 * Tables carrying a user_id column, read out of the CREATE TABLE statements
 * rather than hard-coded — a table added later with a user_id is covered by
 * these tests the day it lands, without anyone remembering to add it here.
 */
function userOwnedTables(): Set<string> {
  const sql = allSql();
  const owned = new Set<string>();
  const re = /CREATE TABLE(?:\s+IF NOT EXISTS)?\s+(?:public\.)?([a-z_0-9]+)\s*\(/gi;

  for (const match of sql.matchAll(re)) {
    const table = match[1];
    // Walk to the matching close paren so we read this table's columns only.
    let depth = 0;
    let i = match.index! + match[0].length - 1;
    const start = i;
    for (; i < sql.length; i++) {
      if (sql[i] === "(") depth++;
      else if (sql[i] === ")") {
        depth--;
        if (depth === 0) break;
      }
    }
    if (/^\s*user_id\b/m.test(sql.slice(start + 1, i))) owned.add(table);
  }
  return owned;
}

interface Policy {
  name: string;
  table: string;
  command: string;
  body: string;
}

/**
 * Final policy state after applying every migration in order — CREATE adds,
 * DROP removes, keyed the way Postgres keys them (table + policy name).
 * Reading only the latest migration would miss a policy created in 001 and
 * never dropped, which is exactly the shape of all four findings.
 */
function finalPolicies(): Policy[] {
  const live = new Map<string, Policy>();

  for (const file of migrationFiles()) {
    const sql = stripComments(readFileSync(`${MIGRATIONS_DIR}/${file}`, "utf8"));

    for (const m of sql.matchAll(
      /DROP POLICY(?:\s+IF EXISTS)?\s+"([^"]+)"\s+ON\s+(?:public\.)?([a-z_0-9]+)/gi
    )) {
      live.delete(`${m[2]}::${m[1]}`);
    }

    for (const m of sql.matchAll(
      /CREATE POLICY\s+"([^"]+)"\s+ON\s+(?:public\.)?([a-z_0-9]+)\s+FOR\s+(ALL|SELECT|INSERT|UPDATE|DELETE)([\s\S]*?);/gi
    )) {
      const [, name, table, command, body] = m;
      live.set(`${table}::${name}`, { name, table, command: command.toUpperCase(), body });
    }
  }

  return [...live.values()];
}

/**
 * Deliberately public, with the reason. These hold no user rows: scoring
 * standards, the sport list, achievement and challenge definitions. WP1.2 asks
 * that public data be an explicit permissive policy rather than RLS-off, which
 * is what they are.
 */
const PUBLIC_REFERENCE_TABLES = new Set([
  "sports",
  "reference_values",
  "achievements",
  "challenges",
]);

/**
 * Columns that must never leave the database for anyone but their owner.
 * bodyweight_kg and relative_strength are both here on purpose:
 * relative_strength is estimated_1rm_kg / bodyweight_kg, so publishing it
 * beside estimated_1rm_kg lets anyone divide and recover exact bodyweight.
 * Dropping one and keeping the other would look like a fix and not be one.
 */
const NEVER_PROJECTED = [
  "weight_kg",
  "bodyweight_kg",
  "relative_strength",
  "height_cm",
  "age",
  "date_of_birth",
  "gender",
  "max_hr",
  "resting_hr",
  "fatigue_score",
  "recovery_score",
  "stripe_customer_id",
  "subscription_tier",
  "subscription_status",
  "score_breakdown",
];

/** Output column list of each `CREATE VIEW name (a, b, c) AS` in the migrations. */
function viewColumns(): Map<string, string[]> {
  const views = new Map<string, string[]>();
  const re =
    /CREATE\s+(?:OR REPLACE\s+)?VIEW\s+(?:public\.)?([a-z_0-9]+)\s*\(([^)]*)\)\s*AS/gi;

  for (const m of allSql().matchAll(re)) {
    views.set(
      m[1],
      m[2]
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean)
    );
  }
  return views;
}

describe("WP1 — row level security on user-owned tables", () => {
  it("enables RLS on every table it creates", () => {
    const sql = allSql();
    const created = new Set(
      [...sql.matchAll(/CREATE TABLE(?:\s+IF NOT EXISTS)?\s+(?:public\.)?([a-z_0-9]+)/gi)].map(
        (m) => m[1]
      )
    );
    const enabled = new Set(
      [
        ...sql.matchAll(
          /ALTER TABLE\s+(?:public\.)?([a-z_0-9]+)\s+ENABLE ROW LEVEL SECURITY/gi
        ),
      ].map((m) => m[1])
    );
    const dropped = new Set(
      [...sql.matchAll(/DROP TABLE(?:\s+IF EXISTS)?\s+(?:public\.)?([a-z_0-9]+)/gi)].map(
        (m) => m[1]
      )
    );

    const missing = [...created].filter((t) => !enabled.has(t) && !dropped.has(t));
    expect(missing, `tables created without RLS: ${missing.join(", ")}`).toEqual([]);
  });

  it("never lets a table with a user_id column be read by someone who does not own the row", () => {
    const owned = userOwnedTables();

    const broad = finalPolicies()
      .filter((p) => p.command === "SELECT" || p.command === "ALL")
      .filter((p) => owned.has(p.table))
      .filter((p) => !PUBLIC_REFERENCE_TABLES.has(p.table))
      // A policy that never mentions auth.uid() cannot be scoping to the
      // caller. `USING (true)` and `USING (username IS NOT NULL)` both land
      // here; so does any future policy that forgets the check entirely.
      .filter((p) => !/auth\.uid\(\)/.test(p.body))
      .map((p) => `${p.table}: "${p.name}"`);

    expect(
      broad,
      `these policies expose user-owned rows to anyone holding the anon key — ` +
        `route the data through a column-scoped view instead:\n  ${broad.join("\n  ")}`
    ).toEqual([]);
  });
});

describe("WP1 — the public projections", () => {
  const views = viewColumns();

  it("defines every view the application reads from", () => {
    expect([...views.keys()].sort()).toEqual([
      "leaderboard_profiles",
      "public_challenge_participation",
      "public_index_history",
      "public_leaderboard_entries",
      "public_profiles",
      "public_strength_scores",
      "public_workout_scores",
    ]);
  });

  it("keeps bodyweight, age, sex and billing identifiers out of every projection", () => {
    const leaked: string[] = [];
    for (const [view, columns] of views) {
      for (const column of columns) {
        if (NEVER_PROJECTED.includes(column)) leaked.push(`${view}.${column}`);
      }
    }
    expect(leaked, `columns that must never be projected: ${leaked.join(", ")}`).toEqual([]);
  });

  it("exposes bracket keys as bands, never as the underlying values", () => {
    const cols = views.get("leaderboard_profiles") ?? [];
    // Both granularities the product segments by: coarse for the scope
    // dropdowns, fine for the personal bracket. Neither derives from the other
    // — the coarse 30-39 straddles the fine 25-34 and 35-44 — so both ship.
    expect(cols).toContain("age_bracket");
    expect(cols).toContain("weight_class");
    expect(cols).toContain("age_band");
    expect(cols).toContain("weight_band");
    expect(cols).toContain("sex");
    // What matters is that none of the underlying values comes with them.
    expect(cols).not.toContain("age");
    expect(cols).not.toContain("weight_kg");
    expect(cols).not.toContain("date_of_birth");
  });

  it("gives the anon role the public profile view and nothing else", () => {
    const sql = allSql();

    // The public profile page renders for logged-out visitors, so exactly one
    // view has to reach anon. Every other projection is for signed-in athletes.
    expect(sql).toMatch(/GRANT SELECT ON public_profiles TO anon, authenticated;/i);

    for (const view of [
      "leaderboard_profiles",
      "public_strength_scores",
      "public_workout_scores",
      "public_index_history",
      "public_challenge_participation",
      "public_leaderboard_entries",
    ]) {
      expect(
        sql,
        `${view} must not be readable by anon`
      ).toMatch(new RegExp(`REVOKE ALL ON ${view} FROM anon;`, "i"));
      expect(sql).toMatch(new RegExp(`GRANT SELECT ON ${view} TO authenticated;`, "i"));
    }
  });

  it("pins each view to security_invoker = off, because the view is the boundary", () => {
    // These views deliberately read past the owner-only policies on their base
    // tables — that is how a leaderboard sees other athletes at all. The WHERE
    // clause in the view is therefore the security boundary, not RLS. Setting
    // this explicitly rather than leaning on the default means a Postgres
    // upgrade or a well-meaning linter autofix cannot silently flip it and
    // either empty every leaderboard or widen it.
    const sql = allSql();
    for (const view of views.keys()) {
      expect(sql).toMatch(
        new RegExp(`ALTER VIEW ${view} SET \\(security_invoker = off\\);`, "i")
      );
    }
  });

  it("projects only the two score_breakdown paths the detail card reads", () => {
    const cols = views.get("public_workout_scores") ?? [];
    // fetchLeaderboardDetail pulls strength_activities and
    // cardio_activity.predictions out of the blob. Projecting those two paths
    // rather than score_breakdown itself means a future scoring change that
    // writes bodyweight or heart rate into the breakdown cannot leak through
    // this view.
    expect(cols).toContain("top_lifts");
    expect(cols).toContain("race_predictions");
    expect(cols).not.toContain("score_breakdown");
  });
});
