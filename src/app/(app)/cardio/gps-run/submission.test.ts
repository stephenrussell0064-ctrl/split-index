import { describe, expect, it } from "vitest";
import { buildGpsActivityPayload, type GpsSubmissionInput } from "./submission";
import {
  summarizeGpsTrack,
  type GpsPoint,
  type PauseInterval,
} from "@/lib/scoring/gps-track";

const HOME_LAT = 51.5;
const HOME_LNG = -0.12;
const DEG_PER_M = 1 / 111_194.93;

/** A straight run due north from the athlete's door, one fix every 10 seconds. */
function track(lengthMeters: number, spacingMeters = 10): GpsPoint[] {
  const count = Math.round(lengthMeters / spacingMeters) + 1;
  return Array.from({ length: count }, (_, i) => ({
    latitude: HOME_LAT + i * spacingMeters * DEG_PER_M,
    longitude: HOME_LNG,
    accuracy: 5,
    altitude: null,
    time: i * 10_000,
  }));
}

function input(overrides: Partial<GpsSubmissionInput> = {}): GpsSubmissionInput {
  const points = overrides.points ?? track(2000);
  const pauses = overrides.pauses ?? [];
  return {
    sport: "running",
    sessionType: "easy",
    startedAtIso: "2026-01-05T18:00:00.000Z",
    summary: summarizeGpsTrack(points, { endedCleanly: true, permissionRevoked: false, pauses }),
    points,
    pauses,
    hrReadings: [],
    cadenceReadings: [],
    segments: [],
    ...overrides,
  };
}

describe("buildGpsActivityPayload", () => {
  it("builds the route and start coordinate from the points it is given", () => {
    const payload = buildGpsActivityPayload(input());

    expect(payload.start_latitude).toBeCloseTo(HOME_LAT, 6);
    expect(payload.start_longitude).toBeCloseTo(HOME_LNG, 6);
    expect((payload.route as [number, number][]).length).toBeGreaterThanOrEqual(2);
    expect(payload.source).toBe("gps");
  });

  it("saves a recovered session's route and start coordinate, not an empty live buffer", () => {
    // The regression this function was extracted for. After an app kill the
    // component remounts with no live points at all: the run's fixes come back
    // from recoverOrphanedSession() and are passed in here. Reading component
    // state instead meant a recovered run — often the longest, most annoying
    // one to lose — saved with no map and no start coordinate, so no
    // temperature was looked up either, while its distance came through in
    // full from the summary alongside it. Nothing surfaced the loss.
    const recoveredPoints = track(3000);
    const recoveredSummary = summarizeGpsTrack(recoveredPoints, {
      endedCleanly: false,
      permissionRevoked: false,
    });

    const payload = buildGpsActivityPayload(
      input({ points: recoveredPoints, summary: recoveredSummary })
    );

    expect(payload.route).toBeDefined();
    expect((payload.route as [number, number][]).length).toBeGreaterThanOrEqual(2);
    expect(payload.start_latitude).toBeCloseTo(HOME_LAT, 6);
    expect(payload.start_longitude).toBeCloseTo(HOME_LNG, 6);
    // A recovered run is still flagged as partial — recovering it must not
    // launder it into a clean effort.
    expect(payload.is_partial_track).toBe(true);
    expect(payload.distance_meters).toBeCloseTo(3000, -1);
  });

  it("has no route and no coordinate when there genuinely are no points", () => {
    const empty = summarizeGpsTrack([], { endedCleanly: true, permissionRevoked: false });
    const payload = buildGpsActivityPayload(input({ points: [], summary: empty }));

    expect(payload.route).toBeUndefined();
    expect(payload.start_latitude).toBeUndefined();
    expect(payload.start_longitude).toBeUndefined();
  });

  it("reports the numbers from the track summary, never re-derived from the polyline", () => {
    // distance/duration/pace/climb are computed by summarizeGpsTrack over the
    // full raw track. The polyline is a picture that the server then trims for
    // privacy; if these were ever recomputed from it, every athlete would
    // silently lose 400m a run.
    const points = track(5000);
    const summary = summarizeGpsTrack(points, { endedCleanly: true, permissionRevoked: false });
    const payload = buildGpsActivityPayload(input({ points, summary }));

    expect(payload.distance_meters).toBe(summary.distanceMeters);
    expect(payload.duration_seconds).toBe(summary.durationSeconds);
    expect(payload.avg_pace_seconds_per_km).toBe(summary.avgPaceSecondsPerKm ?? undefined);
    expect(payload.distance_meters).toBeCloseTo(5000, -1);
  });

  it("leaves fixes recorded during a pause out of the drawn route", () => {
    // Standing at a crossing, the receiver drifts. Those fixes are not route.
    const running = track(1000);
    const drift: GpsPoint[] = Array.from({ length: 20 }, (_, i) => ({
      latitude: HOME_LAT + 1000 * DEG_PER_M + (i % 2 === 0 ? 0.0003 : -0.0003),
      longitude: HOME_LNG + 0.0003,
      accuracy: 5,
      altitude: null,
      time: 1_000_000 + i * 1_000,
    }));
    const pauses: PauseInterval[] = [{ startTime: 999_000, endTime: 1_100_000 }];
    const points = [...running, ...drift];

    const payload = buildGpsActivityPayload(
      input({
        points,
        pauses,
        summary: summarizeGpsTrack(points, {
          endedCleanly: true,
          permissionRevoked: false,
          pauses,
        }),
      })
    );

    const route = payload.route as [number, number][];
    // The drift sat 0.0003 degrees east of the road; nothing that far off the
    // line should have been drawn.
    expect(route.every(([, lng]) => Math.abs(lng - HOME_LNG) < 0.0001)).toBe(true);
  });
});

/**
 * A RUN THE APP WAS KILLED DURING REPORTED THE WRONG HEART RATE, NOT NONE.
 *
 * `hrReadings` is React state and dies with the WebView. A rejoined run
 * therefore computed its average from post-rejoin readings only: a ninety-
 * minute run interrupted at minute eighty reported the average of its last ten
 * minutes as the average for the whole session. That is a scoring input, and
 * unlike a missing value it looks entirely plausible sitting next to the pace
 * and distance, so nothing about the saved run invites a second look.
 *
 * The readings themselves are not carried — a strap notifies at ~1Hz, which is
 * about 180KB for that run — so what survives is five numbers, and these tests
 * are about the arithmetic that folds them back in.
 */
describe("heart rate across an interruption", () => {
  const hr = (bpm: number, time: number) => ({ bpm, time });

  it("weights the two stretches by how long each one was", () => {
    // 80 minutes at 150 before the kill, 10 minutes at 120 after it. The true
    // average is much nearer 150; averaging the two averages would say 135.
    const payload = buildGpsActivityPayload({
      ...input(),
      hrReadings: [hr(120, 1000), hr(120, 2000)],
      priorTotals: { hrSum: 150 * 4800, hrCount: 4800, hrMax: 178, cadenceSum: 0, cadenceCount: 0 },
    });
    // (150*4800 + 120*2) / 4802
    expect(payload.avg_heart_rate).toBe(150);
    expect(payload.avg_heart_rate).not.toBe(135);
  });

  it("keeps a peak that happened before the interruption", () => {
    // The hardest effort of a run is usually not in its last ten minutes.
    const payload = buildGpsActivityPayload({
      ...input(),
      hrReadings: [hr(140, 1000)],
      priorTotals: { hrSum: 150 * 100, hrCount: 100, hrMax: 186, cadenceSum: 0, cadenceCount: 0 },
    });
    expect(payload.max_heart_rate).toBe(186);
  });

  it("still reports a peak set after the rejoin", () => {
    const payload = buildGpsActivityPayload({
      ...input(),
      hrReadings: [hr(191, 1000)],
      priorTotals: { hrSum: 150 * 100, hrCount: 100, hrMax: 186, cadenceSum: 0, cadenceCount: 0 },
    });
    expect(payload.max_heart_rate).toBe(191);
  });

  it("changes nothing for a run that was never interrupted", () => {
    const uninterrupted = buildGpsActivityPayload({
      ...input(),
      hrReadings: [hr(140, 1000), hr(160, 2000)],
    });
    expect(uninterrupted.avg_heart_rate).toBe(150);
    expect(uninterrupted.max_heart_rate).toBe(160);
  });

  it("reports nothing rather than zero when no strap was worn", () => {
    // A run with no heart-rate monitor must not post avg_heart_rate: 0 — the
    // scoring engine reads that as a measurement.
    const payload = buildGpsActivityPayload({ ...input(), hrReadings: [] });
    expect(payload.avg_heart_rate).toBeUndefined();
    expect(payload.max_heart_rate).toBeUndefined();
  });

  it("recovers heart rate from a run whose own readings are all gone", () => {
    // The app was killed and the athlete accepted the recovered session
    // without the strap reconnecting: every reading is on the prior side.
    const payload = buildGpsActivityPayload({
      ...input(),
      hrReadings: [],
      priorTotals: { hrSum: 148 * 3000, hrCount: 3000, hrMax: 181, cadenceSum: 0, cadenceCount: 0 },
    });
    expect(payload.avg_heart_rate).toBe(148);
    expect(payload.max_heart_rate).toBe(181);
  });

  it("carries cadence the same way", () => {
    const payload = buildGpsActivityPayload({
      ...input(),
      cadenceReadings: [160, 160],
      priorTotals: { hrSum: 0, hrCount: 0, hrMax: 0, cadenceSum: 180 * 1000, cadenceCount: 1000 },
    });
    expect(payload.avg_cadence).toBe(180);
  });

  it("treats a pre-carry recovery record as no readings, not as zero readings", () => {
    // Sessions stored before totals were carried come back with null, and must
    // behave exactly as they did before this existed.
    const payload = buildGpsActivityPayload({
      ...input(),
      hrReadings: [hr(150, 1000)],
      priorTotals: null,
    });
    expect(payload.avg_heart_rate).toBe(150);
  });
});
