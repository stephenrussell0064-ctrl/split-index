import { scoreStrength } from "@/lib/scoring/split-strength-engine";
import { resolveScoringWeight, type WeightEntryMode } from "@/lib/scoring/weight-entry";
import { parseNum, type SetRowState } from "./form-state";

/**
 * The Lab's "Est. 1RM", estimated exactly the way the saved score estimates it.
 *
 * Owner, 1 Nov 2026: "why is the 1rm prediction in the logbook different to
 * the 1rm prediction when logging the exercises in the lab for incline
 * dumbbell press and pec deck". The Lab card ran Epley — weight x (1 + reps/30),
 * single included — on the number typed, while the save path runs Strength
 * Level's rep table on the weight converted to the lift's anchor convention
 * and counts reps in reserve. Measured: incline dumbbell press 40 x 8 read
 * 50.7 in the Lab and 98.8 in the logbook (one dumbbell against the pair);
 * pec deck 130 x 8 read 164.7 against 160.5; a 140 kg bench single read 144.7
 * against 140.
 *
 * This goes through scoreStrength and reads its `oneRM` rather than
 * re-implementing the estimator, so the card cannot drift from the save again.
 * Sex and age do not touch the 1RM, so they are not needed here; the history
 * blend a premium save applies is a logbook feature ("Current 1RM · All-time
 * best") and is deliberately not reproduced for one set.
 */
export interface LabOneRM {
  /** In the lift's anchor convention — the pair for a dumbbell press anchored on total load, added load for a weighted pull-up. */
  kg: number;
  /** True when the typed weight was per hand and the figure is for both dumbbells together. */
  pair: boolean;
  /** True when the figure is load ADDED to bodyweight, not the total moved. */
  addedLoad: boolean;
}

export function labOneRM(input: {
  exerciseName: string;
  weightEntryMode: WeightEntryMode;
  set: Pick<SetRowState, "weight" | "reps" | "repsInReserve">;
  bodyweightKg: number | null;
  /** The lift has no weight input: every set is at bodyweight. */
  bodyweightOnly: boolean;
}): LabOneRM | null {
  const name = input.exerciseName.trim();
  const reps = parseNum(input.set.reps);
  if (!name || !reps || reps <= 0) return null;
  const rawWeight = parseNum(input.set.weight);
  const weightKg = input.bodyweightOnly ? 0 : (rawWeight ?? (input.weightEntryMode === "added" ? 0 : null));
  if (weightKg === null) return null;
  const resolved = resolveScoringWeight(weightKg, name, input.weightEntryMode);
  if (resolved.isBodyweightRelative && !(input.bodyweightKg && input.bodyweightKg > 0)) return null;
  if (!resolved.isBodyweightRelative && resolved.scoringWeightKg <= 0) return null;

  const result = scoreStrength({
    liftKey: name,
    exerciseName: name,
    history: [],
    latestSet: {
      weightKg: resolved.scoringWeightKg,
      reps,
      repsInReserve: input.set.repsInReserve.trim() ? parseNum(input.set.repsInReserve) : null,
    },
    // Not a factor in the 1RM; a positive bodyweight only matters for the
    // bodyweight-relative lifts, which were gated above.
    bodyweightKg: input.bodyweightKg && input.bodyweightKg > 0 ? input.bodyweightKg : 80,
    sex: "male",
    age: null,
    isPremium: false,
    isBodyweightRelative: resolved.isBodyweightRelative,
    weightEntryMode: resolved.mode,
  });
  if (result.flags.includes("no-valid-set") || !(result.oneRM > 0)) return null;
  return {
    kg: result.oneRM,
    pair: resolved.mode === "per_hand" && resolved.scoringWeightKg !== weightKg,
    addedLoad: resolved.isBodyweightRelative,
  };
}
