import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { scoreActivity, computeRecentLoads, computeExercise1RM, buildStrengthScoreInserts } from "@/lib/scoring/service";
import { generateCoachFeedback, generateRulesBasedSnippet, type IndexHistoryEntry } from "@/lib/openai/coach";
import { computeSportComparison } from "@/lib/utils/sport-comparison";
import { SPORT_INDEX_LABELS } from "@/lib/constants/sports";
import { enrichCardioScore } from "@/lib/scoring/cardio";
import { isEnduranceSport } from "@/lib/scoring/engine";
import { canAccessProfile } from "@/lib/premium/features";
import type { ActivityFormData, GymExercise } from "@/types";

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

  const bodyweightKg =
    typeof body.bodyweight_kg === "number" && body.bodyweight_kg > 0
      ? body.bodyweight_kg
      : null;

  const scoringProfile = bodyweightKg
    ? { ...profile, weight_kg: bodyweightKg }
    : profile;

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

  const loads = computeRecentLoads(recentScores ?? []);

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
      temperature_celsius: body.temperature_celsius,
      session_type: body.session_type,
      rpe: body.rpe,
      notes: body.notes,
      is_draft: false,
      source: "manual",
      metadata: {
        ...(bodyweightKg ? { bodyweight_kg: bodyweightKg } : {}),
        ...(body.exercise_notes ? { exercise_notes: body.exercise_notes } : {}),
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
    const exerciseRows = body.exercises.map((ex, i) => ({
      activity_id: activity.id,
      exercise_name: ex.exercise_name,
      muscle_group: ex.muscle_group,
      weight_kg: ex.weight_kg,
      sets: ex.sets,
      reps: ex.reps,
      rpe: ex.rpe,
      estimated_1rm_kg: computeExercise1RM(ex.weight_kg, ex.reps),
      order_index: i,
    }));

    await supabase.from("gym_exercises").insert(exerciseRows);
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

  const result = scoreActivity(
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
      exercises: body.exercises,
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

  const { data: workoutScore } = await supabase
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
      score_breakdown: result.breakdown,
    })
    .select()
    .single();

  await supabase.from("split_index_history").insert({
    user_id: user.id,
    split_index: result.splitIndex,
    endurance_index: result.enduranceIndex,
    strength_index: result.strengthIndex,
    fatigue_score: result.fatigueScore,
    recovery_score: result.recoveryScore,
    predicted_index_7d: result.predictedIndex,
    activity_id: activity.id,
  });

  if (body.sport === "gym" && result.strengthScoreRows?.length) {
    await supabase.from("strength_scores").delete().eq("activity_id", activity.id);
    await supabase.from("strength_scores").insert(
      buildStrengthScoreInserts(
        user.id,
        activity.id,
        body.started_at,
        result.strengthScoreRows
      )
    );
  }

  await supabase.from("workout_drafts").delete().eq("user_id", user.id).eq("sport", body.sport);

  let aiFeedback = null;
  let premiumRequired = false;
  if (workoutScore) {
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
  }

  const sportComparison = computeSportComparison(result.sportIndex, priorSportScores);
  const isFirstSportSession = priorSportScores.length === 0;

  let cardioEnrichment = null;
  if (isEnduranceSport(body.sport)) {
    cardioEnrichment = enrichCardioScore({
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
    sportComparison,
    isFirstSportSession,
    exerciseScores: result.exerciseScores,
    scoreBreakdown: result.breakdown,
    dotsScore: result.dotsScore,
    glPoints: result.glPoints,
    useGL: result.useGL,
    splitBreakdownLabel: result.splitBreakdownLabel,
    aiFeedback,
    premium_required: premiumRequired,
    cardioEnrichment,
  });
}
