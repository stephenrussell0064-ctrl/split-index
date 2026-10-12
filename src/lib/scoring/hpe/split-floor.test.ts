/**
 * A chosen split is a request for that many gym days.
 *
 * The phase table decided the strength session count and the split only
 * decided the labels, so push / pull / legs + upper / lower — five days by
 * name — came out as four sessions a week with the fifth rolling over. The
 * athlete who chose it reported, correctly, that the plan never completed it.
 */
import { describe, expect, it } from "vitest";
import { generatePlan } from "./engine";
import { diagnose } from "./diagnostics";
import { DEFAULT_SAFETY_FLAGS, type AthleteState, type Constraints, type Goal } from "./intake";
import { STRENGTH_SESSIONS_BY_PHASE, TRAINING_SPLITS } from "./constants";

const ALL_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function state(): AthleteState {
  return {
    bodyweightKg: 80, heightCm: 180, age: 30, sex: "male",
    oneRms: { squat: 150, bench: 120, deadlift: 190 }, predicted5kS: 1200, predicted5kFromEffort: true,
    strengthTrainingAge: "advanced", enduranceTrainingAge: "intermediate",
    strengthTrainingYears: 5, enduranceTrainingYears: 2,
    currentRunMinPerWeek: 120, currentStrengthSessionsPerWeek: 4,
    chronicLoad: 500, restingHr: 50, maxHr: 195,
    safety: { ...DEFAULT_SAFETY_FLAGS, injuryLast12Weeks: false, surgeryLast6Months: false },
    assumed: [],
  };
}

function goal(): Goal {
  return {
    weeksOut: 12, horizonSource: "chosen_timeframe", target5kS: null,
    enduranceEventKm: 10, enduranceEventKey: "10k",
    targetSquatKg: null, targetBenchKg: null, targetDeadliftKg: null, targetTotalKg: null,
    priority: 0.5, sameDay: false, interEventGapH: 4, weightClassKg: null, eventOrderKnown: false,
  };
}

function constraints(overrides: Partial<Constraints> = {}): Constraints {
  return {
    daysAvailable: ALL_DAYS,
    twoADaysPossible: true,
    dayWindows: [],
    availabilityVaries: false,
    amHour: 7,
    pmHour: 18,
    maxSessionsPerWeek: 10,
    maxHoursPerWeek: 12,
    maxSessionMin: 150,
    minRestDays: 1,
    trainingSplit: null,
    gymAccessDays: ALL_DAYS,
    equipment: ["barbell"],
    ...overrides,
  };
}

const profile = diagnose([], [], { squat: 150, bench: 120, deadlift: 190 }, {
  hrMax: 195, hrRest: 50, hrMaxSource: "measured", priority: 0.5,
});

function plan(c: Partial<Constraints>) {
  return generatePlan({ state: state(), goal: goal(), profile, constraints: constraints(c) });
}

function liftLabels(week: { sessions: { domain: string; label?: string }[] }): string[] {
  return week.sessions.filter((s) => s.domain === "strength").map((s) => s.label ?? "?");
}

describe("the split's day count is the strength floor", () => {
  it("push / pull / legs + upper / lower gives all five days in every developing week", () => {
    const p = plan({ trainingSplit: "ppl_ul" });
    expect(TRAINING_SPLITS.ppl_ul.days).toHaveLength(5);
    for (const w of p.weeks.filter((x) => x.phase !== "taper")) {
      const labels = liftLabels(w);
      expect(labels, `week ${w.week} (${w.phase})`).toHaveLength(5);
      expect(new Set(labels)).toEqual(new Set(["Push", "Pull", "Legs", "Upper", "Lower"]));
    }
  });

  it("is a request, not an override: the taper still comes down", () => {
    const p = plan({ trainingSplit: "ppl_ul" });
    const taper = p.weeks.find((w) => w.phase === "taper");
    expect(taper).toBeDefined();
    expect(liftLabels(taper!).length).toBeLessThan(5);
  });

  it("an athlete's own four-day structure gets four", () => {
    const p = plan({
      customSplitDays: [
        { label: "Chest", primaryLift: "bench", patterns: ["push"] },
        { label: "Back", primaryLift: "deadlift", patterns: ["pull"] },
        { label: "Legs", primaryLift: "squat", patterns: ["legs"] },
        { label: "Arms", primaryLift: null, patterns: ["push", "pull"] },
      ],
    });
    const base = p.weeks[0];
    expect(liftLabels(base)).toHaveLength(4);
  });

  it("no split chosen leaves the phase table in charge, exactly as before", () => {
    // A lift target without a split: developing, and the phase table decides.
    const p = generatePlan({
      state: state(),
      goal: { ...goal(), targetSquatKg: 180, targetBenchKg: 140, targetDeadliftKg: 220, targetTotalKg: 540 },
      profile,
      constraints: constraints({}),
    });
    const base = p.weeks[0];
    expect(liftLabels(base)).toHaveLength(STRENGTH_SESSIONS_BY_PHASE.base);
  });

  it("a custom split is intent to train, not a request for maintenance", () => {
    const p = plan({
      customSplitDays: [
        { label: "Chest", primaryLift: "bench", patterns: ["push"] },
        { label: "Back", primaryLift: "deadlift", patterns: ["pull"] },
        { label: "Legs", primaryLift: "squat", patterns: ["legs"] },
      ],
    });
    expect(p.mode?.strength).toBe("develop");
  });

  it("the athlete's own session cap still binds, and the plan names it", () => {
    const p = plan({ trainingSplit: "ppl_ul", maxSessionsPerWeek: 6 });
    const base = p.weeks[0];
    expect(liftLabels(base).length).toBeLessThan(5);
    expect(base.sessions.length).toBeLessThanOrEqual(6);
    expect(base.notes.join(" ")).toMatch(/split asks for 5 gym days/);
    expect(base.notes.join(" ")).toMatch(/6 sessions a week/);
  });

  it("endurance gives way before the split does, and never below its own minimum", () => {
    const p = plan({ trainingSplit: "ppl_ul", maxSessionsPerWeek: 7 });
    const base = p.weeks[0];
    expect(liftLabels(base)).toHaveLength(5);
    const runs = base.sessions.filter((s) => s.domain === "endurance");
    expect(runs.length).toBeGreaterThanOrEqual(2);
    expect(runs.length).toBeLessThanOrEqual(2);
  });
});
