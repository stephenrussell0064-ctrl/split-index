import { describe, expect, it, vi } from "vitest";

// Hoisted: vi.mock runs before module scope, so the mock cannot close over a
// const declared later in the file.
const { createClientMock } = vi.hoisted(() => ({ createClientMock: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => createClientMock() }));
import { createActivitySchema, gymSetSchema } from "./schemas/activity";
import { leaderboardQuerySchema } from "./schemas/leaderboard";
import { validateIntakeValues } from "./schemas/intake";
import { parseBody, parseQuery } from "./boundary";
import {
  BOUND_BODYWEIGHT_KG,
  BOUND_DURATION_S,
  BOUND_HR_BPM,
  BOUND_REPS,
  MAX_REQUEST_BODY_BYTES,
  MAX_SETS_PER_SESSION,
} from "@/lib/security/config";

/**
 * WP3 acceptance — the fuzz sweep.
 *
 * "Posting malformed, out-of-range, wrong-type and oversized payloads,
 * asserting a 4xx and no database write in every case."
 *
 * The last clause is the one worth writing carefully. A test that only checks
 * the status code passes just as happily against a handler that returns 400
 * AFTER inserting the row, which is the failure this is supposed to catch. So
 * the route-level block below counts writes, and expects zero.
 */

/** Values that are not the thing they are standing in for. */
const HOSTILE_SCALARS: [string, unknown][] = [
  ["null", null],
  ["undefined", undefined],
  ["empty string", ""],
  ["numeric string", "42"],
  ["boolean", true],
  ["array", [1, 2]],
  ["object", { a: 1 }],
  ["NaN", Number.NaN],
  ["Infinity", Number.POSITIVE_INFINITY],
  ["-Infinity", Number.NEGATIVE_INFINITY],
  // 1e999 is not exotic — it is what a JSON body containing that literal
  // parses to, and it survives arithmetic as Infinity rather than throwing.
  ["1e999", 1e999],
  ["negative", -1],
  ["zero", 0],
  ["huge", 1e12],
];

function validGymActivity() {
  return {
    sport: "gym" as const,
    started_at: "2026-01-05T18:00:00.000Z",
    duration_seconds: 3600,
    bodyweight_kg: 82,
    exercises: [
      {
        exercise_name: "Back Squat",
        muscle_group: "legs",
        order_index: 0,
        sets: [{ weight_kg: 100, reps: 5 }],
      },
    ],
  };
}

function validRun() {
  return {
    sport: "running" as const,
    started_at: "2026-01-05T18:00:00.000Z",
    duration_seconds: 1800,
    distance_meters: 5000,
    avg_heart_rate: 150,
  };
}

describe("fuzz — the fields that reach the scoring engine", () => {
  /**
   * Bodyweight is the one the brief singles out and the reason the engine is
   * worth protecting: it sits in a denominator in relative_strength. A zero
   * divides; a 1 produces a strength score two orders of magnitude wrong,
   * stored, and then read back as history by every later estimate for that
   * athlete. None of that throws — it just quietly poisons a curve.
   */
  it.each(HOSTILE_SCALARS)("rejects bodyweight_kg = %s", (_label, value) => {
    const result = createActivitySchema.safeParse({
      ...validGymActivity(),
      bodyweight_kg: value,
    });
    // undefined is the one legitimate value here: bodyweight is optional, and
    // the handler falls back to the profile's stored weight.
    if (value === undefined) {
      expect(result.success).toBe(true);
      return;
    }
    expect(result.success).toBe(false);
  });

  it("rejects a bodyweight just outside the plausible band, in both directions", () => {
    const [min, max] = BOUND_BODYWEIGHT_KG;
    for (const v of [min - 0.1, max + 0.1]) {
      expect(
        createActivitySchema.safeParse({ ...validGymActivity(), bodyweight_kg: v }).success
      ).toBe(false);
    }
    for (const v of [min, max]) {
      expect(
        createActivitySchema.safeParse({ ...validGymActivity(), bodyweight_kg: v }).success
      ).toBe(true);
    }
  });

  it("rejects out-of-range reps and load per set", () => {
    const [, maxReps] = BOUND_REPS;
    for (const bad of [
      { weight_kg: 100, reps: 0 },
      { weight_kg: 100, reps: maxReps + 1 },
      { weight_kg: 100, reps: 2.5 },
      { weight_kg: -1, reps: 5 },
      { weight_kg: 1e6, reps: 5 },
      { weight_kg: Number.NaN, reps: 5 },
    ]) {
      expect(gymSetSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("rejects an implausible heart rate but keeps the band's edges", () => {
    const [min, max] = BOUND_HR_BPM;
    for (const v of [min - 1, max + 1, 0, -5, 1e9]) {
      expect(
        createActivitySchema.safeParse({ ...validRun(), avg_heart_rate: v }).success
      ).toBe(false);
    }
    for (const v of [min, max]) {
      expect(
        createActivitySchema.safeParse({ ...validRun(), avg_heart_rate: v }).success
      ).toBe(true);
    }
  });

  it("rejects a duration longer than a day or shorter than a second", () => {
    const [min, max] = BOUND_DURATION_S;
    for (const v of [min - 1, max + 1, -1]) {
      expect(
        createActivitySchema.safeParse({ ...validRun(), duration_seconds: v }).success
      ).toBe(false);
    }
  });

  it("never silently clamps — an out-of-range value is refused, not rounded in", () => {
    // The distinction this whole work package turns on. A clamp is a
    // fabricated data point the athlete never entered, sitting in a history
    // that later estimates are fitted against.
    const parsed = createActivitySchema.safeParse({
      ...validGymActivity(),
      bodyweight_kg: 5_000,
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0].path).toEqual(["bodyweight_kg"]);
    }
  });
});

describe("fuzz — shape and structure", () => {
  it("rejects a body that is not an object at all", () => {
    for (const v of [null, undefined, 42, "string", true, [] as unknown]) {
      expect(createActivitySchema.safeParse(v).success).toBe(false);
    }
  });

  it("rejects an unknown sport rather than defaulting to one", () => {
    expect(
      createActivitySchema.safeParse({ ...validRun(), sport: "quidditch" }).success
    ).toBe(false);
  });

  it("rejects unknown keys, which is how a renamed field gets noticed", () => {
    expect(
      createActivitySchema.safeParse({ ...validRun(), user_id: "someone-else" }).success
    ).toBe(false);
  });

  it("rejects a gym session with no exercises", () => {
    const { exercises: _dropped, ...withoutExercises } = validGymActivity();
    expect(createActivitySchema.safeParse(withoutExercises).success).toBe(false);
  });

  it("rejects more sets in one session than a session can hold", () => {
    const oversized = {
      ...validGymActivity(),
      exercises: [
        {
          exercise_name: "Back Squat",
          muscle_group: "legs",
          order_index: 0,
          sets: Array.from({ length: MAX_SETS_PER_SESSION + 1 }, () => ({
            weight_kg: 100,
            reps: 5,
          })),
        },
      ],
    };
    expect(createActivitySchema.safeParse(oversized).success).toBe(false);
  });

  it("rejects a date that is not a date", () => {
    for (const v of ["", "not-a-date", "2026-13-45", 0, null]) {
      expect(
        createActivitySchema.safeParse({ ...validRun(), started_at: v }).success
      ).toBe(false);
    }
  });
});

describe("fuzz — the boundary helpers", () => {
  function bodyRequest(raw: string, contentLength?: number): Request {
    return new Request("http://localhost/api/activities", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "content-length": String(contentLength ?? raw.length),
      },
      body: raw,
    });
  }

  it("refuses an oversized body with a 413 before parsing it", async () => {
    const huge = JSON.stringify({ notes: "x".repeat(MAX_REQUEST_BODY_BYTES + 100) });
    const result = await parseBody(bodyRequest(huge), createActivitySchema);
    expect(result.response?.status).toBe(413);
  });

  it("refuses an oversized body even when Content-Length lies about it", async () => {
    // Content-Length is a claim, not a fact, and a chunked request need not
    // send one at all.
    const huge = JSON.stringify({ notes: "x".repeat(MAX_REQUEST_BODY_BYTES + 100) });
    const result = await parseBody(bodyRequest(huge, 10), createActivitySchema);
    expect(result.response?.status).toBe(413);
  });

  it("returns 400 for malformed JSON rather than throwing", async () => {
    for (const raw of ["{", "", "not json", "[1,2", '{"a":}']) {
      const result = await parseBody(bodyRequest(raw), createActivitySchema);
      expect(result.response?.status, raw).toBe(400);
    }
  });

  it("carries a field-level message the client can render next to the input", async () => {
    const raw = JSON.stringify({ ...validRun(), avg_heart_rate: 900 });
    const result = await parseBody(bodyRequest(raw), createActivitySchema);
    expect(result.response?.status).toBe(400);
    const json = (await result.response!.json()) as {
      error: string;
      fields: { path: string; message: string }[];
    };
    expect(json.fields[0].path).toBe("avg_heart_rate");
    expect(json.fields[0].message).toMatch(/heart rate/i);
  });

  it("leaks nothing about the database in a rejection", async () => {
    const raw = JSON.stringify({ ...validRun(), avg_heart_rate: 900 });
    const result = await parseBody(bodyRequest(raw), createActivitySchema);
    const text = JSON.stringify(await result.response!.json());
    /*
     * WP5's rule, at the boundary that produces most of the app's error
     * responses: no stack frame, no filesystem path, no driver or table name.
     *
     * Matching a bare "at " was the first version of this and it was wrong —
     * it fires on "must be at most 230", which is exactly the field message
     * we want to keep. A stack frame is "\n    at ", so that is what to look
     * for.
     */
    expect(text).not.toMatch(/\\n\s+at /);
    for (const leak of ["node_modules", "supabase", "postgres", "PostgrestError", "/src/"]) {
      expect(text.toLowerCase()).not.toContain(leak.toLowerCase());
    }
  });
});

describe("fuzz — leaderboard query parameters", () => {
  function queryRequest(qs: string): Request {
    return new Request(`http://localhost/api/social/leaderboard?${qs}`);
  }

  it.each([
    "period=nonsense",
    "scope=nonsense",
    "metric=nonsense",
    "country=NOTACOUNTRY",
    "ageBracket=99-100",
    "weightClass=featherweight",
  ])("rejects ?%s", (qs) => {
    const result = parseQuery(queryRequest(qs), leaderboardQuerySchema);
    expect(result.response?.status).toBe(400);
  });

  it("ignores an unknown parameter rather than failing the request", () => {
    // The leaderboard URL carries UI state — a selected tab, a scroll anchor —
    // that never reaches a query. `period[]=weekly` is that case: an unknown
    // key, so it is ignored and `period` falls back to its default. Rejecting
    // would break links without protecting anything.
    const result = parseQuery(queryRequest("period[]=weekly"), leaderboardQuerySchema);
    expect(result.response).toBeUndefined();
    expect(result.data?.period).toBe("all_time");
  });

  it("applies the documented defaults when nothing is supplied", () => {
    const result = parseQuery(queryRequest(""), leaderboardQuerySchema);
    expect(result.data).toMatchObject({
      period: "all_time",
      scope: "bracket",
      metric: "split",
    });
  });
});

describe("fuzz — the health intake", () => {
  /**
   * The health screen is the one place a coerced value is genuinely dangerous.
   * "no" is a truthy string: read loosely it becomes YES and refers a healthy
   * athlete to a doctor, or is dropped and loses a real YES. Neither is
   * acceptable for a question about chest pain, so nothing is coerced.
   */
  it.each([["string no", "no"], ["string yes", "yes"], ["zero", 0], ["one", 1], ["empty", ""]])(
    "refuses %s as an answer to a PAR-Q question",
    (_label, value) => {
      const { errors } = validateIntakeValues("health", { parq_positive: value });
      expect(errors).toHaveLength(1);
      expect(errors[0].path).toBe("parq_positive");
    }
  );

  it("accepts a real boolean", () => {
    const { values, errors } = validateIntakeValues("health", {
      parq_positive: true,
      chest_pain_on_exertion: false,
    });
    expect(errors).toEqual([]);
    expect(values).toEqual({ parq_positive: true, chest_pain_on_exertion: false });
  });

  it("rejects injury sites that are not a list of short tags", () => {
    for (const bad of ["knee", 42, [{ site: "knee" }], ["x".repeat(200)]]) {
      const { errors } = validateIntakeValues("health", { injury_sites: bad });
      expect(errors.length, JSON.stringify(bad)).toBeGreaterThan(0);
    }
  });

  it("rejects an out-of-range target lift", () => {
    const { errors } = validateIntakeValues("goal", { target_squat_kg: 100_000 });
    expect(errors).toHaveLength(1);
  });

  it("reports a bad value rather than dropping it silently", () => {
    // Dropping would tell the athlete their answer saved when it did not.
    const { values, errors } = validateIntakeValues("health", {
      parq_positive: "no",
      chest_pain_on_exertion: false,
    });
    expect(errors).toHaveLength(1);
    expect(values).not.toHaveProperty("parq_positive");
  });
});

/**
 * Route level, where "no database write" can actually be asserted.
 *
 * The schema tests above prove the shapes are refused. This proves the handler
 * refuses them before it touches the database — which is a different claim, and
 * the one a status-code-only test would miss.
 */
describe("fuzz — POST /api/activities writes nothing on a bad payload", () => {
  const writes: string[] = [];

  /**
   * The fake has to hand back a real-looking profile.
   *
   * The first version returned null for every read, which made the handler
   * bail with "Profile not found" before it reached a single write — so the
   * whole block passed against the UNVALIDATED handler too, proving nothing.
   * A test that cannot fail is worse than no test, because it is counted.
   * With a profile present the handler runs on to the insert, and validation
   * is then the only thing standing between a hostile payload and the table.
   */
  const PROFILE = {
    user_id: "user-1",
    weight_kg: 82,
    gender: "male",
    age: 30,
    max_hr: 190,
    subscription_tier: "free",
    subscription_status: null,
    scoring_basis: "male",
    timezone: "Europe/London",
    onboarding_completed: true,
  };

  function fakeClient() {
    function chainFor(table: string) {
      const chain: Record<string, unknown> = {
        then(resolve: (v: { data: unknown; error: null }) => unknown) {
          return Promise.resolve(
            resolve({ data: table === "profiles" ? PROFILE : null, error: null })
          );
        },
      };
      for (const op of ["insert", "upsert", "update", "delete"]) {
        chain[op] = () => {
          writes.push(`${table}.${op}`);
          return chain;
        };
      }
      for (const m of ["select", "eq", "in", "gte", "lte", "lt", "gt", "order", "limit", "single", "maybeSingle", "not"]) {
        chain[m] = () => chain;
      }
      return chain;
    }
    return {
      auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) },
      from: (t: string) => chainFor(t),
    };
  }

  const BAD_PAYLOADS: [string, unknown][] = [
    ["wrong type for duration", { ...validRun(), duration_seconds: "1800" }],
    ["bodyweight of zero", { ...validGymActivity(), bodyweight_kg: 0 }],
    ["negative distance", { ...validRun(), distance_meters: -1 }],
    ["heart rate of 100000", { ...validRun(), avg_heart_rate: 100_000 }],
    ["unknown sport", { ...validRun(), sport: "quidditch" }],
    ["unknown key", { ...validRun(), is_admin: true }],
    ["not an object", 42],
    ["missing everything", {}],
  ];

  it.each(BAD_PAYLOADS)("returns 4xx and writes nothing: %s", async (_label, payload) => {
    writes.length = 0;
    createClientMock.mockReturnValue(fakeClient());
    const { POST } = await import("@/app/api/activities/route");

    const res = await POST(
      new Request("http://localhost/api/activities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
    );

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(writes, `wrote ${writes.join(", ")}`).toEqual([]);
  });
});
