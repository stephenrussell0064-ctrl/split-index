import { describe, expect, it } from "vitest";
import { ingestRuns, loggedWeeklyRunMinutes, type ActivityRow } from "./ingest";
import { diagnose } from "./diagnostics";
import type { SportType } from "@/types";

/**
 * Regression: the predicted 5k read 25:00 for an athlete whose every logged
 * run was well inside 19:00 pace.
 *
 * `diagnose` falls back to a flat 1500 s (= 25:00) placeholder when it is
 * handed no maximal effort at all — deliberately, so nothing is prescribed
 * off an extrapolation the data does not support. The bug was upstream of
 * that refusal: `ingestRuns` filtered `activities.sport` against the internal
 * six-way BENCHMARK bucket vocabulary (`run`/`row`/`cycle`/…) while the
 * column actually stores the app-facing `SportType` enum (`running`/
 * `rowing`/`indoor_cycling`/…). The two sets do not intersect, so EVERY
 * activity was discarded, `runs` came back empty, and the placeholder was
 * displayed as though it were a real prediction.
 *
 * These tests drive the adapter with rows shaped exactly like the ones
 * `loadAthleteProfile` selects out of Supabase — the layer that was
 * previously exercised only through hand-built `RunLog` values, which is why
 * a total-loss adapter bug went unnoticed.
 */

const DAY = 86_400_000;
const NOW = new Date("2026-03-01T09:00:00.000Z").getTime();
const daysAgo = (n: number) => new Date(NOW - n * DAY).toISOString();

function activity(
  daysBack: number,
  sport: SportType,
  distanceMeters: number,
  durationSeconds: number,
  overrides: Partial<ActivityRow> = {}
): ActivityRow {
  return {
    started_at: daysAgo(daysBack),
    sport,
    duration_seconds: durationSeconds,
    distance_meters: distanceMeters,
    avg_heart_rate: 150,
    max_heart_rate: 185,
    avg_cadence: 178,
    session_type: null,
    metadata: null,
    is_partial_track: false,
    ...overrides,
  };
}

/**
 * A sub-19 5k athlete's realistic 12-week log: 5-10 km runs at 3:45-4:00/km
 * plus longer easy runs, and one tagged parkrun race. Nothing here is slower
 * than 21:00 5k-equivalent.
 */
const REALISTIC_LOG: ActivityRow[] = [
  activity(78, "running", 8000, 8 * 236),
  activity(74, "running", 16000, 16 * 300),
  activity(70, "running", 10000, 10 * 241),
  activity(64, "running", 6000, 6 * 230),
  activity(58, "running", 18000, 18 * 310),
  activity(52, "running", 5000, 5 * 228),
  activity(46, "running", 10000, 10 * 238),
  activity(40, "running", 12000, 12 * 295),
  activity(34, "running", 8000, 8 * 234),
  activity(28, "running", 16000, 16 * 305),
  activity(21, "running", 10000, 10 * 240),
  activity(14, "running", 6000, 6 * 232),
  // The parkrun: 18:30 dead, tagged as a race — direct evidence of capability.
  activity(7, "running", 5000, 1110, { session_type: "race", avg_heart_rate: 178 }),
  activity(3, "running", 14000, 14 * 300),
];

const DIAGNOSE_OPTIONS = { hrMax: 190, hrRest: 50, hrMaxSource: "measured" as const };

describe("ingestRuns — activities.sport uses the app SportType vocabulary", () => {
  it("keeps running sessions logged under the real enum value", () => {
    const runs = ingestRuns(REALISTIC_LOG);
    expect(runs).toHaveLength(REALISTIC_LOG.length);
  });

  it("flags a race-tagged session as a maximal effort", () => {
    const runs = ingestRuns(REALISTIC_LOG);
    const race = runs.find((r) => r.distanceKm === 5 && r.durationS === 1110);
    expect(race?.isMaxEffort).toBe(true);
  });

  it("does not pool non-running modalities into the run-pace model", () => {
    // A 20 km ride at 30 km/h reads as a 2:00/km "run" and a 400 m swim as a
    // 15:00/km one. Either would wreck the median-pace outlier rule and the
    // 5k projection built on top of it, so neither belongs in RunLog[].
    const mixed: ActivityRow[] = [
      ...REALISTIC_LOG,
      activity(20, "outdoor_cycling", 20000, 40 * 60),
      activity(19, "indoor_cycling", 30000, 60 * 60),
      activity(18, "swimming", 400, 6 * 60),
      activity(17, "rowing", 2000, 7 * 60 + 30),
      activity(16, "gym", 0, 45 * 60, { distance_meters: null }),
    ];
    expect(ingestRuns(mixed)).toHaveLength(REALISTIC_LOG.length);
  });

  it("still drops partial GPS tracks and zero-distance rows", () => {
    const dirty: ActivityRow[] = [
      ...REALISTIC_LOG,
      activity(15, "running", 9000, 9 * 250, { is_partial_track: true }),
      activity(13, "running", 0, 30 * 60, { distance_meters: null }),
    ];
    expect(ingestRuns(dirty)).toHaveLength(REALISTIC_LOG.length);
  });
});

describe("predicted 5k for a sub-19 athlete", () => {
  it("is derived from the logged efforts, not the 25:00 no-data placeholder", () => {
    const profile = diagnose(ingestRuns(REALISTIC_LOG), [], {}, DIAGNOSE_OPTIONS);

    expect(profile.predicted5kFromEffort).toBe(true);
    // The bug's signature: 1500 s exactly.
    expect(profile.predicted5kS).not.toBeCloseTo(1500, 0);
    expect(profile.predicted5kS).toBeGreaterThan(17 * 60);
    expect(profile.predicted5kS).toBeLessThan(19 * 60 + 30);
  });

  it("stays honest when the athlete genuinely has no maximal effort", () => {
    // Same athlete, every session a steady untagged plod at one pace, so
    // neither the tag rule nor the outlier rule can find a maximal effort.
    const flat = Array.from({ length: 12 }, (_, i) => activity(80 - i * 6, "running", 10000, 10 * 300));
    const profile = diagnose(ingestRuns(flat), [], {}, DIAGNOSE_OPTIONS);
    expect(profile.predicted5kFromEffort).toBe(false);
    expect(profile.predicted5kS).toBeCloseTo(1500, 0);
  });
});

describe("loggedWeeklyRunMinutes", () => {
  it("counts running minutes from rows carrying the real sport value", () => {
    const minutes = loggedWeeklyRunMinutes(REALISTIC_LOG, 8, NOW);
    expect(minutes).not.toBeNull();
    expect(minutes as number).toBeGreaterThan(0);
  });

  it("excludes non-running modalities from the run-volume anchor", () => {
    const runsOnly = loggedWeeklyRunMinutes(REALISTIC_LOG, 8, NOW) as number;
    const withCrossTraining = loggedWeeklyRunMinutes(
      [...REALISTIC_LOG, activity(10, "outdoor_cycling", 60000, 120 * 60)],
      8,
      NOW
    ) as number;
    expect(withCrossTraining).toBeCloseTo(runsOnly, 6);
  });
});
