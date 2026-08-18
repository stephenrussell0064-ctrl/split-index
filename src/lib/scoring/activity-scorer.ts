import type {
  GymExerciseInput,
  SessionType,
  SportType,
  Gender,
  ScoringBasis,
  ExperienceLevel,
  ScoreBreakdown,
} from "@/types";
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
import { resolveScoringBasis } from "@/lib/scoring/adapters";
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
import {
  accessoryMetricIndex,
  accessoryMetricVolumeEquivalentKg,
  resolveTrackedMetric,
  scoreAccessoryMetric,
  isAccessoryMetricResult,
  type AccessoryMetricSet,
} from "@/lib/scoring/strength/isometric-carry";
import { INDEX_ANCHOR } from "@/lib/scoring/constants";
import { getExerciseTracking } from "@/lib/constants/sports";
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
  /** This athlete's own baseline efficiency factor from recent easy/recovery/long same-sport sessions — see personalEasyEffortBaselineEF in cardio-predictions.ts. */
  easyEffortBaselineEF?: number | null;
  /** Mistag guard reference — see personalRecentHardEffortBenchmarkSeconds in cardio-predictions.ts. */
  recentHardEffortBenchmarkSeconds?: number | null;
  /** This athlete's own HR-independent baseline pace from recent easy/recovery/long same-sport sessions — corroborates the HR-zone below-base guard, see personalEasyEffortBaselinePaceSeconds in cardio-predictions.ts. */
  easyEffortBaselinePaceSeconds?: number | null;
  /** This athlete's own recent ALREADY-SCORED easy/recovery/long same-sport session scores — sets a bonus-only floor under a well-executed easy effort's score, see EASY_SCORE_FLOOR_FRACTION in cardio-activity.ts. */
  recentEasyEffortScores?: number[] | null;
  /** This athlete's own personal Riegel k from their cross-distance race/tempo history — see personalizeRiegelKFromWindow in cardio/race-prediction.ts. */
  personalizedRiegelK?: number | null;
  /** Structured interval/fartlek work-piece data — optional; see cardio/interval-scoring.ts. */
  intervalReps?: number | null;
  intervalWorkDistanceMeters?: number | null;
  intervalWorkSeconds?: number | null;
  intervalRestSeconds?: number | null;
  intervalWorkAvgHr?: number | null;
  fartlekOnDistanceMeters?: number | null;
  fartlekOnSeconds?: number | null;
  fartlekOnAvgHr?: number | null;
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
    /** Which sex-segregated standards to score against — see resolveScoringBasis. */
    scoring_basis?: ScoringBasis | null;
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

/**
 * How much confidence a score loses when nobody has told us which
 * sex-segregated standards to compare the athlete against, so
 * DEFAULT_SCORING_BASIS was used.
 *
 * The session is scored and saved either way — refusing to score it is what
 * made the app unusable for these athletes in the first place. What this does
 * is stop the resulting number being presented as though it were calibrated:
 * the comparison tables are a guess until the athlete answers, and the score
 * should say so rather than quietly claim a precision it does not have.
 */
const UNSET_SCORING_BASIS_CONFIDENCE_FACTOR = 0.85;

/** Surfaced in the score breakdown so the athlete can see why, and fix it. */
const UNSET_SCORING_BASIS_NOTE =
  "scored against default standards — set your scoring basis in your profile for an accurate comparison";

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
  const allExercises = input.exercises ?? [];

  /**
   * What each exercise is actually counted in. Resolved up front because the
   * legacy engine below must not see holds or carries at ALL: it scores every
   * exercise off weight × reps, so it reads the placeholder `reps: 1` on a
   * sled push as a one-rep max — a 100 kg sled push came out of it at 763
   * even when the distance was missing entirely.
   */
  const metrics = allExercises.map((ex) =>
    resolveTrackedMetric(
      getExerciseTracking(ex.exercise_name),
      ex.sets.map((s) => ({
        durationSeconds: s.duration_seconds,
        distanceMeters: s.distance_meters,
      }))
    )
  );
  const repExercises = allExercises.filter((_, i) => metrics[i] === "reps");

  // DOTS/GL and the SBD-total are a separate, still-useful powerlifting-total
  // metric (only meaningful when squat+bench+deadlift are all logged in one
  // session) — kept for that display, no longer used for per-exercise scoring.
  const legacy = calculateStrengthIndexV2({
    exercises: repExercises,
    bodyweightKg: bodyweight,
    // The resolved scoring basis, NOT the raw identity: DOTS and Glossbrenner
    // only have male and female tables, and handing this "other" used to
    // throw out of a code path that runs on every gym submit.
    gender: resolveScoringBasis(input.profile).sex,
    options: { useGL: input.useGL ?? false },
  });

  const sex = resolveScoringBasis(input.profile).sex;
  const isPremium = input.isPremium ?? false;
  const results: ScoreStrengthResult[] = [];
  const strengthScoreRows: NonNullable<ActivityScoreOutput["strengthScoreRows"]> = [];

  /**
   * Time-under-tension/distance volume from holds and carries, in the same
   * kg units as the legacy weight x reps volume — without it a session of
   * bodyweight planks reports a training load of exactly zero and never
   * touches ACWR, fatigue or recovery.
   */
  let accessoryVolumeKg = 0;

  for (let exerciseIndex = 0; exerciseIndex < allExercises.length; exerciseIndex++) {
    const ex = allExercises[exerciseIndex];
    const weightMode =
      ex.weight_entry_mode ??
      input.exerciseWeightModes?.[normalizeExerciseName(ex.exercise_name)];

    // Planks and carries have no reps to score off. Route them to the
    // isometric/carry model BEFORE the rep-based path gets hold of them:
    // that path reads a plank as a 0kg single rep (score 1, then dropped
    // from labIndex entirely) and a 100kg sled push as a 100kg ONE-REP MAX
    // (score 979, "World Class"). See strength/isometric-carry.ts.
    const metric = metrics[exerciseIndex];

    if (metric !== "reps") {
      const metricSets: AccessoryMetricSet[] = ex.sets.map((s) => ({
        weightKg: resolveScoringWeight(s.weight_kg, ex.exercise_name, weightMode)
          .scoringWeightKg,
        durationSeconds: s.duration_seconds ?? null,
        distanceMeters: s.distance_meters ?? null,
      }));

      const metricResult = scoreAccessoryMetric(metric, {
        liftKey: ex.exercise_name,
        sets: metricSets,
        bodyweightKg: bodyweight,
        sex,
        age: input.profile.age ?? null,
      });
      metricResult.exerciseIndex = exerciseIndex;
      results.push(metricResult);

      const metricVolume = accessoryMetricVolumeEquivalentKg(
        metric,
        metricSets,
        bodyweight,
        ex.exercise_name
      );
      accessoryVolumeKg += metricVolume;

      strengthScoreRows.push({
        exercise_name: ex.exercise_name,
        muscle_group: ex.muscle_group,
        // Deliberately 0: a hold or a carry has no 1RM, and a fabricated one
        // would flow straight into personal records (which key off
        // estimated_1rm_kg > 0).
        estimated_1rm_kg: metricResult.oneRM,
        bodyweight_kg: bodyweight,
        relative_strength: metricResult.bodyweightRatio,
        volume_load_kg: Math.round(metricVolume * 10) / 10,
        strength_index: metricResult.score,
        score_breakdown: { strength_result: metricResult },
      });
      continue;
    }

    const top = bestSet(ex.sets);
    if (!top) continue;
    const volume = totalVolumeKg(ex.sets);
    const history = input.exerciseHistory?.[normalizeExerciseName(ex.exercise_name)] ?? [];
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
      attachment: ex.attachment ?? null,
    });
    // Stable identity for matching this result back to its exercise in the
    // UI — liftKey can differ from ex.exercise_name after alias resolution,
    // and results[] can be shorter than allExercises[] (exercises with no
    // valid best set are skipped above), so positional index alone isn't
    // safe without this explicit tag.
    result.exerciseIndex = exerciseIndex;
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

  /**
   * Holds and carries contribute to the session index only when the session
   * has NOTHING rep-based in it, and never drag a barbell session down.
   *
   * Rationale, and this is a deliberate asymmetry rather than an oversight:
   *  - A core/carry-only session must score honestly. Scoring it 1 (what
   *    labIndex returns once its `oneRM > 0` filter has dropped every hold)
   *    silently pulls the athlete's Lab Index toward the floor for logging
   *    real work, which is worse than the old behaviour of refusing to log
   *    it at all.
   *  - A plank at the end of a heavy squat session must NOT dilute that
   *    session. The hold/carry standards are reasoned estimates (see
   *    strength/isometric-carry.ts); letting an estimate pull down a
   *    population-calibrated squat would trade a known-good number for a
   *    guess. Mixed sessions therefore score exactly as they did before this
   *    existed — the accessory results are still recorded, displayed, and
   *    persisted per exercise, they just do not move the aggregate.
   */
  const repResults = results.filter((r) => !isAccessoryMetricResult(r));
  const metricResults = results.filter(isAccessoryMetricResult);
  const metricIndex = metricResults.length > 0 ? accessoryMetricIndex(metricResults) : null;

  const contributing = repResults.length > 0 ? repResults : metricResults;
  const sportIndex =
    repResults.length > 0
      ? labIndex(repResults)
      : metricIndex !== null && metricIndex > 1
        ? metricIndex
        : legacy.index;
  const activityConfidence =
    contributing.length > 0
      ? contributing.reduce((sum, r) => sum + r.oneRMConfidence, 0) / contributing.length
      : 1;

  return {
    sportIndex,
    strengthComponent: sportIndex,
    loadScore: Math.round((legacy.loadScore + accessoryVolumeKg / 800) * 10) / 10,
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
    scoringBasis: input.profile.scoring_basis,
    experience: input.profile.experience,
    sessionType: input.sessionType,
    rpe: input.rpe,
    elevationMeters: input.elevationMeters,
    temperatureCelsius: input.temperatureCelsius,
    storedPredictionSeconds: input.storedPredictionSeconds,
    easyEffortBaselineEF: input.easyEffortBaselineEF,
    recentHardEffortBenchmarkSeconds: input.recentHardEffortBenchmarkSeconds,
    easyEffortBaselinePaceSeconds: input.easyEffortBaselinePaceSeconds,
    recentEasyEffortScores: input.recentEasyEffortScores,
    personalizedRiegelK: input.personalizedRiegelK,
    intervalReps: input.intervalReps,
    intervalWorkDistanceMeters: input.intervalWorkDistanceMeters,
    intervalWorkSeconds: input.intervalWorkSeconds,
    intervalRestSeconds: input.intervalRestSeconds,
    intervalWorkAvgHr: input.intervalWorkAvgHr,
    fartlekOnDistanceMeters: input.fartlekOnDistanceMeters,
    fartlekOnSeconds: input.fartlekOnSeconds,
    fartlekOnAvgHr: input.fartlekOnAvgHr,
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

  // The session is scored and returned either way; an unanswered scoring
  // basis costs confidence and earns a visible note, never the workout.
  const basis = resolveScoringBasis(input.profile);
  const baseConfidence = partial.activityConfidence ?? 1;
  const activityConfidence = basis.isDefault
    ? baseConfidence * UNSET_SCORING_BASIS_CONFIDENCE_FACTOR
    : baseConfidence;
  const baseExplanation = partial.breakdown?.explanation ?? [];

  return {
    sportIndex: partial.sportIndex!,
    enduranceComponent: partial.enduranceComponent ?? null,
    strengthComponent: partial.strengthComponent ?? null,
    loadScore: partial.loadScore!,
    breakdown: {
      ...(partial.breakdown ?? { explanation: [] }),
      ...(basis.isDefault
        ? { explanation: [...baseExplanation, UNSET_SCORING_BASIS_NOTE] }
        : {}),
      index_result: indexResult,
    },
    splitIndex,
    splitBreakdownLabel: `${Math.round(enduranceIndex)} cardio + ${Math.round(strengthIndex)} strength (${endPct}/${strPct})`,
    enduranceIndex,
    strengthIndex,
    fatigueScore,
    recoveryScore,
    predictedIndex: splitIndex,
    activityConfidence,
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
