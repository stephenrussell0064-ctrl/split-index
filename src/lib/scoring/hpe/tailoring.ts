/**
 * Hybrid Plan Engine — how individual this plan actually is.
 *
 * This module exists because of a product decision that overrides the brief on
 * one point, deliberately and narrowly.
 *
 * The brief's position was "no plan" below tier 1: refuse, and offer a
 * two-week baseline block instead. That is defensible reasoning — a plan built
 * on no data is a template with the athlete's name on it — but it is the wrong
 * behaviour, for a reason the assurance review already articulated about
 * safety refusals: "a refusal with no next step is a churn event". An athlete
 * who opens the app, answers eight sections of questions and is told "not yet"
 * has been given homework by software that has told them nothing. They do not
 * come back.
 *
 * So the engine now always produces a plan and says plainly how much of it is
 * them and how much is the population. That is strictly more honest than
 * refusing, not less: a refusal implies the engine knows something it will not
 * share, whereas a labelled provisional plan shows its working. The
 * uncertainty is paid for in CAUTION rather than in silence — a provisional
 * plan starts lower and ramps at half rate, so being wrong about a beginner
 * costs them a fortnight of easy running rather than an injury.
 *
 * What is NOT relaxed: the safety screen. PAR-Q positives, exertional chest
 * pain, a current limiting injury and two or more low-energy-availability
 * flags still block outright and still refer. Those are not data gaps that
 * more logging would fill — they are medical screening, and generating a
 * peaking block for someone with exertional chest pain because refusing felt
 * unfriendly would be indefensible.
 */

import {
  TAILORING_BY_TIER,
  TAILORING_RAMP_MULTIPLIER,
  type DataTierKey,
  type TailoringLevel,
} from "./constants";
import type { AthleteProfile } from "./types";

export interface TailoringUnlock {
  /** What the athlete would do. */
  action: string;
  /** What it buys them, specifically. Vague benefits ("better plans") motivate nobody. */
  unlocks: string;
}

export interface PlanTailoring {
  level: TailoringLevel;
  /** 0-1. The diagnostic's own confidence, surfaced rather than hidden behind a refusal. */
  confidence: number;
  tier: number;
  headline: string;
  /** The honest paragraph: what is derived from this athlete, what is population default. */
  explanation: string;
  /** Ordered by how much each one buys. The first entry is what to do next. */
  unlocks: TailoringUnlock[];
  /** Multiplier applied to the volume ramp — uncertainty is paid for in caution. */
  rampMultiplier: number;
  /** True when the plan is running mostly on population numbers. Drives the UI banner. */
  isProvisional: boolean;
}

const HEADLINE: Record<TailoringLevel, string> = {
  provisional: "A starting plan, not yet a personal one",
  developing: "Partly yours, partly population",
  tailored: "Built from your own data",
  individualised: "Fully individualised",
};

const EXPLANATION: Record<TailoringLevel, string> = {
  provisional:
    "There is not enough logged history yet to diagnose what you specifically need, so this plan is built on " +
    "population defaults and starts deliberately conservatively — the ramp runs at half rate because the engine is " +
    "guessing at your starting point rather than reading it. It is a sound general block, and it is not yet a " +
    "prescription. Every session you log changes it.",
  developing:
    "Your volume and your starting point come from your own logs. Your fatigue-resistance profile and your easy " +
    "pace are still population estimates, so the prescribed bands are wider than they will be. The ramp is held " +
    "below full rate until there is more to go on.",
  tailored:
    "Your volume, your starting point, your easy pace and your emphasis all come from your own logged history. " +
    "The remaining gap is precision rather than principle — the bands narrow further with more maximal efforts " +
    "and more logged sets.",
  individualised:
    "Everything in this plan is derived from your own data: your fatigue-resistance exponent, your heart-rate " +
    "response, your rep profile and your lift ratios. Nothing here is a population default.",
};

/**
 * What to do next, most valuable first. Each entry names the specific thing it
 * unlocks — "log more runs" is a chore, "a second maximal effort unlocks your
 * personal fatigue-resistance model" is a reason.
 */
export function tailoringUnlocks(profile: AthleteProfile): TailoringUnlock[] {
  const unlocks: TailoringUnlock[] = [];

  if (profile.riegelK == null) {
    unlocks.push({
      action: "Run a second maximal effort at a different distance — a 5k and a 10k, or a 10k and a parkrun.",
      unlocks:
        "Your personal fatigue-resistance exponent. It is the single highest-value number in the diagnostic: it " +
        "decides whether your limiter is endurance or speed, and right now the plan is using the population value.",
    });
  }

  if (profile.runsInsideEasyBand === 0) {
    unlocks.push({
      action: "Log four easy runs with heart rate, run genuinely easily.",
      unlocks:
        "Your real easy pace, derived from your own heart-rate response rather than from a multiple of your 5k " +
        "time. This is the most-used number in the whole plan.",
    });
  }

  if (profile.hrPaceModel == null) {
    unlocks.push({
      action: "Wear a heart-rate monitor on six or more runs.",
      unlocks:
        "A heart-rate band for every session that is yours rather than a percentage of a textbook maximum.",
    });
  }

  if (profile.repProfileGap == null) {
    unlocks.push({
      action: "Log both heavy sets (1-3 reps) and volume sets (6-12 reps) on your main lifts.",
      unlocks:
        "Your rep profile — whether you need heavy singles or more volume. Without it the strength side is " +
        "prescribed on phase alone.",
    });
  }

  if (profile.speedReserveMs == null) {
    unlocks.push({
      action: "Log a flat-out 400m.",
      unlocks: "Your anaerobic speed reserve, which sets how much neuromuscular work belongs in your week.",
    });
  }

  if (Object.keys(profile.oneRms).length === 0) {
    unlocks.push({
      action: "Log a 3-5RM on squat, bench and deadlift.",
      unlocks: "Load prescriptions in kilos rather than in percentages you have to work out yourself.",
    });
  }

  return unlocks;
}

export function assessTailoring(profile: AthleteProfile): PlanTailoring {
  const tier = profile.tier as DataTierKey;
  const level = TAILORING_BY_TIER[tier] ?? "provisional";

  return {
    level,
    confidence: profile.confidence,
    tier: profile.tier,
    headline: HEADLINE[level],
    explanation: EXPLANATION[level],
    unlocks: tailoringUnlocks(profile),
    rampMultiplier: TAILORING_RAMP_MULTIPLIER[level],
    isProvisional: level === "provisional" || level === "developing",
  };
}

/**
 * The message shown after a session is logged. The loop this closes is the
 * whole argument for generating a provisional plan rather than refusing: the
 * athlete has something to do today, and doing it visibly improves tomorrow's
 * plan.
 */
export function nextSessionImpact(profile: AthleteProfile): string | null {
  const unlocks = tailoringUnlocks(profile);
  if (unlocks.length === 0) return null;
  return `${unlocks[0].action} ${unlocks[0].unlocks}`;
}
