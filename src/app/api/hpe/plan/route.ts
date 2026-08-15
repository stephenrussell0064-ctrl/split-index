import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generatePlan } from "@/lib/scoring/hpe/engine";
import { loadAthleteProfile } from "@/lib/scoring/hpe/load-profile";
import { diagnose } from "@/lib/scoring/hpe/diagnostics";
import { estimatedMaxHr } from "@/lib/scoring/hpe/intake";

/** The intake spec's documented default, flagged as assumed rather than silently applied. */
const ASSUMED_RESTING_HR = 60;
import { savePlan, supersedePlans } from "@/lib/scoring/hpe/persistence";
import { selectAttempts, racePacing } from "@/lib/scoring/hpe/progression";
import { validateIntake } from "@/lib/scoring/hpe/intake";
import { parseIntakeRow, resolveIntakeInputs } from "@/lib/scoring/hpe/intake-record";
import { loadPrefilledIntake } from "@/lib/scoring/hpe/load-intake";
import { evaluateAccess, type FeatureFlag } from "@/lib/scoring/hpe/rollout";
import { HPE_CONSTANTS_VERSION } from "@/lib/scoring/hpe/constants";

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

  // No logged history no longer refuses. `loadAthleteProfile` returns null
  // when there is nothing to diagnose from; the engine then runs on a
  // tier-0 profile, produces a deliberately conservative plan, and says
  // plainly that it is provisional. See the note on `assessTailoring`.
  const diagnostic = await loadAthleteProfile(supabase, user.id, { priority });

  // ---- WP2: the intake now answers what this route used to assume --------
  const intake = parseIntakeRow(intakeRow as Record<string, unknown> | null);
  const prefilled = await loadPrefilledIntake(supabase, user.id);
  const resolved = resolveIntakeInputs(intake, prefilled);

  // A tier-0 profile when there is no logged history at all. Every derived
  // metric on it is null, which is exactly right: the plan is then built from
  // population defaults and labelled provisional, rather than refused.
  const profile =
    diagnostic?.profile ??
    diagnose([], [], {}, {
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

  const plan = generatePlan({ state, goal, constraints, profile, overrideEventOrder });

  if (!plan.generated) {
    await recordEvent(supabase, user.id, {
      outcome: "safety_blocked",
      // The specific block, not just "blocked" — block rate is only
      // actionable broken down by reason.
      reason_code: safetyReasonCode(plan.safety.blocks),
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
