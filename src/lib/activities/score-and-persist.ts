import type { createClient } from "@/lib/supabase/server";
import {
  scoreActivity,
  computeRecentLoads,
  buildStrengthScoreInserts,
} from "@/lib/scoring/service";
import { computeSportComparison } from "@/lib/utils/sport-comparison";
import { mapSportToBenchmarkSport, computeBodyBenchmarkEquivalentSeconds } from "@/lib/scoring/adapters";
import { BENCHMARK_DISTANCE_METERS } from "@/lib/scoring/cardio-benchmarks";
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
import {
  computeTier1Prediction,
  computeWindowedTier2Seconds,
  personalizeRiegelKFromWindow,
  pickSwimTimeTrialEfforts,
  replayStoredPredictionFromSessions,
  type HistorySession,
} from "@/lib/scoring/cardio/race-prediction";
import { isEnduranceSport } from "@/lib/scoring/engine";
import { isPremiumUser } from "@/lib/retention/trial";
import type { ActivityFormData, Profile } from "@/types";
import {
  upsertPersonalRecordsIfBetter,
  enduranceRecordCandidates,
  gymRecordCandidates,
  type PersonalRecordCandidate,
} from "@/lib/activities/personal-records";
import {
  buildScoringProfile,
  resolveScoringBodyweightKg,
  resolveEffectiveMaxHr,
} from "@/lib/activities/bodyweight";
import { fetchExerciseHistory } from "@/lib/activities/exercise-history";

/**
 * Re-score one already-existing activity and rewrite every row that depends on
 * it.
 *
 * Extracted from PATCH /api/activities/[id] so that merging can reuse it
 * verbatim rather than growing a second, subtly different copy of the same
 * sequence. The parts that are easy to get wrong the second time — excluding
 * the activity's own soon-to-be-replaced rows from the history it is scored
 * against, and above all the predicted-benchmark blend base — are the whole
 * reason this is shared code and not a pattern to copy.
 */

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type ScoreAndPersistBody = ActivityFormData & {
  bodyweight_kg?: number;
  exercise_notes?: Record<string, string>;
};

export interface ScoreAndPersistOptions {
  /**
   * Activities whose stored scores must not be treated as history for this
   * one — always the activity being re-scored, plus (on a merge) every
   * session being folded into it. Rows for these ids are filtered out of the
   * load window, the index history, the same-sport comparison and the 90-day
   * prediction window.
   */
  excludeActivityIds?: readonly string[];
  existingMetadata?: Record<string, unknown> | null;
  anchoredBodyweightKg?: number | null;
  /**
   * Force the predicted-benchmark blend base to be rebuilt from the athlete's
   * other sessions instead of read from the stored row.
   *
   * Needed when the stored prediction's evidence includes a session that is
   * being replaced or consumed, but the link that would reveal that has
   * already been broken — `predicted_benchmarks.last_activity_id` is
   * ON DELETE SET NULL, so deleting a merged-away activity silently erases
   * the very signal the edit path uses to detect this. The caller reads that
   * column BEFORE deleting and passes the answer here.
   *
   * What it must NOT do is skip the blend: passing a null base to
   * blendPredictedBenchmark means SEED, not skip, and seeding replaces the
   * athlete's whole race-prediction memory with one session — the bug that
   * turned a real 18:25 5 k into a displayed 24:59. Rebuilding from the
   * remaining window sessions is the correct base.
   */
  predictionBaseIsStale?: boolean;
}

export async function scoreAndPersist(
  supabase: Supabase,
  userId: string,
  profile: Profile,
  body: ScoreAndPersistBody,
  activityId: string,
  options: ScoreAndPersistOptions = {}
) {
  const excludeIds = new Set(options.excludeActivityIds ?? []);
  const { existingMetadata, anchoredBodyweightKg } = options;

  const bodyweightKg = resolveScoringBodyweightKg(body.sport, {
    submittedBodyweight: body.bodyweight_kg,
    activityMetadata: existingMetadata,
    strengthScoreBodyweight: anchoredBodyweightKg,
    profileWeightKg: profile.weight_kg,
  });

  const { data: observedMaxHrRow } = await supabase
    .from("activities")
    .select("max_heart_rate")
    .eq("user_id", userId)
    .not("max_heart_rate", "is", null)
    .order("max_heart_rate", { ascending: false })
    .limit(1)
    .maybeSingle();
  const effectiveMaxHr = resolveEffectiveMaxHr(
    profile.max_hr,
    Math.max(observedMaxHrRow?.max_heart_rate ?? 0, body.max_heart_rate ?? 0) || null
  );

  const scoringProfile = buildScoringProfile(profile, bodyweightKg, effectiveMaxHr);

  const { data: recentScoresRaw } = await supabase
    .from("workout_scores")
    .select("load_score, created_at, sport_index, endurance_component, strength_component, activity_id")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(50);
  const recentScores = (recentScoresRaw ?? []).filter(
    (s) => !excludeIds.has(s.activity_id as string)
  );

  const { data: recentSameSportRaw } = await supabase
    .from("workout_scores")
    .select("sport_index, created_at, activity_id")
    .eq("user_id", userId)
    .eq("sport", body.sport)
    .order("created_at", { ascending: false })
    .limit(10);
  const priorSportScores = (recentSameSportRaw ?? [])
    .filter((s) => !excludeIds.has(s.activity_id as string))
    .map((s) => s.sport_index as number);

  const loads = computeRecentLoads(recentScores);

  const enduranceIndices =
    recentScores
      ?.filter((s) => s.endurance_component)
      .map((s) => s.endurance_component as number) ?? [];
  const strengthIndices =
    recentScores
      ?.filter((s) => s.strength_component)
      .map((s) => s.strength_component as number) ?? [];

  const { data: indexHistoryRaw } = await supabase
    .from("split_index_history")
    .select(
      "id, split_index, endurance_index, strength_index, fatigue_score, recovery_score, predicted_index_7d, activity_id, recorded_at"
    )
    .eq("user_id", userId)
    .order("recorded_at", { ascending: true })
    .limit(30);
  const indexHistory = (indexHistoryRaw ?? []).filter(
    (h) => !excludeIds.has(h.activity_id as string)
  );

  /**
   * The athlete's other recent sessions, so the Split Index can be a SPLIT.
   *
   * Without these `scoreActivity` receives an empty third argument, the index
   * engine sees exactly one activity, and the split collapses to whichever
   * half that session happened to be — then that value is persisted as the
   * athlete's current index and syncs to their profile, which is the pool
   * everyone is ranked against. Measured on one athlete (gym ~870, running
   * ~520): creating an activity persisted 701 and read "Top 23%", editing a
   * gym session persisted 880 and read "Top 3%", editing a run persisted 520
   * and read "Top 45%". Same athlete, same week, no training difference.
   *
   * POST /api/activities, recompute and onboarding-calibrate all pass these.
   * This path — edit, merge, unmerge — was the only one that did not, which
   * is why the number moved when an athlete edited rather than trained.
   *
   * `excludeIds` is applied for the same reason it is applied to
   * `indexHistory` above: on an edit or a merge the rows being replaced are
   * still in the table, and counting a session against its own replacement
   * would double it.
   */
  const { data: recentActivitiesForIndex } = await supabase
    .from("activities")
    .select("id, sport, started_at, workout_scores(sport_index, score_breakdown)")
    .eq("user_id", userId)
    .eq("is_draft", false)
    .order("started_at", { ascending: false })
    .limit(20);

  const recentActivityRows = (recentActivitiesForIndex ?? [])
    .filter((row) => !excludeIds.has(row.id as string))
    .flatMap((row) => {
      const ws = Array.isArray(row.workout_scores) ? row.workout_scores[0] : row.workout_scores;
      if (!ws?.sport_index) return [];
      return [
        {
          sport: row.sport as string,
          sport_index: ws.sport_index as number,
          started_at: row.started_at as string,
          score_breakdown: (ws.score_breakdown ?? null) as Record<string, unknown> | null,
        },
      ];
    });

  const premium = isPremiumUser(profile.subscription_tier, profile.subscription_status);
  const exerciseHistory =
    body.sport === "gym" && body.exercises?.length
      ? await fetchExerciseHistory(
          supabase,
          userId,
          body.exercises.map((ex) => ex.exercise_name),
          [...excludeIds]
        )
      : {};

  // Memory-based cardio prediction (MASTER-BRIEF.md §5) — same blend as on
  // create, so editing a session's duration/HR/etc. keeps the stored
  // prediction consistent with the corrected values.
  let newPredictedBenchmarkSeconds: number | null = null;
  let newPredictedBenchmarkSampleCount = 1;
  let benchmarkSport: ReturnType<typeof mapSportToBenchmarkSport> | null = null;
  // Only fed into scoring, as a confidence signal only (never the score's
  // anchor time — see cardio-session-score-monotonicity-bug.md), when genuine
  // prior memory exists (excluding this same activity's own previous
  // prediction, since we're re-scoring it) — otherwise it's confidence-
  // flagged as session-only, not falsely "memory-available".
  let storedPredictionForScoring: number | null = null;
  let lastQualityAt: string | null = null;
  let personalizedK: number | null = null;
  let tier1Prediction: ReturnType<typeof computeTier1Prediction> = null;
  let easyEffortBaselineEF: number | null = null;
  let recentHardEffortBenchmarkSeconds: number | null = null;
  let easyEffortBaselinePaceSeconds: number | null = null;
  let recentEasyEffortScores: number[] | null = null;
  let sessionBenchmarkEquivalentSeconds: number | null = null;
  if (isEnduranceSport(body.sport)) {
    benchmarkSport = mapSportToBenchmarkSport(body.sport);
    const { data: priorPrediction } = await supabase
      .from("predicted_benchmarks")
      .select("benchmark_seconds, sample_count, last_activity_id, updated_at, last_quality_at, riegel_k")
      .eq("user_id", userId)
      .eq("sport", benchmarkSport)
      .maybeSingle();
    const priorIsThisActivity =
      options.predictionBaseIsStale === true ||
      (priorPrediction?.last_activity_id != null &&
        excludeIds.has(priorPrediction.last_activity_id as string));

    const windowCutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const { data: windowActivitiesRaw } = await supabase
      .from("activities")
      .select(
        "id, sport, started_at, duration_seconds, distance_meters, avg_heart_rate, session_type, elevation_meters, temperature_celsius, workout_scores(sport_index)"
      )
      .eq("user_id", userId)
      .eq("is_draft", false)
      .gte("started_at", windowCutoff);

    // Filtered here rather than in the query: a merge excludes several ids at
    // once, and one PostgREST `neq` cannot express that.
    const sameSportWindowActivities = (windowActivitiesRaw ?? []).filter(
      (row) =>
        !excludeIds.has(row.id as string) &&
        mapSportToBenchmarkSport(row.sport) === benchmarkSport
    );

    const windowSessions: HistorySession[] = sameSportWindowActivities
      .filter((row) => row.distance_meters != null)
      .map((row) => ({
        distanceMeters: row.distance_meters as number,
        durationSeconds: row.duration_seconds,
        avgHR: row.avg_heart_rate ?? undefined,
        sessionType: row.session_type ?? undefined,
        startedAt: row.started_at,
        elevationMeters: row.elevation_meters ?? undefined,
        temperatureCelsius: row.temperature_celsius ?? undefined,
      }));

    // Easy-session score floor — see EASY_SCORE_FLOOR_FRACTION's doc comment
    // in cardio-activity.ts. Reuses the same window/exclusion already
    // fetched above (the exclusions keep this activity's OWN previous
    // score from floor-ing its own re-score).
    recentEasyEffortScores = sameSportWindowActivities
      .filter((row) => row.session_type && RELATIVE_EFFORT_SESSION_TYPES.has(row.session_type))
      .map((row) => {
        const ws = Array.isArray(row.workout_scores) ? row.workout_scores[0] : row.workout_scores;
        return ws?.sport_index as number | undefined;
      })
      .filter((s): s is number => s != null);

    personalizedK = personalizeRiegelKFromWindow(windowSessions, priorPrediction?.riegel_k ?? null);
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

    newPredictedBenchmarkSampleCount = priorIsThisActivity
      ? (priorPrediction?.sample_count ?? 1)
      : (priorPrediction?.sample_count ?? 0) + 1;
    const sessionEquivalentSeconds = computeBodyBenchmarkEquivalentSeconds(
      benchmarkSport,
      body,
      personalizedK ?? undefined
    );
    sessionBenchmarkEquivalentSeconds = sessionEquivalentSeconds;
    if (sessionEquivalentSeconds !== null) {
      // The stored row's own evidence already includes this activity (it was
      // the session that last wrote it), so blending this re-score straight
      // back into it would double-count the same session. What that must NOT
      // mean is "no memory at all": passing null to blendPredictedBenchmark
      // makes it SEED, replacing the athlete's whole prediction history with
      // this one edited session's equivalent — that is how a real 18:25 5k
      // athlete's dashboard ended up reading 24:59 off a re-saved easy 7.5k,
      // with sample_count carried across so it still displayed as calibrated.
      // Rebuild the base from their other sessions instead (windowSessions
      // already excludes this activity), the same replay recompute performs.
      const rawBlendBase = priorIsThisActivity
        ? replayStoredPredictionFromSessions(
            benchmarkSport,
            windowSessions,
            personalizedK ?? undefined
          )
        : (priorPrediction?.benchmark_seconds ?? null);
      const blendBase =
        rawBlendBase != null
          ? effectiveStoredPrediction(
              rawBlendBase,
              priorPrediction?.updated_at,
              priorPrediction?.last_quality_at
            )
          : null;
      const sequentialBlend = blendPredictedBenchmark(blendBase, sessionEquivalentSeconds, {
        sessionType: body.session_type,
        thisSessionEF: terrainAdjustedSessionEF(
          body.distance_meters ?? 0,
          body.duration_seconds,
          body.avg_heart_rate,
          body.elevation_meters,
          body.temperature_celsius
        ),
        baselineEF: easyEffortBaselineEF,
        isDirectBenchmarkDistance: isDirectBenchmarkDistance(
          body.distance_meters ?? 0,
          BENCHMARK_DISTANCE_METERS[benchmarkSport]
        ),
      });
      newPredictedBenchmarkSeconds = computeWindowedTier2Seconds(
        benchmarkSport,
        sequentialBlend,
        windowSessions
      );
      const nowIso = new Date().toISOString();
      lastQualityAt = sessionCountsAsQuality(blendBase, sessionEquivalentSeconds)
        ? nowIso
        : (priorPrediction?.last_quality_at ?? nowIso);
      if (blendBase != null) {
        storedPredictionForScoring = newPredictedBenchmarkSeconds;
      }
    }

    if (body.distance_meters != null) {
      const swimTimeTrialEfforts =
        benchmarkSport === "swim"
          ? pickSwimTimeTrialEfforts(
              windowSessions
                .filter((s) => s.sessionType === "race")
                .map((s) => ({ distanceMeters: s.distanceMeters, durationSeconds: s.durationSeconds }))
            )
          : null;

      tier1Prediction = computeTier1Prediction({
        benchmarkSport,
        distanceMeters: body.distance_meters,
        durationSeconds: body.duration_seconds,
        avgHR: body.avg_heart_rate ?? undefined,
        avgPowerWatts: body.avg_power_watts ?? undefined,
        riegelK: personalizedK ?? undefined,
        swimTimeTrialEfforts,
      });
    }
  }

  const result = scoreActivity(
    {
      sport: body.sport,
      durationSeconds: body.duration_seconds,
      distanceMeters: body.distance_meters,
      elevationMeters: body.elevation_meters,
      avgHeartRate: body.avg_heart_rate,
      maxHeartRate: body.max_heart_rate,
      avgPowerWatts: body.avg_power_watts,
      avgPaceSecondsPerKm: body.avg_pace_seconds_per_km,
      avgSplitSeconds: body.avg_split_seconds,
      temperatureCelsius: body.temperature_celsius,
      sessionType: body.session_type,
      rpe: body.rpe,
      storedPredictionSeconds: storedPredictionForScoring,
      easyEffortBaselineEF,
      recentHardEffortBenchmarkSeconds,
      easyEffortBaselinePaceSeconds,
      recentEasyEffortScores,
      personalizedRiegelK: personalizedK,
      intervalReps: body.interval_reps,
      intervalWorkDistanceMeters: body.interval_work_distance_meters,
      intervalWorkSeconds: body.interval_work_seconds,
      intervalRestSeconds: body.interval_rest_seconds,
      intervalWorkAvgHr: body.interval_work_avg_hr,
      fartlekOnDistanceMeters: body.fartlek_on_distance_meters,
      fartlekOnSeconds: body.fartlek_on_seconds,
      fartlekOnAvgHr: body.fartlek_on_avg_hr,
      exercises: body.exercises,
      exerciseHistory,
      isPremium: premium,
      profile: scoringProfile,
      recentLoads: loads,
      startedAt: body.started_at,
    },
    {
      enduranceIndices,
      strengthIndices,
      splitIndices: indexHistory?.map((h) => h.split_index) ?? [],
    },
    recentActivityRows
  );

  const previousSplitIndex =
    indexHistory?.[indexHistory.length - 1]?.split_index ?? result.splitIndex;

  await supabase.from("workout_scores").delete().eq("activity_id", activityId);
  await supabase.from("split_index_history").delete().eq("activity_id", activityId);

  const { data: workoutScore } = await supabase
    .from("workout_scores")
    .insert({
      activity_id: activityId,
      user_id: userId,
      sport: body.sport,
      sport_index: result.sportIndex,
      endurance_component: result.enduranceComponent,
      strength_component: result.strengthComponent,
      fatigue_impact: result.fatigueScore,
      load_score: result.loadScore,
      score_breakdown:
        benchmarkSport && newPredictedBenchmarkSeconds !== null
          ? {
              ...result.breakdown,
              predicted_benchmark_after_session: {
                sport: benchmarkSport,
                benchmarkSeconds: newPredictedBenchmarkSeconds,
                sampleCount: newPredictedBenchmarkSampleCount,
              },
            }
          : result.breakdown,
      // Must reflect the activity's own date, not edit time — see the
      // matching comment on split_index_history.recorded_at below.
      created_at: body.started_at,
    })
    .select()
    .single();

  await supabase.from("split_index_history").insert({
    user_id: userId,
    split_index: result.splitIndex,
    endurance_index: result.enduranceIndex,
    strength_index: result.strengthIndex,
    fatigue_score: result.fatigueScore,
    recovery_score: result.recoveryScore,
    predicted_index_7d: result.predictedIndex,
    activity_id: activityId,
    // Must reflect the activity's own date, not edit time — see the
    // matching comment in the create route.
    recorded_at: body.started_at,
  });

  if (body.sport === "gym" && result.strengthScoreRows?.length) {
    await supabase.from("strength_scores").delete().eq("activity_id", activityId);
    await supabase.from("strength_scores").insert(
      buildStrengthScoreInserts(
        userId,
        activityId,
        body.started_at,
        result.strengthScoreRows
      )
    );
  }

  if (benchmarkSport && newPredictedBenchmarkSeconds !== null) {
    await supabase.from("predicted_benchmarks").upsert(
      {
        user_id: userId,
        sport: benchmarkSport,
        benchmark_seconds: newPredictedBenchmarkSeconds,
        sample_count: newPredictedBenchmarkSampleCount,
        last_activity_id: activityId,
        last_quality_at: lastQualityAt,
        riegel_k: personalizedK,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,sport" }
    );
  }

  const personalRecordCandidates: PersonalRecordCandidate[] = isEnduranceSport(body.sport)
    ? enduranceRecordCandidates({
        sport: body.sport,
        activityId,
        achievedAt: body.started_at,
        distanceMeters: body.distance_meters,
        durationSeconds: body.duration_seconds,
        benchmarkEquivalentSeconds: sessionBenchmarkEquivalentSeconds,
      })
    : body.sport === "gym" && result.strengthScoreRows?.length
      ? gymRecordCandidates({
          activityId,
          achievedAt: body.started_at,
          exercises: result.strengthScoreRows,
        })
      : [];
  if (personalRecordCandidates.length > 0) {
    await upsertPersonalRecordsIfBetter(supabase, userId, personalRecordCandidates);
  }

  const sportComparison = computeSportComparison(result.sportIndex, priorSportScores);

  return {
    workoutScore,
    result,
    previousSplitIndex,
    sportComparison,
    isFirstSportSession: priorSportScores.length === 0,
    scoringProfile,
    tier1Prediction,
    predictedBenchmarkAfterSession:
      benchmarkSport && newPredictedBenchmarkSeconds !== null
        ? {
            sport: benchmarkSport,
            benchmarkSeconds: newPredictedBenchmarkSeconds,
            sampleCount: newPredictedBenchmarkSampleCount,
          }
        : null,
  };
}
