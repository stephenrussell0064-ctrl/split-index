import type { SupabaseClient } from "@supabase/supabase-js";
import type { LeaderboardPeriod } from "@/types";
import {
  getPeriodStart,
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

/**
 * A peer row, as leaderboard_profiles hands it over (migration 056).
 *
 * This used to be a slice of `profiles` carrying `age`, `weight_kg` and
 * `gender`. Every athlete's exact bodyweight travelled to the browser so that
 * bracket matching could happen in TypeScript, and the RLS policy that allowed
 * it let anyone with the anon key read the same columns directly. The view
 * bands those three in SQL instead, so the leaderboard gets the segmentation
 * without the values.
 */
interface ProfileRow {
  user_id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  country: string | null;
  age_bracket: string | null;
  weight_class: string | null;
  age_band: string | null;
  weight_band: string | null;
  sex: string | null;
  current_split_index: number | null;
  current_endurance_index: number | null;
  current_strength_index: number | null;
}

const PROFILE_SELECT =
  "user_id, username, display_name, avatar_url, country, age_bracket, weight_class, age_band, weight_band, sex, current_split_index, current_endurance_index, current_strength_index";

/** The viewer's own numbers, read from their own profiles row — see resolveBracket. */
interface ViewerBracketInput {
  age: number | null;
  weightKg: number | null;
  gender: string | null;
}

function indexValue(profile: ProfileRow, metric: IndexMetric): number | null {
  if (metric === "endurance") return profile.current_endurance_index;
  if (metric === "strength") return profile.current_strength_index;
  return profile.current_split_index;
}

function toCandidate(p: ProfileRow): BracketCandidate {
  return {
    userId: p.user_id,
    ageBand: p.age_band,
    weightBand: p.weight_band,
    sex: p.sex,
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
    // The scope filters compare bands rather than re-deriving them from an age
    // and a bodyweight, because the view has already done that in SQL. Same
    // boundaries — AGE_BRACKETS and WEIGHT_CLASSES — decided one layer down.
    if (filters.scope === "age" && filters.ageBracket) {
      if (p.age_bracket !== filters.ageBracket) return false;
    }
    if (filters.scope === "weight" && filters.weightClass) {
      if (p.weight_class !== filters.weightClass) return false;
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
    // public_index_history, not split_index_history: the same four index
    // columns without fatigue_score and recovery_score, which are special
    // category data and which nothing here has ever read.
    .from("public_index_history")
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
    .from("leaderboard_profiles")
    .select(PROFILE_SELECT)
    .not(profileMetricField, "is", null)
    .order(profileMetricField, { ascending: false })
    .limit(500);

  // The `.not("username", "is", null)` filter that used to sit here is now the
  // view's WHERE clause, so it cannot be forgotten by a future caller.
  return (data ?? []) as ProfileRow[];
}

function buildBracketSummary(
  viewerUserId: string,
  viewerInput: ViewerBracketInput | null,
  allProfiles: ProfileRow[],
  metric: IndexMetric
): BracketSummary | null {
  if (!viewerInput) return null;

  const candidates = allProfiles.map(toCandidate);
  const resolution = resolveBracket(viewerInput, candidates);

  const global = rankAmong(allProfiles, viewerUserId, metric);

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
  const bracket = rankAmong(bracketPeers, viewerUserId, metric);

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

  // The viewer's own age and bodyweight, read from their own profiles row
  // rather than from the banded view. Deciding which way to widen a bracket
  // depends on whether they sit in the upper or lower half of their own band,
  // which a band label cannot answer — and an athlete reading their own
  // bodyweight is exactly what the owner policy is for. Nobody else's numbers
  // are fetched here.
  const { data: viewerRow } = await supabase
    .from("profiles")
    .select("age, weight_kg, gender")
    .eq("user_id", viewerUserId)
    .maybeSingle();

  const viewerInput: ViewerBracketInput | null = viewerRow
    ? {
        age: viewerRow.age,
        weightKg: viewerRow.weight_kg != null ? Number(viewerRow.weight_kg) : null,
        gender: viewerRow.gender,
      }
    : null;

  const bracket = buildBracketSummary(
    viewerUserId,
    viewerInput,
    allProfiles,
    filters.metric
  );

  if (filters.scope === "bracket") {
    if (!viewerInput || !bracket || bracket.unavailableReason) {
      return { rows: [], bracket };
    }

    const resolution = resolveBracket(viewerInput, allProfiles.map(toCandidate));

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
    .from("public_leaderboard_entries")
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
      .from("leaderboard_profiles")
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
    .from("public_leaderboard_entries")
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
      .from("leaderboard_profiles")
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
