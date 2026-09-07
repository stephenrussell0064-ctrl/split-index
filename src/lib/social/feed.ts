import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchBlockedUserIds } from "@/lib/social/moderation";
import type { SportType } from "@/types";

/**
 * Activity feed (Slice 1) — user feedback: "a feed of activities...
 * which other users who are friends with you are able to see... other
 * users are able to interact with their activities... by scoring their run
 * out of 10 and able to leave comments on them, similar to stravas concept.
 * The data displayed on these public posts should include all data
 * possible for this exercise."
 *
 * ...and then: "You should also be able to see your own activities on the
 * social feed page." So the feed is the viewer plus their accepted friends,
 * interleaved by time — which is what every athlete already expects from the
 * Strava comparison the original request made. It used to be friends-only,
 * on the reasoning that "this is a friend feed, not a logbook"; that reads
 * as a missing feature, not as a principle, when your own run is the one
 * thing you actually want to see land.
 *
 * PRIVACY GOVERNS WHO CAN SEE *YOU*, NEVER WHAT *YOU* CAN SEE
 * -----------------------------------------------------------
 * A private athlete still sees their own activities here. Their own rows are
 * readable under "Users manage own activities" (migration 001,
 * `FOR ALL USING (auth.uid() = user_id)`), and activity_is_visible_to()
 * short-circuits on `a.user_id = viewer_id` before it ever consults the
 * sharing flag (migration 049). Nothing in this module filters on the
 * VIEWER's own `share_activities_with_friends`, and nothing ever should:
 * "Private account" means other people cannot see you, not that you are
 * hidden from yourself.
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
  /**
   * The viewer's own activity. Computed here rather than left to the UI to
   * compare ids, so "is this mine?" has exactly one answer for the API, the
   * panel and any future consumer.
   */
  isOwn: boolean;
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
 *
 * A failed query is NOT one of those cases and must never be reported as one.
 *
 * `no_friends` now means "no friends AND nothing of your own to show" — with
 * the viewer included in the feed, an athlete with activities but no friends
 * gets a populated feed rather than the "Add a friend to start your feed"
 * card, so that copy only ever appears when the feed really is empty.
 */
export type FeedEmptyReason = "no_friends" | "no_visible_activities";

export interface FeedPage {
  activities: FeedActivity[];
  hasMore: boolean;
  /** Only set when `activities` is empty. */
  emptyReason?: FeedEmptyReason;
  /**
   * Set when a query the feed depends on failed outright — a missing table,
   * column or policy (i.e. an unapplied migration), or a dropped connection.
   *
   * This exists because the alternative is worse than useless: every Supabase
   * call here used to have its `error` discarded, so a database missing
   * migration 031 produced `data === null`, which read as zero rows, which the
   * UI rendered as "your friends haven't logged anything you can see yet".
   * That sentence is a lie in that state, and it points the athlete at their
   * friends' settings instead of at the one thing actually wrong. An athlete
   * reporting "the social feed doesn't work" while being shown a cheerful
   * empty state is exactly how this stayed unfixed.
   */
  error?: string;
}

const FEED_PAGE_SIZE = 15;

/**
 * The detail is only safe to show in development — a raw PostgREST message
 * names columns and constraints — but the operator running this app locally
 * is precisely the person who needs to read "column
 * profiles.share_activities_with_friends does not exist". Same split the
 * onboarding flow already uses for its save errors.
 */
function describeFailure(what: string, error: { message?: string } | null): string {
  const base = `Your feed couldn't be loaded — ${what} failed.`;
  return process.env.NODE_ENV === "development" && error?.message
    ? `${base} (${error.message})`
    : base;
}

/**
 * This viewer's accepted friends. Note what this deliberately does NOT do:
 * it does not pre-filter on the friend's `share_activities_with_friends`
 * flag. It used to, and that was a bug — reading another athlete's profile
 * has always been limited to those with a username (the "Public profiles
 * readable" policy until migration 056, the `public_profiles` view since).
 * Any friend without a username was therefore invisible to the pre-filter and
 * silently dropped from the feed even though the activities RLS would happily
 * have shown their workouts. The narrowing is the same shape after 056; the
 * reason not to pre-filter here is unchanged.
 *
 * The sharing check now happens in exactly one place — activity_is_visible_to()
 * in the activities RLS policy (migration 031), which is the real enforcement
 * boundary. This list only narrows the query to a bounded set of user_ids;
 * RLS still has the final say on every row returned, so a mistake here can
 * only ever under-fetch, never leak a private athlete's activity.
 */
async function fetchAcceptedFriendIds(
  supabase: SupabaseClient,
  userId: string
): Promise<{ ids: string[]; error: { message?: string } | null }> {
  const { data: friendRows, error } = await supabase
    .from("friends")
    .select("user_id, friend_id")
    .eq("status", "accepted")
    .or(`user_id.eq.${userId},friend_id.eq.${userId}`);

  return {
    ids: [
      ...new Set(
        (friendRows ?? []).map((r) => (r.user_id === userId ? (r.friend_id as string) : (r.user_id as string)))
      ),
    ],
    error: error ?? null,
  };
}

/** The six curated score_breakdown paths public_workout_scores projects, as columns. */
interface FeedScoreExtras {
  vo2max?: unknown;
  execution_score?: unknown;
  decoupling_pct?: unknown;
  dots_score?: unknown;
  gl_points?: unknown;
  per_lift?: unknown;
}

/**
 * Pulls out only the fields worth surfacing on a feed post — never the raw
 * score_breakdown blob (internal flags and explanation strings aren't meant for
 * another user's eyes).
 *
 * The curation now happens twice, on purpose. public_workout_scores projects
 * these six paths and nothing else, so the blob no longer leaves the database
 * at all; this function still type-checks each one before it reaches a feed
 * card, because the columns are jsonb and a scoring change could put a string
 * where a number was. The view decides what may be read; this decides what is
 * worth rendering.
 */
function extractExtra(row: FeedScoreExtras | null): Record<string, unknown> | null {
  if (!row) return null;
  const extra: Record<string, unknown> = {};

  if (typeof row.vo2max === "number") extra.vo2max = row.vo2max;
  if (typeof row.execution_score === "number") extra.executionScore = row.execution_score;
  if (typeof row.decoupling_pct === "number") extra.decouplingPct = row.decoupling_pct;
  if (typeof row.dots_score === "number") extra.dotsScore = row.dots_score;
  if (typeof row.gl_points === "number") extra.glPoints = row.gl_points;
  if (row.per_lift && typeof row.per_lift === "object") extra.perLift = row.per_lift;

  return Object.keys(extra).length > 0 ? extra : null;
}

export async function fetchActivityFeed(
  supabase: SupabaseClient,
  userId: string,
  options: { offset?: number } = {}
): Promise<FeedPage> {
  const offset = options.offset ?? 0;
  const { ids: friendIds, error: friendsError } = await fetchAcceptedFriendIds(supabase, userId);
  if (friendsError) {
    return {
      activities: [],
      hasMore: false,
      error: describeFailure("reading your friends list", friendsError),
    };
  }

  // The viewer FIRST, then their accepted friends. Including the viewer is the
  // whole of the change: "You should also be able to see your own activities
  // on the social feed page." Their own rows were always readable — "Users
  // manage own activities" (001) — so nothing about RLS had to move; this
  // query was simply filtering them back out again.
  //
  // Deduped, because a self-referencing `friends` row would otherwise put the
  // viewer in the scope twice, and `.in()` with a repeated id is a needless
  // widening of the predicate.
  //
  // Note there is no early return for "no friends" any more. An athlete with
  // no friends still has a feed — their own — and skipping the activities
  // query would hand them the "Add a friend to start your feed" card while
  // sitting on a month of runs. Whether the feed is genuinely empty is now
  // decided by the rows that come back, which is the only thing that can
  // actually answer it.
  const authorScope = [...new Set([userId, ...friendIds])];

  /*
    Blocked athletes are removed from the SCOPE, not from the results.

    Filtering after the fact would still have fetched their sessions, sent them
    over the wire and merely not painted them — one devtools panel away from
    being read by the person they blocked. Narrowing `authorScope` means the
    database never selects the rows at all.

    Both directions: blocking is bidirectional in effect even though it is
    stored one way round (see lib/social/moderation.ts). A block that only hid
    one side would leave the person who was blocked still watching.
  */
  const blocked = await fetchBlockedUserIds(supabase, userId);
  const visibleScope = authorScope.filter((id) => !blocked.has(id));

  // The sharing/friendship check is enforced by RLS (activity_is_visible_to),
  // not here — rows belonging to a friend who has gone private simply never
  // come back from this query. The viewer's OWN rows are unaffected by their
  // own privacy setting: the predicate short-circuits on ownership, so a
  // private athlete's feed still contains everything they logged.
  const { data: activityRows, error: activitiesError } = await supabase
    .from("activities")
    .select(
      "id, user_id, sport, title, started_at, duration_seconds, distance_meters, elevation_meters, avg_heart_rate, max_heart_rate, avg_power_watts, avg_cadence, avg_pace_seconds_per_km, temperature_celsius, session_type, rpe, notes"
    )
    .in("user_id", visibleScope)
    .eq("is_draft", false)
    .order("started_at", { ascending: false })
    // Tiebreak on id so the sort is a total order. `range()` pagination over a
    // non-unique sort key can show the same row on two pages and skip another
    // entirely, and merging the viewer's own activities into the same stream
    // makes exact `started_at` collisions likelier — logging a lift and a run
    // that both start on the hour is an ordinary thing to do.
    .order("id", { ascending: false })
    .range(offset, offset + FEED_PAGE_SIZE); // fetch one extra to detect hasMore

  // An RLS-filtered empty result and a failed query both arrive as no rows.
  // Only the first of those means "nothing to show".
  if (activitiesError) {
    return {
      activities: [],
      hasMore: false,
      error: describeFailure("reading your feed's activities", activitiesError),
    };
  }

  const rows = activityRows ?? [];
  const hasMore = rows.length > FEED_PAGE_SIZE;
  const pageRows = hasMore ? rows.slice(0, FEED_PAGE_SIZE) : rows;
  if (pageRows.length === 0) {
    // "You have no friends yet" and "nobody, you included, has logged anything
    // visible" are different sentences and want different copy. With the
    // viewer in scope, the first is only true when they also have nothing of
    // their own — otherwise this branch isn't reached at all.
    return {
      activities: [],
      hasMore: false,
      emptyReason: friendIds.length === 0 ? "no_friends" : "no_visible_activities",
    };
  }

  const activityIds = pageRows.map((r) => r.id as string);
  const authorIds = [...new Set(pageRows.map((r) => r.user_id as string))];

  // These four are enrichment, not the feed itself: a failure costs a score
  // badge, an avatar or a comment count, and the workout still renders. Their
  // errors are deliberately not promoted to a page-level failure the way the
  // two queries above are — losing the reaction count is not worth replacing
  // a readable feed with an error card.
  const [{ data: scores }, { data: authors }, { data: reactions }, { data: comments }] = await Promise.all([
    supabase
      .from("public_workout_scores")
      .select(
        "activity_id, sport_index, load_score, vo2max, execution_score, decoupling_pct, dots_score, gl_points, per_lift"
      )
      .in("activity_id", activityIds),
    supabase.from("public_profiles").select("user_id, username, display_name, avatar_url").in("user_id", authorIds),
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
      isOwn: row.user_id === userId,
      sportIndex: (score?.sport_index as number | null) ?? null,
      loadScore: (score?.load_score as number | null) ?? null,
      extra: extractExtra((score as FeedScoreExtras | undefined) ?? null),
      reactionAverage: reactionAgg && reactionAgg.count > 0 ? reactionAgg.sum / reactionAgg.count : null,
      reactionCount: reactionAgg?.count ?? 0,
      myReaction: reactionAgg?.mine ?? null,
      commentCount: commentCountByActivity.get(row.id as string) ?? 0,
    };
  });

  return { activities, hasMore };
}
