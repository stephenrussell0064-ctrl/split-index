import { describe, expect, it } from "vitest";
import {
  movementPatternForExercise,
  strengthPhaseFromGap,
  strengthPhaseFromGapAndUrgency,
  mainLiftPrescription,
  dupVariantLabel,
  pickAccessories,
  cardioEmphasisFromGap,
  cardioEmphasisFromGapAndUrgency,
  cardioSessionTypes,
  sessionContentForInstance,
  isTaperWindow,
  estimateFeasibility,
  TAPER_WINDOW_DAYS,
} from "./training-session-content";
import type { RankedGoal } from "./training-plan";

describe("movementPatternForExercise", () => {
  it("maps chest/shoulder/triceps lifts to push", () => {
    expect(movementPatternForExercise("Bench Press")).toBe("push");
    expect(movementPatternForExercise("Overhead Press")).toBe("push");
  });

  it("maps back lifts to pull", () => {
    expect(movementPatternForExercise("Deadlift")).toBe("pull");
    expect(movementPatternForExercise("Barbell Row")).toBe("pull");
  });

  it("maps leg lifts to legs", () => {
    expect(movementPatternForExercise("Squat")).toBe("legs");
  });

  it("returns null for an unrecognized name", () => {
    expect(movementPatternForExercise("Made Up Exercise Name")).toBeNull();
  });
});

describe("strengthPhaseFromGap", () => {
  it("returns build when far from target", () => {
    expect(strengthPhaseFromGap(0.3)).toBe("build");
  });
  it("returns strength for a moderate gap", () => {
    expect(strengthPhaseFromGap(0.12)).toBe("strength");
  });
  it("returns peak when close to target", () => {
    expect(strengthPhaseFromGap(0.05)).toBe("peak");
  });
});

describe("mainLiftPrescription / dupVariantLabel", () => {
  it("returns the phase's own prescription for a single weekly session (no undulation needed)", () => {
    expect(mainLiftPrescription("strength", 0, 1)).toEqual({ sets: 5, reps: "4-6", intensity: "~80-85% 1RM" });
    expect(dupVariantLabel(0, 1)).toBeNull();
  });

  it("alternates heavier and lighter prescriptions across repeat weekly sessions of the same lift", () => {
    const heavy = mainLiftPrescription("strength", 0, 2);
    const volume = mainLiftPrescription("strength", 1, 2);
    expect(heavy).not.toEqual(volume);
    expect(dupVariantLabel(0, 2)).toBe("Heavy day");
    expect(dupVariantLabel(1, 2)).toBe("Volume day");
    // Heavy variant should use fewer reps than the volume variant.
    const heavyReps = Number(heavy.reps.split("-")[0]);
    const volumeReps = Number(volume.reps.split("-")[0]);
    expect(heavyReps).toBeLessThan(volumeReps);
  });
});

describe("pickAccessories", () => {
  it("pulls one accessory per synergist muscle for a push lift, not the same muscle repeated", () => {
    const picks = pickAccessories("Bench Press", "build", new Set());
    expect(picks.length).toBeGreaterThan(1);
    const muscles = picks.map((p) => p.muscle);
    expect(new Set(muscles).size).toBe(muscles.length); // no duplicate muscle group
    expect(muscles.every((m) => ["Chest", "Shoulders", "Triceps"].includes(m))).toBe(true);
  });

  it("never recommends the main lift itself as an accessory", () => {
    const picks = pickAccessories("Bench Press", "build", new Set());
    expect(picks.some((p) => p.name === "Bench Press")).toBe(false);
  });

  it("excludes exercises that are already someone's own explicit goal elsewhere in the plan", () => {
    const withoutExclusion = pickAccessories("Bench Press", "build", new Set());
    const someExerciseName = withoutExclusion[0]?.name;
    expect(someExerciseName).toBeTruthy();
    const withExclusion = pickAccessories("Bench Press", "build", new Set([someExerciseName!]));
    expect(withExclusion.some((p) => p.name === someExerciseName)).toBe(false);
  });

  it("returns nothing for an unrecognized exercise rather than throwing", () => {
    expect(pickAccessories("Not A Real Lift", "build", new Set())).toEqual([]);
  });
});

describe("cardioEmphasisFromGap", () => {
  it("emphasizes aerobic base when far from target", () => {
    expect(cardioEmphasisFromGap(0.3)).toBe("aerobic-base");
  });
  it("emphasizes specificity when close to target", () => {
    expect(cardioEmphasisFromGap(0.05)).toBe("specificity");
  });
});

describe("cardioSessionTypes", () => {
  it("never repeats the identical session type for 2+ sessions a week", () => {
    for (const count of [2, 3, 4, 5]) {
      const types = cardioSessionTypes(count, "aerobic-base");
      expect(types).toHaveLength(count);
      expect(new Set(types).size).toBeGreaterThan(1);
    }
  });

  it("includes a long session once there are at least 3 sessions a week", () => {
    expect(cardioSessionTypes(3, "aerobic-base")).toContain("long");
    expect(cardioSessionTypes(4, "specificity")).toContain("long");
  });

  it("returns an empty array for zero sessions", () => {
    expect(cardioSessionTypes(0, "aerobic-base")).toEqual([]);
  });
});

describe("sessionContentForInstance", () => {
  const gymGoal: RankedGoal = {
    id: "bench",
    goalType: "gym",
    targetKey: "Bench Press",
    targetValue: 100,
    currentValue: 70,
    label: "Bench Press",
    gapFraction: 0.3,
    achieved: false,
    weight: 1,
    weeklySessions: 2,
    feasibility: { feasible: true, message: null },
  };

  const cardioGoal: RankedGoal = {
    id: "run",
    goalType: "cardio",
    targetKey: "run",
    targetValue: 1200,
    currentValue: 1500,
    label: "5K run",
    gapFraction: 0.25,
    achieved: false,
    weight: 1,
    weeklySessions: 3,
    feasibility: { feasible: true, message: null },
  };

  it("produces genuinely different content for a lift's two weekly sessions, not the same prescription twice", () => {
    const first = sessionContentForInstance(gymGoal, 0, 2, new Set());
    const second = sessionContentForInstance(gymGoal, 1, 2, new Set());
    expect(first.description).not.toBe(second.description);
    expect(first.title).not.toBe(second.title);
  });

  it("includes accessory work in a gym session's description, not just the main lift", () => {
    const content = sessionContentForInstance(gymGoal, 0, 1, new Set());
    expect(content.description).toContain("Bench Press");
    expect(content.description).toContain("·"); // at least one accessory joined on
  });

  it("produces a real easy/quality/long spread for a 3x/week cardio goal, not the same session three times", () => {
    const sessions = [0, 1, 2].map((i) => sessionContentForInstance(cardioGoal, i, 3, new Set()));
    const sessionTypes = sessions.map((s) => s.sessionType);
    expect(new Set(sessionTypes).size).toBe(3);
  });

  it("switches a gym session to a taper (reduced accessories, taper note) inside the taper window", () => {
    const normal = sessionContentForInstance(gymGoal, 0, 1, new Set(), TAPER_WINDOW_DAYS + 20);
    const tapering = sessionContentForInstance(gymGoal, 0, 1, new Set(), TAPER_WINDOW_DAYS - 2);
    expect(tapering.title).toContain("Taper");
    expect(tapering.description).toContain("Tapering");
    expect(tapering.description.split("·").length).toBeLessThan(normal.description.split("·").length);
  });

  it("switches a cardio session to specificity/taper inside the taper window regardless of a large gap", () => {
    const farFromTarget: RankedGoal = { ...cardioGoal, gapFraction: 0.4 };
    const content = sessionContentForInstance(farFromTarget, 0, 1, new Set(), 5);
    expect(content.title).toContain("Taper");
    expect(content.sessionType).not.toBe("easy"); // aerobic-base at this gap would normally pick "easy"
  });

  // User feedback: "for the runs and swims and cycles be specific on the
  // distance and pace of each activity that you should perform."
  describe("cardio pace/distance specificity", () => {
    const runGoalWithDistance: RankedGoal = { ...cardioGoal, distanceMeters: 5000, sport: "run" };

    it("has no concrete distance/pace when the goal carries no distance (unchanged pre-existing behavior)", () => {
      const content = sessionContentForInstance(cardioGoal, 0, 1, new Set());
      expect(content.description).not.toMatch(/km at/);
    });

    it("states a concrete distance and pace once the goal has a known race distance", () => {
      const content = sessionContentForInstance(runGoalWithDistance, 0, 1, new Set());
      expect(content.description).toMatch(/^\d+(\.\d+)?km at \d+:\d{2}\/km/);
    });

    it("prescribes an easy session slower than the athlete's current race pace, and a tempo session closer to it", () => {
      const easyOnly = { ...runGoalWithDistance, gapFraction: 0.3 }; // aerobic-base emphasis, single session -> "easy"
      const easy = sessionContentForInstance(easyOnly, 0, 1, new Set());
      expect(easy.sessionType).toBe("easy");
      const easyPaceMatch = easy.description.match(/(\d+):(\d{2})\/km/)!;
      const easySec = Number(easyPaceMatch[1]) * 60 + Number(easyPaceMatch[2]);

      // currentValue 1500s / 5km = 300s/km current race pace.
      const currentPaceSecPerKm = runGoalWithDistance.currentValue! / (runGoalWithDistance.distanceMeters! / 1000);
      expect(easySec).toBeGreaterThan(currentPaceSecPerKm); // slower (bigger sec/km) than race pace

      const quality = { ...runGoalWithDistance, gapFraction: 0.02 }; // specificity emphasis, single session -> "tempo"
      const tempo = sessionContentForInstance(quality, 0, 1, new Set());
      const tempoPaceMatch = tempo.description.match(/(\d+):(\d{2})\/km/)!;
      const tempoSec = Number(tempoPaceMatch[1]) * 60 + Number(tempoPaceMatch[2]);
      expect(tempoSec).toBeLessThan(easySec); // tempo is closer to race pace than easy
    });

    it("shows a speed (km/h) instead of a pace for a cycling goal", () => {
      const cycleGoal: RankedGoal = { ...cardioGoal, sport: "cycle", distanceMeters: 20000, targetValue: 2400, currentValue: 2400 };
      const content = sessionContentForInstance(cycleGoal, 0, 1, new Set());
      expect(content.description).toMatch(/km\/h/);
      expect(content.description).not.toMatch(/\/km\b/);
    });

    it("derives the session distance from the actual session duration passed in, not a hardcoded one", () => {
      const short = sessionContentForInstance(runGoalWithDistance, 0, 1, new Set(), null, 0.5);
      const long = sessionContentForInstance(runGoalWithDistance, 0, 1, new Set(), null, 1.5);
      const shortKm = Number(short.description.match(/^([\d.]+)km/)![1]);
      const longKm = Number(long.description.match(/^([\d.]+)km/)![1]);
      expect(longKm).toBeGreaterThan(shortKm);
    });
  });
});

describe("strengthPhaseFromGapAndUrgency (Stage 2 taper)", () => {
  it("ignores the deadline when none is given", () => {
    expect(strengthPhaseFromGapAndUrgency(0.3, null)).toBe(strengthPhaseFromGap(0.3));
  });

  it("forces peak phase inside the taper window regardless of a large gap", () => {
    expect(strengthPhaseFromGapAndUrgency(0.3, 5)).toBe("peak");
  });

  it("nudges toward peak (but not all the way) in the wider pre-taper peak window", () => {
    const gapOnly = strengthPhaseFromGap(0.3); // "build"
    const withDeadline = strengthPhaseFromGapAndUrgency(0.3, 20);
    expect(withDeadline).not.toBe(gapOnly);
    expect(withDeadline).toBe("strength");
  });

  it("leaves the gap-only phase alone well outside the peak window", () => {
    expect(strengthPhaseFromGapAndUrgency(0.3, 90)).toBe(strengthPhaseFromGap(0.3));
  });
});

describe("cardioEmphasisFromGapAndUrgency (Stage 2 taper)", () => {
  it("forces specificity inside the taper window even with a large gap", () => {
    expect(cardioEmphasisFromGapAndUrgency(0.4, 3)).toBe("specificity");
  });

  it("falls back to gap-only emphasis outside the taper window", () => {
    expect(cardioEmphasisFromGapAndUrgency(0.4, 60)).toBe(cardioEmphasisFromGap(0.4));
  });
});

describe("isTaperWindow", () => {
  it("is true only for a non-negative deadline within the taper window", () => {
    expect(isTaperWindow(null)).toBe(false);
    expect(isTaperWindow(-1)).toBe(false);
    expect(isTaperWindow(0)).toBe(true);
    expect(isTaperWindow(TAPER_WINDOW_DAYS)).toBe(true);
    expect(isTaperWindow(TAPER_WINDOW_DAYS + 1)).toBe(false);
  });
});

describe("estimateFeasibility", () => {
  it("is always feasible with no deadline", () => {
    expect(estimateFeasibility(0.5, 3, null).feasible).toBe(true);
  });

  it("is always feasible for an already-achieved goal", () => {
    expect(estimateFeasibility(0, 3, 7).feasible).toBe(true);
  });

  it("flags a large gap with very little time and low frequency as unrealistic", () => {
    const result = estimateFeasibility(0.5, 1, 14); // 50% gap, 2 weeks, 1x/week
    expect(result.feasible).toBe(false);
    expect(result.message).toMatch(/ambitious/i);
  });

  it("treats a small gap with plenty of time and frequency as feasible", () => {
    const result = estimateFeasibility(0.05, 4, 180); // 5% gap, ~26 weeks, 4x/week
    expect(result.feasible).toBe(true);
    expect(result.message).toBeNull();
  });
});
