import { describe, expect, it } from "vitest";
import {
  assessMerge,
  concatenateRoutes,
  readMergeRecord,
  snapshotOf,
  MERGE_MAX_GAP_SECONDS,
  type MergeSourceActivity,
} from "@/lib/activities/merge";
import { ROUTE_CONFIG } from "@/lib/scoring/gps-track";

/**
 * The arithmetic of rejoining a session that was logged as two.
 *
 * These are the tests that stop a merge from quietly inventing training that
 * did not happen: a pace averaged instead of derived, a phone-fumble gap
 * counted as running time, a fragment's heart rate given the same weight as
 * the fifty minutes around it.
 */

function leg(overrides: Partial<MergeSourceActivity> & { id: string }): MergeSourceActivity {
  return {
    sport: "running",
    started_at: "2026-01-05T08:00:00.000Z",
    duration_seconds: 600,
    ...overrides,
  };
}

/** 20 min / 4 km (5:00/km), then after a 60 s fumble 10 min / 3 km (3:20/km). */
const LEG_A = leg({
  id: "a",
  started_at: "2026-01-05T08:00:00.000Z",
  duration_seconds: 1200,
  distance_meters: 4000,
  elevation_meters: 30,
  avg_heart_rate: 145,
  max_heart_rate: 160,
  rpe: 5,
  session_type: "easy",
  title: "Morning run",
  source: "gps",
});
const LEG_B = leg({
  id: "b",
  started_at: "2026-01-05T08:21:00.000Z",
  duration_seconds: 600,
  distance_meters: 3000,
  elevation_meters: 15,
  avg_heart_rate: 165,
  max_heart_rate: 178,
  rpe: 8,
  session_type: "tempo",
  source: "gps",
});

function planOf(sources: MergeSourceActivity[]) {
  const assessment = assessMerge(sources);
  if (!assessment.ok) throw new Error(`expected a mergeable selection: ${assessment.reason}`);
  return assessment.plan;
}

describe("assessMerge — one session, recorded in two pieces", () => {
  it("sums duration, distance and elevation", () => {
    const { merged } = planOf([LEG_A, LEG_B]);
    expect(merged.duration_seconds).toBe(1800);
    expect(merged.distance_meters).toBe(7000);
    expect(merged.elevation_meters).toBe(45);
  });

  it("derives pace from the totals rather than averaging the two paces", () => {
    // 1800 s over 7 km is 257.14 s/km. Averaging 300 and 200 gives 250 — a
    // 7 s/km lie, in the athlete's favour, on every merged run whose halves
    // are different lengths.
    const { merged } = planOf([LEG_A, LEG_B]);
    expect(merged.avg_pace_seconds_per_km).toBeCloseTo(257.14, 1);
    expect(merged.avg_pace_seconds_per_km).not.toBeCloseTo(250, 1);
  });

  it("does not count the gap between the recordings as training time", () => {
    // The legs span 08:00 to 08:31 — 31 minutes of clock. The athlete ran for
    // 30 of them; the other 60 s was spent restarting the app.
    const plan = planOf([LEG_A, LEG_B]);
    expect(plan.totalGapSeconds).toBe(60);
    expect(plan.merged.duration_seconds).toBe(1800);
    const elapsed =
      (new Date(LEG_B.started_at).getTime() +
        LEG_B.duration_seconds * 1000 -
        new Date(LEG_A.started_at).getTime()) /
      1000;
    expect(elapsed).toBe(1860);
    expect(plan.merged.duration_seconds).toBeLessThan(elapsed);
  });

  it("weights heart rate, power and cadence by how long each leg lasted", () => {
    const { merged } = planOf([LEG_A, LEG_B]);
    // (145×1200 + 165×600) / 1800 = 151.67, not the flat average of 155.
    expect(merged.avg_heart_rate).toBe(152);
    expect(merged.max_heart_rate).toBe(178);
  });

  it("ignores legs that never recorded the metric rather than averaging in a zero", () => {
    const { merged } = planOf([leg({ id: "a", duration_seconds: 1200 }), { ...LEG_B }]);
    expect(merged.avg_heart_rate).toBe(165);
  });

  it("starts when the first leg started and keeps the first titled leg's title", () => {
    const { merged, survivorId, absorbedIds } = planOf([LEG_B, LEG_A]);
    expect(merged.started_at).toBe(LEG_A.started_at);
    expect(merged.title).toBe("Morning run");
    expect(survivorId).toBe("a");
    expect(absorbedIds).toEqual(["b"]);
  });

  it("takes its character from the leg that dominates it", () => {
    // A 20-minute easy leg plus a 10-minute fragment tagged tempo is an easy
    // run, not a tempo one — and session_type steers which scoring model runs.
    expect(planOf([LEG_A, LEG_B]).merged.session_type).toBe("easy");
  });

  it("averages RPE by duration and keeps it inside the 1–10 the column allows", () => {
    const { merged } = planOf([LEG_A, LEG_B]);
    expect(merged.rpe).toBe(6);
  });

  it("uses a 500 m split instead of a per-km pace for rowing", () => {
    const { merged } = planOf([
      leg({ id: "a", sport: "rowing", duration_seconds: 480, distance_meters: 2000 }),
      leg({
        id: "b",
        sport: "rowing",
        started_at: "2026-01-05T08:09:00.000Z",
        duration_seconds: 240,
        distance_meters: 1000,
      }),
    ]);
    expect(merged.avg_pace_seconds_per_km).toBeNull();
    // 720 s over 3000 m = 120 s per 500 m.
    expect(merged.avg_split_seconds).toBeCloseTo(120, 2);
  });

  it("drops interval structure it cannot add up, and says so", () => {
    const plan = planOf([
      { ...LEG_A, interval_reps: 6, interval_work_seconds: 60 },
      LEG_B,
    ]);
    expect(plan.merged.interval_reps).toBeNull();
    expect(plan.merged.interval_work_seconds).toBeNull();
    expect(plan.warnings.some((w) => /interval/i.test(w))).toBe(true);
  });

  it("warns when a real chunk of clock time is being discarded", () => {
    const plan = planOf([
      LEG_A,
      { ...LEG_B, started_at: "2026-01-05T08:45:00.000Z" },
    ]);
    expect(plan.totalGapSeconds).toBe(1500);
    expect(plan.warnings.some((w) => /not be counted as training time/i.test(w))).toBe(true);
  });

  it("keeps a stitched GPS session GPS, but will not claim a track it half has", () => {
    expect(planOf([LEG_A, LEG_B]).merged.source).toBe("gps");
    expect(planOf([LEG_A, { ...LEG_B, source: "manual" }]).merged.source).toBe("manual");
  });

  it("carries a partial-track flag forward rather than pretending the merge repaired it", () => {
    expect(planOf([LEG_A, LEG_B]).merged.is_partial_track).toBe(false);
    expect(
      planOf([{ ...LEG_A, is_partial_track: true }, LEG_B]).merged.is_partial_track
    ).toBe(true);
  });

  it("keeps every leg's notes", () => {
    const plan = planOf([
      { ...LEG_A, notes: "watch died" },
      { ...LEG_B, notes: "restarted on phone" },
    ]);
    expect(plan.merged.notes).toBe("watch died\n\nrestarted on phone");
  });
});

describe("assessMerge — selections it refuses", () => {
  it("refuses a single session", () => {
    const result = assessMerge([LEG_A]);
    expect(result).toEqual({ ok: false, reason: expect.stringMatching(/at least two/i) });
  });

  it("refuses two different sports", () => {
    // The duathlon case. Adding a bike's kilometres to a run's produces a
    // number with no meaning, so it is refused rather than approximated.
    const result = assessMerge([LEG_A, { ...LEG_B, sport: "outdoor_cycling" }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/different sports/i);
  });

  it("refuses gym sessions", () => {
    const result = assessMerge([
      { ...LEG_A, sport: "gym" },
      { ...LEG_B, sport: "gym" },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/cardio/i);
  });

  it("refuses sessions that are not plausibly one interrupted effort", () => {
    // A morning run and an evening run are two sessions. Merging them would
    // erase the second one's date and fabricate a session never run.
    const evening = {
      ...LEG_B,
      started_at: new Date(
        new Date(LEG_A.started_at).getTime() +
          (LEG_A.duration_seconds + MERGE_MAX_GAP_SECONDS + 60) * 1000
      ).toISOString(),
    };
    const result = assessMerge([LEG_A, evening]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/too far apart/i);
  });

  it("accepts a gap right up to the limit", () => {
    const atLimit = {
      ...LEG_B,
      started_at: new Date(
        new Date(LEG_A.started_at).getTime() +
          (LEG_A.duration_seconds + MERGE_MAX_GAP_SECONDS) * 1000
      ).toISOString(),
    };
    expect(assessMerge([LEG_A, atLimit]).ok).toBe(true);
  });

  it("refuses overlapping recordings, which are a duplicate not a split", () => {
    // A watch and a phone that both recorded the same run. Summing them would
    // count every kilometre twice, in the logbook and in the load model.
    const overlapping = { ...LEG_B, started_at: "2026-01-05T08:10:00.000Z" };
    const result = assessMerge([LEG_A, overlapping]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/overlap/i);
  });

  it("refuses the same session selected twice", () => {
    const result = assessMerge([LEG_A, { ...LEG_A }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/twice/i);
  });

  it("refuses a session with no duration", () => {
    const result = assessMerge([LEG_A, { ...LEG_B, duration_seconds: 0 }]);
    expect(result.ok).toBe(false);
  });
});

describe("concatenateRoutes", () => {
  const routeA: [number, number][] = [
    [51.5, -0.12],
    [51.51, -0.12],
  ];
  const routeB: [number, number][] = [
    [51.52, -0.12],
    [51.53, -0.12],
  ];

  it("joins the legs' lines in the order they were run", () => {
    const joined = concatenateRoutes([
      { ...LEG_A, metadata: { route: routeA } },
      { ...LEG_B, metadata: { route: routeB } },
    ]);
    expect(joined).toEqual([...routeA, ...routeB]);
  });

  it("has nothing to draw when no leg carried a route", () => {
    expect(concatenateRoutes([LEG_A, LEG_B])).toBeNull();
  });

  it("thins an over-long line evenly instead of drawing a run that stops halfway", () => {
    const long: [number, number][] = Array.from({ length: 400 }, (_, i) => [51.5 + i * 1e-4, -0.12]);
    const joined = concatenateRoutes([
      { ...LEG_A, metadata: { route: long } },
      { ...LEG_B, metadata: { route: long } },
    ])!;
    expect(joined).toHaveLength(ROUTE_CONFIG.MAX_POINTS);
    // Both ends survive: the drawn line still covers the whole run.
    expect(joined[0]).toEqual(long[0]);
    expect(joined[joined.length - 1]).toEqual(long[long.length - 1]);
  });
});

describe("the merge snapshot, which is the whole undo", () => {
  it("keeps every column a restore has to write back", () => {
    const snapshot = snapshotOf({
      id: "a",
      user_id: "u",
      sport: "running",
      started_at: LEG_A.started_at,
      duration_seconds: 1200,
      distance_meters: 4000,
      notes: "watch died",
      metadata: { route: [[51.5, -0.12]] },
      created_at: "ignored",
    });
    expect(snapshot.id).toBe("a");
    expect(snapshot.distance_meters).toBe(4000);
    expect(snapshot.notes).toBe("watch died");
    expect(snapshot.metadata).toEqual({ route: [[51.5, -0.12]] });
    // Columns the restore must not carry across.
    expect("user_id" in snapshot).toBe(false);
    expect("created_at" in snapshot).toBe(false);
  });

  it("reads back a merge record, and only a complete one", () => {
    const record = {
      version: 1,
      mergedAt: "2026-01-05T09:00:00.000Z",
      totalGapSeconds: 60,
      sources: [
        { ...LEG_A, wasSurvivor: true },
        { ...LEG_B, wasSurvivor: false },
      ],
    };
    expect(readMergeRecord({ merge: record })?.sources).toHaveLength(2);
    expect(readMergeRecord({})).toBeNull();
    expect(readMergeRecord(null)).toBeNull();
    // A record with no surviving leg cannot say which row to restore.
    expect(
      readMergeRecord({
        merge: { ...record, sources: record.sources.map((s) => ({ ...s, wasSurvivor: false })) },
      })
    ).toBeNull();
  });
});
