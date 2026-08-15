import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Write-path integrity for POST /api/activities.
 *
 * Supabase's JS client has no transaction, so the activity row is inserted
 * before the score that gives it meaning. These tests pin the contract that
 * covers the gap: if any of the writes that make a session *scored* fails, the
 * API must not answer with a success payload built from an in-memory score
 * that was never persisted — it must unwind the activity and report the
 * failure.
 */

const USER_ID = "user-1";
const ACTIVITY_ID = "activity-1";

type QueryResult = { data: unknown; error: { message: string } | null };

interface RecordedCall {
  table: string;
  op: string;
  terminal: string | null;
}

const OK: QueryResult = { data: null, error: null };

/**
 * Minimal stand-in for the Supabase query builder: every filter/modifier
 * returns the same chain, and awaiting it resolves whatever `results` holds
 * for `${table}:${op}`. Enough to drive the route end to end without a
 * database, and it records each terminated query so tests can assert that the
 * rollback actually ran.
 */
function createFakeSupabase(results: Record<string, QueryResult>) {
  const calls: RecordedCall[] = [];

  function chainFor(table: string) {
    let op: string | null = null;
    let terminal: string | null = null;

    const result = (): QueryResult => {
      calls.push({ table, op: op ?? "select", terminal });
      const override = results[`${table}:${op ?? "select"}`];
      if (override) return override;
      // Unconfigured reads look like "no rows"; list reads read as empty.
      if ((op ?? "select") === "select" && terminal === null) return { data: [], error: null };
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
      chain[write] = () => {
        op = write;
        return chain;
      };
    }
    chain.select = () => {
      op ??= "select";
      return chain;
    };
    for (const modifier of ["eq", "neq", "not", "is", "in", "order", "limit", "gte", "lte", "match"]) {
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

  const client = {
    auth: {
      getUser: async () => ({ data: { user: { id: USER_ID } }, error: null }),
    },
    from: (table: string) => chainFor(table),
  };

  return { client, calls };
}

const PROFILE = {
  id: "profile-1",
  user_id: USER_ID,
  age: 30,
  gender: "male",
  weight_kg: 80,
  height_cm: 180,
  max_hr: 190,
  experience: "intermediate",
  goals: [],
  preferred_sports: ["gym"],
  training_history_years: 5,
  split_endurance_weight: 0.5,
  date_of_birth: null,
  subscription_tier: "free",
  subscription_status: "inactive",
};

const ACTIVITY_ROW = { id: ACTIVITY_ID, user_id: USER_ID, sport: "gym", started_at: "2026-01-05T08:00:00.000Z" };
const WORKOUT_SCORE_ROW = { id: "score-1", activity_id: ACTIVITY_ID, user_id: USER_ID, sport_index: 700 };

/** Baseline: every write succeeds. Individual tests override one key. */
function happyPathResults(): Record<string, QueryResult> {
  return {
    "profiles:select": { data: PROFILE, error: null },
    "activities:insert": { data: ACTIVITY_ROW, error: null },
    "workout_scores:insert": { data: WORKOUT_SCORE_ROW, error: null },
  };
}

function gymSessionBody() {
  return {
    sport: "gym",
    title: "Push day",
    started_at: "2026-01-05T08:00:00.000Z",
    duration_seconds: 3600,
    rpe: 7,
    bodyweight_kg: 80,
    exercises: [
      {
        exercise_name: "Bench Press",
        muscle_group: "Chest",
        order_index: 0,
        sets: [
          { weight_kg: 100, reps: 5, rpe: 8 },
          { weight_kg: 100, reps: 5, rpe: 8 },
        ],
      },
    ],
  };
}

function postRequest() {
  return new Request("http://localhost/api/activities", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(gymSessionBody()),
  });
}

const createClientMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClientMock(),
}));

async function postWith(results: Record<string, QueryResult>) {
  const { client, calls } = createFakeSupabase(results);
  createClientMock.mockResolvedValue(client);
  const { POST } = await import("./route");
  const response = await POST(postRequest());
  return { response, body: await response.json(), calls };
}

function deletedActivity(calls: RecordedCall[]): boolean {
  return calls.some((c) => c.table === "activities" && c.op === "delete");
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/activities — dependent write failures", () => {
  it("saves and scores the session when every write succeeds", async () => {
    const { response, body, calls } = await postWith(happyPathResults());

    expect(response.status).toBe(200);
    expect(body.score).toEqual(WORKOUT_SCORE_ROW);
    expect(typeof body.sportIndex).toBe("number");
    expect(deletedActivity(calls)).toBe(false);
  });

  it("does not report success when the score insert fails", async () => {
    const { response, body } = await postWith({
      ...happyPathResults(),
      "workout_scores:insert": { data: null, error: { message: "duplicate key" } },
    });

    expect(response.status).toBe(500);
    expect(body.error).toMatch(/could not save this workout/i);
    // The in-memory score must never leak out as if it had been saved.
    expect(body.score).toBeUndefined();
    expect(body.sportIndex).toBeUndefined();
  });

  it("unwinds the activity when the score insert fails", async () => {
    const { calls } = await postWith({
      ...happyPathResults(),
      "workout_scores:insert": { data: null, error: { message: "duplicate key" } },
    });

    expect(deletedActivity(calls)).toBe(true);
  });

  it("unwinds the activity when the exercise insert fails", async () => {
    const { response, body, calls } = await postWith({
      ...happyPathResults(),
      "gym_exercises:insert": { data: null, error: { message: "reps check violation" } },
    });

    expect(response.status).toBe(500);
    expect(body.error).toMatch(/could not save this workout/i);
    expect(deletedActivity(calls)).toBe(true);
    // Failed before scoring, so no score was ever attempted.
    expect(calls.some((c) => c.table === "workout_scores" && c.op === "insert")).toBe(false);
  });

  it("unwinds the activity and its index history when the index history insert fails", async () => {
    const { response, body, calls } = await postWith({
      ...happyPathResults(),
      "split_index_history:insert": { data: null, error: { message: "not null violation" } },
    });

    expect(response.status).toBe(500);
    expect(deletedActivity(calls)).toBe(true);
    expect(body.score).toBeUndefined();
    // split_index_history is ON DELETE SET NULL, so cascading the activity
    // delete is not enough — it has to be deleted explicitly.
    expect(calls.some((c) => c.table === "split_index_history" && c.op === "delete")).toBe(true);
  });

  it("tells the athlete to check their logbook when the unwind itself fails", async () => {
    const { response, body } = await postWith({
      ...happyPathResults(),
      "workout_scores:insert": { data: null, error: { message: "duplicate key" } },
      "activities:delete": { data: null, error: { message: "delete blocked" } },
    });

    expect(response.status).toBe(500);
    expect(body.error).toMatch(/check your logbook/i);
  });

  it("keeps a scored session when only the per-exercise strength rows fail", async () => {
    // Secondary write: the session is already scored and in the index history,
    // so losing this session's per-lift breakdown must not bin the workout.
    const { response, body, calls } = await postWith({
      ...happyPathResults(),
      "strength_scores:insert": { data: null, error: { message: "transient" } },
    });

    expect(response.status).toBe(200);
    expect(body.score).toEqual(WORKOUT_SCORE_ROW);
    expect(deletedActivity(calls)).toBe(false);
    // Logged, not swallowed.
    expect(console.error).toHaveBeenCalledWith(
      "[activities] strength_scores insert failed:",
      "transient"
    );
  });

  it("still rejects an impossible lift before anything is written", async () => {
    const { client, calls } = createFakeSupabase(happyPathResults());
    createClientMock.mockResolvedValue(client);
    const { POST } = await import("./route");

    const body = gymSessionBody();
    body.exercises[0].sets = [{ weight_kg: 900, reps: 5, rpe: 8 }];
    const response = await POST(
      new Request("http://localhost/api/activities", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
    );

    expect(response.status).toBe(400);
    expect(calls.some((c) => c.table === "activities" && c.op === "insert")).toBe(false);
  });
});
