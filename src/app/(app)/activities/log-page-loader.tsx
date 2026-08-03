import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ActivityForm } from "@/components/activities/activity-form";
import { isPremiumUser } from "@/lib/retention/trial";
import { getWorkoutPlan } from "@/lib/constants/workout-plans";
import {
  createDefaultState,
  nextRowId,
  nextSetId,
} from "@/components/activities/form-state";
import { defaultWeightEntryMode } from "@/lib/scoring/weight-entry";
import {
  recommendNextGymSplit,
  GYM_RECOMMENDATION_CONFIG,
  type LoggedGymSet,
} from "@/lib/scoring/gym-recommendation";
import type { SportType } from "@/types";
import type { WorkoutFormState } from "@/components/activities/form-state";

interface LogPageProps {
  sport: SportType | null;
  zoneMode: "gym" | "cardio";
  enduranceOnly?: boolean;
  searchParams?: Promise<{ plan?: string; template?: string; recommend?: string }>;
}

export async function loadLogPage({
  sport,
  zoneMode,
  enduranceOnly,
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
  let initialRepeatState: WorkoutFormState | undefined;

  if (params.template && zoneMode === "gym") {
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
  } else if (params.recommend && zoneMode === "gym") {
    // recommend=1 → prefill with lib/scoring/gym-recommendation.ts's pick,
    // recomputed here (not passed through the URL) so it's always based on
    // whatever's actually logged at the moment the form opens.
    const lookbackSince = new Date(
      Date.now() - GYM_RECOMMENDATION_CONFIG.LOOKBACK_DAYS * 86400000
    ).toISOString();
    const { data: recentGymActivities } = await supabase
      .from("activities")
      .select("id, started_at")
      .eq("user_id", user.id)
      .eq("sport", "gym")
      .eq("is_draft", false)
      .gte("started_at", lookbackSince);

    const activityDateById = new Map(
      (recentGymActivities ?? []).map((a) => [a.id as string, a.started_at as string])
    );
    const recentActivityIds = [...activityDateById.keys()];

    const { data: recentExercises } =
      recentActivityIds.length > 0
        ? await supabase
            .from("gym_exercises")
            .select("muscle_group, activity_id")
            .in("activity_id", recentActivityIds)
        : { data: [] as { muscle_group: string; activity_id: string }[] };

    const loggedSets: LoggedGymSet[] = (recentExercises ?? [])
      .map((e) => {
        const startedAt = activityDateById.get(e.activity_id as string);
        return startedAt ? { muscleGroup: e.muscle_group as string, startedAt } : null;
      })
      .filter((s): s is LoggedGymSet => s !== null);

    const recommendation = recommendNextGymSplit(loggedSets);

    if (recommendation.recommendedGroups.length > 0) {
      const base = createDefaultState("gym", profile.weight_kg);
      initialRepeatState = {
        ...base,
        title: "Recommended session",
        exercises: recommendation.recommendedGroups.flatMap((group) =>
          group.exerciseNames.map((name) => ({
            id: nextRowId(),
            name,
            muscleGroup: group.muscleGroup,
            weightEntryMode: defaultWeightEntryMode(name),
            sets: Array.from({ length: 3 }, () => ({
              id: nextSetId(),
              weight: "",
              reps: "8",
              rpe: "",
              repsInReserve: "",
            })),
            notes: "",
          }))
        ),
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
      successRedirect={zoneMode === "gym" ? "/gym" : "/cardio"}
      profileGender={profile.gender}
      profileExperience={profile.experience}
    />
  );
}
