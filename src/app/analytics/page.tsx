import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/layout/app-shell";
import { AnalyticsClient } from "@/components/analytics/analytics-client";
import { isPremiumUser } from "@/lib/retention/trial";
import type { AnalyticsPayload } from "@/components/analytics/types";
import type { PersonalRecord } from "@/types";

const DAY_MS = 86400000;
const HISTORY_DAYS = 365;
const ACTIVITY_DAYS = 365;

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * DAY_MS).toISOString();
}

export default async function AnalyticsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("onboarding_completed, subscription_tier, subscription_status, max_hr")
    .eq("user_id", user.id)
    .single();

  if (!profile?.onboarding_completed) redirect("/onboarding");

  const premium = isPremiumUser(
    profile.subscription_tier,
    profile.subscription_status
  );
  const historyCutoff = isoDaysAgo(premium ? HISTORY_DAYS : 7);
  const activityCutoff = isoDaysAgo(ACTIVITY_DAYS);

  const [
    { data: indexHistory },
    { data: activities },
    { data: scores },
    { data: personalRecords },
  ] = await Promise.all([
    supabase
      .from("split_index_history")
      .select("*")
      .eq("user_id", user.id)
      .gte("recorded_at", historyCutoff)
      .order("recorded_at", { ascending: true })
      .limit(400),
    supabase
      .from("activities")
      .select(
        "id, sport, started_at, duration_seconds, distance_meters, avg_heart_rate, max_heart_rate, session_type, rpe"
      )
      .eq("user_id", user.id)
      .eq("is_draft", false)
      .gte("started_at", activityCutoff)
      .order("started_at", { ascending: true })
      .limit(1000),
    supabase
      .from("workout_scores")
      .select("activity_id, sport, sport_index, load_score, created_at")
      .eq("user_id", user.id)
      .gte("created_at", activityCutoff)
      .order("created_at", { ascending: true })
      .limit(1000),
    supabase
      .from("personal_records")
      .select("*")
      .eq("user_id", user.id)
      .order("achieved_at", { ascending: false })
      .limit(50),
  ]);

  const payload: AnalyticsPayload = {
    isPremium: premium,
    maxHr: profile.max_hr,
    targetSessionsPerWeek: 4,
    indexHistory: indexHistory ?? [],
    activities: (activities ?? []).map((a) => ({
      id: a.id as string,
      sport: a.sport,
      started_at: a.started_at as string,
      duration_seconds: a.duration_seconds as number,
      distance_meters: a.distance_meters as number | null,
      avg_heart_rate: a.avg_heart_rate as number | null,
      max_heart_rate: a.max_heart_rate as number | null,
      session_type: a.session_type,
      rpe: a.rpe as number | null,
    })),
    scores: (scores ?? []).map((s) => ({
      activity_id: s.activity_id as string,
      sport: s.sport,
      sport_index: s.sport_index as number,
      load_score: s.load_score as number,
      created_at: s.created_at as string,
    })),
    personalRecords: (personalRecords ?? []) as PersonalRecord[],
  };

  return (
    <AppShell>
      <AnalyticsClient data={payload} />
    </AppShell>
  );
}
