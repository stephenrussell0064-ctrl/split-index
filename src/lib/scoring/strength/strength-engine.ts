import { MAX_INDEX, MIN_INDEX } from "@/lib/scoring/constants";
import type { Gender, GymExercise, Profile, ScoreBreakdown } from "@/types";
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

/** Log-curve index for any exercise from e1RM / bodyweight */
function genericExerciseIndex(
  e1RM: number,
  bw: number,
  kind: "compound" | "accessory" = "compound"
): number {
  if (e1RM <= 0 || bw <= 0) return MIN_INDEX;
  const ratio = (e1RM / bw) * (kind === "accessory" ? 2 : 1);
  if (ratio <= 0.05) return MIN_INDEX;
  return Math.min(MAX_INDEX, Math.max(MIN_INDEX, Math.round(380 * Math.log(ratio) + 500)));
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
  exercises: Pick<
    GymExercise,
    "exercise_name" | "muscle_group" | "weight_kg" | "sets" | "reps" | "rpe"
  >[];
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
    const sets = Array.from({ length: ex.sets }, () => ({
      weightKg: ex.weight_kg,
      reps: ex.reps,
    }));
    const e1RM = bestSet1RM(sets);
    const volume = ex.sets * ex.reps * ex.weight_kg;

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
    const kind = SBD_MAP[normalized] ? "compound" : "accessory";
    const liftIndex = acc
      ? ratioToTierIndex(
          acc.relativeStrength,
          ACCESSORY_MAP[normalized] ?? "ohp",
          sex
        )
      : genericExerciseIndex(lift.e1RM, bw, kind);
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
