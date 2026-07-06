import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/layout/app-shell";
import { SocialHub } from "@/components/social/social-hub";
import { fetchLeaderboard } from "@/lib/social/leaderboard";
import {
  fetchAchievements,
  fetchChallenges,
  fetchFriendsData,
} from "@/lib/social/queries";
import { computeTrainingStreak } from "@/lib/social/streaks";
import { isPremiumUser } from "@/lib/retention/trial";

export default async function SocialPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "onboarding_completed, subscription_tier, subscription_status, country"
    )
    .eq("user_id", user.id)
    .single();

  if (!profile?.onboarding_completed) redirect("/onboarding");

  const premium = isPremiumUser(
    profile.subscription_tier,
    profile.subscription_status
  );

  const [{ data: activityDates }, leaderboard, friendsData, challenges, achievements] =
    await Promise.all([
      supabase
        .from("activities")
        .select("started_at")
        .eq("user_id", user.id)
        .eq("is_draft", false)
        .order("started_at", { ascending: false })
        .limit(365),
      fetchLeaderboard(supabase, {
        period: "all_time",
        scope: premium ? "global" : "country",
        country: profile.country ?? undefined,
        metric: "split",
      }),
      fetchFriendsData(supabase, user.id),
      fetchChallenges(supabase, user.id),
      fetchAchievements(supabase, user.id),
    ]);

  const streak = computeTrainingStreak(
    (activityDates ?? []).map((a) => a.started_at as string)
  );

  return (
    <AppShell>
      <SocialHub
        currentUserId={user.id}
        userCountry={profile.country}
        isPremium={premium}
        leaderboard={leaderboard}
        friends={friendsData.friends}
        incoming={friendsData.incoming}
        outgoing={friendsData.outgoing}
        challenges={challenges}
        achievements={achievements}
        streak={streak}
      />
    </AppShell>
  );
}
