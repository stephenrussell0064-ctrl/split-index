import { describe, expect, it } from "vitest";
import {
  ScoringInputError,
  assertScoringInput,
  isMachineAnchoredLift,
  liftWeightLimits,
} from "./input-guards";
import { COMMON_EXERCISES } from "@/lib/constants/sports";

/** A gym session that passes every guard except the one under test. */
function gymSession(
  exercises: Array<{
    exercise_name?: string;
    sets: Array<{ weight_kg: number; reps: number; rpe?: number | null }>;
  }>,
  bodyweightKg: number | null = 80
) {
  return {
    sport: "gym" as const,
    durationSeconds: 3600,
    exercises,
    profile: { weight_kg: bodyweightKg, gender: "male" as const },
  };
}

function set(weightKg: number, reps = 5) {
  return { weight_kg: weightKg, reps };
}

describe("liftWeightLimits", () => {
  it("gives free-weight lifts the 6x bodyweight / 500 kg ceiling", () => {
    expect(liftWeightLimits("Bench Press")).toEqual({
      maxWeightKg: 500,
      maxBodyweightMultiple: 6,
    });
  });

  it("gives machine-anchored leg movements a higher ceiling", () => {
    const limits = liftWeightLimits("Leg Press");
    expect(limits.maxWeightKg).toBeGreaterThan(500);
    expect(limits.maxBodyweightMultiple).toBeGreaterThan(6);
  });

  it("falls back to the free-weight ceiling for unknown and custom names", () => {
    expect(liftWeightLimits("Some Custom Movement")).toEqual(liftWeightLimits("Bench Press"));
    expect(liftWeightLimits(undefined)).toEqual(liftWeightLimits("Bench Press"));
    expect(liftWeightLimits(null)).toEqual(liftWeightLimits("Bench Press"));
  });

  it("matches exercise names case-insensitively and ignores surrounding space", () => {
    expect(isMachineAnchoredLift("  leg PRESS ")).toBe(true);
  });

  it("only names exercises that exist in the exercise catalogue", () => {
    const catalogue = new Set(COMMON_EXERCISES.map((ex) => ex.name.toLowerCase()));
    const machineNames = [
      "Leg Press",
      "Single Leg Press",
      "Iso-Lateral Leg Press",
      "Leg Press Calf Raise",
      "Hack Squat",
      "Hack Squat Machine",
      "Belt Squat",
      "Sled Push",
      "Sled Pull",
    ];
    for (const name of machineNames) {
      expect(isMachineAnchoredLift(name), `${name} should be machine-anchored`).toBe(true);
      expect(catalogue.has(name.toLowerCase()), `${name} missing from COMMON_EXERCISES`).toBe(true);
    }
  });

  it("does not treat machine pressing for the upper body as machine-anchored", () => {
    // Loaded through the same joints as their barbell equivalents, so the
    // bodyweight-relative sanity check still applies.
    expect(isMachineAnchoredLift("Machine Chest Press")).toBe(false);
    expect(isMachineAnchoredLift("Smith Machine Bench Press")).toBe(false);
    expect(isMachineAnchoredLift("Leg Extension")).toBe(false);
  });
});

describe("assertScoringInput — lift load guard", () => {
  it("accepts a 600 kg leg press from an 80 kg athlete", () => {
    // The reported defect: 6 x 80 kg capped this athlete at 480 kg, which a
    // plate-loaded sled clears with ordinary plates.
    expect(() =>
      assertScoringInput(gymSession([{ exercise_name: "Leg Press", sets: [set(600)] }]))
    ).not.toThrow();
  });

  it("accepts the rest of the machine-anchored family above 6x bodyweight", () => {
    for (const name of [
      "Iso-Lateral Leg Press",
      "Leg Press Calf Raise",
      "Hack Squat Machine",
      "Belt Squat",
      "Sled Push",
    ]) {
      expect(() =>
        assertScoringInput(gymSession([{ exercise_name: name, sets: [set(560)] }])),
        `${name} at 560 kg should be accepted`
      ).not.toThrow();
    }
  });

  it("still rejects a bench press at 10x bodyweight", () => {
    expect(() =>
      assertScoringInput(gymSession([{ exercise_name: "Bench Press", sets: [set(800)] }]))
    ).toThrow(ScoringInputError);
  });

  it("still rejects a bench press just over 6x bodyweight", () => {
    expect(() =>
      assertScoringInput(gymSession([{ exercise_name: "Bench Press", sets: [set(481)] }], 80))
    ).toThrow(/implausible for the recorded bodyweight/);
    expect(() =>
      assertScoringInput(gymSession([{ exercise_name: "Bench Press", sets: [set(480)] }], 80))
    ).not.toThrow();
  });

  it("still rejects a fat-fingered leg press", () => {
    // 2250 for 225 — the data-entry error the guard exists to catch.
    expect(() =>
      assertScoringInput(gymSession([{ exercise_name: "Leg Press", sets: [set(2250)] }]))
    ).toThrow(ScoringInputError);
  });

  it("caps the machine ceiling absolutely, not just relative to bodyweight", () => {
    // A 150 kg athlete would clear 12x bodyweight at 1800 kg; the absolute
    // machine cap has to bite first.
    expect(() =>
      assertScoringInput(gymSession([{ exercise_name: "Leg Press", sets: [set(1500)] }], 150))
    ).toThrow(/out of the allowed range/);
  });

  it("applies the machine multiple to light athletes too", () => {
    // 50 kg athlete: 12x = 600 kg, so 700 kg is still implausible for them.
    expect(() =>
      assertScoringInput(gymSession([{ exercise_name: "Leg Press", sets: [set(700)] }], 50))
    ).toThrow(/implausible for the recorded bodyweight/);
    expect(() =>
      assertScoringInput(gymSession([{ exercise_name: "Leg Press", sets: [set(600)] }], 50))
    ).not.toThrow();
  });

  it("keeps the free-weight ceiling for an unnamed exercise", () => {
    expect(() => assertScoringInput(gymSession([{ sets: [set(600)] }]))).toThrow(
      /out of the allowed range/
    );
  });

  it("names the offending exercise in the error", () => {
    expect(() =>
      assertScoringInput(gymSession([{ exercise_name: "Bench Press", sets: [set(800)] }]))
    ).toThrow(/^Bench Press: /);
  });

  it("leaves the bodyweight guard off when no bodyweight is recorded", () => {
    expect(() =>
      assertScoringInput(gymSession([{ exercise_name: "Bench Press", sets: [set(400)] }], null))
    ).not.toThrow();
  });

  it("still rejects non-positive and non-integer reps", () => {
    expect(() =>
      assertScoringInput(gymSession([{ exercise_name: "Leg Press", sets: [set(300, 0)] }]))
    ).toThrow(/Reps must be a positive whole number/);
    expect(() =>
      assertScoringInput(gymSession([{ exercise_name: "Leg Press", sets: [set(300, 2.5)] }]))
    ).toThrow(/Reps must be a positive whole number/);
  });
});
