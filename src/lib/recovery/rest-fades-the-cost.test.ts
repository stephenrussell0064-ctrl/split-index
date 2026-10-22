/**
 * Owner, 22 Oct 2026: "i havent trained in four days but my recovery score is
 * showing as 30 why. this is way too low for that."
 *
 * The load terms summed a flat 7-day box, so six sessions packed into two days
 * a week earlier stood at full height until they fell off a cliff on day
 * eight; density counted them the same way. Both now fade with rest. These
 * pin the owner's week and the properties the fix rests on.
 */
import { describe, expect, it } from "vitest";
import { computeRecoveryScore, densityComponentScore } from "./score";
import {
  acwrAcuteLoad,
  computeReadiness,
  fatigueLoad,
  recencyWeight,
} from "@/lib/scoring/readiness";
import type { TimelineSession } from "@/lib/scoring/timeline";

const DAY = 86_400_000;
const NOW = new Date("2026-10-22T09:00:00.000Z");

function session(daysAgo: number, loadScore: number, extra: Partial<TimelineSession> = {}): TimelineSession {
  return {
    activityId: `s-${daysAgo}-${loadScore}-${Math.random()}`,
    sport: "running",
    domain: "cardio",
    startedAt: new Date(NOW.getTime() - daysAgo * DAY).toISOString(),
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

/** An ordinary month before the big weekend: a session every other day at about 60 load. */
function ordinaryMonth(fromDaysAgo: number): TimelineSession[] {
  return Array.from({ length: 10 }, (_, i) => session(fromDaysAgo + i * 2, 60));
}

/** The owner's week: six sessions on two days, five to six days ago, then nothing. */
function ownersWeek(): TimelineSession[] {
  return [
    session(5.2, 120, { sessionType: "race" }),
    session(5.3, 60),
    session(5.35, 20),
    session(6.1, 110, { domain: "strength", sport: "gym", sessionType: null, durationSeconds: 3600 }),
    session(6.2, 50),
    session(6.3, 40),
    ...ordinaryMonth(8),
  ];
}

function recovery(sessions: TimelineSession[], now: Date = NOW) {
  const readiness = computeReadiness(sessions, now.getTime());
  const cutoff = now.getTime() - 7 * DAY;
  return computeRecoveryScore({
    readiness,
    recentSessionDates: sessions.map((s) => s.startedAt).filter((d) => new Date(d).getTime() >= cutoff),
    drinks: [],
    bodyweightKg: 78,
    sex: "male",
    timeZone: "Europe/London",
    now,
  });
}

describe("recency weights", () => {
  it("count today in full, decay with the time constant, and ignore the future", () => {
    expect(recencyWeight(0, 0, 2)).toBe(1);
    expect(recencyWeight(2, 0, 2)).toBeCloseTo(Math.exp(-1), 6);
    expect(recencyWeight(0.5, 1, 6)).toBe(1);
    expect(recencyWeight(7, 1, 6)).toBeCloseTo(Math.exp(-1), 6);
    expect(recencyWeight(-1, 0, 2)).toBe(0);
  });

  it("the ACWR weighting integrates to a week, so an even week still reads as ~1", () => {
    // 60 load every other day, for 28 days: the box ACWR is 1.0 by construction.
    const even = Array.from({ length: 14 }, (_, i) => session(i * 2 + 0.5, 60));
    const r = computeReadiness(even, NOW.getTime());
    expect(r.overallAcwr).toBeGreaterThan(0.85);
    expect(r.overallAcwr).toBeLessThan(1.2);
    // Half a day after a hard session the rest term is near zero, so this
    // sits just under "fully ready" — as it did on the box (62).
    expect(r.readiness).toBeGreaterThanOrEqual(60);
  });

  it("fatigue load keeps a session today in full and forgets one a week old", () => {
    expect(fatigueLoad([session(0, 100)], NOW.getTime())).toBeCloseTo(100, 6);
    expect(fatigueLoad([session(4, 100)], NOW.getTime())).toBeLessThan(15);
    expect(fatigueLoad([session(7, 100)], NOW.getTime())).toBeLessThan(4);
    expect(acwrAcuteLoad([session(0.5, 100)], NOW.getTime())).toBeCloseTo(100, 6);
  });
});

describe("the owner's four days off", () => {
  it("reads primed, not compromised", () => {
    const result = recovery(ownersWeek());
    expect(result.score).toBeGreaterThanOrEqual(75);
    expect(result.band).toBe("primed");
  });

  it("climbs day by day instead of waiting for the week to fall off a cliff", () => {
    const at = (daysLater: number) => recovery(ownersWeek(), new Date(NOW.getTime() + daysLater * DAY)).score;
    // Read from the morning after the block.
    const morningAfter = recovery(ownersWeek(), new Date(NOW.getTime() - 4.5 * DAY)).score;
    expect(morningAfter).toBeLessThan(at(-3));
    expect(at(-3)).toBeLessThanOrEqual(at(-2));
    expect(at(-2)).toBeLessThanOrEqual(at(-1));
    expect(at(-1)).toBeLessThanOrEqual(at(0));
    // Day eight, when the box used to empty all at once, is no jump.
    expect(at(3) - at(2)).toBeLessThan(12);
  });

  it("still charges for the block on the day it happened", () => {
    const sameEvening = recovery(ownersWeek(), new Date(NOW.getTime() - 5 * DAY));
    expect(sameEvening.score).toBeLessThan(55);
  });
});

describe("session density fades with rest", () => {
  const packed = [5.2, 5.3, 5.35, 6.1, 6.2, 6.3].map((d) => new Date(NOW.getTime() - d * DAY));

  it("six sessions a week ago cost a quarter of what six sessions yesterday cost", () => {
    const old = densityComponentScore(packed, NOW);
    const fresh = densityComponentScore(packed.map((d) => new Date(d.getTime() + 4.7 * DAY)), NOW);
    expect(fresh.score).toBe(66);
    expect(old.score).toBeGreaterThanOrEqual(88);
    expect(old.daysSinceLast).toBeCloseTo(5.2, 1);
  });

  it("leaves a session yesterday at full cost — consecutive days are what the term is for", () => {
    const yesterday = densityComponentScore(
      [0.9, 1.9, 2.9, 3.9, 4.9, 5.9].map((d) => new Date(NOW.getTime() - d * DAY)),
      NOW
    );
    expect(yesterday.score).toBe(66);
  });

  it("says so in the breakdown", () => {
    const result = recovery(ownersWeek());
    const density = result.components.find((c) => c.key === "density")!;
    expect(density.detail).toMatch(/Nothing for 5 days/);
  });
});
