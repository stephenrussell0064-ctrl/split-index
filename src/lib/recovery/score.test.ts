import { describe, expect, it } from "vitest";
import {
  bandFor,
  computeRecoveryScore,
  densityComponentScore,
  hrvComponentScore,
  type RecoveryScoreInput,
} from "./score";
import { UK_UNIT_GRAMS_ETHANOL, type DrinkEntry } from "./alcohol";
import type { ReadinessResult } from "@/lib/scoring/readiness";

const HOUR = 3_600_000;
const DAY = 86_400_000;
const NOW = new Date("2026-09-24T09:00:00.000Z");

function readiness(value: number): ReadinessResult {
  return {
    readiness: value,
    overallAcwr: 1.0,
    gymAcwr: 1.0,
    cardioAcwr: 1.0,
    gymElevated: false,
    cardioElevated: false,
    reason: "Fully ready — recent training load is well within your norm.",
  };
}

function sessions(count: number, spreadDays = 7): string[] {
  return Array.from({ length: count }, (_, i) =>
    new Date(NOW.getTime() - ((i % spreadDays) + 0.5) * DAY).toISOString()
  );
}

function drink(hoursAgo: number, unitCount: number): DrinkEntry {
  return {
    drankAt: new Date(NOW.getTime() - hoursAgo * HOUR),
    gramsEthanol: unitCount * UK_UNIT_GRAMS_ETHANOL,
  };
}

function input(overrides: Partial<RecoveryScoreInput> = {}): RecoveryScoreInput {
  return {
    readiness: readiness(75),
    recentSessionDates: sessions(4),
    drinks: [],
    bodyweightKg: 80,
    sex: "male",
    timeZone: "Europe/London",
    now: NOW,
    ...overrides,
  };
}

describe("the HRV component", () => {
  it("reads a suppression as a suppression", () => {
    expect(hrvComponentScore(80, 100)).toBeLessThan(30);
    expect(hrvComponentScore(90, 100)).toBeCloseTo(50, -1);
  });

  it("does not let one calm morning max the score out", () => {
    // Flat top: 20% above baseline is not twice as recovered as 10% above.
    expect(hrvComponentScore(150, 100)).toBe(100);
    expect(hrvComponentScore(120, 100)).toBe(100);
  });

  it("falls back to neutral rather than dividing by a zero baseline", () => {
    expect(hrvComponentScore(60, 0)).toBe(50);
  });
});

describe("the session-density component", () => {
  it("rewards a week with rest days in it", () => {
    const light = densityComponentScore(
      sessions(3).map((s) => new Date(s)),
      NOW
    );
    const heavy = densityComponentScore(
      sessions(9).map((s) => new Date(s)),
      NOW
    );
    expect(light.score).toBeGreaterThan(heavy.score);
  });

  it("charges for training every single day, regardless of how many sessions", () => {
    // ACWR goes quiet for someone whose norm IS a lot. Frequency does not.
    const everyDay = Array.from({ length: 7 }, (_, i) => new Date(NOW.getTime() - (i + 0.5) * DAY));
    const clustered = [
      new Date(NOW.getTime() - 0.5 * DAY),
      new Date(NOW.getTime() - 0.6 * DAY),
      new Date(NOW.getTime() - 1.5 * DAY),
      new Date(NOW.getTime() - 1.6 * DAY),
      new Date(NOW.getTime() - 2.5 * DAY),
      new Date(NOW.getTime() - 2.6 * DAY),
      new Date(NOW.getTime() - 3.5 * DAY),
    ];
    expect(densityComponentScore(everyDay, NOW).restDays).toBe(0);
    expect(densityComponentScore(clustered, NOW).restDays).toBeGreaterThan(0);
    expect(densityComponentScore(everyDay, NOW).score).toBeLessThan(
      densityComponentScore(clustered, NOW).score
    );
  });

  it("ignores sessions outside the 7-day window", () => {
    const old = [new Date(NOW.getTime() - 20 * DAY)];
    expect(densityComponentScore(old, NOW).sessionCount).toBe(0);
  });
});

describe("composing the recovery score", () => {
  it("does not punish an athlete for never having logged HRV", () => {
    // The trap in every composite: an absent input read as a bad one. Most
    // users will never own a strap.
    const without = computeRecoveryScore(input());
    const withGoodHrv = computeRecoveryScore(input({ hrvToday: 100, hrvBaseline: 100 }));
    expect(without.score).toBeGreaterThan(60);
    expect(Math.abs(without.score - withGoodHrv.score)).toBeLessThan(10);
  });

  it("marks absent components as absent rather than scoring them", () => {
    const result = computeRecoveryScore(input({ recentSessionDates: [] }));
    const hrv = result.components.find((c) => c.key === "hrv")!;
    const density = result.components.find((c) => c.key === "density")!;
    expect(hrv.present).toBe(false);
    expect(hrv.value).toBeNull();
    expect(hrv.weight).toBe(0);
    expect(density.present).toBe(false);
    expect(result.thin).toBe(true);
  });

  it("renormalises weights over the components that are present", () => {
    const result = computeRecoveryScore(input({ hrvToday: 100, hrvBaseline: 100 }));
    const total = result.components
      .filter((c) => c.present && c.key !== "alcohol")
      .reduce((sum, c) => sum + c.weight, 0);
    expect(total).toBeCloseTo(1, 6);
  });

  it("with only training load available, returns the readiness score itself", () => {
    const result = computeRecoveryScore(input({ recentSessionDates: [], readiness: readiness(62) }));
    expect(result.score).toBe(62);
  });

  it("takes points off for last night's drinking", () => {
    const sober = computeRecoveryScore(input());
    const hungover = computeRecoveryScore(input({ drinks: [drink(11, 8)] }));
    expect(hungover.score).toBeLessThan(sober.score - 15);
    expect(hungover.alcohol.penalty).toBeGreaterThan(15);
  });

  it("names alcohol as the limiter when alcohol is the limiter", () => {
    const result = computeRecoveryScore(input({ readiness: readiness(92), drinks: [drink(10, 9)] }));
    expect(result.limiter).toBe("alcohol");
    expect(result.headline).toContain("units");
  });

  it("names training load when load is the limiter", () => {
    const result = computeRecoveryScore(
      input({
        readiness: {
          ...readiness(34),
          reason: "Lower today — recent strength training is the main driver.",
        },
      })
    );
    expect(result.limiter).toBe("load");
    expect(result.headline).toContain("strength training");
  });

  it("ranks the limiter by points off the score, not by which number looks worst", () => {
    /*
     * Density sits lower in isolation (a packed week) but carries 20% of the
     * score; load sits higher and carries 50%. Load is the bigger cost and is
     * the one to name. Ranking on the raw value would name density.
     */
    const result = computeRecoveryScore(
      input({ readiness: readiness(55), recentSessionDates: sessions(9) })
    );
    const load = result.components.find((c) => c.key === "load")!;
    const density = result.components.find((c) => c.key === "density")!;
    expect(density.value!).toBeLessThan(load.value!);
    expect(result.limiter).toBe("load");
  });

  it("names no limiter when nothing is costing anything worth naming", () => {
    const result = computeRecoveryScore(
      input({ readiness: readiness(99), recentSessionDates: sessions(1) })
    );
    expect(result.limiter).toBeNull();
  });

  it("says nothing is holding you back when nothing is", () => {
    const result = computeRecoveryScore(
      input({ readiness: readiness(95), hrvToday: 110, hrvBaseline: 100, recentSessionDates: sessions(2) })
    );
    expect(result.limiter === null || result.score >= 85).toBe(true);
    expect(result.headline).toContain("Nothing is holding you back");
  });

  it("never leaves the 0-100 range, however bad the inputs", () => {
    const wrecked = computeRecoveryScore(
      input({
        readiness: readiness(5),
        hrvToday: 40,
        hrvBaseline: 100,
        recentSessionDates: sessions(14),
        drinks: Array.from({ length: 12 }, (_, i) => drink(9 + i * 0.2, 3)),
      })
    );
    expect(wrecked.score).toBeGreaterThanOrEqual(0);
    expect(wrecked.score).toBeLessThanOrEqual(100);
    expect(wrecked.band).toBe("depleted");
  });

  it("cannot be inflated by abstaining", () => {
    // Alcohol is a deduction, never a bonus — otherwise the score becomes a
    // compliance meter that rewards logging nothing at all.
    const noDrinks = computeRecoveryScore(input());
    const alcoholComponent = noDrinks.components.find((c) => c.key === "alcohol")!;
    expect(alcoholComponent.value).toBe(0);
    expect(noDrinks.score).toBeLessThanOrEqual(100);
  });
});

describe("bands", () => {
  it("maps the score onto four states", () => {
    expect(bandFor(90)).toBe("primed");
    expect(bandFor(60)).toBe("steady");
    expect(bandFor(40)).toBe("compromised");
    expect(bandFor(10)).toBe("depleted");
  });
});
