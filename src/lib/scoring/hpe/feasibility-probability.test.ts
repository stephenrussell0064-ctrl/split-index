/**
 * The probabilistic layer on the projection.
 *
 * The point estimate answers "does this clear the target". It has no room for
 * "probably not, but worth training for", which is the honest description of
 * most ambitious goals — and no room for the fact that two athletes of the
 * same training age on the same plan get visibly different results.
 */

import { describe, expect, it } from "vitest";
import {
  adherencePrior,
  feasibilityScreen,
  inferredStrengthTrainingAge,
  normalCdf,
} from "./feasibility";
import { DEFAULT_SAFETY_FLAGS, type AthleteState, type Goal } from "./intake";

function state(o: Partial<AthleteState> = {}): AthleteState {
  return {
    bodyweightKg: 80, heightCm: 180, age: 32, sex: "male",
    oneRms: { squat: 140, bench: 95, deadlift: 170 },
    predicted5kS: 1350, predicted5kFromEffort: true,
    strengthTrainingAge: "intermediate", enduranceTrainingAge: "intermediate",
    strengthTrainingYears: 2, enduranceTrainingYears: 2,
    currentRunMinPerWeek: 150, currentStrengthSessionsPerWeek: 3,
    chronicLoad: 320, restingHr: 55, maxHr: 190,
    safety: { ...DEFAULT_SAFETY_FLAGS, injuryLast12Weeks: false, surgeryLast6Months: false },
    assumed: [], ...o,
  };
}
function goal(o: Partial<Goal> = {}): Goal {
  return {
    weeksOut: 16, horizonSource: "event_date", target5kS: 1260,
    enduranceEventKm: 5, enduranceEventKey: "5k",
    targetSquatKg: null, targetBenchKg: null, targetDeadliftKg: null, targetTotalKg: 430,
    priority: 0.5, sameDay: false, interEventGapH: 4, weightClassKg: null, eventOrderKnown: false, ...o,
  };
}

describe("normalCdf", () => {
  it("is a distribution function", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.2816)).toBeCloseTo(0.9, 3);
    expect(normalCdf(-1.2816)).toBeCloseTo(0.1, 3);
    expect(normalCdf(4)).toBeGreaterThan(0.999);
  });
});

describe("every projection carries a spread and a probability", () => {
  const f = feasibilityScreen(state(), goal());

  it("brackets the expected outcome with an 80% interval", () => {
    expect(f.endurance.interval80[0]).toBeLessThan(f.endurance.expected);
    expect(f.endurance.interval80[1]).toBeGreaterThan(f.endurance.expected);
    expect(f.strength.interval80[0]).toBeLessThan(f.strength.expected);
    expect(f.strength.interval80[1]).toBeGreaterThan(f.strength.expected);
  });

  it("quotes a probability that includes the odds of finishing the block", () => {
    expect(f.endurance.probability).not.toBeNull();
    expect(f.strength.probability).not.toBeNull();
    expect(f.adherence).toBeGreaterThan(0.3);
    expect(f.adherence).toBeLessThanOrEqual(1);
    expect(f.jointProbability!).toBeLessThanOrEqual(Math.min(f.endurance.probability!, f.strength.probability!));
  });

  it("leaves the probability null when there is no target to hit", () => {
    const none = feasibilityScreen(state(), goal({ target5kS: null, targetTotalKg: null }));
    expect(none.endurance.probability).toBeNull();
    expect(none.strength.probability).toBeNull();
    expect(none.jointProbability).toBeNull();
  });
});

describe("how ambitious the target is decides how it is framed", () => {
  it("calls a far target a multi-block goal and gives a primary to train toward", () => {
    // 22:30 to 17:00 is not a 16-week proposition.
    const f = feasibilityScreen(state(), goal({ target5kS: 1020 }));
    expect(f.endurance.level).toBe("multi-block");
    expect(f.endurance.primaryGoal).toBeCloseTo(f.endurance.expected, 6);
    expect(f.endurance.zRequired!).toBeGreaterThan(2);
    expect(f.messages.join(" ")).toMatch(/multi-block goal/);
  });

  it("calls a target already inside current fitness within reach", () => {
    const f = feasibilityScreen(state(), goal({ target5kS: 1400 }));
    expect(f.endurance.level).toBe("within-reach");
    expect(f.endurance.primaryGoal).toBeNull();
  });

  it("orders the three levels by how far out the target is", () => {
    const near = feasibilityScreen(state(), goal({ target5kS: 1330 })).endurance.zRequired!;
    const far = feasibilityScreen(state(), goal({ target5kS: 1100 })).endurance.zRequired!;
    expect(far).toBeGreaterThan(near);
  });
});

describe("interference is applied where the evidence finds it", () => {
  it("costs a male lifter's lower body under real running load, and nothing at low volume", () => {
    const heavy = feasibilityScreen(state({ currentRunMinPerWeek: 250 }), goal());
    const light = feasibilityScreen(state({ currentRunMinPerWeek: 40 }), goal());
    expect(heavy.strengthGainPct).toBeLessThan(light.strengthGainPct);
  });

  it("costs a woman nothing, which is what Huiberts 2024 found", () => {
    const heavy = feasibilityScreen(state({ sex: "female", currentRunMinPerWeek: 250 }), goal());
    const light = feasibilityScreen(state({ sex: "female", currentRunMinPerWeek: 40 }), goal());
    expect(heavy.strengthGainPct).toBeCloseTo(light.strengthGainPct, 6);
  });
});

describe("training age is floored by what the athlete can actually do", () => {
  it("will not call a double-bodyweight squatter a novice", () => {
    expect(
      inferredStrengthTrainingAge("novice", { oneRms: { squat: 200, bench: 140, deadlift: 240 }, bodyweightKg: 85, sex: "male" })
    ).toBe("advanced");
  });

  it("leaves a genuine beginner alone, and never lowers a stated age", () => {
    expect(
      inferredStrengthTrainingAge("novice", { oneRms: { squat: 60, bench: 40, deadlift: 80 }, bodyweightKg: 80, sex: "male" })
    ).toBe("novice");
    expect(
      inferredStrengthTrainingAge("advanced", { oneRms: { squat: 60, bench: 40, deadlift: 80 }, bodyweightKg: 80, sex: "male" })
    ).toBe("advanced");
  });

  it("scales the threshold for women rather than holding them to a male standard", () => {
    const lifts = { squat: 110, bench: 65, deadlift: 135 };
    expect(inferredStrengthTrainingAge("novice", { oneRms: lifts, bodyweightKg: 65, sex: "female" })).not.toBe("novice");
  });
});

describe("age enters only where the evidence puts it", () => {
  it("does not penalise a 55-year-old, because trainability holds into the sixties", () => {
    const young = feasibilityScreen(state({ age: 30 }), goal());
    const masters = feasibilityScreen(state({ age: 55 }), goal());
    expect(masters.enduranceGainPct).toBeCloseTo(young.enduranceGainPct, 6);
    expect(masters.strengthGainPct).toBeCloseTo(young.strengthGainPct, 6);
  });

  it("eases gently past sixty rather than falling off a cliff", () => {
    const sixty = feasibilityScreen(state({ age: 60 }), goal());
    const seventy = feasibilityScreen(state({ age: 70 }), goal());
    expect(seventy.enduranceGainPct).toBeLessThan(sixty.enduranceGainPct);
    expect(seventy.enduranceGainPct).toBeGreaterThan(sixty.enduranceGainPct * 0.7);
  });
});

describe("the adherence prior", () => {
  it("is lower for a recent injury and for a novice runner with a race", () => {
    const base = adherencePrior(state(), goal(), "intermediate");
    const injured = adherencePrior(
      state({ safety: { ...DEFAULT_SAFETY_FLAGS, injuryLast12Weeks: true, surgeryLast6Months: false } }),
      goal(),
      "intermediate"
    );
    const novice = adherencePrior(state(), goal(), "novice");
    expect(injured).toBeLessThan(base);
    expect(novice).toBeLessThan(base);
  });
});
