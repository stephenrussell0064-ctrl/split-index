import { describe, expect, it } from "vitest";
import { buildGpsActivityPayload, type GpsSubmissionInput } from "./submission";
import {
  summarizeGpsTrack,
  type GpsPoint,
  type PauseInterval,
} from "@/lib/scoring/gps-track";
import { parseActivityStreams, totalDistanceMeters, totalSeconds } from "@/lib/analysis/streams";

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
    summary: summarizeGpsTrack(points, { pauses }),
    points,
    pauses,
    hrReadings: [],
    cadenceSamples: [],
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
    const recoveredSummary = summarizeGpsTrack(recoveredPoints, { });

    const payload = buildGpsActivityPayload(
      input({ points: recoveredPoints, summary: recoveredSummary })
    );

    expect(payload.route).toBeDefined();
    expect((payload.route as [number, number][]).length).toBeGreaterThanOrEqual(2);
    expect(payload.start_latitude).toBeCloseTo(HOME_LAT, 6);
    expect(payload.start_longitude).toBeCloseTo(HOME_LNG, 6);
    // A recovered run is saved as the finished run, same as any other
    // (user instruction: never save a run as partial).
    expect(payload.is_partial_track).toBe(false);
    expect(payload.distance_meters).toBeCloseTo(3000, -1);
  });

  it("has no route and no coordinate when there genuinely are no points", () => {
    const empty = summarizeGpsTrack([]);
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
    const summary = summarizeGpsTrack(points);
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
        summary: summarizeGpsTrack(points, { pauses,
        }),
      })
    );

    const route = payload.route as [number, number][];
    // The drift sat 0.0003 degrees east of the road; nothing that far off the
    // line should have been drawn.
    expect(route.every(([, lng]) => Math.abs(lng - HOME_LNG) < 0.0001)).toBe(true);
  });

  it("carries the analysis streams, built from the same points as the summary", () => {
    const points = track(3000);
    const summary = summarizeGpsTrack(points, { pauses: [] });
    const payload = buildGpsActivityPayload(
      input({
        points,
        summary,
        hrReadings: points.map((p, i) => ({ bpm: 140 + (i % 5), time: p.time })),
        cadenceSamples: points.map((p) => ({ spm: 178, time: p.time })),
      })
    );

    const streams = parseActivityStreams(payload.streams);
    expect(streams).not.toBeNull();
    // The whole contract: a split found in these streams lands where the
    // saved distance and duration say it should.
    expect(totalDistanceMeters(streams!)).toBeCloseTo(summary.distanceMeters, 0);
    expect(totalSeconds(streams!)).toBeCloseTo(summary.durationSeconds, 0);
    expect(streams!.heartRate).not.toBeNull();
    expect(streams!.cadence).not.toBeNull();
    expect(payload.avg_cadence).toBe(178);
  });

  it("builds streams for a recovered session too, not an empty live buffer", () => {
    // Same regression as the route above: the recovery path passes its own
    // points in, and the analysis must be built from those.
    const recovered = track(4000);
    const payload = buildGpsActivityPayload(
      input({ points: recovered, summary: summarizeGpsTrack(recovered, { pauses: [] }) })
    );
    expect(totalDistanceMeters(parseActivityStreams(payload.streams)!)).toBeCloseTo(4000, -1);
  });

  it("sends no streams when there is no track to analyse", () => {
    const empty = summarizeGpsTrack([], {});
    expect(buildGpsActivityPayload(input({ points: [], summary: empty })).streams).toBeUndefined();
  });
});
