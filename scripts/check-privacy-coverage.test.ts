import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Plain ESM script with no type declarations; imported for its exports only.
import {
  tablesIn,
  tableSources,
  draftOnly,
  normalisePolicy,
  POLICY,
  TABLE_COVERAGE,
  GAPS,
} from "./check-privacy-coverage.mjs";

/*
 * The mechanism this check claims to have.
 *
 * Its header — and the milestone note quoting it — says "adding a table that
 * holds personal data turns this red until somebody writes the paragraph".
 * That was not true. Every rule looked for its OWN evidence, so a table nobody
 * had written a rule for produced no rule, matched nothing, and the check
 * passed in silence. Adding a table turned this red only if somebody also
 * remembered to add a rule, which is the remembering the mechanism replaces.
 *
 * These assertions are about the half that closes it: enumerate the schema,
 * and fail on a table nobody has accounted for.
 */

const table = (name: string, body: string) => `create table ${name} (\n  ${body}\n);`;

describe("finding the tables", () => {
  it("sees a table keyed to a user", () => {
    const found = tablesIn(table("sleep_logs", "id uuid, user_id uuid references auth.users"));
    expect(found.get("sleep_logs")).toBe(true);
  });

  it("sees a table that is not", () => {
    expect(tablesIn(table("sports", "id int, name text")).get("sports")).toBe(false);
  });

  it("counts the other names a user column goes by", () => {
    // athlete_id and profile_id are the same fact in different words, and a
    // table missed here is a disclosure an athlete was owed and did not get.
    for (const col of ["athlete_id uuid", "profile_id uuid", "owner_id uuid", "reporter_id uuid"]) {
      expect(tablesIn(table("t", `id uuid, ${col}`)).get("t")).toBe(true);
    }
  });

  it("treats a table as user-linked if ANY definition of it is", () => {
    // A table created plain and given a user column in a later migration is
    // user-linked; reading only the first CREATE would miss it.
    const schema = [table("t", "id uuid"), table("t", "id uuid, user_id uuid")].join("\n");
    expect(tablesIn(schema).get("t")).toBe(true);
  });

  it("handles `if not exists` and a schema-qualified name", () => {
    const schema = "create table if not exists public.notifications (\n  user_id uuid\n);";
    expect(tablesIn(schema).get("notifications")).toBe(true);
  });
});

describe("what the coverage map has to account for", () => {
  it("THE FAULT: a new user-linked table is not silently fine", () => {
    /*
     * The whole point. Before this, a table with no matching rule produced no
     * rule and the check passed. Now it has to be named — either under the
     * clause of the policy that covers it, or as holding no personal data.
     */
    const invented = "athlete_mood_diary";
    expect(invented in TABLE_COVERAGE).toBe(false);
    expect(tablesIn(table(invented, "id uuid, user_id uuid")).get(invented)).toBe(true);
  });

  it("records a decision for every table it lists, including the boring ones", () => {
    // `null` is a decision — "this holds no personal data" — and an absent key
    // is nobody having looked. They must not be the same value.
    for (const [name, clause] of Object.entries(TABLE_COVERAGE)) {
      expect(clause === null || (typeof clause === "string" && clause.length > 3)).toBe(true);
      expect(name).toMatch(/^[a-z_]+$/);
    }
  });

  it("keeps the known gaps out of the coverage map, so neither hides the other", () => {
    // A table in both would pass under its clause while still being an open
    // gap, which is how a to-do list quietly empties itself.
    for (const gap of Object.keys(GAPS)) expect(gap in TABLE_COVERAGE).toBe(false);
  });

  it("states the question for each gap rather than presuming the wording", () => {
    // What the policy should SAY about staff access is not this script's call.
    // Naming the omission is.
    for (const [table, why] of Object.entries(GAPS)) {
      expect((why as string).length).toBeGreaterThan(60);
      expect(why).not.toMatch(/^TODO/i);
      expect(table).toMatch(/^[a-z_]+$/);
    }
  });
});

/*
 * Whose schema the check is reading.
 *
 * 20 Sep 2026. The check went red on `activity_streams` and
 * `activity_best_efforts` and the dashboard reported Split Index dropping four
 * points on a privacy-policy failure. There was no gap: at HEAD the check
 * passed on all 45 user-linked tables, and both named tables were defined only
 * in an untracked migration a concurrent session was still writing.
 *
 * The assertions that matter here are the NEGATIVE ones. A guard that excuses a
 * failure is only safe if it refuses to excuse the real thing, so each of these
 * removes one leg of the excuse and expects the failure back.
 */
describe("a draft in the working tree is not a policy gap", () => {
  const file = (n: string) => `/repo/supabase/migrations/${n}.sql`;
  const sources = new Map([
    ["activity_streams", file("065_activity_streams")],
    ["sleep_logs", file("012_sleep")],
  ]);

  it("finds which migration introduced each table", () => {
    const found = tableSources([
      { path: file("012_sleep"), sql: table("sleep_logs", "id uuid, user_id uuid") },
      { path: file("065_activity_streams"), sql: table("activity_streams", "user_id uuid") },
    ]);
    expect(found.get("sleep_logs")).toBe(file("012_sleep"));
    expect(found.get("activity_streams")).toBe(file("065_activity_streams"));
  });

  it("credits the CREATE, not a later ALTER that re-declares it", () => {
    // The file a reader wants is where the table came from.
    const found = tableSources([
      { path: file("012_sleep"), sql: table("t", "id uuid") },
      { path: file("065_activity_streams"), sql: table("t", "id uuid, user_id uuid") },
    ]);
    expect(found.get("t")).toBe(file("012_sleep"));
  });

  it("excuses a table whose migration is uncommitted", () => {
    expect(draftOnly(["activity_streams"], sources, new Set([file("065_activity_streams")]))).toBe(true);
  });

  it("THE FAULT IT MUST NOT CAUSE: a committed table stays a failure", () => {
    // The whole risk of this guard. `sleep_logs` is in a committed migration,
    // so a policy that says nothing about it is a real art. 13 omission and has
    // to stay red however dirty the tree is.
    expect(draftOnly(["sleep_logs"], sources, new Set([file("065_activity_streams")]))).toBe(false);
  });

  it("unanimity: one committed table among drafts keeps the whole thing red", () => {
    // Otherwise a real omission hides behind whatever else is in the tree.
    expect(
      draftOnly(["activity_streams", "sleep_logs"], sources, new Set([file("065_activity_streams")])),
    ).toBe(false);
  });

  it("a clean tree can never excuse anything", () => {
    expect(draftOnly(["activity_streams"], sources, new Set())).toBe(false);
  });

  it("a table whose migration cannot be identified stays a failure", () => {
    // Unknown provenance is not evidence of a draft. Red is the safe direction.
    expect(draftOnly(["mystery_table"], sources, new Set([file("065_activity_streams")]))).toBe(false);
  });

  it("nothing to report is not something to excuse", () => {
    // An empty list satisfies `every` vacuously; this is the guard against that.
    expect(draftOnly([], sources, new Set([file("065_activity_streams")]))).toBe(false);
  });
});

/*
 * Reading the policy the way the check reads it.
 *
 * Extracted and tested on 13 Sep 2026 because of a near-miss rather than a bug.
 * Three clauses were added to TABLE_COVERAGE and a mutation test was run to
 * prove each was load-bearing: delete the phrase from the policy, expect the
 * check to fail. Two deletions silently matched nothing, because Prettier wraps
 * the policy's prose and those phrases contain a newline and an indent run in
 * the source. The check passed, and a passing check after a deletion is
 * indistinguishable from a clause that never mattered.
 *
 * The check was right and the instrument was wrong. These assertions are about
 * the normalisation that made the check right, so the next person does not have
 * to find it out the same way.
 */
describe("reading the policy as prose", () => {
  it("joins a phrase that the source wraps across lines", () => {
    const wrapped = "<p>\n  only you can read your\n  notifications, and they go\n</p>";
    expect(normalisePolicy(wrapped)).toContain("only you can read your notifications");
  });

  it("joins a phrase a tag splits mid-sentence", () => {
    expect(normalisePolicy("your <strong>body</strong> metrics")).toContain("body metrics");
  });

  it("does not weld two words together across a tag", () => {
    // Replacing a tag with "" rather than " " would turn "read<br/>notifications"
    // into "readnotifications" and hide the phrase in the other direction.
    expect(normalisePolicy("read<br/>notifications")).toContain("read notifications");
  });

  it("lower-cases, so a clause need not guess the sentence position", () => {
    expect(normalisePolicy("Administrator Access Is Recorded")).toContain(
      "administrator access is recorded",
    );
  });

  it("every clause in the coverage map is findable in the real policy", () => {
    /*
     * The same assertion the check makes, run in the suite rather than only from
     * the registry — so rewording the policy fails a test here instead of turning
     * a dashboard milestone red hours later, and so `pnpm test` is enough to know.
     */
    const policy = normalisePolicy(readFileSync(POLICY, "utf8"));
    const missing = Object.entries(TABLE_COVERAGE)
      .filter(([, clause]) => clause !== null && !policy.includes(clause as string))
      .map(([table, clause]) => `${table} -> "${clause}"`);
    expect(missing).toEqual([]);
  });

  it("no clause is a single word", () => {
    // A one-word clause is a label, not a disclosure, and "notifications" would
    // be satisfied by the heading alone while §2 still said nothing about them.
    for (const [table, clause] of Object.entries(TABLE_COVERAGE)) {
      if (clause === null) continue;
      expect((clause as string).trim().split(/\s+/).length, table).toBeGreaterThan(1);
    }
  });
});

/*
 * The three tables the 12 Sep enumeration found, written up on 13 Sep.
 *
 * Named individually rather than counted. Counting would pass a change that
 * dropped one of these and added something else, and the point of each is a
 * specific disclosure: what an in-app message holds, who can read across
 * accounts, and what is written down when they do.
 */
describe("the enumerated gaps are now disclosures", () => {
  const WRITTEN_UP = ["notifications", "admin_users", "admin_access_log"] as const;

  it("each is accounted for, and none is still an open gap", () => {
    for (const table of WRITTEN_UP) {
      expect(table in TABLE_COVERAGE, `${table} in TABLE_COVERAGE`).toBe(true);
      expect(table in GAPS, `${table} still in GAPS`).toBe(false);
      expect(TABLE_COVERAGE[table as keyof typeof TABLE_COVERAGE]).not.toBeNull();
    }
  });

  it("the two administrator tables answer to different clauses", () => {
    /*
     * They are different disclosures — who holds the role, and what is recorded
     * when it is used — and either could be deleted from the policy without the
     * other. Filing both under one phrase would let half the disclosure vanish
     * while the check stayed green.
     */
    expect(TABLE_COVERAGE.admin_users).not.toBe(TABLE_COVERAGE.admin_access_log);
  });

  it("the policy states the limit on the fleet view, not just its existence", () => {
    /*
     * The part most likely to rot, and the part that would be most misleading if
     * it rotted in the reassuring direction. §11 says the cross-account view is
     * aggregate-only; if the code stops being aggregate-only, that sentence
     * becomes the inaccuracy the whole check exists to prevent. Asserted here so
     * that removing the limit from the policy fails, and so a reader of the code
     * is pointed at the claim the policy makes about it.
     */
    const policy = normalisePolicy(readFileSync(POLICY, "utf8"));
    expect(policy).toContain("aggregate only");
    expect(policy).toContain("no account identifier, email address");
  });

  it("the policy says the security records outlive a deletion", () => {
    // admin_access_log.admin_user_id and security_events.user_id are ON DELETE
    // SET NULL, so they survive erasure by ceasing to name the account. §9 said
    // nothing about that until 13 Sep; art. 17 says it should.
    const policy = normalisePolicy(readFileSync(POLICY, "utf8"));
    expect(policy).toContain("outlive a deletion");
  });
});
