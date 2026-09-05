import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Write-path integrity for PATCH /api/activities/[id] — editing a logged
 * session.
 *
 * An edit REPLACES rather than updates: the exercise rows are deleted and
 * re-inserted, and the score row is deleted and re-inserted. Both replacements
 * used to read no error at all, and both had already deleted by the time they
 * could have. So any failure in either left the athlete with a session that
 * had lost its exercises, its score, or both — behind a 200 and a success
 * screen, with nothing anywhere saying so.
 *
 * That is the shape of the recurring "logged a gym exercise and the strength
 * score is missing again" report: not a score that computed wrongly, but a
 * write that failed in silence after destroying what it was replacing. These
 * tests pin that neither replacement can be silent again.
 */

const USER_ID = "user-1";
const ACTIVITY_ID = "activity-1";

type QueryResult = { data: unknown; error: { message: string; code?: string } | null };

interface RecordedCall {
  table: string;
  op: string;
  terminal: string | null;
  payload?: unknown;
}

const OK: QueryResult = { data: null, error: null };

/** Every column `gym_exercises` has once every migration has been applied. */
const GYM_EXERCISE_COLUMNS = [
  "activity_id",
  "exercise_name",
  "muscle_group",
  "weight_kg",
  "sets",
  "reps",
  "rpe",
  "set_details",
  "estimated_1rm_kg",
  "order_index",
  "attachment",
] as const;

function unknownColumnError(table: string, column: string): QueryResult {
  return {
    data: null,
    error: {
      code: "PGRST204",
      message: `Could not find the '${column}' column of '${table}' in the schema cache`,
    },
  };
}

/**
 * Stand-in for the Supabase query builder. Overrides are keyed `table:op` and,
 * more specifically, `table:op:terminal` — this route reads `activities` as a
 * single row (the session being edited), as a maybeSingle (the observed max
 * HR) and as a list (the scoring history), and those must answer differently.
 *
 * `columns` models a database that is BEHIND the migrations: a write naming a
 * column the table does not have is rejected whole, exactly as PostgREST
 * rejects it.
 */
function createFakeSupabase(
  results: Record<string, QueryResult>,
  columns: Record<string, readonly string[]> = {}
) {
  const calls: RecordedCall[] = [];

  function chainFor(table: string) {
    let op: string | null = null;
    let terminal: string | null = null;
    let payload: unknown;

    const result = (): QueryResult => {
      const effectiveOp = op ?? "select";
      calls.push({ table, op: effectiveOp, terminal, payload });

      const known = columns[table];
      if (known && (effectiveOp === "insert" || effectiveOp === "upsert")) {
        const rows = (Array.isArray(payload) ? payload : [payload]) as Record<string, unknown>[];
        for (const row of rows) {
          const absent = Object.keys(row ?? {}).find((c) => !known.includes(c));
          if (absent) return unknownColumnError(table, absent);
        }
      }

      const override =
        results[`${table}:${effectiveOp}:${terminal}`] ?? results[`${table}:${effectiveOp}`];
      if (override) return override;
      if (effectiveOp === "select" && terminal === null) return { data: [], error: null };
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

const ACTIVITY_ROW = {
  id: ACTIVITY_ID,
  user_id: USER_ID,
  sport: "gym",
  started_at: "2026-01-05T08:00:00.000Z",
  metadata: {},
};
const WORKOUT_SCORE_ROW = {
  id: "score-1",
  activity_id: ACTIVITY_ID,
  user_id: USER_ID,
  sport_index: 700,
};

/** What the athlete had logged before the edit — the rows the edit destroys. */
const EXISTING_EXERCISE_ROWS = [
  {
    id: "ex-1",
    activity_id: ACTIVITY_ID,
    exercise_name: "Bench Press",
    muscle_group: "Chest",
    weight_kg: 90,
    sets: 3,
    reps: 8,
    rpe: 8,
    set_details: [{ weight_kg: 90, reps: 8, rpe: 8 }],
    estimated_1rm_kg: 114,
    order_index: 0,
  },
];

function happyPathResults(): Record<string, QueryResult> {
  return {
    "activities:select:single": { data: ACTIVITY_ROW, error: null },
    "activities:update": { data: ACTIVITY_ROW, error: null },
    "profiles:select": { data: PROFILE, error: null },
    "gym_exercises:select": { data: EXISTING_EXERCISE_ROWS, error: null },
    "workout_scores:insert": { data: WORKOUT_SCORE_ROW, error: null },
  };
}

function editBody() {
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

const createClientMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClientMock(),
}));

async function patchWith(
  results: Record<string, QueryResult>,
  columns: Record<string, readonly string[]> = {},
  payload: unknown = editBody()
) {
  const { client, calls } = createFakeSupabase(results, columns);
  createClientMock.mockResolvedValue(client);
  const { PATCH } = await import("./route");
  const response = await PATCH(
    new Request(`http://localhost/api/activities/${ACTIVITY_ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
    { params: Promise.resolve({ id: ACTIVITY_ID }) }
  );
  return { response, body: await response.json(), calls };
}

function exerciseInserts(calls: RecordedCall[]): RecordedCall[] {
  return calls.filter((c) => c.table === "gym_exercises" && c.op === "insert");
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PATCH /api/activities/[id] — replacing a session's exercises", () => {
  it("replaces the exercises and rescores when every write succeeds", async () => {
    const { response, body, calls } = await patchWith(happyPathResults(), {
      gym_exercises: GYM_EXERCISE_COLUMNS,
    });

    expect(response.status).toBe(200);
    expect(body.score).toEqual(WORKOUT_SCORE_ROW);
    const inserted = exerciseInserts(calls);
    expect(inserted).toHaveLength(1);
    expect((inserted[0].payload as Record<string, unknown>[])[0].weight_kg).toBe(100);
  });

  it("still saves the edit when the database is behind on the attachment migration", async () => {
    // Same defect as the create path: an unapplied additive migration must not
    // cost the athlete their edit, and must not wipe their exercises either.
    const { response, calls } = await patchWith(happyPathResults(), {
      gym_exercises: GYM_EXERCISE_COLUMNS.filter((c) => c !== "attachment"),
    });

    expect(response.status).toBe(200);
    const inserted = exerciseInserts(calls);
    expect(inserted).toHaveLength(2);
    const persisted = (inserted[1].payload as Record<string, unknown>[])[0];
    expect(persisted).not.toHaveProperty("attachment");
    expect(persisted.exercise_name).toBe("Bench Press");
  });

  it("does not leave the session with no exercises when the replacement insert fails", async () => {
    // The delete has already run by this point, so "do nothing" means the
    // athlete's exercises are gone. They have to go back.
    const { response, body, calls } = await patchWith({
      ...happyPathResults(),
      "gym_exercises:insert": { data: null, error: { message: "reps check violation" } },
    });

    expect(response.status).toBe(500);
    expect(body.error).toMatch(/could not save these changes/i);

    const restore = exerciseInserts(calls).at(-1);
    expect(restore?.payload).toEqual(EXISTING_EXERCISE_ROWS);
  });

  it("says so when the original exercises could not be put back either", async () => {
    const { response, body } = await patchWith({
      ...happyPathResults(),
      "gym_exercises:insert": { data: null, error: { message: "reps check violation" } },
    });

    expect(response.status).toBe(500);
    // Both restore attempt and replacement fail here, since the override
    // applies to every gym_exercises insert.
    expect(body.error).toMatch(/check your logbook/i);
  });
});

describe("PATCH /api/activities/[id] — rescoring", () => {
  it("does not report success when the session ends up with no score row", async () => {
    // Rescoring deletes the old score before inserting the new one, so a
    // failure here is not "the score stayed the same" — it is "the session has
    // no score". Answering 200 is what made the missing strength score
    // invisible and therefore recurring.
    const { response, body } = await patchWith(
      {
        ...happyPathResults(),
        "workout_scores:insert": { data: null, error: { message: "duplicate key" } },
      },
      { gym_exercises: GYM_EXERCISE_COLUMNS }
    );

    expect(response.status).toBe(500);
    expect(body.error).toMatch(/could not rescore/i);
    // The in-memory score must never leak out as if it had been saved.
    expect(body.score).toBeUndefined();
    expect(body.sportIndex).toBeUndefined();
  });

  it("logs which activity lost its score", async () => {
    await patchWith(
      {
        ...happyPathResults(),
        "workout_scores:insert": { data: null, error: { message: "duplicate key" } },
      },
      { gym_exercises: GYM_EXERCISE_COLUMNS }
    );

    expect(console.error).toHaveBeenCalledWith(
      "[score-and-persist] workout_scores insert failed for activity",
      ACTIVITY_ID,
      "duplicate key"
    );
  });
});
