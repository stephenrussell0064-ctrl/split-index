import { MAX_INDEX, MIN_INDEX } from "@/lib/scoring/constants";
import type { Gender, GymExerciseInput, Profile, ScoreBreakdown } from "@/types";
import { COMMON_EXERCISES } from "@/lib/constants/sports";
import { totalVolumeKg } from "@/lib/activities/gym-sets";
import type { GLEquipment, StrengthSex } from "./coefficients";
import { calculateDOTS } from "./dots";
import { calculateGLPoints } from "./gl";
import { dotsToStrengthIndex, glToStrengthIndex } from "./mapping";
import { bestSet1RM } from "./one-rm";
import {
  classifyRatioTier,
  EXRX_TIER_LABELS,
  pullUpRatio,
  ratioToTierIndex,
  type AccessoryLift,
  type ExRxTier,
} from "./ratio-tiers";

/**
 * Per-(muscle-category, compound/accessory) difficulty coefficients, applied
 * to the raw estimated-1RM / bodyweight ratio before the log-curve index.
 * These replace a flat "×2 for anything not squat/bench/deadlift" multiplier,
 * which scored a lateral raise and a pec deck identically even though a
 * shoulder-isolation movement can never approach the load a supported chest
 * press machine allows. Coefficients are hand-calibrated approximations
 * (there's no public percentile database per exercise), not lab-derived —
 * the goal is "meaningfully more accurate," not perfect.
 */
const CATEGORY_KIND_COEFFICIENTS: Record<string, number> = {
  "chest:compound": 1.0,
  "chest:accessory": 1.8,
  "back:compound": 1.0,
  "back:accessory": 2.2,
  "legs:compound": 1.0,
  "legs:accessory": 2.0,
  "shoulders:compound": 1.0,
  "shoulders:accessory": 3.5,
  "arms:compound": 1.0,
  "arms:accessory": 3.0,
  "core:compound": 1.6,
  "core:accessory": 2.5,
};

/**
 * Overrides for specific exercises whose category/kind alone doesn't capture
 * how much a machine leverages the lift — e.g. leg press lets you move far
 * more absolute weight than a free squat for the same underlying leg
 * strength, so it needs a *lower* coefficient (deflating an already-inflated
 * raw ratio), the opposite direction from a true isolation accessory.
 */
const EXERCISE_COEFFICIENT_OVERRIDES: Record<string, number> = {
  "leg press": 0.55,
  "single leg press": 0.6,
  "hack squat": 0.6,
  "pendulum squat": 0.6,
  "smith machine squat": 0.75,
  "smith machine bench press": 0.85,
  "machine chest press": 0.85,
  "machine shoulder press": 0.85,
  "machine row": 0.85,
  "machine lateral raise": 3.2,
  "machine preacher curl": 2.8,
};

const DEFAULT_EXERCISE_COEFFICIENT = 2.0; // unrecognized/custom exercise fallback

function exerciseDifficultyCoefficient(name: string): number {
  const key = normalizeName(name);
  if (EXERCISE_COEFFICIENT_OVERRIDES[key] != null) {
    return EXERCISE_COEFFICIENT_OVERRIDES[key];
  }
  const known = COMMON_EXERCISES.find((ex) => normalizeName(ex.name) === key);
  if (!known) return DEFAULT_EXERCISE_COEFFICIENT;
  return (
    CATEGORY_KIND_COEFFICIENTS[`${known.category}:${known.kind}`] ??
    DEFAULT_EXERCISE_COEFFICIENT
  );
}

/** Index is at or above this only for a genuinely exceptional (elite/record-approaching) ratio. */
const NEAR_RECORD_INDEX_THRESHOLD = 950;

export type SBDLift = "squat" | "bench" | "deadlift";

const SBD_MAP: Record<string, SBDLift> = {
  squat: "squat",
  "back squat": "squat",
  "front squat": "squat",
  "safety bar squat": "squat",
  "pause squat": "squat",
  "zercher squat": "squat",
  "goblet squat": "squat",
  "hack squat": "squat",
  "leg press": "squat",
  "bench press": "bench",
  bench: "bench",
  "incline bench press": "bench",
  "close grip bench press": "bench",
  "floor press": "bench",
  "spoto press": "bench",
  "dumbbell bench press": "bench",
  deadlift: "deadlift",
  "sumo deadlift": "deadlift",
  "conventional deadlift": "deadlift",
  "romanian deadlift": "deadlift",
  "trap bar deadlift": "deadlift",
  "deficit deadlift": "deadlift",
  "block pull": "deadlift",
  "rack pull": "deadlift",
};

const ACCESSORY_MAP: Record<string, AccessoryLift> = {
  "overhead press": "ohp",
  ohp: "ohp",
  "military press": "ohp",
  "strict press": "ohp",
  "shoulder press": "ohp",
  "dumbbell shoulder press": "ohp",
  "arnold press": "ohp",
  "push press": "ohp",
  "pull up": "pullup",
  "pull-up": "pullup",
  pullup: "pullup",
  "weighted pull up": "pullup",
  "weighted pull-up": "pullup",
  "chin up": "pullup",
  "chin-up": "pullup",
  "weighted chin up": "pullup",
  "lat pulldown": "pullup",
};

/** Log-curve index for any exercise from e1RM / bodyweight, using a per-exercise difficulty coefficient. */
function genericExerciseIndex(
  e1RM: number,
  bw: number,
  exerciseName: string
): { index: number; nearRecord: boolean } {
  if (e1RM <= 0 || bw <= 0) return { index: MIN_INDEX, nearRecord: false };
  const ratio = (e1RM / bw) * exerciseDifficultyCoefficient(exerciseName);
  if (ratio <= 0.05) return { index: MIN_INDEX, nearRecord: false };
  const index = Math.min(MAX_INDEX, Math.max(MIN_INDEX, Math.round(380 * Math.log(ratio) + 500)));
  return { index, nearRecord: index >= NEAR_RECORD_INDEX_THRESHOLD };
}

const SBD_BLEND_WEIGHT = 0.85;
const ACCESSORY_BLEND_WEIGHT = 0.15;

export interface LiftBreakdown {
  name: string;
  muscleGroup: string;
  estimated1RM: number;
  relativeStrength: number;
  tier?: ExRxTier;
  tierLabel?: string;
}

export interface StrengthEngineInput {
  exercises: GymExerciseInput[];
  bodyweightKg: number;
  gender: Gender | null;
  options?: {
    useGL?: boolean;
    equipment?: GLEquipment;
  };
}

export interface StrengthEngineResult {
  index: number;
  dotsScore: number;
  glPoints: number;
  useGL: boolean;
  sbdTotalKg: number;
  loadScore: number;
  exerciseScores: LiftBreakdown[];
  perLift: Record<
    SBDLift,
    { estimated1RM: number; relativeStrength: number } | undefined
  >;
  breakdown: ScoreBreakdown;
  strengthScoreRows: Array<{
    exercise_name: string;
    muscle_group: string | null;
    estimated_1rm_kg: number;
    bodyweight_kg: number;
    relative_strength: number;
    volume_load_kg: number;
    strength_index: number;
    score_breakdown: Record<string, unknown>;
  }>;
}

function resolveStrengthSex(gender: Gender | null): StrengthSex {
  return gender === "female" ? "female" : "male";
}

function normalizeName(name: string): string {
  return name.toLowerCase().trim();
}

function collectBest1RMs(
  exercises: StrengthEngineInput["exercises"]
): {
  sbd: Record<SBDLift, number>;
  accessories: Array<{ lift: AccessoryLift; name: string; e1RM: number; muscleGroup: string }>;
  allLifts: Array<{
    name: string;
    muscleGroup: string;
    e1RM: number;
    volume: number;
  }>;
} {
  const sbdSets: Record<SBDLift, Array<{ weightKg: number; reps: number }>> = {
    squat: [],
    bench: [],
    deadlift: [],
  };
  const accessories: Array<{
    lift: AccessoryLift;
    name: string;
    e1RM: number;
    muscleGroup: string;
  }> = [];
  const allLifts: Array<{
    name: string;
    muscleGroup: string;
    e1RM: number;
    volume: number;
  }> = [];

  for (const ex of exercises) {
    const key = normalizeName(ex.exercise_name);
    const sets = ex.sets.map((s) => ({ weightKg: s.weight_kg, reps: s.reps }));
    const e1RM = bestSet1RM(sets);
    const volume = totalVolumeKg(ex.sets);

    allLifts.push({
      name: ex.exercise_name,
      muscleGroup: ex.muscle_group,
      e1RM,
      volume,
    });

    const sbdKey = SBD_MAP[key];
    if (sbdKey) {
      sbdSets[sbdKey].push(...sets);
      continue;
    }

    const accKey = ACCESSORY_MAP[key];
    if (accKey) {
      accessories.push({
        lift: accKey,
        name: ex.exercise_name,
        e1RM,
        muscleGroup: ex.muscle_group,
      });
    }
  }

  const sbd: Record<SBDLift, number> = {
    squat: bestSet1RM(sbdSets.squat),
    bench: bestSet1RM(sbdSets.bench),
    deadlift: bestSet1RM(sbdSets.deadlift),
  };

  return { sbd, accessories, allLifts };
}

export function calculateStrengthIndexV2(
  input: StrengthEngineInput
): StrengthEngineResult {
  const explanation: string[] = [];
  const sex = resolveStrengthSex(input.gender);
  const useGL = input.options?.useGL ?? false;
  const equipment = input.options?.equipment ?? "classic";
  const bw = input.bodyweightKg;

  if (input.exercises.length === 0 || bw <= 0) {
    return emptyResult(explanation);
  }

  const { sbd, accessories, allLifts } = collectBest1RMs(input.exercises);
  const loggedSbd = (["squat", "bench", "deadlift"] as SBDLift[]).filter(
    (l) => sbd[l] > 0
  );

  const sbdTotalKg = loggedSbd.reduce((sum, l) => sum + sbd[l], 0);
  explanation.push(
    `SBD total: ${sbdTotalKg.toFixed(1)} kg (${loggedSbd.join(", ") || "none logged"})`
  );

  let coreIndex = MIN_INDEX;
  let dotsScore = 0;
  let glPoints = 0;

  if (sbdTotalKg > 0) {
    dotsScore = calculateDOTS(sbdTotalKg, bw, sex);
    glPoints = calculateGLPoints(sbdTotalKg, bw, sex, equipment);
    const rawScore = useGL ? glPoints : dotsScore;
    coreIndex = useGL
      ? glToStrengthIndex(glPoints)
      : dotsToStrengthIndex(dotsScore);
    explanation.push(
      `${useGL ? "IPF GL" : "DOTS"}: ${rawScore.toFixed(1)} → strength index ${coreIndex}`
    );
  } else {
    explanation.push("No SBD lifts logged — using accessory tiers only");
  }

  let accessoryIndex: number | null = null;
  const accessoryBreakdowns: LiftBreakdown[] = [];

  for (const acc of accessories) {
    let ratio: number;
    if (acc.lift === "pullup") {
      ratio = pullUpRatio(acc.e1RM, bw);
    } else {
      ratio = acc.e1RM / bw;
    }
    const tier = classifyRatioTier(ratio, acc.lift, sex);
    const tierIdx = ratioToTierIndex(ratio, acc.lift, sex);
    accessoryBreakdowns.push({
      name: acc.name,
      muscleGroup: acc.muscleGroup,
      estimated1RM: Math.round(acc.e1RM * 10) / 10,
      relativeStrength: Math.round(ratio * 100) / 100,
      tier,
      tierLabel: EXRX_TIER_LABELS[tier],
    });
    explanation.push(
      `${acc.name}: ${ratio.toFixed(2)}× BW → ${EXRX_TIER_LABELS[tier]} (index ${tierIdx})`
    );
    accessoryIndex =
      accessoryIndex === null
        ? tierIdx
        : Math.round((accessoryIndex + tierIdx) / 2);
  }

  // Fold in exercises that are neither SBD lifts nor OHP/pull-up-tier
  // accessories (lateral raises, pec deck, curls, leg extensions, ...) —
  // previously these only affected their own per-exercise row and were
  // dropped from the overall index entirely, so a session made up solely of
  // this kind of exercise scored ~1 overall despite real lifts being logged.
  const accessoryNames = new Set(accessories.map((a) => a.name));
  for (const lift of allLifts) {
    if (accessoryNames.has(lift.name) || SBD_MAP[normalizeName(lift.name)]) continue;
    const generic = genericExerciseIndex(lift.e1RM, bw, lift.name);
    if (generic.index <= MIN_INDEX) continue;
    accessoryIndex =
      accessoryIndex === null
        ? generic.index
        : Math.round((accessoryIndex + generic.index) / 2);
  }

  let index: number;
  if (sbdTotalKg > 0 && accessoryIndex !== null) {
    index = Math.round(
      coreIndex * SBD_BLEND_WEIGHT + accessoryIndex * ACCESSORY_BLEND_WEIGHT
    );
    explanation.push(
      `Blended: ${Math.round(SBD_BLEND_WEIGHT * 100)}% DOTS/GL + ${Math.round(ACCESSORY_BLEND_WEIGHT * 100)}% accessory tiers → ${index}`
    );
  } else if (sbdTotalKg > 0) {
    index = coreIndex;
  } else if (accessoryIndex !== null) {
    index = accessoryIndex;
  } else {
    index = MIN_INDEX;
    explanation.push("No scorable lifts found");
  }

  index = Math.min(MAX_INDEX, Math.max(MIN_INDEX, index));

  const perLift: StrengthEngineResult["perLift"] = {
    squat: sbd.squat > 0 ? { estimated1RM: sbd.squat, relativeStrength: sbd.squat / bw } : undefined,
    bench: sbd.bench > 0 ? { estimated1RM: sbd.bench, relativeStrength: sbd.bench / bw } : undefined,
    deadlift: sbd.deadlift > 0 ? { estimated1RM: sbd.deadlift, relativeStrength: sbd.deadlift / bw } : undefined,
  };

  const exerciseScores: LiftBreakdown[] = [
    ...(["squat", "bench", "deadlift"] as SBDLift[])
      .filter((l) => perLift[l])
      .map((l) => ({
        name: l.charAt(0).toUpperCase() + l.slice(1),
        muscleGroup: l === "bench" ? "chest" : l === "squat" ? "legs" : "back",
        estimated1RM: Math.round(perLift[l]!.estimated1RM * 10) / 10,
        relativeStrength: Math.round(perLift[l]!.relativeStrength * 100) / 100,
      })),
    ...accessoryBreakdowns,
  ];

  const totalVolume = allLifts.reduce((s, l) => s + l.volume, 0);
  const loadScore = Math.round((totalVolume / 800) * 10) / 10;

  const strengthScoreRows = allLifts.map((lift) => {
    const rel = lift.e1RM / bw;
    const acc = accessoryBreakdowns.find((a) => a.name === lift.name);
    const normalized = normalizeName(lift.name);
    const generic = genericExerciseIndex(lift.e1RM, bw, lift.name);
    const liftIndex = acc
      ? ratioToTierIndex(
          acc.relativeStrength,
          ACCESSORY_MAP[normalized] ?? "ohp",
          sex
        )
      : generic.index;
    const nearRecord = !acc && generic.nearRecord;
    return {
      exercise_name: lift.name,
      muscle_group: lift.muscleGroup,
      estimated_1rm_kg: Math.round(lift.e1RM * 100) / 100,
      bodyweight_kg: bw,
      relative_strength: Math.round(rel * 100) / 100,
      volume_load_kg: lift.volume,
      strength_index: liftIndex,
      score_breakdown: {
        tier: acc?.tier,
        tier_label: acc?.tierLabel,
        dots_score: dotsScore,
        gl_points: glPoints,
        near_record: nearRecord,
        ...(nearRecord
          ? {
              near_record_note: `Exceptional result for ${lift.name} — this score is approaching elite/record-level territory relative to bodyweight. If this seems too high, double-check the entered weight and reps.`,
            }
          : {}),
      },
    };
  });

  return {
    index,
    dotsScore,
    glPoints,
    useGL,
    sbdTotalKg,
    loadScore,
    exerciseScores,
    perLift,
    strengthScoreRows,
    breakdown: {
      base_score: coreIndex,
      relative_strength: sbdTotalKg / bw,
      volume_load: totalVolume,
      final_sport_index: index,
      dots_score: Math.round(dotsScore * 10) / 10,
      gl_points: Math.round(glPoints * 10) / 10,
      use_gl: useGL,
      strength_total_kg: sbdTotalKg,
      per_lift: perLift,
      explanation,
    },
  };
}

function emptyResult(explanation: string[]): StrengthEngineResult {
  explanation.push("No exercises logged");
  return {
    index: MIN_INDEX,
    dotsScore: 0,
    glPoints: 0,
    useGL: false,
    sbdTotalKg: 0,
    loadScore: 0,
    exerciseScores: [],
    perLift: { squat: undefined, bench: undefined, deadlift: undefined },
    strengthScoreRows: [],
    breakdown: {
      base_score: 0,
      final_sport_index: MIN_INDEX,
      explanation,
    },
  };
}

export type { Profile };
