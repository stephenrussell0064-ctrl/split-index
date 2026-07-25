import type { SupabaseClient } from "@supabase/supabase-js";
import type { LeaderboardPeriod } from "@/types";
import {
  getPeriodStart,
  matchesAgeBracket,
  matchesWeightClass,
  type IndexMetric,
  type LeaderboardScope,
} from "./constants";
import {
  matchesEffectiveBracket,
  resolveBracket,
  type BracketCandidate,
} from "./leaderboard-brackets";
import type {
  BracketSummary,
  LeaderboardFilters,
  LeaderboardResponse,
  LeaderboardRow,
} from "./types";

interface ProfileRow {
  user_id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  country: string | null;
  age: number | null;
  weight_kg: number | null;
  gender: string | null;
  current_split_index: number | null;
  current_endurance_index: number | null;
  current_strength_index: number | null;
}

const PROFILE_SELECT =
  "user_id, username, display_name, avatar_url, country, age, weight_kg, gender, current_split_index, current_endurance_index, current_strength_index";

function indexValue(profile: ProfileRow, metric: IndexMetric): number | null {
  if (metric === "endurance") return profile.current_endurance_index;
  if (metric === "strength") return profile.current_strength_index;
  return profile.current_split_index;
}

function toCandidate(p: ProfileRow): BracketCandidate {
  return {
    userId: p.user_id,
    age: p.age,
    weightKg: p.weight_kg != null ? Number(p.weight_kg) : null,
    gender: p.gender,
  };
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

function rankAmong(
  profiles: ProfileRow[],
  userId: string,
  metric: IndexMetric
): { rank: number | null; size: number } {
  const scored = profiles
    .filter((p) => p.username && indexValue(p, metric) != null)
    .sort((a, b) => (indexValue(b, metric) ?? 0) - (indexValue(a, metric) ?? 0));
  const idx = scored.findIndex((p) => p.user_id === userId);
  return {
    rank: idx >= 0 ? idx + 1 : null,
    size: scored.length,
  };
}

async function loadScoredProfiles(
  supabase: SupabaseClient,
  metric: IndexMetric
): Promise<ProfileRow[]> {
  const profileMetricField =
    metric === "endurance"
      ? "current_endurance_index"
      : metric === "strength"
        ? "current_strength_index"
        : "current_split_index";

  const { data } = await supabase
    .from("profiles")
    .select(PROFILE_SELECT)
    .not(profileMetricField, "is", null)
    .not("username", "is", null)
    .order(profileMetricField, { ascending: false })
    .limit(500);

  return (data ?? []) as ProfileRow[];
}

function buildBracketSummary(
  viewer: ProfileRow | null,
  allProfiles: ProfileRow[],
  metric: IndexMetric
): BracketSummary | null {
  if (!viewer) return null;

  const candidates = allProfiles.map(toCandidate);
  const resolution = resolveBracket(
    {
      age: viewer.age,
      weightKg: viewer.weight_kg != null ? Number(viewer.weight_kg) : null,
      gender: viewer.gender,
    },
    candidates
  );

  const global = rankAmong(allProfiles, viewer.user_id, metric);

  if (!resolution) {
    return {
      exactLabel: "—",
      effectiveLabel: "—",
      bracketRank: null,
      bracketSize: 0,
      globalRank: global.rank,
      globalSize: global.size,
      widenLevel: "global",
      showInvitePrompt: false,
      unavailableReason: "missing_profile",
    };
  }

  const bracketPeers = allProfiles.filter((p) =>
    matchesEffectiveBracket(toCandidate(p), resolution.effective)
  );
  const bracket = rankAmong(bracketPeers, viewer.user_id, metric);

  return {
    exactLabel: resolution.exact.label,
    effectiveLabel: resolution.effective.label,
    bracketRank: bracket.rank,
    bracketSize: resolution.size,
    globalRank: global.rank,
    globalSize: global.size,
    widenLevel: resolution.effective.widenLevel,
    showInvitePrompt: resolution.showInvitePrompt,
  };
}

/**
 * Fetch leaderboard rows for the given filters, plus the viewer's bracket
 * summary (exact label always preserved; ranking may use a widened bracket).
 */
export async function fetchLeaderboardWithBracket(
  supabase: SupabaseClient,
  filters: LeaderboardFilters,
  viewerUserId: string
): Promise<LeaderboardResponse> {
  const allProfiles = await loadScoredProfiles(supabase, filters.metric);
  const viewer =
    allProfiles.find((p) => p.user_id === viewerUserId) ??
    (
      await supabase
        .from("profiles")
        .select(PROFILE_SELECT)
        .eq("user_id", viewerUserId)
        .maybeSingle()
    ).data;

  const bracket = buildBracketSummary(
    viewer as ProfileRow | null,
    allProfiles,
    filters.metric
  );

  if (filters.scope === "bracket") {
    if (!viewer || !bracket || bracket.unavailableReason) {
      return { rows: [], bracket };
    }

    const resolution = resolveBracket(
      {
        age: (viewer as ProfileRow).age,
        weightKg:
          (viewer as ProfileRow).weight_kg != null
            ? Number((viewer as ProfileRow).weight_kg)
            : null,
        gender: (viewer as ProfileRow).gender,
      },
      allProfiles.map(toCandidate)
    );

    if (!resolution) {
      return { rows: [], bracket };
    }

    const peers = allProfiles.filter((p) =>
      matchesEffectiveBracket(toCandidate(p), resolution.effective)
    );
    const userIds = peers.map((p) => p.user_id);
    const trends = await computeTrends(supabase, userIds, filters.metric);
    return { rows: toRows(peers, filters.metric, trends), bracket };
  }

  // Non-bracket scopes — keep prior behaviour, still attach bracket summary.
  const periodStart = getPeriodStart(filters.period);

  const { data: entries } = await supabase
    .from("leaderboard_entries")
    .select(
      "user_id, split_index, endurance_index, strength_index, rank, previous_rank"
    )
    .eq("period", filters.period)
    .eq("period_start", periodStart)
    .order("rank", { ascending: true })
    .limit(50);

  if (entries && entries.length > 0 && filters.metric === "split") {
    const userIds = entries.map((e) => e.user_id);
    const { data: profiles } = await supabase
      .from("profiles")
      .select(PROFILE_SELECT)
      .in("user_id", userIds);

    const profileMap = new Map(
      (profiles ?? []).map((p) => [p.user_id, p as ProfileRow])
    );

    let filtered = entries
      .map((e) => ({ entry: e, profile: profileMap.get(e.user_id) }))
      .filter(({ profile }) => profile && profile.username);

    if (filters.scope !== "global" && filters.scope !== "sport") {
      filtered = filtered.filter(({ profile }) =>
        profile ? filterProfiles([profile], filters).length > 0 : false
      );
    }

    const trends = await computeTrends(supabase, userIds, filters.metric);

    const rows = filtered.map(({ entry, profile }, i) => ({
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

    return { rows, bracket };
  }

  const filtered = filterProfiles(allProfiles, filters);
  const userIds = filtered.map((p) => p.user_id);
  const trends = await computeTrends(supabase, userIds, filters.metric);

  return { rows: toRows(filtered, filters.metric, trends), bracket };
}

/** Back-compat: rows only (used by SSR seeders that don't need bracket yet). */
export async function fetchLeaderboard(
  supabase: SupabaseClient,
  filters: LeaderboardFilters,
  viewerUserId?: string
): Promise<LeaderboardRow[]> {
  if (viewerUserId) {
    const result = await fetchLeaderboardWithBracket(
      supabase,
      filters,
      viewerUserId
    );
    return result.rows;
  }

  // Legacy path without viewer — no bracket scope support.
  if (filters.scope === "bracket") {
    return [];
  }

  const periodStart = getPeriodStart(filters.period);
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
      .select(PROFILE_SELECT)
      .in("user_id", userIds);

    const profileMap = new Map(
      (profiles ?? []).map((p) => [p.user_id, p as ProfileRow])
    );

    let filtered = entries
      .map((e) => ({ entry: e, profile: profileMap.get(e.user_id) }))
      .filter(({ profile }) => profile && profile.username);

    if (filters.scope !== "global" && filters.scope !== "sport") {
      filtered = filtered.filter(({ profile }) =>
        profile ? filterProfiles([profile], filters).length > 0 : false
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

  const profiles = await loadScoredProfiles(supabase, filters.metric);
  const filtered = filterProfiles(profiles, filters);
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
