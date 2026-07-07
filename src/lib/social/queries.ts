import type { SupabaseClient } from "@supabase/supabase-js";
import type { AchievementBadge, ChallengeWithProgress, FriendConnection } from "./types";

function mapFriendProfile(row: {
  user_id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  current_split_index: number | null;
}) {
  return {
    userId: row.user_id,
    username: row.username,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    currentSplitIndex: row.current_split_index,
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

  const { data: profiles } = await supabase
    .from("profiles")
    .select("user_id, username, display_name, avatar_url, current_split_index")
    .in("user_id", otherIds);

  const profileMap = new Map(
    (profiles ?? []).map((p) => [p.user_id, mapFriendProfile(p)])
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
  const streak = computeTrainingStreak(streakSource);

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
