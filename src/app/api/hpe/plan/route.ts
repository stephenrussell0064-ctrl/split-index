import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generatePlan } from "@/lib/scoring/hpe/engine";
import { loadAthleteProfile } from "@/lib/scoring/hpe/load-profile";
import { diagnose } from "@/lib/scoring/hpe/diagnostics";
import { estimatedMaxHr } from "@/lib/scoring/hpe/intake";

/** The intake spec's documented default, flagged as assumed rather than silently applied. */
const ASSUMED_RESTING_HR = 60;
import { loadLatestStoredPlan, savePlan, supersedePlans } from "@/lib/scoring/hpe/persistence";
import { selectAttempts, racePacing } from "@/lib/scoring/hpe/progression";
import { validateIntake } from "@/lib/scoring/hpe/intake";
import { parseIntakeRow, resolveIntakeInputs } from "@/lib/scoring/hpe/intake-record";
import { loadPrefilledIntake } from "@/lib/scoring/hpe/load-intake";
import { evaluateAccess, type FeatureFlag } from "@/lib/scoring/hpe/rollout";
import { HPE_CONSTANTS_VERSION } from "@/lib/scoring/hpe/constants";
import { ingestModalityFitness } from "@/lib/scoring/hpe/modality";
import type { ActivityRow } from "@/lib/scoring/hpe/ingest";

/** Window the per-modality benchmark is projected from. Matches the diagnostic's own history window. */
const MODALITY_HISTORY_WEEKS = 12;

/**
 * Hybrid Plan Engine — plan generation endpoint (WP9's data source).
 *
 * The health screen runs inside `generatePlan` and cannot be reached around.
 * It no longer refuses anyone — it sets the intensity ceiling and the ramp,
 * and produces the referrals. That ordering is enforced by the engine, not by
 * this route.
 *
 * The intake flow proper (WP2) is not yet a UI. Until it is, the fields it
 * would collect are derived from what Split Index already holds and every
 * derived value is reported in `assumptions` — the intake spec's rule is that
 * the engine never silently guesses, and reporting the guess is what keeps
 * that true while the flow is being built.
 */


/**
 * WP10 telemetry. Every generation attempt is recorded, including the ones the
 * health screen constrained and the ones the kill switch paused — a capped
 * plan, a paused rollout and a tier gate all look alike in a naive metric and
 * need completely different responses. Never allowed to fail the request.
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

/**
 * Which answer caused the health screen to constrain this plan.
 *
 * Formerly read the refusal text. The screen no longer refuses, so this reads
 * the advisories instead and the fleet view measures how often the engine
 * holds someone back rather than how often it turned them away.
 */
function safetyReasonCode(advisories: string[]): string {
  const first = (advisories[0] ?? "").toLowerCase();
  if (first.includes("under 18")) return "under_18";
  if (first.includes("par-q") || first.includes("chest pain")) return "parq_positive";
  if (first.includes("postpartum")) return "pregnant_or_postpartum";
  if (first.includes("injury")) return "current_injury";
  if (first.includes("low-energy-availability")) return "lea_screen";
  if (first.includes("general preparation")) return "training_age";
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
    // Load the stored plan. "Your existing plan is still available and
    // unchanged" was being asserted next to a screen that showed no plan —
    // the kill switch's defining promise, half-implemented. Reading the
    // persisted rows rather than regenerating is the point: generation is
    // what is paused, and a plan that had to be regenerated to be read would
    // not have survived the pause.
    const stored = await loadLatestStoredPlan(supabase, user.id).catch(() => null);
    return NextResponse.json({
      generated: false,
      featureDisabled: true,
      paused: true,
      storedPlan: stored,
      weeks: stored?.weeks ?? [],
      // The paused view needs a profile to resolve each session's finding, and
      // sending the weeks without one left the branch unreachable — the screen
      // fell through to the refusal path and said "Not yet" over a plan that
      // was sitting right there in the database.
      profile: stored?.profile ?? null,
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

  // Profile fields are read by loadPrefilledIntake rather than here — one
  // reader, so the numbers confirmed on the intake form are exactly the ones
  // the plan is built from.
  const [{ data: goalRows }, { data: intakeRow }] = await Promise.all([
    supabase
      .from("training_goals")
      .select("goal_type, target_key, target_value, target_date")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true }),
    supabase.from("hpe_intake").select("*").eq("user_id", user.id).maybeSingle(),
  ]);

  const goals = goalRows ?? [];
  const gymGoals = goals.filter((g) => g.goal_type === "gym");
  // Priority pre-set from the goal mix, per the intake spec's open decision
  // D2: "a slider that is pre-set from the goal gap and can be moved — it
  // anchors the athlete on the honest answer while leaving them agency."
  const priority = goals.length > 0 ? gymGoals.length / goals.length : 0.5;

  // ---- WP2: the intake now answers what this route used to assume --------
  // Parsed BEFORE the diagnostic, because the diagnostic needs the athlete's
  // typed 1RMs. `state.oneRms` (what the plan is promised against) applied them
  // and `profile.oneRms` (what the plan is programmed from) did not, so an
  // athlete who corrected their squat to a tested 180 was told the meet total
  // was reachable from 180 and then given every session at percentages of the
  // 160 their logs showed — and meet attempts picked off 160 as well. One
  // number now, floored the same way in both places.
  const intake = parseIntakeRow(intakeRow as Record<string, unknown> | null);

  // No logged history no longer refuses. `loadAthleteProfile` returns null
  // when there is nothing to diagnose from; the engine then runs on a
  // tier-0 profile, produces a deliberately conservative plan, and says
  // plainly that it is provisional. See the note on `assessTailoring`.
  const diagnostic = await loadAthleteProfile(supabase, user.id, {
    priority,
    oneRmOverrides: {
      squat: intake.squat1rmOverride,
      bench: intake.bench1rmOverride,
      deadlift: intake.deadlift1rmOverride,
    },
  });

  const prefilled = await loadPrefilledIntake(supabase, user.id);
  const resolved = resolveIntakeInputs(intake, prefilled);

  // A tier-0 profile when there is no logged history at all. Every derived
  // metric on it is null, which is exactly right: the plan is then built from
  // population defaults and labelled provisional, rather than refused.
  const profile =
    diagnostic?.profile ??
    // The typed 1RMs go in here too. This is the branch for an athlete with NO
    // logged history, which is precisely when their typed numbers are the only
    // strength evidence that exists — dropping them here would leave the plan
    // promised against three lifts it then programmed as if it had never heard
    // of them.
    diagnose([], [], resolved.state.oneRms, {
      hrMax: prefilled.maxHr ?? estimatedMaxHr(prefilled.age),
      hrRest: prefilled.restingHr ?? ASSUMED_RESTING_HR,
      hrMaxSource: prefilled.maxHr != null ? "measured" : "estimated",
      priority,
    });

  const assumptions = [...(diagnostic?.assumptions ?? []), ...resolved.assumed];

  // Every issue is now an assumption rather than a block. The intake makes the
  // plan better; it is not a gate in front of it — see the note on
  // `assessTailoring`. The safety screen still blocks, inside generatePlan.
  const validation = validateIntake(resolved.state, resolved.goal, resolved.constraints);
  assumptions.push(...validation.issues.map((i) => i.message));

  const { state, goal, constraints } = resolved;
  const eventDate = intake.eventDate;

  // Per-modality fitness for whichever cardio the athlete chose. Read here
  // rather than inside the engine for the same reason the diagnostic is: there
  // is one reader of the activity table, and the engine is not it.
  //
  // Running is deliberately included when they chose it — `ingestModality` is
  // a PARALLEL model that never feeds the running pace pool, so this cannot
  // disturb `predicted5kS` or anything fitted on it.
  const modalityFitness = await (async () => {
    const chosen = constraints.cardioModalities ?? [];
    if (chosen.length === 0) return {};
    const since = new Date(Date.now() - MODALITY_HISTORY_WEEKS * 7 * 86_400_000).toISOString();
    const { data: rows } = await supabase
      .from("activities")
      .select("started_at, sport, duration_seconds, distance_meters, session_type, is_partial_track")
      .eq("user_id", user.id)
      .eq("is_draft", false)
      .gte("started_at", since);
    return ingestModalityFitness((rows ?? []) as unknown as ActivityRow[], chosen, MODALITY_HISTORY_WEEKS);
  })();

  const plan = generatePlan({ state, goal, constraints, profile, overrideEventOrder, modalityFitness });

  // The screen no longer refuses, so there is no un-generated plan to record.
  // What is worth recording is that it CONSTRAINED one — the fleet view reads
  // this rate by reason, and losing the signal entirely would leave the
  // rollout decision blind to the screen.
  if (plan.safety.intensityCeiling < 1 || plan.safety.advisories.length > 0) {
    await recordEvent(supabase, user.id, {
      outcome: "safety_capped",
      // The specific cause, not just "capped" — the rate is only actionable
      // broken down by reason.
      reason_code: safetyReasonCode(plan.safety.advisories),
      tier: profile.tier,
      profile_id: diagnostic?.profileId ?? null,
    });
  }

  // Persist when the plan is real and the diagnostic behind it was stored.
  let persisted: { planId: string; storedSessions: number; droppedSessions: number } | null = null;
  if (plan.generated && diagnostic?.profileId) {
    if (diagnostic?.rerun?.shouldRegenerate) {
      await supersedePlans(supabase, user.id, diagnostic.rerun!.explanations.join(" ")).catch(() => {});
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
      tier: profile.tier,
      profile_id: diagnostic?.profileId ?? null,
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
    rerun: diagnostic?.rerun ?? null,
    // F18 — attempt selection and race pacing, the two core coach
    // deliverables the assurance review flagged as absent.
    attempts: Object.keys(profile.oneRms).length > 0 ? selectAttempts(profile.oneRms, goal.sameDay) : [],
    pacing: goal.target5kS != null ? racePacing(goal.target5kS, goal.sameDay) : null,
  });
}
