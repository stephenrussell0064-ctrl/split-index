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
import { cardioResultToEnrichment } from "@/lib/scoring/adapters";
import type { CardioResult } from "@/lib/scoring/cardio-activity";
import { isEnduranceSport } from "@/lib/scoring/engine";
import { isPremiumUser } from "@/lib/retention/trial";
import { serializeScoreBreakdown } from "@/lib/scoring/presentation";
import type { ActivityFormData, Profile } from "@/types";
import {
  buildScoringProfile,
  resolveScoringBodyweightKg,
  resolveEffectiveMaxHr,
} from "@/lib/activities/bodyweight";
import { bestSet, summarizeSets } from "@/lib/activities/gym-sets";

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
      score_breakdown: result.breakdown,
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

  const sportComparison = computeSportComparison(result.sportIndex, priorSportScores);

  return {
    workoutScore,
    result,
    previousSplitIndex,
    sportComparison,
    isFirstSportSession: priorSportScores.length === 0,
    scoringProfile,
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
