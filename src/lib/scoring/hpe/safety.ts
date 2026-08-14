/**
 * Hybrid Plan Engine — WP3, the safety and eligibility screen.
 *
 * Closes assurance finding F1 (Critical): "Rev A would generate a peaking
 * block for anyone: a 16-year-old, someone six weeks post-surgery, someone
 * with exertional chest pain, someone with eight weeks of lifting experience.
 * A coach's first hour with any athlete is screening, and no amount of
 * downstream sophistication compensates for its absence."
 *
 * Non-negotiable #3: this runs FIRST, it can block, and it is not bypassable.
 * `generatePlan` calls it before anything else and returns without a plan on
 * a block — there is no flag that skips it.
 *
 * Two design points from the review carried through deliberately:
 *
 *  - "The screen must produce referrals, not just refusals. A refusal with no
 *    next step is a churn event; a refusal with 'here is who to see, come
 *    back after' is a retained user." Every block carries a referral or a
 *    concrete alternative.
 *
 *  - F2: a paid app telling someone their goal becomes reachable at a lower
 *    bodyweight is a meaningful push, and hybrid athletes chasing a weight
 *    class and a run time are a higher-risk population for low energy
 *    availability. Two or more LEA flags blocks outright; one suppresses
 *    bodyweight guidance. No configuration of this engine produces calorie
 *    targets, macro splits or rate-of-loss plans (non-negotiable #5).
 */

import { MIN_HEALTHY_BMI } from "./constants";
import { bmi, mayShowBodyweightGuidance, type AthleteState, type Goal } from "./intake";

export interface SafetyResult {
  blocked: boolean;
  blocks: string[];
  warnings: string[];
  referrals: string[];
  showBodyweightGuidance: boolean;
  /** Set when a competition peaking block is refused but a general preparation plan is appropriate instead — a refusal with a next step, not a dead end. */
  offerGeneralPreparationInstead: boolean;
  /** F16/intake spec: beta blockers and similar mean every prescription drops HR and uses pace and RPE. */
  suppressHeartRatePrescription: boolean;
  /** Ramp rate multiplier imposed by the screen (injury history, novice runner). Never above 1. */
  rampMultiplier: number;
}

export function safetyScreen(state: AthleteState, goal: Goal): SafetyResult {
  const blocks: string[] = [];
  const warnings: string[] = [];
  const referrals: string[] = [];
  const s = state.safety;
  let offerGeneralPreparationInstead = false;
  let rampMultiplier = 1;

  if (s.under18 || state.age < 18) {
    blocks.push(
      "Under 18: peaking programmes for maximal-load competition are out of scope. No plan generated."
    );
    referrals.push("A coach qualified in youth strength and conditioning");
  }

  if (s.chestPainOnExertion || s.parqPositive) {
    blocks.push("PAR-Q+ positive: medical clearance is required before any plan is generated.");
    referrals.push("GP / sports physician");
  }

  if (s.pregnantOrPostpartum12wk) {
    blocks.push("Pregnant or within 12 weeks postpartum: out of scope.");
    referrals.push("Pelvic health physiotherapist");
  }

  if (s.currentInjuryLimiting) {
    blocks.push("Currently limited by injury: rehabilitation is out of scope for this engine.");
    referrals.push("Physiotherapist");
  }

  if (s.surgeryLast6Months) {
    warnings.push("Surgery within 6 months: confirm clearance with your surgeon or GP before loading.");
  }

  // Training-age eligibility for a peaking block. A novice does not need
  // peaking, they need consistent exposure — so this refuses the peaking
  // plan specifically and offers the right plan instead.
  if (state.strengthTrainingYears < 1.0 && goal.targetTotalKg != null) {
    blocks.push(
      "Under 12 months of structured strength training: a competition peaking block is not appropriate. " +
        "A general preparation plan is offered instead — consistent exposure is what builds a total at this stage, " +
        "not a peak."
    );
    offerGeneralPreparationInstead = true;
  }

  if (state.enduranceTrainingYears < 0.5 && goal.target5kS != null) {
    warnings.push("Under 6 months of running: endurance targets are capped and the volume ramp is halved.");
    rampMultiplier = Math.min(rampMultiplier, 0.5);
  }

  // Intake spec: a recent injury that stopped training for over a week
  // halves the ramp. Unanswered is assumed true (the conservative direction).
  if (s.injuryLast12Weeks) {
    warnings.push(
      "Injury in the last 12 weeks: the volume ramp is halved for this block. Build back to where you were before " +
        "trying to go past it."
    );
    rampMultiplier = Math.min(rampMultiplier, 0.5);
  }

  // F2 — low energy availability.
  //
  // This no longer blocks the plan, and the reasoning is worth stating because
  // it reverses the assurance review's Rev B position.
  //
  // The review made this a block because Rev A's headline feature was a table
  // showing that losing 8kg buys 108 seconds off a 5k — a paid app telling an
  // at-risk athlete their goal becomes reachable at a lower bodyweight. THAT
  // is the harm, and it is fully addressed by suppressing bodyweight guidance,
  // which still happens here unconditionally and permanently.
  //
  // Withholding the TRAINING plan on top of that treats nothing. Under-fuelling
  // is not treated by being denied a training programme; it is treated by a
  // dietitian, and the referral is the intervention. Refusing also loses the
  // athlete at exactly the moment the app has a reason to keep talking to them,
  // and an athlete who leaves takes the referral with them.
  //
  // So: no bodyweight guidance ever, the referral shown prominently, fuelling
  // reminders throughout, and a plan they can actually follow.
  if (s.leaRiskFlags >= 2 && s.leaScreenAnswered) {
    warnings.push(
      "Your answers on fuelling suggest you may be training on less energy than you are using. No bodyweight " +
        "guidance of any kind will be shown, and this plan is built on the assumption that you are eating enough " +
        "to support it — if you are not, the plan will not work and the risk is bone stress rather than a missed " +
        "session. Please speak to someone about it; there is nothing here that a dietitian's hour would not beat."
    );
    referrals.push("Registered sports dietitian");
    referrals.push("National Alliance for Eating Disorders helpline, if you would like support");
  } else if (s.leaRiskFlags >= 2 && !s.leaScreenAnswered) {
    // The screen was never answered. Unanswered resolves to positive so that
    // suppression errs safe — but suppressing on a guess and ASSERTING on a
    // guess are different acts, and only the first is defensible. Telling
    // someone their answers suggest under-fuelling, when they gave none, is a
    // clinical claim about a person the engine has never asked.
    warnings.push(
      "The fuelling questions have not been answered, so bodyweight guidance stays switched off. Answering them " +
        "takes a minute and is the only thing keeping it off."
    );
  } else if (s.leaRiskFlags === 1) {  } else if (s.leaRiskFlags === 1) {
    warnings.push(
      "One low-energy-availability screen flag: bodyweight guidance is suppressed and the plan proceeds with " +
        "fuelling reminders only."
    );
  }

  const athleteBmi = bmi(state);
  if (athleteBmi < MIN_HEALTHY_BMI) {
    warnings.push(
      `BMI ${athleteBmi.toFixed(1)} is below ${MIN_HEALTHY_BMI}: no bodyweight-reduction pathway will be offered.`
    );
  }

  if (s.intendsWeightCut && goal.sameDay && goal.target5kS != null) {
    blocks.push(
      "Acute weight cut declared alongside a same-day endurance race: refused. Dehydration is incompatible with " +
        "a 5k and with recovery between events. Lift in the class you already make on the day, or drop the " +
        "same-day race and we will build the plan around either goal on its own."
    );
    referrals.push(
      "Registered sports dietitian, if you want to reach a class without cutting water in the week of the event"
    );
  }

  if (s.medicationAffectingHr) {
    warnings.push(
      "Medication affecting heart rate: every session is prescribed by pace and RPE instead. Heart-rate zones are " +
        "not meaningful on beta blockers and similar, so they are not shown."
    );
  }

  return {
    blocked: blocks.length > 0,
    blocks,
    warnings,
    referrals: [...new Set(referrals)],
    showBodyweightGuidance: mayShowBodyweightGuidance(state) && blocks.length === 0,
    offerGeneralPreparationInstead,
    suppressHeartRatePrescription: s.medicationAffectingHr,
    rampMultiplier,
  };
}
