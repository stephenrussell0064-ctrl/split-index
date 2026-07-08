import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ActivityForm } from "@/components/activities/activity-form";
import { activityToFormState } from "@/lib/activities/db-form";
import { isPremiumUser } from "@/lib/retention/trial";
import type { SportType } from "@/types";
import { SPORTS } from "@/lib/constants/sports";

export default async function EditActivityPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "onboarding_completed, weight_kg, gender, experience, subscription_tier, subscription_status"
    )
    .eq("user_id", user.id)
    .single();

  if (!profile?.onboarding_completed) redirect("/onboarding");

  const { data: activity } = await supabase
    .from("activities")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (!activity) notFound();

  const { data: exercises } = await supabase
    .from("gym_exercises")
    .select("*")
    .eq("activity_id", id)
    .order("order_index");

  const sport = activity.sport as SportType;
  if (!SPORTS.some((s) => s.id === sport)) notFound();

  const initialEditState = activityToFormState(
    activity,
    exercises ?? [],
    profile.weight_kg
  );

  const premium = isPremiumUser(
    profile.subscription_tier,
    profile.subscription_status
  );

  return (
    <ActivityForm
      mode="edit"
      activityId={id}
      initialSport={sport}
      initialEditState={initialEditState}
      editActivityTitle={(activity.title as string) ?? sport}
      profileWeightKg={profile.weight_kg}
      profileGender={profile.gender}
      profileExperience={profile.experience}
      isPremium={premium}
    />
  );
}
