import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
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
import { isPremiumUser } from "@/lib/retention/trial";
import type { GymExercise } from "@/types";
import type { LoggedSet } from "@/lib/scoring/split-strength-engine";

/**
 * Re-scores every one of the caller's own past activities with the current
 * scoring engine and overwrites the stored workout_scores / split_index_history
 * / strength_scores rows. Needed because scores are computed once at log time
 * and persisted — a scoring-formula change (e.g. effort-normalized cardio
 * scoring) never touches historical rows on its own.
 *
 * Runs oldest-first so each activity's index/trend context is rebuilt from
 * the other newly-recomputed scores in this same pass, not stale DB values.
 */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("user_id", user.id)
    .single();

  if (!profile) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  const { data: activities, error: activitiesError } = await supabase
    .from("activities")
    .select("*")
    .eq("user_id", user.id)
    .eq("is_draft", false)
    .order("started_at", { ascending: true });

  if (activitiesError) {
    return NextResponse.json({ error: activitiesError.message }, { status: 500 });
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

  // Built incrementally, oldest-first, so scoring activity N only ever sees
  // history from activities strictly before it — never a future session's
  // sets influencing a past one's adaptive 1RM estimate.
  const exerciseHistory: Record<string, LoggedSet[]> = {};

  for (const activity of activities ?? []) {
    const metadata = activity.metadata as Record<string, unknown> | null;
    const bodyweightKg = resolveScoringBodyweightKg(activity.sport, {
      activityMetadata: metadata,
      profileWeightKg: profile.weight_kg,
    });
    const scoringProfile = buildScoringProfile(profile, bodyweightKg, effectiveMaxHr);
    const loads = computeRecentLoads(recentScoreLoads);
    const exercises = (exercisesByActivity.get(activity.id as string) ?? [])
      .sort((a, b) => a.order_index - b.order_index)
      .map((ex, i) => ({
        exercise_name: ex.exercise_name,
        muscle_group: ex.muscle_group,
        sets: setsForExercise(ex),
        order_index: i,
      }));

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

      await supabase.from("workout_scores").delete().eq("activity_id", activity.id);
      await supabase.from("workout_scores").insert({
        activity_id: activity.id,
        user_id: user.id,
        sport: activity.sport,
        sport_index: result.sportIndex,
        endurance_component: result.enduranceComponent,
        strength_component: result.strengthComponent,
        fatigue_impact: result.fatigueScore,
        load_score: result.loadScore,
        score_breakdown: result.breakdown,
      });

      await supabase.from("split_index_history").delete().eq("activity_id", activity.id);
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

      if (activity.sport === "gym" && result.strengthScoreRows?.length) {
        await supabase.from("strength_scores").delete().eq("activity_id", activity.id);
        await supabase.from("strength_scores").insert(
          buildStrengthScoreInserts(
            user.id,
            activity.id,
            activity.started_at,
            result.strengthScoreRows
          )
        );
      }

      recentActivityRows.unshift({
        sport: activity.sport,
        sport_index: result.sportIndex,
        started_at: activity.started_at,
        score_breakdown: result.breakdown as unknown as Record<string, unknown>,
      });
      if (result.enduranceComponent != null) enduranceIndices.push(result.enduranceComponent);
      if (result.strengthComponent != null) strengthIndices.push(result.strengthComponent);
      splitIndices.push(result.splitIndex);
      recentScoreLoads.push({ load_score: result.loadScore, created_at: activity.started_at });

      recomputed += 1;
    } catch (err) {
      failures.push({
        id: activity.id,
        error: err instanceof ScoringInputError ? err.message : "Unknown error",
      });
    }
  }

  return NextResponse.json({
    total: activities?.length ?? 0,
    recomputed,
    failed: failures.length,
    failures,
  });
}
