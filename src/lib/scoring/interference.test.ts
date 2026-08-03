import { describe, expect, it } from "vitest";
import { computeInterferenceReport, hasShareableFinding, INTERFERENCE_CONFIG } from "./interference";
import type { TimelineSession } from "./timeline";

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `activity-${idCounter}`;
}

function cardio(
  dayOffset: number,
  overrides: Partial<TimelineSession> = {}
): TimelineSession {
  return {
    activityId: nextId(),
    sport: "running",
    domain: "cardio",
    startedAt: new Date(Date.UTC(2026, 0, 1 + dayOffset, 8)).toISOString(),
    durationSeconds: 2400,
    sessionType: "easy",
    avgHeartRate: 140,
    avgPaceSecondsPerKm: 330,
    loadScore: 40,
    enduranceComponent: 500,
    strengthComponent: null,
    efficiencyFactor: 5.0,
    ...overrides,
  };
}

function strength(
  dayOffset: number,
  overrides: Partial<TimelineSession> = {}
): TimelineSession {
  return {
    activityId: nextId(),
    sport: "gym",
    domain: "strength",
    startedAt: new Date(Date.UTC(2026, 0, 1 + dayOffset, 18)).toISOString(),
    durationSeconds: 3600,
    sessionType: null,
    avgHeartRate: null,
    avgPaceSecondsPerKm: null,
    loadScore: 60,
    enduranceComponent: null,
    strengthComponent: 500,
    efficiencyFactor: null,
    ...overrides,
  };
}

describe("computeInterferenceReport — strength-to-cardio direction", () => {
  it("reports calibrating with no sessions", () => {
    const report = computeInterferenceReport([]);
    expect(report.strengthToCardio.calibrating).toBe(true);
    expect(report.strengthToCardio.summary).toMatch(/log a few/i);
  });

  it("reports calibrating below MIN_PAIRED_SESSIONS", () => {
    const sessions = [
      strength(1),
      cardio(2, { efficiencyFactor: 4.5, avgHeartRate: 146 }),
    ];
    const report = computeInterferenceReport(sessions);
    expect(report.strengthToCardio.calibrating).toBe(true);
  });

  it("names the real blocker when plenty of easy-effort sessions exist but none fall near a strength session (live-bug regression)", () => {
    // A user who logs 10 easy runs on a weekly cadence and only 2 gym
    // sessions clustered far from any of them (e.g. only at the very end)
    // should NOT see the generic "gathering data" — plenty of qualifying
    // cardio is logged, it's just never close enough in time to a
    // strength session to pair against.
    const sessions: TimelineSession[] = [
      strength(1),
      strength(2),
      cardio(20, { efficiencyFactor: 5.0, avgHeartRate: 140 }),
      cardio(27, { efficiencyFactor: 5.0, avgHeartRate: 140 }),
      cardio(34, { efficiencyFactor: 5.0, avgHeartRate: 140 }),
      cardio(41, { efficiencyFactor: 5.0, avgHeartRate: 140 }),
      cardio(48, { efficiencyFactor: 5.0, avgHeartRate: 140 }),
      cardio(55, { efficiencyFactor: 5.0, avgHeartRate: 140 }),
    ];

    const report = computeInterferenceReport(sessions);
    const finding = report.strengthToCardio;

    expect(finding.calibrating).toBe(true);
    expect(finding.sampleCount).toBe(0);
    expect(finding.totalQualifyingSessions).toBe(6);
    expect(finding.summary).toMatch(/logged 6 easy-effort running session/i);
    expect(finding.summary).toMatch(/none within \d+ days/i);
    expect(finding.summary).not.toMatch(/^gathering data/i);
  });

  it("falls back to a coarser weekly comparison when day-level pairs are too sparse but weekly pattern data exists", () => {
    // 3 easy runs land the same day as a strength session (lower EF), 6 land
    // in weeks with no strength session at all (higher EF). Day-level
    // pairing has only 3 same-day pairs — below MIN_PAIRED_SESSIONS — so the
    // precise finding stays calibrating, but there's enough for the coarser
    // weekly bucket comparison.
    const sessions: TimelineSession[] = [
      cardio(10, { efficiencyFactor: 5.0, avgHeartRate: 140 }),
      cardio(15, { efficiencyFactor: 5.0, avgHeartRate: 140 }),
      strength(40),
      cardio(40, { efficiencyFactor: 4.5, avgHeartRate: 146 }),
      cardio(60, { efficiencyFactor: 5.0, avgHeartRate: 140 }),
      cardio(65, { efficiencyFactor: 5.0, avgHeartRate: 140 }),
      strength(80),
      cardio(80, { efficiencyFactor: 4.5, avgHeartRate: 146 }),
      cardio(100, { efficiencyFactor: 5.0, avgHeartRate: 140 }),
      cardio(105, { efficiencyFactor: 5.0, avgHeartRate: 140 }),
      strength(120),
      cardio(120, { efficiencyFactor: 4.5, avgHeartRate: 146 }),
    ];

    const report = computeInterferenceReport(sessions);
    const finding = report.strengthToCardio;

    expect(finding.calibrating).toBe(true);
    expect(finding.sampleCount).toBeLessThan(INTERFERENCE_CONFIG.MIN_PAIRED_SESSIONS);

    const fallback = finding.weeklyFallback;
    expect(fallback).not.toBeNull();
    expect(fallback!.sampleCountWithStrength).toBe(3);
    expect(fallback!.sampleCountWithoutStrength).toBe(6);
    expect(fallback!.weeksWithStrengthAvgEF).toBeCloseTo(4.5, 5);
    expect(fallback!.weeksWithoutStrengthAvgEF).toBeCloseTo(5.0, 5);
    expect(fallback!.deltaPct).toBeCloseTo(-10, 0);
    expect(fallback!.summary).toMatch(/10% lower/i);
    expect(fallback!.summary).toMatch(/weeks that include a strength session/i);

    // A real (if coarser) finding exists, so this should count as shareable.
    expect(hasShareableFinding(report)).toBe(true);
  });

  it("has no weekly fallback when one of the two groups has fewer than 2 samples", () => {
    const sessions: TimelineSession[] = [
      strength(1),
      cardio(1, { efficiencyFactor: 4.5, avgHeartRate: 146 }),
      cardio(30, { efficiencyFactor: 5.0, avgHeartRate: 140 }),
    ];

    const report = computeInterferenceReport(sessions);
    expect(report.strengthToCardio.calibrating).toBe(true);
    expect(report.strengthToCardio.weeklyFallback).toBeNull();
    expect(hasShareableFinding(report)).toBe(false);
  });

  it("detects a real interference pattern that decays by day 3, once enough pairs exist", () => {
    const sessions: TimelineSession[] = [
      // Day-1-after-strength cluster: EF down 10%, HR up 6bpm
      strength(1),
      cardio(2, { efficiencyFactor: 4.5, avgHeartRate: 146 }),
      strength(5),
      cardio(6, { efficiencyFactor: 4.5, avgHeartRate: 146 }),
      strength(9),
      cardio(10, { efficiencyFactor: 4.5, avgHeartRate: 146 }),
      // Day-3-after-strength cluster: nearly recovered
      strength(13),
      cardio(16, { efficiencyFactor: 4.95, avgHeartRate: 141 }),
      strength(20),
      cardio(23, { efficiencyFactor: 4.95, avgHeartRate: 141 }),
      // Rested baseline: 2+ full rest days before, EF at true baseline
      cardio(28, { efficiencyFactor: 5.0, avgHeartRate: 140 }),
      cardio(33, { efficiencyFactor: 5.0, avgHeartRate: 140 }),
      cardio(38, { efficiencyFactor: 5.0, avgHeartRate: 140 }),
    ];

    const report = computeInterferenceReport(sessions);
    const finding = report.strengthToCardio;

    expect(finding.calibrating).toBe(false);
    expect(finding.primarySport).toBe("running");

    const dayOne = finding.decayByDay.find((d) => d.daysSinceStrength === 1)!;
    expect(dayOne.efDeltaPct).toBeCloseTo(-10, 0);
    expect(dayOne.hrDeltaBpm).toBe(6);

    const dayThree = finding.decayByDay.find((d) => d.daysSinceStrength === 3)!;
    expect(Math.abs(dayThree.efDeltaPct!)).toBeLessThan(3);

    expect(finding.summary).toMatch(/cost you/i);
    expect(finding.summary).toMatch(/10%/);
    expect(finding.summary).toMatch(/recovering by day 3/i);
  });

  it("reports no measurable interference when EF barely moves", () => {
    const sessions: TimelineSession[] = [
      strength(1),
      cardio(2, { efficiencyFactor: 4.98, avgHeartRate: 141 }),
      strength(5),
      cardio(6, { efficiencyFactor: 4.97, avgHeartRate: 140 }),
      strength(9),
      cardio(10, { efficiencyFactor: 5.02, avgHeartRate: 139 }),
      strength(13),
      cardio(14, { efficiencyFactor: 5.0, avgHeartRate: 140 }),
      strength(17),
      cardio(18, { efficiencyFactor: 4.99, avgHeartRate: 140 }),
      cardio(23, { efficiencyFactor: 5.0, avgHeartRate: 140 }),
      cardio(28, { efficiencyFactor: 5.0, avgHeartRate: 140 }),
      cardio(33, { efficiencyFactor: 5.0, avgHeartRate: 140 }),
    ];

    const report = computeInterferenceReport(sessions);
    expect(report.strengthToCardio.calibrating).toBe(false);
    expect(report.strengthToCardio.summary).toMatch(/no measurable interference/i);
  });

  it("only compares session types the app already treats as steady-effort (easy/recovery/long)", () => {
    const sessions: TimelineSession[] = [
      strength(1),
      // A "race" session shouldn't be lumped in with easy-effort comparisons.
      cardio(2, { sessionType: "race", efficiencyFactor: 3.0, avgHeartRate: 180 }),
    ];
    const report = computeInterferenceReport(sessions);
    // With the race session excluded, there's nothing left to compare — still calibrating.
    expect(report.strengthToCardio.calibrating).toBe(true);
  });

  it("segments by sport and picks the most-logged qualifying sport", () => {
    const sessions: TimelineSession[] = [
      // 2 rowing sessions (minority)
      cardio(2, { sport: "rowing", efficiencyFactor: 2.0, avgHeartRate: 150 }),
      cardio(9, { sport: "rowing", efficiencyFactor: 2.0, avgHeartRate: 150 }),
      // 3 running sessions (majority)
      cardio(4, { sport: "running", efficiencyFactor: 5.0, avgHeartRate: 140 }),
      cardio(11, { sport: "running", efficiencyFactor: 5.0, avgHeartRate: 140 }),
      cardio(18, { sport: "running", efficiencyFactor: 5.0, avgHeartRate: 140 }),
    ];
    const report = computeInterferenceReport(sessions);
    expect(report.strengthToCardio.primarySport).toBe("running");
  });
});

describe("computeInterferenceReport — cardio-to-strength direction", () => {
  it("hard-blocks with only a single gym session (can't split into two groups at all)", () => {
    const report = computeInterferenceReport([strength(1)]);
    expect(report.cardioToStrength.calibrating).toBe(true);
  });

  it("shows a real, flagged-low-confidence finding with just 2 gym sessions below MIN_PAIRED_SESSIONS rather than hard-blocking", () => {
    const sessions = [strength(1), strength(3)];
    const report = computeInterferenceReport(sessions);
    expect(report.cardioToStrength.calibrating).toBe(false);
    expect(report.cardioToStrength.lowConfidence).toBe(true);
  });

  it("detects strength performance dropping in high-recent-cardio-volume weeks", () => {
    const sessions: TimelineSession[] = [];
    // Low cardio volume weeks -> strong lifts
    for (const day of [1, 8, 15, 22]) {
      sessions.push(strength(day, { strengthComponent: 700 }));
    }
    // High cardio volume in the 7 days before these lifts -> weaker lifts
    for (const day of [30, 37, 44, 51]) {
      sessions.push(cardio(day - 3, { loadScore: 200 }));
      sessions.push(cardio(day - 5, { loadScore: 200 }));
      sessions.push(strength(day, { strengthComponent: 600 }));
    }

    const report = computeInterferenceReport(sessions);
    expect(report.cardioToStrength.calibrating).toBe(false);
    expect(report.cardioToStrength.deltaPct).toBeLessThan(0);
    expect(report.cardioToStrength.summary).toMatch(/cost you/i);
  });
});

describe("INTERFERENCE_CONFIG", () => {
  it("matches the brief's named constants", () => {
    expect(INTERFERENCE_CONFIG.MIN_PAIRED_SESSIONS).toBe(3);
    expect(INTERFERENCE_CONFIG.LOOKBACK_DAYS_STRENGTH_EFFECT_ON_CARDIO).toBe(3);
    expect(INTERFERENCE_CONFIG.LOOKBACK_DAYS_CARDIO_EFFECT_ON_STRENGTH).toBe(7);
  });
});
