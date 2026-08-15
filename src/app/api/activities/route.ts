import { NextResponse } from "next/server";
import { ROUTE_CONFIG, parseRoutePolyline } from "@/lib/scoring/gps-track";
import { createClient } from "@/lib/supabase/server";
import { scoreActivity, computeRecentLoads, computeExercise1RM, buildStrengthScoreInserts, ScoringInputError } from "@/lib/scoring/service";
import { assertScoringInput } from "@/lib/scoring/input-guards";
import { generateCoachFeedback, generateRulesBasedSnippet, type IndexHistoryEntry } from "@/lib/openai/coach";
import { computeSportComparison } from "@/lib/utils/sport-comparison";
import { SPORT_INDEX_LABELS } from "@/lib/constants/sports";
import { enrichCardioScore } from "@/lib/scoring/cardio";
import {
  cardioResultToEnrichment,
  mapSportToBenchmarkSport,
  computeBodyBenchmarkEquivalentSeconds,
} from "@/lib/scoring/adapters";
import type { CardioResult } from "@/lib/scoring/cardio-activity";
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
  type HistorySession,
} from "@/lib/scoring/cardio/race-prediction";
import { isEnduranceSport } from "@/lib/scoring/engine";
import { isPremiumUser } from "@/lib/retention/trial";
import { serializeScoreBreakdown } from "@/lib/scoring/presentation";
import { canAccessProfile } from "@/lib/premium/features";
import type { ActivityFormData, GymExercise } from "@/types";
import {
  buildScoringProfile,
  resolveScoringBodyweightKg,
  resolveEffectiveMaxHr,
} from "@/lib/activities/bodyweight";
import { bestSet, summarizeSets } from "@/lib/activities/gym-sets";
import {
  upsertPersonalRecordsIfBetter,
  enduranceRecordCandidates,
  gymRecordCandidates,
  type PersonalRecordCandidate,
} from "@/lib/activities/personal-records";
import { fetchExerciseHistory } from "@/lib/activities/exercise-history";
import { defaultWeightEntryMode } from "@/lib/scoring/weight-entry";
import type { WeightEntryMode } from "@/lib/scoring/weight-entry";
import { fetchCurrentTemperatureCelsius } from "@/lib/weather/fetch-temperature";


/**
 * Route polylines arrive already simplified from the GPS tracker, but they are
 * still user-supplied JSON heading for a column the logbook draws from, so
 * they are re-validated and re-capped here. Anything malformed is dropped
 * rather than rejected — a bad route should cost the athlete their map, not
 * their run.
 */
function sanitizeRoute(value: unknown): [number, number][] | null {
  const parsed = parseRoutePolyline(value);
  if (!parsed) return null;
  return parsed.slice(0, ROUTE_CONFIG.MAX_POINTS);
}

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Compensating delete for a logged session whose dependent writes failed.
 *
 * A logged activity only means anything alongside its score: the logbook, the
 * Split Index history and every rollup read from workout_scores. An activity
 * row that outlived a failed score insert is not a partial success, it is a
 * ghost session — it shows up in the logbook, contributes nothing, and the
 * athlete cannot tell why. Supabase's JS client has no transaction, so the
 * activity is inserted first and unwound here if the rest does not land.
 *
 * gym_exercises and workout_scores are ON DELETE CASCADE from activities, so
 * deleting the parent takes them with it. split_index_history is ON DELETE SET
 * NULL — it would survive with a null activity_id and keep skewing the trend
 * charts — so it is deleted explicitly first.
 *
 * Returns false if the unwind itself failed, which is the one case where an
 * orphan can survive; the caller reports the failure either way, so the client
 * never renders a success screen for a session that was not fully saved.
 */
async function rollbackActivity(
  supabase: SupabaseServerClient,
  activityId: string
): Promise<boolean> {
  const { error: historyError } = await supabase
    .from("split_index_history")
    .delete()
    .eq("activity_id", activityId);
  const { error: activityDeleteError } = await supabase
    .from("activities")
    .delete()
    .eq("id", activityId);

  if (historyError || activityDeleteError) {
    console.error(
      "[activities] rollback failed for activity",
      activityId,
      historyError?.message ?? activityDeleteError?.message
    );
    return false;
  }
  return true;
}

/** 500 for a write that failed after the activity row already existed. */
async function failAndRollback(
  supabase: SupabaseServerClient,
  activityId: string,
  what: string,
  detail: string | undefined
) {
  console.error(`[activities] ${what} insert failed:`, detail);
  const rolledBack = await rollbackActivity(supabase, activityId);
  return NextResponse.json(
    {
      error: rolledBack
        ? "We could not save this workout. Nothing was recorded — please try logging it again."
        : "We could not save this workout completely. Check your logbook before logging it again.",
    },
    { status: 500 }
  );
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // bodyweight_kg is an additive extension: the gym form submits the athlete's
  // current bodyweight so relative-strength scoring uses today's weight.
  const body: ActivityFormData & {
    bodyweight_kg?: number;
    exercise_notes?: Record<string, string>;
  } = await request.json();

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("user_id", user.id)
    .single();

  if (!profile) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  const bodyweightKg = resolveScoringBodyweightKg(body.sport, {
    submittedBodyweight: body.bodyweight_kg,
    profileWeightKg: profile.weight_kg,
  });

  const { data: observedMaxHrRow } = await supabase
    .from("activities")
    .select("max_heart_rate")
    .eq("user_id", user.id)
    .not("max_heart_rate", "is", null)
    .order("max_heart_rate", { ascending: false })
    .limit(1)
    .maybeSingle();
  const effectiveMaxHr = resolveEffectiveMaxHr(
    profile.max_hr,
    Math.max(observedMaxHrRow?.max_heart_rate ?? 0, body.max_heart_rate ?? 0) || null
  );

  const scoringProfile = buildScoringProfile(profile, bodyweightKg, effectiveMaxHr);

  try {
    assertScoringInput({
      sport: body.sport,
      durationSeconds: body.duration_seconds,
      distanceMeters: body.distance_meters,
      avgHeartRate: body.avg_heart_rate,
      maxHeartRate: body.max_heart_rate,
      avgPowerWatts: body.avg_power_watts,
      avgPaceSecondsPerKm: body.avg_pace_seconds_per_km,
      avgSplitSeconds: body.avg_split_seconds,
      elevationMeters: body.elevation_meters,
      rpe: body.rpe,
      exercises: body.exercises,
      profile: scoringProfile,
    });
  } catch (err) {
    if (err instanceof ScoringInputError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  if (bodyweightKg && body.sport === "gym") {
    await supabase.from("body_metrics").insert({
      user_id: user.id,
      weight_kg: bodyweightKg,
      recorded_at: body.started_at,
    });
  }

  const { data: recentScores } = await supabase
    .from("workout_scores")
    .select("load_score, created_at, sport_index, endurance_component, strength_component")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);

  const { data: recentSameSportScores } = await supabase
    .from("workout_scores")
    .select("sport_index, created_at")
    .eq("user_id", user.id)
    .eq("sport", body.sport)
    .order("created_at", { ascending: false })
    .limit(10);

  const priorSportScores = (recentSameSportScores ?? []).map(
    (s) => s.sport_index as number
  );

  const { data: recentActivitiesForIndex } = await supabase
    .from("activities")
    .select("sport, started_at, workout_scores(sport_index, score_breakdown)")
    .eq("user_id", user.id)
    .eq("is_draft", false)
    .order("started_at", { ascending: false })
    .limit(20);

  const recentActivityRows = (recentActivitiesForIndex ?? [])
    .flatMap((row) => {
      const ws = Array.isArray(row.workout_scores)
        ? row.workout_scores[0]
        : row.workout_scores;
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

  const loads = computeRecentLoads(recentScores ?? []);

  // GPS-tracked outdoor sessions send their starting coordinates instead of
  // a manually-typed temperature — auto-fetch it server-side so the user
  // never has to enter it. Manual log entries already carry their own
  // temperature_celsius from the form, so this only fires when that's absent.
  let temperatureCelsius = body.temperature_celsius;
  if (
    temperatureCelsius === undefined &&
    typeof body.start_latitude === "number" &&
    typeof body.start_longitude === "number"
  ) {
    temperatureCelsius =
      (await fetchCurrentTemperatureCelsius(body.start_latitude, body.start_longitude)) ?? undefined;
  }

  const routePolyline = sanitizeRoute((body as { route?: unknown }).route);

  const { data: activity, error: activityError } = await supabase
    .from("activities")
    .insert({
      user_id: user.id,
      sport: body.sport,
      title: body.title,
      started_at: body.started_at,
      duration_seconds: body.duration_seconds,
      distance_meters: body.distance_meters,
      elevation_meters: body.elevation_meters,
      avg_heart_rate: body.avg_heart_rate,
      max_heart_rate: body.max_heart_rate,
      avg_power_watts: body.avg_power_watts,
      avg_cadence: body.avg_cadence,
      avg_pace_seconds_per_km: body.avg_pace_seconds_per_km,
      avg_split_seconds: body.avg_split_seconds,
      stroke_type: body.stroke_type,
      temperature_celsius: temperatureCelsius,
      session_type: body.session_type,
      interval_reps: body.interval_reps,
      interval_work_distance_meters: body.interval_work_distance_meters,
      interval_work_seconds: body.interval_work_seconds,
      interval_rest_seconds: body.interval_rest_seconds,
      interval_work_avg_hr: body.interval_work_avg_hr,
      fartlek_on_distance_meters: body.fartlek_on_distance_meters,
      fartlek_on_seconds: body.fartlek_on_seconds,
      fartlek_on_avg_hr: body.fartlek_on_avg_hr,
      rpe: body.rpe,
      notes: body.notes,
      is_draft: false,
      source: body.source ?? "manual",
      is_partial_track: body.is_partial_track ?? false,
      metadata: {
        ...(bodyweightKg ? { bodyweight_kg: bodyweightKg } : {}),
        // The run's shape, already simplified client-side (see
        // buildRoutePolyline). Validated here rather than trusted: this is
        // user-supplied JSON going into a column the logbook renders from.
        ...(routePolyline ? { route: routePolyline } : {}),
        ...(body.exercise_notes ? { exercise_notes: body.exercise_notes } : {}),
        ...(body.exercises?.length
          ? {
              exercise_weight_modes: Object.fromEntries(
                body.exercises.map((ex) => [
                  ex.exercise_name,
                  ex.weight_entry_mode ?? defaultWeightEntryMode(ex.exercise_name),
                ])
              ) as Record<string, WeightEntryMode>,
            }
          : {}),
      },
    })
    .select()
    .single();

  if (activityError || !activity) {
    return NextResponse.json(
      { error: activityError?.message ?? "Failed to create activity" },
      { status: 500 }
    );
  }

  if (body.exercises && body.exercises.length > 0) {
    const exerciseRows = body.exercises.map((ex, i) => {
      const summary = summarizeSets(ex.sets);
      const top = bestSet(ex.sets);
      return {
        activity_id: activity.id,
        exercise_name: ex.exercise_name,
        muscle_group: ex.muscle_group,
        weight_kg: summary.weight_kg,
        sets: summary.sets,
        reps: summary.reps,
        rpe: summary.rpe,
        set_details: ex.sets,
        estimated_1rm_kg: top ? computeExercise1RM(top.weight_kg, top.reps) : 0,
        order_index: i,
        attachment: ex.attachment ?? null,
      };
    });

    const { error: exercisesError } = await supabase.from("gym_exercises").insert(exerciseRows);
    if (exercisesError) {
      return failAndRollback(supabase, activity.id, "gym_exercises", exercisesError.message);
    }
  }

  const enduranceIndices =
    recentScores
      ?.filter((s) => s.endurance_component)
      .map((s) => s.endurance_component as number) ?? [];
  const strengthIndices =
    recentScores
      ?.filter((s) => s.strength_component)
      .map((s) => s.strength_component as number) ?? [];

  const { data: indexHistory } = await supabase
    .from("split_index_history")
    .select(
      "id, split_index, endurance_index, strength_index, fatigue_score, recovery_score, predicted_index_7d, activity_id, recorded_at"
    )
    .eq("user_id", user.id)
    .order("recorded_at", { ascending: true })
    .limit(30);

  const { data: recentActivitiesWithScores } = await supabase
    .from("activities")
    .select(
      "id, sport, started_at, duration_seconds, session_type, workout_scores(sport_index, load_score)"
    )
    .eq("user_id", user.id)
    .eq("is_draft", false)
    .order("started_at", { ascending: false })
    .limit(10);

  const premium = isPremiumUser(profile.subscription_tier, profile.subscription_status);
  const exerciseHistory =
    body.sport === "gym" && body.exercises?.length
      ? await fetchExerciseHistory(
          supabase,
          user.id,
          body.exercises.map((ex) => ex.exercise_name)
        )
      : {};

  // Memory-based cardio prediction (MASTER-BRIEF.md §5): blend this
  // session's Riegel+HR-adjusted benchmark-equivalent into the stored
  // per-user, per-sport prediction before scoring, so the score reflects
  // fitness proven across sessions, not just this one.
  let newPredictedBenchmarkSeconds: number | null = null;
  let newPredictedBenchmarkSampleCount = 1;
  let benchmarkSport: ReturnType<typeof mapSportToBenchmarkSport> | null = null;
  // Only fed into scoring (as a confidence signal, never as the score's
  // anchor time — see cardio-session-score-monotonicity-bug.md) when genuine
  // prior memory exists; the first-ever session for a sport has nothing to
  // blend into, so it's confidence-flagged as session-only, not
  // "memory-available".
  let storedPredictionForScoring: number | null = null;
  let lastQualityAt: string | null = null;
  // Race-prediction-model.md: personalized Riegel k derived from this
  // user's own cross-distance history, and a fresh per-session Tier 1
  // prediction — both computed here so they can feed the existing Tier 2
  // asymmetric-update blend (never overwrite it directly).
  let personalizedK: number | null = null;
  let tier1Prediction: ReturnType<typeof computeTier1Prediction> = null;
  // Relative-effort scoring (user feedback): easy/recovery/long-tagged
  // sessions get scored against this athlete's own easy-effort baseline
  // instead of the population pace-vs-benchmark table — see
  // personalEasyEffortBaselineEF in cardio-predictions.ts.
  let easyEffortBaselineEF: number | null = null;
  let recentHardEffortBenchmarkSeconds: number | null = null;
  let easyEffortBaselinePaceSeconds: number | null = null;
  let recentEasyEffortScores: number[] | null = null;
  // This session's own benchmark-equivalent — kept for personal-record
  // detection below (personal-records.ts), separate from the multi-session
  // blended prediction.
  let sessionBenchmarkEquivalentSeconds: number | null = null;
  if (isEnduranceSport(body.sport)) {
    benchmarkSport = mapSportToBenchmarkSport(body.sport);
    const { data: priorPrediction } = await supabase
      .from("predicted_benchmarks")
      .select("benchmark_seconds, sample_count, updated_at, last_quality_at, riegel_k")
      .eq("user_id", user.id)
      .eq("sport", benchmarkSport)
      .maybeSingle();

    const windowCutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const { data: windowActivities } = await supabase
      .from("activities")
      .select(
        "sport, started_at, duration_seconds, distance_meters, avg_heart_rate, session_type, elevation_meters, temperature_celsius, workout_scores(sport_index)"
      )
      .eq("user_id", user.id)
      .eq("is_draft", false)
      .gte("started_at", windowCutoff);

    const sameSportWindowActivities = (windowActivities ?? []).filter(
      (row) => mapSportToBenchmarkSport(row.sport) === benchmarkSport
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

    // Easy-session score floor (user feedback: a well-executed easy run
    // "should not deviate that far from my normal scores") — see
    // EASY_SCORE_FLOOR_FRACTION's doc comment in cardio-activity.ts. Reuses
    // the same 90-day/same-sport window already fetched above rather than a
    // separate query.
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

    newPredictedBenchmarkSampleCount = (priorPrediction?.sample_count ?? 0) + 1;
    const sessionEquivalentSeconds = computeBodyBenchmarkEquivalentSeconds(
      benchmarkSport,
      body,
      personalizedK ?? undefined
    );
    sessionBenchmarkEquivalentSeconds = sessionEquivalentSeconds;
    if (sessionEquivalentSeconds !== null) {
      const decayedPrior =
        priorPrediction?.benchmark_seconds != null
          ? effectiveStoredPrediction(
              priorPrediction.benchmark_seconds,
              priorPrediction.updated_at,
              priorPrediction.last_quality_at
            )
          : null;
      const sequentialBlend = blendPredictedBenchmark(decayedPrior, sessionEquivalentSeconds, {
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
      lastQualityAt = sessionCountsAsQuality(decayedPrior, sessionEquivalentSeconds)
        ? nowIso
        : (priorPrediction?.last_quality_at ?? nowIso);
      if (decayedPrior != null) {
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

  const result = (() => {
    try {
      return scoreActivity(
        {
          sport: body.sport,
          durationSeconds: body.duration_seconds,
          distanceMeters: body.distance_meters,
          elevationMeters: body.elevation_meters,
          avgHeartRate: body.avg_heart_rate,
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
    } catch (err) {
      if (err instanceof ScoringInputError) {
        return { error: err.message };
      }
      throw err;
    }
  })();

  if ("error" in result) {
    await supabase.from("activities").delete().eq("id", activity.id);
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  const previousSplitIndex =
    indexHistory?.[indexHistory.length - 1]?.split_index ?? result.splitIndex;

  const { data: workoutScore, error: workoutScoreError } = await supabase
    .from("workout_scores")
    .insert({
      activity_id: activity.id,
      user_id: user.id,
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
      // Must reflect the activity's own date, not insert time — see the
      // matching comment on split_index_history.recorded_at below. Without
      // this, ACWR/injury-risk history windows and load rollups collapse
      // toward "now" for backfilled or recomputed activities.
      created_at: body.started_at,
    })
    .select()
    .single();

  // The score IS the product. Without this row the session is unscored
  // everywhere it is read from, so there is nothing worth keeping the
  // activity for — unwind and say so rather than returning a success payload
  // built from an in-memory score that was never persisted.
  if (workoutScoreError || !workoutScore) {
    return failAndRollback(supabase, activity.id, "workout_scores", workoutScoreError?.message);
  }

  const { error: indexHistoryError } = await supabase.from("split_index_history").insert({
    user_id: user.id,
    split_index: result.splitIndex,
    endurance_index: result.enduranceIndex,
    strength_index: result.strengthIndex,
    fatigue_score: result.fatigueScore,
    recovery_score: result.recoveryScore,
    predicted_index_7d: result.predictedIndex,
    activity_id: activity.id,
    // Must reflect the ACTIVITY's own date, not insert time — analytics
    // trends/moving-averages/projections all group by calendar day off this
    // column (collapseToLastPerDay), so logging (or backfilling) an old
    // activity today must not stamp it as "today" or it silently collapses
    // into whatever else was logged today, breaking every time-series chart.
    recorded_at: body.started_at,
  });

  // Every Split Index trend, projection and moving average reads this table.
  // A session that scored but never entered the index history would show the
  // athlete a new score on the success screen that their chart never moves to
  // — so it is unwound on the same terms as the score itself.
  if (indexHistoryError) {
    return failAndRollback(supabase, activity.id, "split_index_history", indexHistoryError.message);
  }

  if (body.sport === "gym" && result.strengthScoreRows?.length) {
    await supabase.from("strength_scores").delete().eq("activity_id", activity.id);
    const { error: strengthScoresError } = await supabase.from("strength_scores").insert(
      buildStrengthScoreInserts(
        user.id,
        activity.id,
        body.started_at,
        result.strengthScoreRows
      )
    );
    // Secondary: the session is already scored and in the index history. Losing
    // the per-exercise strength rows costs this session's per-lift breakdown,
    // not the workout — logged, not fatal, and deliberately not a rollback.
    if (strengthScoresError) {
      console.error("[activities] strength_scores insert failed:", strengthScoresError.message);
    }
  }

  if (benchmarkSport && newPredictedBenchmarkSeconds !== null) {
    const { error: predictedBenchmarkError } = await supabase.from("predicted_benchmarks").upsert(
      {
        user_id: user.id,
        sport: benchmarkSport,
        benchmark_seconds: newPredictedBenchmarkSeconds,
        sample_count: newPredictedBenchmarkSampleCount,
        last_activity_id: activity.id,
        last_quality_at: lastQualityAt,
        riegel_k: personalizedK,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,sport" }
    );
    // Secondary, same reasoning as strength_scores: the stored race prediction
    // simply misses this session's evidence and picks it up on the next one.
    if (predictedBenchmarkError) {
      console.error(
        "[activities] predicted_benchmarks upsert failed:",
        predictedBenchmarkError.message
      );
    }
  }

  await supabase.from("workout_drafts").delete().eq("user_id", user.id).eq("sport", body.sport);

  const personalRecordCandidates: PersonalRecordCandidate[] = isEnduranceSport(body.sport)
    ? enduranceRecordCandidates({
        sport: body.sport,
        activityId: activity.id,
        achievedAt: body.started_at,
        distanceMeters: body.distance_meters,
        durationSeconds: body.duration_seconds,
        benchmarkEquivalentSeconds: sessionBenchmarkEquivalentSeconds,
      })
    : body.sport === "gym" && result.strengthScoreRows?.length
      ? gymRecordCandidates({
          activityId: activity.id,
          achievedAt: body.started_at,
          exercises: result.strengthScoreRows,
        })
      : [];
  if (personalRecordCandidates.length > 0) {
    await upsertPersonalRecordsIfBetter(supabase, user.id, personalRecordCandidates);
  }

  let aiFeedback = null;
  let premiumRequired = false;
  const recentActivitiesSummary =
    recentActivitiesWithScores
      ?.filter((a) => a.id !== activity.id)
      .map((a) => {
        const ws = Array.isArray(a.workout_scores)
          ? a.workout_scores[0]
          : a.workout_scores;
        return {
          sport: a.sport,
          started_at: a.started_at,
          duration_seconds: a.duration_seconds,
          sport_index: ws?.sport_index ?? 0,
          load_score: ws?.load_score ?? 0,
          session_type: a.session_type,
        };
      }) ?? [];

  let exercises: GymExercise[] | undefined;

  if (body.sport === "gym") {
    const { data: gymExercises } = await supabase
      .from("gym_exercises")
      .select("*")
      .eq("activity_id", activity.id)
      .order("order_index");
    exercises = gymExercises ?? undefined;
  }

  const coachIndexHistory: IndexHistoryEntry[] = [
    ...(indexHistory ?? []).map((h) => ({
      split_index: h.split_index,
      endurance_index: h.endurance_index,
      strength_index: h.strength_index,
      fatigue_score: h.fatigue_score,
      recovery_score: h.recovery_score,
      predicted_index_7d: h.predicted_index_7d,
      recorded_at: h.recorded_at,
    })),
    {
      split_index: result.splitIndex,
      endurance_index: result.enduranceIndex,
      strength_index: result.strengthIndex,
      fatigue_score: result.fatigueScore,
      recovery_score: result.recoveryScore,
      predicted_index_7d: result.predictedIndex,
      recorded_at: new Date().toISOString(),
    },
  ];

  const coachInput = {
    activity,
    score: workoutScore,
    previousSplitIndex,
    currentSplitIndex: result.splitIndex,
    enduranceIndex: result.enduranceIndex,
    strengthIndex: result.strengthIndex,
    fatigueScore: result.fatigueScore,
    recoveryScore: result.recoveryScore,
    predictedIndex: result.predictedIndex,
    recentLoads: loads,
    indexHistory: coachIndexHistory,
    recentActivities: recentActivitiesSummary,
    exercises,
    profile: {
      age: profile.age,
      experience: profile.experience,
      goals: profile.goals ?? [],
      preferred_sports: profile.preferred_sports ?? [],
      weight_kg: scoringProfile.weight_kg,
      max_hr: scoringProfile.max_hr,
      training_history_years: profile.training_history_years,
    },
  };

  const hasFullAiCoaching = canAccessProfile("ai_coaching_full", profile);

  if (hasFullAiCoaching) {
    const coachOutput = await generateCoachFeedback(coachInput, {
      useOpenAI: true,
    });

    const { data: feedback } = await supabase
      .from("ai_feedback")
      .upsert(
        {
          activity_id: activity.id,
          user_id: user.id,
          ...coachOutput,
        },
        { onConflict: "activity_id" }
      )
      .select()
      .single();

    aiFeedback = feedback;
  } else {
    const snippet = generateRulesBasedSnippet(coachInput);
    premiumRequired = true;
    aiFeedback = {
      activity_id: activity.id,
      user_id: user.id,
      performance_explanation: null,
      recovery_advice: null,
      next_workout_recommendation: snippet.next_workout_recommendation,
      long_term_insight: null,
      score_change_reason: null,
      premium_required: true,
    };
  }

  const sportComparison = computeSportComparison(result.sportIndex, priorSportScores);
  const isFirstSportSession = priorSportScores.length === 0;

  let cardioEnrichment = null;
  if (isEnduranceSport(body.sport)) {
    const cardioActivity = result.breakdown.cardio_activity as CardioResult | undefined;
    cardioEnrichment = cardioActivity
      ? cardioResultToEnrichment(cardioActivity, result.sportIndex)
      : enrichCardioScore({
          sportIndex: result.sportIndex,
          sport: body.sport,
          activity: {
            duration_seconds: body.duration_seconds,
            distance_meters: body.distance_meters ?? null,
            avg_heart_rate: body.avg_heart_rate ?? null,
            avg_power_watts: body.avg_power_watts ?? null,
            avg_pace_seconds_per_km: body.avg_pace_seconds_per_km ?? null,
            avg_split_seconds: body.avg_split_seconds ?? null,
          },
          profile: scoringProfile,
        });

    if (cardioEnrichment) {
      await supabase
        .from("workout_scores")
        .update({
          score_breakdown: {
            ...result.breakdown,
            cardio_enrichment: cardioEnrichment,
            ...(benchmarkSport && newPredictedBenchmarkSeconds !== null
              ? {
                  predicted_benchmark_after_session: {
                    sport: benchmarkSport,
                    benchmarkSeconds: newPredictedBenchmarkSeconds,
                    sampleCount: newPredictedBenchmarkSampleCount,
                  },
                }
              : {}),
          },
        })
        .eq("id", workoutScore.id);
    }
  }

  return NextResponse.json({
    activity,
    score: workoutScore,
    sport: body.sport,
    sportLabel: SPORT_INDEX_LABELS[body.sport],
    sportIndex: result.sportIndex,
    splitIndex: result.splitIndex,
    previousSplitIndex,
    splitIndexDelta: result.splitIndex - previousSplitIndex,
    enduranceIndex: result.enduranceIndex,
    strengthIndex: result.strengthIndex,
    headline: result.headline,
    headlineLabel: result.headlineLabel,
    sportComparison,
    isFirstSportSession,
    exerciseScores: result.exerciseScores,
    scoreBreakdown: serializeScoreBreakdown(result.breakdown, premium),
    dotsScore: result.dotsScore,
    glPoints: result.glPoints,
    useGL: result.useGL,
    splitBreakdownLabel: result.splitBreakdownLabel,
    aiFeedback,
    premium_required: premiumRequired,
    cardioEnrichment: premium ? cardioEnrichment : null,
    tier1Prediction,
    predictedBenchmarkAfterSession:
      premium && benchmarkSport && newPredictedBenchmarkSeconds !== null
        ? {
            sport: benchmarkSport,
            benchmarkSeconds: newPredictedBenchmarkSeconds,
            sampleCount: newPredictedBenchmarkSampleCount,
          }
        : null,
  });
}
