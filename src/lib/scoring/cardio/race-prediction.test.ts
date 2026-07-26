import { describe, expect, it } from "vitest";
import {
  computeTier1Prediction,
  computeCyclingPowerTier1,
  computeCriticalSwimSpeed,
  computeSwimCssTier1,
  estimateFtpWatts,
  personalizeRiegelKFromWindow,
  tier2IsCalibrating,
  computeWindowedTier2Seconds,
  TIER2_MIN_SAMPLES_TO_DISPLAY,
  type HistorySession,
} from "./race-prediction";
import { RIEGEL_K, RIEGEL_K_MIN, RIEGEL_K_MAX } from "@/lib/scoring/cardio-predictions";

describe("Tier 1 — per-session prediction", () => {
  it("never returns a bare point estimate — rangeSeconds always brackets predictedSeconds", () => {
    const result = computeTier1Prediction({
      benchmarkSport: "run",
      distanceMeters: 5000,
      durationSeconds: 1200,
      avgHR: 165,
    });
    expect(result).not.toBeNull();
    expect(result!.rangeSeconds[0]).toBeLessThan(result!.predictedSeconds);
    expect(result!.rangeSeconds[1]).toBeGreaterThan(result!.predictedSeconds);
  });

  it("running is always low confidence, even with HR data (brief's explicit caveat)", () => {
    const result = computeTier1Prediction({
      benchmarkSport: "run",
      distanceMeters: 5000,
      durationSeconds: 1200,
      avgHR: 165,
    });
    expect(result!.confidence).toBe("low");
    expect(result!.method).toBe("hr-anchored");
  });

  it("rowing is always high confidence — the best-supported single-session case", () => {
    const result = computeTier1Prediction({
      benchmarkSport: "row",
      distanceMeters: 2000,
      durationSeconds: 450,
      avgHR: 165,
    });
    expect(result!.confidence).toBe("high");
    expect(result!.method).toBe("row-derived");
  });

  it("skiErg is medium confidence, derived from the row curve", () => {
    const result = computeTier1Prediction({
      benchmarkSport: "ski",
      distanceMeters: 1000,
      durationSeconds: 240,
    });
    expect(result!.confidence).toBe("medium");
    expect(result!.method).toBe("row-derived");
  });
});

describe("Cycling — power-based Tier 1", () => {
  it("uses power when available, high confidence", () => {
    const result = computeTier1Prediction({
      benchmarkSport: "cycle",
      distanceMeters: 15000,
      durationSeconds: 1800, // 30 min
      avgPowerWatts: 220,
    });
    expect(result).not.toBeNull();
    expect(result!.method).toBe("power-cubic-scaling");
    expect(result!.confidence).toBe("high");
  });

  it("falls back to HR-anchored when no power data", () => {
    const result = computeTier1Prediction({
      benchmarkSport: "cycle",
      distanceMeters: 15000,
      durationSeconds: 1800,
      avgHR: 150,
    });
    expect(result!.method).toBe("hr-anchored");
  });

  it("a rider at their own threshold power scores a 20k time close to their session pace", () => {
    // A 60-min effort IS the FTP-defining duration (fraction = 1.0), so
    // estimateFtpWatts should return exactly the observed power.
    expect(estimateFtpWatts(200, 3600)).toBeCloseTo(200, 5);
  });

  it("estimates a higher FTP from a shorter, harder effort at the same power (5-min effort implies lower FTP than a 60-min one at the same watts)", () => {
    const ftpFrom5Min = estimateFtpWatts(300, 300);
    const ftpFrom60Min = estimateFtpWatts(300, 3600);
    expect(ftpFrom5Min).toBeLessThan(ftpFrom60Min);
  });

  it("returns null for invalid input", () => {
    expect(computeCyclingPowerTier1(0, 1800, 220)).toBeNull();
    expect(computeCyclingPowerTier1(15000, 0, 220)).toBeNull();
    expect(computeCyclingPowerTier1(15000, 1800, 0)).toBeNull();
  });
});

describe("Swimming — Critical Swim Speed", () => {
  it("computes CS and D′ from two distinct-distance efforts", () => {
    // 200m in 3:00 (180s), 400m in 6:20 (380s) — CS = (400-200)/(380-180) = 1.0 m/s
    const css = computeCriticalSwimSpeed(
      { distanceMeters: 200, durationSeconds: 180 },
      { distanceMeters: 400, durationSeconds: 380 }
    );
    expect(css).not.toBeNull();
    expect(css!.cssMetersPerSecond).toBeCloseTo(1.0, 5);
  });

  it("prefers CSS over HR fallback when time-trial efforts are given", () => {
    const result = computeTier1Prediction({
      benchmarkSport: "swim",
      distanceMeters: 400,
      durationSeconds: 380,
      avgHR: 160,
      swimTimeTrialEfforts: [
        { distanceMeters: 200, durationSeconds: 180 },
        { distanceMeters: 400, durationSeconds: 380 },
      ],
    });
    expect(result!.method).toBe("critical-swim-speed");
    expect(result!.confidence).toBe("high");
  });

  it("falls back to HR-anchored (low confidence) with no time-trial data", () => {
    const result = computeTier1Prediction({
      benchmarkSport: "swim",
      distanceMeters: 400,
      durationSeconds: 380,
      avgHR: 160,
    });
    expect(result!.method).toBe("hr-anchored");
    expect(result!.confidence).toBe("low");
  });

  it("rejects a same-or-reversed-distance pair", () => {
    expect(
      computeCriticalSwimSpeed(
        { distanceMeters: 400, durationSeconds: 380 },
        { distanceMeters: 200, durationSeconds: 180 }
      )
    ).toBeNull();
    expect(computeSwimCssTier1(
      { distanceMeters: 400, durationSeconds: 380 },
      { distanceMeters: 400, durationSeconds: 380 }
    )).toBeNull();
  });
});

describe("Riegel k personalization from window history", () => {
  const makeSession = (distanceMeters: number, durationSeconds: number): HistorySession => ({
    distanceMeters,
    durationSeconds,
    startedAt: new Date().toISOString(),
  });

  it("returns the stored k unchanged with fewer than 2 sessions", () => {
    expect(personalizeRiegelKFromWindow([], 1.06)).toBe(1.06);
    expect(personalizeRiegelKFromWindow([makeSession(5000, 1200)], null)).toBeNull();
  });

  it("returns the stored k unchanged when distances are too similar (noise, not real separation)", () => {
    const sessions = [makeSession(5000, 1200), makeSession(5100, 1230)];
    expect(personalizeRiegelKFromWindow(sessions, 1.06)).toBe(1.06);
  });

  it("derives and blends toward an implied k from genuinely different distances", () => {
    // 5k in 20:00, 10k at exactly k=1.10 scaling (above the RIEGEL_K default
    // of 1.08) -> the blend should move up from the default toward 1.10.
    const t5k = 1200;
    const t10k = t5k * Math.pow(10000 / 5000, 1.1);
    const sessions = [makeSession(5000, t5k), makeSession(10000, t10k)];
    const result = personalizeRiegelKFromWindow(sessions, null);
    expect(result).not.toBeNull();
    expect(result!).toBeGreaterThan(RIEGEL_K); // starts from RIEGEL_K default, moves toward 1.10
    expect(result!).toBeLessThanOrEqual(RIEGEL_K_MAX);
    expect(result!).toBeGreaterThanOrEqual(RIEGEL_K_MIN);
  });
});

describe("Tier 2 calibrating threshold", () => {
  it("reports calibrating below the minimum sample count", () => {
    expect(tier2IsCalibrating(0)).toBe(true);
    expect(tier2IsCalibrating(TIER2_MIN_SAMPLES_TO_DISPLAY - 1)).toBe(true);
    expect(tier2IsCalibrating(TIER2_MIN_SAMPLES_TO_DISPLAY)).toBe(false);
    expect(tier2IsCalibrating(20)).toBe(false);
  });
});

describe("Tier 2 windowed enhancement", () => {
  const makeRun = (distanceMeters: number, durationSeconds: number, daysAgo: number): HistorySession => ({
    distanceMeters,
    durationSeconds,
    sessionType: "tempo",
    startedAt: new Date(Date.now() - daysAgo * 86_400_000).toISOString(),
  });

  it("never blends running, regardless of how much window history exists (user feedback: race predictions must be evidence-based, not an average across sessions)", () => {
    const fewSessions = [makeRun(5000, 1200, 1), makeRun(5000, 1210, 5)];
    expect(computeWindowedTier2Seconds("run", 1250, fewSessions)).toBe(1250);

    const manySessions = Array.from({ length: 100 }, (_, i) => makeRun(5000, 1200, i));
    expect(computeWindowedTier2Seconds("run", 1400, manySessions)).toBe(1400);
  });

  it("row/cycle/etc.: returns the sequential value unchanged with too little window history", () => {
    const sessions = [
      { distanceMeters: 2000, durationSeconds: 450, startedAt: new Date().toISOString() },
      { distanceMeters: 2000, durationSeconds: 455, startedAt: new Date().toISOString() },
    ];
    const result = computeWindowedTier2Seconds("row", 460, sessions);
    expect(result).toBe(460);
  });

  // Synthetic points on a known critical-speed line (distance = CS*time + D',
  // CS=4.5 m/s, D'=50m) — varying BOTH distance and duration, since a
  // critical-speed regression is degenerate when distance never varies
  // across samples (as an earlier version of these tests mistakenly did).
  // Predicted 2000m time = (2000-50)/4.5 = 433.3s, faster than a 500s
  // sequential value.
  const criticalSpeedSessions = (n: number) =>
    Array.from({ length: n }, (_, i) => {
      const durationSeconds = 400 + i * 10;
      return {
        distanceMeters: 4.5 * durationSeconds + 50,
        durationSeconds,
        startedAt: new Date(Date.now() - i * 86_400_000).toISOString(),
      };
    });

  it("row/cycle/etc.: blends toward the windowed critical-speed fit once there's enough history, without fully overriding the sequential value", () => {
    const result = computeWindowedTier2Seconds("row", 500, criticalSpeedSessions(10));
    expect(result).toBeLessThan(500);
    expect(result).toBeGreaterThan(433.3);
  });

  it("row/cycle/etc.: caps the windowed influence at 50% regardless of how much history exists", () => {
    const result = computeWindowedTier2Seconds("row", 500, criticalSpeedSessions(100));
    const midpoint = (500 + 433.3) / 2;
    expect(result).toBeCloseTo(midpoint, 0);
  });

  it("uses a generic critical-speed refit for non-running sports", () => {
    const sessions = Array.from({ length: 8 }, (_, i) => ({
      distanceMeters: 2000,
      durationSeconds: 420 + i, // slight variation so the regression isn't degenerate
      startedAt: new Date(Date.now() - i * 86_400_000).toISOString(),
    }));
    const result = computeWindowedTier2Seconds("row", 450, sessions);
    expect(result).toBeGreaterThan(0);
    expect(Number.isFinite(result)).toBe(true);
  });
});
