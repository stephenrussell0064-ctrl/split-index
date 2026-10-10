import { describe, expect, it } from "vitest";
import {
  canLogAsPrescribed,
  isBodyweightMovement,
  muscleGroupForExercise,
  parsePrescribedExercises,
  parsePrescribedLine,
  prescribedSetValues,
} from "./prescribed-sets";

/**
 * The inverse of `prescribeLift`'s string. Every shape below is one the engine
 * actually writes (prescription.ts `loadText`, `withLoggedLoad`, the accessory
 * pools in constants.ts) — a parser that handled a tidier grammar than the one
 * in production would fill the form with nothing.
 */
describe("parsePrescribedLine", () => {
  it("reads a lead lift with a kilogram band, a percentage and an RIR band", () => {
    const ex = parsePrescribedLine("Back squat 4x3-5 @ 120-135kg (80-90% 1RM), RIR 2-3");
    expect(ex).toMatchObject({
      name: "Back squat",
      muscleGroup: "Quads",
      sets: 4,
      repsLo: 3,
      repsHi: 5,
      holdSeconds: null,
      loadLoKg: 120,
      loadHiKg: 135,
      rirLo: 2,
      rirHi: 3,
    });
  });

  it("reads an accessory with a logged load and no RIR", () => {
    expect(parsePrescribedLine("Leg press 3x10-15 @ 145-165kg")).toMatchObject({
      name: "Leg press",
      sets: 3,
      repsLo: 10,
      repsHi: 15,
      loadLoKg: 145,
      loadHiKg: 165,
      rirLo: null,
    });
  });

  it("reads a bare accessory scheme with no load at all", () => {
    expect(parsePrescribedLine("Lateral raise 3x12-15")).toMatchObject({
      name: "Lateral raise",
      muscleGroup: "Shoulders",
      loadLoKg: null,
      loadHiKg: null,
    });
  });

  it("reads a single-load, single-rep line without inventing a band", () => {
    expect(parsePrescribedLine("Barbell row 3x8 @ 60kg")).toMatchObject({
      repsLo: 8,
      repsHi: 8,
      loadLoKg: 60,
      loadHiKg: 60,
    });
  });

  it("leaves the load null when the engine only had a percentage to give", () => {
    const ex = parsePrescribedLine(
      "Pause Squat 4x3-5 @ 80-90% 1RM (no logged 1RM yet — work to the RIR), RIR 2-3"
    );
    // "80-90%" must not be read as "80-90kg".
    expect(ex?.loadLoKg).toBeNull();
    expect(ex?.rirLo).toBe(2);
  });

  it("leaves the load null for a qualitative instruction", () => {
    expect(
      parsePrescribedLine("Goblet squat 4x3-5 @ bodyweight or whatever load you have, taken to the RIR below, RIR 2-3")
        ?.loadLoKg
    ).toBeNull();
  });

  it("reads a timed hold as seconds, not reps", () => {
    expect(parsePrescribedLine("Weighted plank 3x45s")).toMatchObject({
      sets: 3,
      repsLo: null,
      holdSeconds: 45,
      muscleGroup: "Core",
    });
  });

  it("keeps a trailing qualifier out of the name", () => {
    expect(parsePrescribedLine("Single-arm dumbbell row 3x10-12 each")?.name).toBe(
      "Single-arm dumbbell row"
    );
  });

  it("returns null for a line with no set scheme", () => {
    expect(parsePrescribedLine("Pause Squat replaces the competition squat this block")).toBeNull();
    expect(parsePrescribedLine("")).toBeNull();
  });
});

describe("parsePrescribedExercises", () => {
  it("splits on the engine's separator and keeps the order", () => {
    const text =
      "Bench 4x3-5 @ 80-90kg (80-90% 1RM), RIR 2-3 · Incline dumbbell press 3x8-12 · Triceps rope pushdown 3x12-15 @ 20-25kg";
    expect(parsePrescribedExercises(text).map((e) => e.name)).toEqual([
      "Bench",
      "Incline dumbbell press",
      "Triceps rope pushdown",
    ]);
  });

  it("drops what it cannot parse rather than guessing", () => {
    expect(parsePrescribedExercises("Easy run 40 min")).toEqual([]);
  });
});

describe("prescribedSetValues", () => {
  it("fills a band in at its midpoint, load to the nearest 2.5 kg and reps rounded down", () => {
    const ex = parsePrescribedLine("Back squat 4x3-5 @ 120-135kg (80-90% 1RM), RIR 2-3")!;
    // 127.5 is a real bar load; 4 is "at least 3, up to 5" rounded down from 4.
    expect(prescribedSetValues(ex)).toEqual({ weightKg: 127.5, reps: 4, holdSeconds: null });
  });

  it("passes a single load through unchanged", () => {
    expect(prescribedSetValues(parsePrescribedLine("Barbell row 3x8 @ 60kg")!)).toEqual({
      weightKg: 60,
      reps: 8,
      holdSeconds: null,
    });
  });

  it("gives no weight when the line gave none", () => {
    expect(prescribedSetValues(parsePrescribedLine("Lateral raise 3x12-15")!)).toEqual({
      weightKg: null,
      reps: 13,
      holdSeconds: null,
    });
  });
});

describe("muscleGroupForExercise", () => {
  it("uses the exercise table when the name is in it", () => {
    expect(muscleGroupForExercise("Bench Press")).toBe("Chest");
    expect(muscleGroupForExercise("bench press")).toBe("Chest");
  });

  it("places an either/or line by whichever half it knows", () => {
    expect(muscleGroupForExercise("Pull-up or lat pulldown")).toBe("Back");
  });

  it("falls back to a keyword for the engine's own phrasing", () => {
    expect(muscleGroupForExercise("Romanian deadlift")).toBe("Hamstrings");
    expect(muscleGroupForExercise("Seated rear delt machine")).toBe("Shoulders");
    expect(muscleGroupForExercise("Cable fly or pec deck")).toBe("Chest");
    expect(muscleGroupForExercise("Farmer's walk")).toBe("Core");
  });

  it("lets the exercise table outrank a keyword", () => {
    // "Face Pull" is in the table; whatever it says there wins over the
    // keyword fallback, so the form's own vocabulary stays consistent.
    expect(muscleGroupForExercise("Face pull")).not.toBe("");
  });

  it("gives up rather than guessing for a name it cannot place", () => {
    expect(muscleGroupForExercise("Mystery machine")).toBe("");
  });
});

describe("canLogAsPrescribed", () => {
  it("is true when every line has a load the form can take", () => {
    const text = "Back squat 4x3-5 @ 120-135kg (80-90% 1RM), RIR 2-3 · Leg press 3x10-15 @ 145-165kg";
    expect(canLogAsPrescribed(parsePrescribedExercises(text))).toBe(true);
  });

  it("is false when any line has no number to log", () => {
    // Logging "Lateral raise" at 0 kg would be invented data; this session opens in the form instead.
    const text = "Back squat 4x3-5 @ 120-135kg (80-90% 1RM), RIR 2-3 · Lateral raise 3x12-15";
    expect(canLogAsPrescribed(parsePrescribedExercises(text))).toBe(false);
  });

  it("accepts a bodyweight movement and a timed hold without a load", () => {
    const text = "Pull-up 3x8-12 · Weighted plank 3x45s";
    expect(canLogAsPrescribed(parsePrescribedExercises(text))).toBe(true);
  });

  it("is false for nothing", () => {
    expect(canLogAsPrescribed([])).toBe(false);
  });
});

describe("isBodyweightMovement", () => {
  it("names the plain variants and not the loaded ones", () => {
    expect(isBodyweightMovement("Pull-up")).toBe(true);
    expect(isBodyweightMovement("Dips")).toBe(true);
    expect(isBodyweightMovement("Weighted pull-up")).toBe(false);
    expect(isBodyweightMovement("Bench press")).toBe(false);
  });
});
