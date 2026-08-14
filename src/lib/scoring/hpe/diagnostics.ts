/**
 * Hybrid Plan Engine — WP0, the Athlete Diagnostic.
 *
 * Port of the normative reference implementation `hpe_diagnostics.py`. This
 * is the module that makes the plan individual: it answers four questions
 * from logged history rather than from a questionnaire.
 *
 *   1. What is this athlete's actual aerobic base?
 *   2. What is their actual strength profile?
 *   3. Which of the two is the limiter, and WITHIN each, what specifically?
 *   4. How confident can we be, given how much data they have?
 *
 * Output is an AthleteProfile carrying an EMPHASIS VECTOR — seven weights
 * summing to 1.0 — which session selection (session-plan.ts) consumes to
 * allocate the week. Two athletes with identical goals and identical
 * availability get different weeks because their emphasis vectors differ.
 *
 * Deliberate deviations from the reference, each one raised rather than
 * silently chosen (the brief's rule is "the reference wins and you raise the
 * discrepancy"; these are cases where following the reference exactly would
 * fail an acceptance criterion the brief states elsewhere, or would produce a
 * plainly wrong string):
 *
 *   D1. Emphasis normalisation. The reference applies the floor and THEN
 *       renormalises, which can push a floored weight back below the floor.
 *       The brief's own property test requires "no weight below the floor"
 *       across 500 randomised histories, which the reference cannot satisfy.
 *       Implemented here as water-filling to a fixed point instead. On any
 *       vector where no weight is at the floor — including the reference
 *       athlete — the two are numerically identical.
 *   D2. The reference rounds each weight to 4dp, which leaves the vector
 *       summing to 1 ± 5e-4. Full precision is kept here and rounding left
 *       to display; well inside the brief's ±0.001 either way.
 *   D3. `intensity_verdict` in the reference reads `(ef or 1) < TARGET`,
 *       which reports an athlete with a measured easy fraction of exactly 0
 *       as "well polarised". Null-checked here.
 *   D4. `speed_reserve` in the reference is `round(v, 4) if v else None`,
 *       which discards a genuine zero. Null-checked here.
 *   D5. Findings carry a stable id as well as the athlete-facing string, so
 *       every prescribed session can name the finding it came from
 *       (non-negotiable #7). The strings themselves are unchanged.
 *
 *   D6. `assess_tier` never reports the history-span gap, so an athlete held
 *       below tier 3 purely by the 12-week requirement — the reference
 *       athlete's own situation — is told nothing about why. Brief §0e is
 *       explicit that the engine must surface the specific gap.
 *   D7. The "no logged run sits inside the easy band" finding is guarded on
 *       there being HR-carrying runs at all. Firing it for an athlete who
 *       simply never records heart rate states a finding about the data as
 *       though it were a finding about the athlete.
 *
 * `speed_reserve` REBUILT per critical implementation note 0. The Rev 2
 * reference computed it from threshold_pace and vo2_pace, both fixed
 * multiples of predicted 5k pace, so it evaluated to 0.1146 for every athlete
 * and its finding and multipliers fired universally — inflating
 * `neuromuscular` on the reference athlete from 0.077 to 0.116 and pulling
 * `aerobic_base` down from 0.532 to 0.500, taking emphasis away from exactly
 * the quality that athlete was diagnosed as lacking. It is now genuine
 * anaerobic speed reserve: maximal sprint speed minus maximal aerobic speed,
 * in m/s, and null where no short maximal effort has been logged. See
 * `anaerobicSpeedReserveMs`.
 */

import {
  DECOUPLING_GOOD,
  DECOUPLING_MIN_KM,
  DECOUPLING_MIN_SPLITS,
  DECOUPLING_POOR,
  DEFAULT_GOAL_PRIORITY,
  EASY_ANCHOR_DISAGREEMENT_FLAG,
  EASY_FRACTION_TARGET,
  EASY_HR_FRACTION_HRR,
  EMPHASIS_FLOOR,
  EMPHASIS_KEYS,
  EMPHASIS_MULTIPLIERS,
  ENDURANCE_EMPHASIS_KEYS,
  EPLEY_DIVISOR,
  FIVE_K_TO_EASY,
  HPE_CONSTANTS_VERSION,
  HR_INTENSITY_MIN_RUNS,
  HR_PACE_MODEL_MIN_POINTS,
  HR_PACE_MODEL_RANGE_TOLERANCE_HIGH,
  HR_PACE_MODEL_RANGE_TOLERANCE_LOW,
  LIFT_RATIO_NORM,
  LIFT_RATIO_TOLERANCE,
  LONG_EFFORT_ANCHOR_S,
  LONG_EFFORT_TO_EASY,
  NO_QUALITY_MIN_RUNS,
  PACE_VS_HR_DISCREPANCY_FLAG,
  PRIORITY_TILT_SCALE,
  QUALITY_PACE_CUTOFF_MULTIPLIER,
  REP_PROFILE_HIGH_REPS,
  REP_PROFILE_LOW_MAX_REPS,
  REP_PROFILE_MIN_SETS_PER_END,
  REP_PROFILE_NEURAL_GAP,
  RIEGEL_K_DEFAULT,
  RIEGEL_K_ENDURANCE_STRONG,
  RIEGEL_K_ENDURANCE_WEAK,
  RIEGEL_MIN_EFFORTS,
  RIEGEL_MIN_EFFORT_KM,
  SHORT_MAX_EFFORT_MAX_KM,
  SHORT_MAX_EFFORT_MIN_KM,
  SPEED_RESERVE_HIGH_MS,
  SPEED_RESERVE_LOW_MS,
  STALL_LOOKBACK_WEEKS,
  STALL_MIN_SETS,
  STALL_MIN_SPAN_WEEKS,
  STALL_THRESHOLD_KG_PER_WEEK,
  THRESHOLD_PACE_MULTIPLIER,
  TIER_CONFIDENCE,
  TIER_REQUIREMENTS,
  VOLUME_ADEQUACY_HIGH,
  VOLUME_ADEQUACY_LOW,
  VOLUME_ADEQUACY_MIN_PER_WEEK,
  VO2MAX_PACE_MULTIPLIER,
  type EmphasisKey,
} from "./constants";
import {
  paceSPerKm,
  type AthleteProfile,
  type DataTier,
  type EasyAnchor,
  type EasyAnchorName,
  type EasyBand,
  type EmphasisVector,
  type Finding,
  type HrPaceModel,
  type LiftSet,
  type RunLog,
} from "./types";

// ---------------------------------------------------------------------------
// Small numeric helpers (kept local — none of these are training-logic
// constants, so they don't belong in constants.ts)
// ---------------------------------------------------------------------------

function mean(xs: number[]): number {
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

/** Ordinary least squares slope + intercept of y on x. Null when x has no spread. */
function linearFit(xs: number[], ys: number[]): { intercept: number; slope: number } | null {
  const n = xs.length;
  if (n === 0) return null;
  const mx = mean(xs);
  const my = mean(ys);
  const den = xs.reduce((s, x) => s + (x - mx) ** 2, 0);
  if (den === 0) return null;
  const slope = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0) / den;
  return { intercept: my - slope * mx, slope };
}

function mmss(seconds: number): string {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const pct = (x: number, dp = 0) => `${(x * 100).toFixed(dp)}%`;

// ---------------------------------------------------------------------------
// Aerobic diagnostics
// ---------------------------------------------------------------------------

/**
 * Fit the athlete's OWN fatigue-resistance exponent from maximal efforts.
 * The live prediction engine uses a population k; using the athlete's own k
 * is the difference between a prediction and a diagnosis — brief §0b calls
 * this "the single highest-value derived metric in the module".
 *
 * log-log regression: ln(T) = ln(a) + k · ln(D).
 */
export function fitRiegelK(runs: RunLog[]): number | null {
  const efforts = runs.filter((r) => r.isMaxEffort && r.distanceKm >= RIEGEL_MIN_EFFORT_KM);
  if (efforts.length < RIEGEL_MIN_EFFORTS) return null;
  const fit = linearFit(
    efforts.map((r) => Math.log(r.distanceKm)),
    efforts.map((r) => Math.log(r.durationS))
  );
  // No spread in distance means every effort was at the same distance — two
  // 5k times say nothing about how this athlete fades as distance rises.
  return fit ? fit.slope : null;
}

/**
 * Pace:HR ratio, second half versus first half of a long continuous run.
 * Rising drift means the aerobic base does not yet support the duration.
 */
export function aerobicDecoupling(run: RunLog): number | null {
  const splits = run.splitsSPerKm ?? [];
  const hrs = run.hrByKm ?? [];
  if (splits.length === 0 || hrs.length === 0) return null;
  const n = Math.min(splits.length, hrs.length);
  if (n < DECOUPLING_MIN_SPLITS) return null;
  const half = Math.floor(n / 2);
  const efficiency = (from: number, to: number) => {
    const vals: number[] = [];
    for (let i = from; i < to; i++) {
      if (hrs[i] > 0 && splits[i] > 0) vals.push(1000 / splits[i] / hrs[i]);
    }
    return vals.length > 0 ? mean(vals) : null;
  };
  const first = efficiency(0, half);
  const second = efficiency(half, n);
  if (first == null || second == null || first === 0) return null;
  return (first - second) / first;
}

/**
 * Regress the athlete's OWN heart rate against speed on submaximal runs.
 * "Zone 2 = 60-72% HRR" is generic; "at 5:05/km your HR should read 148-156"
 * is individual, and this is how you get there. The fitted speed range is
 * carried with the coefficients because the model is only valid inside it.
 */
export function fitHrPaceModel(runs: RunLog[]): HrPaceModel | null {
  const pts = runs
    .filter((r) => r.avgHr != null && r.avgHr > 0 && !r.isMaxEffort && r.durationS > 0 && r.distanceKm > 0)
    .map((r) => ({ kph: r.distanceKm / (r.durationS / 3600), hr: r.avgHr as number }));
  if (pts.length < HR_PACE_MODEL_MIN_POINTS) return null;
  const xs = pts.map((p) => p.kph);
  const fit = linearFit(xs, pts.map((p) => p.hr));
  if (!fit) return null;
  return { intercept: fit.intercept, slope: fit.slope, loKph: Math.min(...xs), hiKph: Math.max(...xs) };
}

/**
 * Returns null outside the fitted speed range. The HR-speed relationship is
 * linear only across the submaximal range it was fitted on; extrapolating it
 * to interval pace produced a prescription above one athlete's measured
 * maximum heart rate, which is the same class of error as an unbounded
 * extrapolation anywhere else. Refuse rather than guess.
 */
export function predictHrAtPace(
  model: HrPaceModel | null,
  paceSPerKmValue: number,
  hrMax: number,
  hrRest: number
): number | null {
  if (!model || paceSPerKmValue <= 0) return null;
  const kph = 3600 / paceSPerKmValue;
  if (kph < model.loKph * HR_PACE_MODEL_RANGE_TOLERANCE_LOW) return null;
  if (kph > model.hiKph * HR_PACE_MODEL_RANGE_TOLERANCE_HIGH) return null;
  const raw = model.intercept + model.slope * kph;
  return Math.round(Math.min(hrMax, Math.max(hrRest, raw)));
}

/** Fraction of logged running TIME spent slower than the easy-pace cutoff. Pace-based — the fallback, not the primary. */
export function paceIntensityDistribution(runs: RunLog[], easyPaceCutoff: number): number | null {
  if (runs.length === 0) return null;
  const total = runs.reduce((s, r) => s + r.durationS, 0);
  if (total === 0) return null;
  const easy = runs.filter((r) => paceSPerKm(r) >= easyPaceCutoff).reduce((s, r) => s + r.durationS, 0);
  return easy / total;
}

/**
 * Classify intensity by HEART RATE first, pace second. Critical
 * implementation note 2: classifying by pace alone reported the reference
 * athlete as 100% easy and "well polarised" while their logged heart rates
 * put only 31% of running inside the easy band. Pace-based classification
 * cannot see the grey zone; that is the whole reason the grey zone persists.
 */
export function hrIntensityDistribution(runs: RunLog[], hrMax: number, hrRest: number): number | null {
  const scored = runs.filter((r) => r.avgHr != null && r.avgHr > 0 && !r.isMaxEffort);
  if (scored.length < HR_INTENSITY_MIN_RUNS) return null;
  const ceiling = easyHrCeiling(hrMax, hrRest);
  const total = scored.reduce((s, r) => s + r.durationS, 0);
  if (total === 0) return null;
  const easy = scored.filter((r) => (r.avgHr as number) <= ceiling).reduce((s, r) => s + r.durationS, 0);
  return easy / total;
}

/** The physiological easy HR ceiling. From HR reserve, never from observed behaviour. */
export function easyHrCeiling(hrMax: number, hrRest: number): number {
  return hrRest + EASY_HR_FRACTION_HRR[1] * (hrMax - hrRest);
}

export function loggedRunsInsideEasyBand(runs: RunLog[], hrMax: number, hrRest: number): number {
  const ceiling = easyHrCeiling(hrMax, hrRest);
  return runs.filter((r) => r.avgHr != null && r.avgHr > 0 && !r.isMaxEffort && (r.avgHr as number) <= ceiling).length;
}

/**
 * Maximal sprint speed in m/s, from the fastest logged SHORT maximal effort —
 * a flat-out 200m or 400m — or from peak GPS speed where a track records it.
 * Returns null when the athlete has never logged one, which is the common
 * case and the point: this is independent data, not something derivable from
 * their 5k.
 *
 * Note the distance window deliberately does not overlap the one `fitRiegelK`
 * uses (>= 1km). A 400m time trial is a different physiological test, not a
 * point on the same fatigue curve, so it informs speed reserve and never k.
 */
export function maximalSprintSpeedMs(runs: RunLog[]): number | null {
  const candidates: number[] = [];
  for (const r of runs) {
    if (r.peakSpeedMs != null && r.peakSpeedMs > 0) candidates.push(r.peakSpeedMs);
    if (
      r.isMaxEffort &&
      r.distanceKm >= SHORT_MAX_EFFORT_MIN_KM &&
      r.distanceKm <= SHORT_MAX_EFFORT_MAX_KM &&
      r.durationS > 0
    ) {
      candidates.push((r.distanceKm * 1000) / r.durationS);
    }
  }
  return candidates.length > 0 ? Math.max(...candidates) : null;
}

/**
 * Anaerobic speed reserve: maximal sprint speed − maximal aerobic speed, in
 * m/s. Null when no short maximal effort exists in the history — the finding
 * does not fire, no multiplier is applied, and the gap becomes an unlock
 * prompt instead. Third application of the same rule as the bounded
 * bodyweight frontier and the bounded HR regression: bound every derived
 * metric to the data that supports it, or refuse to derive it.
 */
export function anaerobicSpeedReserveMs(
  sprintSpeedMs: number | null,
  maximalAerobicSpeedMs: number
): number | null {
  if (sprintSpeedMs == null || !Number.isFinite(sprintSpeedMs) || maximalAerobicSpeedMs <= 0) return null;
  // A "sprint" slower than the athlete's own maximal aerobic speed is not a
  // sprint — it is a mislabelled effort, and reporting a negative reserve off
  // it would be worse than reporting nothing.
  const reserve = sprintSpeedMs - maximalAerobicSpeedMs;
  return reserve > 0 ? reserve : null;
}

/**
 * Placeholder 5k used ONLY when the athlete has logged no maximal effort at
 * all. It is not a prediction and must never be presented as one — every
 * consumer has to branch on `AthleteProfile.predicted5kFromEffort` first.
 * Named rather than inlined because a bare `1500` reaching a screen is
 * indistinguishable from a real 25:00 prediction, which is exactly how it
 * shipped.
 */
export const NO_MAXIMAL_EFFORT_5K_S = 1500.0;

/** Actual weekly minutes ÷ the minutes historically associated with supporting this 5k level. */
export function volumeAdequacy(weeklyMin: number, predicted5kS: number): number {
  const table = [...VOLUME_ADEQUACY_MIN_PER_WEEK].sort((a, b) => a[0] - b[0]);
  let required = table[table.length - 1][1];
  for (const [seconds, minutes] of table) {
    if (predicted5kS <= seconds) {
      required = minutes;
      break;
    }
  }
  return required > 0 ? weeklyMin / required : 1.0;
}

/**
 * Easy pace must NOT be derived from 5k pace alone.
 *
 * The standard multiplier (5k pace × 1.24-1.34) assumes the 5k time is
 * supported by a matching aerobic base. For an athlete whose own diagnostic
 * says it is not — high fatigue-resistance exponent, low volume adequacy —
 * that assumption inflates easy pace by 25-35 s/km, which is exactly the
 * grey-zone error the diagnostic elsewhere warns about.
 *
 * Three independent anchors are computed and the SLOWEST is prescribed.
 */
export function easyPaceBand(
  predicted5kS: number,
  k: number,
  hrModel: HrPaceModel | null,
  hrMax: number,
  hrRest: number
): EasyBand {
  const candidates: Partial<Record<EasyAnchorName, EasyAnchor>> = {};

  const p5 = predicted5kS / 5.0;
  candidates["5k_multiplier"] = { lo: p5 * FIVE_K_TO_EASY[0], hi: p5 * FIVE_K_TO_EASY[1] };

  // Anchor on a long maximal effort derived with the athlete's OWN k:
  // T = a · D^k, solved for the distance they could cover in 90 minutes.
  const a = predicted5kS / Math.pow(5.0, k);
  const dLong = Math.pow(LONG_EFFORT_ANCHOR_S / a, 1 / k);
  const pLong = LONG_EFFORT_ANCHOR_S / dLong;
  candidates.long_effort = { lo: pLong * LONG_EFFORT_TO_EASY[0], hi: pLong * LONG_EFFORT_TO_EASY[1] };

  // Anchor on a PHYSIOLOGICAL heart-rate ceiling, inverted through the
  // athlete's own HR-pace regression. The ceiling comes from HR reserve —
  // fitting it to how hard they currently run would launder an existing bad
  // habit into a prescription.
  const hrr = hrMax - hrRest;
  const hrLo = Math.round(hrRest + EASY_HR_FRACTION_HRR[0] * hrr);
  const hrHi = Math.round(hrRest + EASY_HR_FRACTION_HRR[1] * hrr);
  if (hrModel && hrModel.slope > 0) {
    const loKph = (hrLo - hrModel.intercept) / hrModel.slope;
    const hiKph = (hrHi - hrModel.intercept) / hrModel.slope;
    if (loKph > 0 && hiKph > 0) {
      candidates.hr_inverted = { lo: 3600 / hiKph, hi: 3600 / loKph };
    }
  }

  const entries = Object.entries(candidates) as [EasyAnchorName, EasyAnchor][];
  const los = entries.map(([, c]) => c.lo);
  const lo = Math.max(...los);
  const hi = Math.max(...entries.map(([, c]) => c.hi));
  const spreadSPerKm = Math.max(...los) - Math.min(...los);
  // The slowest lower bound governs — Object.entries preserves insertion
  // order, so ties resolve to the earlier-inserted anchor exactly as the
  // reference's max() does.
  let governing: EasyAnchorName = entries[0][0];
  for (const [name, c] of entries) {
    if (c.lo > candidates[governing]!.lo) governing = name;
  }

  return { lo, hi, candidates, governing, spreadSPerKm, hrLo, hrHi };
}

// ---------------------------------------------------------------------------
// Strength diagnostics
// ---------------------------------------------------------------------------

export function epleyE1rm(loadKg: number, reps: number): number {
  return loadKg * (1 + reps / EPLEY_DIVISOR);
}

/**
 * Compare the e1RM implied by high-rep sets against the e1RM implied by
 * low-rep sets. If the high-rep sets imply a HIGHER max, the athlete has the
 * muscle but not the neural expression — they need heavy singles, not more
 * volume. If lower, they are neurally efficient but under-built.
 */
export function repProfileGap(sets: LiftSet[], lift: string): number | null {
  const forLift = sets.filter((s) => s.lift === lift);
  const low = forLift.filter((s) => s.reps <= REP_PROFILE_LOW_MAX_REPS).map((s) => epleyE1rm(s.loadKg, s.reps));
  const high = forLift
    .filter((s) => s.reps >= REP_PROFILE_HIGH_REPS[0] && s.reps <= REP_PROFILE_HIGH_REPS[1])
    .map((s) => epleyE1rm(s.loadKg, s.reps));
  if (low.length < REP_PROFILE_MIN_SETS_PER_END || high.length < REP_PROFILE_MIN_SETS_PER_END) return null;
  const topN = (xs: number[]) => mean([...xs].sort((a, b) => a - b).slice(-REP_PROFILE_MIN_SETS_PER_END));
  const lowMean = topN(low);
  const highMean = topN(high);
  return lowMean !== 0 ? (highMean - lowMean) / lowMean : null;
}

export function liftRatios(oneRms: Record<string, number>): Record<string, number> {
  const squat = oneRms.squat ?? 0;
  if (!squat) return {};
  const out: Record<string, number> = {};
  for (const [lift, value] of Object.entries(oneRms)) out[lift] = Math.round((value / squat) * 1000) / 1000;
  return out;
}

/**
 * Whether the strength side could be assessed at all.
 *
 * `findWeakLift` returning null and `stalledLifts` returning [] each mean two
 * completely different things — "assessed, nothing wrong" and "never
 * assessed" — and the report was rendering both as "none flagged". That is
 * the same falsy-zero mistake as the discarded genuine zero in D4, and it is
 * worse here because it tells an athlete their lifts are balanced when the
 * engine has never seen a lift.
 */
export function strengthAssessability(
  oneRms: Record<string, number>,
  sets: LiftSet[]
): { ratiosAssessed: boolean; weakLiftAssessed: boolean; stallAssessed: boolean } {
  const hasSquat = (oneRms.squat ?? 0) > 0;
  const otherLifts = Object.keys(oneRms).filter((l) => l !== "squat" && (oneRms[l] ?? 0) > 0);
  // Stalling needs enough sets of one lift, spanning enough weeks, to have a
  // trend at all — the same bar `stalledLifts` itself applies.
  const stallAssessed = Object.keys(LIFT_RATIO_NORM).some((lift) => {
    const pts = sets.filter((x) => x.lift === lift);
    if (pts.length < STALL_MIN_SETS) return false;
    const dates = pts.map((x) => x.dateIdx);
    return (Math.max(...dates) - Math.min(...dates)) / 7 >= STALL_MIN_SPAN_WEEKS;
  });
  return {
    ratiosAssessed: hasSquat && otherLifts.length > 0,
    weakLiftAssessed: hasSquat && otherLifts.length > 0,
    stallAssessed,
  };
}

export function findWeakLift(ratios: Record<string, number>): string | null {
  let worst: string | null = null;
  let worstGap = 0;
  for (const [lift, norm] of Object.entries(LIFT_RATIO_NORM)) {
    if (lift === "squat" || ratios[lift] == null) continue;
    const gap = (norm - ratios[lift]) / norm;
    if (gap > LIFT_RATIO_TOLERANCE && gap > worstGap) {
      worst = lift;
      worstGap = gap;
    }
  }
  return worst;
}

/** Lifts whose e1RM trend over the lookback window is below the stall threshold. A stalled lift gets a variation block before returning to the competition lift. */
export function stalledLifts(sets: LiftSet[]): string[] {
  const out: string[] = [];
  for (const lift of Object.keys(LIFT_RATIO_NORM)) {
    const pts = sets
      .filter((s) => s.lift === lift)
      .map((s) => ({ dateIdx: s.dateIdx, e1rm: epleyE1rm(s.loadKg, s.reps) }))
      .sort((a, b) => a.dateIdx - b.dateIdx || a.e1rm - b.e1rm);
    if (pts.length < STALL_MIN_SETS) continue;
    const spanWeeks = (pts[pts.length - 1].dateIdx - pts[0].dateIdx) / 7;
    if (spanWeeks < STALL_MIN_SPAN_WEEKS) continue;
    const early = mean(pts.slice(0, 3).map((p) => p.e1rm));
    const late = mean(pts.slice(-3).map((p) => p.e1rm));
    if ((late - early) / spanWeeks < STALL_THRESHOLD_KG_PER_WEEK) out.push(lift);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Synthesis — the emphasis vector
// ---------------------------------------------------------------------------

/** Everything derive_emphasis needs, assembled by `diagnose` below. */
export interface EmphasisInputs {
  riegelK: number | null;
  volumeAdequacy: number | null;
  decoupling: number | null;
  easyBand: EasyBand | null;
  runsInsideEasyBand: number;
  /** How many submaximal runs carry a heart rate at all — distinguishes 'never runs easy' from 'never logs HR'. */
  runsWithHr: number;
  easyFractionByPace: number | null;
  easyFractionByHr: number | null;
  easyFraction: number | null;
  noQuality: boolean;
  /** Anaerobic speed reserve in m/s. Null when no short maximal effort has been logged. */
  speedReserveMs: number | null;
  repProfileGap: number | null;
  weakLift: string | null;
  liftRatios: Record<string, number>;
  stalledLifts: string[];
}

function applyMultipliers(
  weights: Record<EmphasisKey, number>,
  multipliers: Partial<Record<EmphasisKey, number>>
): void {
  for (const [key, factor] of Object.entries(multipliers) as [EmphasisKey, number][]) {
    weights[key] *= factor;
  }
}

/**
 * Normalise to sum 1 while guaranteeing no weight sits below the floor.
 *
 * Deviation D1 (see the module header): the reference floors and then
 * renormalises in one pass, which can push a floored weight back under the
 * floor and fail the brief's own property test. Water-filling instead —
 * pin everything at or below the floor, share what's left proportionally
 * among the rest, repeat until nothing new gets pinned. Identical output to
 * the reference on any vector where the floor never binds.
 */
export function normaliseEmphasis(raw: Record<EmphasisKey, number>): EmphasisVector {
  const keys = [...EMPHASIS_KEYS];
  const floor = Math.min(EMPHASIS_FLOOR, 1 / keys.length);
  const positive = keys.map((k) => Math.max(0, raw[k]));
  const total = positive.reduce((s, v) => s + v, 0);
  const start = total > 0 ? positive.map((v) => v / total) : keys.map(() => 1 / keys.length);

  const pinned = new Set<number>();
  const result = [...start];
  // At most one pass per key: each iteration pins at least one new index or
  // terminates, so this cannot spin.
  for (let guard = 0; guard < keys.length; guard++) {
    const below = result.map((v, i) => ({ v, i })).filter(({ v, i }) => !pinned.has(i) && v < floor);
    if (below.length === 0) break;
    for (const { i } of below) {
      result[i] = floor;
      pinned.add(i);
    }
    const budget = 1 - floor * pinned.size;
    const freeIdx = keys.map((_, i) => i).filter((i) => !pinned.has(i));
    if (freeIdx.length === 0) break;
    const freeTotal = freeIdx.reduce((s, i) => s + result[i], 0);
    for (const i of freeIdx) {
      result[i] = freeTotal > 0 ? (result[i] / freeTotal) * budget : budget / freeIdx.length;
    }
  }

  // Final exact renormalisation across the unpinned weights only, so the
  // vector sums to 1 without disturbing anything sitting at the floor.
  const sum = result.reduce((s, v) => s + v, 0);
  if (Math.abs(sum - 1) > 1e-12) {
    const freeIdx = keys.map((_, i) => i).filter((i) => !pinned.has(i));
    const drift = sum - 1;
    const freeTotal = freeIdx.reduce((s, i) => s + result[i], 0);
    if (freeIdx.length > 0 && freeTotal > drift) {
      for (const i of freeIdx) result[i] -= (result[i] / freeTotal) * drift;
    } else {
      for (let i = 0; i < result.length; i++) result[i] /= sum;
    }
  }

  return Object.fromEntries(keys.map((k, i) => [k, result[i]])) as EmphasisVector;
}

/**
 * Map diagnostic findings onto the seven emphasis weights. Each rule is a
 * named, traceable adjustment — this is the function that must be
 * explainable to the athlete session by session, so every multiplier applied
 * here emits a finding and every finding carries an id a session can cite.
 *
 * `priority` is the goal tilt: 0 = pure endurance, 1 = pure strength.
 */
export function deriveEmphasis(
  p: EmphasisInputs,
  priority: number = DEFAULT_GOAL_PRIORITY
): { emphasis: EmphasisVector; findings: Finding[] } {
  const w = Object.fromEntries(EMPHASIS_KEYS.map((k) => [k, 1.0])) as Record<EmphasisKey, number>;
  const findings: Finding[] = [];

  // --- endurance side ------------------------------------------------------
  const k = p.riegelK;
  if (k != null) {
    if (k > RIEGEL_K_ENDURANCE_WEAK) {
      applyMultipliers(w, EMPHASIS_MULTIPLIERS.enduranceLimited);
      findings.push({
        id: "endurance-limited",
        text:
          `Fatigue-resistance exponent k=${k.toFixed(3)} vs population ${RIEGEL_K_DEFAULT}. ` +
          `This athlete fades faster than typical as distance rises: speed is ` +
          `comparatively strong, aerobic endurance is the limiter. Emphasis ` +
          `shifts to easy volume and threshold, away from short intervals.`,
      });
    } else if (k < RIEGEL_K_ENDURANCE_STRONG) {
      applyMultipliers(w, EMPHASIS_MULTIPLIERS.speedLimited);
      findings.push({
        id: "speed-limited",
        text:
          `k=${k.toFixed(3)} indicates strong fatigue resistance. Top-end speed is the ` +
          `limiter, not endurance. Emphasis shifts to vVO2max intervals and ` +
          `neuromuscular work.`,
      });
    }
  }

  const va = p.volumeAdequacy;
  if (va != null && va < VOLUME_ADEQUACY_LOW) {
    applyMultipliers(w, EMPHASIS_MULTIPLIERS.lowVolume);
    findings.push({
      id: "low-volume",
      text:
        `Weekly running volume is ${pct(va)} of what typically supports this 5k ` +
        `level. Volume, not intensity, is the highest-return lever. The on-ramp ` +
        `is the binding constraint on how fast this can be corrected.`,
    });
  } else if (va != null && va > VOLUME_ADEQUACY_HIGH) {
    applyMultipliers(w, EMPHASIS_MULTIPLIERS.ampleVolume);
    findings.push({
      id: "ample-volume",
      text:
        `Volume is ${pct(va)} of the typical requirement - ample. Returns now come ` +
        `from intensity quality rather than more easy miles.`,
    });
  }

  const dec = p.decoupling;
  if (dec != null && dec > DECOUPLING_POOR) {
    applyMultipliers(w, EMPHASIS_MULTIPLIERS.poorDecoupling);
    findings.push({
      id: "poor-decoupling",
      text:
        `Aerobic decoupling ${pct(dec, 1)} on long runs (>${pct(DECOUPLING_POOR)}). The ` +
        `base does not yet support the duration being attempted; long-run length ` +
        `is capped and progressed more slowly than the general ramp.`,
    });
  }

  const eb = p.easyBand;
  if (eb && eb.spreadSPerKm > EASY_ANCHOR_DISAGREEMENT_FLAG) {
    applyMultipliers(w, EMPHASIS_MULTIPLIERS.easyAnchorDisagreement);
    const c = eb.candidates;
    const five = c["5k_multiplier"];
    const long = c.long_effort;
    const inverted = c.hr_inverted;
    findings.push({
      id: "easy-anchor-disagreement",
      text:
        `Easy-pace anchors disagree by ${eb.spreadSPerKm.toFixed(0)}s/km. The 5k ` +
        (five ? `multiplier suggests ${mmss(five.lo)}-${mmss(five.hi)}, ` : `multiplier is unavailable, `) +
        `but anchoring on a long maximal effort using this athlete's own k gives ` +
        (long ? `${mmss(long.lo)}-${mmss(long.hi)}` : "no usable band") +
        (inverted
          ? ` and inverting their own HR-pace regression at an easy heart rate ` +
            `gives ${mmss(inverted.lo)}-${mmss(inverted.hi)}`
          : "") +
        `. The slowest anchor governs (${eb.governing}). A 5k time not yet ` +
        `supported by aerobic volume makes the 5k multiplier the least ` +
        `trustworthy of the three.`,
    });
  }

  // Guarded on there being HR-carrying runs at all: an athlete with no logged
  // heart rate has not been shown to run their easy days too hard, they have
  // simply not been measured, and saying otherwise would be a finding about
  // the data dressed up as a finding about the athlete.
  if (p.runsInsideEasyBand === 0 && p.runsWithHr > 0) {
    applyMultipliers(w, EMPHASIS_MULTIPLIERS.noEasyRunsLogged);
    findings.push({
      id: "no-easy-runs-logged",
      text:
        "No logged run sits inside the physiological easy heart-rate band. Easy " +
        "pace cannot be confirmed from this athlete's own data because they have " +
        "never run one - the HR-pace model is fitted entirely on moderate-effort " +
        "running. The prescribed easy pace will feel implausibly slow and should " +
        "be held anyway for four weeks before being re-derived.",
    });
  }

  if (
    p.easyFractionByPace != null &&
    p.easyFractionByHr != null &&
    p.easyFractionByPace - p.easyFractionByHr > PACE_VS_HR_DISCREPANCY_FLAG
  ) {
    // Emits a finding without a multiplier on purpose: the grey-zone
    // multiplier below already acts on the same underlying problem, and
    // double-counting it would over-weight aerobic_base. This string exists
    // because naming the discrepancy is what makes the plan defensible.
    findings.push({
      id: "pace-vs-hr-discrepancy",
      text:
        `Classified by pace, ${pct(p.easyFractionByPace)} of running looks easy; classified ` +
        `by heart rate, only ${pct(p.easyFractionByHr)} is. The paces are fine and the ` +
        `efforts are not - this is the grey zone, and pace-based classification ` +
        `cannot see it.`,
    });
  }

  const ef = p.easyFraction;
  if (ef != null && ef < EASY_FRACTION_TARGET) {
    applyMultipliers(w, EMPHASIS_MULTIPLIERS.greyZone);
    findings.push({
      id: "grey-zone",
      text:
        `Only ${pct(ef)} of logged running time is genuinely easy (target ` +
        `${pct(EASY_FRACTION_TARGET)}). Classic grey-zone pattern: easy runs too ` +
        `hard, hard runs not hard enough. Easy paces are prescribed explicitly ` +
        `with an upper bound, not just a lower one.`,
    });
  }

  if (p.noQuality) {
    applyMultipliers(w, EMPHASIS_MULTIPLIERS.noQuality);
    findings.push({
      id: "no-quality",
      text:
        "No structured quality sessions appear anywhere in the logged history - " +
        "every training run is easy. Easy running is the right base, but with " +
        "zero threshold or interval exposure there is a large, cheap gain " +
        "available. Quality is introduced gradually alongside the volume ramp, " +
        "not instead of it.",
    });
  }

  // Anaerobic speed reserve. Null — no logged short maximal effort — fires
  // nothing at all: no finding, no multiplier. An athlete who has never
  // sprinted has not been diagnosed as slow, they have simply not been
  // measured, and the two must not look the same in the output.
  const sr = p.speedReserveMs;
  if (sr != null && sr < SPEED_RESERVE_LOW_MS) {
    applyMultipliers(w, EMPHASIS_MULTIPLIERS.lowSpeedReserve);
    findings.push({
      id: "low-speed-reserve",
      text:
        `Anaerobic speed reserve is ${sr.toFixed(1)} m/s - your flat-out sprint speed sits close to your ` +
        `maximal aerobic speed, so there is little neuromuscular headroom above race pace. Strides, hills ` +
        `and short reps are added to raise the ceiling your endurance work is pushing against.`,
    });
  } else if (sr != null && sr > SPEED_RESERVE_HIGH_MS) {
    applyMultipliers(w, EMPHASIS_MULTIPLIERS.ampleSpeedReserve);
    findings.push({
      id: "ample-speed-reserve",
      text:
        `Anaerobic speed reserve is ${sr.toFixed(1)} m/s - a wide gap between your sprint speed and your ` +
        `maximal aerobic speed. Top-end speed is not your limiter, so neuromuscular work is trimmed back to ` +
        `maintenance and the time goes to the aerobic side instead.`,
    });
  }

  // --- strength side -------------------------------------------------------
  const gap = p.repProfileGap;
  if (gap != null) {
    if (gap > REP_PROFILE_NEURAL_GAP) {
      applyMultipliers(w, EMPHASIS_MULTIPLIERS.underExpressed);
      findings.push({
        id: "under-expressed",
        text:
          `High-rep sets imply an e1RM ${gap >= 0 ? "+" : ""}${pct(gap, 1)} above what low-rep sets ` +
          `imply. The muscle is there; the neural expression is not. ` +
          `Prescription shifts to heavy singles, doubles and triples at ` +
          `>=85% 1RM rather than more hypertrophy volume.`,
      });
    } else if (gap < -REP_PROFILE_NEURAL_GAP) {
      applyMultipliers(w, EMPHASIS_MULTIPLIERS.underBuilt);
      findings.push({
        id: "under-built",
        text:
          `Low-rep sets imply an e1RM ${pct(-gap, 1)} above high-rep sets. Neurally ` +
          `efficient but under-built - the athlete expresses more than they ` +
          `carry. Prescription shifts to 6-12 rep accumulation work.`,
      });
    }
  }

  const wl = p.weakLift;
  if (wl) {
    applyMultipliers(w, EMPHASIS_MULTIPLIERS.weakLift);
    const ratio = p.liftRatios[wl];
    findings.push({
      id: "weak-lift",
      text:
        `${wl.charAt(0).toUpperCase()}${wl.slice(1)} sits at ${ratio?.toFixed(2) ?? "?"}x squat against a typical ` +
        `${LIFT_RATIO_NORM[wl]?.toFixed(2) ?? "?"}x. It is the limiting lift in the total and ` +
        `receives an extra weekly exposure at moderate load.`,
    });
  }

  const stalls = p.stalledLifts ?? [];
  if (stalls.length > 0) {
    applyMultipliers(w, EMPHASIS_MULTIPLIERS.stalledLift);
    findings.push({
      id: "stalled-lift",
      text:
        `Stalled over the last ${STALL_LOOKBACK_WEEKS} weeks: ${stalls.join(", ")}. Progression rate below ` +
        `${STALL_THRESHOLD_KG_PER_WEEK}kg/week. A variation block is scheduled ` +
        `before returning to the competition lift.`,
    });
  }

  // --- goal priority tilts the whole vector --------------------------------
  const clampedPriority = Math.min(1, Math.max(0, priority));
  for (const key of ENDURANCE_EMPHASIS_KEYS) w[key] *= (1 - clampedPriority) * PRIORITY_TILT_SCALE;
  for (const key of EMPHASIS_KEYS.filter((x) => !ENDURANCE_EMPHASIS_KEYS.includes(x))) {
    w[key] *= clampedPriority * PRIORITY_TILT_SCALE;
  }

  return { emphasis: normaliseEmphasis(w), findings };
}

// ---------------------------------------------------------------------------
// Top-level diagnostic
// ---------------------------------------------------------------------------

/**
 * Data sufficiency, assessed PER DOMAIN and then combined.
 *
 * The bug this replaces: the ladder required every threshold at once — runs,
 * span, maximal efforts AND lift sets. A runner with forty logged runs and two
 * races scored tier 0 because they do not lift, and a lifter with sixty logged
 * sets scored tier 0 because they do not run. Both were then told "insufficient
 * history for any diagnosis", which is not only wrong, it is wrong in the most
 * discouraging possible way: it reads as "you have not trained" to someone who
 * has trained a great deal.
 *
 * Aerobic sufficiency and strength sufficiency are different questions about
 * different data, and an athlete who has answered one of them thoroughly has
 * not failed. Each domain gets its own tier; the overall tier is the better of
 * the two, because a confident diagnosis on one side is a real diagnosis. The
 * gaps then name the side that is actually thin, rather than implying both are.
 */
export interface TierAssessment {
  tier: DataTier;
  /** Aerobic-only tier, from runs, history span and maximal efforts. */
  aerobicTier: DataTier;
  /** Strength-only tier, from logged working sets. */
  strengthTier: DataTier;
  gaps: string[];
}

function aerobicTierFor(runCount: number, spanWeeks: number, efforts: number): DataTier {
  for (const tier of [3, 2, 1] as const) {
    const req = TIER_REQUIREMENTS[tier];
    if (runCount >= req.runs && spanWeeks >= req.weeks && efforts >= req.efforts) return tier;
  }
  return 0;
}

function strengthTierFor(setCount: number): DataTier {
  for (const tier of [3, 2, 1] as const) {
    if (setCount >= TIER_REQUIREMENTS[tier].liftSets) return tier;
  }
  return 0;
}

export function assessTier(
  runs: RunLog[],
  sets: LiftSet[],
  crossTrainingSessions = 0
): TierAssessment {
  const dates = runs.map((r) => r.dateIdx);
  const spanWeeks = dates.length > 0 ? (Math.max(...dates) - Math.min(...dates)) / 7 : 0;
  const efforts = runs.filter((r) => r.isMaxEffort).length;

  const aerobicTier = aerobicTierFor(runs.length, spanWeeks, efforts);
  const strengthTier = strengthTierFor(sets.length);

  // The overall tier is the WEAKEST domain the athlete actually has data in.
  //
  // Not the strongest: thorough lift logging must not buy confidence in thin
  // running data, because the aerobic prescriptions are drawn from the aerobic
  // side and their band widths key off this number.
  //
  // Not a flat minimum either: a domain with NO data does not drag the other
  // one down, it simply gets no confident prescription of its own. That
  // distinction is the whole bug — a runner with forty runs and no gym was
  // scoring 0 because an empty strength side was being counted as a failed
  // one rather than an absent one.
  const present: DataTier[] = [];
  if (runs.length > 0) present.push(aerobicTier);
  if (sets.length > 0) present.push(strengthTier);
  const tier = (present.length > 0 ? Math.min(...present) : 0) as DataTier;

  const gaps: string[] = [];

  if (tier === 0) {
    // Still nothing to diagnose from — but say what IS there rather than
    // claiming there is nothing. "No logged history at all" shown to someone
    // with twenty logged rowing sessions is the original complaint in a
    // different field.
    if (crossTrainingSessions > 0) {
      gaps.push(
        `${crossTrainingSessions} logged cross-training sessions count toward your volume, but pace, easy-effort ` +
          `bands and fatigue resistance can only be fitted on running — log four runs to unlock them`
      );
    } else if (runs.length > 0 || sets.length > 0) {
      gaps.push(
        `${runs.length} logged runs and ${sets.length} logged sets — a little more of either unlocks a diagnosis ` +
          `(four runs across three weeks, or six working sets)`
      );
    } else {
      gaps.push("No logged history yet — anything you log from here starts building the diagnosis.");
    }
    return { tier, aerobicTier, strengthTier, gaps };
  }

  // Below tier 3, name the specific thing that would raise it, per domain.
  const r3 = TIER_REQUIREMENTS[3];
  if (aerobicTier < 3) {
    if (runs.length < r3.runs) gaps.push(`${r3.runs - runs.length} more logged runs for a full aerobic diagnosis`);
    if (spanWeeks < r3.weeks) {
      const more = Math.ceil(r3.weeks - spanWeeks);
      gaps.push(`${more} more week${more === 1 ? "" : "s"} of logged history`);
    }
    if (efforts < r3.efforts) {
      gaps.push("a second maximal effort at a different distance unlocks your personal fatigue-resistance model");
    }
  }
  if (strengthTier < 3 && sets.length < r3.liftSets) {
    gaps.push(`${r3.liftSets - sets.length} more logged sets for a rep-profile diagnosis`);
  }

  return { tier, aerobicTier, strengthTier, gaps };
}

export interface DiagnoseOptions {
  /** 0 = pure endurance goals, 1 = pure strength goals. Derived from the athlete's own goal mix by the caller. */
  priority?: number;
  hrMax: number;
  hrRest: number;
  hrMaxSource?: "measured" | "estimated";
  /**
   * Weekly minutes of NON-running endurance work — rowing, cycling, the
   * ski erg. Counted toward aerobic volume and nothing else.
   *
   * The split matters. Everything pace-derived in this module — the personal
   * Riegel exponent, the predicted 5k, the easy band, the quality cutoff — is
   * denominated in running seconds per kilometre, and a 20km ride entering
   * that pool as a 2:00/km "run" wrecks every one of them. But an athlete who
   * rows four times a week has an aerobic base, and reporting their weekly
   * volume as zero because none of it was running is a plainly wrong answer
   * to the question actually being asked.
   *
   * So cross-training informs VOLUME (and therefore volume adequacy and the
   * on-ramp) while running alone informs PACE.
   */
  crossTrainingMinPerWeek?: number;
  /** Weekly km of that cross-training, for the same reason. */
  crossTrainingKmPerWeek?: number;
  /** Session count, so a tier-0 athlete who cross-trains is not told they have "no logged history at all". */
  crossTrainingSessions?: number;
}

function verdict(
  value: number | null,
  lo: number,
  hi: number,
  lowLabel: string,
  midLabel: string,
  highLabel: string
): string {
  if (value == null) return "insufficient data";
  if (value < lo) return lowLabel;
  if (value > hi) return highLabel;
  return midLabel;
}

/**
 * The single entry point. Everything downstream — macrocycle, session set,
 * prescription — consumes the AthleteProfile this returns.
 *
 * Tier 0 still returns a profile (so the caller can render the data gaps and
 * offer a baseline block) but callers must not generate a plan from it; see
 * `canGeneratePlan` below.
 */
export function diagnose(
  runs: RunLog[],
  sets: LiftSet[],
  oneRms: Record<string, number>,
  options: DiagnoseOptions
): AthleteProfile {
  const { hrMax, hrRest, hrMaxSource = "estimated", priority = DEFAULT_GOAL_PRIORITY } = options;
  const { tier, aerobicTier, strengthTier, gaps } = assessTier(
    runs,
    sets,
    options.crossTrainingSessions ?? 0
  );
  const confidence = TIER_CONFIDENCE[tier];

  const dates = runs.map((r) => r.dateIdx);
  const spanWk = Math.max(1, dates.length > 0 ? (Math.max(...dates) - Math.min(...dates)) / 7 : 0);
  const runningVolumeKm = runs.reduce((s, r) => s + r.distanceKm, 0) / spanWk;
  const runningVolumeMin = runs.reduce((s, r) => s + r.durationS, 0) / 60 / spanWk;
  // Cross-training counts toward the aerobic total. See DiagnoseOptions.
  const weeklyVolumeKm = runningVolumeKm + (options.crossTrainingKmPerWeek ?? 0);
  const weeklyVolumeMin = runningVolumeMin + (options.crossTrainingMinPerWeek ?? 0);
  const longestRunKm = runs.length > 0 ? Math.max(...runs.map((r) => r.distanceKm)) : 0;

  const riegelK = fitRiegelK(runs);
  const kEff = riegelK ?? RIEGEL_K_DEFAULT;

  // Predicted 5k from the best maximal effort, using the athlete's OWN k.
  const efforts = runs.filter((r) => r.isMaxEffort && r.distanceKm > 0 && r.durationS > 0);
  let predicted5kS: number;
  let predicted5kFromEffort: boolean;
  if (efforts.length > 0) {
    const best = efforts.reduce((a, b) =>
      b.durationS / Math.pow(b.distanceKm, kEff) < a.durationS / Math.pow(a.distanceKm, kEff) ? b : a
    );
    predicted5kS = best.durationS * Math.pow(5.0 / best.distanceKm, kEff);
    predicted5kFromEffort = true;
  } else {
    // No maximal effort at all. Nothing may be prescribed off an
    // extrapolation the athlete's data does not cover (non-negotiable #6),
    // so this is flagged rather than quietly treated as a real prediction —
    // tier assessment above independently caps such an athlete at tier 1.
    predicted5kS = NO_MAXIMAL_EFFORT_5K_S;
    predicted5kFromEffort = false;
  }

  const thresholdPaceSPerKm = (predicted5kS / 5.0) * THRESHOLD_PACE_MULTIPLIER;
  const vo2maxPaceSPerKm = (predicted5kS / 5.0) * VO2MAX_PACE_MULTIPLIER;

  // Anaerobic speed reserve (critical implementation note 0). The aerobic
  // side comes from the athlete's own maximal effort projected through their
  // own k; the sprint side is independent data they either have or have not
  // logged. Null when they have not — no finding, no multiplier, and an
  // unlock prompt in dataGaps instead.
  const maximalAerobicSpeedMs = vo2maxPaceSPerKm > 0 ? 1000 / vo2maxPaceSPerKm : 0;
  const sprintSpeedMs = maximalSprintSpeedMs(runs);
  const speedReserveMs = anaerobicSpeedReserveMs(sprintSpeedMs, maximalAerobicSpeedMs);

  const longs = runs.filter((r) => r.distanceKm >= DECOUPLING_MIN_KM && (r.hrByKm?.length ?? 0) > 0);
  const decouplings = longs.map(aerobicDecoupling).filter((d): d is number => d != null);
  const decoupling = decouplings.length > 0 ? mean(decouplings) : null;

  const hrPaceModel = fitHrPaceModel(runs);
  const easyCut = (predicted5kS / 5.0) * FIVE_K_TO_EASY[0];
  const easyFractionByPace = paceIntensityDistribution(runs.filter((r) => !r.isMaxEffort), easyCut);
  const easyFractionByHr = hrIntensityDistribution(runs, hrMax, hrRest);
  const easyFraction = easyFractionByHr ?? easyFractionByPace;
  const easyFractionSource = easyFractionByHr != null ? "heart-rate" : easyFractionByPace != null ? "pace" : null;

  const easyBand = easyPaceBand(predicted5kS, kEff, hrPaceModel, hrMax, hrRest);
  const runsInsideEasyBand = loggedRunsInsideEasyBand(runs, hrMax, hrRest);
  const qualityCut = (predicted5kS / 5.0) * QUALITY_PACE_CUTOFF_MULTIPLIER;
  const qualitySessionCount = runs.filter((r) => !r.isMaxEffort && paceSPerKm(r) < qualityCut).length;
  const noQuality = qualitySessionCount === 0 && runs.length >= NO_QUALITY_MIN_RUNS;

  // RUNNING volume, not total. `volumeAdequacy` asks "is this enough to
  // support this 5k level" — its denominator is a running requirement and its
  // second argument is a running prediction, so it is a pace-derived verdict
  // and cross-training must not enter it. Feeding total volume in told a
  // rower who has never run that they were on 356% of the running volume they
  // need and should now train intensity rather than build a base — the exact
  // inverse of what a non-runner needs, and it then moved the whole emphasis
  // vector that way.
  const va = volumeAdequacy(runningVolumeMin, predicted5kS);

  const ratios = liftRatios(oneRms);
  const weakLift = findWeakLift(ratios);
  const perLiftGaps = Object.keys(LIFT_RATIO_NORM)
    .map((lift) => repProfileGap(sets, lift))
    .filter((g): g is number => g != null);
  const gap = perLiftGaps.length > 0 ? mean(perLiftGaps) : null;
  const stalls = stalledLifts(sets);
  const assessability = strengthAssessability(oneRms, sets);

  // The unlock prompt the brief asks for by name. A data-collection prompt
  // that also happens to be a retention mechanic — and, unlike the reference's
  // universal finding, it is true only of athletes it is actually true of.
  if (speedReserveMs == null && tier > 0) {
    gaps.push("a flat-out 400m unlocks your speed-reserve diagnosis");
  }

  const { emphasis, findings } = deriveEmphasis(
    {
      riegelK,
      // Suppressed when the 5k is a placeholder rather than a prediction: a
      // ratio against a fabricated denominator is not a finding.
      volumeAdequacy: predicted5kFromEffort ? va : null,
      decoupling,
      easyBand,
      runsInsideEasyBand,
      easyFractionByPace,
      easyFractionByHr,
      easyFraction,
      noQuality,
      speedReserveMs,
      runsWithHr: runs.filter((r) => r.avgHr != null && r.avgHr > 0 && !r.isMaxEffort).length,
      repProfileGap: gap,
      weakLift,
      liftRatios: ratios,
      stalledLifts: stalls,
    },
    priority
  );

  const enduranceScore = ENDURANCE_EMPHASIS_KEYS.reduce((s, key) => s + emphasis[key], 0);

  return {
    constantsVersion: HPE_CONSTANTS_VERSION,
    tier,
    aerobicTier,
    strengthTier,
    confidence,
    weeklyVolumeKm,
    weeklyVolumeMin,
    runningVolumeKm,
    runningVolumeMin,
    longestRunKm,
    riegelK,
    riegelVerdict: verdict(
      riegelK,
      RIEGEL_K_ENDURANCE_STRONG,
      RIEGEL_K_ENDURANCE_WEAK,
      "strong fatigue resistance",
      "typical",
      "endurance-limited"
    ),
    decoupling,
    decouplingVerdict: verdict(
      decoupling,
      DECOUPLING_GOOD,
      DECOUPLING_POOR,
      "base supports the duration",
      "acceptable drift",
      "base insufficient for the duration"
    ),
    easyFraction,
    easyFractionSource,
    easyBand,
    // Deviation D3: null-checked. The reference reports an athlete whose
    // measured easy fraction is exactly 0 as "well polarised".
    intensityVerdict:
      easyFraction == null
        ? "insufficient data"
        : easyFraction < EASY_FRACTION_TARGET
          ? "grey-zone risk"
          : "well polarised",
    volumeAdequacy: va,
    speedReserveMs,
    maximalSprintSpeedMs: sprintSpeedMs,
    maximalAerobicSpeedMs,
    hrPaceModel,
    predicted5kS,
    predicted5kFromEffort,
    thresholdPaceSPerKm,
    vo2maxPaceSPerKm,
    hrMax,
    hrRest,
    hrMaxSource,
    runsInsideEasyBand,
    qualitySessionCount,
    oneRms,
    repProfileGap: gap,
    repProfileVerdict: verdict(
      gap,
      -REP_PROFILE_NEURAL_GAP,
      REP_PROFILE_NEURAL_GAP,
      "under-built, neurally efficient",
      "balanced",
      "under-expressed, needs heavy work"
    ),
    weakLift,
    liftRatios: ratios,
    stalledLifts: stalls,
    liftRatiosAssessed: assessability.ratiosAssessed,
    weakLiftAssessed: assessability.weakLiftAssessed,
    stallAssessed: assessability.stallAssessed,
    limiter: enduranceScore > 0.5 ? "endurance" : "strength",
    emphasis,
    findings,
    dataGaps: gaps,
  };
}

/**
 * Non-negotiable: tier 0 returns NO plan. The athlete is offered a two-week
 * baseline block plus a time trial and a 3-5RM test, then the diagnostic
 * re-runs. Callers must gate on this before generating anything.
 */
export function canGeneratePlan(profile: AthleteProfile): boolean {
  return profile.tier > 0;
}

/** What a tier-0 athlete is offered instead of a plan. */
export const BASELINE_BLOCK_PROMPT = [
  "Two weeks of baseline logging before a plan can be built for you specifically:",
  "4-5 easy runs a week, all conversational, each one logged with heart rate.",
  "One time trial — 5k or 10k, run as a genuine maximal effort and tagged as one.",
  "One 3-5RM test on squat, bench and deadlift.",
  "That is enough history for the diagnostic to run; anything less and a plan would be a guess dressed up as a prescription.",
];
