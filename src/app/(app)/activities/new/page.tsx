import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ActivityForm } from "@/components/activities/activity-form";
import { SPORTS } from "@/lib/constants/sports";
import { hasPaidAccess } from "@/lib/retention/trial";
import { resolveScoringSex } from "@/lib/scoring/adapters";
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
    /*
      gender and scoring_basis are what resolveScoringSex needs, and experience
      is what the recommendation uses. Without them this page passed
      profileScoringSex={undefined}, and gym-form's scoreSet bails on a null
      sex — so every set in the Lab showed "—" no matter how complete the
      athlete's profile was, and the on-screen hint stayed silent because it
      deliberately does not name sex as a cause. The other two callers of
      ActivityForm already select these.
    */
    .select(
      "onboarding_completed, weight_kg, gender, scoring_basis, experience, subscription_tier, subscription_status"
    )
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

  const premium = hasPaidAccess(profile);

  return (
    <ActivityForm
      profileWeightKg={profile.weight_kg}
      profileScoringSex={resolveScoringSex(profile)}
      profileExperience={profile.experience}
      initialDrafts={initialDrafts}
      isPremium={premium}
      initialSport={parseSportParam(sportParam)}
    />
  );
}
