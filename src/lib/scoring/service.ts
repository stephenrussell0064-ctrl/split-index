import type { Profile, SessionType, SportType } from "@/types";
import { predictIndex } from "@/lib/scoring/engine";
import { scoreActivityWithEngines } from "@/lib/scoring/activity-scorer";
import { estimate1RM } from "@/lib/scoring/engine";
import type { IndexResult } from "@/lib/scoring/index-engine";
import { assertScoringInput } from "@/lib/scoring/input-guards";

export { ScoringInputError } from "@/lib/scoring/input-guards";

interface ScoreActivityInput {
  sport: SportType;
  durationSeconds: number;
  distanceMeters?: number | null;
  elevationMeters?: number | null;
  avgHeartRate?: number | null;
  maxHeartRate?: number | null;
  avgPowerWatts?: number | null;
  avgPaceSecondsPerKm?: number | null;
  avgSplitSeconds?: number | null;
  temperatureCelsius?: number | null;
  sessionType?: SessionType | null;
  rpe?: number | null;
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
    | "age"
    | "gender"
    | "experience"
    | "training_history_years"
    | "split_endurance_weight"
    | "preferred_sports"
  > & { resting_hr?: number | null };
  recentLoads: { acute: number; chronic: number };
  useGL?: boolean;
  startedAt?: string;
  splitPacesSec?: number[];
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
  indexResult: IndexResult;
  headline: number;
  headlineLabel: IndexResult["headlineLabel"];
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

export function scoreActivity(
  input: ScoreActivityInput,
  history: {
    enduranceIndices: number[];
    strengthIndices: number[];
    splitIndices: number[];
  },
  recentActivityRows: Array<{
    sport: string;
    sport_index: number;
    started_at: string;
    score_breakdown?: Record<string, unknown> | null;
  }> = []
): ScoreResult {
  assertScoringInput({
    sport: input.sport,
    durationSeconds: input.durationSeconds,
    distanceMeters: input.distanceMeters,
    avgHeartRate: input.avgHeartRate,
    maxHeartRate: input.maxHeartRate,
    avgPowerWatts: input.avgPowerWatts,
    avgPaceSecondsPerKm: input.avgPaceSecondsPerKm,
    avgSplitSeconds: input.avgSplitSeconds,
    elevationMeters: input.elevationMeters,
    splitPacesSec: input.splitPacesSec,
    exercises: input.exercises,
    profile: input.profile,
  });

  const result = scoreActivityWithEngines(
    {
      sport: input.sport,
      durationSeconds: input.durationSeconds,
      distanceMeters: input.distanceMeters,
      avgHeartRate: input.avgHeartRate,
      sessionType: input.sessionType,
      rpe: input.rpe,
      exercises: input.exercises,
      profile: input.profile,
      recentLoads: input.recentLoads,
      useGL: input.useGL,
      startedAt: input.startedAt,
      splitPacesSec: input.splitPacesSec,
    },
    recentActivityRows,
    history.splitIndices
  );

  const predictedIndex = predictIndex([
    ...history.splitIndices,
    result.splitIndex,
  ]);

  return {
    sportIndex: result.sportIndex,
    enduranceComponent: result.enduranceComponent,
    strengthComponent: result.strengthComponent,
    loadScore: result.loadScore,
    breakdown: result.breakdown,
    splitIndex: result.splitIndex,
    splitBreakdownLabel: result.splitBreakdownLabel,
    enduranceIndex: result.enduranceIndex,
    strengthIndex: result.strengthIndex,
    fatigueScore: result.fatigueScore,
    recoveryScore: result.recoveryScore,
    predictedIndex,
    indexResult: result.indexResult,
    headline: result.indexResult.headline,
    headlineLabel: result.indexResult.headlineLabel,
    dotsScore: result.dotsScore,
    glPoints: result.glPoints,
    useGL: result.useGL,
    exerciseScores: result.exerciseScores,
    strengthScoreRows: result.strengthScoreRows,
  };
}

export function computeExercise1RM(weightKg: number, reps: number): number {
  return Math.round(estimate1RM(weightKg, reps) * 10) / 10;
}

export function calculateTrend(current: number, previous: number): number {
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
