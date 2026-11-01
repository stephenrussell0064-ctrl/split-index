import { describe, expect, it } from "vitest";
import { labOneRM } from "./lab-one-rm";
import { scoreStrength } from "@/lib/scoring/split-strength-engine";
import { defaultWeightEntryMode, isBodyweightOnlyExercise, resolveScoringWeight } from "@/lib/scoring/weight-entry";

/**
 * Owner, 1 Nov 2026: the Lab's Est. 1RM and the logbook's disagreed for
 * incline dumbbell press and pec deck — and, measured, for every lift that
 * was not logged at exactly ten reps. The card now reads the engine's own
 * estimate. These pin agreement against the save path's call, for the two
 * reported lifts and one of each convention.
 */
const BW = 78;

function set(weight: string, reps: string, repsInReserve = "") {
  return { weight, reps, repsInReserve };
}

/** The 1RM the save path stores, computed the way activity-scorer.ts calls the engine. */
function savedOneRM(name: string, loggedKg: number, reps: number, rir: number | null = null) {
  const mode = defaultWeightEntryMode(name);
  const resolved = resolveScoringWeight(loggedKg, name, mode);
  return scoreStrength({
    liftKey: name,
    exerciseName: name,
    history: [],
    latestSet: { weightKg: resolved.scoringWeightKg, reps, repsInReserve: rir },
    bodyweightKg: BW,
    sex: "male",
    age: 30,
    isPremium: false,
    isBodyweightRelative: resolved.isBodyweightRelative,
    weightEntryMode: resolved.mode,
  }).oneRM;
}

function lab(name: string, weight: string, reps: string, rir = "") {
  return labOneRM({
    exerciseName: name,
    weightEntryMode: defaultWeightEntryMode(name),
    set: set(weight, reps, rir),
    bodyweightKg: BW,
    bodyweightOnly: isBodyweightOnlyExercise(name),
  });
}

describe("the Lab's Est. 1RM is the saved 1RM", () => {
  it.each([
    ["Incline Dumbbell Press", 40, 8],
    ["Pec Deck", 130, 8],
    ["Bench Press", 140, 1],
    ["Bench Press", 100, 8],
    ["Squat", 140, 5],
    ["Dumbbell Curl", 20, 10],
    ["Lateral Raise", 14, 12],
    ["Lat Pulldown", 90, 10],
    ["Weighted Pull Up", 30, 8],
    ["Tricep Pushdown", 45, 8],
  ] as const)("%s %d x %d", (name, kg, reps) => {
    expect(lab(name, String(kg), String(reps))?.kg).toBe(savedOneRM(name, kg, reps));
  });

  it("counts reps in reserve, as the save does", () => {
    expect(lab("Bench Press", "100", "5", "2")?.kg).toBe(savedOneRM("Bench Press", 100, 5, 2));
    expect(lab("Bench Press", "100", "5", "2")!.kg).toBeGreaterThan(lab("Bench Press", "100", "5")!.kg);
  });

  it("reports the two reported lifts at the logbook's numbers, not Epley's", () => {
    expect(lab("Incline Dumbbell Press", "40", "8")?.kg).toBe(98.8);
    expect(lab("Pec Deck", "130", "8")?.kg).toBe(160.5);
    expect(lab("Bench Press", "140", "1")?.kg).toBe(140);
  });
});

describe("the figure says which convention it is in", () => {
  it("marks a doubled dumbbell press as the pair, and a per-hand curl as not", () => {
    expect(lab("Incline Dumbbell Press", "40", "8")?.pair).toBe(true);
    expect(lab("Dumbbell Curl", "20", "10")?.pair).toBe(false);
    expect(lab("Bench Press", "100", "8")?.pair).toBe(false);
  });

  it("marks a weighted pull-up as added load", () => {
    const estimate = lab("Weighted Pull Up", "30", "8");
    expect(estimate?.addedLoad).toBe(true);
    expect(estimate?.pair).toBe(false);
  });
});

describe("when there is nothing to estimate", () => {
  it("is null without a name, reps or a usable weight", () => {
    expect(lab("", "100", "5")).toBeNull();
    expect(lab("Bench Press", "100", "")).toBeNull();
    expect(lab("Bench Press", "", "5")).toBeNull();
  });

  it("ignores a stale weight on a bodyweight-only lift and still estimates from bodyweight", () => {
    const stale = lab("Pull Up", "140", "10");
    const clean = lab("Pull Up", "", "10");
    expect(stale?.kg).toBe(clean?.kg);
    expect(stale?.kg).toBe(savedOneRM("Pull Up", 0, 10));
  });

  it("needs a bodyweight for a bodyweight-relative lift", () => {
    expect(
      labOneRM({ exerciseName: "Pull Up", weightEntryMode: "added", set: set("", "10"), bodyweightKg: null, bodyweightOnly: true })
    ).toBeNull();
  });
});
