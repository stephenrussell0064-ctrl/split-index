import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ActivityForm } from "@/components/activities/activity-form";
import { activityToFormState } from "@/lib/activities/db-form";
import { isPremiumUser } from "@/lib/retention/trial";
import { getWorkoutPlan } from "@/lib/constants/workout-plans";
import {
  createDefaultState,
  nextRowId,
  nextSetId,
} from "@/components/activities/form-state";
import { defaultWeightEntryMode } from "@/lib/scoring/weight-entry";
import type { SportType } from "@/types";
import type { WorkoutFormState } from "@/components/activities/form-state";

interface LogPageProps {
  sport: SportType | null;
  zoneMode: "gym" | "cardio";
  enduranceOnly?: boolean;
  showFileImport?: boolean;
  searchParams?: Promise<{ repeat?: string; plan?: string; template?: string }>;
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

  if (params.repeat && repeatSport) {
    // repeat=1 → most recent session; repeat=<uuid> → that specific session
    let query = supabase
      .from("activities")
      .select("*")
      .eq("user_id", user.id)
      .eq("is_draft", false);

    if (params.repeat === "1") {
      query = query.eq("sport", repeatSport).order("started_at", { ascending: false });
    } else {
      query = query.eq("id", params.repeat);
    }

    const { data: lastActivity } = await query.limit(1).maybeSingle();

    if (lastActivity) {
      let exercises: Parameters<typeof activityToFormState>[1] = [];
      if (lastActivity.sport === "gym") {
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
  } else if (params.template && zoneMode === "gym") {
    const { data: template } = await supabase
      .from("session_templates")
      .select("name, template_data")
      .eq("id", params.template)
      .eq("user_id", user.id)
      .single();

    if (template?.template_data) {
      initialRepeatState = template.template_data as WorkoutFormState;
      if (template.name && !initialRepeatState.title) {
        initialRepeatState = { ...initialRepeatState, title: template.name as string };
      }
    }
  } else if (params.plan && zoneMode === "gym") {
    // plan=<id> → prefill the log form with a preset workout plan
    const plan = getWorkoutPlan(params.plan);
    if (plan) {
      const base = createDefaultState("gym", profile.weight_kg);
      initialRepeatState = {
        ...base,
        title: plan.name,
        exercises: plan.exercises.map((ex) => ({
          id: nextRowId(),
          name: ex.name,
          muscleGroup: ex.muscle,
          weightEntryMode: defaultWeightEntryMode(ex.name),
          sets: Array.from({ length: ex.sets }, () => ({
            id: nextSetId(),
            weight: "",
            reps: String(ex.reps),
            rpe: "",
            repsInReserve: "",
          })),
          notes: "",
        })),
      };
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
  );
}
