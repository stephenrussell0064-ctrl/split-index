import { describe, expect, it } from "vitest";
import { buildFullHybridReport, type FullReportInputs } from "./hybrid-report-full";
import type { AnalyticsActivity } from "@/components/analytics/types";

const NOW = new Date(Date.UTC(2026, 8, 24, 12));
const DAY_MS = 86_400_000;

function daysAgo(n: number, hour = 8): string {
  return new Date(NOW.getTime() - n * DAY_MS + (hour - 12) * 3_600_000).toISOString();
}

let id = 0;
function activity(daysBack: number, sport: AnalyticsActivity["sport"], minutes: number, km: number | null = null): AnalyticsActivity {
  id += 1;
  return {
    id: `a${id}`,
    sport,
    started_at: daysAgo(daysBack),
    duration_seconds: minutes * 60,
    distance_meters: km === null ? null : km * 1000,
    avg_heart_rate: null,
    max_heart_rate: null,
    session_type: "easy",
    rpe: null,
  };
}

function inputs(overrides: Partial<FullReportInputs> = {}): FullReportInputs {
  return {
    now: NOW,
    periodDays: 30,
    indexHistory: [],
    activities: [],
    scores: [],
    sessions: [],
    readiness: null,
    recovery: null,
    hrvToday: null,
    hrvBaseline: null,
    predictedBenchmarks: [],
    strengthEstimates: [],
    overallDotsGl: null,
    showDotsGl: true,
    raceRecords: [],
    personalRecords: [],
    article9Consent: false,
    targetSessionsPerWeek: 4,
    streak: 0,
    ...overrides,
  };
}

describe("buildFullHybridReport", () => {
  it("is empty but well-formed with no data at all", () => {
    const r = buildFullHybridReport(inputs());
    expect(r.headline.split.now).toBeNull();
    expect(r.headline.tier).toBeNull();
    expect(r.balance.sessions).toBe(0);
    expect(r.balance.strengthShare).toBeNull();
    expect(r.consistency.weeksHit).toBe(0);
    expect(r.strength.lifts).toEqual([]);
    expect(r.interference.strengthToCardio.verdict).toBe("learning");
    expect(r.notes).toEqual([]);
  });

  it("reads the period's score change from the last point before the period", () => {
    const r = buildFullHybridReport(
      inputs({
        indexHistory: [
          { split_index: 600, endurance_index: 550, strength_index: 650, recorded_at: daysAgo(45) },
          { split_index: 620, endurance_index: 560, strength_index: 680, recorded_at: daysAgo(20) },
          { split_index: 640, endurance_index: 570, strength_index: 710, recorded_at: daysAgo(2) },
        ],
      })
    );
    expect(r.headline.split).toEqual({ now: 640, start: 600, delta: 40 });
    expect(r.headline.strength.delta).toBe(60);
    expect(r.headline.bestEver?.value).toBe(640);
    expect(r.headline.atBestNow).toBe(true);
    // strength 710 vs endurance 570: endurance is the weaker side
    expect(r.headline.weakerSide).toBe("endurance");
    expect(r.notes[0]).toMatch(/Split Index is up 4\.0 to 64/);
  });

  it("falls back to the first in-period point when nothing precedes the period", () => {
    const r = buildFullHybridReport(
      inputs({
        indexHistory: [
          { split_index: 500, endurance_index: 500, strength_index: 500, recorded_at: daysAgo(10) },
          { split_index: 530, endurance_index: 500, strength_index: 500, recorded_at: daysAgo(1) },
        ],
      })
    );
    expect(r.headline.split.start).toBe(500);
    expect(r.headline.split.delta).toBe(30);
  });

  it("splits the period's training time between strength and endurance, and only counts the period", () => {
    const r = buildFullHybridReport(
      inputs({
        activities: [
          activity(40, "gym", 60), // outside the period
          activity(20, "gym", 60),
          activity(18, "running", 30, 5),
          activity(10, "gym", 60),
          activity(3, "rowing", 20, 4),
        ],
        scores: [
          { activity_id: "a2", sport: "gym", sport_index: 600, load_score: 50, created_at: daysAgo(20) },
          { activity_id: "a3", sport: "running", sport_index: 500, load_score: 30, created_at: daysAgo(18) },
        ],
      })
    );
    expect(r.balance.sessions).toBe(4);
    expect(r.balance.strengthSessions).toBe(2);
    expect(r.balance.cardioSessions).toBe(2);
    expect(r.balance.strengthMinutes).toBe(120);
    expect(r.balance.cardioMinutes).toBe(50);
    expect(r.balance.strengthShare).toBeCloseTo(0.71, 2);
    expect(r.balance.distanceKm).toBe(9);
    expect(r.balance.strengthLoad).toBe(50);
    expect(r.balance.cardioLoad).toBe(30);
    const gym = r.balance.bySport.find((s) => s.sport === "gym");
    expect(gym?.sessions).toBe(2);
    expect(gym?.avgIndex).toBe(600);
    expect(r.notes).toContainEqual(expect.stringMatching(/Strength took 71% of your training time/));
  });

  it("counts weeks that hit the target, and the longest gap between sessions", () => {
    const r = buildFullHybridReport(
      inputs({
        activities: [
          // Week 1 (days 0-6): four sessions — hit.
          activity(1, "gym", 60),
          activity(2, "running", 30),
          activity(4, "gym", 60),
          activity(6, "running", 30),
          // Week 2 (days 7-13): two — miss.
          activity(8, "gym", 60),
          activity(12, "running", 30),
          // Weeks 3 and 4: nothing until day 27.
          activity(27, "gym", 60),
        ],
      })
    );
    expect(r.consistency.weeksCounted).toBe(4);
    expect(r.consistency.weekly).toEqual([1, 0, 2, 4]);
    expect(r.consistency.weeksHit).toBe(1);
    expect(r.consistency.sessionsPerWeek).toBeCloseTo(1.6, 1);
    // day 27 → day 12 is a 14-day gap
    expect(r.consistency.longestGapDays).toBe(14);
    expect(r.notes).toContainEqual(expect.stringMatching(/hit 4 sessions in 1 of the last 4 weeks/));
    expect(r.notes).toContainEqual(expect.stringMatching(/longest break was 14 days/));
  });

  it("orders lifts heaviest first and counts trends", () => {
    const est = (name: string, kg: number, trend: "up" | "down" | "flat") => ({
      exerciseName: name,
      estimated1RmKg: kg,
      allTime1RmKg: kg,
      current1RmKg: kg,
      trend,
      recordedAt: daysAgo(1),
    });
    const r = buildFullHybridReport(
      inputs({
        strengthEstimates: [est("Bench", 100, "up"), est("Deadlift", 180, "down"), est("Squat", 140, "up")],
        overallDotsGl: { bestSbdKg: { squat: 140, bench: 100, deadlift: 180 }, sbdTotalKg: 420, liftsLogged: 3, dotsScore: 310.2, glPoints: 72.1 },
        showDotsGl: false,
      })
    );
    expect(r.strength.lifts.map((l) => l.exerciseName)).toEqual(["Deadlift", "Squat", "Bench"]);
    expect(r.strength.rising).toBe(2);
    expect(r.strength.falling).toBe(1);
    expect(r.strength.total).toBe(420);
    // DOTS/GL is paid: the numbers are withheld, the lifts are not.
    expect(r.strength.dots).toBeNull();
    expect(r.strength.dotsLocked).toBe(true);
    expect(r.notes).toContainEqual("2 lifts are trending up and 1 trending down.");
  });

  it("builds the run ladder only once the 5K prediction is out of calibration", () => {
    const calibrating = buildFullHybridReport(
      inputs({ predictedBenchmarks: [{ sport: "run", benchmarkSeconds: 1200, sampleCount: 2, updatedAt: "" }] })
    );
    expect(calibrating.endurance.benchmarks[0].calibrating).toBe(true);
    expect(calibrating.endurance.runLadder).toEqual([]);

    const ready = buildFullHybridReport(
      inputs({ predictedBenchmarks: [{ sport: "run", benchmarkSeconds: 1200, sampleCount: 8, updatedAt: "", riegelK: 1.06 }] })
    );
    expect(ready.endurance.benchmarks[0].seconds).toBe(1200);
    expect(ready.endurance.runLadder.map((r) => r.label)).toContain("5K");
    expect(ready.endurance.runLadder.length).toBeGreaterThan(2);
    expect(ready.notes).toContainEqual("Your predicted 5K is 20:00 from 8 runs of evidence.");
  });

  it("withholds the injury zone without Article 9 consent, and never invents one without sessions", () => {
    const readiness = { readiness: 62, overallAcwr: 1.45, gymAcwr: null, cardioAcwr: null, gymElevated: false, cardioElevated: true, reason: "" };
    const noConsent = buildFullHybridReport(inputs({ readiness, article9Consent: false, sessions: [] }));
    expect(noConsent.recovery.acwr).toBe(1.45);
    expect(noConsent.recovery.injury).toBeNull();
    expect(noConsent.recovery.injuryHidden).toBe(true);
  });

  it("keeps only the records set inside the period, newest first", () => {
    const rec = (n: number, back: number) => ({
      id: `r${n}`,
      user_id: "u",
      sport: "running" as const,
      metric: "fastest_5k",
      value: 1200,
      unit: "seconds",
      activity_id: null,
      achieved_at: daysAgo(back),
    });
    const r = buildFullHybridReport(inputs({ personalRecords: [rec(1, 40), rec(2, 5), rec(3, 12)] }));
    expect(r.recordsThisPeriod.map((x) => x.id)).toEqual(["r2", "r3"]);
  });

  it("caps the notes at six", () => {
    const r = buildFullHybridReport(
      inputs({
        indexHistory: [
          { split_index: 600, endurance_index: 550, strength_index: 650, recorded_at: daysAgo(45) },
          { split_index: 640, endurance_index: 570, strength_index: 710, recorded_at: daysAgo(2) },
        ],
        activities: Array.from({ length: 12 }, (_, i) => activity(i * 2 + 1, i % 3 === 0 ? "running" : "gym", 45)),
        strengthEstimates: [
          { exerciseName: "Bench", estimated1RmKg: 100, allTime1RmKg: 100, current1RmKg: 100, trend: "up", recordedAt: "" },
        ],
        predictedBenchmarks: [{ sport: "run", benchmarkSeconds: 1200, sampleCount: 8, updatedAt: "" }],
        recovery: {
          score: 40,
          band: "compromised",
          headline: "Training load is the main thing holding this down",
          components: [],
          limiter: "load",
          alcohol: { hoursSinceLastDrink: null } as never,
          thin: false,
        },
      })
    );
    expect(r.notes.length).toBeLessThanOrEqual(6);
    expect(r.notes.length).toBeGreaterThanOrEqual(5);
  });
});
