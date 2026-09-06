import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SocialHub } from "@/components/social/social-hub";
import { fetchLeaderboardWithBracket } from "@/lib/social/leaderboard";
import {
  fetchAchievements,
  fetchChallenges,
  fetchDuels,
  fetchFriendsData,
  fetchSquads,
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
      "onboarding_completed, subscription_tier, subscription_status, country, timezone"
    )
    .eq("user_id", user.id)
    .single();

  if (!profile?.onboarding_completed) redirect("/onboarding");

  const premium = isPremiumUser(
    profile.subscription_tier,
    profile.subscription_status
  );

  const [
    { data: activityDates },
    leaderboardResult,
    friendsData,
    challenges,
    achievements,
    duels,
    squads,
  ] = await Promise.all([
      supabase
        .from("activities")
        .select("started_at")
        .eq("user_id", user.id)
        .eq("is_draft", false)
        .order("started_at", { ascending: false })
        .limit(365),
      fetchLeaderboardWithBracket(
        supabase,
        {
          period: "all_time",
          scope: "bracket",
          country: profile.country ?? undefined,
          metric: "split",
        },
        user.id
      ),
      fetchFriendsData(supabase, user.id),
      fetchChallenges(supabase, user.id),
      fetchAchievements(supabase, user.id),
      fetchDuels(supabase, user.id),
      fetchSquads(supabase, user.id),
    ]);

  // The athlete's own zone, so this streak matches the one on their dashboard.
  // These two used to disagree every morning: the dashboard counted a rest day
  // today as part of the streak and this did not, and the two bucketed days in
  // different zones on top of that.
  const streak = computeTrainingStreak(
    (activityDates ?? []).map((a) => a.started_at as string),
    new Date(),
    profile.timezone
  );

  return (
    <SocialHub
      currentUserId={user.id}
      userCountry={profile.country}
      isPremium={premium}
      leaderboard={leaderboardResult.rows}
      leaderboardBracket={leaderboardResult.bracket}
      friends={friendsData.friends}
      incoming={friendsData.incoming}
      outgoing={friendsData.outgoing}
      challenges={challenges}
      achievements={achievements}
      duels={duels}
      squads={squads}
      streak={streak}
    />
  );
}
