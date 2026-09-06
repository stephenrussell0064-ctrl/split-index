import { NextResponse } from "next/server";
import { databaseError } from "@/lib/api/errors";
import { createClient } from "@/lib/supabase/server";
import { ScoringInputError } from "@/lib/scoring/service";
import { assertScoringInput } from "@/lib/scoring/input-guards";
import { isEnduranceSport } from "@/lib/scoring/engine";
import { mapSportToBenchmarkSport } from "@/lib/scoring/adapters";
import { SPORT_INDEX_LABELS } from "@/lib/constants/sports";
import { scoreAndPersist } from "@/lib/activities/score-and-persist";
import {
  assessMerge,
  mergedActivityBody,
  snapshotOf,
  MERGE_METADATA_VERSION,
  type MergePlan,
  type MergeSourceActivity,
} from "@/lib/activities/merge";

/**
 * POST /api/activities/merge — rejoin sessions that are one interrupted effort.
 *
 * The arithmetic lives in lib/activities/merge.ts; what this route owns is the
 * order the database is touched in, which is where a merge does its real
 * damage if it is got wrong.
 *
 * THE FAILURE MODE THIS ROUTE IS SHAPED AROUND. A merge is two writes that
 * must both happen: the surviving session takes on the combined numbers, and
 * the sessions it absorbed stop existing. If the second write fails after the
 * first has landed, the athlete's history now contains the whole run AND both
 * halves of it — every kilometre counted twice, in the logbook, in the weekly
 * totals, and (worst, because it is invisible) in the acute:chronic load ratio
 * that the injury-risk model reads. So the survivor is updated first and
 * restored from its own in-memory snapshot if the deletes fail: the only
 * states this route can leave behind are "merged" and "exactly as it was".
 *
 * WHAT THE DELETES HAVE TO CLEAN UP BY HAND. workout_scores, gym_exercises,
 * ai_feedback and the social reaction/comment rows are ON DELETE CASCADE from
 * activities and go on their own. Two are not:
 *
 *   - split_index_history.activity_id is ON DELETE SET NULL. Deleting an
 *     absorbed session without deleting its history row leaves a row with a
 *     null activity_id that no longer belongs to any session, cannot be
 *     recomputed away (recompute rebuilds from activities), and keeps its
 *     original recorded_at — so it goes on bending every Split Index trend
 *     line forever. It is deleted explicitly.
 *   - personal_records.activity_id is also ON DELETE SET NULL, and a record
 *     set on half a run is not a record. Those are deleted too; the merged
 *     session then re-competes for the same records on its own merits.
 *
 * And one that is neither: predicted_benchmarks.last_activity_id is SET NULL,
 * which quietly destroys the signal the re-score needs to know that the stored
 * race prediction already contains the absorbed sessions' evidence. It is read
 * BEFORE the delete and handed to scoreAndPersist as predictionBaseIsStale —
 * see that option's comment for why "the base is stale" must never be
 * expressed by passing a null base.
 */

interface MergeRequestBody {
  activityIds?: unknown;
  /** Compute and return the plan without writing anything. Drives the confirmation dialog. */
  dryRun?: unknown;
}

/** The plan, minus the merged polyline — hundreds of coordinate pairs the dialog has no use for. */
function previewOf(plan: MergePlan) {
  const { route, ...merged } = plan.merged;
  return {
    survivorId: plan.survivorId,
    absorbedIds: plan.absorbedIds,
    legs: plan.legs,
    merged,
    routePoints: route?.length ?? 0,
    totalGapSeconds: plan.totalGapSeconds,
    warnings: plan.warnings,
  };
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body: MergeRequestBody = await request.json();
  const requestedIds = Array.isArray(body.activityIds)
    ? [...new Set(body.activityIds.filter((id): id is string => typeof id === "string"))]
    : [];

  if (requestedIds.length < 2) {
    return NextResponse.json(
      { error: "Select at least two sessions to merge." },
      { status: 400 }
    );
  }

  const { data: rows, error: fetchError } = await supabase
    .from("activities")
    .select("*")
    .eq("user_id", user.id)
    .eq("is_draft", false)
    .in("id", requestedIds);

  if (fetchError) {
    return databaseError(fetchError, { operation: "POST /api/activities/merge" });
  }
  if (!rows || rows.length !== requestedIds.length) {
    return NextResponse.json(
      { error: "One of those sessions no longer exists." },
      { status: 404 }
    );
  }

  const snapshots: MergeSourceActivity[] = rows.map((row) =>
    snapshotOf(row as Record<string, unknown>)
  );

  const assessment = assessMerge(snapshots);
  if (!assessment.ok) {
    return NextResponse.json({ error: assessment.reason }, { status: 400 });
  }
  const plan = assessment.plan;
  const mergedBody = mergedActivityBody(plan.merged);

  // The merged session has to be a session the app would have accepted if it
  // had been logged that way in the first place — a sum can run past the
  // plausibility ceilings that a single leg sat comfortably inside.
  try {
    assertScoringInput({
      sport: mergedBody.sport,
      durationSeconds: mergedBody.duration_seconds,
      distanceMeters: mergedBody.distance_meters,
      avgHeartRate: mergedBody.avg_heart_rate,
      maxHeartRate: mergedBody.max_heart_rate,
      avgPowerWatts: mergedBody.avg_power_watts,
      avgPaceSecondsPerKm: mergedBody.avg_pace_seconds_per_km,
      avgSplitSeconds: mergedBody.avg_split_seconds,
      elevationMeters: mergedBody.elevation_meters,
      rpe: mergedBody.rpe,
    });
  } catch (err) {
    if (err instanceof ScoringInputError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  if (body.dryRun === true) {
    return NextResponse.json({ preview: previewOf(plan) });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("user_id", user.id)
    .single();

  if (!profile) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  const survivorRow = rows.find((r) => r.id === plan.survivorId) as Record<string, unknown>;
  const survivorSnapshot = snapshotOf(survivorRow);
  const survivorMetadata = (survivorRow.metadata ?? {}) as Record<string, unknown>;

  // Read before the delete: activities(id) ON DELETE SET NULL is about to
  // erase this link if it points at a session being absorbed.
  let predictionBaseIsStale = false;
  if (isEnduranceSport(plan.merged.sport as never)) {
    const { data: priorPrediction } = await supabase
      .from("predicted_benchmarks")
      .select("last_activity_id")
      .eq("user_id", user.id)
      .eq("sport", mapSportToBenchmarkSport(plan.merged.sport as never))
      .maybeSingle();
    const lastId = priorPrediction?.last_activity_id as string | null | undefined;
    predictionBaseIsStale =
      lastId != null && (lastId === plan.survivorId || plan.absorbedIds.includes(lastId));
  }

  const { route, ...mergedColumns } = plan.merged;
  const mergedMetadata: Record<string, unknown> = {
    ...survivorMetadata,
    ...(route ? { route } : {}),
    merge: {
      version: MERGE_METADATA_VERSION,
      mergedAt: new Date().toISOString(),
      totalGapSeconds: plan.totalGapSeconds,
      // Every leg as it was, the survivor included — this is the entire undo.
      sources: snapshots.map((s) => ({ ...s, wasSurvivor: s.id === plan.survivorId })),
    },
  };
  if (!route) delete mergedMetadata.route;

  const { error: updateError } = await supabase
    .from("activities")
    .update({
      ...mergedColumns,
      metadata: mergedMetadata,
      updated_at: new Date().toISOString(),
    })
    .eq("id", plan.survivorId)
    .eq("user_id", user.id);

  if (updateError) {
    return databaseError(updateError, { operation: "POST /api/activities/merge" });
  }

  const deleteError = await deleteAbsorbed(supabase, user.id, plan.absorbedIds);
  if (deleteError) {
    // Put the survivor back exactly as it was rather than leave a history in
    // which this run exists both whole and in halves.
    const { error: restoreError } = await supabase
      .from("activities")
      .update({ ...survivorSnapshot, metadata: survivorMetadata })
      .eq("id", plan.survivorId)
      .eq("user_id", user.id);

    console.error("[activities/merge] delete failed:", deleteError);
    return NextResponse.json(
      {
        error: restoreError
          ? "We could not finish merging these sessions, and could not undo the change either. Check your logbook before trying again."
          : "We could not finish merging these sessions. Nothing was changed — please try again.",
      },
      { status: 500 }
    );
  }

  const scored = await scoreAndPersist(
    supabase,
    user.id,
    profile,
    mergedBody,
    plan.survivorId,
    {
      // Both the survivor's own now-stale rows and the absorbed sessions'
      // (already deleted, but their workout_scores may still be inside the
      // 50-row window this reads) are kept out of the history the merged
      // session is scored against.
      excludeActivityIds: [plan.survivorId, ...plan.absorbedIds],
      existingMetadata: mergedMetadata,
      predictionBaseIsStale,
    }
  );

  // Scoring REPLACES the survivor's score rather than updating it, so a failed
  // insert here does not leave the old score standing — it leaves the merged
  // session with none at all. Read as `scored.workoutScore` only, that arrived
  // as null and this answered 200 anyway, with `sportIndex` and `splitIndex`
  // taken from the in-memory `result` the athlete's database never received: a
  // success screen quoting a score that does not exist, and a logbook entry
  // that has lost one.
  //
  // No rollback. By this point the absorbed sessions are deleted and the
  // survivor carries the merged columns, and the entire undo is already sitting
  // in its metadata.merge.sources — the athlete can unmerge, which is a better
  // recovery than a route silently re-inserting rows in a failure path that has
  // no test covering it. Retrying the merge is safe too: the absorbed ids no
  // longer resolve, so a second POST is rejected with 404 before it can touch
  // anything.
  if (scored.workoutScoreError || !scored.workoutScore) {
    console.error(
      "[activities/merge] workout_scores insert failed for survivor",
      plan.survivorId,
      scored.workoutScoreError?.message
    );
    return NextResponse.json(
      {
        error:
          "We merged these sessions but could not score the result. The merged session is in your logbook — open it and undo the merge, or edit it to try again.",
      },
      { status: 500 }
    );
  }

  const { data: activity } = await supabase
    .from("activities")
    .select("*")
    .eq("id", plan.survivorId)
    .eq("user_id", user.id)
    .single();

  return NextResponse.json({
    activity,
    score: scored.workoutScore,
    mergedActivityId: plan.survivorId,
    absorbedActivityIds: plan.absorbedIds,
    preview: previewOf(plan),
    sport: plan.merged.sport,
    sportLabel: SPORT_INDEX_LABELS[plan.merged.sport as keyof typeof SPORT_INDEX_LABELS],
    sportIndex: scored.result.sportIndex,
    splitIndex: scored.result.splitIndex,
    previousSplitIndex: scored.previousSplitIndex,
  });
}

/**
 * Removes the absorbed sessions and the rows that would otherwise outlive
 * them. Order matters: the two SET NULL children go first, while they can
 * still be found by activity_id.
 */
async function deleteAbsorbed(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  absorbedIds: string[]
): Promise<string | null> {
  const { error: historyError } = await supabase
    .from("split_index_history")
    .delete()
    .eq("user_id", userId)
    .in("activity_id", absorbedIds);
  if (historyError) return historyError.message;

  const { error: recordsError } = await supabase
    .from("personal_records")
    .delete()
    .eq("user_id", userId)
    .in("activity_id", absorbedIds);
  if (recordsError) return recordsError.message;

  const { error: activitiesError } = await supabase
    .from("activities")
    .delete()
    .eq("user_id", userId)
    .in("id", absorbedIds);
  if (activitiesError) return activitiesError.message;

  return null;
}
