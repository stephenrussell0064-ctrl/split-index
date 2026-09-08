import { describe, expect, it } from "vitest";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - plain .mjs script, no type declarations
import { expectedState, liveState, compare, statements } from "./check-schema-drift.mjs";

/**
 * The model behind the drift check.
 *
 * The comparison itself is trivial; everything that can be wrong is in what
 * the migrations are understood to mean. A parser that quietly stops
 * recognising REVOKE reports a clean database forever, which is worse than no
 * check at all — so the cases below are the ones that decide whether a real
 * exposure is seen or missed, and the last block replays the actual incident
 * that prompted the whole thing.
 */

/** Same separator the script uses: a space cannot be used, policy names contain them. */
const SEP = "\u0000";

const migration = (name: string, sql: string) => ({ name, sql });

describe("reading a migration", () => {
  it("does not split a function body on its own semicolons", () => {
    // A naive split turns one CREATE FUNCTION into a dozen fragments, several
    // of which look like statements the model would then act on.
    const sql = `
      CREATE FUNCTION f() RETURNS void LANGUAGE plpgsql AS $$
      BEGIN
        DROP VIEW public_profiles;
        GRANT SELECT ON secrets TO anon;
      END;
      $$;
      CREATE VIEW v AS SELECT 1;
    `;
    const parsed = statements(sql).filter((s: string) => s.trim());
    expect(parsed).toHaveLength(2);
    expect(parsed[1]).toContain("CREATE VIEW v");
  });

  it("ignores a statement that appears only in prose", () => {
    const state = expectedState([
      migration("001_x.sql", `-- DROP POLICY IF EXISTS "Public profiles readable" ON profiles;\nCREATE VIEW v AS SELECT 1;`),
    ]);
    expect(state.views.has("v")).toBe(true);
  });
});

describe("the Supabase creation default", () => {
  it("treats a newly created view as readable by anon before any GRANT", () => {
    /*
      The heart of the model. A project bootstraps with ALTER DEFAULT
      PRIVILEGES ... GRANT ALL ON TABLES TO anon, authenticated, so a view is
      exposed the moment it exists. A model that started new objects at "no
      access" would call the safe state a drift and miss the dangerous one.
    */
    const state = expectedState([migration("001_x.sql", "CREATE VIEW v AS SELECT 1;")]);
    expect(state.tableGrants.get(["v", "anon"].join(SEP))).toBe(true);
  });

  it("reproduces the leaderboard_profiles mistake exactly", () => {
    // Recreate the view, restate only the GRANT to authenticated. The GRANT
    // adds nothing the default had not already given, and anon keeps it.
    const state = expectedState([
      migration(
        "064_x.sql",
        `DROP VIEW IF EXISTS leaderboard_profiles;
         CREATE VIEW leaderboard_profiles AS SELECT 1;
         GRANT SELECT ON leaderboard_profiles TO authenticated;`
      ),
    ]);
    expect(state.tableGrants.get(["leaderboard_profiles", "anon"].join(SEP))).toBe(true);
  });

  it("closes it when the revoke names anon", () => {
    const state = expectedState([
      migration(
        "064_x.sql",
        `CREATE VIEW leaderboard_profiles AS SELECT 1;
         REVOKE ALL ON leaderboard_profiles FROM anon;
         GRANT SELECT ON leaderboard_profiles TO authenticated;`
      ),
    ]);
    expect(state.tableGrants.get(["leaderboard_profiles", "anon"].join(SEP))).toBe(false);
    expect(state.tableGrants.get(["leaderboard_profiles", "authenticated"].join(SEP))).toBe(true);
  });

  it("does not treat a revoke from PUBLIC as covering anon", () => {
    // The defect found three times in this repository. PUBLIC and a by-name
    // grant to anon are different things, and revoking one leaves the other.
    const state = expectedState([
      migration(
        "060_x.sql",
        `CREATE FUNCTION f() RETURNS void LANGUAGE sql AS $$ SELECT 1 $$;
         REVOKE ALL ON FUNCTION f() FROM PUBLIC;`
      ),
    ]);
    expect(state.functionGrants.get(["f", "anon"].join(SEP))).toBe(true);
  });

  it("closes it when the revoke lists anon alongside PUBLIC", () => {
    const state = expectedState([
      migration(
        "067_x.sql",
        `CREATE FUNCTION f() RETURNS void LANGUAGE sql AS $$ SELECT 1 $$;
         REVOKE ALL ON FUNCTION f() FROM PUBLIC, anon, authenticated;`
      ),
    ]);
    expect(state.functionGrants.get(["f", "anon"].join(SEP))).toBe(false);
  });
});

describe("a cascaded drop", () => {
  it("takes the dependent views with it, transitively", () => {
    const state = expectedState([
      migration(
        "056_x.sql",
        `CREATE VIEW public_profiles AS SELECT 1;
         CREATE VIEW public_scores AS SELECT * FROM x WHERE EXISTS (SELECT 1 FROM public_profiles pp);
         CREATE VIEW deeper AS SELECT * FROM public_scores;`
      ),
      migration(
        "064_x.sql",
        `DROP VIEW IF EXISTS public_profiles CASCADE;
         CREATE VIEW public_profiles AS SELECT 2;`
      ),
    ]);
    expect(state.views.has("public_profiles")).toBe(true);
    expect(state.views.has("public_scores")).toBe(false);
    expect(state.views.has("deeper")).toBe(false);
  });

  it("leaves independent views alone", () => {
    const state = expectedState([
      migration("056_x.sql", `CREATE VIEW public_profiles AS SELECT 1; CREATE VIEW other AS SELECT 1;`),
      migration("064_x.sql", `DROP VIEW IF EXISTS public_profiles CASCADE;`),
    ]);
    expect(state.views.has("other")).toBe(true);
  });
});

describe("the comparison", () => {
  const empty = { views: [], policies: [], table_grants: [], function_grants: [] };

  it("REPLAYS THE INCIDENT: a policy the migrations dropped is still live", () => {
    /*
      This is the one. 056 drops "Public profiles readable" — the 001 policy,
      carrying no TO clause, that let any caller including anon read any named
      profile in full. The migration was never applied. Every source guard in
      the repository kept passing, because the repository was right.
    */
    const expected = expectedState([
      migration("001_x.sql", `CREATE POLICY "Public profiles readable" ON profiles FOR SELECT USING (username IS NOT NULL);`),
      migration("056_x.sql", `DROP POLICY IF EXISTS "Public profiles readable" ON profiles;`),
    ]);
    const live = liveState({
      ...empty,
      policies: [{ table: "profiles", name: "Public profiles readable" }],
    });

    const findings = compare(expected, live);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("exposed");
    expect(findings[0].what).toContain("Public profiles readable");
    expect(findings[0].what).toContain("still live");
  });

  it("says nothing once that migration has been applied", () => {
    const expected = expectedState([
      migration("001_x.sql", `CREATE POLICY "Public profiles readable" ON profiles FOR SELECT USING (true);`),
      migration("056_x.sql", `DROP POLICY IF EXISTS "Public profiles readable" ON profiles;`),
    ]);
    expect(compare(expected, liveState(empty))).toEqual([]);
  });

  it("reports a view the migrations create and the database lacks", () => {
    // What an unapplied 071 looks like.
    const expected = expectedState([migration("071_x.sql", "CREATE VIEW public_index_history AS SELECT 1;")]);
    const findings = compare(expected, liveState(empty));
    expect(findings.map((f: { what: string }) => f.what)).toContain(
      "view public_index_history is missing"
    );
  });

  it("reports a grant the database has and the migrations closed", () => {
    // What an unapplied 072 looks like.
    const expected = expectedState([
      migration("072_x.sql", `CREATE VIEW leaderboard_profiles AS SELECT 1; REVOKE ALL ON leaderboard_profiles FROM anon;`),
    ]);
    const live = liveState({
      ...empty,
      views: ["leaderboard_profiles"],
      table_grants: [{ object: "leaderboard_profiles", role: "anon", can_select: true }],
    });
    const findings = compare(expected, live);
    expect(findings[0].severity).toBe("exposed");
    expect(findings[0].what).toContain("anon can SELECT leaderboard_profiles");
  });

  it("puts an exposure above a breakage", () => {
    // Both matter; one is a door left open and the other is a door that will
    // not open, and only the first gets worse while you read the list.
    const expected = expectedState([
      migration("001_x.sql", `CREATE VIEW gone AS SELECT 1;`),
      migration("002_x.sql", `CREATE POLICY "Wide" ON t FOR SELECT USING (true);`),
      migration("003_x.sql", `DROP POLICY IF EXISTS "Wide" ON t;`),
    ]);
    const live = liveState({ ...empty, policies: [{ table: "t", name: "Wide" }] });
    const findings = compare(expected, live);
    expect(findings[0].severity).toBe("exposed");
    expect(findings.at(-1)!.severity).toBe("broken");
  });

  it("ignores an object no migration mentions", () => {
    // Supabase manages objects of its own. Failing on every one is how a check
    // like this gets switched off within a week.
    const live = liveState({
      ...empty,
      views: ["some_supabase_view"],
      table_grants: [{ object: "some_supabase_view", role: "anon", can_select: true }],
    });
    expect(compare(expectedState([]), live)).toEqual([]);
  });
});

describe("what the first real run got wrong", () => {
  /*
    Every case here is a false alarm the checker produced against the actual
    database before it was trusted with a verdict. They are kept because a
    checker that cries wolf on its first run does not get run twice, and each
    of these buried a genuine finding under noise.
  */

  it("ignores a policy on another schema", () => {
    // 010 creates four avatar policies ON storage.objects. That schema is
    // Supabase's and the snapshot does not read it, so recording the target as
    // "storage" reported all four as missing.
    const state = expectedState([
      migration("010_x.sql", `CREATE POLICY "Avatar images are publicly readable" ON storage.objects FOR SELECT USING (true);`),
    ]);
    expect(state.policies.size).toBe(0);
  });

  it("keeps a policy that names the public schema explicitly", () => {
    const state = expectedState([
      migration("001_x.sql", `CREATE POLICY "Own rows" ON public.profiles FOR SELECT USING (true);`),
    ]);
    expect([...state.policies]).toEqual([["profiles", "Own rows"].join(SEP)]);
  });

  it("lets a dropped table take its policies and grants with it", () => {
    // 055 removes training_goals deliberately. Without this the policies 033
    // created stayed expected forever, and the checker reported them missing
    // from a database that was right.
    const state = expectedState([
      migration("033_x.sql", `CREATE TABLE IF NOT EXISTS training_goals (id UUID); CREATE POLICY "Users manage own training goals" ON training_goals FOR ALL USING (true);`),
      migration("055_x.sql", `DROP TABLE IF EXISTS training_goals;`),
    ]);
    expect(state.tables.has("training_goals")).toBe(false);
    expect([...state.policies]).toEqual([]);
    expect([...state.tableGrants.keys()].filter((k: string) => k.startsWith("training_goals"))).toEqual([]);
  });

  it("names a missing table once, not once per policy on it", () => {
    // Five findings on the first run, all symptoms, with the cause itself
    // absent from the list.
    const expected = expectedState([
      migration("005_x.sql", `CREATE TABLE session_templates (id UUID); CREATE POLICY "Users manage own session templates" ON session_templates FOR ALL USING (true);`),
    ]);
    const findings = compare(expected, liveState({ views: [], policies: [], rls: [], table_grants: [], function_grants: [] }));
    expect(findings.map((f: { what: string }) => f.what)).toEqual(["table session_templates is missing"]);
  });

  it("calls an unreviewable policy unmanaged rather than exposed", () => {
    /*
      The three it found were "Users can view their own race predictions" and
      friends — owner-scoped policies on tables created through the dashboard.
      Calling those an exposure is a false alarm; saying nothing hides the way
      a permissive policy could arrive unnoticed. So: different word, sorts
      last.
    */
    const live = liveState({
      views: [],
      rls: [],
      policies: [{ table: "race_predictions", name: "Users can view their own race predictions" }],
      table_grants: [],
      function_grants: [],
    });
    const findings = compare(expectedState([]), live);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("unmanaged");
  });
});

describe("the real migrations", () => {
  it("model a state the current guards agree with", async () => {
    // A sanity check on the parser against the actual tree rather than
    // fixtures: the six projections plus profile_usernames, and anon able to
    // read exactly one of them.
    const { readMigrations } = await import("./check-schema-drift.mjs");
    const state = expectedState(readMigrations());

    expect(state.views.has("public_profiles")).toBe(true);
    expect(state.views.has("public_strength_scores")).toBe(true);
    expect(state.views.has("profile_usernames")).toBe(true);

    expect(state.tableGrants.get(["public_profiles", "anon"].join(SEP))).toBe(true);
    for (const view of [
      "leaderboard_profiles",
      "public_strength_scores",
      "public_workout_scores",
      "public_index_history",
      "public_leaderboard_entries",
      "profile_usernames",
    ]) {
      expect(state.tableGrants.get([view, "anon"].join(SEP)), `${view} is readable by anon`).toBe(false);
    }
  });

  it("expects every legacy public-read policy to be gone", async () => {
    // The five 073 removes. If any is still in the model as present, either a
    // migration recreated it or the parser stopped seeing the drop — and the
    // second failure is the one that would report a clean database forever.
    const { readMigrations } = await import("./check-schema-drift.mjs");
    const state = expectedState(readMigrations());
    for (const policy of [
      "Public profiles readable",
      "Public leaderboard strength scores",
      "Public leaderboard scores",
      "Public leaderboard index",
      "Public challenge progress",
      "Anyone can view leaderboards",
    ]) {
      const present = [...state.policies].filter((k: string) => k.endsWith(SEP + policy));
      expect(present, `"${policy}" is still expected to exist`).toEqual([]);
    }
  });

  it("still sees policies at all", () => {
    // The silent-pass failure for the assertion above: a parser that stops
    // recognising CREATE POLICY finds none of them missing, forever.
    return import("./check-schema-drift.mjs").then(({ readMigrations }) => {
      expect(expectedState(readMigrations()).policies.size).toBeGreaterThan(40);
    });
  });
});
