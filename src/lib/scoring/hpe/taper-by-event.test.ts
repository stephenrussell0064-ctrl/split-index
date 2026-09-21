/**
 * The taper, by event.
 *
 * The engine tapered for one week whatever the athlete was training for,
 * which is right for a 5k and wrong for a marathon by a fortnight. Bosquet
 * 2007 and Wang 2023 put the best time-trial effect at 8-14 days of a 41-60%
 * progressive volume cut; Spilsbury 2015 timed elite British runners at 6
 * days for 3k-10k and 14 for the marathon; Smyth & Lawlor 2021 found strict
 * monotone 2-3 week tapers fastest across 158,117 Strava marathons.
 */

import { describe, expect, it } from "vitest";
import { buildMacrocycle, taperWeeksFor } from "./macrocycle";
import { DEFAULT_SAFETY_FLAGS, type AthleteState, type Goal } from "./intake";

function state(o: Partial<AthleteState> = {}): AthleteState {
  return {
    bodyweightKg: 78, heightCm: 178, age: 32, sex: "male",
    oneRms: {}, predicted5kS: 1350, predicted5kFromEffort: true,
    strengthTrainingAge: "intermediate", enduranceTrainingAge: "intermediate",
    strengthTrainingYears: 2, enduranceTrainingYears: 2,
    currentRunMinPerWeek: 300, currentStrengthSessionsPerWeek: 2,
    chronicLoad: 320, restingHr: 56, maxHr: 190,
    safety: { ...DEFAULT_SAFETY_FLAGS, injuryLast12Weeks: false, surgeryLast6Months: false },
    assumed: [], ...o,
  };
}
function goal(o: Partial<Goal> = {}): Goal {
  return {
    weeksOut: 16, horizonSource: "event_date", target5kS: null,
    enduranceEventKm: 42.195, enduranceEventKey: "marathon",
    targetSquatKg: null, targetBenchKg: null, targetDeadliftKg: null, targetTotalKg: null,
    priority: 0.3, sameDay: false, interEventGapH: 4, weightClassKg: null, eventOrderKnown: false, ...o,
  };
}

describe("taper length follows the event", () => {
  it("is one week for a 5k, two for a half, three for a marathon", () => {
    expect(taperWeeksFor(goal({ enduranceEventKey: "5k" }))).toBe(1);
    expect(taperWeeksFor(goal({ enduranceEventKey: "10k" }))).toBe(1);
    expect(taperWeeksFor(goal({ enduranceEventKey: "half" }))).toBe(2);
    expect(taperWeeksFor(goal({ enduranceEventKey: "marathon" }))).toBe(3);
  });

  it("is one week when there is no race to peak for", () => {
    expect(taperWeeksFor(goal({ horizonSource: "chosen_timeframe" }))).toBe(1);
    expect(taperWeeksFor(goal({ enduranceEventKey: null }))).toBe(1);
    expect(taperWeeksFor(goal({ enduranceEventKey: "powerlifting" }))).toBe(1);
  });

  it("never lets a short block spend most of itself tapering", () => {
    expect(taperWeeksFor(goal({ weeksOut: 6 }))).toBe(1);
    expect(taperWeeksFor(goal({ weeksOut: 8 }))).toBe(2);
  });

  it("cuts volume progressively and never steps back up inside the taper", () => {
    const macro = buildMacrocycle(state(), goal());
    const taper = macro.filter((w) => w.phase === "taper");
    expect(taper.length).toBe(3);
    for (let i = 1; i < taper.length; i++) {
      expect(taper[i].enduranceMin, `taper week ${i + 1} rose`).toBeLessThan(taper[i - 1].enduranceMin);
    }
    const peak = Math.max(...macro.filter((w) => w.phase !== "taper").map((w) => w.enduranceMin));
    // Race week lands inside the 41-60% cut the meta-analyses support.
    const raceWeek = taper[taper.length - 1].enduranceMin;
    expect(raceWeek / peak).toBeLessThanOrEqual(0.6);
    expect(raceWeek / peak).toBeGreaterThanOrEqual(0.35);
  });

  it("leaves the 5k block's shape alone", () => {
    const macro = buildMacrocycle(state(), goal({ enduranceEventKey: "5k", enduranceEventKm: 5 }));
    expect(macro.filter((w) => w.phase === "taper").length).toBe(1);
    expect(macro.length).toBe(16);
  });
});
