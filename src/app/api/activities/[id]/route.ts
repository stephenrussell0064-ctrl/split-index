import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  scoreActivity,
  computeRecentLoads,
  computeExercise1RM,
  buildStrengthScoreInserts,
  ScoringInputError,
} from "@/lib/scoring/service";
import { assertScoringInput } from "@/lib/scoring/input-guards";
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
  replayStoredPredictionFromSessions,
  type HistorySession,
} from "@/lib/scoring/cardio/race-prediction";
import { isEnduranceSport } from "@/lib/scoring/engine";
import { isPremiumUser } from "@/lib/retention/trial";
import { serializeScoreBreakdown } from "@/lib/scoring/presentation";
import type { ActivityFormData, Profile } from "@/types";
import type { WeightEntryMode } from "@/lib/scoring/weight-entry";
import {
  upsertPersonalRecordsIfBetter,
  enduranceRecordCandidates,
  gymRecordCandidates,
  type PersonalRecordCandidate,
} from "@/lib/activities/personal-records";
import { defaultWeightEntryMode } from "@/lib/scoring/weight-entry";
import {
  buildScoringProfile,
  resolveScoringBodyweightKg,
  resolveEffectiveMaxHr,
} from "@/lib/activities/bodyweight";
import { bestSet, summarizeSets } from "@/lib/activities/gym-sets";
import { fetchExerciseHistory } from "@/lib/activities/exercise-history";

type ActivityBody = ActivityFormData & {
  bodyweight_kg?: number;
  exercise_notes?: Record<string, string>;
};

function buildActivityMetadata(
  existing: Record<string, unknown> | null | undefined,
  body: ActivityBody
): Record<string, unknown> {
  const metadata = { ...(existing ?? {}) };
  if (body.bodyweight_kg) {
    metadata.bodyweight_kg = body.bodyweight_kg;
  }
  if (body.exercise_notes && Object.keys(body.exercise_notes).length > 0) {
    metadata.exercise_notes = body.exercise_notes;
  }
  if (body.exercises?.length) {
    const modes: Record<string, WeightEntryMode> = {};
    for (const ex of body.exercises) {
      modes[ex.exercise_name] =
        ex.weight_entry_mode ?? defaultWeightEntryMode(ex.exercise_name);
    }
    metadata.exercise_weight_modes = modes;
  }
  return metadata;
}

async function scoreAndPersist(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  profile: Profile,
  body: ActivityBody,
  activityId: string,
  excludeActivityId?: string,
  existingMetadata?: Record<string, unknown> | null,
  anchoredBodyweightKg?: number | null
) {
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
    (s) => s.activity_id !== excludeActivityId
  );

  const { data: recentSameSportRaw } = await supabase
    .from("workout_scores")
    .select("sport_index, created_at, activity_id")
    .eq("user_id", userId)
    .eq("sport", body.sport)
    .order("created_at", { ascending: false })
    .limit(10);
  const priorSportScores = (recentSameSportRaw ?? [])
    .filter((s) => s.activity_id !== excludeActivityId)
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
    (h) => h.activity_id !== excludeActivityId
  );

  const premium = isPremiumUser(profile.subscription_tier, profile.subscription_status);
  const exerciseHistory =
    body.sport === "gym" && body.exercises?.length
      ? await fetchExerciseHistory(
          supabase,
          userId,
          body.exercises.map((ex) => ex.exercise_name),
          excludeActivityId
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
    const priorIsThisActivity = priorPrediction?.last_activity_id === excludeActivityId;

    const windowCutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const { data: windowActivities } = await supabase
      .from("activities")
      .select(
        "sport, started_at, duration_seconds, distance_meters, avg_heart_rate, session_type, elevation_meters, temperature_celsius, workout_scores(sport_index)"
      )
      .eq("user_id", userId)
      .eq("is_draft", false)
      .neq("id", excludeActivityId ?? "")
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

    // Easy-session score floor — see EASY_SCORE_FLOOR_FRACTION's doc comment
    // in cardio-activity.ts. Reuses the same window/exclusion already
    // fetched above (excludeActivityId keeps this activity's OWN previous
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
    },
    {
      enduranceIndices,
      strengthIndices,
      splitIndices: indexHistory?.map((h) => h.split_index) ?? [],
    }
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

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: activity, error } = await supabase
    .from("activities")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (error || !activity) {
    return NextResponse.json({ error: "Activity not found" }, { status: 404 });
  }

  const [{ data: exercises }, { data: scoreRaw }, { data: profile }] =
    await Promise.all([
      supabase
        .from("gym_exercises")
        .select("*")
        .eq("activity_id", id)
        .order("order_index"),
      supabase.from("workout_scores").select("*").eq("activity_id", id).single(),
      supabase
        .from("profiles")
        .select("subscription_tier, subscription_status")
        .eq("user_id", user.id)
        .single(),
    ]);

  const premium = profile
    ? isPremiumUser(profile.subscription_tier, profile.subscription_status)
    : false;

  const score = scoreRaw
    ? {
        ...scoreRaw,
        score_breakdown: serializeScoreBreakdown(
          scoreRaw.score_breakdown,
          premium
        ),
      }
    : scoreRaw;

  return NextResponse.json({ activity, exercises: exercises ?? [], score });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body: ActivityBody = await request.json();

  const { data: existing, error: fetchError } = await supabase
    .from("activities")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (fetchError || !existing) {
    return NextResponse.json({ error: "Activity not found" }, { status: 404 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("user_id", user.id)
    .single();

  if (!profile) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  const metadata = buildActivityMetadata(
    existing.metadata as Record<string, unknown>,
    body
  );

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
      profile,
    });
  } catch (err) {
    if (err instanceof ScoringInputError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  const { data: priorStrength } = await supabase
    .from("strength_scores")
    .select("bodyweight_kg")
    .eq("activity_id", id)
    .limit(1)
    .maybeSingle();

  const { data: activity, error: updateError } = await supabase
    .from("activities")
    .update({
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
      temperature_celsius: body.temperature_celsius,
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
      metadata,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select()
    .single();

  if (updateError || !activity) {
    return NextResponse.json(
      { error: updateError?.message ?? "Failed to update activity" },
      { status: 500 }
    );
  }

  await supabase.from("gym_exercises").delete().eq("activity_id", id);

  if (body.exercises && body.exercises.length > 0) {
    const exerciseRows = body.exercises.map((ex, i) => {
      const summary = summarizeSets(ex.sets);
      const top = bestSet(ex.sets);
      return {
        activity_id: id,
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
    await supabase.from("gym_exercises").insert(exerciseRows);
  }

  if (body.bodyweight_kg && body.sport === "gym") {
    await supabase.from("body_metrics").insert({
      user_id: user.id,
      weight_kg: body.bodyweight_kg,
      recorded_at: body.started_at,
    });
  }

  let scored;
  try {
    scored = await scoreAndPersist(
      supabase,
      user.id,
      profile,
      body,
      id,
      id,
      existing.metadata as Record<string, unknown>,
      priorStrength?.bodyweight_kg ?? null
    );
  } catch (err) {
    if (err instanceof ScoringInputError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  const {
    workoutScore,
    result,
    previousSplitIndex,
    sportComparison,
    isFirstSportSession,
    scoringProfile,
    tier1Prediction,
    predictedBenchmarkAfterSession,
  } = scored;

  const premium = isPremiumUser(
    profile.subscription_tier,
    profile.subscription_status
  );

  let cardioEnrichment = null;
  if (isEnduranceSport(body.sport)) {
    const cardioActivity = result.breakdown.cardio_activity as
      | CardioResult
      | undefined;
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

    if (cardioEnrichment && workoutScore) {
      await supabase
        .from("workout_scores")
        .update({
          score_breakdown: {
            ...result.breakdown,
            cardio_enrichment: cardioEnrichment,
            ...(predictedBenchmarkAfterSession
              ? { predicted_benchmark_after_session: predictedBenchmarkAfterSession }
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
    cardioEnrichment: premium ? cardioEnrichment : null,
    tier1Prediction,
    predictedBenchmarkAfterSession: premium ? predictedBenchmarkAfterSession : null,
  });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: existing } = await supabase
    .from("activities")
    .select("id")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (!existing) {
    return NextResponse.json({ error: "Activity not found" }, { status: 404 });
  }

  await supabase.from("split_index_history").delete().eq("activity_id", id);

  const { error } = await supabase.from("activities").delete().eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
