import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ActivityForm } from "@/components/activities/activity-form";
import { hasPaidAccess } from "@/lib/retention/trial";
import { getWorkoutPlan } from "@/lib/constants/workout-plans";
import {
  createDefaultState,
  nextRowId,
  nextSetId,
} from "@/components/activities/form-state";
import { defaultWeightEntryMode } from "@/lib/scoring/weight-entry";
import { resolveScoringSex } from "@/lib/scoring/adapters";
import {
  recommendNextGymSplit,
  GYM_RECOMMENDATION_CONFIG,
  type LoggedGymSet,
} from "@/lib/scoring/gym-recommendation";
import {
  parsePrescribedExercises,
  prescribedSetValues,
  isBodyweightMovement,
} from "@/lib/scoring/hpe/prescribed-sets";
import { KIND_LABEL } from "@/components/hybrid-plan/plan-calendar";
import type { SportType } from "@/types";
import type { ExerciseRowState, WorkoutFormState } from "@/components/activities/form-state";

type LogSearchParams = {
  plan?: string;
  template?: string;
  recommend?: string;
  /** An `hpe_sessions` id: open the form filled from that prescription (logging-effort plan, phase 2). */
  hpeSession?: string;
};

interface LogPageProps {
  sport: SportType | null;
  zoneMode: "gym" | "cardio";
  enduranceOnly?: boolean;
  searchParams?: Promise<LogSearchParams>;
}

/**
 * The gym form's exercise rows for a strength prescription, every set filled
 * in with what the plan wrote and marked as such.
 *
 * Load is blank — not 0 — where the line gave no kilogram figure, so the
 * athlete types it; reps are filled from the band's midpoint. A set carries
 * `prescribed` so that at submit the server learns how many were logged
 * untouched (see prescribedSetsSummary), and so the row can show which values
 * came from the plan rather than the athlete.
 */
export function prescribedExerciseRows(prescriptionText: string): ExerciseRowState[] {
  return parsePrescribedExercises(prescriptionText).map((ex) => {
    const values = prescribedSetValues(ex);
    const weight = values.weightKg != null ? String(values.weightKg) : "";
    const reps = values.reps != null ? String(values.reps) : "";
    const durationSeconds = values.holdSeconds != null ? String(values.holdSeconds) : "";
    return {
      id: nextRowId(),
      name: ex.name,
      muscleGroup: ex.muscleGroup,
      weightEntryMode: isBodyweightMovement(ex.name) ? "added" : defaultWeightEntryMode(ex.name),
      attachment: null,
      sets: Array.from({ length: ex.sets }, () => ({
        id: nextSetId(),
        weight,
        reps,
        rpe: "",
        repsInReserve: "",
        durationSeconds,
        distanceMeters: "",
        prescribed: { weight, reps, durationSeconds, source: "plan" as const },
      })),
      notes: "",
    };
  });
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

  // Profile, search params and drafts together: the drafts need only the user
  // id, so there is no reason for them to wait behind the profile. The
  // template/plan/recommend branches below still run after, because they
  // genuinely depend on the params and the profile's bodyweight.
  const [{ data: profile }, params, { data: drafts }] = await Promise.all([
    supabase
      .from("profiles")
      .select(
        "onboarding_completed, weight_kg, gender, scoring_basis, experience, subscription_tier, subscription_status"
      )
      .eq("user_id", user.id)
      .single(),
    searchParams ? searchParams : Promise.resolve({} as LogSearchParams),
    // `updated_at` so the client can tell a server draft from a newer local
    // mirror — see draft-mirror.ts. Without it every stale server row would
    // win over work this device typed offline.
    supabase.from("workout_drafts").select("sport, form_data, updated_at").eq("user_id", user.id),
  ]);

  if (!profile?.onboarding_completed) redirect("/onboarding");
  let initialRepeatState: WorkoutFormState | undefined;

  if (params.hpeSession && zoneMode === "gym") {
    /*
      hpeSession=<id> → the form, filled from a Hybrid Plan prescription.

      Ownership is checked through hpe_plans.user_id, exactly as the feedback
      route does: a session id on its own proves nothing, and opening a form
      from someone else's plan would leak their prescription. A session that
      is not the athlete's, or not a lift, falls through to a blank form.
    */
    const { data: hpeSession } = await supabase
      .from("hpe_sessions")
      .select("id, kind, label, domain, prescription, hpe_plans!inner(user_id)")
      .eq("id", params.hpeSession)
      .maybeSingle();
    const owner = (hpeSession as { hpe_plans?: { user_id?: string } } | null)?.hpe_plans?.user_id;
    if (hpeSession && owner === user.id && hpeSession.domain === "strength") {
      const rows = prescribedExerciseRows(hpeSession.prescription as string);
      if (rows.length > 0) {
        const base = createDefaultState("gym", profile.weight_kg);
        initialRepeatState = {
          ...base,
          title:
            (hpeSession.label as string | null) ??
            KIND_LABEL[hpeSession.kind as string] ??
            (hpeSession.kind as string),
          exercises: rows,
          hpeSessionId: hpeSession.id as string,
        };
      }
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
          attachment: null,
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
      /*
        The recommendation names exercises, not loads. The athlete's own last
        logged set of each is the nearest thing to a prescription there is,
        and it was already one tap away in the form ("Last time: 100kg × 8");
        filling it in up front, marked as history, makes the usual case — the
        same load as last time — cost nothing to confirm. Same 28-day window
        the recommendation itself reads, so it cannot propose a load from a
        block the athlete has moved on from.
      */
      const recommendedNames = recommendation.recommendedGroups.flatMap((g) => g.exerciseNames);
      const { data: lastSets } =
        recentActivityIds.length > 0
          ? await supabase
              .from("gym_exercises")
              .select("exercise_name, weight_kg, reps, activity_id")
              .in("activity_id", recentActivityIds)
              .in("exercise_name", recommendedNames)
          : { data: [] as { exercise_name: string; weight_kg: number; reps: number; activity_id: string }[] };
      const latestByName = new Map<string, { weight: string; reps: string; startedAt: string }>();
      for (const row of lastSets ?? []) {
        const startedAt = activityDateById.get(row.activity_id as string) ?? "";
        const prior = latestByName.get(row.exercise_name as string);
        if (prior && prior.startedAt >= startedAt) continue;
        const weight = typeof row.weight_kg === "number" && row.weight_kg > 0 ? String(row.weight_kg) : "";
        const reps = typeof row.reps === "number" && row.reps > 0 ? String(row.reps) : "";
        if (!weight && !reps) continue;
        latestByName.set(row.exercise_name as string, { weight, reps, startedAt });
      }

      const base = createDefaultState("gym", profile.weight_kg);
      initialRepeatState = {
        ...base,
        title: "Recommended session",
        exercises: recommendation.recommendedGroups.flatMap((group) =>
          group.exerciseNames.map((name) => {
            const last = latestByName.get(name);
            const weight = last?.weight ?? "";
            const reps = last?.reps || "8";
            return {
              id: nextRowId(),
              name,
              muscleGroup: group.muscleGroup,
              weightEntryMode: defaultWeightEntryMode(name),
              attachment: null,
              sets: Array.from({ length: 3 }, () => ({
                id: nextSetId(),
                weight,
                reps,
                rpe: "",
                repsInReserve: "",
                ...(last ? { prescribed: { weight, reps, source: "history" as const } } : {}),
              })),
              notes: "",
            };
          })
        ),
      };
    }
  }

  const initialDrafts = Object.fromEntries(
    (drafts ?? []).map((d) => [d.sport as SportType, d.form_data])
  );
  const draftUpdatedAt = Object.fromEntries(
    (drafts ?? []).map((d) => [d.sport as SportType, d.updated_at as string | null])
  );

  const premium = hasPaidAccess(profile);

  return (
    <ActivityForm
      profileWeightKg={profile.weight_kg}
      initialDrafts={initialDrafts}
      draftUpdatedAt={draftUpdatedAt}
      isPremium={premium}
      initialSport={sport}
      initialRepeatState={initialRepeatState}
      zoneMode={zoneMode}
      enduranceOnly={enduranceOnly}
      successRedirect={zoneMode === "gym" ? "/gym" : "/cardio"}
      profileScoringSex={resolveScoringSex(profile)}
      profileExperience={profile.experience}
    />
  );
}
