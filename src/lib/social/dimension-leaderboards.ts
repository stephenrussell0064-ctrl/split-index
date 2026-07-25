/**
 * Split Index — dimension leaderboards (By Exercise / By Muscle Group / By
 * Activity), alongside the index-metric leaderboard in leaderboard.ts.
 *
 * Unlike the Split/Endurance/Strength leaderboard, these have no per-user
 * denormalized "current" column or cached `leaderboard_entries` row to read
 * — each is a live aggregate over `strength_scores` (exercise, muscle
 * group) or `workout_scores` (activity), grouped by user in JS the same way
 * fetchLeaderboard()'s live-fallback path already does for profiles.
 *
 * Requires the public-read RLS policy added in migration
 * 012_public_read_strength_scores.sql — without it, `strength_scores`
 * queries silently return only the calling user's own rows.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SportType } from "@/types";
import type { DimensionLeaderboardRow } from "./types";

interface ProfileLite {
  user_id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  country: string | null;
}

async function joinProfiles(
  supabase: SupabaseClient,
  best: Map<string, number>
): Promise<DimensionLeaderboardRow[]> {
  const userIds = [...best.keys()];
  if (userIds.length === 0) return [];

  const { data: profiles } = await supabase
    .from("profiles")
    .select("user_id, username, display_name, avatar_url, country")
    .in("user_id", userIds);

  const profileMap = new Map(
    ((profiles ?? []) as ProfileLite[]).map((p) => [p.user_id, p])
  );

  return userIds
    .map((userId) => ({ userId, value: best.get(userId)!, profile: profileMap.get(userId) }))
    .filter(({ profile }) => profile && profile.username)
    .sort((a, b) => b.value - a.value)
    .slice(0, 50)
    .map(({ userId, value, profile }, i) => ({
      rank: i + 1,
      userId,
      username: profile!.username,
      displayName: profile!.display_name,
      avatarUrl: profile!.avatar_url,
      country: profile!.country,
      value: Math.round(value * 10) / 10,
    }));
}

/** Best (highest) estimated 1RM per user for a single exercise. */
export async function fetchExerciseLeaderboard(
  supabase: SupabaseClient,
  exerciseName: string
): Promise<DimensionLeaderboardRow[]> {
  const { data } = await supabase
    .from("strength_scores")
    .select("user_id, estimated_1rm_kg")
    .eq("exercise_name", exerciseName)
    .order("estimated_1rm_kg", { ascending: false })
    .limit(2000);

  const best = new Map<string, number>();
  for (const row of data ?? []) {
    const prev = best.get(row.user_id) ?? 0;
    if (row.estimated_1rm_kg > prev) best.set(row.user_id, row.estimated_1rm_kg);
  }

  return joinProfiles(supabase, best);
}

/** Best (highest) strength_index per user across all exercises logged for a single muscle group. */
export async function fetchMuscleGroupLeaderboard(
  supabase: SupabaseClient,
  muscleGroup: string
): Promise<DimensionLeaderboardRow[]> {
  const { data } = await supabase
    .from("strength_scores")
    .select("user_id, strength_index")
    .eq("muscle_group", muscleGroup)
    .order("strength_index", { ascending: false })
    .limit(2000);

  const best = new Map<string, number>();
  for (const row of data ?? []) {
    const prev = best.get(row.user_id) ?? 0;
    if (row.strength_index > prev) best.set(row.user_id, row.strength_index);
  }

  return joinProfiles(supabase, best);
}

/** Best (highest) sport_index per user for a single sport/activity. */
export async function fetchActivityLeaderboard(
  supabase: SupabaseClient,
  sport: SportType
): Promise<DimensionLeaderboardRow[]> {
  const { data } = await supabase
    .from("workout_scores")
    .select("user_id, sport_index")
    .eq("sport", sport)
    .order("sport_index", { ascending: false })
    .limit(2000);

  const best = new Map<string, number>();
  for (const row of data ?? []) {
    const prev = best.get(row.user_id) ?? 0;
    if (row.sport_index > prev) best.set(row.user_id, row.sport_index);
  }

  return joinProfiles(supabase, best);
}
