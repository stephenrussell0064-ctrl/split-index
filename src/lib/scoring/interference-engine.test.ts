/**
 * Automated correctness check for the Interference & Synergy Engine
 * (SPLITINDEX-NEXT-STAGE-REPORT.md Section B) — a statistics sanity test,
 * not a UI test: (1) never show a finding below MIN_PAIRED_SESSIONS, and
 * (2) recover a known, deliberately-injected effect from synthetic data
 * within a reasonable tolerance (same sign, same order of magnitude — not
 * an exact match, since this is a statistical estimate).
 */
import { describe, expect, it } from "vitest";
import { computeInterferenceReport, INTERFERENCE_CONFIG } from "./interference";
import type { TimelineSession } from "./timeline";

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `activity-${idCounter}`;
}

/** Speed(m/min) ÷ avg HR — the same Efficiency Factor formula as efficiencyFactor() in cardio-activity.ts, computed here from a literal pace/HR so the injected effect is a genuine physical scenario, not a hand-picked percentage. */
function efFromPaceAndHr(paceSecPerKm: number, avgHr: number): number {
  const speedMetersPerMin = 60000 / paceSecPerKm;
  return speedMetersPerMin / avgHr;
}

function cardio(dayOffset: number, overrides: Partial<TimelineSession> = {}): TimelineSession {
  return {
    activityId: nextId(),
    sport: "running",
    domain: "cardio",
    startedAt: new Date(Date.UTC(2026, 0, 1 + dayOffset, 8)).toISOString(),
    durationSeconds: 2400,
    sessionType: "easy",
    avgHeartRate: 150,
    avgPaceSecondsPerKm: 300,
    loadScore: 40,
    enduranceComponent: 500,
    strengthComponent: null,
    efficiencyFactor: efFromPaceAndHr(300, 150),
    ...overrides,
  };
}

function strength(dayOffset: number, overrides: Partial<TimelineSession> = {}): TimelineSession {
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

describe("Interference Engine — never renders below MIN_PAIRED_SESSIONS", () => {
  it("strength->cardio direction stays calibrating with 4 qualifying pairs (one below the gate of 5)", () => {
    const sessions: TimelineSession[] = [];
    for (let week = 0; week < 4; week++) {
      const day = week * 7;
      sessions.push(strength(day));
      sessions.push(cardio(day + 1, { efficiencyFactor: efFromPaceAndHr(308, 150) }));
      sessions.push(cardio(day + 4, { efficiencyFactor: efFromPaceAndHr(300, 150) }));
    }

    const report = computeInterferenceReport(sessions);
    expect(report.strengthToCardio.sampleCount).toBeLessThan(INTERFERENCE_CONFIG.MIN_PAIRED_SESSIONS);
    expect(report.strengthToCardio.calibrating).toBe(true);
    expect(report.strengthToCardio.decayByDay).toEqual([]);
  });

  it("cardio->strength direction stays calibrating with 4 gym sessions (one below the gate of 5)", () => {
    const sessions: TimelineSession[] = [];
    for (let week = 0; week < 4; week++) {
      sessions.push(strength(week * 7));
    }

    const report = computeInterferenceReport(sessions);
    expect(report.cardioToStrength.sampleCount).toBeLessThan(INTERFERENCE_CONFIG.MIN_PAIRED_SESSIONS);
    expect(report.cardioToStrength.calibrating).toBe(true);
    expect(report.cardioToStrength.deltaPct).toBeNull();
  });
});

describe("Interference Engine — recovers a known injected effect", () => {
  it("recovers a known pace slowdown (at matched HR) the day after a heavy strength session", () => {
    // The next-stage report's own example uses "8s/km slower" — but at a
    // 5:00/km baseline that's only a ~2.6% EF change, which the engine
    // correctly classifies as noise (< 3%, the same "measurable" floor
    // used elsewhere in this file's calibrating-gate tests). To actually
    // exercise recovery of a real, non-noise effect, this test injects a
    // larger, still-realistic slowdown (~33s/km, matching the ~10% EF drop
    // used in interference.test.ts's own precedent scenario).
    const BASELINE_PACE = 300; // 5:00/km
    const SLOWDOWN_PACE = 333; // ~33s/km slower, same HR — isolates the pace effect, ~10% EF drop
    const HR = 150;
    const baselineEF = efFromPaceAndHr(BASELINE_PACE, HR);
    const slowedEF = efFromPaceAndHr(SLOWDOWN_PACE, HR);
    const expectedEfDeltaPct = ((slowedEF - baselineEF) / baselineEF) * 100;

    const sessions: TimelineSession[] = [];
    for (let week = 0; week < 8; week++) {
      const day = week * 7;
      sessions.push(strength(day));
      // Day 1 after strength: the injected slowdown.
      sessions.push(
        cardio(day + 1, { avgPaceSecondsPerKm: SLOWDOWN_PACE, avgHeartRate: HR, efficiencyFactor: slowedEF })
      );
      // A rested-baseline session, 4+ days later (outside the decay window and 2+ rest days prior).
      sessions.push(
        cardio(day + 5, { avgPaceSecondsPerKm: BASELINE_PACE, avgHeartRate: HR, efficiencyFactor: baselineEF })
      );
    }

    const report = computeInterferenceReport(sessions);
    expect(report.strengthToCardio.calibrating).toBe(false);

    const dayOne = report.strengthToCardio.decayByDay.find((d) => d.daysSinceStrength === 1);
    expect(dayOne).toBeDefined();
    expect(dayOne!.efDeltaPct).not.toBeNull();

    // Same sign, same order of magnitude — a statistical estimate, not an exact match.
    expect(Math.sign(dayOne!.efDeltaPct!)).toBe(Math.sign(expectedEfDeltaPct));
    expect(Math.abs(dayOne!.efDeltaPct! - expectedEfDeltaPct)).toBeLessThan(1.5);
    expect(report.strengthToCardio.summary).toMatch(/cost you/i);
  });

  it("recovers a known strength-performance drop in high-recent-cardio-volume weeks", () => {
    const sessions: TimelineSession[] = [];
    // Low-cardio-volume weeks: strength stays strong.
    for (let i = 0; i < 4; i++) {
      sessions.push(strength(i * 14, { strengthComponent: 500 }));
    }
    // High-cardio-volume weeks (heavy cardio load in the trailing 7 days): strength drops.
    for (let i = 0; i < 4; i++) {
      const day = i * 14 + 7;
      sessions.push(cardio(day - 2, { loadScore: 300 }));
      sessions.push(cardio(day - 1, { loadScore: 300 }));
      sessions.push(strength(day, { strengthComponent: 400 }));
    }

    const report = computeInterferenceReport(sessions);
    expect(report.cardioToStrength.calibrating).toBe(false);
    expect(report.cardioToStrength.deltaPct).not.toBeNull();
    expect(report.cardioToStrength.deltaPct!).toBeLessThan(0);
    expect(report.cardioToStrength.summary).toMatch(/cost you/i);
  });
});
