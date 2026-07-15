import type { GymExerciseInput, SessionType, SportType, Gender, ExperienceLevel, ScoreBreakdown } from "@/types";
import {
  scoreCardioActivity,
  type CardioResult,
} from "@/lib/scoring/cardio-activity";
import {
  scoreStrength,
  labIndex,
  normalizeName as normalizeExerciseName,
  type ScoreStrengthResult,
  type LoggedSet,
  type Sex,
} from "@/lib/scoring/split-strength-engine";
import {
  resolveScoringWeight,
  type WeightEntryMode,
} from "@/lib/scoring/weight-entry";
import { requireScoringSex } from "@/lib/scoring/adapters";
import {
  computeIndexes,
  type IndexResult,
} from "@/lib/scoring/index-engine";
import {
  buildActivityScores,
  buildCardioInput,
  deriveAthleteProfile,
  labWeightFromProfile,
} from "@/lib/scoring/adapters";
import {
  calculateACWR,
  calculateFatigueScore,
  calculateRecoveryScore,
  isEnduranceSport,
} from "@/lib/scoring/engine";
import { calculateStrengthIndexV2 } from "@/lib/scoring/strength";
import { INDEX_ANCHOR } from "@/lib/scoring/constants";
import { bestSet, totalVolumeKg } from "@/lib/activities/gym-sets";

export interface ActivityScoreContext {
  sport: SportType;
  durationSeconds: number;
  distanceMeters?: number | null;
  avgHeartRate?: number | null;
  sessionType?: SessionType | null;
  rpe?: number | null;
  elevationMeters?: number | null;
  temperatureCelsius?: number | null;
  /** Multi-session memory (seconds at the sport's benchmark distance), already blended by the caller — see cardio-predictions.ts. */
  storedPredictionSeconds?: number | null;
  exercises?: GymExerciseInput[];
  /** Full logged history per exercise (across all past sessions), keyed by normalized exercise name — powers the premium adaptive 1RM model. */
  exerciseHistory?: Record<string, LoggedSet[]>;
  /** Per-exercise weight entry mode from the logging form (per hand / added / total). */
  exerciseWeightModes?: Record<string, WeightEntryMode>;
  isPremium?: boolean;
  profile: {
    max_hr?: number | null;
    resting_hr?: number | null;
    weight_kg?: number | null;
    age?: number | null;
    gender?: Gender | null;
    experience?: ExperienceLevel | null;
    preferred_sports?: SportType[];
    split_endurance_weight?: number;
  };
  recentLoads: { acute: number; chronic: number };
  useGL?: boolean;
  splitPacesSec?: number[];
  startedAt?: string;
}

export interface ActivityScoreOutput {
  sportIndex: number;
  enduranceComponent: number | null;
  strengthComponent: number | null;
  loadScore: number;
  breakdown: ScoreBreakdown;
  splitIndex: number;
  splitBreakdownLabel: string;
  enduranceIndex: number;
  strengthIndex: number;
  fatigueScore: number;
  recoveryScore: number;
  predictedIndex: number;
  activityConfidence: number;
  indexResult: IndexResult;
  cardioActivity?: CardioResult;
  strengthActivities?: ScoreStrengthResult[];
  dotsScore?: number;
  glPoints?: number;
  useGL?: boolean;
  exerciseScores?: Array<{
    name: string;
    muscleGroup: string;
    estimated1RM: number;
    relativeStrength: number;
    tier?: string;
    tierLabel?: string;
  }>;
  strengthScoreRows?: Array<{
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

function splitHalvesFromPaces(splitPacesSec?: number[]) {
  if (!splitPacesSec || splitPacesSec.length < 4) {
    return { firstHalfPaceSecPerKm: null, secondHalfPaceSecPerKm: null };
  }
  const mid = Math.floor(splitPacesSec.length / 2);
  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
  return {
    firstHalfPaceSecPerKm: avg(splitPacesSec.slice(0, mid)),
    secondHalfPaceSecPerKm: avg(splitPacesSec.slice(mid)),
  };
}

function scoreGymSession(
  input: ActivityScoreContext,
  bodyweight: number
): Pick<
  ActivityScoreOutput,
  | "sportIndex"
  | "strengthComponent"
  | "loadScore"
  | "cardioActivity"
  | "strengthActivities"
  | "dotsScore"
  | "glPoints"
  | "useGL"
  | "exerciseScores"
  | "strengthScoreRows"
  | "activityConfidence"
  | "breakdown"
> {
  // DOTS/GL and the SBD-total are a separate, still-useful powerlifting-total
  // metric (only meaningful when squat+bench+deadlift are all logged in one
  // session) — kept for that display, no longer used for per-exercise scoring.
  const legacy = calculateStrengthIndexV2({
    exercises: input.exercises ?? [],
    bodyweightKg: bodyweight,
    gender: input.profile.gender ?? null,
    options: { useGL: input.useGL ?? false },
  });

  const sex = requireScoringSex(input.profile.gender);
  const isPremium = input.isPremium ?? false;
  const results: ScoreStrengthResult[] = [];
  const strengthScoreRows: NonNullable<ActivityScoreOutput["strengthScoreRows"]> = [];

  for (const ex of input.exercises ?? []) {
    const top = bestSet(ex.sets);
    if (!top) continue;
    const volume = totalVolumeKg(ex.sets);
    const history = input.exerciseHistory?.[normalizeExerciseName(ex.exercise_name)] ?? [];
    const weightMode =
      ex.weight_entry_mode ??
      input.exerciseWeightModes?.[normalizeExerciseName(ex.exercise_name)];
    const resolved = resolveScoringWeight(top.weight_kg, ex.exercise_name, weightMode);

    const result = scoreStrength({
      liftKey: ex.exercise_name,
      history,
      latestSet: {
        weightKg: resolved.scoringWeightKg,
        reps: top.reps,
        repsInReserve: top.reps_in_reserve ?? null,
      },
      bodyweightKg: bodyweight,
      sex,
      age: input.profile.age ?? null,
      isPremium,
      isBodyweightRelative: resolved.isBodyweightRelative,
      weightEntryMode: resolved.mode,
      exerciseName: ex.exercise_name,
    });
    results.push(result);

    strengthScoreRows.push({
      exercise_name: ex.exercise_name,
      muscle_group: ex.muscle_group,
      estimated_1rm_kg: result.oneRM,
      bodyweight_kg: bodyweight,
      relative_strength: result.bodyweightRatio,
      volume_load_kg: volume,
      strength_index: result.score,
      score_breakdown: { strength_result: result },
    });
  }

  const sportIndex = results.length > 0 ? labIndex(results) : legacy.index;
  const activityConfidence =
    results.length > 0
      ? results.reduce((sum, r) => sum + r.oneRMConfidence, 0) / results.length
      : 1;

  return {
    sportIndex,
    strengthComponent: sportIndex,
    loadScore: legacy.loadScore,
    strengthActivities: results,
    dotsScore: legacy.dotsScore,
    glPoints: legacy.glPoints,
    useGL: legacy.useGL,
    exerciseScores: results.map((r) => ({
      name: r.liftKey,
      muscleGroup: (input.exercises ?? []).find((e) => e.exercise_name === r.liftKey)?.muscle_group ?? "",
      estimated1RM: r.oneRM,
      relativeStrength: r.bodyweightRatio,
      tier: r.tier,
      tierLabel: r.tier,
    })),
    strengthScoreRows,
    activityConfidence,
    breakdown: {
      ...legacy.breakdown,
      strength_activities: results,
    },
  };
}

function scoreEnduranceSession(
  input: ActivityScoreContext
): Pick<
  ActivityScoreOutput,
  | "sportIndex"
  | "enduranceComponent"
  | "loadScore"
  | "cardioActivity"
  | "activityConfidence"
  | "breakdown"
> {
  const paceHalves = splitHalvesFromPaces(input.splitPacesSec);
  const cardioInput = buildCardioInput({
    sport: input.sport,
    durationSeconds: input.durationSeconds,
    distanceMeters: input.distanceMeters,
    avgHeartRate: input.avgHeartRate,
    maxHr: input.profile.max_hr,
    restingHr: input.profile.resting_hr,
    age: input.profile.age,
    gender: input.profile.gender,
    experience: input.profile.experience,
    sessionType: input.sessionType,
    rpe: input.rpe,
    elevationMeters: input.elevationMeters,
    temperatureCelsius: input.temperatureCelsius,
    storedPredictionSeconds: input.storedPredictionSeconds,
    ...paceHalves,
  });

  const cardioActivity = scoreCardioActivity(cardioInput);
  const loadScore = cardioActivity.trimp
    ? Math.round(cardioActivity.trimp)
    : Math.max(1, Math.round(input.durationSeconds / 60));

  return {
    sportIndex: cardioActivity.score,
    enduranceComponent: cardioActivity.score,
    loadScore,
    cardioActivity,
    activityConfidence: cardioActivity.confidence,
    breakdown: {
      explanation: cardioActivity.flags.map((f) => f.replace(/-/g, " ")),
      cardio_activity: cardioActivity,
    },
  };
}

export function scoreActivityWithEngines(
  input: ActivityScoreContext,
  recentActivityRows: Array<{
    sport: string;
    sport_index: number;
    started_at: string;
    score_breakdown?: Record<string, unknown> | null;
  }>,
  _splitHistory: number[]
): ActivityScoreOutput {
  const bodyweight = input.profile.weight_kg ?? 75;
  const { acute, chronic } = input.recentLoads;
  const acwr = calculateACWR(acute, chronic);
  const fatigueScore = calculateFatigueScore(acwr, acute);
  const recoveryScore = calculateRecoveryScore(fatigueScore, acwr, 1);

  const athleteProfile = deriveAthleteProfile(input.profile.preferred_sports ?? []);
  const weightLab = labWeightFromProfile(input.profile.split_endurance_weight ?? 0.5);

  let partial: Partial<ActivityScoreOutput> = {};

  if (input.sport === "gym") {
    partial = scoreGymSession(input, bodyweight);
  } else if (isEnduranceSport(input.sport)) {
    partial = scoreEnduranceSession(input);
  } else {
    throw new Error(`Unsupported sport: ${input.sport}`);
  }

  const currentRow = {
    sport: input.sport,
    sport_index: partial.sportIndex!,
    started_at: input.startedAt ?? new Date().toISOString(),
    score_breakdown: (partial.breakdown ?? null) as Record<string, unknown> | null,
  };

  const activityScores = buildActivityScores([currentRow, ...recentActivityRows]);
  const indexResult = computeIndexes(activityScores, athleteProfile, weightLab);

  const enduranceIndex = indexResult.engineIndex ?? INDEX_ANCHOR;
  const strengthIndex = indexResult.labIndex ?? INDEX_ANCHOR;
  const splitIndex = indexResult.splitIndex ?? indexResult.headline;

  const endPct = Math.round((1 - weightLab) * 100);
  const strPct = 100 - endPct;

  return {
    sportIndex: partial.sportIndex!,
    enduranceComponent: partial.enduranceComponent ?? null,
    strengthComponent: partial.strengthComponent ?? null,
    loadScore: partial.loadScore!,
    breakdown: {
      ...(partial.breakdown ?? { explanation: [] }),
      index_result: indexResult,
    },
    splitIndex,
    splitBreakdownLabel: `${Math.round(enduranceIndex)} cardio + ${Math.round(strengthIndex)} strength (${endPct}/${strPct})`,
    enduranceIndex,
    strengthIndex,
    fatigueScore,
    recoveryScore,
    predictedIndex: splitIndex,
    activityConfidence: partial.activityConfidence ?? 1,
    indexResult,
    cardioActivity: partial.cardioActivity,
    strengthActivities: partial.strengthActivities,
    dotsScore: partial.dotsScore,
    glPoints: partial.glPoints,
    useGL: partial.useGL,
    exerciseScores: partial.exerciseScores,
    strengthScoreRows: partial.strengthScoreRows,
  };
}

export { buildActivityScores, deriveAthleteProfile, labWeightFromProfile };
