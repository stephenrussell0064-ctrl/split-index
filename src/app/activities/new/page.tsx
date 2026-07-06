import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/layout/app-shell";
import { ActivityForm } from "@/components/activities/activity-form";
import { SPORTS } from "@/lib/constants/sports";
import { isPremiumUser } from "@/lib/retention/trial";
import type { SportType } from "@/types";

function parseSportParam(value: string | undefined): SportType | null {
  if (!value) return null;
  return SPORTS.some((s) => s.id === value) ? (value as SportType) : null;
}

export default async function NewActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ sport?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("onboarding_completed, weight_kg, subscription_tier, subscription_status")
    .eq("user_id", user.id)
    .single();

  if (!profile?.onboarding_completed) redirect("/onboarding");

  const [{ sport: sportParam }, { data: drafts }] = await Promise.all([
    searchParams,
    supabase.from("workout_drafts").select("sport, form_data").eq("user_id", user.id),
  ]);

  const initialDrafts = Object.fromEntries(
    (drafts ?? []).map((d) => [d.sport as SportType, d.form_data])
  );

  const premium = isPremiumUser(
    profile.subscription_tier,
    profile.subscription_status
  );

  return (
    <AppShell>
      <ActivityForm
        profileWeightKg={profile.weight_kg}
        initialDrafts={initialDrafts}
        isPremium={premium}
        initialSport={parseSportParam(sportParam)}
      />
    </AppShell>
  );
}
