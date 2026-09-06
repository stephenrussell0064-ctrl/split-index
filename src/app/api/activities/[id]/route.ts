import { NextResponse } from "next/server";
import { databaseError, serverError } from "@/lib/api/errors";
import { createClient } from "@/lib/supabase/server";
import { ScoringInputError } from "@/lib/scoring/service";
import { assertScoringInput } from "@/lib/scoring/input-guards";
import { SPORT_INDEX_LABELS } from "@/lib/constants/sports";
import { enrichCardioScore } from "@/lib/scoring/cardio";
import { cardioResultToEnrichment } from "@/lib/scoring/adapters";
import type { CardioResult } from "@/lib/scoring/cardio-activity";
import { isEnduranceSport } from "@/lib/scoring/engine";
import { isPremiumUser } from "@/lib/retention/trial";
import { serializeScoreBreakdown } from "@/lib/scoring/presentation";
import type { WeightEntryMode } from "@/lib/scoring/weight-entry";
import { defaultWeightEntryMode } from "@/lib/scoring/weight-entry";
import { buildGymExerciseRows, insertGymExercises } from "@/lib/activities/gym-exercise-rows";
import {
  scoreAndPersist,
  type ScoreAndPersistBody,
} from "@/lib/activities/score-and-persist";

type ActivityBody = ScoreAndPersistBody;

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
    return serverError({
      operation: "PATCH /api/activities/[id]",
      cause: updateError,
    });
  }

  // An edit replaces the exercise list wholesale, so the old rows are read
  // BEFORE they are deleted: if the replacement insert fails, this is the only
  // copy of what the athlete had logged, and putting it back is the difference
  // between a rejected edit and a session that silently lost every exercise.
  //
  // The delete stays UNCONDITIONAL, as it has always been: an edit that
  // changes a gym session into a run sends no exercises at all, and those rows
  // have to go with it rather than being left behind attached to a cardio
  // session.
  const { data: previousExerciseRows } = await supabase
    .from("gym_exercises")
    .select("*")
    .eq("activity_id", id)
    .order("order_index");

  await supabase.from("gym_exercises").delete().eq("activity_id", id);

  if (body.exercises && body.exercises.length > 0) {
    const { error: exercisesError, droppedColumns } = await insertGymExercises(
      supabase,
      buildGymExerciseRows(id, body.exercises)
    );
    if (droppedColumns.length > 0) {
      console.error(
        "[activities] gym_exercises is missing column(s), saved without them:",
        droppedColumns.join(", ")
      );
    }
    // Previously this insert's error was not read at all. Because the delete
    // above had already run, a failure here left the activity with NO
    // exercises behind a success response — the session kept its old score
    // until anything recomputed it, and then had nothing to score. That is the
    // "gym exercise logged but no strength score" report. The edit is now
    // rejected and the athlete's original exercises are put back.
    if (exercisesError) {
      console.error("[activities] gym_exercises replace failed:", exercisesError.message);
      const restored = previousExerciseRows?.length
        ? !(await supabase.from("gym_exercises").insert(previousExerciseRows)).error
        : true;
      return NextResponse.json(
        {
          error: restored
            ? "We could not save these changes. The session is unchanged — please try again."
            : "We could not save these changes, and could not restore the original exercises either. Check your logbook before trying again.",
        },
        { status: 500 }
      );
    }
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
    scored = await scoreAndPersist(supabase, user.id, profile, body, id, {
      excludeActivityIds: [id],
      existingMetadata: existing.metadata as Record<string, unknown>,
      anchoredBodyweightKg: priorStrength?.bodyweight_kg ?? null,
    });
  } catch (err) {
    if (err instanceof ScoringInputError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  const {
    workoutScore,
    workoutScoreError,
    result,
    previousSplitIndex,
    sportComparison,
    isFirstSportSession,
    scoringProfile,
    tier1Prediction,
    predictedBenchmarkAfterSession,
  } = scored;

  // Rescoring replaces the score rather than updating them, so a failed insert
  // leaves the session UNSCORED. Answering 200 here is what put a workout in
  // the logbook with its strength score missing and nothing anywhere saying
  // why. The edit's other changes did land, so this deliberately does not
  // claim nothing happened — it says the score did not.
  if (workoutScoreError || !workoutScore) {
    return NextResponse.json(
      {
        error:
          "We saved your changes but could not rescore the session. Open it again to retry before logging anything else.",
      },
      { status: 500 }
    );
  }

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

  /*
    EVERYTHING THAT POINTS AT THIS SESSION, not just the index history.

    Both of the tables below are `ON DELETE SET NULL`, so deleting the activity
    does not delete them — it orphans them. The merge route already cleans up
    exactly these two and explains why; delete was written first and never
    caught up.

    A personal record is the one that bites. Its row survives with a null
    activity_id, still occupying the UNIQUE(user_id, sport, metric) slot, and
    because records are upserted only when the new value is BETTER, nothing can
    ever displace it. The athlete deletes a mistyped 4:02 mile and is congratulated
    on it forever, with no session behind it to open.
  */
  await supabase.from("split_index_history").delete().eq("activity_id", id);
  await supabase
    .from("personal_records")
    .delete()
    .eq("user_id", user.id)
    .eq("activity_id", id);

  /*
    The stored race prediction is different: it is not deleted, it is
    invalidated. `predicted_benchmarks.last_activity_id` is the marker saying
    "the prediction already contains this session's evidence" — SET NULL erases
    the marker while leaving the prediction, so the next run would be blended
    into a base that silently still includes the deleted one. Clearing the base
    makes the next scored session rebuild it honestly.
  */
  await supabase
    .from("predicted_benchmarks")
    .delete()
    .eq("user_id", user.id)
    .eq("last_activity_id", id);

  const { error } = await supabase.from("activities").delete().eq("id", id);

  if (error) {
    return databaseError(error, { operation: "DELETE /api/activities/[id]" });
  }

  return NextResponse.json({ success: true });
}
