import { describe, expect, it } from "vitest";
import {
  scoreStrength,
  type LoggedSet,
  type ScoreStrengthInput,
} from "./split-strength-engine";

/**
 * The all-time / current 1RM split (see the split-strength-engine.ts header).
 * These lock in the two properties the split exists for and which a single
 * blended number cannot have at the same time:
 *   - a worse session lowers `currentOneRM` and cannot touch `allTimeOneRM`
 *   - a new best raises both
 */

const DAY_MS = 86_400_000;
const NOW = Date.now();
const daysAgo = (days: number) => new Date(NOW - days * DAY_MS).toISOString();

function bench(
  history: LoggedSet[],
  latestSet: { weightKg: number; reps: number },
  performedAt: string,
  overrides: Partial<ScoreStrengthInput> = {}
) {
  return scoreStrength({
    liftKey: "Bench Press",
    history,
    latestSet,
    latestSetPerformedAt: performedAt,
    bodyweightKg: 83,
    sex: "male",
    age: 30,
    isPremium: true,
    ...overrides,
  });
}

describe("all-time vs current 1RM", () => {
  it("a worse session lowers the current 1RM and leaves the all-time value untouched", () => {
    const earlier: LoggedSet[] = [{ weightKg: 100, reps: 5, performedAt: daysAgo(28) }];
    const best = { weightKg: 110, reps: 5 };

    const throughBestSession = bench(earlier, best, daysAgo(14));
    const afterBadSession = bench(
      [...earlier, { ...best, performedAt: daysAgo(14) }],
      { weightKg: 90, reps: 5 },
      daysAgo(0)
    );

    expect(afterBadSession.currentOneRM!).toBeLessThan(throughBestSession.currentOneRM!);
    expect(afterBadSession.allTimeOneRM!).toBeCloseTo(throughBestSession.allTimeOneRM!, 1);
  });

  it("a new best raises both", () => {
    const earlier: LoggedSet[] = [{ weightKg: 100, reps: 5, performedAt: daysAgo(28) }];
    const previousBest = { weightKg: 110, reps: 5 };

    const beforePR = bench(earlier, previousBest, daysAgo(14));
    const afterPR = bench(
      [...earlier, { ...previousBest, performedAt: daysAgo(14) }],
      { weightKg: 130, reps: 3 },
      daysAgo(0)
    );

    expect(afterPR.allTimeOneRM!).toBeGreaterThan(beforePR.allTimeOneRM!);
    expect(afterPR.currentOneRM!).toBeGreaterThan(beforePR.currentOneRM!);
  });

  it("keeps an old PR as the all-time value through a detrained block, while current falls well below it", () => {
    const history: LoggedSet[] = [
      { weightKg: 140, reps: 3, performedAt: daysAgo(300) },
      { weightKg: 100, reps: 5, performedAt: daysAgo(30) },
      { weightKg: 100, reps: 5, performedAt: daysAgo(14) },
    ];
    const result = bench(history, { weightKg: 100, reps: 5 }, daysAgo(0));

    // 140x3 is still the best ever hit, so it still is the all-time number.
    // 154 -> 148.9 with the estimator correction: 140 x Strength Level's own
    // 3-rep multiplier (100/94 = 1.0638) rather than Epley's 1.10. The
    // threshold moves with it — what this test is actually about is that the
    // 300-day-old PR survives a detrained block, not the exact figure.
    expect(result.allTimeOneRM!).toBeGreaterThan(145);
    expect(result.allTimeOneRM!).toBeCloseTo(140 * (100 / 94), 1);
    expect(result.currentOneRM!).toBeLessThan(result.allTimeOneRM! * 0.85);
  });

  it("never reports a current 1RM above the all-time 1RM", () => {
    const histories: LoggedSet[][] = [
      [],
      [{ weightKg: 120, reps: 2, performedAt: daysAgo(1) }],
      [
        { weightKg: 60, reps: 12, performedAt: daysAgo(200) },
        { weightKg: 140, reps: 1, performedAt: daysAgo(100) },
        { weightKg: 95, reps: 8, performedAt: daysAgo(3) },
      ],
    ];
    for (const history of histories) {
      const result = bench(history, { weightKg: 100, reps: 5 }, daysAgo(0));
      expect(result.currentOneRM!).toBeLessThanOrEqual(result.allTimeOneRM! + 1e-6);
    }
  });

  it("reads a session by its best set, so warm-ups and back-offs cannot fake a decline", () => {
    const topSetOnly: LoggedSet[] = [{ weightKg: 110, reps: 5, performedAt: daysAgo(7) }];
    const wholeSession: LoggedSet[] = [
      { weightKg: 60, reps: 10, performedAt: daysAgo(7) },
      { weightKg: 110, reps: 5, performedAt: daysAgo(7) },
      { weightKg: 85, reps: 8, performedAt: daysAgo(7) },
    ];

    const lean = bench(topSetOnly, { weightKg: 100, reps: 5 }, daysAgo(0));
    const full = bench(wholeSession, { weightKg: 100, reps: 5 }, daysAgo(0));

    expect(full.currentOneRM!).toBeCloseTo(lean.currentOneRM!, 1);
    expect(full.allTimeOneRM!).toBeCloseTo(lean.allTimeOneRM!, 1);
  });

  it("weights recent sessions far more heavily than old ones", () => {
    const recentGain: LoggedSet[] = [{ weightKg: 100, reps: 5, performedAt: daysAgo(120) }];
    const oldGain: LoggedSet[] = [{ weightKg: 130, reps: 5, performedAt: daysAgo(120) }];

    const afterRecentGain = bench(recentGain, { weightKg: 130, reps: 5 }, daysAgo(0));
    const afterOldGain = bench(oldGain, { weightKg: 100, reps: 5 }, daysAgo(0));

    // Same two sessions, opposite order in time. The one whose heavy session
    // is the recent one must read as the stronger athlete right now, even
    // though both have identical all-time bests.
    expect(afterRecentGain.allTimeOneRM!).toBeCloseTo(afterOldGain.allTimeOneRM!, 1);
    expect(afterRecentGain.currentOneRM!).toBeGreaterThan(afterOldGain.currentOneRM! * 1.1);
  });

  it("still reports both values for a free-tier athlete and for a first-ever session", () => {
    const free = bench([{ weightKg: 100, reps: 5, performedAt: daysAgo(10) }], { weightKg: 90, reps: 5 }, daysAgo(0), {
      isPremium: false,
    });
    expect(free.currentOneRM!).toBeLessThan(free.allTimeOneRM!);

    const firstEver = bench([], { weightKg: 100, reps: 5 }, daysAgo(0));
    expect(firstEver.currentOneRM!).toBeGreaterThan(0);
    expect(firstEver.currentOneRM!).toBeCloseTo(firstEver.allTimeOneRM!, 1);
  });

  it("dates the scored set by the session it belongs to, not by when the score was computed", () => {
    const history: LoggedSet[] = [{ weightKg: 140, reps: 5, performedAt: daysAgo(2) }];

    // The same weak set, once as today's session and once as a re-score of a
    // year-old one. Only the first is evidence about present fitness.
    const asToday = bench(history, { weightKg: 80, reps: 5 }, daysAgo(0));
    const asOldSession = bench(history, { weightKg: 80, reps: 5 }, daysAgo(365));

    expect(asToday.currentOneRM!).toBeLessThan(asOldSession.currentOneRM!);
  });

  it("leaves the scoring 1RM between the two, so one bad day neither owns nor collapses the index", () => {
    const history: LoggedSet[] = [
      { weightKg: 130, reps: 5, performedAt: daysAgo(60) },
      { weightKg: 125, reps: 5, performedAt: daysAgo(30) },
    ];
    const result = bench(history, { weightKg: 80, reps: 5 }, daysAgo(0));

    expect(result.oneRM).toBeGreaterThan(result.currentOneRM!);
    expect(result.oneRM).toBeLessThanOrEqual(result.allTimeOneRM! + 1e-6);
  });

  it("reads the trend off the history in date order, whatever order the rows arrive in", () => {
    const improving: LoggedSet[] = [
      { weightKg: 90, reps: 5, performedAt: daysAgo(40) },
      { weightKg: 100, reps: 5, performedAt: daysAgo(30) },
      { weightKg: 110, reps: 5, performedAt: daysAgo(20) },
      { weightKg: 120, reps: 5, performedAt: daysAgo(10) },
    ];
    const shuffled = [improving[2], improving[0], improving[3], improving[1]];

    expect(bench(improving, { weightKg: 120, reps: 5 }, daysAgo(0)).trend).toBe("up");
    expect(bench(shuffled, { weightKg: 120, reps: 5 }, daysAgo(0)).trend).toBe("up");
  });
});
