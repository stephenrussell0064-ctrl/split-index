import { NextResponse } from "next/server";
import { databaseError } from "@/lib/api/errors";
import { createClient } from "@/lib/supabase/server";
import { scoreAndPersist } from "@/lib/activities/score-and-persist";
import { ScoringInputError } from "@/lib/scoring/service";
import { readMergeRecord, type MergeSourceActivity } from "@/lib/activities/merge";
import type { ActivityFormData, SessionType, SportType } from "@/types";

/**
 * POST /api/activities/[id]/unmerge — put a merged session back into the
 * sessions it was made from.
 *
 * Merging deletes rows, and an accidental merge would otherwise cost the
 * athlete real training history with no way back. Rather than making merging
 * non-destructive (which would mean teaching two dozen read paths across the
 * app to ignore "absorbed" activities), the merge writes a complete snapshot
 * of every leg — the surviving one included — into the merged session's
 * metadata, and this route replays it.
 *
 * The restored legs are re-inserted under their ORIGINAL ids, so anything that
 * still holds a link to one of them (a bookmarked activity page, a share URL)
 * points back at the same session it always did.
 *
 * WHAT DOES NOT COME BACK. Deleting an absorbed session cascaded away its
 * reactions and comments, and its AI feedback; those are gone for good, and
 * the merge dialog says so before it happens. Personal records are re-derived
 * from the restored sessions rather than restored, which is the same
 * incremental-versus-authoritative gap the create and edit routes already have
 * — POST /api/activities/recompute is the full rebuild if the athlete wants
 * every record recomputed from scratch.
 */

function restoredRow(
  snapshot: MergeSourceActivity & { wasSurvivor: boolean },
  userId: string
): Record<string, unknown> {
  const columns: Record<string, unknown> = { ...snapshot };
  delete columns.wasSurvivor;
  return {
    ...columns,
    user_id: userId,
    is_draft: false,
    updated_at: new Date().toISOString(),
  };
}

/** The snapshot as the scoring path's activity body. */
function bodyOf(snapshot: MergeSourceActivity): ActivityFormData {
  const optional = <T>(value: T | null | undefined): T | undefined =>
    value == null ? undefined : value;
  return {
    sport: snapshot.sport as SportType,
    title: optional(snapshot.title),
    started_at: snapshot.started_at,
    duration_seconds: snapshot.duration_seconds,
    distance_meters: optional(snapshot.distance_meters),
    elevation_meters: optional(snapshot.elevation_meters),
    avg_heart_rate: optional(snapshot.avg_heart_rate),
    max_heart_rate: optional(snapshot.max_heart_rate),
    avg_power_watts: optional(snapshot.avg_power_watts),
    avg_cadence: optional(snapshot.avg_cadence),
    avg_pace_seconds_per_km: optional(snapshot.avg_pace_seconds_per_km),
    avg_split_seconds: optional(snapshot.avg_split_seconds),
    stroke_type: optional(snapshot.stroke_type),
    temperature_celsius: optional(snapshot.temperature_celsius),
    session_type: optional(snapshot.session_type) as SessionType | undefined,
    interval_reps: optional(snapshot.interval_reps),
    interval_work_distance_meters: optional(snapshot.interval_work_distance_meters),
    interval_work_seconds: optional(snapshot.interval_work_seconds),
    interval_rest_seconds: optional(snapshot.interval_rest_seconds),
    interval_work_avg_hr: optional(snapshot.interval_work_avg_hr),
    fartlek_on_distance_meters: optional(snapshot.fartlek_on_distance_meters),
    fartlek_on_seconds: optional(snapshot.fartlek_on_seconds),
    fartlek_on_avg_hr: optional(snapshot.fartlek_on_avg_hr),
    rpe: optional(snapshot.rpe),
    notes: optional(snapshot.notes),
  };
}

export async function POST(
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

  const { data: activity } = await supabase
    .from("activities")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (!activity) {
    return NextResponse.json({ error: "Activity not found" }, { status: 404 });
  }

  const record = readMergeRecord(activity.metadata as Record<string, unknown> | null);
  if (!record) {
    return NextResponse.json(
      { error: "This session was not created by merging, so there is nothing to undo." },
      { status: 400 }
    );
  }

  const survivorSnapshot = record.sources.find((s) => s.wasSurvivor);
  const absorbedSnapshots = record.sources.filter((s) => !s.wasSurvivor);
  if (!survivorSnapshot || survivorSnapshot.id !== id) {
    return NextResponse.json(
      { error: "This session's merge record does not match it and cannot be undone safely." },
      { status: 409 }
    );
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("user_id", user.id)
    .single();

  if (!profile) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  // The survivor goes back to its own pre-merge columns AND its own pre-merge
  // metadata — which is what drops the merge record, so the same session
  // cannot be unmerged twice.
  const { error: restoreSurvivorError } = await supabase
    .from("activities")
    .update(restoredRow(survivorSnapshot, user.id))
    .eq("id", id)
    .eq("user_id", user.id);

  if (restoreSurvivorError) {
    return databaseError(restoreSurvivorError, { operation: "POST /api/activities/[id]/unmerge" });
  }

  const { error: reinsertError } = await supabase
    .from("activities")
    .insert(absorbedSnapshots.map((s) => restoredRow(s, user.id)));

  if (reinsertError) {
    // The survivor is already back to half a run and the other half did not
    // reappear. Say so plainly rather than reporting a success the logbook
    // will contradict.
    console.error("[activities/unmerge] restore failed:", reinsertError.message);
    return NextResponse.json(
      {
        error:
          "We restored the first session but could not bring the others back. Check your logbook before trying again.",
      },
      { status: 500 }
    );
  }

  // A record set by the merged session describes numbers that no longer exist
  // anywhere. The restored legs re-compete for it as they are re-scored.
  await supabase.from("personal_records").delete().eq("user_id", user.id).eq("activity_id", id);

  // Oldest first, so each restored leg is scored against the ones that really
  // did come before it — the same ordering recompute uses.
  const ordered = [...record.sources].sort(
    (a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime()
  );

  const restoredIds: string[] = [];
  // Legs that came back but could not be scored. Each one is a session sitting
  // in the logbook with no score — the result of a failed insert into
  // workout_scores, which scoring DELETES before it rewrites, so there is no
  // previous score left underneath.
  const unscoredIds: string[] = [];

  for (const [index, snapshot] of ordered.entries()) {
    try {
      const scored = await scoreAndPersist(
        supabase,
        user.id,
        profile,
        bodyOf(snapshot),
        snapshot.id,
        {
          excludeActivityIds: [snapshot.id],
          existingMetadata: (snapshot.metadata ?? null) as Record<string, unknown> | null,
          // The stored race prediction still carries the merged session's
          // evidence, and the merged session no longer exists. Only the first
          // leg has to rebuild the base from the athlete's other sessions;
          // after that the stored row points at a leg that genuinely precedes
          // the next one, so it is real memory again.
          predictionBaseIsStale: index === 0,
        }
      );
      // The return value used to be discarded outright — not even destructured
      // — so every leg reported success whatever happened to its score rows.
      if (scored.workoutScoreError || !scored.workoutScore) {
        console.error(
          "[activities/unmerge] workout_scores insert failed for restored leg",
          snapshot.id,
          scored.workoutScoreError?.message
        );
        unscoredIds.push(snapshot.id);
      }
    } catch (err) {
      // A leg whose stored body no longer passes the plausibility checks throws
      // rather than returning an error. Uncaught, that abandoned every leg
      // after it in the loop, unscored and unmentioned. Record it and keep
      // going: the sessions are already back, and the remaining ones are
      // scoreable independently of this one.
      if (!(err instanceof ScoringInputError)) throw err;
      console.error(
        "[activities/unmerge] restored leg could not be scored",
        snapshot.id,
        err.message
      );
      unscoredIds.push(snapshot.id);
    }
    restoredIds.push(snapshot.id);
  }

  // The unmerge itself landed — the merged session is gone and every leg is
  // back in the logbook — so this is not a "nothing happened" failure and must
  // not read like one. It is reported rather than swallowed because an unscored
  // session contributes nothing to the Split Index while looking entirely
  // normal, which is exactly the silence that made the missing-strength-score
  // report keep coming back.
  if (unscoredIds.length > 0) {
    return NextResponse.json(
      {
        error:
          unscoredIds.length === restoredIds.length
            ? "We separated these sessions but could not score them. They are back in your logbook — open one and save it to score it again."
            : `We separated these sessions but could not score ${unscoredIds.length} of ${restoredIds.length}. They are back in your logbook — open the unscored ones and save them to score them again.`,
        unmerged: true,
        restoredActivityIds: restoredIds,
        unscoredActivityIds: unscoredIds,
        survivorActivityId: id,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    unmerged: true,
    restoredActivityIds: restoredIds,
    survivorActivityId: id,
  });
}
