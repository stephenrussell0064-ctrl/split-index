import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/layout/app-shell";
import { ActivityForm } from "@/components/activities/activity-form";
import { activityToFormState } from "@/lib/activities/db-form";
import { isPremiumUser } from "@/lib/retention/trial";
import type { SportType } from "@/types";
import type { WorkoutFormState } from "@/components/activities/form-state";

interface LogPageProps {
  sport: SportType | null;
  zoneMode: "gym" | "cardio";
  enduranceOnly?: boolean;
  showFileImport?: boolean;
  searchParams?: Promise<{ repeat?: string }>;
}

export async function loadLogPage({
  sport,
  zoneMode,
  enduranceOnly,
  showFileImport,
  searchParams,
}: LogPageProps) {
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

  const params = searchParams ? await searchParams : {};
  const repeatSport = sport ?? (zoneMode === "gym" ? "gym" : "running");
  let initialRepeatState: WorkoutFormState | undefined;

  if (params.repeat === "1" && repeatSport) {
    const { data: lastActivity } = await supabase
      .from("activities")
      .select("*")
      .eq("user_id", user.id)
      .eq("sport", repeatSport)
      .eq("is_draft", false)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastActivity) {
      let exercises: Parameters<typeof activityToFormState>[1] = [];
      if (repeatSport === "gym") {
        const { data: exRows } = await supabase
          .from("gym_exercises")
          .select("*")
          .eq("activity_id", lastActivity.id)
          .order("order_index");
        exercises = exRows ?? [];
      }
      initialRepeatState = activityToFormState(
        lastActivity,
        exercises,
        profile.weight_kg
      );
    }
  }

  const { data: drafts } = await supabase
    .from("workout_drafts")
    .select("sport, form_data")
    .eq("user_id", user.id);

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
        initialSport={sport}
        initialRepeatState={initialRepeatState}
        zoneMode={zoneMode}
        enduranceOnly={enduranceOnly}
        showFileImport={showFileImport}
        successRedirect={zoneMode === "gym" ? "/gym" : "/cardio"}
        profileGender={profile.gender}
        profileExperience={profile.experience}
      />
    </AppShell>
  );
}
