import type { SupabaseClient } from "@supabase/supabase-js";
import { scoreActivity, computeRecentLoads, computeExercise1RM } from "@/lib/scoring/service";
import type { ActivityFormData, Profile } from "@/types";
import type {
  ActivitySource,
  ExternalActivity,
  ImportJobRow,
  ImportPipelineResult,
  ImportStep,
} from "./types";
import { findManualDuplicateActivity } from "./sync-helpers";

interface ImportContext {
  supabase: SupabaseClient;
  userId: string;
  profile: Profile;
  source: ActivitySource;
  onProgress?: (update: Partial<ImportJobRow> & { step?: ImportStep }) => Promise<void>;
}

async function backupDrafts(supabase: SupabaseClient, userId: string) {
  const { data: drafts } = await supabase
    .from("workout_drafts")
    .select("*")
    .eq("user_id", userId);
  return drafts ?? [];
}

async function loadScoringContext(supabase: SupabaseClient, userId: string) {
  const { data: recentScores } = await supabase
    .from("workout_scores")
    .select("load_score, created_at, sport_index, endurance_component, strength_component")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(50);

  const loads = computeRecentLoads(recentScores ?? []);

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
    .select("split_index")
    .eq("user_id", userId)
    .order("recorded_at", { ascending: true })
    .limit(30);

  return {
    loads,
    enduranceIndices,
    strengthIndices,
    splitIndices: indexHistory?.map((h) => h.split_index) ?? [],
  };
}

async function activityExists(
  supabase: SupabaseClient,
  userId: string,
  source: ActivitySource,
  externalId: string
): Promise<boolean> {
  const { data } = await supabase
    .from("activities")
    .select("id")
    .eq("user_id", userId)
    .eq("source", source)
    .eq("external_id", externalId)
    .maybeSingle();
  return !!data;
}

async function insertAndScoreActivity(
  ctx: ImportContext,
  activity: ExternalActivity,
  scoringCtx: Awaited<ReturnType<typeof loadScoringContext>>
): Promise<{ activityId: string } | { error: string }> {
  const { supabase, userId, profile } = ctx;
  const body: ActivityFormData = activity;

  const { data: inserted, error: activityError } = await supabase
    .from("activities")
    .insert({
      user_id: userId,
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
      source: activity.source,
      external_id: activity.external_id,
      is_draft: false,
      metadata: { imported: true },
    })
    .select()
    .single();

  if (activityError || !inserted) {
    if (activityError?.code === "23505") {
      return { error: "duplicate" };
    }
    return { error: activityError?.message ?? "Failed to insert activity" };
  }

  if (body.exercises && body.exercises.length > 0) {
    const exerciseRows = body.exercises.map((ex, i) => ({
      activity_id: inserted.id,
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
      profile,
      recentLoads: scoringCtx.loads,
    },
    {
      enduranceIndices: scoringCtx.enduranceIndices,
      strengthIndices: scoringCtx.strengthIndices,
      splitIndices: scoringCtx.splitIndices,
    }
  );

  await supabase.from("workout_scores").insert({
    activity_id: inserted.id,
    user_id: userId,
    sport: body.sport,
    sport_index: result.sportIndex,
    endurance_component: result.enduranceComponent,
    strength_component: result.strengthComponent,
    fatigue_impact: result.fatigueScore,
    load_score: result.loadScore,
    score_breakdown: result.breakdown,
  });

  await supabase.from("split_index_history").insert({
    user_id: userId,
    split_index: result.splitIndex,
    endurance_index: result.enduranceIndex,
    strength_index: result.strengthIndex,
    fatigue_score: result.fatigueScore,
    recovery_score: result.recoveryScore,
    predicted_index_7d: result.predictedIndex,
    activity_id: inserted.id,
  });

  scoringCtx.enduranceIndices.push(result.enduranceIndex);
  scoringCtx.strengthIndices.push(result.strengthIndex);
  scoringCtx.splitIndices.push(result.splitIndex);
  scoringCtx.loads.acute += result.loadScore;

  return { activityId: inserted.id };
}

export async function importActivities(
  ctx: ImportContext,
  activities: ExternalActivity[]
): Promise<ImportPipelineResult> {
  const result: ImportPipelineResult = {
    imported: 0,
    skipped: 0,
    failed: 0,
    errors: [],
    activityIds: [],
  };

  await ctx.onProgress?.({
    step: "validating",
    status: "validating",
    progress_pct: 10,
    total: activities.length,
  });

  const scoringCtx = await loadScoringContext(ctx.supabase, ctx.userId);

  await ctx.onProgress?.({
    step: "scoring",
    status: "scoring",
    progress_pct: 20,
    total: activities.length,
    processed: 0,
  });

  for (let i = 0; i < activities.length; i++) {
    const activity = activities[i];

    try {
      const exists = await activityExists(
        ctx.supabase,
        ctx.userId,
        activity.source,
        activity.external_id
      );

      if (exists) {
        result.skipped++;
        continue;
      }

      const manualDup = await findManualDuplicateActivity(
        ctx.supabase,
        ctx.userId,
        activity
      );
      if (manualDup) {
        result.skipped++;
        continue;
      }

      const insertResult = await insertAndScoreActivity(ctx, activity, scoringCtx);

      if ("error" in insertResult) {
        if (insertResult.error === "duplicate") {
          result.skipped++;
        } else {
          result.failed++;
          result.errors.push({
            external_id: activity.external_id,
            message: insertResult.error,
          });
        }
      } else {
        result.imported++;
        result.activityIds.push(insertResult.activityId);
      }
    } catch (err) {
      result.failed++;
      result.errors.push({
        external_id: activity.external_id,
        message: err instanceof Error ? err.message : "Unknown error",
      });
    }

    const processed = i + 1;
    const progress_pct = Math.round(20 + (processed / activities.length) * 75);

    await ctx.onProgress?.({
      step: "scoring",
      status: "scoring",
      progress_pct,
      processed,
      imported: result.imported,
      skipped: result.skipped,
      failed: result.failed,
      errors: result.errors,
    });
  }

  await ctx.onProgress?.({
    step: "done",
    status: "completed",
    progress_pct: 100,
    processed: activities.length,
    imported: result.imported,
    skipped: result.skipped,
    failed: result.failed,
    errors: result.errors,
  });

  return result;
}

export async function runImportJob(
  supabase: SupabaseClient,
  userId: string,
  jobId: string,
  activities: ExternalActivity[],
  source: ActivitySource
): Promise<ImportPipelineResult> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("user_id", userId)
    .single();

  if (!profile) {
    throw new Error("Profile not found");
  }

  const draftBackup = await backupDrafts(supabase, userId);
  await supabase
    .from("import_jobs")
    .update({ draft_backup: { drafts: draftBackup } })
    .eq("id", jobId)
    .eq("user_id", userId);

  const updateJob = async (
    update: Partial<ImportJobRow> & { step?: ImportStep }
  ) => {
    await supabase
      .from("import_jobs")
      .update({
        step: update.step,
        status: update.status,
        progress_pct: update.progress_pct,
        total: update.total,
        processed: update.processed,
        imported: update.imported,
        skipped: update.skipped,
        failed: update.failed,
        errors: update.errors,
      })
      .eq("id", jobId)
      .eq("user_id", userId);
  };

  const pipelineResult = await importActivities(
    {
      supabase,
      userId,
      profile,
      source,
      onProgress: updateJob,
    },
    activities
  );

  await supabase
    .from("import_jobs")
    .update({
      status: "completed",
      step: "done",
      progress_pct: 100,
      result: pipelineResult,
      completed_at: new Date().toISOString(),
    })
    .eq("id", jobId)
    .eq("user_id", userId);

  return pipelineResult;
}

export { backupDrafts };
