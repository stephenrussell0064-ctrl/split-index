import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generatePlan } from "@/lib/scoring/hpe/engine";
import { loadAthleteProfile } from "@/lib/scoring/hpe/load-profile";
import { diagnose } from "@/lib/scoring/hpe/diagnostics";
import { estimatedMaxHr } from "@/lib/scoring/hpe/intake";

/** The intake spec's documented default, flagged as assumed rather than silently applied. */
const ASSUMED_RESTING_HR = 60;
import {
  goalHash,
  loadCurrentPlan,
  loadLatestStoredPlan,
  loadProfileHistory,
  mondayOf,
  planWeekFor,
  savePlan,
  supersedePlans,
} from "@/lib/scoring/hpe/persistence";
import { estimateObservedResponse } from "@/lib/scoring/hpe/response";
import { deriveFeedbackFromActivities, loadFeedbackSources, recentRunMinutesPerWeek } from "@/lib/scoring/hpe/feedback";
import { selectAttempts, racePacing } from "@/lib/scoring/hpe/progression";
import { validateIntake } from "@/lib/scoring/hpe/intake";
import { parseIntakeRow, resolveIntakeInputs } from "@/lib/scoring/hpe/intake-record";
import { loadPrefilledIntake } from "@/lib/scoring/hpe/load-intake";
import { evaluateAccess, type FeatureFlag } from "@/lib/scoring/hpe/rollout";
import { allows, getEntitlements, logEntitlementDenial } from "@/lib/premium/entitlements";
import { hasArticle9Consent } from "@/lib/consent/article9";
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

  /*
   * Article 9 gate, checked before the rollout dial and before anything is
   * generated.
   *
   * The health screen inside generatePlan is not bypassable — that is the
   * engine's own guarantee — which means generating a plan ALWAYS processes
   * special category data. So without explicit consent there is nothing to
   * decide: the engine cannot run at all.
   *
   * This mirrors the kill switch's shape rather than erroring, because the
   * situations are the same shape: generation stops, an existing plan stays
   * readable, and the athlete is told plainly why. An athlete three weeks into
   * a block who withdraws consent has made a choice about their health data,
   * not asked for their training schedule to be deleted — the withdrawal
   * already removed the health answers themselves (migration 057).
   */
  if (!(await hasArticle9Consent(supabase, user.id))) {
    await recordEvent(supabase, user.id, {
      outcome: "feature_disabled",
      reason_code: "article9_consent_missing",
    });
    const stored = await loadLatestStoredPlan(supabase, user.id).catch(() => null);
    return NextResponse.json({
      generated: false,
      consentRequired: true,
      paused: true,
      storedPlan: stored,
      weeks: stored?.weeks ?? [],
      message:
        "The Hybrid Plan screens your health before it programmes anything, so it needs your explicit consent to use that information. You can give it — or take it back — in Settings.",
    });
  }

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

  /*
   * The subscription gate.
   *
   * Checked AFTER the rollout dial, deliberately. An athlete outside the
   * rollout cannot generate a plan however much they pay, so prompting them to
   * upgrade would be selling something we would not then deliver. Eligibility
   * first, entitlement second.
   *
   * Generation stops; reading an existing plan does not. That is the same
   * asymmetry the kill switch relies on, and it carries more weight here. The
   * Hybrid Plan shipped FREE in build 1.0 (5) — every block a free athlete is
   * currently living through was generated under terms we offered them.
   * Paywalling the read would retroactively withdraw a plan somebody is three
   * weeks into training on, which is a recall, not a paywall. Paywalling
   * generation means their block runs to its end and the next one is a
   * subscriber's.
   *
   * This does not weaken WP6.3. That rule is that a payload must not carry
   * value the account is not entitled to; a plan this account generated while
   * it was entitled is not that value. An athlete with no stored plan gets
   * `weeks: []` — there is nothing withheld because there is nothing there.
   */
  const entitlements = await getEntitlements(supabase, user.id);
  if (!allows(entitlements, "hybrid_plan")) {
    logEntitlementDenial(entitlements, "hybrid_plan", "api/hpe/plan");
    await recordEvent(supabase, user.id, {
      outcome: "feature_disabled",
      reason_code: "not_premium",
    });
    const stored = await loadLatestStoredPlan(supabase, user.id).catch(() => null);
    const hasStored = (stored?.weeks?.length ?? 0) > 0;
    return NextResponse.json({
      generated: false,
      premiumRequired: true,
      paused: true,
      storedPlan: stored,
      weeks: stored?.weeks ?? [],
      profile: stored?.profile ?? null,
      refusal: {
        reason: hasStored
          ? "Building a new block is part of Premium. The block you are on was built while the Hybrid Plan was free, and it stays yours — nothing about it has changed."
          : "The Hybrid Plan is part of Premium. It builds one periodised block toward your event date, balancing lifting and endurance against each other rather than stacking them.",
        nextSteps: hasStored
          ? [
              "Keep training the block below — it runs to the end of its weeks either way.",
              "Upgrade to Premium when you want the next block built.",
            ]
          : ["Upgrade to Premium to build your first block."],
      },
      diagnostic: null,
    });
  }

  // Profile fields are read by loadPrefilledIntake rather than here — one
  // reader, so the numbers confirmed on the intake form are exactly the ones
  // the plan is built from.
  const { data: intakeRow } = await supabase
    .from("hpe_intake")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  // ---- WP2: the intake now answers what this route used to assume --------
  // Parsed BEFORE the diagnostic, because the diagnostic needs the athlete's
  // typed 1RMs. `state.oneRms` (what the plan is promised against) applied them
  // and `profile.oneRms` (what the plan is programmed from) did not, so an
  // athlete who corrected their squat to a tested 180 was told the meet total
  // was reachable from 180 and then given every session at percentages of the
  // 160 their logs showed — and meet attempts picked off 160 as well. One
  // number now, floored the same way in both places.
  const intake = parseIntakeRow(intakeRow as Record<string, unknown> | null);

  /**
   * Which side of the athlete the DIAGNOSTIC leans toward, per the intake
   * spec's open decision D2: "a slider that is pre-set from the goal gap and
   * can be moved — it anchors the athlete on the honest answer while leaving
   * them agency."
   *
   * Read from this athlete's own hybrid-plan goals. It used to be read from the
   * `training_goals` table — the removed Training Plan's storage — as
   * gymGoals/allGoals. That product's API is retired and nothing could write
   * that table any more, so the ratio was computed from rows no athlete could
   * create, see or change: every new athlete got a flat 0.5 whatever they were
   * training for, and anyone with rows left over from before the page was
   * removed got a split from goals they had no way to revise.
   *
   * The slider wins outright once the athlete has touched it — an explicit
   * answer is not something to average against an inference.
   */
  const priority = (() => {
    if (intake.priorityUserSet) return intake.priority;

    // DOMAINS, not targets. Counting individual answers is what the old
    // training_goals version did (gymGoals/allGoals) and it is quietly wrong,
    // because strength targets come in threes and endurance targets come in
    // ones. An athlete with a squat, a bench AND a 5k target counted 3-1 and
    // read as a 0.75 strength lean — measured on a real athlete, that put
    // aerobic_base at 0.24 and named strength as the limiter for someone whose
    // entered event is a 5k. On domains it is 0.5, aerobic_base 0.32, limiter
    // endurance. Strength is one side of this athlete however many barbells it
    // takes to describe it.
    //
    // This moves the EMPHASIS VECTOR, not the session count. How many runs a
    // week the athlete gets is decided later, from their on-ramp volume anchor
    // (session-set.ts, affordableBySessionLength) — priority only shifts one
    // session between domains at the margin.
    const hasStrengthGoal = [intake.targetSquatKg, intake.targetBenchKg, intake.targetDeadliftKg].some(
      (kg) => kg != null && kg > 0
    );
    // A named race is an endurance goal with or without a target time — the
    // same rule classifyGoalModes already applies to enduranceEventKm.
    const hasEnduranceGoal =
      (intake.target5kS != null && intake.target5kS > 0) || (intake.events?.length ?? 0) > 0;

    if (hasStrengthGoal && hasEnduranceGoal) return 0.5;
    if (hasStrengthGoal) return 1;
    if (hasEnduranceGoal) return 0;
    // No goal on either side is not evidence of balance — it is no evidence at
    // all, and 0.5 is what the engine already means by that.
    return 0.5;
  })();

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

  /**
   * BLOCK CONTINUITY. The plan the athlete is living through is the plan
   * that gets adjusted, not restarted.
   *
   * Every GET used to regenerate the whole block from week one and the
   * screen anchored it to that Monday, so the athlete was permanently in
   * week one and no deload, ramp step or phase change ever arrived.
   *
   * Now: if a current plan exists, was built for the same goal, constraints
   * and constants, and the athlete is still inside it, the block CONTINUES
   * from the current week. The lived weeks are carried through unchanged;
   * the remaining weeks are regenerated from the athlete's real logged
   * volume and the feedback derived from what they actually did. The
   * calendar stays anchored to the block's original Monday.
   *
   * A changed goal, a constants bump, a diagnostic drift beyond the
   * threshold, or a finished block starts a fresh one.
   */
  const current = await loadCurrentPlan(supabase, user.id).catch(() => null);
  const hash = goalHash(goal, constraints, HPE_CONSTANTS_VERSION);
  const today = new Date();
  const currentWeek = current ? planWeekFor(current.startsOn, today) : 1;
  const canContinue =
    current != null &&
    current.goalHash === hash &&
    currentWeek > 1 &&
    currentWeek <= current.weeksOut &&
    !(diagnostic?.rerun?.drift?.shouldRegenerate === true);

  const sinceIso = current
    ? new Date(`${current.startsOn}T00:00:00`).toISOString()
    : new Date(Date.now() - 8 * 7 * 86_400_000).toISOString();
  const sources = await loadFeedbackSources(supabase, user.id, current?.planId ?? null, sinceIso);
  const feedbackByWeek =
    current && canContinue ? deriveFeedbackFromActivities(current.weeks, sources.activities, current.startsOn, today, sources.explicit) : {};
  const loggedNow = recentRunMinutesPerWeek(sources.activities, 2, today);

  /**
   * What this athlete's own history says about their rate of improvement.
   *
   * Read over the last half-year of stored diagnostic runs, because a rate
   * needs two points far enough apart to mean anything and anything older
   * than that is a different athlete. Blended into the population prior at a
   * weight the observation length supports — `response.ts` explains why that
   * weight is small even when the observation looks convincing.
   */
  const observedResponse = estimateObservedResponse(
    await loadProfileHistory(supabase, user.id, new Date(Date.now() - 26 * 7 * 86_400_000).toISOString()).catch(() => []),
    today
  );

  /**
   * F17 — days the athlete has flagged as low capacity.
   *
   * Only days that have not yet passed: a flag on a session three weeks ago
   * is a record of how that day went, not an instruction about it, and
   * rewriting history would make the plan disagree with what they did.
   */
  const lowCapacityDays = current
    ? sources.explicit
        .filter((e) => e.lowCapacity && e.dayOfWeek != null && e.week >= currentWeek)
        .map((e) => ({ week: e.week, day: e.dayOfWeek as string }))
    : [];

  const startsOn = canContinue && current ? current.startsOn : mondayOf(today);
  const plan = generatePlan({
    state,
    goal,
    constraints,
    profile,
    overrideEventOrder,
    modalityFitness,
    feedbackByWeek,
    observedResponse,
    lowCapacityDays,
    continueFrom:
      canContinue && current
        ? {
            week: currentWeek,
            priorWeeks: current.weeks,
            // The ramp restarts from what they are actually running, floored
            // at a share of the plan's own projection so one quiet fortnight
            // does not collapse the block.
            currentVolumeMin: Math.max(
              loggedNow ?? 0,
              (current.weeks.find((w) => w.week === currentWeek - 1)?.delivered?.enduranceMin ?? 0) * 0.7,
              1
            ),
          }
        : undefined,
  });

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
  // Persist when the plan is real and the diagnostic behind it was stored —
  // and only when something changed. A continuation whose generated weeks
  // are unchanged from the stored ones is not a new plan; writing it on
  // every visit would fill the table with copies and make the "current
  // plan" a measure of how often the athlete opened the app.
  let persisted: { planId: string; storedSessions: number; droppedSessions: number } | null = null;
  const unchanged =
    canContinue &&
    current != null &&
    current.generatedForWeek === currentWeek &&
    current.constantsVersion === plan.constantsVersion;
  if (plan.generated && diagnostic?.profileId && !unchanged) {
    const reason = diagnostic?.rerun?.shouldRegenerate
      ? diagnostic.rerun!.explanations.join(" ")
      : canContinue
        ? `Continued from week ${currentWeek} on ${today.toISOString().slice(0, 10)}.`
        : current
          ? "The goal, constraints or block changed, so a new block was started."
          : null;
    if (reason) await supersedePlans(supabase, user.id, reason).catch(() => {});
    persisted = await savePlan(supabase, user.id, {
      profileId: diagnostic.profileId,
      findingIds: diagnostic.findingIds,
      constantsVersion: plan.constantsVersion,
      goal,
      constraints,
      weeks: plan.weeks,
      eventDate,
      startsOn,
      generatedForWeek: plan.startWeek,
    }).catch(() => null);
  } else if (unchanged && current) {
    persisted = { planId: current.planId, storedSessions: current.weeks.reduce((s, w) => s + w.placements.length, 0), droppedSessions: 0 };
  }

  if (plan.generated) {
    const f = plan.feasibility;
    await recordEvent(supabase, user.id, {
      outcome: "generated",
      tier: profile.tier,
      profile_id: diagnostic?.profileId ?? null,
      plan_id: persisted?.planId ?? null,
      peak_acwr: plan.acwr?.peakAcwr ?? null,
      weeks_out: goal.weeksOut,
      session_count: plan.weeks.reduce((s, w) => s + w.placements.length, 0),
      hard_violations: plan.weeks.reduce((s, w) => s + w.hardPenalty, 0),
      // Migration 080 — how ambitious the target was, what the plan could
      // deliver against it, and whether this was a continued block. The
      // evidence review names the ambition-versus-abandonment curve as the
      // one number nobody has published and this product is placed to
      // measure; it cannot be measured without recording the ambition at the
      // moment the athlete was shown it.
      endurance_goal_z: f?.endurance.zRequired ?? null,
      strength_goal_z: f?.strength.zRequired ?? null,
      endurance_goal_level: f?.endurance.level ?? null,
      strength_goal_level: f?.strength.level ?? null,
      endurance_goal_probability: f?.endurance.probability ?? null,
      strength_goal_probability: f?.strength.probability ?? null,
      adherence_prior: f?.adherence ?? null,
      delivered_endurance_min: plan.dose?.enduranceMinPerWeek ?? null,
      delivered_sets_per_lift: plan.dose?.setsPerLiftPerWeek ?? null,
      continued_block: canContinue,
      plan_week: plan.startWeek,
    });
  }

  return NextResponse.json({
    ...plan,
    assumptions,
    eventDate,
    persisted,
    // The Monday week one began on and the week the athlete is in now — the
    // screen anchors its calendar to these rather than to today.
    startsOn,
    currentWeek: canContinue ? currentWeek : 1,
    continued: canContinue,
    rerun: diagnostic?.rerun ?? null,
    // F18 — attempt selection and race pacing, the two core coach
    // deliverables the assurance review flagged as absent.
    attempts: Object.keys(profile.oneRms).length > 0 ? selectAttempts(profile.oneRms, goal.sameDay) : [],
    pacing: goal.target5kS != null ? racePacing(goal.target5kS, goal.sameDay) : null,
  });
}
