import { describe, expect, it } from "vitest";
import {
  createDefaultState,
  createIntervalBlock,
  createIntervalRepOverride,
  flattenIntervalBlocks,
  parseSeconds,
  readIntervalBlocks,
  resolveIntervalBlock,
  restoreDraftState,
  validateAndBuildPayload,
  type IntervalBlockState,
  type WorkoutFormState,
} from "./form-state";
import {
  intervalEquivalentPaceSecPerKm,
  intervalTotalWorkDistanceMeters,
} from "@/lib/scoring/cardio/interval-scoring";

function block(seed: Partial<IntervalBlockState>): IntervalBlockState {
  return { ...createIntervalBlock(), ...seed };
}

function runState(overrides: Partial<WorkoutFormState> = {}): WorkoutFormState {
  return {
    ...createDefaultState("running", 75),
    distance: "8",
    minutes: "40",
    sessionType: "interval",
    ...overrides,
  };
}

describe("parseSeconds", () => {
  it("takes a bare count of seconds", () => {
    expect(parseSeconds("75")).toBe(75);
  });

  it("takes clock notation, which is how athletes say rep times", () => {
    expect(parseSeconds("1:15")).toBe(75);
    expect(parseSeconds("2:40")).toBe(160);
    expect(parseSeconds("1:00:00")).toBe(3600);
  });

  it("is blank-safe and rejects nonsense rather than guessing", () => {
    expect(parseSeconds("")).toBeNull();
    expect(parseSeconds("  ")).toBeNull();
    expect(parseSeconds("a:b")).toBeNull();
  });
});

describe("resolveIntervalBlock", () => {
  it("expands a uniform block into identical reps", () => {
    const reps = resolveIntervalBlock(
      block({ reps: "4", distanceMeters: "400", workSeconds: "75", restSeconds: "90" })
    );
    expect(reps).toHaveLength(4);
    expect(reps![0]).toEqual({ distanceMeters: 400, workSeconds: 75, restSeconds: 90 });
    expect(reps![3]).toEqual({ distanceMeters: 400, workSeconds: 75, restSeconds: 90 });
  });

  it("lets a single rep differ without disturbing the others", () => {
    const reps = resolveIntervalBlock(
      block({
        reps: "4",
        distanceMeters: "400",
        workSeconds: "75",
        restSeconds: "90",
        repOverrides: [
          createIntervalRepOverride(),
          createIntervalRepOverride(),
          { ...createIntervalRepOverride(), workSeconds: "1:22" },
          createIntervalRepOverride(),
        ],
      })
    );
    expect(reps!.map((r) => r.workSeconds)).toEqual([75, 75, 82, 75]);
    expect(reps!.every((r) => r.distanceMeters === 400)).toBe(true);
  });

  it("refuses a block whose reps can't all be described", () => {
    expect(resolveIntervalBlock(block({ reps: "4", distanceMeters: "400" }))).toBeNull();
    expect(resolveIntervalBlock(block({ distanceMeters: "400", workSeconds: "75" }))).toBeNull();
  });
});

describe("flattenIntervalBlocks", () => {
  it("leaves a uniform block exactly as entered", () => {
    const flat = flattenIntervalBlocks([
      block({ reps: "6", distanceMeters: "400", workSeconds: "75", restSeconds: "90" }),
    ]);
    expect(flat).toEqual({
      reps: 6,
      workDistanceMeters: 400,
      workSeconds: 75,
      restSeconds: 90,
      workHr: null,
    });
  });

  /**
   * The load-bearing claim of the whole feature: a multi-block session, put
   * through the flattener and then through the UNMODIFIED scorer, is scored on
   * its true combined work pace and its true rest ratio — not on an average
   * the athlete had to compute by hand, and not on anything approximate.
   */
  it("scores a mixed session on its real aggregates", () => {
    const blocks = [
      block({ reps: "4", distanceMeters: "400", workSeconds: "75", restSeconds: "90" }),
      block({ reps: "2", distanceMeters: "800", workSeconds: "2:40", restSeconds: "180" }),
    ];
    const flat = flattenIntervalBlocks(blocks)!;

    // 4×400 + 2×800 = 3200 m of work in 4×75 + 2×160 = 620 s.
    expect(flat.reps).toBe(6);
    expect(intervalTotalWorkDistanceMeters({
      reps: flat.reps,
      workDistanceMeters: flat.workDistanceMeters,
      workSecondsPerRep: flat.workSeconds,
      restSeconds: flat.restSeconds,
    })).toBeCloseTo(3200, 0);
    expect(flat.reps * flat.workSeconds).toBeCloseTo(620, 0);

    // Rest belongs to the block it was entered on and is taken after each of
    // that block's reps, with the session's final rep dropping its own (there
    // is no recovery left to take): 4×90 + 2×180 − 180 = 540.
    expect(Math.max(0, flat.reps - 1) * flat.restSeconds).toBeCloseTo(540, 0);

    // And the pace the scorer derives is the true 620/3200 work pace, carried
    // through its own rest-ratio conversion.
    const trueWorkPace = (620 / 3200) * 1000;
    const restRatio = 540 / 620;
    const expected = trueWorkPace * (1 + 0.03 + 0.06 * restRatio);
    const actual = intervalEquivalentPaceSecPerKm({
      reps: flat.reps,
      workDistanceMeters: flat.workDistanceMeters,
      workSecondsPerRep: flat.workSeconds,
      restSeconds: flat.restSeconds,
    });
    // The flattening is exact in real arithmetic. What is left is the one
    // decimal place the columns themselves hold (533.3 m/rep rather than
    // 533.333…, migration 015's NUMERIC(8,1)) — rounded here deliberately so
    // that what is scored is exactly what is stored. Worth about a twentieth
    // of a second per kilometre, i.e. under a second across a 5k.
    expect(Math.abs(actual - expected)).toBeLessThan(0.1);
  });

  it("moves the aggregate when a rep is corrected", () => {
    const base = block({
      reps: "4",
      distanceMeters: "400",
      workSeconds: "75",
      restSeconds: "90",
    });
    const before = flattenIntervalBlocks([base])!;
    const after = flattenIntervalBlocks([
      {
        ...base,
        repOverrides: [
          createIntervalRepOverride(),
          createIntervalRepOverride(),
          createIntervalRepOverride(),
          { ...createIntervalRepOverride(), workSeconds: "1:35" },
        ],
      },
    ])!;
    expect(after.reps).toBe(before.reps);
    expect(after.workSeconds).toBeGreaterThan(before.workSeconds);
    expect(after.reps * after.workSeconds).toBeCloseTo(75 * 3 + 95, 0);
  });

  it("weights work HR by how much work each block held", () => {
    const flat = flattenIntervalBlocks([
      block({ reps: "1", distanceMeters: "400", workSeconds: "100", workHr: "160" }),
      block({ reps: "1", distanceMeters: "400", workSeconds: "100", workHr: "180" }),
    ])!;
    expect(flat.workHr).toBe(170);
  });

  it("has nothing to say about empty or unusable blocks", () => {
    expect(flattenIntervalBlocks([])).toBeNull();
    expect(flattenIntervalBlocks([createIntervalBlock()])).toBeNull();
    expect(flattenIntervalBlocks([block({ reps: "4" })])).toBeNull();
  });
});

describe("readIntervalBlocks", () => {
  it("reads a pre-blocks session's flat fields as one block, without touching state", () => {
    const state = runState({
      intervalReps: "8",
      intervalWorkDistance: "400",
      intervalWorkSeconds: "72",
      intervalRestSeconds: "120",
      intervalWorkHr: "175",
    });
    const blocks = readIntervalBlocks(state);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      reps: "8",
      distanceMeters: "400",
      workSeconds: "72",
      restSeconds: "120",
      workHr: "175",
    });
    // Read, not migrated: the state itself is untouched, so a session the
    // athlete never edits still submits down the pre-blocks path.
    expect(state.intervalBlocks).toEqual([]);
  });

  it("prefers real blocks once they exist", () => {
    const state = runState({
      intervalReps: "8",
      intervalBlocks: [block({ reps: "3", distanceMeters: "1000", workSeconds: "3:20" })],
    });
    expect(readIntervalBlocks(state)).toHaveLength(1);
    expect(readIntervalBlocks(state)[0].reps).toBe("3");
  });
});

describe("validateAndBuildPayload — intervals", () => {
  it("submits a pre-blocks session byte-identically", () => {
    const { errors, payload } = validateAndBuildPayload(
      "running",
      runState({
        intervalReps: "6",
        intervalWorkDistance: "400",
        intervalWorkSeconds: "75",
        intervalRestSeconds: "90",
      })
    );
    expect(errors).toEqual({});
    expect(payload).toMatchObject({
      interval_reps: 6,
      interval_work_distance_meters: 400,
      interval_work_seconds: 75,
      interval_rest_seconds: 90,
    });
  });

  it("collapses blocks onto the same five fields", () => {
    const { errors, payload } = validateAndBuildPayload(
      "running",
      runState({
        intervalBlocks: [
          block({ reps: "4", distanceMeters: "400", workSeconds: "1:15", restSeconds: "90" }),
          block({ reps: "2", distanceMeters: "800", workSeconds: "2:40", restSeconds: "3:00" }),
        ],
      })
    );
    expect(errors).toEqual({});
    expect(payload!.interval_reps).toBe(6);
    expect(payload!.interval_reps! * payload!.interval_work_distance_meters!).toBeCloseTo(3200, 0);
    expect(payload!.interval_reps! * payload!.interval_work_seconds!).toBeCloseTo(620, 0);
    // Nothing new is sent: the payload carries no block structure at all.
    expect("interval_blocks" in payload!).toBe(false);
  });

  it("names the block and the field when one is unfinished", () => {
    const unfinished = block({ reps: "4", distanceMeters: "400" });
    const { errors, payload } = validateAndBuildPayload(
      "running",
      runState({ intervalBlocks: [unfinished] })
    );
    expect(payload).toBeNull();
    expect(errors[`ivl.${unfinished.id}.workSeconds`]).toBe("Work time is required");
  });

  it("ignores blocks entirely when the session isn't an interval one", () => {
    const { errors, payload } = validateAndBuildPayload(
      "running",
      runState({
        sessionType: "easy",
        intervalBlocks: [block({ reps: "4", distanceMeters: "400", workSeconds: "75" })],
      })
    );
    expect(errors).toEqual({});
    expect(payload!.interval_reps).toBeUndefined();
  });
});

describe("restoreDraftState", () => {
  it("restores blocks and their per-rep corrections through the JSONB round-trip", () => {
    const original = runState({
      intervalBlocks: [
        block({
          reps: "4",
          distanceMeters: "400",
          workSeconds: "1:15",
          restSeconds: "90",
          repOverrides: [{ ...createIntervalRepOverride(), workSeconds: "1:22" }],
        }),
      ],
    });
    const restored = restoreDraftState(
      "running",
      JSON.parse(JSON.stringify(original)),
      75
    );
    expect(restored.intervalBlocks).toHaveLength(1);
    expect(restored.intervalBlocks[0].workSeconds).toBe("1:15");
    expect(restored.intervalBlocks[0].repOverrides[0].workSeconds).toBe("1:22");
  });

  it("gives a draft saved before blocks existed an empty list, not a crash", () => {
    const restored = restoreDraftState(
      "running",
      { distance: "10", intervalReps: "6", intervalWorkDistance: "400" },
      75
    );
    expect(restored.intervalBlocks).toEqual([]);
    expect(readIntervalBlocks(restored)[0].reps).toBe("6");
  });
});
