import { describe, expect, it } from "vitest";
import { estimateLactateThreshold, estimateRaceEffortVo2Max, vdot } from "./fitness-estimates";

describe("vdot — Daniels & Gilbert VDOT formula", () => {
  it("a 20:00 5K lands close to the published VDOT table value (~50)", () => {
    const result = vdot(5000, 20 * 60);
    expect(result).not.toBeNull();
    expect(result as number).toBeGreaterThan(47);
    expect(result as number).toBeLessThan(52);
  });

  it("a faster time over the same distance always yields a higher VDOT", () => {
    const slower = vdot(5000, 22 * 60);
    const faster = vdot(5000, 19 * 60);
    expect(faster).not.toBeNull();
    expect(slower).not.toBeNull();
    expect((faster as number)).toBeGreaterThan(slower as number);
  });

  it("returns null for effort durations outside the formula's calibrated range", () => {
    expect(vdot(400, 60)).toBeNull(); // 1min — too short (near-sprint, not aerobic)
    expect(vdot(42195, 5 * 3600)).toBeNull(); // 5h marathon — too long
  });

  it("returns null for a non-positive distance", () => {
    expect(vdot(0, 1200)).toBeNull();
  });
});

describe("estimateRaceEffortVo2Max", () => {
  it("prefers a real logged race over the predicted-5K fallback", () => {
    const result = estimateRaceEffortVo2Max(
      [{ distanceMeters: 10000, durationSeconds: 42 * 60, startedAt: "2026-06-01T09:00:00Z" }],
      1100 // a predicted 5K that would otherwise be used
    );
    expect(result?.source).toBe("logged-race");
  });

  it("falls back to the predicted 5K when no race is logged", () => {
    const result = estimateRaceEffortVo2Max([], 1100); // 18:20 5K
    expect(result?.source).toBe("predicted-5k");
    expect(result?.value).toBeGreaterThan(40);
  });

  it("returns null when neither a race nor a prediction is available", () => {
    expect(estimateRaceEffortVo2Max([], null)).toBeNull();
  });

  it("picks the most recent race when multiple are logged", () => {
    const result = estimateRaceEffortVo2Max(
      [
        { distanceMeters: 5000, durationSeconds: 22 * 60, startedAt: "2026-01-01T09:00:00Z" },
        { distanceMeters: 5000, durationSeconds: 19 * 60, startedAt: "2026-06-01T09:00:00Z" },
      ],
      null
    );
    expect(result?.asOfIso).toBe("2026-06-01T09:00:00Z");
  });
});

describe("estimateLactateThreshold", () => {
  const baseSession = {
    sport: "running" as const,
    durationSeconds: 25 * 60,
    distanceMeters: 6000,
    avgHeartRate: 168,
  };

  it("estimates HR and pace from tagged threshold/tempo sessions", () => {
    const result = estimateLactateThreshold([
      { ...baseSession, sessionType: "threshold", startedAt: "2026-07-01T09:00:00Z" },
    ]);
    expect(result).not.toBeNull();
    expect(result?.hrBpm).toBe(168);
    expect(result?.paceSecondsPerKm).toBe(Math.round((25 * 60) / 6));
    expect(result?.confidence).toBe("low"); // only 1 session
  });

  it("excludes race-tagged sessions entirely — a 5K and a marathon aren't the same effort", () => {
    const result = estimateLactateThreshold([
      { ...baseSession, sessionType: "race", startedAt: "2026-07-01T09:00:00Z" },
    ]);
    expect(result).toBeNull();
  });

  it("excludes sessions shorter than a genuine sustained threshold effort", () => {
    const result = estimateLactateThreshold([
      {
        ...baseSession,
        sessionType: "threshold",
        durationSeconds: 5 * 60, // a 5-minute interval rep, not a real LT test
        startedAt: "2026-07-01T09:00:00Z",
      },
    ]);
    expect(result).toBeNull();
  });

  it("averages the most recent qualifying sessions and reports higher confidence with more data", () => {
    const result = estimateLactateThreshold([
      { ...baseSession, sessionType: "threshold", avgHeartRate: 165, startedAt: "2026-05-01T09:00:00Z" },
      { ...baseSession, sessionType: "tempo", avgHeartRate: 168, startedAt: "2026-06-01T09:00:00Z" },
      { ...baseSession, sessionType: "threshold", avgHeartRate: 171, startedAt: "2026-07-01T09:00:00Z" },
    ]);
    expect(result?.sampleCount).toBe(3);
    expect(result?.confidence).toBe("high");
    expect(result?.hrBpm).toBe(168); // average of 165/168/171
    expect(result?.asOfIso).toBe("2026-07-01T09:00:00Z"); // most recent
  });

  it("picks the sport with the most qualifying sessions when multiple sports have threshold data", () => {
    const result = estimateLactateThreshold([
      { ...baseSession, sport: "rowing", sessionType: "threshold", startedAt: "2026-07-01T09:00:00Z" },
      { ...baseSession, sport: "running", sessionType: "threshold", startedAt: "2026-06-01T09:00:00Z" },
      { ...baseSession, sport: "running", sessionType: "tempo", startedAt: "2026-05-01T09:00:00Z" },
    ]);
    expect(result?.sport).toBe("running");
  });

  it("returns null when there are no qualifying sessions at all", () => {
    expect(estimateLactateThreshold([])).toBeNull();
    expect(
      estimateLactateThreshold([{ ...baseSession, sessionType: "easy", startedAt: "2026-07-01T09:00:00Z" }])
    ).toBeNull();
  });
});
