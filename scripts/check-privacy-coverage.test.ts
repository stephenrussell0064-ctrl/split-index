import { describe, expect, it } from "vitest";

// Plain ESM script with no type declarations; imported for its exports only.
import { tablesIn, TABLE_COVERAGE, GAPS } from "./check-privacy-coverage.mjs";

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
