import type { SupabaseClient } from "@supabase/supabase-js";
import { percentileForScore, nextStandardsTierTarget } from "@/lib/scoring/percentile-framework";

/** Below this many real scored profiles, a peer-based percentile/rank claim is more likely to mislead than motivate (e.g. "Top 50%" out of 3 people) — mirrors MIN_BRACKET_SIZE's convention in the leaderboard bracket system. */
const MIN_PEER_POOL = 20;

export interface RankPercentileResult {
  percentile: number;
  /** True when this is a real "you beat N% of actual users" claim; false when the real pool is too small to be meaningful and this falls back to a standards-based percentile (against the same published/derived reference the score curve itself is calibrated from) instead. */
  isPeerBased: boolean;
  poolSize: number;
}

/** Percentile of users beaten (0–100), or a standards-based percentile when there aren't enough real scored profiles for a peer comparison to mean anything. Higher = better rank. */
export async function getGlobalRankPercentile(
  supabase: SupabaseClient,
  userIndex: number
): Promise<RankPercentileResult> {
  const { count: total } = await supabase
    .from("profiles")
    .select("*", { count: "exact", head: true })
    .not("current_split_index", "is", null);

  const poolSize = total ?? 0;

  if (poolSize >= MIN_PEER_POOL) {
    const { count: below } = await supabase
      .from("profiles")
      .select("*", { count: "exact", head: true })
      .lt("current_split_index", userIndex);

    return {
      percentile: Math.round(((below ?? 0) / poolSize) * 100),
      isPeerBased: true,
      poolSize,
    };
  }

  return { percentile: Math.round(percentileForScore(userIndex)), isPeerBased: false, poolSize };
}

export type NextRankTarget =
  | { type: "peer"; pointsToClose: number; nextIndex: number }
  | { type: "standard"; pointsToClose: number; tierLabel: string };

/**
 * The nearest athlete ranked just above this one, and how many index points
 * it'd take to pass them — the "beat someone" competitive hook (user
 * feedback: dashboard should give users "a competitive element to want to
 * improve their score as well as beat others"). Falls back to a real,
 * standards-based next-tier target (needs no peer data at all) when either
 * no one ranks above yet, or the scored population is too small for a
 * peer-rank claim to feel earned rather than hollow ("you're #1 of 3").
 */
export async function getNextRankTarget(
  supabase: SupabaseClient,
  userIndex: number
): Promise<NextRankTarget | null> {
  const { data } = await supabase
    .from("profiles")
    .select("current_split_index")
    .gt("current_split_index", userIndex)
    .order("current_split_index", { ascending: true })
    .limit(1)
    .maybeSingle();

  const nextIndex = data?.current_split_index as number | undefined;
  if (nextIndex != null) {
    return { type: "peer", pointsToClose: nextIndex - userIndex, nextIndex };
  }

  // Nobody ranks above yet — only a real "#1" once the scored population
  // behind this athlete is large enough to have earned it; below that, a
  // standards-based next-tier target (needs no peer data at all) is a more
  // honest hook than a hollow "you're #1 of 3" crown.
  const { count: poolSize } = await supabase
    .from("profiles")
    .select("*", { count: "exact", head: true })
    .not("current_split_index", "is", null);

  if ((poolSize ?? 0) >= MIN_PEER_POOL) return null;

  const standard = nextStandardsTierTarget(userIndex);
  return standard
    ? { type: "standard", pointsToClose: standard.pointsToClose, tierLabel: standard.label }
    : null;
}

export async function seedRetentionNotifications(
  supabase: SupabaseClient,
  userId: string,
  opts: {
    atRisk: boolean;
    streak: number;
    hasActivities: boolean;
    isNewAccount: boolean;
  }
): Promise<void> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  if (opts.atRisk && opts.streak > 0) {
    const { data: existing } = await supabase
      .from("notifications")
      .select("id")
      .eq("user_id", userId)
      .eq("type", "streak_reminder")
      .gte("created_at", todayStart.toISOString())
      .limit(1);

    if (!existing?.length) {
      await supabase.from("notifications").insert({
        user_id: userId,
        type: "streak_reminder",
        title: "Keep your streak alive",
        body: `Your ${opts.streak}-day streak ends if you don't train today.`,
        read: false,
      });
    }
  }

  if (opts.isNewAccount && !opts.hasActivities) {
    const { data: welcome } = await supabase
      .from("notifications")
      .select("id")
      .eq("user_id", userId)
      .eq("type", "welcome")
      .limit(1);

    if (!welcome?.length) {
      await supabase.from("notifications").insert({
        user_id: userId,
        type: "welcome",
        title: "Welcome to Split Index",
        body: "Log your first workout to activate your live index score.",
        read: false,
      });
    }
  }
}
