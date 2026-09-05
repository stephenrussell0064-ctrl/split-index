import { describe, expect, it } from "vitest";
import { strengthComparisonBasis, feasibilityScreen } from "./feasibility";
import type { AthleteState, Goal } from "./intake";

/**
 * What a strength target is measured against.
 *
 * Found by rebuilding a real athlete's block and reading the feasibility line
 * it produced: "Total: 335kg is ambitious... about 202kg short at best." The
 * 335kg was a 200kg squat target plus a 135kg bench target. The 133kg it was
 * compared against was the bench alone — the athlete has never logged a squat,
 * and a missing 1RM was being summed as zero.
 *
 * They are not 202kg short of anything. The engine does not know their squat.
 */

const STATE = (oneRms: Record<string, number>): AthleteState =>
  ({
    bodyweightKg: 83,
    heightCm: 180,
    age: 30,
    sex: "male",
    oneRms,
    predicted5kS: 1105,
    strengthTrainingAge: "intermediate",
    enduranceTrainingAge: "intermediate",
    strengthTrainingYears: 5,
    enduranceTrainingYears: 5,
    currentRunMinPerWeek: 60,
    currentStrengthSessionsPerWeek: 3,
    chronicLoad: 100,
    restingHr: 55,
    maxHr: 190,
    safety: {} as AthleteState["safety"],
    assumed: [],
  }) as AthleteState;

const GOAL = (over: Partial<Goal>): Goal =>
  ({
    weeksOut: 8,
    horizonSource: "event_date",
    target5kS: null,
    enduranceEventKm: null,
    enduranceEventKey: null,
    targetSquatKg: null,
    targetBenchKg: null,
    targetDeadliftKg: null,
    targetTotalKg: null,
    priority: 0.5,
    sameDay: false,
    ...over,
  }) as Goal;

describe("strengthComparisonBasis", () => {
  it("does not value a targeted-but-never-logged lift at zero", () => {
    const basis = strengthComparisonBasis(STATE({ bench: 132 }), {
      targetSquatKg: 200,
      targetBenchKg: 135,
      targetDeadliftKg: null,
    });
    expect(basis.currentKg).toBe(132);
    expect(basis.missingLifts).toEqual(["squat"]);
  });

  it("compares a partial target against the same lifts only", () => {
    // A bench-only goal used to be measured against squat + bench + deadlift,
    // which reads as a collapse in the total.
    const basis = strengthComparisonBasis(STATE({ squat: 180, bench: 130, deadlift: 220 }), {
      targetSquatKg: null,
      targetBenchKg: 140,
      targetDeadliftKg: null,
    });
    expect(basis.currentKg).toBe(130);
    expect(basis.missingLifts).toEqual([]);
  });

  it("keeps the all-three behaviour for a bare total with no per-lift breakdown", () => {
    const basis = strengthComparisonBasis(STATE({ squat: 180, bench: 130, deadlift: 220 }), {
      targetSquatKg: null,
      targetBenchKg: null,
      targetDeadliftKg: null,
    });
    expect(basis.currentKg).toBe(530);
    expect(basis.missingLifts).toEqual([]);
  });
});

describe("the feasibility message", () => {
  it("says what it does not know instead of quoting a shortfall against a zero", () => {
    const result = feasibilityScreen(
      STATE({ bench: 132 }),
      GOAL({ targetSquatKg: 200, targetBenchKg: 135, targetTotalKg: 335 })
    );
    const line = result.messages.find((m) => m.startsWith("Total:"))!;

    expect(line).toContain("no projection yet");
    expect(line).toContain("squat");
    expect(line).not.toMatch(/\d+kg short/);
    // "Cannot tell yet" and "you will miss it" are different answers, and the
    // athlete deserves the one that is true.
    expect(result.strengthReachable).toBeNull();
    expect(result.strengthShortfallKg).toBeNull();
  });

  it("still gives a real forecast once every targeted lift has a number", () => {
    const result = feasibilityScreen(
      STATE({ squat: 190, bench: 132 }),
      GOAL({ targetSquatKg: 200, targetBenchKg: 135, targetTotalKg: 335 })
    );
    const line = result.messages.find((m) => m.startsWith("Total:"))!;

    expect(line).not.toContain("no projection yet");
    expect(result.strengthReachable).not.toBeNull();
    expect(result.strengthShortfallKg).not.toBeNull();
  });
});
