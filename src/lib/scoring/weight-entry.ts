import { normalizeName } from "@/lib/scoring/split-strength-engine";

/** How the athlete entered load on the logging form (legacy alias). */
export type WeightEntryMode = "total" | "per_hand" | "added";

/** Load convention — what the logged number represents (Part C). */
export type LoadConvention = "total" | "perHand" | "addedLoad";

export interface ExerciseConfig {
  defaultConvention: LoadConvention;
  allowedConventions: LoadConvention[];
  /** Convention the anchor ratio was calibrated in — scoring normalizes to this. */
  anchorConvention: LoadConvention;
  conventionNote?: string;
}

export interface ResolvedScoringWeight {
  /** Load passed into scoreStrength (normalized to anchor convention). */
  scoringWeightKg: number;
  mode: WeightEntryMode;
  /** Added load on top of bodyweight (pull-ups, dips). */
  isBodyweightRelative: boolean;
  convention: LoadConvention;
}

/** Named, editable load-convention config per exercise (Part C). */
export const EXERCISE_LOAD_CONFIG: Record<string, ExerciseConfig> = {
  bench: {
    defaultConvention: "total",
    allowedConventions: ["total"],
    anchorConvention: "total",
  },
  squat: {
    defaultConvention: "total",
    allowedConventions: ["total"],
    anchorConvention: "total",
  },
  deadlift: {
    defaultConvention: "total",
    allowedConventions: ["total"],
    anchorConvention: "total",
  },
  legPress: {
    defaultConvention: "total",
    allowedConventions: ["total"],
    anchorConvention: "total",
  },
  weightedPullup: {
    defaultConvention: "addedLoad",
    allowedConventions: ["addedLoad"],
    anchorConvention: "addedLoad",
    conventionNote: "Enter the weight ADDED to your bodyweight, not the total.",
  },
  weightedDips: {
    defaultConvention: "addedLoad",
    allowedConventions: ["addedLoad"],
    anchorConvention: "addedLoad",
    conventionNote: "Enter the weight ADDED to your bodyweight, not the total.",
  },
  pushUp: {
    defaultConvention: "addedLoad",
    allowedConventions: ["addedLoad"],
    anchorConvention: "addedLoad",
    conventionNote: "Enter added load only (0 = bodyweight only).",
  },
  inclineDbPress: {
    defaultConvention: "perHand",
    allowedConventions: ["perHand", "total"],
    anchorConvention: "total",
    conventionNote: "Per hand = one dumbbell. Total = both combined.",
  },
  flatDbPress: {
    defaultConvention: "perHand",
    allowedConventions: ["perHand", "total"],
    anchorConvention: "total",
    conventionNote: "Per hand = one dumbbell. Total = both combined.",
  },
  dbShoulderPress: {
    defaultConvention: "perHand",
    allowedConventions: ["perHand", "total"],
    anchorConvention: "total",
    conventionNote: "Per hand = one dumbbell. Total = both combined.",
  },
  dbCurl: {
    defaultConvention: "perHand",
    allowedConventions: ["perHand", "total"],
    anchorConvention: "perHand",
    conventionNote: "Per hand = one dumbbell. Total = both combined.",
  },
  lateralRaise: {
    defaultConvention: "perHand",
    allowedConventions: ["perHand", "total"],
    anchorConvention: "perHand",
    conventionNote: "Per hand = one dumbbell. Total = both combined.",
  },
  dbRow: {
    defaultConvention: "perHand",
    allowedConventions: ["perHand", "total"],
    anchorConvention: "total",
    conventionNote: "Per hand = one dumbbell. Total = both combined.",
  },
  skullcrusher: {
    defaultConvention: "perHand",
    allowedConventions: ["perHand", "total"],
    anchorConvention: "perHand",
    conventionNote: "Per hand = one dumbbell. Total = both combined.",
  },
  tricepPushdown: {
    defaultConvention: "total",
    allowedConventions: ["total", "perHand"],
    anchorConvention: "total",
    conventionNote: "Two-arm bar = total. Single-arm handle = per hand.",
  },
  tricepPushdownSingleArm: {
    defaultConvention: "perHand",
    allowedConventions: ["perHand"],
    anchorConvention: "perHand",
    conventionNote: "Weight on the stack for ONE arm.",
  },
  cableCurl: {
    defaultConvention: "total",
    allowedConventions: ["total", "perHand"],
    anchorConvention: "total",
    conventionNote: "Two-arm bar = total. Single-arm handle = per hand.",
  },
  cableLateralRaise: {
    defaultConvention: "perHand",
    allowedConventions: ["perHand", "total"],
    anchorConvention: "perHand",
    conventionNote: "Per hand = one handle. Total = both arms combined.",
  },
  bulgarianSplit: {
    defaultConvention: "perHand",
    allowedConventions: ["perHand", "total"],
    anchorConvention: "total",
    conventionNote: "Per hand = one dumbbell. Total = both combined.",
  },
  barbellCurl: {
    defaultConvention: "total",
    allowedConventions: ["total"],
    anchorConvention: "total",
  },
  hammerCurl: {
    defaultConvention: "perHand",
    allowedConventions: ["perHand", "total"],
    anchorConvention: "perHand",
    conventionNote: "Per hand = one dumbbell. Total = both combined.",
  },
  dbFly: {
    defaultConvention: "perHand",
    allowedConventions: ["perHand", "total"],
    anchorConvention: "total",
    conventionNote: "Per hand = one dumbbell. Total = both combined.",
  },
  dbShrug: {
    defaultConvention: "perHand",
    allowedConventions: ["perHand", "total"],
    anchorConvention: "total",
    conventionNote: "Per hand = one dumbbell. Total = both combined.",
  },
};

/** Exercise name → canonical config key (subset of strength-engine aliases). */
const NAME_TO_CONFIG_KEY: Record<string, string> = {
  "bench press": "bench",
  bench: "bench",
  squat: "squat",
  "back squat": "squat",
  deadlift: "deadlift",
  "leg press": "legPress",
  "weighted pull up": "weightedPullup",
  "weighted pull-up": "weightedPullup",
  "weighted chin up": "weightedPullup",
  "pull up": "weightedPullup",
  "pull-up": "weightedPullup",
  "chin up": "weightedPullup",
  "weighted dips": "weightedDips",
  dips: "weightedDips",
  "chest dips": "weightedDips",
  "push up": "pushUp",
  "push-up": "pushUp",
  "weighted push up": "pushUp",
  "weighted push-up": "pushUp",
  "incline dumbbell press": "inclineDbPress",
  "decline dumbbell press": "inclineDbPress",
  "dumbbell bench press": "flatDbPress",
  "dumbbell shoulder press": "dbShoulderPress",
  "seated dumbbell press": "dbShoulderPress",
  "arnold press": "dbShoulderPress",
  "dumbbell curl": "dbCurl",
  "hammer curl": "hammerCurl",
  "cross body hammer curl": "hammerCurl",
  "concentration curl": "dbCurl",
  "cable lateral raise": "cableLateralRaise",
  "lateral raise": "lateralRaise",
  "front raise": "lateralRaise",
  "rear delt fly": "lateralRaise",
  "dumbbell row": "dbRow",
  "skull crusher": "skullcrusher",
  "tricep pushdown": "tricepPushdown",
  "rope pushdown": "tricepPushdown",
  "single arm pushdown": "tricepPushdownSingleArm",
  "cable curl": "cableCurl",
  "bayesian cable curl": "cableCurl",
  "bulgarian split squat": "bulgarianSplit",
  "walking lunges": "bulgarianSplit",
  lunges: "bulgarianSplit",
  "dumbbell fly": "dbFly",
  "incline dumbbell fly": "dbFly",
  "dumbbell shrug": "dbShrug",
  "barbell curl": "barbellCurl",
  "ez bar curl": "barbellCurl",
};

export function conventionToMode(convention: LoadConvention): WeightEntryMode {
  switch (convention) {
    case "perHand":
      return "per_hand";
    case "addedLoad":
      return "added";
    default:
      return "total";
  }
}

export function modeToConvention(mode: WeightEntryMode): LoadConvention {
  switch (mode) {
    case "per_hand":
      return "perHand";
    case "added":
      return "addedLoad";
    default:
      return "total";
  }
}

export function resolveConfigKey(exerciseName: string): string | null {
  const key = normalizeName(exerciseName);
  if (EXERCISE_LOAD_CONFIG[key]) return key;
  return NAME_TO_CONFIG_KEY[key] ?? null;
}

export function getExerciseLoadConfig(exerciseName: string): ExerciseConfig {
  const configKey = resolveConfigKey(exerciseName);
  if (configKey && EXERCISE_LOAD_CONFIG[configKey]) {
    return EXERCISE_LOAD_CONFIG[configKey];
  }
  return {
    defaultConvention: "total",
    allowedConventions: ["total"],
    anchorConvention: "total",
  };
}

/** Convert load between conventions before scoring. */
export function convertLoadConvention(
  weightKg: number,
  from: LoadConvention,
  to: LoadConvention
): number {
  if (from === to) return weightKg;
  if (from === "addedLoad" || to === "addedLoad") return weightKg;
  if (from === "perHand" && to === "total") return weightKg * 2;
  if (from === "total" && to === "perHand") return weightKg / 2;
  return weightKg;
}

export function defaultWeightEntryMode(exerciseName: string): WeightEntryMode {
  return conventionToMode(getExerciseLoadConfig(exerciseName).defaultConvention);
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

export function conventionLabel(convention: LoadConvention): string {
  switch (convention) {
    case "perHand":
      return "Per hand";
    case "addedLoad":
      return "Added load";
    default:
      return "Total";
  }
}

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

export function resolveScoringWeight(
  loggedWeightKg: number,
  exerciseName: string,
  mode?: WeightEntryMode | null
): ResolvedScoringWeight {
  const config = getExerciseLoadConfig(exerciseName);
  const storedConvention = mode ? modeToConvention(mode) : config.defaultConvention;
  const scoringWeightKg = convertLoadConvention(
    loggedWeightKg,
    storedConvention,
    config.anchorConvention
  );
  const key = normalizeName(exerciseName);
  const isBwRelative =
    storedConvention === "addedLoad" || BODYWEIGHT_RELATIVE_NAMES.has(key);

  return {
    scoringWeightKg,
    mode: conventionToMode(storedConvention),
    isBodyweightRelative: isBwRelative,
    convention: storedConvention,
  };
}
