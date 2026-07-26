import type { SupabaseClient } from "@supabase/supabase-js";

/** Percentile of users beaten (0–100). Higher = better rank. */
export async function getGlobalRankPercentile(
  supabase: SupabaseClient,
  userIndex: number
): Promise<number | null> {
  const { count: total } = await supabase
    .from("profiles")
    .select("*", { count: "exact", head: true })
    .not("current_split_index", "is", null);

  if (!total || total < 2) return null;

  const { count: below } = await supabase
    .from("profiles")
    .select("*", { count: "exact", head: true })
    .lt("current_split_index", userIndex);

  const beaten = below ?? 0;
  return Math.round((beaten / total) * 100);
}

/** The nearest athlete ranked just above this one, and how many index points it'd take to pass them — the "beat someone" competitive hook (user feedback: dashboard should give users "a competitive element to want to improve their score as well as beat others"). Null when this athlete is already #1 or ranking data doesn't exist yet. */
export async function getNextRankTarget(
  supabase: SupabaseClient,
  userIndex: number
): Promise<{ pointsToClose: number; nextIndex: number } | null> {
  const { data } = await supabase
    .from("profiles")
    .select("current_split_index")
    .gt("current_split_index", userIndex)
    .order("current_split_index", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!data?.current_split_index) return null;
  const nextIndex = data.current_split_index as number;
  return { pointsToClose: nextIndex - userIndex, nextIndex };
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
