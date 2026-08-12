import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generatePlan } from "@/lib/scoring/hpe/engine";
import { loadAthleteProfile } from "@/lib/scoring/hpe/load-profile";
import { savePlan, supersedePlans } from "@/lib/scoring/hpe/persistence";
import { selectAttempts, racePacing } from "@/lib/scoring/hpe/progression";
import { reconcileCurrentVolume, DEFAULT_SAFETY_FLAGS, type AthleteState, type Constraints, type Goal } from "@/lib/scoring/hpe/intake";
import { ageFromDateOfBirth } from "@/lib/utils/age";
import { daysUntilDate } from "@/lib/utils/date";
import { evaluateAccess, type FeatureFlag } from "@/lib/scoring/hpe/rollout";
import { HPE_CONSTANTS_VERSION, type TrainingAge } from "@/lib/scoring/hpe/constants";

/**
 * Hybrid Plan Engine — plan generation endpoint (WP9's data source).
 *
 * The safety screen runs inside `generatePlan` and cannot be reached around,
 * so a blocked athlete gets `generated: false` and a refusal with next steps
 * rather than a plan. That ordering is non-negotiable #3 and it is enforced
 * by the engine, not by this route.
 *
 * The intake flow proper (WP2) is not yet a UI. Until it is, the fields it
 * would collect are derived from what Split Index already holds and every
 * derived value is reported in `assumptions` — the intake spec's rule is that
 * the engine never silently guesses, and reporting the guess is what keeps
 * that true while the flow is being built.
 */

/** Maps Split Index's experience tiers onto the engine's gain-rate training ages. */
const TRAINING_AGE_BY_EXPERIENCE: Record<string, TrainingAge> = {
  beginner: "novice",
  novice: "novice",
  intermediate: "intermediate",
  advanced: "advanced",
  elite: "elite",
};


/**
 * WP10 telemetry. Every generation attempt is recorded, including the
 * refusals — a safety screen nobody can get past and a tier gate nobody can
 * clear both look like "no plans generated" in a naive metric and need
 * completely different responses. Never allowed to fail the request.
 */
async function recordEvent(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  fields: Record<string, unknown>
): Promise<void> {
  try {
    await supabase.from("hpe_generation_events").insert({
      user_id: userId,
      constants_version: HPE_CONSTANTS_VERSION,
      ...fields,
    });
  } catch {
    // Telemetry must never take down the thing it is measuring.
  }
}

/** Maps the first block message onto a stable slug so block rate can be grouped. */
function safetyReasonCode(blocks: string[]): string {
  const first = (blocks[0] ?? "").toLowerCase();
  if (first.includes("under 18")) return "under_18";
  if (first.includes("par-q")) return "parq_positive";
  if (first.includes("postpartum")) return "pregnant_or_postpartum";
  if (first.includes("injury")) return "current_injury";
  if (first.includes("low-energy-availability")) return "lea_screen";
  if (first.includes("peaking block")) return "training_age";
  if (first.includes("weight cut")) return "weight_cut";
  return "other";
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const overrideEventOrder = searchParams.get("overrideEventOrder") === "true";

  // WP10 — the kill switch and the rollout dial, checked before any work is
  // done. Generation stops; reading an existing plan does not, which is the
  // asymmetry that makes pausing safe to do. A missing flag row is treated as
  // OFF: a feature that switches itself on when its config cannot be read has
  // no kill switch at all.
  const { data: flagRow } = await supabase
    .from("hpe_feature_flags")
    .select("key, enabled, rollout_percentage, note, updated_at")
    .eq("key", "hpe_generation")
    .maybeSingle();

  const flag: FeatureFlag | null = flagRow
    ? {
        key: flagRow.key as string,
        enabled: flagRow.enabled as boolean,
        rolloutPercentage: Number(flagRow.rollout_percentage),
        note: (flagRow.note as string | null) ?? null,
        updatedAt: (flagRow.updated_at as string | null) ?? null,
      }
    : null;

  const access = evaluateAccess(flag, user.id);
  if (!access.canGenerate) {
    await recordEvent(supabase, user.id, {
      outcome: "feature_disabled",
      reason_code: access.reason,
    });
    return NextResponse.json({
      generated: false,
      featureDisabled: true,
      refusal: {
        reason: access.message,
        nextSteps:
          access.reason === "not_in_rollout"
            ? ["Nothing to do — you will be let in automatically as the rollout widens."]
            : ["Your existing plan is still available and unchanged."],
      },
      diagnostic: null,
    });
  }

  const [{ data: profileRow }, { data: goalRows }, { data: raceRows }] = await Promise.all([
    supabase
      .from("profiles")
      .select("age, date_of_birth, height_cm, weight_kg, max_hr, resting_hr, gender, experience, training_history_years")
      .eq("user_id", user.id)
      .single(),
    supabase
      .from("training_goals")
      .select("goal_type, target_key, target_value, target_date")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true }),
    supabase
      .from("planned_races")
      .select("race_date, distance_meters")
      .eq("user_id", user.id)
      .order("race_date", { ascending: true })
      .limit(1),
  ]);

  const goals = goalRows ?? [];
  const gymGoals = goals.filter((g) => g.goal_type === "gym");
  const cardioGoals = goals.filter((g) => g.goal_type === "cardio");
  // Priority pre-set from the goal mix, per the intake spec's open decision
  // D2: "a slider that is pre-set from the goal gap and can be moved — it
  // anchors the athlete on the honest answer while leaving them agency."
  const priority = goals.length > 0 ? gymGoals.length / goals.length : 0.5;

  const diagnostic = await loadAthleteProfile(supabase, user.id, { priority });
  if (!diagnostic) {
    await recordEvent(supabase, user.id, { outcome: "insufficient_data", reason_code: "no_logged_history" });
    return NextResponse.json({
      generated: false,
      refusal: {
        reason:
          "There is no logged history to diagnose from yet, and a plan built on none would be a template with " +
          "your name on it.",
        nextSteps: [
          "Log two weeks of running with heart rate.",
          "Run one time trial — a 5k or 10k as a genuine maximal effort — and tag it as a race.",
          "Log a 3-5RM test on squat, bench and deadlift.",
        ],
      },
      diagnostic: null,
    });
  }

  const assumptions = [...diagnostic.assumptions];
  const age =
    ageFromDateOfBirth((profileRow?.date_of_birth as string | null) ?? null) ?? (profileRow?.age as number | null) ?? 30;

  // The on-ramp anchor. There is no stated figure to reconcile against yet
  // (that is a WP2 intake field), so the logs govern outright — which is the
  // conservative direction the cross-check rule asks for anyway.
  const volume = reconcileCurrentVolume(null, diagnostic.loggedWeeklyRunMinutes);
  if (volume.issue) assumptions.push(volume.issue.message);
  if (volume.value == null) {
    await recordEvent(supabase, user.id, { outcome: "missing_intake", reason_code: "no_onramp_anchor", tier: diagnostic.profile.tier });
    return NextResponse.json({
      generated: false,
      refusal: {
        reason:
          "Your current weekly running volume could not be derived from your logs. This is the number week 1 is " +
          "built on, and assuming it is the single most common way generated plans cause injury.",
        nextSteps: ["Log two weeks of normal running, then come back — the plan will start exactly where you are."],
      },
      diagnostic: diagnostic.profile,
    });
  }

  const experience = (profileRow?.experience as string | null) ?? "intermediate";
  const trainingAge = TRAINING_AGE_BY_EXPERIENCE[experience] ?? "intermediate";
  const trainingYears = Number(profileRow?.training_history_years ?? 0) || 2;

  const heightCm = Number(profileRow?.height_cm ?? 0);
  const bodyweightKg = Number(profileRow?.weight_kg ?? 0);
  if (!heightCm || !bodyweightKg) {
    await recordEvent(supabase, user.id, { outcome: "missing_intake", reason_code: "no_height_or_bodyweight", tier: diagnostic.profile.tier });
    return NextResponse.json({
      generated: false,
      refusal: {
        reason: "Height and bodyweight are required — they set the BMI floor for the energy-availability safeguard.",
        nextSteps: ["Add your height and current bodyweight in Profile, then generate the plan."],
      },
      diagnostic: diagnostic.profile,
    });
  }

  const nextRace = raceRows?.[0] ?? null;
  const eventDate = (nextRace?.race_date as string | null) ?? cardioGoals[0]?.target_date ?? gymGoals[0]?.target_date ?? null;
  const daysOut = daysUntilDate(eventDate);
  const weeksOut = daysOut != null ? Math.round(daysOut / 7) : 16;
  if (weeksOut < 4 || weeksOut > 52) {
    await recordEvent(supabase, user.id, { outcome: "missing_intake", reason_code: daysOut == null ? "no_event_date" : "event_out_of_range", tier: diagnostic.profile.tier });
    return NextResponse.json({
      generated: false,
      refusal: {
        reason:
          daysOut == null
            ? "No event date is set. The macrocycle length, the taper and the peak are all measured back from it."
            : `Your event is ${weeksOut} weeks out. This engine builds blocks between 4 and 52 weeks.`,
        nextSteps: ["Set a target date on a goal, or add a planned race, between 4 and 52 weeks away."],
      },
      diagnostic: diagnostic.profile,
    });
  }

  // The safety flags are WP2 intake fields with no UI yet. They default
  // CONSERVATIVELY per the intake spec's Missing column — which means a
  // recent injury and recent surgery are assumed until answered, and both
  // halve the ramp rather than being waved through.
  const state: AthleteState = {
    bodyweightKg,
    heightCm,
    age,
    sex: ((profileRow?.gender as string | null) === "female" ? "female" : (profileRow?.gender as string | null) === "male" ? "male" : "other"),
    oneRms: diagnostic.profile.oneRms,
    predicted5kS: diagnostic.profile.predicted5kS,
    strengthTrainingAge: trainingAge,
    enduranceTrainingAge: trainingAge,
    strengthTrainingYears: trainingYears,
    enduranceTrainingYears: trainingYears,
    currentRunMinPerWeek: volume.value,
    currentStrengthSessionsPerWeek: 3,
    chronicLoad: Math.max(1, diagnostic.profile.weeklyVolumeMin * 4),
    restingHr: diagnostic.profile.hrRest,
    maxHr: diagnostic.profile.hrMax,
    safety: { ...DEFAULT_SAFETY_FLAGS },
    assumed: assumptions,
  };
  assumptions.push(
    "The safety questionnaire has not been completed, so recent injury and recent surgery are assumed present " +
      "and the volume ramp is halved. Completing it will unlock the full ramp if neither applies to you."
  );

  const goal: Goal = {
    weeksOut,
    target5kS: cardioGoals[0]?.target_value != null ? Number(cardioGoals[0].target_value) : null,
    targetTotalKg: gymGoals.length >= 3 ? gymGoals.reduce((s, g) => s + Number(g.target_value ?? 0), 0) : null,
    priority,
    sameDay: false,
    interEventGapH: 4,
    weightClassKg: null,
    eventOrderKnown: false,
  };

  const constraints: Constraints = {
    daysAvailable: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    twoADaysPossible: false,
    amHour: 7,
    pmHour: 18,
    maxSessionsPerWeek: 6,
    maxHoursPerWeek: 8,
    maxSessionMin: 90,
    minRestDays: 1,
    gymAccessDays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    equipment: ["barbell"],
  };
  assumptions.push(
    "Availability is assumed to be seven days with up to six sessions a week and no double days. The schedule is " +
      "built around that until you set your real days and times."
  );

  const plan = generatePlan({ state, goal, constraints, profile: diagnostic.profile, overrideEventOrder });

  if (!plan.generated) {
    await recordEvent(supabase, user.id, {
      outcome: plan.safety.blocked ? "safety_blocked" : "insufficient_data",
      // The specific block, not just "blocked" — block rate is only
      // actionable broken down by reason.
      reason_code: plan.safety.blocked ? safetyReasonCode(plan.safety.blocks) : "tier_zero",
      tier: diagnostic.profile.tier,
      profile_id: diagnostic.profileId,
    });
  }

  // Persist when the plan is real and the diagnostic behind it was stored.
  let persisted: { planId: string; storedSessions: number; droppedSessions: number } | null = null;
  if (plan.generated && diagnostic.profileId) {
    if (diagnostic.rerun?.shouldRegenerate) {
      await supersedePlans(supabase, user.id, diagnostic.rerun.explanations.join(" ")).catch(() => {});
    }
    persisted = await savePlan(supabase, user.id, {
      profileId: diagnostic.profileId,
      findingIds: diagnostic.findingIds,
      constantsVersion: plan.constantsVersion,
      goal,
      constraints,
      weeks: plan.weeks,
      eventDate,
    }).catch(() => null);
  }

  if (plan.generated) {
    await recordEvent(supabase, user.id, {
      outcome: "generated",
      tier: diagnostic.profile.tier,
      profile_id: diagnostic.profileId,
      plan_id: persisted?.planId ?? null,
      peak_acwr: plan.acwr?.peakAcwr ?? null,
      weeks_out: goal.weeksOut,
      session_count: plan.weeks.reduce((s, w) => s + w.placements.length, 0),
      hard_violations: plan.weeks.reduce((s, w) => s + w.hardPenalty, 0),
    });
  }

  return NextResponse.json({
    ...plan,
    assumptions,
    eventDate,
    persisted,
    rerun: diagnostic.rerun,
    // F18 — attempt selection and race pacing, the two core coach
    // deliverables the assurance review flagged as absent.
    attempts: Object.keys(diagnostic.profile.oneRms).length > 0
      ? selectAttempts(diagnostic.profile.oneRms, goal.sameDay)
      : [],
    pacing: goal.target5kS != null ? racePacing(goal.target5kS, goal.sameDay) : null,
  });
}
