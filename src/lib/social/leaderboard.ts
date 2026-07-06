import type { SupabaseClient } from "@supabase/supabase-js";
import type { LeaderboardPeriod } from "@/types";
import {
  getPeriodStart,
  matchesAgeBracket,
  matchesWeightClass,
  type IndexMetric,
  type LeaderboardScope,
} from "./constants";
import type { LeaderboardFilters, LeaderboardRow } from "./types";

interface ProfileRow {
  user_id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  country: string | null;
  age: number | null;
  weight_kg: number | null;
  current_split_index: number | null;
  current_endurance_index: number | null;
  current_strength_index: number | null;
}

function indexValue(profile: ProfileRow, metric: IndexMetric): number | null {
  if (metric === "endurance") return profile.current_endurance_index;
  if (metric === "strength") return profile.current_strength_index;
  return profile.current_split_index;
}

function filterProfiles(
  profiles: ProfileRow[],
  filters: LeaderboardFilters
): ProfileRow[] {
  return profiles.filter((p) => {
    if (!p.username || indexValue(p, filters.metric) == null) return false;
    if (filters.scope === "country" && filters.country) {
      if (p.country?.toUpperCase() !== filters.country.toUpperCase()) return false;
    }
    if (filters.scope === "age" && filters.ageBracket) {
      if (!matchesAgeBracket(p.age, filters.ageBracket)) return false;
    }
    if (filters.scope === "weight" && filters.weightClass) {
      if (!matchesWeightClass(Number(p.weight_kg), filters.weightClass)) return false;
    }
    return true;
  });
}

async function computeTrends(
  supabase: SupabaseClient,
  userIds: string[],
  metric: IndexMetric
): Promise<Map<string, number>> {
  const trends = new Map<string, number>();
  if (userIds.length === 0) return trends;

  const cutoff = new Date(Date.now() - 7 * 86400000).toISOString();
  const { data: history } = await supabase
    .from("split_index_history")
    .select("user_id, split_index, endurance_index, strength_index, recorded_at")
    .in("user_id", userIds)
    .gte("recorded_at", cutoff)
    .order("recorded_at", { ascending: true });

  for (const userId of userIds) {
    const rows = (history ?? []).filter((h) => h.user_id === userId);
    if (rows.length < 2) {
      trends.set(userId, 0);
      continue;
    }
    const first = rows[0];
    const last = rows[rows.length - 1];
    const start =
      metric === "endurance"
        ? first.endurance_index
        : metric === "strength"
          ? first.strength_index
          : first.split_index;
    const end =
      metric === "endurance"
        ? last.endurance_index
        : metric === "strength"
          ? last.strength_index
          : last.split_index;
    trends.set(userId, end - start);
  }

  return trends;
}

function toRows(
  profiles: ProfileRow[],
  metric: IndexMetric,
  trends: Map<string, number>,
  previousRanks?: Map<string, number | null>
): LeaderboardRow[] {
  const sorted = [...profiles].sort(
    (a, b) => (indexValue(b, metric) ?? 0) - (indexValue(a, metric) ?? 0)
  );

  return sorted.slice(0, 50).map((p, i) => ({
    rank: i + 1,
    userId: p.user_id,
    username: p.username,
    displayName: p.display_name,
    avatarUrl: p.avatar_url,
    country: p.country,
    splitIndex: p.current_split_index ?? 0,
    enduranceIndex: p.current_endurance_index,
    strengthIndex: p.current_strength_index,
    trend: trends.get(p.user_id) ?? 0,
    previousRank: previousRanks?.get(p.user_id) ?? null,
  }));
}

export async function fetchLeaderboard(
  supabase: SupabaseClient,
  filters: LeaderboardFilters
): Promise<LeaderboardRow[]> {
  const periodStart = getPeriodStart(filters.period);
  const metricField =
    filters.metric === "endurance"
      ? "endurance_index"
      : filters.metric === "strength"
        ? "strength_index"
        : "split_index";

  const { data: entries } = await supabase
    .from("leaderboard_entries")
    .select(
      "user_id, split_index, endurance_index, strength_index, rank, previous_rank"
    )
    .eq("period", filters.period)
    .eq("period_start", periodStart)
    .order("rank", { ascending: true })
    .limit(50);

  if (entries && entries.length > 0) {
    const userIds = entries.map((e) => e.user_id);
    const { data: profiles } = await supabase
      .from("profiles")
      .select(
        "user_id, username, display_name, avatar_url, country, age, weight_kg, current_split_index, current_endurance_index, current_strength_index"
      )
      .in("user_id", userIds);

    const profileMap = new Map(
      (profiles ?? []).map((p) => [p.user_id, p as ProfileRow])
    );

    let filtered = entries
      .map((e) => ({ entry: e, profile: profileMap.get(e.user_id) }))
      .filter(({ profile }) => profile && profile.username);

    if (filters.scope !== "global" && filters.scope !== "sport") {
      filtered = filtered.filter(({ profile }) =>
        profile
          ? filterProfiles([profile], filters).length > 0
          : false
      );
    }

    const trends = await computeTrends(supabase, userIds, filters.metric);

    return filtered.map(({ entry, profile }, i) => ({
      rank: i + 1,
      userId: entry.user_id,
      username: profile!.username,
      displayName: profile!.display_name,
      avatarUrl: profile!.avatar_url,
      country: profile!.country,
      splitIndex: entry.split_index,
      enduranceIndex: entry.endurance_index,
      strengthIndex: entry.strength_index,
      trend: trends.get(entry.user_id) ?? 0,
      previousRank: entry.previous_rank,
    }));
  }

  const { data: allProfiles } = await supabase
    .from("profiles")
    .select(
      "user_id, username, display_name, avatar_url, country, age, weight_kg, current_split_index, current_endurance_index, current_strength_index"
    )
    .not("current_split_index", "is", null)
    .not("username", "is", null)
    .order(metricField, { ascending: false })
    .limit(200);

  const filtered = filterProfiles((allProfiles ?? []) as ProfileRow[], filters);
  const userIds = filtered.map((p) => p.user_id);
  const trends = await computeTrends(supabase, userIds, filters.metric);

  return toRows(filtered, filters.metric, trends);
}

export function getDisplayIndex(row: LeaderboardRow, metric: IndexMetric): number {
  if (metric === "endurance") return row.enduranceIndex ?? 0;
  if (metric === "strength") return row.strengthIndex ?? 0;
  return row.splitIndex;
}

export type { LeaderboardPeriod, LeaderboardScope, IndexMetric };
