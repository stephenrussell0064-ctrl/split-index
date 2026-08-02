import { describe, expect, it } from "vitest";
import { haversineDistanceMeters, summarizeGpsTrack, GPS_TRACKING_CONFIG, type GpsPoint } from "./gps-track";

function point(overrides: Partial<GpsPoint> = {}): GpsPoint {
  return {
    latitude: 51.5,
    longitude: -0.12,
    accuracy: 5,
    altitude: null,
    time: 0,
    ...overrides,
  };
}

describe("haversineDistanceMeters", () => {
  it("returns ~0 for identical points", () => {
    const a = point();
    expect(haversineDistanceMeters(a, a)).toBeCloseTo(0, 1);
  });

  it("matches a known real-world distance within reasonable tolerance", () => {
    // London (51.5074, -0.1278) to Paris (48.8566, 2.3522) is ~344km.
    const london = point({ latitude: 51.5074, longitude: -0.1278 });
    const paris = point({ latitude: 48.8566, longitude: 2.3522 });
    const distanceKm = haversineDistanceMeters(london, paris) / 1000;
    expect(distanceKm).toBeGreaterThan(340);
    expect(distanceKm).toBeLessThan(348);
  });

  it("is symmetric", () => {
    const a = point({ latitude: 51.5, longitude: -0.12 });
    const b = point({ latitude: 51.51, longitude: -0.11 });
    expect(haversineDistanceMeters(a, b)).toBeCloseTo(haversineDistanceMeters(b, a), 6);
  });
});

// Roughly 0.0009 degrees of latitude is ~100m at this latitude — used below
// to build a synthetic straight-line track with known per-step spacing.
const LAT_STEP_100M = 0.0009;

function buildCleanTrack(steps: number, secondsPerStep: number): GpsPoint[] {
  return Array.from({ length: steps }, (_, i) => ({
    latitude: 51.5 + LAT_STEP_100M * i,
    longitude: -0.12,
    accuracy: 5,
    altitude: 10,
    time: i * secondsPerStep * 1000,
  }));
}

describe("summarizeGpsTrack", () => {
  it("returns a partial, zero-distance summary for fewer than 2 points", () => {
    const summary = summarizeGpsTrack([point()], { endedCleanly: true, permissionRevoked: false });
    expect(summary.isPartial).toBe(true);
    expect(summary.distanceMeters).toBe(0);
  });

  it("computes distance/pace/duration for a clean, evenly-sampled track", () => {
    // 11 points, 100m apart, 30s apart -> 1000m in 300s (5:00/km pace).
    const points = buildCleanTrack(11, 30);
    const summary = summarizeGpsTrack(points, { endedCleanly: true, permissionRevoked: false });

    expect(summary.isPartial).toBe(false);
    expect(summary.partialReason).toBeNull();
    expect(summary.durationSeconds).toBe(300);
    expect(summary.distanceMeters).toBeCloseTo(1000, -1);
    expect(summary.avgPaceSecondsPerKm).toBeCloseTo(300, 0);
  });

  it("flags a session ended without stopping cleanly as partial", () => {
    const points = buildCleanTrack(11, 30);
    const summary = summarizeGpsTrack(points, { endedCleanly: false, permissionRevoked: false });
    expect(summary.isPartial).toBe(true);
    expect(summary.partialReason).toBe("ended_without_stopping");
  });

  it("flags permission revocation as partial regardless of anything else", () => {
    const points = buildCleanTrack(11, 30);
    const summary = summarizeGpsTrack(points, { endedCleanly: true, permissionRevoked: true });
    expect(summary.isPartial).toBe(true);
    expect(summary.partialReason).toBe("permission_revoked");
  });

  it("flags a large sampling gap as partial even when the session was stopped cleanly (live-bug-class regression: never score a truncated track as complete)", () => {
    const before = buildCleanTrack(5, 10); // 0..40s
    const gapSeconds = GPS_TRACKING_CONFIG.MAX_ACCEPTABLE_GAP_SECONDS + 60;
    const after: GpsPoint[] = [
      { latitude: 51.505, longitude: -0.12, accuracy: 5, altitude: 10, time: (40 + gapSeconds) * 1000 },
      { latitude: 51.506, longitude: -0.12, accuracy: 5, altitude: 10, time: (40 + gapSeconds + 30) * 1000 },
    ];

    const summary = summarizeGpsTrack([...before, ...after], { endedCleanly: true, permissionRevoked: false });
    expect(summary.isPartial).toBe(true);
    expect(summary.partialReason).toBe("sampling_gap");
  });

  it("discards fixes with poor accuracy rather than letting them inflate distance", () => {
    const points: GpsPoint[] = [
      point({ latitude: 51.5, longitude: -0.12, accuracy: 5, time: 0 }),
      // A wildly inaccurate fix jumping far away — should be dropped.
      point({ latitude: 52.0, longitude: 0.5, accuracy: 500, time: 10_000 }),
      point({ latitude: 51.5009, longitude: -0.12, accuracy: 5, time: 20_000 }),
    ];
    const summary = summarizeGpsTrack(points, { endedCleanly: true, permissionRevoked: false });
    // Only the two accurate fixes (~100m apart) should count.
    expect(summary.distanceMeters).toBeLessThan(200);
  });

  it("computes elevation gain only from ascending segments", () => {
    const points: GpsPoint[] = [
      point({ latitude: 51.5, longitude: -0.12, altitude: 100, time: 0 }),
      point({ latitude: 51.5009, longitude: -0.12, altitude: 110, time: 30_000 }),
      point({ latitude: 51.5018, longitude: -0.12, altitude: 105, time: 60_000 }),
      point({ latitude: 51.5027, longitude: -0.12, altitude: 120, time: 90_000 }),
    ];
    const summary = summarizeGpsTrack(points, { endedCleanly: true, permissionRevoked: false });
    // +10 (100->110), -5 ignored, +15 (105->120) = 25m gain.
    expect(summary.elevationGainMeters).toBeCloseTo(25, 0);
  });
});
