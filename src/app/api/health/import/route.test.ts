import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * POST /api/health/import: what lands, what is skipped, and what is never
 * written twice. The Supabase client is a recording fake in the shape the
 * activities route test uses; scoreAndPersist is stubbed because scoring is
 * its own suite and this one is about the writes around it.
 */

const USER_ID = "user-1";

type QueryResult = { data: unknown; error: { message: string; code?: string } | null };
interface RecordedCall {
  table: string;
  op: string;
  payload?: unknown;
  filters: [string, unknown][];
}

function createFakeSupabase(results: Record<string, QueryResult | ((call: RecordedCall) => QueryResult)>) {
  const calls: RecordedCall[] = [];
  function chainFor(table: string) {
    const call: RecordedCall = { table, op: "select", filters: [] };
    let single = false;
    const result = (): QueryResult => {
      calls.push(call);
      const r = results[`${table}:${call.op}`];
      if (typeof r === "function") return r(call);
      if (r) return r;
      // Unconfigured: a list read is empty, a single-row read is "no row" — as PostgREST answers.
      return { data: call.op === "select" && !single ? [] : null, error: null };
    };
    const chain: Record<string, unknown> = {
      then(resolve: (v: QueryResult) => unknown) {
        return Promise.resolve(resolve(result()));
      },
    };
    for (const write of ["insert", "upsert", "update", "delete"]) {
      chain[write] = (values?: unknown) => {
        call.op = write;
        call.payload = values;
        return chain;
      };
    }
    chain.select = () => chain;
    for (const f of ["eq", "neq", "gte", "lte", "lt", "in", "not", "order", "limit"]) {
      chain[f] = (...args: unknown[]) => {
        call.filters.push([f, args]);
        return chain;
      };
    }
    chain.single = () => {
      single = true;
      return chain;
    };
    chain.maybeSingle = () => {
      single = true;
      return chain;
    };
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

const createClientMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: () => createClientMock() }));

const scoreAndPersistMock = vi.fn(async () => ({ workoutScoreError: null }));
vi.mock("@/lib/activities/score-and-persist", () => ({
  scoreAndPersist: (...args: unknown[]) => scoreAndPersistMock(...(args as [])),
}));

const CONNECTED = {
  data: { connected_at: "2026-10-01T00:00:00.000Z", disconnected_at: null, last_sync_at: null, last_sample_at: null },
  error: null,
};
const PROFILE = { data: { user_id: USER_ID, weight_kg: 80, resting_hr: 55, max_hr: 190, gender: "male", subscription_tier: "free" }, error: null };

function workout(seed: Record<string, unknown> = {}) {
  return {
    uuid: "A1B2C3D4-0000-4000-8000-000000000001",
    activityType: "running",
    start: "2026-10-09T07:00:00.000Z",
    end: "2026-10-09T07:40:00.000Z",
    durationSeconds: 2400,
    distanceMeters: 8000,
    avgHr: 150,
    sourceName: "Apple Watch",
    sourceBundleId: "com.apple.health",
    ...seed,
  };
}

function batch(seed: Record<string, unknown> = {}) {
  return { workouts: [], hrv: [], restingHr: [], bodyMass: [], sleep: [], newestSampleAt: "2026-10-09T08:00:00.000Z", ...seed };
}

async function post(body: unknown, results: Record<string, QueryResult | ((c: RecordedCall) => QueryResult)>) {
  const { client, calls } = createFakeSupabase({
    "health_import_state:select": CONNECTED,
    "profiles:select": PROFILE,
    ...results,
  });
  createClientMock.mockResolvedValue(client);
  const { POST } = await import("./route");
  const response = await POST(
    new Request("http://localhost/api/health/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  );
  return { response, body: await response.json(), calls };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  scoreAndPersistMock.mockClear();
});
afterEach(() => vi.restoreAllMocks());

describe("POST /api/health/import", () => {
  it("refuses a batch when Apple Health is not connected", async () => {
    const { response } = await post(batch(), {
      "health_import_state:select": { data: { connected_at: "x", disconnected_at: "2026-10-05T00:00:00.000Z" }, error: null },
    });
    expect(response.status).toBe(409);
  });

  it("imports a watch run as an apple_health activity and scores it", async () => {
    const { response, body, calls } = await post(batch({ workouts: [workout()] }), {
      "activities:insert": { data: { id: "activity-9" }, error: null },
    });
    expect(response.status).toBe(200);
    expect(body.workouts).toEqual({ imported: 1, skipped: 0, duplicates: 0, failed: 0 });
    const insert = calls.find((c) => c.table === "activities" && c.op === "insert")!;
    expect(insert.payload).toMatchObject({
      user_id: USER_ID,
      sport: "running",
      source: "apple_health",
      external_id: "A1B2C3D4-0000-4000-8000-000000000001",
      distance_meters: 8000,
      avg_heart_rate: 150,
      is_draft: false,
    });
    expect(scoreAndPersistMock).toHaveBeenCalledTimes(1);
    const imports = calls.find((c) => c.table === "health_imports" && c.op === "upsert")!;
    expect(imports.payload).toEqual([
      expect.objectContaining({ sample_uuid: "A1B2C3D4-0000-4000-8000-000000000001", kind: "workout", target_table: "activities", target_id: "activity-9" }),
    ]);
  });

  it("does not import a sample it has already imported", async () => {
    const { body, calls } = await post(batch({ workouts: [workout()] }), {
      "health_imports:select": { data: [{ sample_uuid: "A1B2C3D4-0000-4000-8000-000000000001" }], error: null },
    });
    expect(body.workouts.imported).toBe(0);
    expect(calls.filter((c) => c.table === "activities" && c.op === "insert")).toHaveLength(0);
  });

  it("treats a run the athlete already logged around the same minute as that run", async () => {
    const { body, calls } = await post(batch({ workouts: [workout()] }), {
      "activities:select": { data: { id: "manual-run" }, error: null },
    });
    expect(body.workouts).toMatchObject({ imported: 0, duplicates: 1 });
    expect(calls.filter((c) => c.table === "activities" && c.op === "insert")).toHaveLength(0);
    const imports = calls.find((c) => c.table === "health_imports" && c.op === "upsert")!;
    expect(imports.payload).toEqual([expect.objectContaining({ target_table: "activities", target_id: "manual-run" })]);
  });

  it("skips a strength workout rather than logging an empty gym session, and remembers it", async () => {
    const { body, calls } = await post(batch({ workouts: [workout({ activityType: "strength" })] }), {});
    expect(body.workouts).toMatchObject({ imported: 0, skipped: 1 });
    expect(calls.filter((c) => c.table === "activities")).toHaveLength(0);
    const imports = calls.find((c) => c.table === "health_imports" && c.op === "upsert")!;
    expect(imports.payload).toEqual([expect.objectContaining({ kind: "workout", target_table: null })]);
  });

  it("never re-imports the app's own HealthKit workout session", async () => {
    const { body } = await post(batch({ workouts: [workout({ sourceBundleId: "co.uk.splitindex.app" })] }), {});
    expect(body.workouts).toMatchObject({ imported: 0, skipped: 1 });
  });

  it("writes a day's HRV onto that day's snapshot, averaged, as apple_health", async () => {
    const { body, calls } = await post(
      batch({
        hrv: [
          { uuid: "A1B2C3D4-0000-4000-8000-0000000000A1", date: "2026-10-09T02:00:00.000Z", value: 40 },
          { uuid: "A1B2C3D4-0000-4000-8000-0000000000A2", date: "2026-10-09T05:00:00.000Z", value: 60 },
        ],
      }),
      { "recovery_snapshots:insert": { data: { id: "snap-1" }, error: null } }
    );
    expect(body.hrvDays).toBe(1);
    const update = calls.find((c) => c.table === "recovery_snapshots" && c.op === "update")!;
    expect(update.payload).toEqual({ hrv_ms: 50, source: "apple_health" });
  });

  it("leaves an HRV the athlete typed for that day alone", async () => {
    const { body, calls } = await post(
      batch({ hrv: [{ uuid: "A1B2C3D4-0000-4000-8000-0000000000A1", date: "2026-10-09T02:00:00.000Z", value: 40 }] }),
      { "recovery_snapshots:select": { data: { id: "snap-typed", hrv_ms: 72, source: "manual" }, error: null } }
    );
    expect(body.hrvDays).toBe(0);
    expect(calls.filter((c) => c.table === "recovery_snapshots" && c.op === "update")).toHaveLength(0);
    // Still recorded as seen, so it is not reconsidered every sync.
    const imports = calls.find((c) => c.table === "health_imports" && c.op === "upsert")!;
    expect(imports.payload).toEqual([expect.objectContaining({ kind: "hrv", target_id: "snap-typed" })]);
  });

  it("records bodyweight in body_metrics and copies the newest to the profile", async () => {
    const { body, calls } = await post(
      batch({
        bodyMass: [
          { uuid: "A1B2C3D4-0000-4000-8000-0000000000B1", date: "2026-10-08T07:00:00.000Z", value: 79.26 },
          { uuid: "A1B2C3D4-0000-4000-8000-0000000000B2", date: "2026-10-09T07:00:00.000Z", value: 78.44 },
        ],
      }),
      { "body_metrics:insert": { data: { id: "bm-1" }, error: null } }
    );
    expect(body.bodyMass).toBe(2);
    const metrics = calls.filter((c) => c.table === "body_metrics" && c.op === "insert");
    expect(metrics.map((c) => (c.payload as { weight_kg: number }).weight_kg)).toEqual([79.3, 78.4]);
    const profile = calls.find((c) => c.table === "profiles" && c.op === "update")!;
    expect(profile.payload).toEqual({ weight_kg: 78.4 });
  });

  it("throws away a scale glitch rather than storing it", async () => {
    const { body, calls } = await post(
      batch({ bodyMass: [{ uuid: "A1B2C3D4-0000-4000-8000-0000000000B9", date: "2026-10-09T07:00:00.000Z", value: 7.8 }] }),
      {}
    );
    expect(body.bodyMass).toBe(0);
    expect(calls.filter((c) => c.table === "body_metrics")).toHaveLength(0);
    expect(calls.filter((c) => c.table === "profiles" && c.op === "update")).toHaveLength(0);
  });

  it("advances the cursor to the newest sample and stamps the sync", async () => {
    const { calls } = await post(batch(), {});
    const state = calls.find((c) => c.table === "health_import_state" && c.op === "update")!;
    expect(state.payload).toMatchObject({ last_sample_at: "2026-10-09T08:00:00.000Z" });
    expect((state.payload as { last_sync_at: string }).last_sync_at).toBeTruthy();
  });

  it("refuses a key nobody validated", async () => {
    const { response } = await post({ ...batch(), steps: [] }, {});
    expect(response.status).toBe(400);
  });
});
