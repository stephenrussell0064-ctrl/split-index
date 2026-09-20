import { describe, expect, it } from "vitest";
import { summarizeGpsTrack, type PauseInterval } from "@/lib/scoring/gps-track";
import { syntheticTrack } from "./fixtures";
import {
  buildActivityStreams,
  parseActivityStreams,
  STREAM_CONFIG,
  timeAtDistance,
  totalDistanceMeters,
  totalSeconds,
} from "./streams";

describe("buildActivityStreams", () => {
  it("agrees with the track summary on distance and duration", () => {
    // The whole point: a split computed from these streams must land where
    // the saved distance and duration say it should.
    const track = syntheticTrack({ lengthMeters: 5000, pace: 300 });
    const streams = buildActivityStreams(track);
    const summary = summarizeGpsTrack(track.points, { pauses: [] });

    expect(streams).not.toBeNull();
    expect(totalDistanceMeters(streams!)).toBeCloseTo(summary.distanceMeters, 0);
    expect(totalSeconds(streams!)).toBeCloseTo(summary.durationSeconds, 0);
    expect(streams!.time.length).toBe(streams!.distance.length);
  });

  it("removes paused time from the timeline and paused fixes from the series", () => {
    const track = syntheticTrack({ lengthMeters: 2000, pace: 300 });
    const start = track.points[0].time;
    // Two minutes stood still at the 1km mark, with the receiver drifting.
    const pauseAt = track.points.find((p) => p.time >= start + 300_000)!.time;
    const pauses: PauseInterval[] = [{ startTime: pauseAt, endTime: pauseAt + 120_000 }];
    const shifted = track.points.map((p) => (p.time > pauseAt ? { ...p, time: p.time + 120_000 } : p));
    const drift = Array.from({ length: 10 }, (_, i) => ({
      ...track.points[0],
      latitude: track.points[0].latitude + 1000 * (1 / 111_194.93) + (i % 2 ? 0.0002 : -0.0002),
      time: pauseAt + 10_000 + i * 5_000,
    }));

    const streams = buildActivityStreams({ ...track, points: [...shifted, ...drift], pauses });
    const summary = summarizeGpsTrack([...shifted, ...drift], { pauses });

    expect(streams).not.toBeNull();
    expect(totalSeconds(streams!)).toBeCloseTo(summary.durationSeconds, 0);
    expect(totalDistanceMeters(streams!)).toBeCloseTo(summary.distanceMeters, 0);
    // 2km at 5:00/km is 600s of moving time, and the pause must not be in it.
    expect(totalSeconds(streams!)).toBeCloseTo(600, 0);
  });

  it("aligns heart rate and cadence readings onto the fix timeline", () => {
    const track = syntheticTrack({
      lengthMeters: 1000,
      pace: 300,
      heartRate: (s) => 130 + s / 10,
      cadence: () => 172,
    });
    const streams = buildActivityStreams(track)!;

    expect(streams.heartRate).not.toBeNull();
    expect(streams.cadence).not.toBeNull();
    // A reading at every second means every fix is covered.
    expect(streams.heartRate!.every((v) => v !== null)).toBe(true);
    // Rising HR reads rising along the stream.
    const first = streams.heartRate![1] as number;
    const last = streams.heartRate![streams.heartRate!.length - 1] as number;
    expect(last).toBeGreaterThan(first);
    expect(streams.cadence!.every((v) => v === 172)).toBe(true);
  });

  it("stores no sensor channel at all when there were no readings", () => {
    const streams = buildActivityStreams(syntheticTrack({ lengthMeters: 500, pace: 300 }))!;
    expect(streams.heartRate).toBeNull();
    expect(streams.cadence).toBeNull();
    expect(streams.altitude).toBeNull();
  });

  it("leaves a gap in the heart-rate channel across a strap dropout", () => {
    const track = syntheticTrack({ lengthMeters: 1000, pace: 300, heartRate: () => 140 });
    const start = track.points[0].time;
    // Strap silent from 100s to 200s.
    const hrReadings = track.hrReadings.filter((r) => r.time < start + 100_000 || r.time > start + 200_000);
    const streams = buildActivityStreams({ ...track, hrReadings })!;
    const gap = streams.time.filter((t, i) => t > 120 && t < 180 && streams.heartRate![i] === null);
    expect(gap.length).toBeGreaterThan(0);
  });

  it("keeps an altitude reading only where the fix could be trusted for one", () => {
    const track = syntheticTrack({ lengthMeters: 500, pace: 300, altitude: (m) => 100 + m / 50 });
    track.points[5] = { ...track.points[5], altitudeAccuracy: -1 };
    track.points[6] = { ...track.points[6], accuracy: 45 };
    const streams = buildActivityStreams(track)!;
    expect(streams.altitude).not.toBeNull();
    expect(streams.altitude![5]).toBeNull();
    expect(streams.altitude![6]).toBeNull();
    expect(streams.altitude![7]).not.toBeNull();
  });

  it("decimates a very long run instead of truncating it", () => {
    const track = syntheticTrack({ lengthMeters: 80_000, pace: 360 });
    const streams = buildActivityStreams(track)!;
    expect(streams.time.length).toBeLessThanOrEqual(STREAM_CONFIG.MAX_SAMPLES);
    expect(totalDistanceMeters(streams)).toBeCloseTo(80_000, -1);
  });

  it("returns null for a track too short to analyse", () => {
    expect(buildActivityStreams({ points: [], pauses: [], hrReadings: [], cadenceSamples: [] })).toBeNull();
    const one = syntheticTrack({ lengthMeters: 0, pace: 300 });
    expect(buildActivityStreams(one)).toBeNull();
  });
});

describe("parseActivityStreams", () => {
  it("round-trips what buildActivityStreams produced", () => {
    const streams = buildActivityStreams(
      syntheticTrack({ lengthMeters: 1000, pace: 300, heartRate: () => 150, altitude: () => 20 })
    )!;
    expect(parseActivityStreams(JSON.parse(JSON.stringify(streams)))).toEqual(streams);
  });

  it("rejects mismatched lengths and non-monotonic series", () => {
    expect(parseActivityStreams({ time: [0, 1, 2], distance: [0, 10] })).toBeNull();
    expect(parseActivityStreams({ time: [0, 2, 1], distance: [0, 10, 20] })).toBeNull();
    expect(parseActivityStreams({ time: [0, 1, 2], distance: [0, 20, 10] })).toBeNull();
    expect(parseActivityStreams({ time: [0], distance: [0] })).toBeNull();
    expect(parseActivityStreams(null)).toBeNull();
    expect(parseActivityStreams("streams")).toBeNull();
  });

  it("nulls an impossible sensor value rather than dropping the channel", () => {
    const parsed = parseActivityStreams({
      time: [0, 5, 10],
      distance: [0, 20, 40],
      heartRate: [140, 0, 145],
    });
    expect(parsed?.heartRate).toEqual([140, null, 145]);
  });
});

describe("timeAtDistance", () => {
  it("interpolates inside the leg that contains the distance", () => {
    const streams = { time: [0, 10, 20], distance: [0, 50, 100], altitude: null, heartRate: null, cadence: null };
    expect(timeAtDistance(streams, 75)).toBe(15);
    expect(timeAtDistance(streams, 0)).toBe(0);
    expect(timeAtDistance(streams, 100)).toBe(20);
    expect(timeAtDistance(streams, 101)).toBeNull();
  });
});
