import type { SessionType, SportType, Gender, ExperienceLevel, ScoreBreakdown } from "@/types";
import {
  scoreCardioActivity,
  type CardioResult,
} from "@/lib/scoring/cardio-activity";
import {
  scoreStrengthActivity,
  type StrengthResult,
} from "@/lib/scoring/strength-activity";
import {
  aggregateSideIndex,
  computeIndexes,
  type ActivityScore,
  type IndexResult,
} from "@/lib/scoring/index-engine";
import {
  buildActivityScores,
  buildCardioInput,
  buildStrengthInput,
  deriveAthleteProfile,
  labWeightFromProfile,
  mapExerciseToLift,
} from "@/lib/scoring/adapters";
import {
  calculateACWR,
  calculateFatigueScore,
  calculateRecoveryScore,
  isEnduranceSport,
} from "@/lib/scoring/engine";
import { calculateStrengthIndexV2 } from "@/lib/scoring/strength";
import { INDEX_ANCHOR, MIN_INDEX } from "@/lib/scoring/constants";
import { bestSet1RM } from "@/lib/scoring/strength/one-rm";

export interface ActivityScoreContext {
  sport: SportType;
  durationSeconds: number;
  distanceMeters?: number | null;
  avgHeartRate?: number | null;
  sessionType?: SessionType | null;
  exercises?: Array<{
    exercise_name: string;
    muscle_group: string;
    weight_kg: number;
    sets: number;
    reps: number;
    rpe?: number | null;
  }>;
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
  strengthActivities?: StrengthResult[];
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
  const legacy = calculateStrengthIndexV2({
    exercises: (input.exercises ?? []).map((ex) => ({
      ...ex,
      rpe: ex.rpe ?? null,
    })),
    bodyweightKg: bodyweight,
    gender: input.profile.gender ?? null,
    options: { useGL: input.useGL ?? false },
  });

  const perLiftResults: StrengthResult[] = [];
  const strengthScoreRows: NonNullable<ActivityScoreOutput["strengthScoreRows"]> = [];

  for (const ex of input.exercises ?? []) {
    const sets = Array.from({ length: ex.sets }, () => ({
      weightKg: ex.weight_kg,
      reps: ex.reps,
    }));
    const e1RM = bestSet1RM(sets);
    const lift = mapExerciseToLift(ex.exercise_name);
    const volume = ex.sets * ex.reps * ex.weight_kg;

    let strengthResult: StrengthResult | null = null;
    if (lift && e1RM > 0) {
      strengthResult = scoreStrengthActivity(
        buildStrengthInput({
          lift,
          weightKg: ex.weight_kg,
          reps: ex.reps,
          bodyweightKg: bodyweight,
          gender: input.profile.gender,
          oneRepMaxOverride: e1RM,
        })
      );
      perLiftResults.push(strengthResult);
    }

    const rowFromLegacy = legacy.strengthScoreRows.find(
      (r) => r.exercise_name === ex.exercise_name
    );

    strengthScoreRows.push({
      exercise_name: ex.exercise_name,
      muscle_group: ex.muscle_group,
      estimated_1rm_kg: Math.round(e1RM * 100) / 100,
      bodyweight_kg: bodyweight,
      relative_strength:
        bodyweight > 0 ? Math.round((e1RM / bodyweight) * 100) / 100 : 0,
      volume_load_kg: volume,
      strength_index: strengthResult?.score ?? rowFromLegacy?.strength_index ?? MIN_INDEX,
      score_breakdown: {
        ...(rowFromLegacy?.score_breakdown ?? {}),
        strength_activity: strengthResult ?? undefined,
      },
    });
  }

  const sessionScores: ActivityScore[] = perLiftResults.map((r) => ({
    side: "lab",
    score: r.score,
    confidence: 1,
    date: input.startedAt ?? new Date().toISOString(),
  }));

  const sportIndex =
    sessionScores.length > 0
      ? aggregateSideIndex(sessionScores, "lab") ?? legacy.index
      : legacy.index;

  return {
    sportIndex,
    strengthComponent: sportIndex,
    loadScore: legacy.loadScore,
    strengthActivities: perLiftResults,
    dotsScore: legacy.dotsScore,
    glPoints: legacy.glPoints,
    useGL: legacy.useGL,
    exerciseScores: legacy.exerciseScores,
    strengthScoreRows,
    activityConfidence: 1,
    breakdown: {
      ...legacy.breakdown,
      strength_activities: perLiftResults,
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
