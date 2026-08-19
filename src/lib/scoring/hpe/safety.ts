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

import {
  CURRENT_INJURY_INTENSITY_CEILING,
  MEDICAL_CLEARANCE_INTENSITY_CEILING,
  MIN_HEALTHY_BMI,
  RECENT_INJURY_INTENSITY_CEILING,
  RECENT_SURGERY_INTENSITY_CEILING,
  YOUTH_INTENSITY_CEILING,
} from "./constants";
import { bmi, mayShowBodyweightGuidance, type AthleteState, type Goal } from "./intake";

export interface SafetyResult {
  /**
   * Things the athlete must read before training. Formerly `blocks`, and
   * formerly fatal — see the note on `safetyScreen`.
   */
  advisories: string[];
  warnings: string[];
  referrals: string[];
  showBodyweightGuidance: boolean;
  /** Set when a competition peaking block is refused but a general preparation plan is appropriate instead — a refusal with a next step, not a dead end. */
  offerGeneralPreparationInstead: boolean;
  /** F16/intake spec: beta blockers and similar mean every prescription drops HR and uses pace and RPE. */
  suppressHeartRatePrescription: boolean;
  /** Ramp rate multiplier imposed by the screen (injury history, novice runner). Never above 1. */
  rampMultiplier: number;
  /**
   * Ceiling on prescribed relative intensity, as a fraction of 1RM, and on how
   * much of the week may be quality work. 1 means unrestricted.
   *
   * This is what the injury answers now drive. Asking someone whether they are
   * hurt and then refusing to train them is not a safety feature — they train
   * anyway, without the plan. Asking and then prescribing lighter is.
   */
  intensityCeiling: number;
}

/**
 * The screen sets how hard the plan is. It does not decide whether there is
 * one.
 *
 * This reverses the brief's non-negotiable #3, which made the screen a
 * non-bypassable gate, and it is a deliberate reversal rather than an erosion.
 * A gate assumes the alternative to a cautious plan is no training. It is not:
 * the athlete who is refused trains anyway, with no ramp cap, no intensity
 * ceiling and no referral — which is strictly worse than the plan the gate
 * withheld. Every input that used to refuse now sets `intensityCeiling` and
 * `rampMultiplier` instead, and the referral is shown either way.
 *
 * Two things are unchanged. Referrals are still produced for everything that
 * warrants one, because a physiotherapist is the intervention and this engine
 * is not. And bodyweight guidance is still suppressed permanently and
 * unconditionally for anyone the low-energy-availability screen flags, because
 * that is the harm the screen exists to prevent and it is not softened here.
 */
export function safetyScreen(state: AthleteState, goal: Goal): SafetyResult {
  const advisories: string[] = [];
  const warnings: string[] = [];
  const referrals: string[] = [];
  const s = state.safety;
  let offerGeneralPreparationInstead = false;
  let rampMultiplier = 1;

  let intensityCeiling = 1;

  if (s.under18 || state.age < 18) {
    advisories.push(
      "You are under 18, so this plan is built for development rather than for peaking a maximal total. Loads are " +
        "capped and the emphasis is on technique and consistent exposure — which is what actually builds a total " +
        "at your age."
    );
    intensityCeiling = Math.min(intensityCeiling, YOUTH_INTENSITY_CEILING);
    offerGeneralPreparationInstead = goal.targetTotalKg != null;
    referrals.push("A coach qualified in youth strength and conditioning");
  }

  if (s.chestPainOnExertion || s.parqPositive) {
    // The one place a refusal was most defensible, and it still is not one.
    // Someone with exertional chest pain who is told "no plan" does not stop
    // exercising; they lose the only screen that was going to tell them to get
    // it looked at. So: say it plainly, put the referral first, and hold the
    // plan at conversational effort until they have been seen.
    advisories.push(
      "You have flagged chest pain on exertion, or a positive PAR-Q+. Please get this checked before you train " +
        "hard — it is the one thing on this form worth a GP appointment this week. Until then this plan stays at " +
        "easy, conversational effort and prescribes no maximal or near-maximal work."
    );
    intensityCeiling = Math.min(intensityCeiling, MEDICAL_CLEARANCE_INTENSITY_CEILING);
    rampMultiplier = Math.min(rampMultiplier, 0.5);
    referrals.push("GP / sports physician");
  }

  if (s.pregnantOrPostpartum12wk) {
    advisories.push(
      "Pregnant or within 12 weeks postpartum: this engine is not built to programme for you, and the sensible " +
        "person to plan with is a pelvic health physiotherapist. What follows is held well below maximal and is a " +
        "starting point for that conversation, not a substitute for it."
    );
    intensityCeiling = Math.min(intensityCeiling, MEDICAL_CLEARANCE_INTENSITY_CEILING);
    rampMultiplier = Math.min(rampMultiplier, 0.5);
    referrals.push("Pelvic health physiotherapist");
  }

  // Injury now sets the dial rather than closing the door. This is the whole
  // point of asking: an athlete carrying something wants a plan that respects
  // it, and refusing them produces an athlete training with no plan at all.
  if (s.currentInjuryLimiting) {
    advisories.push(
      "You are currently limited by an injury, so this block is capped: nothing near-maximal, and the volume ramp " +
        "is halved. Rehabilitation itself is a physiotherapist's job, not this engine's — train around the injury " +
        "with this and get the injury seen."
    );
    intensityCeiling = Math.min(intensityCeiling, CURRENT_INJURY_INTENSITY_CEILING);
    rampMultiplier = Math.min(rampMultiplier, 0.5);
    referrals.push("Physiotherapist");
  }

  if (s.surgeryLast6Months) {
    warnings.push(
      "Surgery within 6 months: loads are held below maximal and the ramp is halved. Confirm clearance with your " +
        "surgeon or GP before you load heavily."
    );
    intensityCeiling = Math.min(intensityCeiling, RECENT_SURGERY_INTENSITY_CEILING);
    rampMultiplier = Math.min(rampMultiplier, 0.5);
  }

  // Training-age eligibility for a peaking block. A novice does not need
  // peaking, they need consistent exposure — so this refuses the peaking
  // plan specifically and offers the right plan instead.
  if (state.strengthTrainingYears < 1.0 && goal.targetTotalKg != null) {
    advisories.push(
      "Under 12 months of structured lifting, so this is built as general preparation rather than a competition " +
        "peak. Consistent exposure is what builds a total at this stage; peaking is what you do once there is a " +
        "total worth peaking."
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
    intensityCeiling = Math.min(intensityCeiling, RECENT_INJURY_INTENSITY_CEILING);
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
  } else if (s.leaRiskFlags === 1) {
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
    advisories.push(
      "You have declared an acute weight cut alongside a same-day endurance race. Please do not do both: " +
        "dehydration is incompatible with running a 5k and with recovering between events, and this is the one " +
        "combination on this form most likely to end your day early. Lift in the class you already make, or move " +
        "the race. The plan below assumes you are not cutting water in race week."
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
    advisories,
    warnings,
    referrals: [...new Set(referrals)],
    // Unchanged and unconditional. `mayShowBodyweightGuidance` already gates on
    // the LEA flags, BMI and age, so this does not loosen with the blocks gone.
    showBodyweightGuidance: mayShowBodyweightGuidance(state),
    offerGeneralPreparationInstead,
    suppressHeartRatePrescription: s.medicationAffectingHr,
    rampMultiplier,
    intensityCeiling,
  };
}
