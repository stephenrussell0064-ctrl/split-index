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
  /** What a write was handed — the only way to assert on what actually reaches the database. */
  payload?: unknown;
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
    let payload: unknown;

    const result = (): QueryResult => {
      calls.push({ table, op: op ?? "select", terminal, payload });
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

function postRequest(payload: unknown = gymSessionBody()) {
  return new Request("http://localhost/api/activities", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

const createClientMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClientMock(),
}));

async function postWith(results: Record<string, QueryResult>, payload?: unknown) {
  const { client, calls } = createFakeSupabase(results);
  createClientMock.mockResolvedValue(client);
  const { POST } = await import("./route");
  const response = await POST(postRequest(payload));
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

/**
 * The route polyline is the one field on an activity that is a physical
 * address. `activities.metadata` is returned in full to any accepted friend by
 * row-level security, so whatever this endpoint writes into `metadata.route`
 * is readable by a friend with the public anon key — no app screen involved.
 * These tests pin the guarantee at the only place that can hold it: the write.
 */
describe("POST /api/activities — route privacy zone", () => {
  const HOME_LAT = 51.5;
  const HOME_LNG = -0.12;
  const DEG_PER_M = 1 / 111_194.93;
  /** 3km due north, one point every 50m, starting at the athlete's door. */
  const FULL_ROUTE: [number, number][] = Array.from({ length: 61 }, (_, i) => [
    HOME_LAT + i * 50 * DEG_PER_M,
    HOME_LNG,
  ]);

  function gpsRunBody(route: [number, number][] = FULL_ROUTE) {
    return {
      sport: "running",
      title: "Evening run",
      started_at: "2026-01-05T18:00:00.000Z",
      duration_seconds: 900,
      distance_meters: 3000,
      elevation_meters: 12,
      avg_heart_rate: 150,
      session_type: "easy",
      source: "gps",
      route,
    };
  }

  function insertedActivity(calls: RecordedCall[]): Record<string, unknown> {
    const call = calls.find((c) => c.table === "activities" && c.op === "insert");
    return (call?.payload ?? {}) as Record<string, unknown>;
  }

  function storedRoute(calls: RecordedCall[]): [number, number][] | undefined {
    const metadata = insertedActivity(calls).metadata as { route?: [number, number][] } | undefined;
    return metadata?.route;
  }

  function metersFromHome([lat, lng]: [number, number]): number {
    return Math.hypot((lat - HOME_LAT) / DEG_PER_M, ((lng - HOME_LNG) / DEG_PER_M) * Math.cos((HOME_LAT * Math.PI) / 180));
  }

  it("never writes the athlete's start or finish into a friend-readable column", async () => {
    const { response, calls } = await postWith(happyPathResults(), gpsRunBody());
    expect(response.status).toBe(200);

    const route = storedRoute(calls)!;
    expect(route.length).toBeGreaterThan(2);
    // The submitted route began and ended on the doorstep; the stored one does
    // not go near it.
    expect(metersFromHome(FULL_ROUTE[0])).toBeLessThan(1);
    expect(metersFromHome(route[0])).toBeGreaterThan(190);
    expect(metersFromHome(route[route.length - 1])).toBeGreaterThan(190);
    // And the finish, 3km up the road, is trimmed by the same amount.
    const finish = FULL_ROUTE[FULL_ROUTE.length - 1];
    expect(Math.abs(route[route.length - 1][0] - finish[0]) / DEG_PER_M).toBeGreaterThan(190);
  });

  it("does not shorten the recorded distance, elevation or duration", async () => {
    // The polyline is a picture; the numbers come from the live GPS track and
    // are what the athlete is scored on. Trimming the picture must not touch
    // them, or every athlete quietly loses 400m per run.
    const { body, calls } = await postWith(happyPathResults(), gpsRunBody());
    const inserted = insertedActivity(calls);

    expect(inserted.distance_meters).toBe(3000);
    expect(inserted.duration_seconds).toBe(900);
    expect(inserted.elevation_meters).toBe(12);
    expect(typeof body.sportIndex).toBe("number");
    expect(body.sportIndex).toBeGreaterThan(0);
  });

  it("saves the session with no map rather than refusing a run inside its own privacy zone", async () => {
    // 300m: swallowed whole by the 200m-each-end zone. The run still saves.
    const shortRoute: [number, number][] = Array.from({ length: 13 }, (_, i) => [
      HOME_LAT + i * 25 * DEG_PER_M,
      HOME_LNG,
    ]);
    const { response, calls } = await postWith(happyPathResults(), {
      ...gpsRunBody(shortRoute),
      distance_meters: 300,
      duration_seconds: 90,
    });

    expect(response.status).toBe(200);
    expect(storedRoute(calls)).toBeUndefined();
    expect(insertedActivity(calls).distance_meters).toBe(300);
  });

  it("still stores nothing for a run that sent no route at all", async () => {
    const withoutRoute: Record<string, unknown> = { ...gpsRunBody() };
    delete withoutRoute.route;
    const { response, calls } = await postWith(happyPathResults(), withoutRoute);
    expect(response.status).toBe(200);
    expect(storedRoute(calls)).toBeUndefined();
  });
});
