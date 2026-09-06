/**
 * Hybrid Plan Engine — shared data model.
 *
 * Deliberately decoupled from the Supabase row shapes: `ingest.ts` maps
 * activities/gym_exercises/profiles into these, so the diagnostic itself is
 * a pure function over plain data and stays testable without a database.
 */

import type { EmphasisKey } from "./constants";

/** One logged cardio session, normalised to the fields the diagnostic actually reads. */
export interface RunLog {
  /** Days since an arbitrary account epoch. Only differences matter. */
  dateIdx: number;
  distanceKm: number;
  durationS: number;
  avgHr?: number | null;
  /** Per-km splits in seconds. Empty when the session has no split detail. */
  splitsSPerKm?: number[];
  /** Per-km average HR, index-aligned with splitsSPerKm. */
  hrByKm?: number[];
  cadenceSpm?: number | null;
  /** Peak instantaneous speed in m/s where the source recorded it (GPS). Feeds the sprint side of anaerobic speed reserve. */
  peakSpeedMs?: number | null;
  /** Race or time trial — either user-tagged or caught by the pace-outlier rule in ingest.ts. */
  isMaxEffort?: boolean;
}

export function paceSPerKm(run: RunLog): number {
  return run.durationS / run.distanceKm;
}

/** One logged working set. */
export interface LiftSet {
  dateIdx: number;
  /** Normalised lift key — "squat" | "bench" | "deadlift" for the competition lifts, raw exercise name otherwise. */
  lift: string;
  loadKg: number;
  reps: number;
  rir?: number | null;
}

/**
 * HR-vs-pace regression: HR = intercept + slope × kph, valid ONLY between
 * loKph and hiKph. Carrying the fitted range with the coefficients is the
 * whole point — critical implementation note 3 in the brief. An unbounded
 * fit extrapolated from easy-run data to interval pace prescribed a heart
 * rate above the athlete's measured maximum.
 */
export interface HrPaceModel {
  intercept: number;
  slope: number;
  loKph: number;
  hiKph: number;
}

/** One anchor's easy-pace band, in seconds per km (lo = faster bound, hi = slower bound). */
export interface EasyAnchor {
  lo: number;
  hi: number;
}

export interface EasyBand {
  /** Prescribed band — the SLOWEST lower bound and slowest upper bound across all anchors. */
  lo: number;
  hi: number;
  candidates: Partial<Record<EasyAnchorName, EasyAnchor>>;
  governing: EasyAnchorName;
  /** Spread between the fastest and slowest anchor's lower bound, s/km. */
  spreadSPerKm: number;
  /** Physiological easy HR band from HR reserve — never from observed behaviour. */
  hrLo: number;
  hrHi: number;
}

export type EasyAnchorName = "5k_multiplier" | "long_effort" | "hr_inverted";

/**
 * A named diagnostic finding. `id` exists for non-negotiable #7: "every
 * session in a generated plan is traceable to a named diagnostic finding. If
 * the engine cannot say *why* this athlete is doing this session, it does not
 * prescribe it." `text` is what the athlete actually reads — brief §0d: those
 * strings are the product.
 */
export interface Finding {
  id: FindingId;
  text: string;
}

export type FindingId =
  | "endurance-limited"
  | "speed-limited"
  | "low-volume"
  | "ample-volume"
  | "poor-decoupling"
  | "easy-anchor-disagreement"
  | "no-easy-runs-logged"
  | "pace-vs-hr-discrepancy"
  | "grey-zone"
  | "no-quality"
  | "low-speed-reserve"
  | "ample-speed-reserve"
  | "under-expressed"
  | "under-built"
  | "weak-lift"
  | "stalled-lift"
  /** Fallback used only for baseline/maintenance work that exists to keep the hybrid balanced rather than to answer a diagnostic finding. */
  | "hybrid-baseline";

export type EmphasisVector = Record<EmphasisKey, number>;

export type DataTier = 0 | 1 | 2 | 3;

export type Predicted5kSource =
  | "maximal_effort"
  | "prediction_engine"
  /** The fallback was slower than a pace the athlete has already sustained past 5km, so it was pulled back to that. */
  | "sustained_pace_bound"
  | "unknown";

export interface AthleteProfile {
  /** Stamped so a plan is never silently attributed to the wrong constants. Non-negotiable #2. */
  constantsVersion: string;
  tier: DataTier;
  /** Per-domain sufficiency. An athlete strong on one side has not failed. */
  aerobicTier: DataTier;
  strengthTier: DataTier;
  confidence: number;

  // --- aerobic ---
  /** Total aerobic volume, running plus cross-training. */
  weeklyVolumeKm: number;
  weeklyVolumeMin: number;
  /** The running-only share. Everything pace-derived is fitted on this alone. */
  runningVolumeKm: number;
  runningVolumeMin: number;
  /**
   * Weekly running minutes across the athlete's ACTIVE span — first logged run
   * to last, ignoring any gap since. `runningVolumeMin` above divides by a
   * window ending today and is therefore the honest answer to "how much are
   * they running now"; this one answers "how much do they run WHEN they run",
   * which is a different question and the right basis for bringing somebody
   * back after a layoff.
   *
   * Both are needed. Reporting the active figure as current volume is what told
   * an athlete who had stopped six weeks ago that they were doing 55min/week;
   * using the current figure as a return-to-training anchor is what pinned them
   * at 4.7 and gave them one run a week for a 5k block.
   */
  activeRunningVolumeMin: number;
  longestRunKm: number;
  /** The athlete's OWN fitted Riegel exponent. Null when they have fewer than RIEGEL_MIN_EFFORTS maximal efforts — the population value is used downstream and labelled as such. */
  riegelK: number | null;
  riegelVerdict: string;
  decoupling: number | null;
  decouplingVerdict: string;
  /** HR-classified where possible, pace-classified as fallback. */
  easyFraction: number | null;
  easyFractionSource: "heart-rate" | "pace" | null;
  easyBand: EasyBand | null;
  intensityVerdict: string;
  /** Actual weekly minutes ÷ typical requirement for this 5k level. 1.0 = adequate. */
  volumeAdequacy: number;
  /** Anaerobic speed reserve in m/s: maximal sprint speed minus maximal aerobic speed. Null when no short maximal effort has been logged — see critical implementation note 0. */
  speedReserveMs: number | null;
  /** The sprint side of that reserve, m/s. Null when never logged. */
  maximalSprintSpeedMs: number | null;
  /** The aerobic side, m/s, from the athlete's own maximal effort and their own k. */
  maximalAerobicSpeedMs: number;
  hrPaceModel: HrPaceModel | null;
  predicted5kS: number;
  /** True when predicted5kS came from a maximal effort rather than a default — nothing is prescribed off a placeholder without saying so. */
  predicted5kFromEffort: boolean;
  /**
   * Where the 5k actually came from. `unknown` means it is a placeholder and
   * must never be displayed or described as a prediction — a distinction
   * `predicted5kFromEffort` alone could not carry once the prediction engine
   * became a second legitimate source.
   */
  predicted5kSource: Predicted5kSource;
  thresholdPaceSPerKm: number;
  vo2maxPaceSPerKm: number;
  hrMax: number;
  hrRest: number;
  /** Whether hrMax was measured from logged sessions or age-estimated (Tanaka). */
  hrMaxSource: "measured" | "estimated";
  runsInsideEasyBand: number;
  qualitySessionCount: number;

  // --- strength ---
  oneRms: Record<string, number>;
  /**
   * Best logged 1RM estimate for EVERY exercise the athlete has trained, keyed
   * by lower-cased exercise name — not just the three competition lifts.
   *
   * `oneRms` collapses a whole gym history onto squat/bench/deadlift, which is
   * all the strength diagnostic reasons about and nowhere near enough to write
   * a session with. A plan led by an incline dumbbell press said "a load you
   * can hold for the reps" to an athlete who had logged that exact exercise
   * thirty times, and every accessory line was a bare set-and-rep scheme with
   * no weight at all — the app knew what they lift and did not say.
   *
   * Optional, and absent means absent: a lookup that misses falls back to the
   * qualitative prescription. Nothing here is ever interpolated from a
   * different exercise, because a number the athlete cannot trace to their own
   * log is worse than no number.
   */
  exerciseOneRms?: Record<string, number>;
  repProfileGap: number | null;
  repProfileVerdict: string;
  weakLift: string | null;
  liftRatios: Record<string, number>;
  stalledLifts: string[];
  /**
   * Whether each strength verdict could be reached at all. Without these,
   * "no weak lift" and "never looked for one" are indistinguishable, and the
   * report was showing the second as the first.
   */
  liftRatiosAssessed: boolean;
  weakLiftAssessed: boolean;
  stallAssessed: boolean;
  /**
   * What stands between this athlete and a stall verdict, in their own
   * numbers, or null once there is one.
   *
   * The report's "Stalled lifts" row could only ever recite the rule it was
   * waiting on — "needs 6+ sets of a lift across 4+ weeks" — which is a
   * labelled slot that never says anything about the person reading it.
   * Optional so a profile deserialised from an older row still renders.
   */
  stallShortfall?: string | null;

  // --- synthesis ---
  limiter: "endurance" | "strength";
  emphasis: EmphasisVector;
  findings: Finding[];
  /** The specific missing data that would unlock the next tier — a data-collection prompt that also happens to be a retention mechanic (brief §0e). */
  dataGaps: string[];
}
