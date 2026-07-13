import { normalizeName } from "@/lib/scoring/split-strength-engine";

/** How the athlete entered load on the logging form. */
export type WeightEntryMode = "total" | "per_hand" | "added";

export interface ResolvedScoringWeight {
  /** Load passed into scoreStrength (after per-hand doubling). */
  scoringWeightKg: number;
  mode: WeightEntryMode;
  /** Added load on top of bodyweight (pull-ups, dips). */
  isBodyweightRelative: boolean;
}

/**
 * Default entry mode per exercise — user can override on the logging form.
 * `per_hand`: logged kg is one dumbbell/kettlebell; scoring doubles it.
 * `added`: logged kg is extra load beyond bodyweight (weighted dips / pull-ups).
 */
const DEFAULT_MODES: Record<string, WeightEntryMode> = {
  // Chest — per hand
  "incline dumbbell press": "per_hand",
  "decline dumbbell press": "per_hand",
  "dumbbell bench press": "per_hand",
  "dumbbell fly": "per_hand",
  "incline dumbbell fly": "per_hand",
  // Legs — per hand (barbell users switch to total on the form)
  "walking lunges": "per_hand",
  "bulgarian split squat": "per_hand",
  lunges: "per_hand",
  "reverse lunges": "per_hand",
  // Arms — per hand
  "dumbbell curl": "per_hand",
  "hammer curl": "per_hand",
  "cross body hammer curl": "per_hand",
  "concentration curl": "per_hand",
  "dumbbell row": "per_hand",
  // Bodyweight + added
  "weighted pull up": "added",
  "weighted pull-up": "added",
  "weighted chin up": "added",
  "weighted dips": "added",
  dips: "added",
  "chest dips": "added",
  "push up": "added",
  "push-up": "added",
  "weighted push up": "added",
  "weighted push-up": "added",
  "diamond push up": "added",
  "wide push up": "added",
  "decline push up": "added",
  "incline push up": "added",
};

const BODYWEIGHT_RELATIVE_NAMES = new Set([
  "weighted pull up",
  "weighted pull-up",
  "weighted chin up",
  "weighted dips",
  "dips",
  "chest dips",
  "pull up",
  "pull-up",
  "chin up",
  "push up",
  "push-up",
  "weighted push up",
  "weighted push-up",
  "diamond push up",
  "wide push up",
  "decline push up",
  "incline push up",
]);

export function defaultWeightEntryMode(exerciseName: string): WeightEntryMode {
  return DEFAULT_MODES[normalizeName(exerciseName)] ?? "total";
}

export function weightEntryLabel(mode: WeightEntryMode): string {
  switch (mode) {
    case "per_hand":
      return "kg per hand";
    case "added":
      return "kg added";
    default:
      return "kg";
  }
}

export function resolveScoringWeight(
  loggedWeightKg: number,
  exerciseName: string,
  mode?: WeightEntryMode | null
): ResolvedScoringWeight {
  const resolvedMode = mode ?? defaultWeightEntryMode(exerciseName);
  const key = normalizeName(exerciseName);
  const isBwRelative =
    resolvedMode === "added" || BODYWEIGHT_RELATIVE_NAMES.has(key);

  let scoringWeightKg = loggedWeightKg;
  if (resolvedMode === "per_hand") {
    scoringWeightKg = loggedWeightKg * 2;
  }

  return {
    scoringWeightKg,
    mode: resolvedMode,
    isBodyweightRelative: isBwRelative,
  };
}
