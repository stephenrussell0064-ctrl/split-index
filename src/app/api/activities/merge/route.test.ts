import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Write-path integrity for POST /api/activities/merge.
 *
 * Merging is the one operation in the app that deletes scored training, so the
 * things worth pinning are not the happy path's numbers (merge.test.ts owns
 * those) but the database's shape afterwards:
 *
 *  - the absorbed sessions' split_index_history rows are deleted, not
 *    orphaned. That column is ON DELETE SET NULL, so a naive delete leaves a
 *    row belonging to no session that recompute cannot reach and every trend
 *    chart keeps reading;
 *  - the merged effort is counted exactly ONCE — one score, one index-history
 *    entry — and the absorbed halves' own scores are kept out of the load
 *    history the merged session is scored against;
 *  - a merge that cannot finish leaves the logbook exactly as it found it,
 *    never a state where the run exists both whole and in halves;
 *  - and the merged row survives a full recompute with the same score.
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
 * Stand-in for the Supabase query builder. Overrides are keyed
 * `table:op` and, more specifically, `table:op:terminal` — the merge route
 * reads `activities` both as a list (the sessions being merged) and as a
 * single row (the merged result), and those must be able to answer
 * differently. An array of results is consumed one call at a time (the last
 * one repeating), which is how "the write succeeded but the undo did not" is
 * expressed.
 */
function createFakeSupabase(results: Record<string, QueryResult | QueryResult[]>) {
  const calls: RecordedCall[] = [];
  const consumed: Record<string, number> = {};

  function resolveOverride(key: string): QueryResult | undefined {
    const value = results[key];
    if (value === undefined) return undefined;
    if (!Array.isArray(value)) return value;
    const index = Math.min(consumed[key] ?? 0, value.length - 1);
    consumed[key] = (consumed[key] ?? 0) + 1;
    return value[index];
  }

  function chainFor(table: string) {
    let op: string | null = null;
    let terminal: string | null = null;
    let payload: unknown;

    const result = (): QueryResult => {
      const resolvedOp = op ?? "select";
      calls.push({ table, op: resolvedOp, terminal, payload });
      const specific = terminal ? resolveOverride(`${table}:${resolvedOp}:${terminal}`) : undefined;
      const override = specific ?? resolveOverride(`${table}:${resolvedOp}`);
      if (override) return override;
      if (resolvedOp === "select" && terminal === null) return { data: [], error: null };
      return OK;
    };

    const chain: Record<string, unknown> = {
      then(
        resolve: (value: QueryResult) => unknown,
        reject?: (reason: unknown) => unknown
      ) {
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
    for (const modifier of ["eq", "neq", "not", "is", "in", "order", "limit", "gte", "lte", "range", "match"]) {
      chain[modifier] = () => chain;
    }
    for (const term of ["single", "maybeSingle"]) {
      chain[term] = () => {
        terminal = term;
        return chain;
      };
    }
    return chain;
  }

  return {
    client: {
      auth: { getUser: async () => ({ data: { user: { id: USER_ID } }, error: null }) },
      from: (table: string) => chainFor(table),
    },
    calls,
  };
}

const PROFILE = {
  id: "profile-1",
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

/** 20 min / 4 km, then — after a 60 s fumble with the phone — 10 min / 3 km. */
const LEG_A = {
  id: "leg-a",
  user_id: USER_ID,
  sport: "running",
  title: "Morning run",
  started_at: "2026-01-05T08:00:00.000Z",
  duration_seconds: 1200,
  distance_meters: 4000,
  elevation_meters: 30,
  avg_heart_rate: 145,
  max_heart_rate: 160,
  avg_pace_seconds_per_km: 300,
  session_type: "easy",
  rpe: 5,
  source: "gps",
  is_draft: false,
  is_partial_track: false,
  metadata: {},
};
const LEG_B = {
  ...LEG_A,
  id: "leg-b",
  title: null,
  started_at: "2026-01-05T08:21:00.000Z",
  duration_seconds: 600,
  distance_meters: 3000,
  elevation_meters: 15,
  avg_heart_rate: 165,
  max_heart_rate: 178,
  avg_pace_seconds_per_km: 200,
  session_type: "tempo",
  rpe: 8,
};

const createClientMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClientMock(),
}));

function baseResults(): Record<string, QueryResult | QueryResult[]> {
  return {
    "activities:select": { data: [LEG_A, LEG_B], error: null },
    "activities:select:single": { data: { ...LEG_A, id: "leg-a" }, error: null },
    "profiles:select": { data: PROFILE, error: null },
    "workout_scores:insert": {
      data: { id: "score-1", activity_id: "leg-a", user_id: USER_ID },
      error: null,
    },
  };
}

async function mergeWith(
  results: Record<string, QueryResult | QueryResult[]>,
  payload: unknown = { activityIds: ["leg-a", "leg-b"] }
) {
  const { client, calls } = createFakeSupabase(results);
  createClientMock.mockResolvedValue(client);
  const { POST } = await import("./route");
  const response = await POST(
    new Request("http://localhost/api/activities/merge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    })
  );
  return { response, body: await response.json(), calls };
}

const find = (calls: RecordedCall[], table: string, op: string) =>
  calls.filter((c) => c.table === table && c.op === op);

function payloadOf(calls: RecordedCall[], table: string, op: string): Record<string, unknown> {
  return (find(calls, table, op)[0]?.payload ?? {}) as Record<string, unknown>;
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/activities/merge", () => {
  it("writes the combined session onto the earlier one", async () => {
    const { response, calls } = await mergeWith(baseResults());
    expect(response.status).toBe(200);

    const update = payloadOf(calls, "activities", "update");
    expect(update.duration_seconds).toBe(1800);
    expect(update.distance_meters).toBe(7000);
    expect(update.started_at).toBe(LEG_A.started_at);
    // Derived from the totals, not averaged between 300 and 200.
    expect(update.avg_pace_seconds_per_km).toBeCloseTo(257.14, 1);
  });

  it("deletes the absorbed sessions' index history rather than orphaning it", async () => {
    const { calls } = await mergeWith(baseResults());

    const historyDeletes = find(calls, "split_index_history", "delete");
    expect(historyDeletes.length).toBeGreaterThan(0);

    // split_index_history.activity_id is ON DELETE SET NULL, so it has to go
    // BEFORE the activity that owns it — afterwards there is nothing left to
    // find it by.
    const firstHistoryDelete = calls.indexOf(historyDeletes[0]);
    const activityDelete = calls.indexOf(find(calls, "activities", "delete")[0]);
    expect(activityDelete).toBeGreaterThan(-1);
    expect(firstHistoryDelete).toBeLessThan(activityDelete);
  });

  it("removes personal records that were set on half a run", async () => {
    const { calls } = await mergeWith(baseResults());
    const recordDelete = find(calls, "personal_records", "delete");
    expect(recordDelete.length).toBeGreaterThan(0);
    expect(calls.indexOf(recordDelete[0])).toBeLessThan(
      calls.indexOf(find(calls, "activities", "delete")[0])
    );
  });

  it("counts the merged effort exactly once", async () => {
    const { calls } = await mergeWith(baseResults());

    // One score and one index-history entry for one session. Two of either
    // would mean the run had been counted twice in the load and trend models.
    expect(find(calls, "workout_scores", "insert")).toHaveLength(1);
    expect(find(calls, "split_index_history", "insert")).toHaveLength(1);
    expect(payloadOf(calls, "workout_scores", "insert").activity_id).toBe("leg-a");
    expect(payloadOf(calls, "split_index_history", "insert").activity_id).toBe("leg-a");
  });

  it("does not let the halves' own scores inflate the merged session's training load", async () => {
    // The absorbed legs' workout_scores rows are still inside the 50-row
    // window the re-score reads. If they were counted, the merged session
    // would be scored against a week that contains itself twice over.
    const withLegScores = await mergeWith({
      ...baseResults(),
      "workout_scores:select": {
        data: [
          { activity_id: "leg-a", load_score: 400, created_at: LEG_A.started_at, sport_index: 700 },
          { activity_id: "leg-b", load_score: 260, created_at: LEG_B.started_at, sport_index: 720 },
        ],
        error: null,
      },
    });
    const withoutLegScores = await mergeWith(baseResults());

    const scored = (calls: RecordedCall[]) =>
      payloadOf(calls, "workout_scores", "insert") as {
        sport_index: number;
        load_score: number;
        fatigue_impact: number;
      };

    expect(scored(withLegScores.calls).sport_index).toBe(scored(withoutLegScores.calls).sport_index);
    expect(scored(withLegScores.calls).load_score).toBe(scored(withoutLegScores.calls).load_score);
    expect(scored(withLegScores.calls).fatigue_impact).toBe(
      scored(withoutLegScores.calls).fatigue_impact
    );
  });

  it("keeps a full snapshot of every leg so the merge can be undone", async () => {
    const { calls } = await mergeWith(baseResults());
    const metadata = payloadOf(calls, "activities", "update").metadata as {
      merge: { sources: Array<{ id: string; wasSurvivor: boolean; duration_seconds: number }> };
    };

    expect(metadata.merge.sources.map((s) => s.id).sort()).toEqual(["leg-a", "leg-b"]);
    expect(metadata.merge.sources.filter((s) => s.wasSurvivor)).toHaveLength(1);
    // The pre-merge numbers, not the merged ones — this is what a restore
    // writes back.
    expect(metadata.merge.sources.find((s) => s.id === "leg-a")!.duration_seconds).toBe(1200);
    expect(metadata.merge.sources.find((s) => s.id === "leg-b")!.duration_seconds).toBe(600);
  });

  it("does not report a merge as scored when the score never landed", async () => {
    // Scoring DELETES the survivor's score before rewriting it, so a failed
    // insert leaves the merged session with none at all. This used to answer
    // 200 with score: null and a splitIndex read from the in-memory result —
    // a success screen quoting a number the database never received.
    const { response, body } = await mergeWith({
      ...baseResults(),
      "workout_scores:insert": { data: null, error: { message: "insert blocked" } },
    });

    expect(response.status).toBe(500);
    expect(body.error).toMatch(/could not score/i);
    // The merge itself did happen, so the message must not claim otherwise —
    // it points at the undo that is sitting in the session's own metadata.
    expect(body.error).toMatch(/undo the merge|logbook/i);
    expect(body.splitIndex).toBeUndefined();
    expect(body.score).toBeUndefined();
  });

  it("writes nothing at all on a dry run", async () => {
    const { response, body, calls } = await mergeWith(baseResults(), {
      activityIds: ["leg-a", "leg-b"],
      dryRun: true,
    });

    expect(response.status).toBe(200);
    expect(body.preview.merged.duration_seconds).toBe(1800);
    expect(body.preview.absorbedIds).toEqual(["leg-b"]);
    for (const op of ["insert", "update", "delete", "upsert"]) {
      expect(calls.filter((c) => c.op === op)).toHaveLength(0);
    }
  });

  it("puts the surviving session back when the delete fails", async () => {
    // The one state that must never exist: the run recorded whole AND in
    // halves, with every kilometre counted twice in the load model.
    const { response, body, calls } = await mergeWith({
      ...baseResults(),
      "activities:delete": { data: null, error: { message: "delete blocked" } },
    });

    expect(response.status).toBe(500);
    expect(body.error).toMatch(/nothing was changed/i);

    const updates = find(calls, "activities", "update");
    expect(updates).toHaveLength(2);
    // The second update is the restore, back to the leg's own numbers.
    expect((updates[1].payload as Record<string, unknown>).duration_seconds).toBe(1200);
    expect((updates[1].payload as Record<string, unknown>).distance_meters).toBe(4000);
    // And nothing was re-scored on top of a merge that did not happen.
    expect(find(calls, "workout_scores", "insert")).toHaveLength(0);
  });

  it("tells the athlete to check their logbook when the undo fails too", async () => {
    const { response, body } = await mergeWith({
      ...baseResults(),
      "activities:delete": { data: null, error: { message: "delete blocked" } },
      // The merge write lands; the restore that should undo it does not.
      "activities:update": [OK, { data: null, error: { message: "update blocked" } }],
    });
    expect(response.status).toBe(500);
    expect(body.error).toMatch(/check your logbook/i);
  });

  it("refuses two different sports without touching anything", async () => {
    const { response, body, calls } = await mergeWith({
      ...baseResults(),
      "activities:select": {
        data: [LEG_A, { ...LEG_B, sport: "outdoor_cycling" }],
        error: null,
      },
    });

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/different sports/i);
    expect(calls.filter((c) => c.op !== "select")).toHaveLength(0);
  });

  it("refuses sessions that are hours apart", async () => {
    const { response, body } = await mergeWith({
      ...baseResults(),
      "activities:select": {
        data: [LEG_A, { ...LEG_B, started_at: "2026-01-05T19:00:00.000Z" }],
        error: null,
      },
    });
    expect(response.status).toBe(400);
    expect(body.error).toMatch(/too far apart/i);
  });

  it("refuses a selection that includes a session the athlete does not own", async () => {
    const { response, body } = await mergeWith(
      { ...baseResults(), "activities:select": { data: [LEG_A], error: null } },
      { activityIds: ["leg-a", "someone-elses"] }
    );
    expect(response.status).toBe(404);
    expect(body.error).toMatch(/no longer exists/i);
  });

  it("refuses a single session", async () => {
    const { response } = await mergeWith(baseResults(), { activityIds: ["leg-a"] });
    expect(response.status).toBe(400);
  });
});

/**
 * The race-prediction memory, which a merge is uniquely able to destroy.
 *
 * predicted_benchmarks.last_activity_id is ON DELETE SET NULL, so deleting an
 * absorbed session erases the very link the re-score uses to notice that the
 * stored prediction already contains that session's evidence. If that goes
 * unnoticed the merged session blends into a base that already counts it; if
 * it is "handled" by passing a null base instead, blendPredictedBenchmark
 * SEEDS — replacing an athlete's entire prediction history with one session,
 * which is how a real 18:25 5 k once started displaying as 24:59.
 */
describe("merging does not wipe the stored race prediction", () => {
  /** Another recent run, so there is genuine other evidence to rebuild a base from. */
  const OTHER_RUN = {
    ...LEG_A,
    id: "other-run",
    title: "Tuesday steady",
    started_at: "2026-01-02T07:00:00.000Z",
    duration_seconds: 2400,
    distance_meters: 9000,
    avg_heart_rate: 150,
    session_type: "easy",
  };

  const PRIOR_PREDICTION = {
    benchmark_seconds: 1105,
    sample_count: 24,
    last_activity_id: "leg-b",
    updated_at: "2026-01-05T09:00:00.000Z",
    last_quality_at: "2026-01-05T09:00:00.000Z",
    riegel_k: 1.06,
  };

  function withPrior(prior: Record<string, unknown> | null) {
    return {
      ...baseResults(),
      // First list read is the two sessions being merged; every later one is
      // the 90-day window the re-score reads, which also contains the
      // athlete's other running.
      "activities:select": [
        { data: [LEG_A, LEG_B], error: null },
        { data: [LEG_A, LEG_B, OTHER_RUN], error: null },
      ],
      "predicted_benchmarks:select:maybeSingle": { data: prior, error: null },
    };
  }

  it("keeps the athlete's accumulated evidence instead of starting over", async () => {
    const { calls } = await mergeWith(withPrior(PRIOR_PREDICTION));
    const upsert = payloadOf(calls, "predicted_benchmarks", "upsert") as {
      benchmark_seconds: number;
      sample_count: number;
      last_activity_id: string;
    };

    // 24 sessions of evidence do not become 1 because two of them were
    // rejoined — and they do not become 25 either, since the absorbed
    // session's evidence was already in there.
    expect(upsert.sample_count).toBe(24);
    expect(upsert.last_activity_id).toBe("leg-a");
    expect(upsert.benchmark_seconds).toBeGreaterThan(0);
  });

  it("rebuilds the blend base from the other sessions rather than seeding from this one", async () => {
    // Same merge, once with a stored prediction whose evidence includes an
    // absorbed leg, once with no stored prediction at all (which genuinely
    // does seed). If the stale-base path were "just pass null", these two
    // would land on the same number.
    const stale = await mergeWith(withPrior(PRIOR_PREDICTION));
    const seeded = await mergeWith(withPrior(null));

    const seconds = (calls: RecordedCall[]) =>
      (payloadOf(calls, "predicted_benchmarks", "upsert") as { benchmark_seconds: number })
        .benchmark_seconds;

    expect(seconds(stale.calls)).not.toBeCloseTo(seconds(seeded.calls), 3);
    // And the seeded case is the one that starts its count over.
    expect(
      (payloadOf(seeded.calls, "predicted_benchmarks", "upsert") as { sample_count: number })
        .sample_count
    ).toBe(1);
  });
});

/**
 * POST /api/activities/recompute rebuilds every score from the activities
 * table alone. A merged session is only correct if it survives that: its
 * stored score has to be reproducible from the row the merge wrote, with no
 * memory of the two sessions it came from.
 */
describe("a merged session survives a full recompute", () => {
  it("recomputes to exactly the score the merge stored", async () => {
    const merge = await mergeWith(baseResults());
    const mergeUpdate = payloadOf(merge.calls, "activities", "update");
    const mergedScore = payloadOf(merge.calls, "workout_scores", "insert") as {
      sport_index: number;
      load_score: number;
      endurance_component: number;
    };

    // Exactly the row the merge left behind, read back the way recompute
    // reads it — nothing about the merge is carried in memory.
    const mergedRow = {
      ...LEG_A,
      ...mergeUpdate,
      id: "leg-a",
      user_id: USER_ID,
      is_draft: false,
    };

    const { client, calls } = createFakeSupabase({
      "activities:select": { data: [mergedRow], error: null },
      "profiles:select": { data: PROFILE, error: null },
    });
    createClientMock.mockResolvedValue(client);
    const { POST: RECOMPUTE } = await import("../recompute/route");
    const response = await RECOMPUTE();
    const body = await response.json();

    expect(body.recomputed).toBe(1);
    expect(body.failed).toBe(0);

    const recomputed = payloadOf(calls, "workout_scores", "insert") as {
      sport_index: number;
      load_score: number;
      endurance_component: number;
      activity_id: string;
    };
    expect(recomputed.activity_id).toBe("leg-a");
    expect(recomputed.sport_index).toBe(mergedScore.sport_index);
    expect(recomputed.load_score).toBe(mergedScore.load_score);
    expect(recomputed.endurance_component).toBe(mergedScore.endurance_component);
  });
});
