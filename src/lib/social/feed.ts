import type { SupabaseClient } from "@supabase/supabase-js";
import type { SportType } from "@/types";

/**
 * Friend activity feed (Slice 1) — user feedback: "a feed of activities...
 * which other users who are friends with you are able to see... other
 * users are able to interact with their activities... by scoring their run
 * out of 10 and able to leave comments on them, similar to stravas concept.
 * The data displayed on these public posts should include all data
 * possible for this exercise."
 *
 * Security lives in RLS (see migration 031's activity_is_visible_to()) —
 * this module's job is just building a nice paginated view over what the
 * authenticated client is already allowed to see. Never uses the admin
 * client: every feed query runs as the requesting user, so a bug here can
 * only ever under-fetch, never leak a private activity RLS would have
 * blocked.
 */

export interface FeedAuthor {
  userId: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface FeedActivity {
  id: string;
  sport: SportType;
  title: string | null;
  startedAt: string;
  durationSeconds: number;
  distanceMeters: number | null;
  elevationMeters: number | null;
  avgHeartRate: number | null;
  maxHeartRate: number | null;
  avgPowerWatts: number | null;
  avgCadence: number | null;
  avgPaceSecondsPerKm: number | null;
  temperatureCelsius: number | null;
  sessionType: string | null;
  rpe: number | null;
  notes: string | null;
  author: FeedAuthor;
  sportIndex: number | null;
  loadScore: number | null;
  /** Curated slice of score_breakdown — vo2max/DOTS/GL/per-lift, the "all data possible" fields worth showing a friend, not the full internal debug object. */
  extra: Record<string, unknown> | null;
  reactionAverage: number | null;
  reactionCount: number;
  myReaction: number | null;
  commentCount: number;
}

/**
 * Why a feed came back empty, so the UI can say something true instead of
 * guessing. We deliberately can't distinguish "this friend is private" from
 * "this friend hasn't logged anything" — the sharing flag lives behind RLS
 * on someone else's profile row and is none of the viewer's business — so
 * those collapse into one honest "nothing to show yet" case.
 */
export type FeedEmptyReason = "no_friends" | "no_visible_activities";

export interface FeedPage {
  activities: FeedActivity[];
  hasMore: boolean;
  /** Only set when `activities` is empty. */
  emptyReason?: FeedEmptyReason;
}

const FEED_PAGE_SIZE = 15;

/**
 * This viewer's accepted friends. Note what this deliberately does NOT do:
 * it does not pre-filter on the friend's `share_activities_with_friends`
 * flag. It used to, and that was a bug — reading another user's profile row
 * requires the "Public profiles readable" policy (migration 001), which is
 * `USING (username IS NOT NULL)`. Any friend without a username was
 * therefore invisible to the pre-filter and silently dropped from the feed
 * even though the activities RLS would happily have shown their workouts.
 *
 * The sharing check now happens in exactly one place — activity_is_visible_to()
 * in the activities RLS policy (migration 031), which is the real enforcement
 * boundary. This list only narrows the query to a bounded set of user_ids;
 * RLS still has the final say on every row returned, so a mistake here can
 * only ever under-fetch, never leak a private athlete's activity.
 */
async function fetchAcceptedFriendIds(supabase: SupabaseClient, userId: string): Promise<string[]> {
  const { data: friendRows } = await supabase
    .from("friends")
    .select("user_id, friend_id")
    .eq("status", "accepted")
    .or(`user_id.eq.${userId},friend_id.eq.${userId}`);

  return [
    ...new Set(
      (friendRows ?? []).map((r) => (r.user_id === userId ? (r.friend_id as string) : (r.user_id as string)))
    ),
  ];
}

/** Pulls out only the fields worth surfacing on a feed post — never the raw score_breakdown blob (internal flags/explanation strings aren't meant for another user's eyes). */
function extractExtra(breakdown: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!breakdown) return null;
  const extra: Record<string, unknown> = {};

  const cardio = breakdown.cardio_activity as Record<string, unknown> | undefined;
  if (cardio) {
    if (typeof cardio.vo2max === "number") extra.vo2max = cardio.vo2max;
    if (typeof cardio.executionScore === "number") extra.executionScore = cardio.executionScore;
    if (typeof cardio.decouplingPct === "number") extra.decouplingPct = cardio.decouplingPct;
  }
  if (typeof breakdown.dots_score === "number") extra.dotsScore = breakdown.dots_score;
  if (typeof breakdown.gl_points === "number") extra.glPoints = breakdown.gl_points;
  if (breakdown.per_lift && typeof breakdown.per_lift === "object") extra.perLift = breakdown.per_lift;

  return Object.keys(extra).length > 0 ? extra : null;
}

export async function fetchFriendFeed(
  supabase: SupabaseClient,
  userId: string,
  options: { offset?: number } = {}
): Promise<FeedPage> {
  const offset = options.offset ?? 0;
  const friendIds = await fetchAcceptedFriendIds(supabase, userId);
  if (friendIds.length === 0) {
    return { activities: [], hasMore: false, emptyReason: "no_friends" };
  }

  // Never include the viewer's own user_id: their own activities are visible
  // to them under the "Users manage own activities" policy, and this is a
  // friend feed, not a logbook.
  const authorScope = friendIds.filter((id) => id !== userId);
  if (authorScope.length === 0) {
    return { activities: [], hasMore: false, emptyReason: "no_friends" };
  }

  // The sharing/friendship check is enforced by RLS (activity_is_visible_to),
  // not here — rows belonging to a friend who has gone private simply never
  // come back from this query.
  const { data: activityRows } = await supabase
    .from("activities")
    .select(
      "id, user_id, sport, title, started_at, duration_seconds, distance_meters, elevation_meters, avg_heart_rate, max_heart_rate, avg_power_watts, avg_cadence, avg_pace_seconds_per_km, temperature_celsius, session_type, rpe, notes"
    )
    .in("user_id", authorScope)
    .eq("is_draft", false)
    .order("started_at", { ascending: false })
    .range(offset, offset + FEED_PAGE_SIZE); // fetch one extra to detect hasMore

  const rows = activityRows ?? [];
  const hasMore = rows.length > FEED_PAGE_SIZE;
  const pageRows = hasMore ? rows.slice(0, FEED_PAGE_SIZE) : rows;
  if (pageRows.length === 0) {
    return { activities: [], hasMore: false, emptyReason: "no_visible_activities" };
  }

  const activityIds = pageRows.map((r) => r.id as string);
  const authorIds = [...new Set(pageRows.map((r) => r.user_id as string))];

  const [{ data: scores }, { data: authors }, { data: reactions }, { data: comments }] = await Promise.all([
    supabase
      .from("workout_scores")
      .select("activity_id, sport_index, load_score, score_breakdown")
      .in("activity_id", activityIds),
    supabase.from("profiles").select("user_id, username, display_name, avatar_url").in("user_id", authorIds),
    supabase.from("activity_reactions").select("activity_id, user_id, score").in("activity_id", activityIds),
    supabase.from("activity_comments").select("activity_id").in("activity_id", activityIds),
  ]);

  const scoreByActivity = new Map((scores ?? []).map((s) => [s.activity_id as string, s]));
  const authorById = new Map((authors ?? []).map((a) => [a.user_id as string, a]));

  const reactionsByActivity = new Map<string, { sum: number; count: number; mine: number | null }>();
  for (const r of reactions ?? []) {
    const key = r.activity_id as string;
    const agg = reactionsByActivity.get(key) ?? { sum: 0, count: 0, mine: null };
    agg.sum += r.score as number;
    agg.count += 1;
    if (r.user_id === userId) agg.mine = r.score as number;
    reactionsByActivity.set(key, agg);
  }

  const commentCountByActivity = new Map<string, number>();
  for (const c of comments ?? []) {
    const key = c.activity_id as string;
    commentCountByActivity.set(key, (commentCountByActivity.get(key) ?? 0) + 1);
  }

  const activities: FeedActivity[] = pageRows.map((row) => {
    const author = authorById.get(row.user_id as string);
    const score = scoreByActivity.get(row.id as string);
    const reactionAgg = reactionsByActivity.get(row.id as string);

    return {
      id: row.id as string,
      sport: row.sport as SportType,
      title: row.title as string | null,
      startedAt: row.started_at as string,
      durationSeconds: row.duration_seconds as number,
      distanceMeters: row.distance_meters as number | null,
      elevationMeters: row.elevation_meters as number | null,
      avgHeartRate: row.avg_heart_rate as number | null,
      maxHeartRate: row.max_heart_rate as number | null,
      avgPowerWatts: row.avg_power_watts as number | null,
      avgCadence: row.avg_cadence as number | null,
      avgPaceSecondsPerKm: row.avg_pace_seconds_per_km as number | null,
      temperatureCelsius: row.temperature_celsius as number | null,
      sessionType: row.session_type as string | null,
      rpe: row.rpe as number | null,
      notes: row.notes as string | null,
      author: {
        userId: row.user_id as string,
        username: (author?.username as string | null) ?? null,
        displayName: (author?.display_name as string | null) ?? null,
        avatarUrl: (author?.avatar_url as string | null) ?? null,
      },
      sportIndex: (score?.sport_index as number | null) ?? null,
      loadScore: (score?.load_score as number | null) ?? null,
      extra: extractExtra((score?.score_breakdown as Record<string, unknown> | null) ?? null),
      reactionAverage: reactionAgg && reactionAgg.count > 0 ? reactionAgg.sum / reactionAgg.count : null,
      reactionCount: reactionAgg?.count ?? 0,
      myReaction: reactionAgg?.mine ?? null,
      commentCount: commentCountByActivity.get(row.id as string) ?? 0,
    };
  });

  return { activities, hasMore };
}
