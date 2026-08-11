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
    expect(mainLiftPrescription("strength", 0, 1)).toEqual({
      sets: 5,
      reps: "4-6",
      intensity: "~80-85% 1RM",
      intensityLowPct: 0.8,
      intensityHighPct: 0.85,
    });
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

  // User feedback: "when trying to build cardio, zone 2 runs are the most
  // effective way of managing this yet there are no zone 2 runs on my
  // training plan, why is this?" — a 2x/week plan close to target used to
  // return ["tempo", "interval"] with no easy/Zone 2 session at all.
  it("always keeps at least one easy (Zone 2) session once there are 2+ a week, in every emphasis", () => {
    for (const count of [2, 3, 4, 5]) {
      for (const emphasis of ["aerobic-base", "specificity"] as const) {
        expect(cardioSessionTypes(count, emphasis)).toContain("easy");
      }
    }
  });

  const HARD_TYPES = new Set(["tempo", "threshold", "interval"]);

  // User follow-up: "zone 2 shouldn't just be 1 session a week, according
  // to most training guides zone 2 should be done more than intense
  // training to build up an aerobic base" — correct (standard 80/20
  // polarized-training principle). "At least one easy session" alone still
  // let a 4x/week specificity plan come back only 25% easy. Easy/Zone 2
  // (including the long session, which is easy-effort by design) must be
  // the clear majority at every realistic weekly count, in both emphases.
  it("keeps easy/Zone 2 effort as the clear majority of the week, not just present, once there's room to (3+ sessions — at 2x/week the honest floor is a 50/50 split, not a majority)", () => {
    for (const count of [3, 4, 5, 6, 7, 10, 14]) {
      for (const emphasis of ["aerobic-base", "specificity"] as const) {
        const types = cardioSessionTypes(count, emphasis);
        const hardCount = types.filter((t) => HARD_TYPES.has(t)).length;
        const easyishCount = count - hardCount; // easy + long, both easy-effort
        expect(easyishCount).toBeGreaterThan(hardCount);
      }
    }
  });

  it("gives specificity genuinely more quality work than aerobic-base once the week is big enough to tell them apart", () => {
    const count = 10;
    const hardIn = (emphasis: "aerobic-base" | "specificity") =>
      cardioSessionTypes(count, emphasis).filter((t) => HARD_TYPES.has(t)).length;
    expect(hardIn("specificity")).toBeGreaterThan(hardIn("aerobic-base"));
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

  // User feedback: "For strength goals, attempt to recommend a weight
  // based off the user's current strength performance in their recent
  // 1rms and activities logged."
  describe("concrete weight from the athlete's current 1RM", () => {
    it("shows an actual kg range for the main lift, not just a %1RM the athlete has to calculate themselves", () => {
      // gymGoal.currentValue = 70 (kg 1RM). strength phase (gapFraction 0.3 -> build): 70-75% -> 49-52.5kg -> rounds to 50-52.5kg.
      const content = sessionContentForInstance(gymGoal, 0, 1, new Set());
      expect(content.description).toMatch(/Bench Press \dx\d+-\d+ @ \d+(\.\d+)?-?\d*(\.\d+)?kg \(~\d+-\d+% 1RM\)/);
    });

    it("scales the recommended weight to the athlete's own current 1RM, not a generic number", () => {
      const lighter = sessionContentForInstance({ ...gymGoal, currentValue: 50 }, 0, 1, new Set());
      const heavier = sessionContentForInstance({ ...gymGoal, currentValue: 150 }, 0, 1, new Set());
      const lighterKg = Number(lighter.description.match(/@ ([\d.]+)/)![1]);
      const heavierKg = Number(heavier.description.match(/@ ([\d.]+)/)![1]);
      expect(heavierKg).toBeGreaterThan(lighterKg);
    });

    it("rounds the recommended weight to a real 2.5kg plate increment", () => {
      const content = sessionContentForInstance({ ...gymGoal, currentValue: 83 }, 0, 1, new Set());
      const kgValues = [...content.description.matchAll(/([\d.]+)kg/g)].map((m) => Number(m[1]));
      for (const kg of kgValues) {
        expect((kg * 10) % 25).toBe(0); // multiple of 2.5 (compared in tenths to dodge float noise)
      }
    });

    it("falls back to the plain %1RM text when there's no current 1RM on record yet", () => {
      const content = sessionContentForInstance({ ...gymGoal, currentValue: null }, 0, 1, new Set());
      expect(content.description).toContain("Bench Press 4x8-10 @ ~70-75% 1RM");
      expect(content.description).not.toMatch(/@ [\d.]+kg/);
    });
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

    // User feedback, with real numbers: "my 5km time is 18:30, and my 10km
    // pr time is 39:45, yet the training plan has recommended a tempo run
    // of 11.5km at 3:56/km, this is completely inaccurate and not possible
    // for me to do as a race let alone tempo run... also intervals of
    // 13.2km at 3:24? this is unreasonable and a strange distance." Both
    // numbers came from running the FULL 45-minute session continuously at
    // a hard pace — fixed by capping tempo/threshold to a realistic
    // sustained block and switching interval to reps-with-recovery.
    describe("realistic tempo/threshold/interval structure (not the whole session at race pace)", () => {
      const fastRunner: RankedGoal = {
        ...cardioGoal,
        distanceMeters: 5000,
        sport: "run",
        targetValue: 1110, // 18:30 5K
        currentValue: 1110,
      };

      it("caps a tempo session's distance to a realistic sustained block, not the full session length", () => {
        const quality = { ...fastRunner, gapFraction: 0.02 }; // specificity, single session -> "tempo"
        const content = sessionContentForInstance(quality, 0, 1, new Set());
        expect(content.sessionType).toBe("tempo");
        const km = Number(content.description.match(/^([\d.]+)km/)![1]);
        // Old behavior produced 11.5km (the full 45min session at tempo
        // pace) for this exact scenario — a real tempo block is a fraction
        // of that, comfortably under half.
        expect(km).toBeLessThan(6);
        expect(content.description).toContain("block");
      });

      it("prescribes interval work as reps with recovery, not one long continuous distance", () => {
        const quality = { ...fastRunner, gapFraction: 0.02, weeklySessions: 2 };
        const content = sessionContentForInstance(quality, 1, 2, new Set()); // specificity 2x -> ["easy","interval"], index 1 -> interval
        expect(content.sessionType).toBe("interval");
        expect(content.description).toMatch(/^\d+ x \d+m at \d+:\d{2}\/km \(jog recovery between reps\)/);
        // Never a bare "13.2km"-style continuous distance for an interval session.
        expect(content.description).not.toMatch(/^[\d.]+km/);
      });

      it("keeps the interval pace faster than current race pace, and every rep individually achievable", () => {
        const quality = { ...fastRunner, gapFraction: 0.02, weeklySessions: 2 };
        const content = sessionContentForInstance(quality, 1, 2, new Set());
        const match = content.description.match(/^(\d+) x (\d+)m at (\d+):(\d{2})\/km/)!;
        const reps = Number(match[1]);
        const repMeters = Number(match[2]);
        const paceSecPerKm = Number(match[3]) * 60 + Number(match[4]);
        const currentPaceSecPerKm = fastRunner.currentValue! / (fastRunner.distanceMeters! / 1000);
        expect(paceSecPerKm).toBeLessThan(currentPaceSecPerKm); // faster than current 5K race pace
        expect(reps).toBeGreaterThanOrEqual(3);
        expect(repMeters).toBe(800); // run -> 800m reps
      });
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
