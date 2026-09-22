import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * One athlete's session, as another athlete may see it.
 *
 * The feed shows a gym session as a title and a score. Tapping it should show
 * what was actually lifted — which means reading somebody else's training
 * diary, so the rule about who may do that is written twice on purpose.
 *
 * Migration 083's view carries the same predicate and is the one that actually
 * holds: it runs with `security_invoker = off`, so it decides for itself and a
 * mistake here cannot widen it. This function checks anyway, because a caller
 * that skipped the check would otherwise get an empty exercise list and a
 * perfectly rendered page header describing a session it has no business
 * naming. Defence in depth is the reason; a readable 404 is the effect.
 */

export interface SharedExercise {
  exerciseName: string;
  muscleGroup: string | null;
  estimated1rmKg: number | null;
  strengthIndex: number | null;
}

export interface SharedActivity {
  id: string;
  sport: string;
  title: string | null;
  startedAt: string;
  durationSeconds: number;
  distanceMeters: number | null;
  avgHeartRate: number | null;
  sportIndex: number | null;
  isOwn: boolean;
  author: { userId: string; username: string | null; displayName: string | null; avatarUrl: string | null };
  exercises: SharedExercise[];
}

export type SharedActivityDenial = "not_found" | "not_visible";

/**
 * Whether `viewerId` may read `ownerId`'s training, by the same rule as the
 * feed: yourself, or an accepted friend with no block in either direction.
 */
export async function canViewAthlete(
  supabase: SupabaseClient,
  viewerId: string,
  ownerId: string
): Promise<boolean> {
  if (viewerId === ownerId) return true;

  const blocks = await supabase
    .from("blocked_users")
    .select("blocker_id")
    .or(
      `and(blocker_id.eq.${viewerId},blocked_id.eq.${ownerId}),and(blocker_id.eq.${ownerId},blocked_id.eq.${viewerId})`
    )
    .limit(1);
  // A block list that cannot be read is not an empty block list. Refusing is
  // the only safe direction: the cost of a false refusal is a missing page, the
  // cost of a false allow is somebody reading the training of a person who
  // blocked them.
  if (blocks.error) return false;
  if ((blocks.data ?? []).length > 0) return false;

  const friend = await supabase
    .from("friends")
    .select("status")
    .eq("status", "accepted")
    .or(
      `and(user_id.eq.${viewerId},friend_id.eq.${ownerId}),and(user_id.eq.${ownerId},friend_id.eq.${viewerId})`
    )
    .limit(1);
  if (friend.error) return false;
  return (friend.data ?? []).length > 0;
}

export async function fetchSharedActivity(
  supabase: SupabaseClient,
  viewerId: string,
  activityId: string
): Promise<{ activity: SharedActivity | null; denial: SharedActivityDenial | null }> {
  const { data: row, error } = await supabase
    .from("activities")
    .select(
      "id, user_id, sport, title, started_at, duration_seconds, distance_meters, avg_heart_rate, is_draft"
    )
    .eq("id", activityId)
    .maybeSingle();

  // A draft is not published to anybody, including a friend — it is a session
  // its owner has not finished writing.
  if (error || !row || (row.is_draft && row.user_id !== viewerId)) {
    return { activity: null, denial: "not_found" };
  }

  const ownerId = row.user_id as string;
  if (!(await canViewAthlete(supabase, viewerId, ownerId))) {
    return { activity: null, denial: "not_visible" };
  }

  const [profile, score, lifts] = await Promise.all([
    supabase
      .from("public_profiles")
      .select("user_id, username, display_name, avatar_url")
      .eq("user_id", ownerId)
      .maybeSingle(),
    supabase.from("public_workout_scores").select("sport_index").eq("activity_id", activityId).maybeSingle(),
    supabase
      .from("public_activity_strength_scores")
      .select("exercise_name, muscle_group, estimated_1rm_kg, strength_index")
      .eq("activity_id", activityId)
      .order("strength_index", { ascending: false }),
  ]);

  return {
    activity: {
      id: row.id as string,
      sport: row.sport as string,
      title: (row.title as string | null) ?? null,
      startedAt: row.started_at as string,
      durationSeconds: (row.duration_seconds as number) ?? 0,
      distanceMeters: (row.distance_meters as number | null) ?? null,
      avgHeartRate: (row.avg_heart_rate as number | null) ?? null,
      sportIndex: (score.data?.sport_index as number | null) ?? null,
      isOwn: ownerId === viewerId,
      author: {
        userId: ownerId,
        username: (profile.data?.username as string | null) ?? null,
        displayName: (profile.data?.display_name as string | null) ?? null,
        avatarUrl: (profile.data?.avatar_url as string | null) ?? null,
      },
      exercises: ((lifts.data ?? []) as Array<Record<string, unknown>>).map((l) => ({
        exerciseName: (l.exercise_name as string) ?? "",
        muscleGroup: (l.muscle_group as string | null) ?? null,
        estimated1rmKg: typeof l.estimated_1rm_kg === "number" ? l.estimated_1rm_kg : null,
        strengthIndex: typeof l.strength_index === "number" ? l.strength_index : null,
      })),
    },
    denial: null,
  };
}
