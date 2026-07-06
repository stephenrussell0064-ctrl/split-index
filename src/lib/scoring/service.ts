import type { Profile, SessionType, SportType } from "@/types";
import {
  calculateEnduranceIndex,
  calculateFatigueScore,
  calculateRecoveryScore,
  predictIndex,
  estimate1RM,
  isEnduranceSport,
  recencyWeightedBlend,
  calculateACWR,
} from "@/lib/scoring/engine";
import { calculateCompositeSplitIndex } from "@/lib/scoring/composite";
import { calculateStrengthIndexV2 } from "@/lib/scoring/strength";
import { INDEX_ANCHOR } from "@/lib/scoring/constants";

interface ScoreActivityInput {
  sport: SportType;
  durationSeconds: number;
  distanceMeters?: number | null;
  elevationMeters?: number | null;
  avgHeartRate?: number | null;
  avgPowerWatts?: number | null;
  avgPaceSecondsPerKm?: number | null;
  avgSplitSeconds?: number | null;
  temperatureCelsius?: number | null;
  sessionType?: SessionType | null;
  exercises?: Array<{
    exercise_name: string;
    muscle_group: string;
    weight_kg: number;
    sets: number;
    reps: number;
    rpe?: number | null;
  }>;
  profile: Pick<
    Profile,
    | "max_hr"
    | "weight_kg"
    | "experience"
    | "gender"
    | "training_history_years"
    | "split_endurance_weight"
  >;
  recentLoads: { acute: number; chronic: number };
  useGL?: boolean;
}

export interface ScoreResult {
  sportIndex: number;
  enduranceComponent: number | null;
  strengthComponent: number | null;
  loadScore: number;
  breakdown: import("@/types").ScoreBreakdown;
  splitIndex: number;
  splitBreakdownLabel: string;
  enduranceIndex: number;
  strengthIndex: number;
  fatigueScore: number;
  recoveryScore: number;
  predictedIndex: number;
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

function splitWeightsFromProfile(
  profile: ScoreActivityInput["profile"]
): { enduranceWeight: number; strengthWeight: number } {
  const enduranceWeight =
    typeof profile.split_endurance_weight === "number"
      ? profile.split_endurance_weight
      : 0.5;
  return {
    enduranceWeight,
    strengthWeight: 1 - enduranceWeight,
  };
}

export function scoreActivity(
  input: ScoreActivityInput,
  history: {
    enduranceIndices: number[];
    strengthIndices: number[];
    splitIndices: number[];
  }
): ScoreResult {
  const { acute, chronic } = input.recentLoads;
  const bodyweight = input.profile.weight_kg ?? 75;
  const acwr = calculateACWR(acute, chronic);
  const fatigueScore = calculateFatigueScore(acwr, acute);
  const recoveryScore = calculateRecoveryScore(fatigueScore, acwr, 1);
  const weights = splitWeightsFromProfile(input.profile);

  if (input.sport === "gym") {
    const result = calculateStrengthIndexV2({
      exercises: (input.exercises ?? []).map((ex) => ({
        ...ex,
        rpe: ex.rpe ?? null,
      })),
      bodyweightKg: bodyweight,
      gender: input.profile.gender,
      options: { useGL: input.useGL ?? false },
    });

    const strengthIndex = recencyWeightedBlend(
      result.index,
      history.strengthIndices
    );
    const enduranceIndex =
      history.enduranceIndices.length > 0
        ? recencyWeightedBlend(
            history.enduranceIndices[0],
            history.enduranceIndices.slice(1)
          )
        : INDEX_ANCHOR;

    const composite = calculateCompositeSplitIndex({
      enduranceIndex,
      strengthIndex,
      ...weights,
    });

    return {
      sportIndex: result.index,
      enduranceComponent: null,
      strengthComponent: result.index,
      loadScore: result.loadScore,
      breakdown: result.breakdown,
      splitIndex: composite.splitIndex,
      splitBreakdownLabel: composite.breakdownLabel,
      enduranceIndex,
      strengthIndex,
      fatigueScore,
      recoveryScore,
      predictedIndex: predictIndex([...history.splitIndices, composite.splitIndex]),
      dotsScore: result.dotsScore,
      glPoints: result.glPoints,
      useGL: result.useGL,
      exerciseScores: result.exerciseScores,
      strengthScoreRows: result.strengthScoreRows,
    };
  }

  if (isEnduranceSport(input.sport)) {
    const result = calculateEnduranceIndex({
      sport: input.sport,
      durationSeconds: input.durationSeconds,
      distanceMeters: input.distanceMeters ?? null,
      elevationMeters: input.elevationMeters ?? null,
      avgHeartRate: input.avgHeartRate ?? null,
      avgPowerWatts: input.avgPowerWatts ?? null,
      avgPaceSecondsPerKm: input.avgPaceSecondsPerKm ?? null,
      avgSplitSeconds: input.avgSplitSeconds ?? null,
      temperatureCelsius: input.temperatureCelsius ?? null,
      sessionType: input.sessionType ?? null,
      profile: input.profile,
      acuteLoad: acute,
      chronicLoad: chronic,
    });

    const enduranceIndex = recencyWeightedBlend(
      result.index,
      history.enduranceIndices
    );
    const strengthIndex =
      history.strengthIndices.length > 0
        ? recencyWeightedBlend(
            history.strengthIndices[0],
            history.strengthIndices.slice(1)
          )
        : INDEX_ANCHOR;

    const composite = calculateCompositeSplitIndex({
      enduranceIndex,
      strengthIndex,
      ...weights,
    });

    return {
      sportIndex: result.index,
      enduranceComponent: result.index,
      strengthComponent: null,
      loadScore: result.loadScore,
      breakdown: result.breakdown,
      splitIndex: composite.splitIndex,
      splitBreakdownLabel: composite.breakdownLabel,
      enduranceIndex,
      strengthIndex,
      fatigueScore,
      recoveryScore,
      predictedIndex: predictIndex([...history.splitIndices, composite.splitIndex]),
    };
  }

  throw new Error(`Unsupported sport: ${input.sport}`);
}

export function computeExercise1RM(
  weightKg: number,
  reps: number
): number {
  return Math.round(estimate1RM(weightKg, reps) * 10) / 10;
}

export function calculateTrend(
  current: number,
  previous: number
): number {
  return Math.round((current - previous) * 10) / 10;
}

export function computeRecentLoads(
  loadScores: { load_score: number; created_at: string }[]
): { acute: number; chronic: number } {
  const now = Date.now();
  const day = 86400000;

  const acute = loadScores
    .filter((s) => now - new Date(s.created_at).getTime() <= 7 * day)
    .reduce((sum, s) => sum + s.load_score, 0);

  const chronic =
    loadScores
      .filter((s) => now - new Date(s.created_at).getTime() <= 28 * day)
      .reduce((sum, s) => sum + s.load_score, 0) / 4;

  return { acute, chronic: chronic || 1 };
}

/** Persist per-exercise strength_scores rows for a gym activity. */
export function buildStrengthScoreInserts(
  userId: string,
  activityId: string,
  recordedAt: string,
  rows: NonNullable<ScoreResult["strengthScoreRows"]>
): Array<{
  user_id: string;
  activity_id: string;
  exercise_name: string;
  muscle_group: string | null;
  estimated_1rm_kg: number;
  bodyweight_kg: number;
  relative_strength: number;
  volume_load_kg: number;
  strength_index: number;
  score_breakdown: Record<string, unknown>;
  recorded_at: string;
}> {
  return rows.map((row) => ({
    user_id: userId,
    activity_id: activityId,
    exercise_name: row.exercise_name,
    muscle_group: row.muscle_group,
    estimated_1rm_kg: row.estimated_1rm_kg,
    bodyweight_kg: row.bodyweight_kg,
    relative_strength: row.relative_strength,
    volume_load_kg: row.volume_load_kg,
    strength_index: row.strength_index,
    score_breakdown: row.score_breakdown,
    recorded_at: recordedAt,
  }));
}
