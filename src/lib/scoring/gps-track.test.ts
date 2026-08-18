import { describe, expect, it } from "vitest";
import {
  ROUTE_CONFIG,
  buildRoutePolyline,
  parseRoutePolyline,
  simplifyRoute,
  haversineDistanceMeters,
  summarizeGpsTrack,
  elevationGainMeters,
  summarizeIntervalSegments,
  summarizeFartlekSegments,
  trackDistanceMeters,
  movingMillis,
  isPaused,
  GPS_TRACKING_CONFIG,
  type GpsPoint,
  type HrReading,
  type RunSegment,
  type PauseInterval,
} from "./gps-track";

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

describe("elevationGainMeters", () => {
  it("returns null when no point has an altitude reading", () => {
    const points = buildCleanTrack(5, 10).map((p) => ({ ...p, altitude: null }));
    expect(elevationGainMeters(points)).toBeNull();
  });

  it("does not accumulate GPS altitude noise into phantom elevation gain", () => {
    // The reported bug, reproduced: a run whose real profile climbs 67m was
    // logged as 269m. The cause is that GPS altitude wanders continuously
    // (±10-15m is normal) and the old rule counted every positive wobble.
    // The error is one-directional — only positive deltas were summed — so
    // noise could only ever inflate, and it scales with sample count.
    //
    // Deterministic pseudo-noise so a failure is reproducible.
    let seed = 12345;
    const noise = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return (seed / 4294967296 - 0.5) * 12; // ±6m
    };

    const SAMPLES = 900;
    const TRUE_GAIN = 67;
    const points: GpsPoint[] = Array.from({ length: SAMPLES }, (_, i) => {
      // A single steady climb of TRUE_GAIN over the first half, flat after —
      // so the correct answer is unambiguous.
      const progress = Math.min(1, i / (SAMPLES / 2));
      const trueAltitude = 40 + TRUE_GAIN * progress;
      return point({
        latitude: 51.5 + i * 0.00009,
        longitude: -0.12,
        altitude: trueAltitude + noise(),
        accuracy: 8,
        time: i * 10_000,
      });
    });

    const gain = elevationGainMeters(points)!;
    // The naive sum on this data lands in the hundreds. Anything close to the
    // real profile is the fix working.
    expect(gain).toBeGreaterThan(TRUE_GAIN * 0.6);
    expect(gain).toBeLessThan(TRUE_GAIN * 1.6);
  });

  it("reports a flat run as flat, however many noisy samples it has", () => {
    let seed = 999;
    const noise = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return (seed / 4294967296 - 0.5) * 10;
    };
    const points: GpsPoint[] = Array.from({ length: 800 }, (_, i) =>
      point({ altitude: 50 + noise(), accuracy: 8, time: i * 10_000 })
    );
    // Treadmill-flat ground with a thousand noisy fixes must not read as a
    // hill. This is the same failure as the bug above, at its extreme.
    expect(elevationGainMeters(points)!).toBeLessThan(15);
  });

  it("still counts genuine rolling terrain", () => {
    // Six real, clean 20m hills — 120m of true climb, no noise anywhere.
    const points: GpsPoint[] = [];
    let t = 0;
    for (let hill = 0; hill < 6; hill++) {
      for (let i = 0; i < 30; i++) points.push(point({ altitude: 100 + (20 * i) / 30, accuracy: 5, time: (t += 10_000) }));
      for (let i = 0; i < 30; i++) points.push(point({ altitude: 120 - (20 * i) / 30, accuracy: 5, time: (t += 10_000) }));
    }
    const gain = elevationGainMeters(points)!;
    // Hysteresis under-reports slightly by design: the last few metres of each
    // summit sit below the threshold and are never banked. That is the price
    // of not counting noise, it is why every credible implementation reads
    // lower than a naive sum, and it is the right side to err on — a plan
    // built on inflated climb prescribes more than the athlete did.
    expect(gain).toBeGreaterThan(120 * 0.7);
    expect(gain).toBeLessThan(120 * 1.05);
  });

  it("drops fixes too inaccurate to carry a believable altitude", () => {
    const points: GpsPoint[] = [
      point({ altitude: 100, accuracy: 5, time: 0 }),
      // A 200m "climb" reported alongside a 400m accuracy figure is not a
      // climb, it is a bad fix.
      point({ altitude: 300, accuracy: 400, time: 10_000 }),
      point({ altitude: 102, accuracy: 5, time: 20_000 }),
    ];
    expect(elevationGainMeters(points)!).toBeLessThan(10);
  });

  it("returns null rather than zero when altitude was never recorded", () => {
    // "Not measured" and "ran on the flat" are different claims and must not
    // look the same downstream.
    const points = buildCleanTrack(5, 10).map((p) => ({ ...p, altitude: null }));
    expect(elevationGainMeters(points)).toBeNull();
  });

  it("sums only ascending deltas, live-partial sequences included", () => {
    const points: GpsPoint[] = [
      point({ altitude: 100, time: 0 }),
      point({ altitude: 108, time: 10_000 }),
      point({ altitude: 103, time: 20_000 }),
    ];
    // +8 (100->108), -5 ignored = 8m gain, even mid-run with only 3 fixes so far.
    expect(elevationGainMeters(points)).toBeCloseTo(8, 0);
  });
});

// ---------------------------------------------------------------------------
// Second reported elevation bug: a run with ~9m of real climb logged as 0.
//
// The fixtures below are the ones the algorithm was chosen against. Each is a
// full-length track (a 5km run at a 10m distance filter is ~500 fixes), because
// this class of bug only appears at realistic sample counts — the failure is
// statistical, not arithmetic, and a four-point fixture cannot show it.
// ---------------------------------------------------------------------------

/** Deterministic pseudo-random in [0,1) so any failure here is reproducible. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * `bumps` raised cosine rises of `amplitude` metres each across `samples`
 * fixes — i.e. exactly `bumps * amplitude` metres of true climb, on the kind of
 * gently rolling ground an ordinary road run actually covers.
 */
function rollingTerrain(samples: number, bumps: number, amplitude: number, base = 40): number[] {
  return Array.from(
    { length: samples },
    (_, i) => base + (amplitude / 2) * (1 - Math.cos((i / samples) * bumps * 2 * Math.PI))
  );
}

/** Per-sample GPS/barometer jitter of +/- `magnitude` metres. */
function withNoise(profile: number[], magnitude: number, seed: number): number[] {
  const next = seeded(seed);
  return profile.map((v) => v + (next() - 0.5) * 2 * magnitude);
}

function altitudeTrack(altitudes: number[], overrides: Partial<GpsPoint> = {}): GpsPoint[] {
  return altitudes.map((altitude, i) =>
    point({ latitude: 51.5 + i * 0.00009, longitude: -0.12, accuracy: 8, altitude, time: i * 10_000, ...overrides })
  );
}

describe("elevationGainMeters — small real climbs (reported: 9m read as 0)", () => {
  // The athlete's report. 9m of gain over a run is not one 9m hill, it is
  // three or four rises of a couple of metres each, and the previous flat 5m
  // gate discarded every one of them: the answer was exactly 0, on clean data
  // and noisy data alike.
  const TRUE_GAIN = 9;

  it("reads ~9m from three 3m rises on a clean trace, not 0", () => {
    const gain = elevationGainMeters(altitudeTrack(rollingTerrain(500, 3, 3)))!;
    expect(gain).toBeGreaterThan(TRUE_GAIN * 0.7);
    expect(gain).toBeLessThan(TRUE_GAIN * 1.3);
  });

  it("still reads ~9m through barometer-grade jitter (+/-1.5m)", () => {
    const gain = elevationGainMeters(altitudeTrack(withNoise(rollingTerrain(500, 3, 3), 1.5, 7)))!;
    expect(gain).toBeGreaterThan(TRUE_GAIN * 0.7);
    expect(gain).toBeLessThan(TRUE_GAIN * 1.4);
  });

  it("still reads ~9m through GPS-grade jitter (+/-4m), where the noise is larger than the terrain", () => {
    // The demanding case: every individual bump is smaller than the noise on
    // any single sample. It is recoverable only because terrain is spatially
    // wide and jitter is per-sample, which is what the noise-sized smoothing
    // window exploits.
    const gain = elevationGainMeters(altitudeTrack(withNoise(rollingTerrain(500, 3, 3), 4, 7)))!;
    expect(gain).toBeGreaterThan(TRUE_GAIN * 0.6);
    expect(gain).toBeLessThan(TRUE_GAIN * 1.5);
  });

  it("banks a continuous climb in full, summit included", () => {
    // Regression on the old accumulator, which banked only up to the sample
    // that crossed the threshold and reset there — a clean, uninterrupted 9m
    // climb read 5m, and every hill lost its top few metres the same way.
    const gain = elevationGainMeters(altitudeTrack(rollingTerrain(500, 0.5, 9)))!;
    expect(gain).toBeGreaterThan(8.5);
    expect(gain).toBeLessThan(9.5);
  });
});

describe("elevationGainMeters — jitter must still read flat", () => {
  // The other half of the trade. Lowering the gate is only defensible if pure
  // noise still reads zero at every noise level and every track length, since
  // positive-only accumulation means noise can inflate but never cancel.
  const NOISE_CASES: [string, number, number, number][] = [
    ["barometer-grade jitter over a 5km run", 500, 1.5, 4242],
    ["GPS-grade jitter over a 5km run", 500, 3, 4242],
    ["poor-reception jitter over a 9km run", 900, 6, 12345],
    ["heavy jitter over a short 1.2km run", 120, 4, 21],
    ["heavy jitter over a 600m warm-up", 60, 3, 33],
  ];

  for (const [label, samples, magnitude, seed] of NOISE_CASES) {
    it(`reads 0 for ${label}`, () => {
      const flat = new Array<number>(samples).fill(50);
      expect(elevationGainMeters(altitudeTrack(withNoise(flat, magnitude, seed)))!).toBe(0);
    });
  }

  it("does not let a noisy flat run out-climb a quiet real one", () => {
    const realButSmall = elevationGainMeters(altitudeTrack(withNoise(rollingTerrain(500, 3, 3), 1.5, 7)))!;
    const noisyButFlat = elevationGainMeters(altitudeTrack(withNoise(new Array(500).fill(50), 6, 12345)))!;
    expect(realButSmall).toBeGreaterThan(noisyButFlat);
  });
});

describe("elevationGainMeters — the device's own vertical accuracy", () => {
  it("discards altitudes the device flags as invalid rather than trusting them", () => {
    // CoreLocation reports a negative verticalAccuracy when the altitude it
    // handed over is not a measurement. Counting it would put a fabricated
    // climb straight into the athlete's training load.
    const points: GpsPoint[] = [
      point({ altitude: 100, accuracy: 5, altitudeAccuracy: 3, time: 0 }),
      point({ altitude: 400, accuracy: 5, altitudeAccuracy: -1, time: 10_000 }),
      point({ altitude: 102, accuracy: 5, altitudeAccuracy: 3, time: 20_000 }),
    ];
    expect(elevationGainMeters(points)!).toBeLessThan(5);
  });

  it("stays conservative when the device admits its altitude is uncertain", () => {
    // Same trace, two devices. One says it is good to 2m and its small rises
    // are believed; one says +/-15m, and on that data we deliberately
    // under-report rather than bank climbs we cannot stand behind.
    const profile = withNoise(rollingTerrain(500, 3, 3), 1.5, 7);
    const precise = elevationGainMeters(altitudeTrack(profile, { altitudeAccuracy: 2 }))!;
    const vague = elevationGainMeters(altitudeTrack(profile, { altitudeAccuracy: 15 }))!;
    expect(precise).toBeGreaterThan(6);
    expect(vague).toBeLessThan(precise);
  });

  it("treats a missing vertical accuracy as absent, not as zero confidence", () => {
    // Imported GPX and everything recorded before the field existed carry no
    // altitudeAccuracy at all; they must not be penalised for it.
    const profile = rollingTerrain(500, 3, 3);
    expect(elevationGainMeters(altitudeTrack(profile))).toBeGreaterThan(6);
  });
});

describe("pause handling", () => {
  // The pause bug's data half: a paused run must not have the pause counted as
  // either time run or ground covered. A two-minute wait at a crossing that
  // shows up as 400m at 0:30/km destroys the pace, the score, and the athlete's
  // trust in every number on the screen.
  const pause: PauseInterval[] = [{ startTime: 100_000, endTime: 400_000 }];

  it("does not count a paused stretch toward moving time", () => {
    expect(movingMillis(0, 500_000, pause)).toBe(200_000);
  });

  it("treats an open pause as running to the end of the window", () => {
    expect(movingMillis(0, 500_000, [{ startTime: 100_000, endTime: null }])).toBe(100_000);
  });

  it("counts everything when nothing was paused", () => {
    expect(movingMillis(0, 500_000, [])).toBe(500_000);
    expect(movingMillis(0, 500_000)).toBe(500_000);
  });

  it("never draws a straight line across the pause", () => {
    // Ten fixes 100m apart. The athlete stops after the second, is driven 5km
    // away, and restarts. Only the legs on either side of the pause are real.
    const before = buildCleanTrack(3, 30); // t = 0, 30_000, 60_000
    const after: GpsPoint[] = [
      point({ latitude: 51.55, longitude: -0.12, accuracy: 5, time: 420_000 }),
      point({ latitude: 51.5509, longitude: -0.12, accuracy: 5, time: 450_000 }),
    ];
    const distance = trackDistanceMeters([...before, ...after], pause);
    // 200m before + 100m after. The ~5km jump across the pause is not distance
    // the athlete covered on foot.
    expect(distance).toBeGreaterThan(250);
    expect(distance).toBeLessThan(350);
  });

  it("ignores fixes recorded while paused — drift while standing still is not running", () => {
    const points: GpsPoint[] = [
      point({ latitude: 51.5, longitude: -0.12, accuracy: 5, time: 0 }),
      point({ latitude: 51.5009, longitude: -0.12, accuracy: 5, time: 60_000 }),
      // Standing at a crossing; the receiver wanders 300m around.
      point({ latitude: 51.5036, longitude: -0.12, accuracy: 5, time: 200_000 }),
      point({ latitude: 51.5009, longitude: -0.12, accuracy: 5, time: 300_000 }),
      point({ latitude: 51.5018, longitude: -0.12, accuracy: 5, time: 450_000 }),
    ];
    // Only the first 100m leg counts; the pause swallows the drift, and the
    // leg out of the pause is skipped as spanning it.
    expect(trackDistanceMeters(points, pause)).toBeCloseTo(100, -1);
  });

  it("summarizes a paused run on moving time and moving distance", () => {
    const points: GpsPoint[] = [
      point({ latitude: 51.5, longitude: -0.12, accuracy: 5, time: 0 }),
      point({ latitude: 51.5009, longitude: -0.12, accuracy: 5, time: 50_000 }),
      point({ latitude: 51.5018, longitude: -0.12, accuracy: 5, time: 100_000 }),
      // 300 seconds paused here.
      point({ latitude: 51.5027, longitude: -0.12, accuracy: 5, time: 450_000 }),
      point({ latitude: 51.5036, longitude: -0.12, accuracy: 5, time: 500_000 }),
    ];
    const summary = summarizeGpsTrack(points, {
      endedCleanly: true,
      permissionRevoked: false,
      pauses: pause,
    });
    // 500s wall clock, 300s of it paused.
    expect(summary.durationSeconds).toBe(200);
    // 200m before the pause + 100m after; the leg across it is skipped.
    expect(summary.distanceMeters).toBeGreaterThan(250);
    expect(summary.distanceMeters).toBeLessThan(350);
    // And the pace that falls out of those two is a real pace, not a fantasy.
    expect(summary.avgPaceSecondsPerKm).toBeGreaterThan(400);
    expect(summary.avgPaceSecondsPerKm).toBeLessThan(900);
  });

  it("does not flag a deliberate pause as an interrupted session", () => {
    // A five-minute pause is longer than MAX_ACCEPTABLE_GAP_SECONDS. Without
    // deducting it, every paused run would be saved as a partial effort and
    // scored as if tracking had failed.
    const points: GpsPoint[] = [
      point({ latitude: 51.5, longitude: -0.12, accuracy: 5, time: 0 }),
      point({ latitude: 51.5009, longitude: -0.12, accuracy: 5, time: 100_000 }),
      point({ latitude: 51.5018, longitude: -0.12, accuracy: 5, time: 450_000 }),
    ];
    const summary = summarizeGpsTrack(points, {
      endedCleanly: true,
      permissionRevoked: false,
      pauses: pause,
    });
    expect(summary.isPartial).toBe(false);
    expect(summary.partialReason).toBeNull();

    // The same track with no pause recorded genuinely is an interrupted one.
    const unpaused = summarizeGpsTrack(points, { endedCleanly: true, permissionRevoked: false });
    expect(unpaused.partialReason).toBe("sampling_gap");
  });

  it("keeps everything recorded before the pause — resuming is not a restart", () => {
    const before = buildCleanTrack(3, 30);
    const after: GpsPoint[] = [
      point({ latitude: 51.5027, longitude: -0.12, accuracy: 5, altitude: 10, time: 420_000 }),
      point({ latitude: 51.5036, longitude: -0.12, accuracy: 5, altitude: 10, time: 450_000 }),
    ];
    const summary = summarizeGpsTrack([...before, ...after], {
      endedCleanly: true,
      permissionRevoked: false,
      pauses: pause,
    });
    // 200m from before the pause survives into the final total.
    expect(summary.distanceMeters).toBeGreaterThan(250);
  });

  it("excludes altitude recorded while paused from elevation gain", () => {
    // Standing still on a windy day: the barometer wanders 20m and back.
    const points: GpsPoint[] = [
      point({ altitude: 100, accuracy: 5, time: 0 }),
      point({ altitude: 100, accuracy: 5, time: 60_000 }),
      point({ altitude: 120, accuracy: 5, time: 200_000 }),
      point({ altitude: 100, accuracy: 5, time: 300_000 }),
      point({ altitude: 101, accuracy: 5, time: 450_000 }),
    ];
    const summary = summarizeGpsTrack(points, {
      endedCleanly: true,
      permissionRevoked: false,
      pauses: pause,
    });
    expect(summary.elevationGainMeters).toBeLessThan(5);
  });

  it("identifies which instants fall inside a pause", () => {
    expect(isPaused(50_000, pause)).toBe(false);
    expect(isPaused(200_000, pause)).toBe(true);
    expect(isPaused(500_000, pause)).toBe(false);
    expect(isPaused(500_000, [{ startTime: 100_000, endTime: null }])).toBe(true);
    // The boundary fixes themselves belong to the run: the one at the pause is
    // the last position before it, the one at the resume the first after.
    expect(isPaused(100_000, pause)).toBe(false);
    expect(isPaused(400_000, pause)).toBe(false);
  });
});

function segment(type: "hard" | "easy", startTime: number, endTime: number): RunSegment {
  return { type, startTime, endTime };
}

describe("summarizeIntervalSegments", () => {
  it("returns null when no hard segment was ever marked", () => {
    const points = buildCleanTrack(11, 30);
    expect(summarizeIntervalSegments(points, [], [segment("easy", 0, 300_000)])).toBeNull();
  });

  it("averages varying real-world rep lengths into a uniform reps/work/rest shape", () => {
    // 11 points, 100m/30s apart -> 0..300s, 0..1000m.
    const points = buildCleanTrack(11, 30);
    const hrReadings: HrReading[] = [
      { bpm: 160, time: 20_000 },
      { bpm: 170, time: 80_000 },
      { bpm: 150, time: 220_000 },
      { bpm: 180, time: 280_000 },
    ];
    // Two hard reps (0-90s ~300m, 180-300s ~400m) separated by one easy/rest window (90-180s).
    const segments: RunSegment[] = [
      segment("hard", 0, 90_000),
      segment("easy", 90_000, 180_000),
      segment("hard", 180_000, 300_000),
    ];

    const result = summarizeIntervalSegments(points, hrReadings, segments);
    expect(result).not.toBeNull();
    expect(result!.reps).toBe(2);
    expect(result!.restSeconds).toBe(90);
    // Average per-rep distance: (~300m + ~400m) / 2 reps.
    expect(result!.workDistanceMeters).toBeGreaterThan(300);
    expect(result!.workDistanceMeters).toBeLessThan(400);
    // Average per-rep duration: (90s + 120s) / 2 = 105s.
    expect(result!.workSecondsPerRep).toBe(105);
    // Only HR readings inside the two hard windows count (all 4, in this fixture).
    expect(result!.workAvgHr).toBe(Math.round((160 + 170 + 150 + 180) / 4));
  });

  it("ignores zero-length (never-closed) segments", () => {
    const points = buildCleanTrack(11, 30);
    const segments: RunSegment[] = [segment("hard", 100_000, 100_000)];
    expect(summarizeIntervalSegments(points, [], segments)).toBeNull();
  });
});

describe("summarizeFartlekSegments", () => {
  it("returns null when no hard segment was ever marked", () => {
    const points = buildCleanTrack(11, 30);
    expect(summarizeFartlekSegments(points, [], [segment("easy", 0, 300_000)])).toBeNull();
  });

  it("sums total hard-effort distance/time across all 'on' segments, no rep averaging", () => {
    const points = buildCleanTrack(11, 30);
    const hrReadings: HrReading[] = [{ bpm: 165, time: 20_000 }, { bpm: 175, time: 250_000 }];
    const segments: RunSegment[] = [
      segment("hard", 0, 60_000),
      segment("easy", 60_000, 150_000),
      segment("hard", 150_000, 270_000),
    ];

    const result = summarizeFartlekSegments(points, hrReadings, segments);
    expect(result).not.toBeNull();
    expect(result!.onSeconds).toBe(60 + 120);
    expect(result!.onAvgHr).toBe(Math.round((165 + 175) / 2));
    expect(result!.onDistanceMeters).toBeGreaterThan(0);
  });
});


describe("route polyline (logbook map)", () => {
  it("keeps the shape of a route while dropping redundant points", () => {
    // A dead-straight 1km line sampled every 10m: 100 fixes describing
    // something two points describe exactly as well.
    const straight: GpsPoint[] = Array.from({ length: 100 }, (_, i) =>
      point({ latitude: 51.5 + i * 0.00009, longitude: -0.12, accuracy: 5, time: i * 10_000 })
    );
    const simplified = simplifyRoute(straight);
    expect(simplified.length).toBeLessThan(5);
    // Start and finish are never dropped — a route that does not begin where
    // the athlete began is not their route.
    expect(simplified[0]).toEqual(straight[0]);
    expect(simplified[simplified.length - 1]).toEqual(straight[straight.length - 1]);
  });

  it("preserves corners, which are the part that makes a route recognisable", () => {
    const corner: GpsPoint[] = [
      ...Array.from({ length: 30 }, (_, i) => point({ latitude: 51.5 + i * 0.0002, longitude: -0.12, time: i * 1000 })),
      ...Array.from({ length: 30 }, (_, i) =>
        point({ latitude: 51.506, longitude: -0.12 + i * 0.0003, time: 30_000 + i * 1000 })
      ),
    ];
    const simplified = simplifyRoute(corner);
    // The turn must survive.
    expect(simplified.length).toBeGreaterThanOrEqual(3);
    expect(simplified.some((p) => Math.abs(p.latitude - 51.506) < 1e-6)).toBe(true);
  });

  it("caps a long route by simplifying harder, never by truncating it", () => {
    // Truncation would draw a route that stops halfway through the run.
    const wiggly: GpsPoint[] = Array.from({ length: 5000 }, (_, i) =>
      point({
        latitude: 51.5 + i * 0.00002 + Math.sin(i / 3) * 0.0004,
        longitude: -0.12 + Math.cos(i / 5) * 0.0006,
        accuracy: 5,
        time: i * 5_000,
      })
    );
    const polyline = buildRoutePolyline(wiggly)!;
    expect(polyline.length).toBeLessThanOrEqual(ROUTE_CONFIG.MAX_POINTS);
    expect(polyline[0][0]).toBeCloseTo(wiggly[0].latitude, 4);
    expect(polyline[polyline.length - 1][0]).toBeCloseTo(wiggly[wiggly.length - 1].latitude, 4);
  });

  it("returns null when there is nothing worth drawing", () => {
    expect(buildRoutePolyline([])).toBeNull();
    expect(buildRoutePolyline([point({ latitude: 51.5, longitude: -0.12 })])).toBeNull();
  });

  it("drops inaccurate fixes so a bad lock does not put a spike through the route", () => {
    const withOutlier: GpsPoint[] = [
      point({ latitude: 51.5, longitude: -0.12, accuracy: 5, time: 0 }),
      point({ latitude: 52.9, longitude: 0.9, accuracy: 800, time: 10_000 }),
      point({ latitude: 51.501, longitude: -0.12, accuracy: 5, time: 20_000 }),
    ];
    const polyline = buildRoutePolyline(withOutlier)!;
    expect(polyline.every(([lat]) => lat < 52)).toBe(true);
  });

  it("round-trips through storage", () => {
    const points: GpsPoint[] = Array.from({ length: 50 }, (_, i) =>
      point({ latitude: 51.5 + i * 0.0001, longitude: -0.12 + i * 0.0001, accuracy: 5, time: i * 10_000 })
    );
    const stored = JSON.parse(JSON.stringify(buildRoutePolyline(points)));
    const parsed = parseRoutePolyline(stored)!;
    expect(parsed.length).toBeGreaterThanOrEqual(2);
    expect(parsed[0][0]).toBeCloseTo(51.5, 4);
  });

  it("refuses malformed or out-of-range stored values rather than rendering them", () => {
    // This value reaches a map component. Anything that is not a coordinate
    // must not get that far.
    expect(parseRoutePolyline(null)).toBeNull();
    expect(parseRoutePolyline("not a route")).toBeNull();
    expect(parseRoutePolyline([[1, 2]])).toBeNull();
    expect(parseRoutePolyline([[999, 0], [0, 999]])).toBeNull();
    expect(parseRoutePolyline([["a", "b"], ["c", "d"]])).toBeNull();
    expect(parseRoutePolyline([[51.5, -0.12], [51.51, -0.12]])).toHaveLength(2);
  });
});
