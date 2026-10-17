/**
 * The Recovery score read 86 "primed" on the evening of a 20km race plus two
 * rowing sessions. Three things, each pinned here:
 *
 *  - a 25-day-old HRV reading was taken as today's and scored 97 at 30% weight;
 *  - the score had no same-day term — three sessions in one morning were one
 *    seventh of a week to the ACWR and a "3 sessions, 5 rest days" to density;
 *  - the rest term in readiness was a constant: one day since the last hard
 *    session, for everyone, always.
 */
import { describe, expect, it } from "vitest";
import { acuteComponentScore, computeRecoveryScore, type RecoveryScoreInput } from "./score";
import { hrvFromReadings, HRV_FRESH_HOURS } from "./data";
import { acuteWeight, computeAcuteLoad, computeReadiness, hoursSinceLastHard, isHardSession } from "@/lib/scoring/readiness";
import type { ReadinessResult } from "@/lib/scoring/readiness";
import type { TimelineSession } from "@/lib/scoring/timeline";

const HOUR = 3_600_000;
const DAY = 86_400_000;
const NOW = new Date("2026-10-17T20:00:00.000Z");

function session(hoursAgo: number, loadScore: number, extra: Partial<TimelineSession> = {}): TimelineSession {
  return {
    activityId: `s-${hoursAgo}-${loadScore}`,
    sport: "running",
    domain: "cardio",
    startedAt: new Date(NOW.getTime() - hoursAgo * HOUR).toISOString(),
    durationSeconds: 2400,
    sessionType: "easy",
    avgHeartRate: 150,
    avgPaceSecondsPerKm: null,
    loadScore,
    enduranceComponent: 600,
    strengthComponent: null,
    efficiencyFactor: null,
    ...extra,
  };
}

/** A quiet month: an easy run every third day, about 200 load a week. */
function quietMonth(): TimelineSession[] {
  return Array.from({ length: 9 }, (_, i) => session((3 + i * 3) * 24, 65));
}

function readiness(overrides: Partial<ReadinessResult> = {}): ReadinessResult {
  return {
    readiness: 75,
    acuteLoad: 0,
    typicalDailyLoad: 30,
    hoursSinceLastHardSession: null,
    overallAcwr: 1,
    gymAcwr: null,
    cardioAcwr: null,
    gymElevated: false,
    cardioElevated: false,
    reason: "Fully ready — recent training load is well within your norm.",
    ...overrides,
  };
}

function input(overrides: Partial<RecoveryScoreInput> = {}): RecoveryScoreInput {
  return {
    readiness: readiness(),
    recentSessionDates: [],
    drinks: [],
    bodyweightKg: 78,
    sex: "male",
    timeZone: "Europe/London",
    now: NOW,
    ...overrides,
  };
}

describe("a stale HRV reading is not today's", () => {
  it("drops a reading older than the freshness window and reports no HRV", () => {
    const out = hrvFromReadings(
      [
        { hrv_ms: 80, recorded_at: new Date(NOW.getTime() - 25 * DAY).toISOString() },
        { hrv_ms: 60, recorded_at: new Date(NOW.getTime() - 70 * DAY).toISOString() },
      ],
      NOW
    );
    expect(out.hrvToday).toBeNull();
    expect(out.hrvBaseline).toBeNull();
  });

  it("keeps a reading from this morning, and one from yesterday morning", () => {
    const fresh = hrvFromReadings(
      [
        { hrv_ms: 80, recorded_at: new Date(NOW.getTime() - 12 * HOUR).toISOString() },
        { hrv_ms: 60, recorded_at: new Date(NOW.getTime() - 36 * HOUR).toISOString() },
      ],
      NOW
    );
    expect(fresh.hrvToday).toBe(80);
    expect(fresh.hrvBaseline).toBe(60);
    const yesterday = hrvFromReadings(
      [{ hrv_ms: 80, recorded_at: new Date(NOW.getTime() - (HRV_FRESH_HOURS - 1) * HOUR).toISOString() }],
      NOW
    );
    expect(yesterday.hrvToday).toBe(80);
  });

  it("treats a row without a date as fresh, so callers that pass none keep the old behaviour", () => {
    expect(hrvFromReadings([{ hrv_ms: 70 }, { hrv_ms: 60 }]).hrvToday).toBe(70);
  });
});

describe("the acute term", () => {
  it("weights the last day fully and fades to nothing at two days", () => {
    expect(acuteWeight(1)).toBe(1);
    expect(acuteWeight(24)).toBe(1);
    expect(acuteWeight(36)).toBeCloseTo(0.5, 6);
    expect(acuteWeight(48)).toBe(0);
    expect(acuteWeight(100)).toBe(0);
  });

  it("sums what was done, decayed, and ignores the future", () => {
    const load = computeAcuteLoad([session(2, 250), session(3, 56), session(36, 100), session(-2, 500)], NOW.getTime());
    expect(load).toBeCloseTo(250 + 56 + 50, 6);
  });

  it("scores an ordinary day as near-full and a week in a day as empty", () => {
    expect(acuteComponentScore(0, 30)).toBe(100);
    expect(acuteComponentScore(30, 30)).toBe(82);
    expect(acuteComponentScore(90, 30)).toBe(42);
    expect(acuteComponentScore(320, 30)).toBe(0);
  });

  it("judges a returning athlete against a modest fixed day, not their own near-zero one", () => {
    // A 30-minute easy run after a month off is 60 load against a typical day
    // of 2 — read literally that is 30x, and "depleted". It is not.
    expect(acuteComponentScore(60, 2)).toBeGreaterThanOrEqual(55);
  });
});

describe("hard sessions and the rest term", () => {
  it("knows a hard session by load, by tag, or by a long lift", () => {
    expect(isHardSession(session(1, 65))).toBe(true);
    expect(isHardSession(session(1, 20))).toBe(false);
    expect(isHardSession(session(1, 20, { sessionType: "race" }))).toBe(true);
    expect(isHardSession(session(1, 5, { domain: "strength", sport: "gym", sessionType: null, durationSeconds: 3600 }))).toBe(true);
    expect(isHardSession(session(1, 5, { domain: "strength", sport: "gym", sessionType: null, durationSeconds: 1200 }))).toBe(false);
  });

  it("measures hours since the last hard session instead of assuming a day", () => {
    expect(hoursSinceLastHard([session(3, 250), session(30, 65)], NOW.getTime())).toBeCloseTo(3, 6);
    expect(hoursSinceLastHard([session(3, 10)], NOW.getTime())).toBeNull();
  });

  it("readiness is lower three hours after a race than it was the week before", () => {
    const before = computeReadiness(quietMonth(), NOW.getTime());
    const after = computeReadiness([session(3, 252, { sessionType: "race" }), ...quietMonth()], NOW.getTime());
    expect(after.readiness).toBeLessThan(before.readiness);
    expect(after.hoursSinceLastHardSession).toBeCloseTo(3, 1);
    expect(after.acuteLoad).toBeCloseTo(252, 1);
  });
});

describe("composing the score on a race day", () => {
  it("the reported evening: a 20km race and two rows after a quiet month is depleted, not primed", () => {
    const sessions = [
      session(8, 252, { sessionType: "race", durationSeconds: 5400 }),
      session(8.5, 56, { sport: "rowing", durationSeconds: 1800 }),
      session(8.4, 11, { sport: "rowing", durationSeconds: 210 }),
      ...quietMonth(),
    ];
    const r = computeReadiness(sessions, NOW.getTime());
    const result = computeRecoveryScore(
      input({ readiness: r, recentSessionDates: sessions.slice(0, 4).map((s) => s.startedAt) })
    );
    expect(result.band).toBe("depleted");
    expect(result.score).toBeLessThan(35);
    expect(result.limiter).toBe("acute");
    const acute = result.components.find((c) => c.key === "acute")!;
    expect(acute.present).toBe(true);
    expect(acute.detail).toMatch(/your usual day's load/);
  });

  it("gives the points back as the race recedes", () => {
    const race = session(8, 252, { sessionType: "race", durationSeconds: 5400 });
    const later = (days: number) => {
      const asOf = NOW.getTime() + days * DAY;
      const r = computeReadiness([race, ...quietMonth()], asOf);
      return computeRecoveryScore(input({ readiness: r, recentSessionDates: [race.startedAt], now: new Date(asOf) })).score;
    };
    expect(later(0)).toBeLessThan(later(1));
    expect(later(1)).toBeLessThan(later(3));
    expect(later(3)).toBeGreaterThanOrEqual(55);
  });

  it("sits the acute term out when nothing was done in the last two days", () => {
    const result = computeRecoveryScore(input({ readiness: readiness({ acuteLoad: 0 }) }));
    const acute = result.components.find((c) => c.key === "acute")!;
    expect(acute.present).toBe(false);
    expect(acute.weight).toBe(0);
    expect(result.score).toBe(75);
  });

  it("an ordinary training day barely moves it", () => {
    const result = computeRecoveryScore(input({ readiness: readiness({ readiness: 80, acuteLoad: 32, typicalDailyLoad: 30, hoursSinceLastHardSession: 10 }), recentSessionDates: [NOW.toISOString()] }));
    expect(result.score).toBeGreaterThanOrEqual(75);
  });
});
