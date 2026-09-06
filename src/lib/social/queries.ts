import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AchievementBadge,
  ChallengeWithProgress,
  DuelParticipant,
  DuelWithStandings,
  FriendConnection,
  SquadSummary,
} from "./types";
import { aggregateDuelScores, duelWindowEndExclusive, pickLeader } from "./duels";
import { parseInjuryStatus } from "./injury-status";

function mapFriendProfile(row: {
  user_id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  current_split_index: number | null;
  injury_status?: unknown;
}) {
  return {
    userId: row.user_id,
    username: row.username,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    currentSplitIndex: row.current_split_index,
    // Through parseInjuryStatus, never straight from the row: this string is
    // rendered next to another athlete's name, so anything the app does not
    // recognise has to become "say nothing" rather than be shown verbatim.
    injuryStatus: parseInjuryStatus(row.injury_status),
  };
}

export async function fetchFriendsData(
  supabase: SupabaseClient,
  userId: string
): Promise<{
  friends: FriendConnection[];
  incoming: FriendConnection[];
  outgoing: FriendConnection[];
}> {
  const { data: rows } = await supabase
    .from("friends")
    .select("id, user_id, friend_id, status, created_at")
    .or(`user_id.eq.${userId},friend_id.eq.${userId}`)
    .neq("status", "blocked");

  if (!rows?.length) {
    return { friends: [], incoming: [], outgoing: [] };
  }

  const otherIds = rows.map((r) =>
    r.user_id === userId ? r.friend_id : r.user_id
  );

  // Two reads, not one, and deliberately so — the same shape Settings uses for
  // `share_activities_with_friends`. `injury_status` arrived in migration 053,
  // and naming it in the SELECT above would make a database that has not taken
  // 053 fail the WHOLE profile read with 42703, emptying the friends list of
  // names, avatars and indexes over a decorative badge. A missing column must
  // cost only the thing it holds.
  //
  // Not `select("*")` either: that would drag every other athlete's date of
  // birth, weight, subscription and Stripe id into this process for a chip.
  const [{ data: profiles }, { data: injuries }] = await Promise.all([
    supabase
      .from("profiles")
      .select("user_id, username, display_name, avatar_url, current_split_index")
      .in("user_id", otherIds),
    supabase.from("profiles").select("user_id, injury_status").in("user_id", otherIds),
  ]);

  const injuryByUser = new Map((injuries ?? []).map((p) => [p.user_id, p.injury_status]));

  const profileMap = new Map(
    (profiles ?? []).map((p) => [
      p.user_id,
      mapFriendProfile({ ...p, injury_status: injuryByUser.get(p.user_id) }),
    ])
  );

  const toConnection = (row: (typeof rows)[0]): FriendConnection => {
    const otherId = row.user_id === userId ? row.friend_id : row.user_id;
    return {
      id: row.id,
      userId: row.user_id,
      friendId: row.friend_id,
      status: row.status,
      createdAt: row.created_at,
      profile: profileMap.get(otherId) ?? {
        userId: otherId,
        username: null,
        displayName: null,
        avatarUrl: null,
        currentSplitIndex: null,
        // Null, not a status: this branch is the "we could not read that
        // athlete's profile row at all" fallback. Injury status is opt-in and
        // self-set, so the honest value when we know nothing is "not told",
        // which is exactly what null means everywhere else it is rendered.
        injuryStatus: null,
      },
    };
  };

  const connections = rows.map(toConnection);

  return {
    friends: connections.filter((c) => c.status === "accepted"),
    incoming: connections.filter(
      (c) => c.status === "pending" && c.friendId === userId
    ),
    outgoing: connections.filter(
      (c) => c.status === "pending" && c.userId === userId
    ),
  };
}

export async function fetchChallenges(
  supabase: SupabaseClient,
  userId: string
): Promise<ChallengeWithProgress[]> {
  const { data: challenges } = await supabase
    .from("challenges")
    .select("*")
    .eq("is_global", true)
    .gte("end_date", new Date().toISOString().slice(0, 10))
    .order("start_date", { ascending: false });

  if (!challenges?.length) return [];

  const ids = challenges.map((c) => c.id);

  const [{ data: participants }, { data: myParticipation }] = await Promise.all([
    supabase
      .from("challenge_participants")
      .select("challenge_id")
      .in("challenge_id", ids),
    supabase
      .from("challenge_participants")
      .select("challenge_id, progress, completed")
      .eq("user_id", userId)
      .in("challenge_id", ids),
  ]);

  const countMap = new Map<string, number>();
  for (const p of participants ?? []) {
    countMap.set(p.challenge_id, (countMap.get(p.challenge_id) ?? 0) + 1);
  }

  const myMap = new Map(
    (myParticipation ?? []).map((p) => [p.challenge_id, p])
  );

  return challenges.map((c) => {
    const mine = myMap.get(c.id);
    const progress =
      mine && c.target_value > 0
        ? Math.min(100, Math.round((Number(mine.progress) / Number(c.target_value)) * 100))
        : 0;

    return {
      id: c.id,
      title: c.title,
      description: c.description,
      sport: c.sport,
      metric: c.metric,
      targetValue: Number(c.target_value),
      startDate: c.start_date,
      endDate: c.end_date,
      isGlobal: c.is_global,
      participantCount: countMap.get(c.id) ?? 0,
      joined: !!mine,
      progress,
      completed: mine?.completed ?? false,
    };
  });
}

/**
 * Friend-vs-friend duels (Slice C): standings are computed live from
 * workout_scores at read time for each accepted duel's own window/sport,
 * rather than maintained as a running counter that could drift out of sync.
 */
export async function fetchDuels(
  supabase: SupabaseClient,
  userId: string
): Promise<DuelWithStandings[]> {
  const { data: rows } = await supabase
    .from("duels")
    .select("*")
    .or(`challenger_id.eq.${userId},opponent_id.eq.${userId}`)
    .order("created_at", { ascending: false });

  if (!rows?.length) return [];

  const otherIds = Array.from(
    new Set(rows.flatMap((d) => [d.challenger_id, d.opponent_id]))
  );

  const { data: profiles } = await supabase
    .from("profiles")
    .select("user_id, username, display_name, avatar_url")
    .in("user_id", otherIds);

  const profileMap = new Map((profiles ?? []).map((p) => [p.user_id, p]));
  const today = new Date().toISOString().slice(0, 10);
  const acceptedRows = rows.filter((d) => d.status === "accepted");

  // One workout_scores query per accepted duel — each duel has its own
  // window/sport filter, so these can't be safely merged into one query.
  const scoreMaps = await Promise.all(
    acceptedRows.map(async (d) => {
      const windowEnd = d.end_date < today ? d.end_date : today;
      let query = supabase
        .from("workout_scores")
        .select("user_id, load_score, created_at, endurance_component, strength_component")
        .in("user_id", [d.challenger_id, d.opponent_id])
        .gte("created_at", `${d.start_date}T00:00:00.000Z`)
        .lt("created_at", duelWindowEndExclusive(windowEnd));
      if (d.sport) query = query.eq("sport", d.sport);
      const { data } = await query;
      return aggregateDuelScores(data ?? [], d.metric, [d.challenger_id, d.opponent_id]);
    })
  );

  const scoresByDuelId = new Map(acceptedRows.map((d, i) => [d.id, scoreMaps[i]]));

  return rows.map((d): DuelWithStandings => {
    const scores = scoresByDuelId.get(d.id);
    const challengerScore = scores?.[d.challenger_id] ?? 0;
    const opponentScore = scores?.[d.opponent_id] ?? 0;

    const toParticipant = (id: string, score: number): DuelParticipant => {
      const p = profileMap.get(id);
      return {
        userId: id,
        username: p?.username ?? null,
        displayName: p?.display_name ?? null,
        avatarUrl: p?.avatar_url ?? null,
        score,
      };
    };

    return {
      id: d.id,
      metric: d.metric,
      sport: d.sport,
      startDate: d.start_date,
      endDate: d.end_date,
      status: d.status,
      isChallenger: d.challenger_id === userId,
      challenger: toParticipant(d.challenger_id, challengerScore),
      opponent: toParticipant(d.opponent_id, opponentScore),
      ended: d.end_date < today,
      leaderId:
        d.status === "accepted"
          ? pickLeader(d.challenger_id, challengerScore, d.opponent_id, opponentScore)
          : null,
    };
  });
}

/**
 * Squads (Part 4): unlike duels' live workout_scores aggregation, a squad's
 * head-to-head view just ranks members by their existing current_split_index
 * — cheap, and already the number members recognize from their own dashboard.
 */
export async function fetchSquads(
  supabase: SupabaseClient,
  userId: string
): Promise<SquadSummary[]> {
  const { data: memberships } = await supabase
    .from("squad_members")
    .select("squad_id")
    .eq("user_id", userId);

  const squadIds = (memberships ?? []).map((m) => m.squad_id);
  if (!squadIds.length) return [];

  const [{ data: squads }, { data: allMembers }] = await Promise.all([
    supabase.from("squads").select("*").in("id", squadIds),
    supabase.from("squad_members").select("squad_id, user_id").in("squad_id", squadIds),
  ]);

  if (!squads?.length) return [];

  const memberIds = Array.from(new Set((allMembers ?? []).map((m) => m.user_id)));
  const { data: profiles } = await supabase
    .from("profiles")
    .select("user_id, username, display_name, avatar_url, current_split_index")
    .in("user_id", memberIds);

  const profileMap = new Map((profiles ?? []).map((p) => [p.user_id, p]));
  const membersBySquad = new Map<string, string[]>();
  for (const m of allMembers ?? []) {
    const list = membersBySquad.get(m.squad_id) ?? [];
    list.push(m.user_id);
    membersBySquad.set(m.squad_id, list);
  }

  return squads
    .map((s): SquadSummary => {
      const members = (membersBySquad.get(s.id) ?? [])
        .map((id) => {
          const p = profileMap.get(id);
          return {
            userId: id,
            username: p?.username ?? null,
            displayName: p?.display_name ?? null,
            avatarUrl: p?.avatar_url ?? null,
            currentSplitIndex: p?.current_split_index ?? null,
          };
        })
        .sort((a, b) => (b.currentSplitIndex ?? -1) - (a.currentSplitIndex ?? -1));

      return {
        id: s.id,
        name: s.name,
        inviteCode: s.invite_code,
        createdBy: s.created_by,
        createdAt: s.created_at,
        members,
      };
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function fetchAchievements(
  supabase: SupabaseClient,
  userId: string
): Promise<AchievementBadge[]> {
  const [{ data: all }, { data: earned }] = await Promise.all([
    supabase.from("achievements").select("*").order("title"),
    supabase
      .from("user_achievements")
      .select("achievement_id, earned_at")
      .eq("user_id", userId),
  ]);

  const earnedMap = new Map(
    (earned ?? []).map((e) => [e.achievement_id, e.earned_at])
  );

  return (all ?? []).map((a) => ({
    id: a.id,
    slug: a.slug,
    title: a.title,
    description: a.description,
    icon: a.icon,
    earned: earnedMap.has(a.id),
    earnedAt: earnedMap.get(a.id) ?? null,
  }));
}

export async function fetchPublicProfile(
  supabase: SupabaseClient,
  username: string
) {
  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("username", username)
    .single();

  if (!profile) return null;

  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();

  const [{ data: ownActivities }, { data: recentHistory }, { data: recentScores }] =
    await Promise.all([
      supabase
        .from("activities")
        .select("started_at")
        .eq("user_id", profile.user_id)
        .eq("is_draft", false)
        .order("started_at", { ascending: false })
        .limit(365),
      supabase
        .from("split_index_history")
        .select("split_index, recorded_at")
        .eq("user_id", profile.user_id)
        .gte("recorded_at", thirtyDaysAgo)
        .order("recorded_at", { ascending: false }),
      supabase
        .from("workout_scores")
        .select("created_at")
        .eq("user_id", profile.user_id)
        .gte("created_at", thirtyDaysAgo),
    ]);

  const { computeTrainingStreak } = await import("./streaks");
  const streakSource =
    ownActivities && ownActivities.length > 0
      ? ownActivities.map((a) => a.started_at)
      : (recentHistory ?? []).map((h) => h.recorded_at);
  // This athlete's own zone, not the server's — a streak is a count of THEIR
  // days. See computeTrainingStreak.
  const streak = computeTrainingStreak(streakSource, new Date(), profile.timezone);

  const recentActivityCount =
    (recentScores ?? []).length ||
    (ownActivities ?? []).filter(
      (a) => new Date(a.started_at) >= new Date(thirtyDaysAgo)
    ).length;

  const recentAvgIndex =
    recentHistory && recentHistory.length > 0
      ? Math.round(
          recentHistory.reduce((s, h) => s + h.split_index, 0) /
            recentHistory.length
        )
      : null;

  return {
    userId: profile.user_id,
    username: profile.username!,
    displayName: profile.display_name,
    avatarUrl: profile.avatar_url,
    bio: profile.bio,
    country: profile.country,
    preferredSports: profile.preferred_sports ?? [],
    currentSplitIndex: profile.current_split_index,
    currentEnduranceIndex: profile.current_endurance_index,
    currentStrengthIndex: profile.current_strength_index,
    // Parsed rather than cast: the column is free-form text at the database
    // level, and this value is rendered on a page other people can see, so an
    // unrecognised string becomes null instead of reaching the badge.
    injuryStatus: parseInjuryStatus(profile.injury_status),
    createdAt: profile.created_at,
    streak,
    recentActivityCount,
    recentAvgIndex,
  };
}

export async function fetchCompareHistory(
  supabase: SupabaseClient,
  userId: string,
  otherUserId: string,
  days: number,
  metric: "split" | "endurance" | "strength"
) {
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();

  const [{ data: selfHistory }, { data: otherHistory }, { data: profiles }] =
    await Promise.all([
      supabase
        .from("split_index_history")
        .select("split_index, endurance_index, strength_index, recorded_at")
        .eq("user_id", userId)
        .gte("recorded_at", cutoff)
        .order("recorded_at", { ascending: true }),
      supabase
        .from("split_index_history")
        .select("split_index, endurance_index, strength_index, recorded_at")
        .eq("user_id", otherUserId)
        .gte("recorded_at", cutoff)
        .order("recorded_at", { ascending: true }),
      supabase
        .from("profiles")
        .select("user_id, username, display_name")
        .in("user_id", [userId, otherUserId]),
    ]);

  const valueKey =
    metric === "endurance"
      ? "endurance_index"
      : metric === "strength"
        ? "strength_index"
        : "split_index";

  const toSeries = (
    history: typeof selfHistory,
    label: string,
    username: string | null,
    color: string
  ) => ({
    label,
    username,
    color,
    data: (history ?? []).map((h) => ({
      date: new Date(h.recorded_at).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
      }),
      value: h[valueKey] as number,
    })),
  });

  const profileMap = new Map(
    (profiles ?? []).map((p) => [p.user_id, p])
  );

  return [
    toSeries(
      selfHistory,
      profileMap.get(userId)?.display_name ?? "You",
      profileMap.get(userId)?.username ?? null,
      "#00e65f"
    ),
    toSeries(
      otherHistory,
      profileMap.get(otherUserId)?.display_name ?? "Peer",
      profileMap.get(otherUserId)?.username ?? null,
      "#0ea5e9"
    ),
  ];
}

export interface LeaderboardDetailLift {
  name: string;
  estimated1RmKg: number;
  tier?: string;
}

export interface LeaderboardDetail {
  topLifts: LeaderboardDetailLift[];
  racePredictions: Record<string, number> | null;
}

/**
 * Premium-only leaderboard detail card data (MASTER-BRIEF.md §9) — top
 * lifts and race predictions for another user, tapped from the leaderboard.
 * Only derived scores are exposed (estimated 1RM, tier, predicted times),
 * never raw bodyweight/HR/personal data. Reads workout_scores directly
 * (public-read RLS, same as the rest of the leaderboard), most recent gym
 * and running sessions only.
 */
export async function fetchLeaderboardDetail(
  supabase: SupabaseClient,
  targetUserId: string
): Promise<LeaderboardDetail> {
  const [{ data: gymRow }, { data: cardioRow }] = await Promise.all([
    supabase
      .from("workout_scores")
      .select("score_breakdown")
      .eq("user_id", targetUserId)
      .eq("sport", "gym")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("workout_scores")
      .select("score_breakdown")
      .eq("user_id", targetUserId)
      .eq("sport", "running")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const strengthActivities =
    ((gymRow?.score_breakdown as Record<string, unknown> | null)?.strength_activities as
      | Array<{ liftKey: string; oneRM: number; score: number; tier?: string }>
      | undefined) ?? [];

  const topLifts: LeaderboardDetailLift[] = [...strengthActivities]
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map((r) => ({ name: r.liftKey, estimated1RmKg: r.oneRM, tier: r.tier }));

  const cardioActivity = (cardioRow?.score_breakdown as Record<string, unknown> | null)
    ?.cardio_activity as { predictions?: Record<string, number> | null } | undefined;

  return {
    topLifts,
    racePredictions: cardioActivity?.predictions ?? null,
  };
}
