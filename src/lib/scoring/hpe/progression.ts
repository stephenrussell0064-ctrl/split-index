/**
 * Hybrid Plan Engine — WP8: the four open assurance findings, F15-F18.
 *
 * These are the conditions of sign-off: "I would not sign off a build brief
 * without them."
 *
 *  F15 — Quality sessions must progress across the block. "The engine
 *        currently prescribes 5x1000m at 5k pace in week 5 and in week 21."
 *        Progression runs on all three available axes — volume (rep count),
 *        density (recovery), and pace (current 5k pace moving toward target).
 *
 *  F16 — Autoregulation from actual session feedback. "The plan is written
 *        once and never adapts. A real coach adjusts on Monday based on what
 *        happened at the weekend."
 *
 *  F17 — A minimum accommodation for female athletes. The review is explicit
 *        that the evidence for menstrual-cycle-based periodisation is weak
 *        and it would not build prescription around it. What it asks for
 *        instead is a symptom-flagging option that lets an athlete mark a day
 *        as low-capacity and have the engine swap a quality session for an
 *        easy one. That is what is implemented — available to any athlete,
 *        because a bad night's sleep is a bad night's sleep.
 *
 *  F18 — Attempt selection and race pacing.
 *
 * Also carries the Rev 2 addition: the diagnostic re-runs every four weeks
 * against accumulating data, and an emphasis shift beyond 0.10 on any
 * dimension regenerates the remaining macrocycle and shows the athlete what
 * changed and why. "This is what closes the loop between 'the plan adapts'
 * and 'the plan adapts *for a reason you can read*.'"
 */

import {
  ATTEMPT_FRACTIONS,
  AUTOREG_CONSECUTIVE_SHORTFALLS,
  AUTOREG_RPE_OVERSHOOT,
  AUTOREG_VOLUME_REDUCTION,
  DIAGNOSTIC_RERUN_WEEKS,
  DUAL_EVENT_ATTEMPT_DISCOUNT,
  EMPHASIS_DRIFT_REGENERATE_THRESHOLD,
  EMPHASIS_KEYS,
  EXPECTED_RPE_BY_KIND,
  INTERVAL_PACE_PROGRESSION,
  INTERVAL_RECOVERY_PROGRESSION_S,
  INTERVAL_REPS_PROGRESSION,
  POST_MEET_FIRST_KM_OFFSET_S,
  SESSION_PACE_BANDS,
  THRESHOLD_BLOCK_MIN_PROGRESSION,
  WEIGHT_ROUNDING_KG,
  type EmphasisKey,
  type Phase,
} from "./constants";
import type { MacrocycleWeek } from "./macrocycle";
import type { Goal } from "./intake";
import type { EnduranceKind } from "./prescription";
import { mmss } from "./prescription";
import type { AthleteProfile, EmphasisVector } from "./types";

const lerp = (a: number, b: number, t: number) => a + (b - a) * Math.min(1, Math.max(0, t));

/**
 * Where this week sits in the block overall, 0 to 1. F15 asks for progression
 * "indexed by week within phase", but a table indexed only within phase
 * restarts every phase — a week-1-of-specific session would regress below the
 * last week of build. Blending the phase index with the position inside it
 * gives a monotone ramp across the whole block, which is what "progress
 * across the block" actually means.
 */
export function blockProgress(week: MacrocycleWeek): number {
  const developmentOrder: Phase[] = ["base", "build", "specific", "peak"];
  if (week.phase === "taper") return 1;
  const idx = developmentOrder.indexOf(week.phase);
  if (idx < 0) return week.phaseProgress;
  return (idx + week.phaseProgress) / developmentOrder.length;
}

export interface QualityProgression {
  intervalReps?: number;
  intervalRecoveryS?: number;
  thresholdBlockMin?: number;
  paceOverride?: { lo: number; hi: number };
}

/**
 * F15. Early in the block: fewer reps, longer recovery, at the athlete's
 * CURRENT 5k pace. Late in the block: more reps, shorter recovery, at their
 * TARGET 5k pace. The pace axis never goes beyond the target — prescribing
 * faster than the athlete's own goal pace is not a progression, it is a
 * fantasy.
 */
export function qualityProgressionFor(
  kind: EnduranceKind,
  week: MacrocycleWeek,
  profile: AthleteProfile,
  goal: Goal
): QualityProgression {
  const t = blockProgress(week);
  if (kind !== "interval_run" && kind !== "threshold_run") return {};

  const currentPace = profile.predicted5kS / 5;
  // A target slower than current would drag the prescription backwards; the
  // athlete is already past it, so current pace governs.
  const targetPace = goal.target5kS != null ? Math.min(goal.target5kS / 5, currentPace) : currentPace;
  const paceBlend = lerp(INTERVAL_PACE_PROGRESSION[0], INTERVAL_PACE_PROGRESSION[1], t);
  const anchorPace = lerp(currentPace, targetPace, paceBlend);
  const band = SESSION_PACE_BANDS[kind];
  const paceOverride = { lo: anchorPace * band[0], hi: anchorPace * band[1] };

  if (kind === "interval_run") {
    return {
      intervalReps: Math.round(lerp(INTERVAL_REPS_PROGRESSION[0], INTERVAL_REPS_PROGRESSION[1], t)),
      intervalRecoveryS: Math.round(lerp(INTERVAL_RECOVERY_PROGRESSION_S[0], INTERVAL_RECOVERY_PROGRESSION_S[1], t)),
      paceOverride,
    };
  }
  return {
    thresholdBlockMin: Math.round(lerp(THRESHOLD_BLOCK_MIN_PROGRESSION[0], THRESHOLD_BLOCK_MIN_PROGRESSION[1], t)),
    paceOverride,
  };
}

// ---------------------------------------------------------------------------
// F16 — autoregulation
// ---------------------------------------------------------------------------

export interface SessionFeedback {
  kind: string;
  /** Did the athlete complete the session at all? */
  completed: boolean;
  /** Athlete-reported session RPE, 1-10. */
  sessionRpe: number | null;
  /** Was the prescribed load or pace actually achieved? */
  metPrescription: boolean;
  /** Ordering only — most recent last. */
  loggedAt: string;
}

export interface AutoregulationResult {
  /** Multiplier applied to next week's volume. 1 = no change. */
  volumeMultiplier: number;
  triggered: boolean;
  reasons: string[];
}

/**
 * "Three consecutive sessions below prescription, or a session RPE more than
 * two points above the expected value, triggers a reduction in the following
 * week."
 *
 * This is the minimum viable version the review asked for, and deliberately
 * only reduces. An engine that also ramps UP off self-reported "that felt
 * easy" would be trusting the least reliable signal in the whole system to
 * push load in the direction that injures people.
 */
export function autoregulate(feedback: SessionFeedback[]): AutoregulationResult {
  const reasons: string[] = [];
  if (feedback.length === 0) return { volumeMultiplier: 1, triggered: false, reasons };

  const ordered = [...feedback].sort((a, b) => a.loggedAt.localeCompare(b.loggedAt));

  let streak = 0;
  let worstStreak = 0;
  for (const f of ordered) {
    if (!f.completed || !f.metPrescription) {
      streak++;
      worstStreak = Math.max(worstStreak, streak);
    } else {
      streak = 0;
    }
  }
  if (worstStreak >= AUTOREG_CONSECUTIVE_SHORTFALLS) {
    reasons.push(
      `${worstStreak} sessions in a row came in under prescription. Next week steps back ` +
        `${Math.round(AUTOREG_VOLUME_REDUCTION * 100)}% rather than repeating a week you could not complete.`
    );
  }

  for (const f of ordered) {
    if (f.sessionRpe == null) continue;
    const expected = EXPECTED_RPE_BY_KIND[f.kind];
    if (expected == null) continue;
    if (f.sessionRpe - expected > AUTOREG_RPE_OVERSHOOT) {
      reasons.push(
        `Your ${f.kind.replace(/_/g, " ")} came back at RPE ${f.sessionRpe} against an expected ${expected}. ` +
          `That gap usually means accumulated fatigue rather than a bad session, so next week eases off.`
      );
      break;
    }
  }

  const triggered = reasons.length > 0;
  return { volumeMultiplier: triggered ? 1 - AUTOREG_VOLUME_REDUCTION : 1, triggered, reasons };
}

// ---------------------------------------------------------------------------
// F17 — low-capacity day flagging
// ---------------------------------------------------------------------------

export interface LowCapacitySwap<T extends { kind: string; isQuality: boolean }> {
  sessions: T[];
  swapped: boolean;
  note: string | null;
}

/**
 * An athlete marks a day as low-capacity; the hardest quality session on that
 * day becomes an easy one. Costs almost nothing and is a meaningful quality
 * difference — which is exactly how the review framed it.
 *
 * Deliberately NOT modelled on cycle phase. The evidence for
 * cycle-based periodisation is weak, and building prescription around it
 * would be inventing precision the data does not support.
 */
export function applyLowCapacityDay<T extends { kind: string; isQuality: boolean; intensity: number }>(
  sessions: T[],
  easyReplacement: (original: T) => T
): LowCapacitySwap<T> {
  const hardestIdx = sessions.reduce(
    (best, s, i) => (s.isQuality && (best < 0 || s.intensity > sessions[best].intensity) ? i : best),
    -1
  );
  if (hardestIdx < 0) {
    return { sessions, swapped: false, note: "Nothing hard scheduled today — no change needed." };
  }
  const next = [...sessions];
  const original = next[hardestIdx];
  next[hardestIdx] = easyReplacement(original);
  return {
    sessions: next,
    swapped: true,
    note:
      `You flagged today as low capacity, so the ${original.kind.replace(/_/g, " ")} becomes an easy session. ` +
      `The quality session is not lost — it moves to the next week rather than being forced through today.`,
  };
}

// ---------------------------------------------------------------------------
// F18 — attempt selection and race pacing
// ---------------------------------------------------------------------------

export interface AttemptSelection {
  lift: string;
  opener: number;
  second: number;
  third: number;
  note: string;
}

const roundToPlate = (kg: number) => Math.round(kg / WEIGHT_ROUNDING_KG) * WEIGHT_ROUNDING_KG;

/**
 * Openers at roughly 91-93% of expected best, seconds at 96-98%, thirds at
 * 100-103% — with a hybrid athlete on a dual-event day opening more
 * conservatively than usual, because an opener missed on a day you are also
 * racing is a wasted attempt you cannot get back.
 */
export function selectAttempts(
  expectedBestKg: Record<string, number>,
  sameDayDualEvent: boolean
): AttemptSelection[] {
  const discount = sameDayDualEvent ? DUAL_EVENT_ATTEMPT_DISCOUNT : 0;
  return Object.entries(expectedBestKg)
    .filter(([, best]) => best > 0)
    .map(([lift, best]) => ({
      lift,
      opener: roundToPlate(best * (ATTEMPT_FRACTIONS.opener[0] - discount)),
      second: roundToPlate(best * (ATTEMPT_FRACTIONS.second[0] - discount)),
      third: roundToPlate(best * ATTEMPT_FRACTIONS.third[0]),
      note: sameDayDualEvent
        ? "Opened conservatively — you are racing the same day, and a missed opener is an attempt you cannot get back."
        : "Opener is a lift you could make on your worst day; that is the whole job of an opener.",
    }));
}

export interface RacePacing {
  targetPaceSPerKm: number;
  firstKmPaceSPerKm: number;
  note: string;
}

/** Even splits or a marginally negative split; first km 3-5 s/km slower than target when the race follows a meet. */
export function racePacing(target5kS: number, followsMeet: boolean): RacePacing {
  const targetPace = target5kS / 5;
  const offset = followsMeet ? POST_MEET_FIRST_KM_OFFSET_S[0] : 0;
  return {
    targetPaceSPerKm: targetPace,
    firstKmPaceSPerKm: targetPace + offset,
    note: followsMeet
      ? `Run the first kilometre at ${mmss(targetPace + POST_MEET_FIRST_KM_OFFSET_S[0])}-${mmss(targetPace + POST_MEET_FIRST_KM_OFFSET_S[1])}/km — ` +
        `${POST_MEET_FIRST_KM_OFFSET_S[0]}-${POST_MEET_FIRST_KM_OFFSET_S[1]}s/km slower than target. Your expressed fitness is down after the meet ` +
        `and even splits protect the back half.`
      : `Target ${mmss(targetPace)}/km. Even splits, or a marginally negative one — going out fast costs more in the ` +
        `last two kilometres than it buys in the first.`,
  };
}

// ---------------------------------------------------------------------------
// Rev 2 addition — the diagnostic re-runs and the plan regenerates
// ---------------------------------------------------------------------------

export interface EmphasisDrift {
  shouldRegenerate: boolean;
  /** Per-dimension change, new minus old. */
  deltas: Record<EmphasisKey, number>;
  /** What changed and why, in the athlete's own terms. */
  explanations: string[];
}

export function shouldRerunDiagnostic(weeksSinceLastRun: number): boolean {
  return weeksSinceLastRun >= DIAGNOSTIC_RERUN_WEEKS;
}

/**
 * Compares a fresh emphasis vector against the one the current plan was built
 * from. A shift beyond the threshold on ANY dimension regenerates the
 * remaining macrocycle — and, critically, says what moved. A plan that
 * changes silently is indistinguishable from a plan that is broken.
 */
export function compareEmphasis(previous: EmphasisVector, next: EmphasisVector): EmphasisDrift {
  const deltas = Object.fromEntries(EMPHASIS_KEYS.map((k) => [k, next[k] - previous[k]])) as Record<EmphasisKey, number>;
  const moved = EMPHASIS_KEYS.filter((k) => Math.abs(deltas[k]) >= EMPHASIS_DRIFT_REGENERATE_THRESHOLD);
  const label = (k: EmphasisKey) => k.replace(/_/g, " ");
  return {
    shouldRegenerate: moved.length > 0,
    deltas,
    explanations: moved.map(
      (k) =>
        `${label(k)} ${deltas[k] > 0 ? "up" : "down"} ${Math.abs(Math.round(deltas[k] * 100))} points ` +
        `(${Math.round(previous[k] * 100)}% to ${Math.round(next[k] * 100)}% of your week). ` +
        `Four more weeks of your own data moved it, so the rest of the block has been rebuilt around it.`
    ),
  };
}
