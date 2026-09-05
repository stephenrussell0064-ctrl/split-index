import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recomputeUser, type RecomputeClient } from "./recompute-user";

/**
 * recomputeUser — the one pass that rewrites an athlete's whole scoring history.
 *
 * Both callers report what it returns and nothing else: the settings page shows
 * "Recomputed N of M activities", and scripts/recompute-all-users.ts prints the
 * same tally per athlete across every account at once. So the tally has to be
 * true. Every write in here DELETES before it inserts, which means a rejected
 * insert does not leave the old row standing — it leaves the athlete with
 * nothing, and a run that reported success is the only trace.
 */

const USER_ID = "user-1";

type QueryResult = { data: unknown; error: { message: string } | null };
interface RecordedCall {
  table: string;
  op: string;
  terminal: string | null;
  payload?: unknown;
}

const OK: QueryResult = { data: null, error: null };

/**
 * Minimal PostgREST-shaped stub. Keyed `table:op` (or `table:op:terminal`), so a
 * test names the one write it wants to fail and everything else succeeds.
 */
function createFakeSupabase(results: Record<string, QueryResult>) {
  const calls: RecordedCall[] = [];

  function chainFor(table: string) {
    let op: string | null = null;
    let terminal: string | null = null;
    let payload: unknown;

    const result = (): QueryResult => {
      const resolvedOp = op ?? "select";
      calls.push({ table, op: resolvedOp, terminal, payload });
      const override =
        (terminal ? results[`${table}:${resolvedOp}:${terminal}`] : undefined) ??
        results[`${table}:${resolvedOp}`];
      if (override) return override;
      if (resolvedOp === "select" && terminal === null) return { data: [], error: null };
      return OK;
    };

    const chain: Record<string, unknown> = {
      then(resolve: (value: QueryResult) => unknown, reject?: (reason: unknown) => unknown) {
        try {
          return Promise.resolve(resolve(result()));
        } catch (err) {
          return reject ? Promise.resolve(reject(err)) : Promise.reject(err);
        }
      },
    };
    for (const write of ["insert", "upsert", "update", "delete"]) {
      chain[write] = (values?: unknown) => {
        op = write;
        payload = values;
        return chain;
      };
    }
    chain.select = () => {
      op ??= "select";
      return chain;
    };
    for (const m of ["eq", "neq", "not", "is", "in", "order", "limit", "gte", "lte", "range"]) {
      chain[m] = () => chain;
    }
    for (const t of ["single", "maybeSingle"]) {
      chain[t] = () => {
        terminal = t;
        return chain;
      };
    }
    return chain;
  }

  return {
    client: { from: (table: string) => chainFor(table) } as unknown as RecomputeClient,
    calls,
  };
}

const PROFILE = {
  user_id: USER_ID,
  age: 30,
  gender: "male",
  weight_kg: 70,
  height_cm: 178,
  max_hr: 190,
  experience: "intermediate",
  goals: [],
  preferred_sports: ["running"],
  training_history_years: 5,
  split_endurance_weight: 0.5,
  date_of_birth: null,
  subscription_tier: "free",
  subscription_status: "inactive",
};

const RUN = {
  id: "act-1",
  user_id: USER_ID,
  sport: "running",
  started_at: "2026-01-05T08:00:00.000Z",
  duration_seconds: 1500,
  distance_meters: 5000,
  elevation_meters: 20,
  avg_heart_rate: 155,
  max_heart_rate: 172,
  avg_pace_seconds_per_km: 300,
  session_type: "tempo",
  rpe: 7,
  is_draft: false,
  metadata: {},
};

function baseResults(): Record<string, QueryResult> {
  return {
    "profiles:select:single": { data: PROFILE, error: null },
    "activities:select": { data: [RUN], error: null },
  };
}

const find = (calls: RecordedCall[], table: string, op: string) =>
  calls.filter((c) => c.table === table && c.op === op);

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("recomputeUser", () => {
  it("rebuilds the activity and reports it", async () => {
    const { client, calls } = createFakeSupabase(baseResults());
    const result = await recomputeUser(client, USER_ID);

    expect(result.total).toBe(1);
    expect(result.recomputed).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.rebuildFailures).toEqual([]);
    expect(find(calls, "workout_scores", "insert")).toHaveLength(1);
    expect(find(calls, "split_index_history", "insert")).toHaveLength(1);
  });

  it("does not count an activity as rebuilt when its score never landed", async () => {
    // The insert result used to be discarded entirely, so a rejected write left
    // the session with NO score — scoring deletes the old row first — and the
    // run still printed a clean tally. In a bulk pass across every athlete that
    // is the worst possible silence.
    const { client } = createFakeSupabase({
      ...baseResults(),
      "workout_scores:insert": { data: null, error: { message: "insert blocked" } },
    });
    const result = await recomputeUser(client, USER_ID);

    expect(result.recomputed).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.failures).toEqual([
      { id: "act-1", error: "workout_scores insert: insert blocked" },
    ]);
  });

  it("catches a failed delete, which would otherwise double-count the session", async () => {
    // Delete fails, insert succeeds: the activity ends up with two score rows,
    // and every load and trend query that reads them counts it twice.
    const { client } = createFakeSupabase({
      ...baseResults(),
      "workout_scores:delete": { data: null, error: { message: "delete blocked" } },
    });
    const result = await recomputeUser(client, USER_ID);

    expect(result.recomputed).toBe(0);
    expect(result.failed).toBe(1);
    expect((result.failures[0] as { error: string }).error).toMatch(/workout_scores delete/);
  });

  it("reports a lost index-history row too, not just the score", async () => {
    const { client } = createFakeSupabase({
      ...baseResults(),
      "split_index_history:insert": { data: null, error: { message: "history blocked" } },
    });
    const result = await recomputeUser(client, USER_ID);

    expect(result.recomputed).toBe(0);
    expect((result.failures[0] as { error: string }).error).toMatch(/split_index_history insert/);
  });

  it("reports a failed personal-record rebuild separately from the activity tally", async () => {
    // personal_records is deleted in full before being re-inserted, so this is
    // the most destructive write in the function: unchecked, a rejected insert
    // took the athlete's entire PR history with it and still reported a clean
    // run. It is not attributable to one activity, which is why the per-activity
    // count stays honest at 1 of 1 while this is reported alongside it.
    const { client } = createFakeSupabase({
      ...baseResults(),
      "personal_records:insert": { data: null, error: { message: "records blocked" } },
    });
    const result = await recomputeUser(client, USER_ID);

    expect(result.recomputed).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.rebuildFailures).toEqual(["personal_records insert: records blocked"]);
  });

  it("keeps going after one activity fails, so one bad session cannot end the pass", async () => {
    const { client } = createFakeSupabase({
      ...baseResults(),
      "activities:select": {
        data: [RUN, { ...RUN, id: "act-2", started_at: "2026-01-06T08:00:00.000Z" }],
        error: null,
      },
      "workout_scores:insert": { data: null, error: { message: "insert blocked" } },
    });
    const result = await recomputeUser(client, USER_ID);

    expect(result.total).toBe(2);
    expect(result.failed).toBe(2);
    expect((result.failures as Array<{ id: string }>).map((f) => f.id)).toEqual([
      "act-1",
      "act-2",
    ]);
  });
});
