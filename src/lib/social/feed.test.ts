import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchFriendFeed } from "./feed";

/**
 * Visibility rules for the friend feed.
 *
 * The authoritative gate is RLS (activity_is_visible_to(), migrations 031 and
 * 046) — these tests cover the query layer that sits on top of it, and in
 * particular the two ways this module could betray an athlete:
 *   1. widening the author scope beyond accepted friends, and
 *   2. selecting columns that carry data a friend was never meant to get
 *      (notably activities.metadata, which holds the GPS route polyline and
 *      therefore the athlete's front door).
 */

interface RecordedQuery {
  table: string;
  columns?: string;
  eq: [string, unknown][];
  in: [string, unknown[]][];
  or?: string;
}

/**
 * Minimal stand-in for the PostgREST query builder — records what was asked
 * for, returns canned rows per table. `errors` makes a named table fail the
 * way a missing table/column/policy does: `data: null` plus an error, which is
 * indistinguishable from an empty result unless the error is actually read.
 */
function makeSupabase(
  tables: Record<string, Record<string, unknown>[]>,
  errors: Record<string, { message: string; code?: string }> = {}
) {
  const queries: RecordedQuery[] = [];

  const client = {
    from(table: string) {
      const record: RecordedQuery = { table, eq: [], in: [] };
      queries.push(record);
      const builder: Record<string, unknown> = {
        select(columns: string) {
          record.columns = columns;
          return builder;
        },
        eq(column: string, value: unknown) {
          record.eq.push([column, value]);
          return builder;
        },
        in(column: string, values: unknown[]) {
          record.in.push([column, values]);
          return builder;
        },
        or(expr: string) {
          record.or = expr;
          return builder;
        },
        order() {
          return builder;
        },
        range() {
          return builder;
        },
        then(resolve: (v: { data: unknown; error: unknown }) => unknown) {
          const failure = errors[table];
          return Promise.resolve(
            failure ? { data: null, error: failure } : { data: tables[table] ?? [], error: null }
          ).then(resolve);
        },
      };
      return builder;
    },
  };

  return { supabase: client as unknown as SupabaseClient, queries };
}

const ME = "11111111-1111-1111-1111-111111111111";
const FRIEND = "22222222-2222-2222-2222-222222222222";
const STRANGER = "33333333-3333-3333-3333-333333333333";

function activityRow(userId: string, id: string) {
  return {
    id,
    user_id: userId,
    sport: "run",
    title: "Morning run",
    started_at: "2026-08-01T06:00:00Z",
    duration_seconds: 1800,
    distance_meters: 5000,
    elevation_meters: null,
    avg_heart_rate: null,
    max_heart_rate: null,
    avg_power_watts: null,
    avg_cadence: null,
    avg_pace_seconds_per_km: null,
    temperature_celsius: null,
    session_type: null,
    rpe: null,
    notes: null,
  };
}

describe("fetchFriendFeed — who can see what", () => {
  it("returns nothing and never touches activities when the viewer has no accepted friends", async () => {
    const { supabase, queries } = makeSupabase({ friends: [] });

    const page = await fetchFriendFeed(supabase, ME);

    expect(page.activities).toEqual([]);
    expect(page.hasMore).toBe(false);
    expect(page.emptyReason).toBe("no_friends");
    expect(queries.some((q) => q.table === "activities")).toBe(false);
  });

  it("scopes the activity query to accepted friends only — a non-friend is never asked for", async () => {
    // The stranger shares by default (the new model) and has activities, but
    // has no accepted friendship with the viewer.
    const { supabase, queries } = makeSupabase({
      friends: [{ user_id: ME, friend_id: FRIEND }],
      activities: [activityRow(FRIEND, "a1")],
      workout_scores: [],
      profiles: [{ user_id: FRIEND, username: "friend", display_name: "Friend", avatar_url: null }],
      activity_reactions: [],
      activity_comments: [],
    });

    const page = await fetchFriendFeed(supabase, ME);

    const friendsQuery = queries.find((q) => q.table === "friends")!;
    expect(friendsQuery.eq).toContainEqual(["status", "accepted"]);

    const activityQuery = queries.find((q) => q.table === "activities")!;
    const authorScope = activityQuery.in.find(([col]) => col === "user_id")![1];
    expect(authorScope).toEqual([FRIEND]);
    expect(authorScope).not.toContain(STRANGER);

    expect(page.activities.map((a) => a.author.userId)).toEqual([FRIEND]);
  });

  it("excludes the viewer's own activities — this is a friend feed, not a logbook", async () => {
    // A self-referencing friend row must not put the viewer in their own feed.
    const { supabase, queries } = makeSupabase({
      friends: [{ user_id: ME, friend_id: ME }],
    });

    const page = await fetchFriendFeed(supabase, ME);

    expect(page.emptyReason).toBe("no_friends");
    expect(queries.some((q) => q.table === "activities")).toBe(false);
  });

  it("only requests non-draft activities", async () => {
    const { supabase, queries } = makeSupabase({
      friends: [{ user_id: FRIEND, friend_id: ME }],
      activities: [],
    });

    await fetchFriendFeed(supabase, ME);

    const activityQuery = queries.find((q) => q.table === "activities")!;
    expect(activityQuery.eq).toContainEqual(["is_draft", false]);
  });

  it("treats an empty result from RLS as 'nothing visible', not an error", async () => {
    // A friend who has switched on Private account simply produces no rows:
    // the sharing check lives in the RLS predicate, not here.
    const { supabase } = makeSupabase({
      friends: [{ user_id: FRIEND, friend_id: ME }],
      activities: [],
    });

    const page = await fetchFriendFeed(supabase, ME);

    expect(page.activities).toEqual([]);
    expect(page.emptyReason).toBe("no_visible_activities");
  });

  it("does not pre-filter on the friend's profile sharing flag", async () => {
    // Regression guard: reading another athlete's profile row depends on the
    // "Public profiles readable" policy (USING (username IS NOT NULL)), so a
    // friend with no username used to be silently dropped from the feed even
    // though the activities RLS would have shown their workouts. The sharing
    // check must happen in RLS only.
    const { supabase, queries } = makeSupabase({
      friends: [{ user_id: FRIEND, friend_id: ME }],
      activities: [activityRow(FRIEND, "a1")],
      workout_scores: [],
      profiles: [{ user_id: FRIEND, username: null, display_name: null, avatar_url: null }],
      activity_reactions: [],
      activity_comments: [],
    });

    const page = await fetchFriendFeed(supabase, ME);

    const sharingPreFilter = queries.some((q) =>
      q.eq.some(([column]) => column === "share_activities_with_friends")
    );
    expect(sharingPreFilter).toBe(false);

    // ...and the usernameless friend's activity still makes it through.
    expect(page.activities).toHaveLength(1);
    expect(page.activities[0].author.userId).toBe(FRIEND);
  });

  it("reports a failed activities query as an error, not as an empty feed", async () => {
    // The bug this guards: a database missing migration 031 has no
    // "Friends view shared activities" policy and no activity_is_visible_to(),
    // so this query fails. With the error discarded, `data` was null, which
    // read as zero rows, which the UI rendered as "your friends haven't logged
    // anything you can see yet" — sending the athlete to look at their
    // friends' privacy settings for a problem in their own database.
    const { supabase } = makeSupabase(
      { friends: [{ user_id: FRIEND, friend_id: ME }] },
      { activities: { message: 'relation "activity_is_visible_to" does not exist', code: "42P01" } }
    );

    const page = await fetchFriendFeed(supabase, ME);

    expect(page.error).toBeTruthy();
    expect(page.emptyReason).toBeUndefined();
    expect(page.activities).toEqual([]);
  });

  it("reports a failed friends query as an error, not as 'you have no friends'", async () => {
    const { supabase } = makeSupabase(
      {},
      { friends: { message: "connection terminated unexpectedly" } }
    );

    const page = await fetchFriendFeed(supabase, ME);

    expect(page.error).toBeTruthy();
    expect(page.emptyReason).not.toBe("no_friends");
  });

  it("still renders the feed when only the enrichment queries fail", async () => {
    // Scores, authors, reactions and comments are decoration. Losing the
    // reaction count is not a reason to replace a readable feed with an error.
    const { supabase } = makeSupabase(
      {
        friends: [{ user_id: FRIEND, friend_id: ME }],
        activities: [activityRow(FRIEND, "a1")],
      },
      {
        workout_scores: { message: "nope" },
        profiles: { message: "nope" },
        activity_reactions: { message: 'relation "activity_reactions" does not exist' },
        activity_comments: { message: 'relation "activity_comments" does not exist' },
      }
    );

    const page = await fetchFriendFeed(supabase, ME);

    expect(page.error).toBeUndefined();
    expect(page.activities).toHaveLength(1);
    expect(page.activities[0].author.username).toBeNull();
    expect(page.activities[0].reactionCount).toBe(0);
  });

  it("never selects activities.metadata, which carries the GPS route and home start point", async () => {
    const { supabase, queries } = makeSupabase({
      friends: [{ user_id: FRIEND, friend_id: ME }],
      activities: [activityRow(FRIEND, "a1")],
      workout_scores: [],
      profiles: [{ user_id: FRIEND, username: "friend", display_name: null, avatar_url: null }],
      activity_reactions: [],
      activity_comments: [],
    });

    await fetchFriendFeed(supabase, ME);

    const activityQuery = queries.find((q) => q.table === "activities")!;
    expect(activityQuery.columns).not.toMatch(/metadata/);
    expect(activityQuery.columns).not.toMatch(/\*/);
  });
});
