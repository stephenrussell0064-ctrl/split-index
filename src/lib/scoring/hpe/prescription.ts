/**
 * Hybrid Plan Engine — WP7: prescription resolution.
 *
 * Closes F9 (Major): "Rev A output the string `easy_run`. A plan that does
 * not say how far, how fast, and at what heart rate is not a plan."
 *
 * Every session emits distance, split and heart rate, all resolved from the
 * athlete's OWN data:
 *
 *  - **Distance and duration: both, always.** `9.4km in 45min` beats either
 *    alone.
 *  - **Split:** a band in mm:ss/km derived from the athlete's predicted 5k
 *    pace using their own k, plus per-rep target times for interval sessions.
 *  - **Heart rate:** from the athlete's own HR-vs-pace regression where the
 *    pace falls inside the fitted range; from HR reserve otherwise; ALWAYS
 *    clamped to their measured or estimated max; and the source is stated in
 *    the prescription string so the athlete knows how much to trust it.
 *  - **Easy runs carry an upper HR bound as the primary instruction**,
 *    because the diagnostic's most common finding is easy running done too
 *    hard.
 *  - **Lifts:** load in kg and %1RM, sets, rep range, RIR, plus the variation
 *    where a lift is stalled.
 *  - **Cadence: captured and reported as a trend, never prescribed.** The
 *    evidence for imposing a cadence target is weak, individual optima vary
 *    widely, and a step change in cadence is a plausible injury pathway.
 *    Report it; do not coach it. `cadenceNote` is the only cadence output in
 *    this module and it is descriptive.
 *
 * Where `medicationAffectingHr` is set, HR is dropped entirely and the
 * session is prescribed by pace and RPE — prescribing zones to someone on
 * beta blockers is a straightforward way to produce a useless plan.
 */

import {
  INTERVAL_RECOVERY_S,
  INTERVAL_REPS_MAX,
  INTERVAL_REPS_MIN,
  INTERVAL_REP_METERS,
  INTERVAL_WORK_FRACTION,
  LONG_RUN_VS_EASY_LOW,
  RECOVERY_VS_EASY,
  REP_RUN_METERS,
  REP_RUN_RECOVERY_S,
  REP_RUN_REPS,
  SESSION_HR_RESERVE_BANDS,
  SESSION_PACE_BANDS,
  STALL_VARIATIONS,
  THRESHOLD_BLOCKS_LONG,
  THRESHOLD_BLOCKS_SHORT,
  THRESHOLD_BLOCK_SPLIT_MINUTES,
  THRESHOLD_RECOVERY_S,
  THRESHOLD_WORK_FRACTION,
  WEIGHT_ROUNDING_KG,
} from "./constants";
import { predictHrAtPace } from "./diagnostics";
import type { AthleteProfile, FindingId } from "./types";

export type EnduranceKind = "recovery_run" | "easy_run" | "long_run" | "threshold_run" | "interval_run" | "rep_run";

export function mmss(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function roundToPlate(kg: number): number {
  return Math.round(kg / WEIGHT_ROUNDING_KG) * WEIGHT_ROUNDING_KG;
}

// ---------------------------------------------------------------------------
// Pace bands
// ---------------------------------------------------------------------------

/**
 * The pace band for a session kind. Easy, long and recovery are anchored to
 * the diagnostic's own three-anchor easy band — NOT to a multiple of 5k pace,
 * which is the defect critical implementation note 1 exists to prevent.
 * Quality sessions use the 5k multipliers, which is appropriate: those paces
 * genuinely are defined relative to race pace.
 */
export function paceBandFor(profile: AthleteProfile, kind: EnduranceKind): { lo: number; hi: number } {
  const easy = profile.easyBand;
  if (easy && (kind === "easy_run" || kind === "long_run" || kind === "recovery_run")) {
    if (kind === "recovery_run") return { lo: easy.lo * RECOVERY_VS_EASY[0], hi: easy.hi * RECOVERY_VS_EASY[1] };
    if (kind === "long_run") return { lo: easy.lo * LONG_RUN_VS_EASY_LOW, hi: easy.hi };
    return { lo: easy.lo, hi: easy.hi };
  }
  const base = profile.predicted5kS / 5.0;
  const band = SESSION_PACE_BANDS[kind] ?? SESSION_PACE_BANDS.easy_run;
  return { lo: base * band[0], hi: base * band[1] };
}

// ---------------------------------------------------------------------------
// Heart rate, with its source stated
// ---------------------------------------------------------------------------

export interface HrBand {
  lo: number;
  hi: number;
  /** Stated in the prescription string so the athlete knows how much to trust it. */
  source: string;
}

/**
 * Resolution order, and the reason for it:
 *
 *  1. Easy/long/recovery use the physiological band from HR reserve. The
 *     ceiling must come from HR reserve, never from observed behaviour —
 *     fitting it to how hard the athlete currently runs would launder an
 *     existing bad habit into a prescription.
 *  2. Quality sessions try the athlete's own regression first.
 *  3. Outside the regression's fitted range it REFUSES and falls back to HR
 *     reserve, labelling the fallback honestly.
 *
 * Every path clamps to the athlete's max. There is no path that does not.
 */
export function hrBandFor(profile: AthleteProfile, kind: EnduranceKind, paceBand: { lo: number; hi: number }): HrBand | null {
  const { hrMax, hrRest } = profile;
  const clamp = (v: number) => Math.min(hrMax, Math.max(hrRest, Math.round(v)));

  if (profile.easyBand && (kind === "easy_run" || kind === "long_run" || kind === "recovery_run")) {
    return {
      lo: clamp(profile.easyBand.hrLo),
      hi: clamp(profile.easyBand.hrHi),
      source: "physiological easy band from HR reserve",
    };
  }

  // Rep runs are neuromuscular, not aerobic — heart rate is not the target
  // and pretending otherwise invites the athlete to chase it.
  if (kind === "rep_run") return null;

  const fromModelLo = predictHrAtPace(profile.hrPaceModel, paceBand.hi, hrMax, hrRest);
  const fromModelHi = predictHrAtPace(profile.hrPaceModel, paceBand.lo, hrMax, hrRest);
  if (fromModelLo != null && fromModelHi != null) {
    return {
      lo: clamp(Math.min(fromModelLo, fromModelHi)),
      hi: clamp(Math.max(fromModelLo, fromModelHi)),
      source: "from your own HR-vs-pace data",
    };
  }

  const reserve = SESSION_HR_RESERVE_BANDS[kind] ?? SESSION_HR_RESERVE_BANDS.easy_run;
  return {
    lo: clamp(hrRest + reserve[0] * (hrMax - hrRest)),
    hi: clamp(hrRest + reserve[1] * (hrMax - hrRest)),
    source: "HR reserve — this pace is outside the range your own HR data covers",
  };
}

// ---------------------------------------------------------------------------
// Endurance prescriptions
// ---------------------------------------------------------------------------

export interface EndurancePrescriptionOptions {
  minutes: number;
  /** F15: interval rep count, recovery and target pace progress across the block. See progression.ts. */
  intervalReps?: number;
  intervalRecoveryS?: number;
  thresholdBlockMin?: number;
  /** Overrides the derived pace band — used by the F15 progression to move rep pace from current toward target 5k pace. */
  paceOverride?: { lo: number; hi: number };
  /** Beta blockers and similar: drop HR, prescribe by pace and RPE. */
  suppressHeartRate?: boolean;
  /** Appended verbatim — e.g. the strides that close a long run (F13). */
  extra?: string;
}

export interface Prescription {
  text: string;
  /** Non-negotiable #7: if the engine cannot say WHY this athlete is doing this session, it does not prescribe it. */
  findingId: FindingId;
  /** Present for every endurance session — WP7 requires distance and duration together, always. */
  distanceKm?: number;
  minutes: number;
  paceLoSPerKm?: number;
  paceHiSPerKm?: number;
  hrLo?: number;
  hrHi?: number;
  hrSource?: string;
}

export function prescribeEndurance(
  profile: AthleteProfile,
  kind: EnduranceKind,
  findingId: FindingId,
  options: EndurancePrescriptionOptions
): Prescription {
  const { minutes, suppressHeartRate = false } = options;
  const band = options.paceOverride ?? paceBandFor(profile, kind);
  const mid = (band.lo + band.hi) / 2;
  const hr = suppressHeartRate ? null : hrBandFor(profile, kind, band);

  const hrText = hr
    ? `HR ${hr.lo}-${hr.hi} (${hr.source})`
    : kind === "rep_run"
      ? "Neuromuscular, not aerobic — HR is not the target"
      : "Prescribed by pace and RPE (heart-rate zones are not meaningful on your medication)";

  const paceText = `${mmss(band.lo)}-${mmss(band.hi)}/km`;

  if (kind === "interval_run") {
    const reps = Math.min(
      INTERVAL_REPS_MAX,
      Math.max(INTERVAL_REPS_MIN, options.intervalReps ?? Math.round((minutes * 60 * INTERVAL_WORK_FRACTION) / mid))
    );
    const recovery = options.intervalRecoveryS ?? INTERVAL_RECOVERY_S;
    const repTime = (INTERVAL_REP_METERS / 1000) * mid;
    return {
      text:
        `${reps} x ${INTERVAL_REP_METERS}m in ${mmss(repTime)} each (${paceText}), ${recovery}s jog recovery. ` +
        `${hrText} on the reps. About ${((reps * INTERVAL_REP_METERS) / 1000).toFixed(1)}km of work inside a ` +
        `${Math.round(minutes)}min session.${options.extra ? ` ${options.extra}` : ""}`,
      findingId,
      distanceKm: (reps * INTERVAL_REP_METERS) / 1000,
      minutes,
      paceLoSPerKm: band.lo,
      paceHiSPerKm: band.hi,
      hrLo: hr?.lo,
      hrHi: hr?.hi,
      hrSource: hr?.source,
    };
  }

  if (kind === "threshold_run") {
    const blocks = minutes < THRESHOLD_BLOCK_SPLIT_MINUTES ? THRESHOLD_BLOCKS_SHORT : THRESHOLD_BLOCKS_LONG;
    const perBlockMin = options.thresholdBlockMin ?? (minutes * THRESHOLD_WORK_FRACTION) / blocks;
    const perBlockKm = (perBlockMin * 60) / mid;
    return {
      text:
        `${blocks} x ${perBlockMin.toFixed(0)}min at ${paceText} (about ${perBlockKm.toFixed(1)}km per block), ` +
        `${THRESHOLD_RECOVERY_S / 60}min jog between. ${hrText}. ${Math.round(minutes)}min total including ` +
        `warm-up and cooldown.${options.extra ? ` ${options.extra}` : ""}`,
      findingId,
      distanceKm: blocks * perBlockKm,
      minutes,
      paceLoSPerKm: band.lo,
      paceHiSPerKm: band.hi,
      hrLo: hr?.lo,
      hrHi: hr?.hi,
      hrSource: hr?.source,
    };
  }

  if (kind === "rep_run") {
    return {
      text:
        `${REP_RUN_REPS} x ${REP_RUN_METERS}m in ${mmss(mid * (REP_RUN_METERS / 1000))} each (${paceText}), ` +
        `full ${REP_RUN_RECOVERY_S}s recovery. ${hrText} — run these for turnover and economy, not for effort. ` +
        `${Math.round(minutes)}min including warm-up.${options.extra ? ` ${options.extra}` : ""}`,
      findingId,
      distanceKm: (REP_RUN_REPS * REP_RUN_METERS) / 1000,
      minutes,
      paceLoSPerKm: band.lo,
      paceHiSPerKm: band.hi,
    };
  }

  // Continuous runs — easy, long, recovery.
  const distanceKm = (minutes * 60) / mid;
  const upperBoundLine =
    hr && (kind === "easy_run" || kind === "long_run" || kind === "recovery_run")
      ? ` Do not exceed ${hr.hi} — on easy days the upper bound matters more than the lower one.`
      : "";
  return {
    text:
      `${distanceKm.toFixed(1)}km in ${Math.round(minutes)}min at ${paceText}. ${hrText}.${upperBoundLine}` +
      `${options.extra ? ` ${options.extra}` : ""}`,
    findingId,
    distanceKm,
    minutes,
    paceLoSPerKm: band.lo,
    paceHiSPerKm: band.hi,
    hrLo: hr?.lo,
    hrHi: hr?.hi,
    hrSource: hr?.source,
  };
}

// ---------------------------------------------------------------------------
// Strength prescriptions
// ---------------------------------------------------------------------------

export interface LiftPrescriptionOptions {
  lift: string;
  sets: number;
  reps: readonly [number, number];
  intensity: readonly [number, number];
  rir: readonly [number, number];
  /** Accessory lines appended after the main lift. */
  accessories?: string[];
}

/**
 * A lift prescription in kg AND %1RM. The kg number is what the athlete
 * loads; the percentage is what tells them whether the kg number still makes
 * sense as their 1RM moves. A stalled lift gets its variation named — the
 * variation block is scheduled before returning to the competition lift.
 */
export function prescribeLift(
  profile: AthleteProfile,
  findingId: FindingId,
  options: LiftPrescriptionOptions
): Prescription {
  const { lift, sets, reps, intensity, rir } = options;
  const oneRm = profile.oneRms[lift] ?? 0;
  const stalled = profile.stalledLifts.includes(lift);
  const variation = stalled ? STALL_VARIATIONS[lift] : null;

  const loadText =
    oneRm > 0
      ? `${roundToPlate(oneRm * intensity[0]).toFixed(0)}-${roundToPlate(oneRm * intensity[1]).toFixed(0)}kg ` +
        `(${Math.round(intensity[0] * 100)}-${Math.round(intensity[1] * 100)}% 1RM)`
      : `${Math.round(intensity[0] * 100)}-${Math.round(intensity[1] * 100)}% 1RM (no logged 1RM yet — work to the RIR)`;

  const name = variation ?? lift.charAt(0).toUpperCase() + lift.slice(1);
  const lines = [`${name} ${sets}x${reps[0]}-${reps[1]} @ ${loadText}, RIR ${rir[0]}-${rir[1]}`];
  if (variation) {
    lines.push(
      `${variation} replaces the competition ${lift} this block — your ${lift} has not moved in 12 weeks, and ` +
        `a variation block breaks that before you come back to the lift itself`
    );
  }
  if (options.accessories?.length) lines.push(...options.accessories);

  return { text: lines.join(" · "), findingId, minutes: 0 };
}

// ---------------------------------------------------------------------------
// Cadence — reported, never prescribed
// ---------------------------------------------------------------------------

/**
 * The evidence for imposing a cadence target is weak, individual optima vary
 * widely, and a step change in cadence is a plausible injury pathway. This
 * returns an observation with no instruction attached, and nothing in the
 * engine consumes it as a target.
 */
export function cadenceNote(recentCadenceSpm: number[] | null): string | null {
  if (!recentCadenceSpm || recentCadenceSpm.length < 3) return null;
  const mean = recentCadenceSpm.reduce((s, c) => s + c, 0) / recentCadenceSpm.length;
  const first = recentCadenceSpm.slice(0, Math.ceil(recentCadenceSpm.length / 2));
  const second = recentCadenceSpm.slice(Math.ceil(recentCadenceSpm.length / 2));
  const drift =
    second.reduce((s, c) => s + c, 0) / second.length - first.reduce((s, c) => s + c, 0) / first.length;
  const direction = Math.abs(drift) < 1 ? "steady" : drift > 0 ? "drifting up" : "drifting down";
  return (
    `Cadence is averaging ${Math.round(mean)} spm and ${direction} over your recent runs. ` +
    `Reported for interest only — this plan does not prescribe a cadence target, because individual optima vary ` +
    `widely and changing it deliberately is a more plausible route to injury than to speed.`
  );
}
