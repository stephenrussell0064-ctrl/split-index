import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * POST /api/activities/[id]/unmerge — the undo that makes merging safe to
 * offer at all.
 *
 * Merging deletes real training history, so the promise this route has to keep
 * is narrow and total: the sessions come back as they were, under the ids they
 * had, each scored again on its own.
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
    for (const m of ["eq", "neq", "not", "is", "in", "order", "limit", "gte", "lte", "range", "match"]) {
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
    client: {
      auth: { getUser: async () => ({ data: { user: { id: USER_ID } }, error: null }) },
      from: (table: string) => chainFor(table),
    },
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

const SNAPSHOT_A = {
  id: "leg-a",
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
  is_partial_track: false,
  notes: null,
  metadata: {},
  wasSurvivor: true,
};
const SNAPSHOT_B = {
  ...SNAPSHOT_A,
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
  wasSurvivor: false,
};

/** The merged row as the merge route would have left it. */
const MERGED_ROW = {
  id: "leg-a",
  user_id: USER_ID,
  sport: "running",
  title: "Morning run",
  started_at: "2026-01-05T08:00:00.000Z",
  duration_seconds: 1800,
  distance_meters: 7000,
  is_draft: false,
  metadata: {
    merge: {
      version: 1,
      mergedAt: "2026-01-05T09:00:00.000Z",
      totalGapSeconds: 60,
      sources: [SNAPSHOT_A, SNAPSHOT_B],
    },
  },
};

const createClientMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClientMock(),
}));

async function unmergeWith(results: Record<string, QueryResult>) {
  const { client, calls } = createFakeSupabase(results);
  createClientMock.mockResolvedValue(client);
  const { POST } = await import("./route");
  const response = await POST(new Request("http://localhost/x", { method: "POST" }), {
    params: Promise.resolve({ id: "leg-a" }),
  });
  return { response, body: await response.json(), calls };
}

function baseResults(): Record<string, QueryResult> {
  return {
    "activities:select:single": { data: MERGED_ROW, error: null },
    "profiles:select": { data: PROFILE, error: null },
    "workout_scores:insert": { data: { id: "score-1" }, error: null },
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

describe("POST /api/activities/[id]/unmerge", () => {
  it("puts the surviving session back to its own pre-merge numbers", async () => {
    const { response, calls } = await unmergeWith(baseResults());
    expect(response.status).toBe(200);

    const update = find(calls, "activities", "update")[0].payload as Record<string, unknown>;
    expect(update.duration_seconds).toBe(1200);
    expect(update.distance_meters).toBe(4000);
    expect(update.session_type).toBe("easy");
    // Restoring the pre-merge metadata is what drops the merge record, so the
    // same session cannot be unmerged a second time.
    expect(update.metadata).toEqual({});
    expect("wasSurvivor" in update).toBe(false);
  });

  it("brings the absorbed sessions back under their original ids", async () => {
    const { calls } = await unmergeWith(baseResults());
    const inserted = find(calls, "activities", "insert")[0].payload as Array<
      Record<string, unknown>
    >;
    expect(inserted).toHaveLength(1);
    expect(inserted[0].id).toBe("leg-b");
    expect(inserted[0].duration_seconds).toBe(600);
    expect(inserted[0].user_id).toBe(USER_ID);
    expect(inserted[0].is_draft).toBe(false);
  });

  it("re-scores every restored session, oldest first", async () => {
    const { calls } = await unmergeWith(baseResults());
    const scores = find(calls, "workout_scores", "insert").map(
      (c) => (c.payload as { activity_id: string }).activity_id
    );
    expect(scores).toEqual(["leg-a", "leg-b"]);
    expect(
      find(calls, "split_index_history", "insert").map(
        (c) => (c.payload as { activity_id: string }).activity_id
      )
    ).toEqual(["leg-a", "leg-b"]);
  });

  it("drops the record the merged session was holding", async () => {
    const { calls } = await unmergeWith(baseResults());
    expect(find(calls, "personal_records", "delete").length).toBeGreaterThan(0);
  });

  it("refuses a session that was never merged", async () => {
    const { response, body } = await unmergeWith({
      ...baseResults(),
      "activities:select:single": {
        data: { ...MERGED_ROW, metadata: {} },
        error: null,
      },
    });
    expect(response.status).toBe(400);
    expect(body.error).toMatch(/not created by merging/i);
  });

  it("says so plainly when the other halves could not be brought back", async () => {
    const { response, body } = await unmergeWith({
      ...baseResults(),
      "activities:insert": { data: null, error: { message: "duplicate key" } },
    });
    expect(response.status).toBe(500);
    expect(body.error).toMatch(/check your logbook/i);
  });
});
