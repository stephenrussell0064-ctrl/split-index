import type { SupabaseClient } from "@supabase/supabase-js";

import {
  scoreActivity,
  computeRecentLoads,
  buildStrengthScoreInserts,
  ScoringInputError,
} from "@/lib/scoring/service";
import {
  buildScoringProfile,
  resolveScoringBodyweightKg,
  resolveEffectiveMaxHr,
} from "@/lib/activities/bodyweight";
import { setsForExercise } from "@/lib/activities/gym-sets";
import { normalizeName } from "@/lib/scoring/split-strength-engine";
import { defaultWeightEntryMode } from "@/lib/scoring/weight-entry";
import type { WeightEntryMode } from "@/lib/scoring/weight-entry";
import { isPremiumUser } from "@/lib/retention/trial";
import { mapSportToBenchmarkSport, computeBodyBenchmarkEquivalentSeconds } from "@/lib/scoring/adapters";
import {
  blendPredictedBenchmark,
  effectiveStoredPrediction,
  sessionCountsAsQuality,
  personalEasyEffortBaselineEF,
  personalEasyEffortBaselinePaceSeconds,
  personalRecentHardEffortBenchmarkSeconds,
  terrainAdjustedSessionEF,
  isDirectBenchmarkDistance,
  RELATIVE_EFFORT_SESSION_TYPES,
} from "@/lib/scoring/cardio-predictions";
import type { SessionType } from "@/types";
import {
  computeWindowedTier2Seconds,
  personalizeRiegelKFromWindow,
  type HistorySession,
} from "@/lib/scoring/cardio/race-prediction";
import { BENCHMARK_DISTANCE_METERS, type BenchmarkSport } from "@/lib/scoring/cardio-benchmarks";
import { isEnduranceSport } from "@/lib/scoring/engine";
import type { GymExercise } from "@/types";
import type { LoggedSet } from "@/lib/scoring/split-strength-engine";
import {
  enduranceRecordCandidates,
  gymRecordCandidates,
  type PersonalRecordCandidate,
} from "@/lib/activities/personal-records";

/**
 * A Supabase client that is already scoped to the user being recomputed —
 * either the request-scoped client from a signed-in route, or a service-role
 * client in the bulk script. This function never authenticates; the caller
 * decides whose data it is allowed to touch.
 */
export type RecomputeClient = SupabaseClient;

/**
 * Thrown for the two conditions that stop a recompute before it starts. It
 * carries an HTTP status because the route needs one; the bulk script ignores
 * that and just records which athlete failed, so one bad profile does not
 * abandon the rest of the run.
 */
export class RecomputeError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "RecomputeError";
  }
}

export interface RecomputeResult {
  total: number;
  recomputed: number;
  failed: number;
  failures: unknown[];
  /**
   * Failures in the two rebuild steps that run once per athlete rather than
   * once per activity — the predicted-benchmark upsert and the personal-record
   * rebuild. Kept apart from `failures` because they cannot be attributed to a
   * single session: `recomputed` can read total-of-total while the athlete's
   * entire PR list failed to come back.
   */
  rebuildFailures: string[];
}

/**
 * Re-scores every one of an athlete's past activities with the current scoring
 * engine and overwrites the stored workout_scores / split_index_history /
 * strength_scores / personal_records rows. Scores are computed once at log time
 * and persisted, so a formula change never reaches historical rows on its own.
 *
 * Runs oldest-first so each activity's index and trend context is rebuilt from
 * the other newly-recomputed scores in the same pass, not from stale DB values.
 *
 * EXTRACTED from POST /api/activities/recompute so the route and the bulk
 * script (scripts/recompute-all-users.ts) run the SAME code. A calibration
 * change that needs every athlete rebuilt is exactly when a second copy would
 * drift, and a drifted copy would silently rebuild some users on the old
 * rules.
 */
export async function recomputeUser(
  supabase: RecomputeClient,
  userId: string
): Promise<RecomputeResult> {
  const user = { id: userId };

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("user_id", user.id)
    .single();

  if (!profile) {
    throw new RecomputeError("Profile not found", 404);
  }

  const { data: activities, error: activitiesError } = await supabase
    .from("activities")
    .select("*")
    .eq("user_id", user.id)
    .eq("is_draft", false)
    .order("started_at", { ascending: true });

  if (activitiesError) {
    /*
     * The Postgres message used to travel in here and straight out through
     * the recompute route, which returns `err.message` to the caller for this
     * error type. RecomputeError's other message is app-authored ("Profile not
     * found"), so nothing about the type suggested one of its two messages was
     * a raw driver string. Logged, not carried.
     */
    console.error("[recompute] reading activities failed", {
      userId,
      cause: activitiesError.message,
    });
    throw new RecomputeError("We could not read your activity history.", 500);
  }

  const activityIds = (activities ?? []).map((a) => a.id as string);
  const { data: allExercises } = activityIds.length
    ? await supabase.from("gym_exercises").select("*").in("activity_id", activityIds)
    : { data: [] as GymExercise[] };

  const exercisesByActivity = new Map<string, GymExercise[]>();
  for (const ex of allExercises ?? []) {
    const list = exercisesByActivity.get(ex.activity_id as string) ?? [];
    list.push(ex as GymExercise);
    exercisesByActivity.set(ex.activity_id as string, list);
  }

  const recentActivityRows: Array<{
    sport: string;
    sport_index: number;
    started_at: string;
    score_breakdown: Record<string, unknown> | null;
  }> = [];
  const recentScoreLoads: Array<{ load_score: number; created_at: string }> = [];
  const enduranceIndices: number[] = [];
  const strengthIndices: number[] = [];
  const splitIndices: number[] = [];

  // Best-known max HR across every session — the Tanaka age formula
  // underestimates max HR for a lot of trained athletes, and if any past
  // session's own avg HR meets or exceeds it, every effort calculation
  // downstream treats that (and easier) sessions as harder than they were.
  const observedMaxHr = (activities ?? []).reduce(
    (max, a) => Math.max(max, a.max_heart_rate ?? 0),
    0
  );
  const effectiveMaxHr = resolveEffectiveMaxHr(profile.max_hr, observedMaxHr || null);
  const isPremium = isPremiumUser(profile.subscription_tier, profile.subscription_status);

  let recomputed = 0;
  const failures: Array<{ id: string; error: string }> = [];

  // Backfill avg_pace_seconds_per_km for older activities logged before the
  // manual-entry form started computing it (user feedback: an old run's
  // activity detail page showed no pace/split at all, only duration/
  // distance/elevation/HR/temperature). GPS-tracked runs already populate
  // this at capture time; only running/walking/outdoor_cycling use a
  // km-based pace (rowing/ski-erg use avg_split_seconds instead, already
  // captured at log time — no equivalent gap there).
  const KM_PACE_SPORTS = new Set(["running", "walking", "outdoor_cycling"]);
  const paceBackfills: Array<{ id: string; avg_pace_seconds_per_km: number }> = [];
  for (const activity of activities ?? []) {
    if (
      KM_PACE_SPORTS.has(activity.sport as string) &&
      activity.avg_pace_seconds_per_km == null &&
      typeof activity.distance_meters === "number" &&
      activity.distance_meters > 0 &&
      typeof activity.duration_seconds === "number" &&
      activity.duration_seconds > 0
    ) {
      paceBackfills.push({
        id: activity.id as string,
        avg_pace_seconds_per_km: activity.duration_seconds / (activity.distance_meters / 1000),
      });
    }
  }
  if (paceBackfills.length > 0) {
    await Promise.all(
      paceBackfills.map(({ id, avg_pace_seconds_per_km }) =>
        supabase.from("activities").update({ avg_pace_seconds_per_km }).eq("id", id)
      )
    );
    for (const { id, avg_pace_seconds_per_km } of paceBackfills) {
      const activity = (activities ?? []).find((a) => a.id === id);
      if (activity) activity.avg_pace_seconds_per_km = avg_pace_seconds_per_km;
    }
  }

  // Built incrementally, oldest-first, so scoring activity N only ever sees
  // history from activities strictly before it — never a future session's
  // sets influencing a past one's adaptive 1RM estimate.
  const exerciseHistory: Record<string, LoggedSet[]> = {};

  // Same oldest-first replay for memory-based cardio predictions
  // (MASTER-BRIEF.md §5) — this backfills predicted_benchmarks for existing
  // users the first time recompute runs after this feature ships.
  const predictedBenchmarkSeconds: Partial<Record<BenchmarkSport, number>> = {};
  const predictedBenchmarkSampleCounts: Partial<Record<BenchmarkSport, number>> = {};
  const predictedBenchmarkLastActivityId: Partial<Record<BenchmarkSport, string>> = {};
  const predictedBenchmarkLastRunAt: Partial<Record<BenchmarkSport, string>> = {};
  const predictedBenchmarkLastQualityAt: Partial<Record<BenchmarkSport, string>> = {};
  // Race-prediction-model.md: Tier 2 windowed enhancement + personalized
  // Riegel k, replayed the same oldest-first way as the sequential blend
  // above — each activity only ever sees its own 90-day trailing window of
  // previously-replayed same-sport sessions, never future ones.
  const predictedBenchmarkRiegelK: Partial<Record<BenchmarkSport, number>> = {};
  const sessionsBySport: Partial<Record<BenchmarkSport, HistorySession[]>> = {};
  // Easy-session score floor (user feedback: a well-executed easy run
  // "should not deviate that far from my normal scores") — see
  // EASY_SCORE_FLOOR_FRACTION's doc comment in cardio-activity.ts. Same
  // oldest-first replay discipline as sessionsBySport/predictedBenchmark*
  // above: each activity only ever sees ALREADY-REPLAYED prior sessions'
  // real scores, appended after (not before) this activity is itself scored.
  const easyEffortScoresBySport: Partial<
    Record<BenchmarkSport, Array<{ sessionType: string | null; startedAt: string; score: number }>>
  > = {};

  // Personal records (personal-records.ts) — recompute is the authoritative
  // full rebuild: replayed oldest-first, so the best-per-metric accumulated
  // here is always correct, unlike the create/edit routes' incremental
  // "upsert only if better" (which can't detect a record becoming invalid
  // after an edit/delete lowers what used to be the record-holding session).
  const bestPersonalRecords = new Map<string, PersonalRecordCandidate>();
  function trackPersonalRecords(candidates: PersonalRecordCandidate[]) {
    for (const c of candidates) {
      const key = `${c.sport}::${c.metric}`;
      const existing = bestPersonalRecords.get(key);
      const better =
        !existing ||
        (c.direction === "lower-is-better" ? c.value < existing.value : c.value > existing.value);
      if (better) bestPersonalRecords.set(key, c);
    }
  }

  for (const activity of activities ?? []) {
    const metadata = activity.metadata as Record<string, unknown> | null;
    const bodyweightKg = resolveScoringBodyweightKg(activity.sport, {
      activityMetadata: metadata,
      profileWeightKg: profile.weight_kg,
    });
    const scoringProfile = buildScoringProfile(profile, bodyweightKg, effectiveMaxHr);
    const loads = computeRecentLoads(recentScoreLoads);
    const weightModes =
      metadata && typeof metadata.exercise_weight_modes === "object"
        ? (metadata.exercise_weight_modes as Record<string, WeightEntryMode>)
        : {};
    const exercises = (exercisesByActivity.get(activity.id as string) ?? [])
      .sort((a, b) => a.order_index - b.order_index)
      .map((ex, i) => ({
        exercise_name: ex.exercise_name,
        muscle_group: ex.muscle_group,
        sets: setsForExercise(ex),
        order_index: i,
        weight_entry_mode:
          weightModes[ex.exercise_name] ?? defaultWeightEntryMode(ex.exercise_name),
        attachment: ex.attachment ?? null,
      }));

    let benchmarkSport: BenchmarkSport | null = null;
    // Only genuine prior memory (from an earlier iteration of this replay)
    // is fed into scoring — a sport's first-ever session has nothing to
    // blend into yet, so it scores as session-only.
    let storedPredictionForScoring: number | null = null;
    let easyEffortBaselineEF: number | null = null;
    let recentHardEffortBenchmarkSeconds: number | null = null;
    let easyEffortBaselinePaceSeconds: number | null = null;
    let recentEasyEffortScores: number[] | null = null;
    let sessionBenchmarkEquivalentSeconds: number | null = null;
    let personalizedK: number | null = null;
    if (isEnduranceSport(activity.sport)) {
      benchmarkSport = mapSportToBenchmarkSport(activity.sport);
      const rawPrior = predictedBenchmarkSeconds[benchmarkSport] ?? null;
      const priorValue =
        rawPrior != null
          ? effectiveStoredPrediction(
              rawPrior,
              predictedBenchmarkLastRunAt[benchmarkSport] ?? null,
              predictedBenchmarkLastQualityAt[benchmarkSport] ?? null,
              new Date(activity.started_at as string)
            )
          : null;

      const windowCutoff =
        new Date(activity.started_at as string).getTime() - 90 * 24 * 60 * 60 * 1000;
      const priorSessions = sessionsBySport[benchmarkSport] ?? [];
      const windowSessions = priorSessions.filter(
        (s) => new Date(s.startedAt).getTime() >= windowCutoff
      );
      recentEasyEffortScores = (easyEffortScoresBySport[benchmarkSport] ?? [])
        .filter(
          (s) =>
            new Date(s.startedAt).getTime() >= windowCutoff &&
            s.sessionType &&
            RELATIVE_EFFORT_SESSION_TYPES.has(s.sessionType as SessionType)
        )
        .map((s) => s.score);
      personalizedK = personalizeRiegelKFromWindow(
        windowSessions,
        predictedBenchmarkRiegelK[benchmarkSport] ?? null
      );
      easyEffortBaselineEF = personalEasyEffortBaselineEF(
        benchmarkSport,
        windowSessions,
        personalizedK ?? undefined
      );
      recentHardEffortBenchmarkSeconds = personalRecentHardEffortBenchmarkSeconds(
        benchmarkSport,
        windowSessions,
        personalizedK ?? undefined
      );
      easyEffortBaselinePaceSeconds = personalEasyEffortBaselinePaceSeconds(
        benchmarkSport,
        windowSessions,
        personalizedK ?? undefined
      );

      const sessionEquivalentSeconds = computeBodyBenchmarkEquivalentSeconds(
        benchmarkSport,
        activity,
        personalizedK ?? undefined
      );
      sessionBenchmarkEquivalentSeconds = sessionEquivalentSeconds;
      if (sessionEquivalentSeconds !== null) {
        const sequentialBlend = blendPredictedBenchmark(priorValue, sessionEquivalentSeconds, {
          sessionType: activity.session_type,
          thisSessionEF: terrainAdjustedSessionEF(
            activity.distance_meters ?? 0,
            activity.duration_seconds,
            activity.avg_heart_rate,
            activity.elevation_meters,
            activity.temperature_celsius
          ),
          baselineEF: easyEffortBaselineEF,
          isDirectBenchmarkDistance: isDirectBenchmarkDistance(
            activity.distance_meters ?? 0,
            BENCHMARK_DISTANCE_METERS[benchmarkSport]
          ),
        });
        predictedBenchmarkSeconds[benchmarkSport] = computeWindowedTier2Seconds(
          benchmarkSport,
          sequentialBlend,
          windowSessions
        );
        predictedBenchmarkSampleCounts[benchmarkSport] =
          (predictedBenchmarkSampleCounts[benchmarkSport] ?? 0) + 1;
        predictedBenchmarkLastRunAt[benchmarkSport] = activity.started_at as string;
        predictedBenchmarkRiegelK[benchmarkSport] = personalizedK ?? undefined;
        if (sessionCountsAsQuality(priorValue, sessionEquivalentSeconds)) {
          predictedBenchmarkLastQualityAt[benchmarkSport] = activity.started_at as string;
        } else if (!predictedBenchmarkLastQualityAt[benchmarkSport]) {
          predictedBenchmarkLastQualityAt[benchmarkSport] = activity.started_at as string;
        }
        if (priorValue != null) {
          storedPredictionForScoring = predictedBenchmarkSeconds[benchmarkSport]!;
        }
      }

      if (activity.distance_meters != null) {
        sessionsBySport[benchmarkSport] = [
          ...priorSessions,
          {
            distanceMeters: activity.distance_meters,
            durationSeconds: activity.duration_seconds,
            avgHR: activity.avg_heart_rate ?? undefined,
            sessionType: activity.session_type ?? undefined,
            startedAt: activity.started_at as string,
            elevationMeters: activity.elevation_meters ?? undefined,
            temperatureCelsius: activity.temperature_celsius ?? undefined,
          },
        ];
      }
    }

    try {
      const result = scoreActivity(
        {
          sport: activity.sport,
          durationSeconds: activity.duration_seconds,
          distanceMeters: activity.distance_meters,
          elevationMeters: activity.elevation_meters,
          avgHeartRate: activity.avg_heart_rate,
          maxHeartRate: activity.max_heart_rate,
          avgPowerWatts: activity.avg_power_watts,
          avgPaceSecondsPerKm: activity.avg_pace_seconds_per_km,
          avgSplitSeconds: activity.avg_split_seconds,
          temperatureCelsius: activity.temperature_celsius,
          sessionType: activity.session_type,
          rpe: activity.rpe,
          storedPredictionSeconds: storedPredictionForScoring,
          easyEffortBaselineEF,
          recentHardEffortBenchmarkSeconds,
          easyEffortBaselinePaceSeconds,
          recentEasyEffortScores,
          personalizedRiegelK: personalizedK,
          intervalReps: activity.interval_reps,
          intervalWorkDistanceMeters: activity.interval_work_distance_meters,
          intervalWorkSeconds: activity.interval_work_seconds,
          intervalRestSeconds: activity.interval_rest_seconds,
          intervalWorkAvgHr: activity.interval_work_avg_hr,
          fartlekOnDistanceMeters: activity.fartlek_on_distance_meters,
          fartlekOnSeconds: activity.fartlek_on_seconds,
          fartlekOnAvgHr: activity.fartlek_on_avg_hr,
          exercises,
          exerciseHistory,
          isPremium,
          profile: scoringProfile,
          recentLoads: loads,
          startedAt: activity.started_at,
        },
        { enduranceIndices, strengthIndices, splitIndices },
        recentActivityRows
      );

      // Append this session's sets to history *after* scoring it, so it's
      // available to later (more recent) activities but not to itself.
      for (const ex of exercises) {
        const key = normalizeName(ex.exercise_name);
        const logged: LoggedSet[] = ex.sets.map((s) => ({
          weightKg: s.weight_kg,
          reps: s.reps,
          performedAt: activity.started_at as string,
        }));
        exerciseHistory[key] = [...(exerciseHistory[key] ?? []), ...logged];
      }

      // Every write below DELETES before it inserts, so a failure does not
      // leave the previous row standing — it leaves the activity with nothing.
      // None of these results was read, so a rejected insert produced an
      // activity with no score and a run that still reported it as "rebuilt".
      // In a bulk pass that is the worst possible silence: the script prints a
      // clean tally, the athlete's session quietly stops counting toward their
      // Split Index, and nothing anywhere says which one.
      const writeErrors: string[] = [];
      const noteWrite = (what: string, error: { message: string } | null) => {
        if (!error) return;
        console.error(`[recompute] ${what} failed for activity`, activity.id, error.message);
        writeErrors.push(`${what}: ${error.message}`);
      };

      // The delete is checked too. If it fails and the insert then succeeds,
      // the activity ends up with TWO score rows, which double-counts it in
      // every load and trend query that reads them.
      const { error: scoreDeleteError } = await supabase
        .from("workout_scores")
        .delete()
        .eq("activity_id", activity.id);
      noteWrite("workout_scores delete", scoreDeleteError);

      const { error: scoreInsertError } = await supabase.from("workout_scores").insert({
        activity_id: activity.id,
        user_id: user.id,
        sport: activity.sport,
        sport_index: result.sportIndex,
        endurance_component: result.enduranceComponent,
        strength_component: result.strengthComponent,
        fatigue_impact: result.fatigueScore,
        load_score: result.loadScore,
        score_breakdown:
          benchmarkSport && predictedBenchmarkSeconds[benchmarkSport] != null
            ? {
                ...result.breakdown,
                predicted_benchmark_after_session: {
                  sport: benchmarkSport,
                  benchmarkSeconds: predictedBenchmarkSeconds[benchmarkSport],
                  sampleCount: predictedBenchmarkSampleCounts[benchmarkSport] ?? 1,
                },
              }
            : result.breakdown,
        // Must reflect the activity's own date, not recompute time — see the
        // matching comment on split_index_history.recorded_at below. Without
        // this, recomputing collapses every activity's workout_scores row
        // onto "now", breaking ACWR/injury-risk history windows.
        created_at: activity.started_at,
      });
      noteWrite("workout_scores insert", scoreInsertError);

      const { error: historyDeleteError } = await supabase
        .from("split_index_history")
        .delete()
        .eq("activity_id", activity.id);
      noteWrite("split_index_history delete", historyDeleteError);

      const { error: historyInsertError } = await supabase.from("split_index_history").insert({
        user_id: user.id,
        split_index: result.splitIndex,
        endurance_index: result.enduranceIndex,
        strength_index: result.strengthIndex,
        fatigue_score: result.fatigueScore,
        recovery_score: result.recoveryScore,
        predicted_index_7d: result.predictedIndex,
        activity_id: activity.id,
        // Must reflect the activity's own date, not recompute-run time —
        // see the matching comment in the create route. This is the most
        // severe manifestation of the bug: without it, every historical
        // activity in a recompute pass gets stamped with virtually the same
        // instant, collapsing months of history into a single calendar day
        // once analytics groups by day (collapseToLastPerDay).
        recorded_at: activity.started_at,
      });
      noteWrite("split_index_history insert", historyInsertError);

      if (isEnduranceSport(activity.sport)) {
        trackPersonalRecords(
          enduranceRecordCandidates({
            sport: activity.sport,
            activityId: activity.id,
            achievedAt: activity.started_at,
            distanceMeters: activity.distance_meters,
            durationSeconds: activity.duration_seconds,
            benchmarkEquivalentSeconds: sessionBenchmarkEquivalentSeconds,
          })
        );
      }

      if (activity.sport === "gym" && result.strengthScoreRows?.length) {
        trackPersonalRecords(
          gymRecordCandidates({
            activityId: activity.id,
            achievedAt: activity.started_at,
            exercises: result.strengthScoreRows,
          })
        );
        const { error: strengthDeleteError } = await supabase
          .from("strength_scores")
          .delete()
          .eq("activity_id", activity.id);
        noteWrite("strength_scores delete", strengthDeleteError);

        // These are the per-lift rows the strength breakdown is read from, so
        // losing them shows as a scored session with no per-exercise detail —
        // the shape of the "strength score is missing again" report.
        const { error: strengthInsertError } = await supabase.from("strength_scores").insert(
          buildStrengthScoreInserts(
            user.id,
            activity.id,
            activity.started_at,
            result.strengthScoreRows
          )
        );
        noteWrite("strength_scores insert", strengthInsertError);
      }

      recentActivityRows.unshift({
        sport: activity.sport,
        sport_index: result.sportIndex,
        started_at: activity.started_at,
        score_breakdown: result.breakdown as unknown as Record<string, unknown>,
      });
      if (benchmarkSport) {
        easyEffortScoresBySport[benchmarkSport] = [
          ...(easyEffortScoresBySport[benchmarkSport] ?? []),
          {
            sessionType: activity.session_type,
            startedAt: activity.started_at as string,
            score: result.sportIndex,
          },
        ];
      }
      if (result.enduranceComponent != null) enduranceIndices.push(result.enduranceComponent);
      if (result.strengthComponent != null) strengthIndices.push(result.strengthComponent);
      splitIndices.push(result.splitIndex);
      recentScoreLoads.push({ load_score: result.loadScore, created_at: activity.started_at });
      if (benchmarkSport && predictedBenchmarkSeconds[benchmarkSport] != null) {
        predictedBenchmarkLastActivityId[benchmarkSport] = activity.id as string;
      }

      // The in-memory context above is accumulated either way, deliberately.
      // The score itself was computed correctly — only storing it failed — so
      // the activities after this one should still be scored against it rather
      // than against a gap, which would compound one storage failure into
      // wrong numbers for everything that follows.
      if (writeErrors.length > 0) {
        failures.push({ id: activity.id as string, error: writeErrors.join("; ") });
      } else {
        recomputed += 1;
      }
    } catch (err) {
      failures.push({
        id: activity.id,
        error: err instanceof ScoringInputError ? err.message : "Unknown error",
      });
    }
  }

  const benchmarkRows = (Object.keys(predictedBenchmarkSeconds) as BenchmarkSport[]).map((sport) => ({
    user_id: user.id,
    sport,
    benchmark_seconds: predictedBenchmarkSeconds[sport]!,
    sample_count: predictedBenchmarkSampleCounts[sport] ?? 1,
    last_activity_id: predictedBenchmarkLastActivityId[sport] ?? null,
    last_quality_at: predictedBenchmarkLastQualityAt[sport] ?? null,
    riegel_k: predictedBenchmarkRiegelK[sport] ?? null,
    updated_at: new Date().toISOString(),
  }));
  // These two rebuild the athlete's whole record rather than one session's, so
  // they cannot be attributed to an activity — they get their own list. Both
  // were unchecked, and the personal_records one is the most destructive write
  // in this function: it deletes EVERY record first, so a rejected insert takes
  // the athlete's entire PR history with it and still reports a clean run.
  const rebuildFailures: string[] = [];
  const noteRebuild = (what: string, error: { message: string } | null) => {
    if (!error) return;
    console.error(`[recompute] ${what} failed for user`, user.id, error.message);
    rebuildFailures.push(`${what}: ${error.message}`);
  };

  if (benchmarkRows.length > 0) {
    const { error: benchmarkError } = await supabase
      .from("predicted_benchmarks")
      .upsert(benchmarkRows, { onConflict: "user_id,sport" });
    // An upsert, so a failure leaves the previous prediction standing rather
    // than nothing — the least severe of these, but still a silent way for a
    // recompute to leave a stale predicted 5k behind rebuilt scores.
    noteRebuild("predicted_benchmarks upsert", benchmarkError);
  }

  // Full rebuild — recompute is the authoritative pass, so replace every
  // existing record rather than incrementally upserting (see
  // trackPersonalRecords above for why that's necessary here).
  const { error: recordsDeleteError } = await supabase
    .from("personal_records")
    .delete()
    .eq("user_id", user.id);
  noteRebuild("personal_records delete", recordsDeleteError);

  if (bestPersonalRecords.size > 0) {
    const { error: recordsInsertError } = await supabase.from("personal_records").insert(
      Array.from(bestPersonalRecords.values()).map((c) => ({
        user_id: user.id,
        sport: c.sport,
        metric: c.metric,
        value: c.value,
        unit: c.unit,
        activity_id: c.activityId,
        achieved_at: c.achievedAt,
      }))
    );
    noteRebuild("personal_records insert", recordsInsertError);
  }

  return {
    total: activities?.length ?? 0,
    recomputed,
    failed: failures.length,
    failures,
    rebuildFailures,
  };
}

