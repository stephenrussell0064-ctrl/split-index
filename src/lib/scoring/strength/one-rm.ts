/**
 * Sub-maximal 1RM estimators for strength scoring.
 *
 * THE ESTIMATOR MUST SPEAK THE ANCHOR TABLES' LANGUAGE.
 * ------------------------------------------------------
 * Every scoring table in split-strength-engine.ts is Strength Level's
 * published standards mapped onto a percentile scale, and those standards are
 * ONE-REP MAXES. The engine feeds them a number derived from a rep set. If the
 * two are not produced by the same rep→1RM conversion, the athlete is being
 * measured with a different ruler from the population they are ranked against,
 * and the difference lands on the score as a silent gift.
 *
 * It was a gift. Measured against Strength Level's own published "Repetition
 * Percentages of 1RM" table (strengthlevel.com/one-rep-max-calculator, read
 * Sept 2026 — the same source the anchor tables come from), the previous
 * estimator over-read at every rep count above one:
 *
 *   reps      compound   accessory   isolation      (over-read vs SL's table)
 *      2         +9.7%      +12.2%       +9.9%
 *      5        +10.1%      +15.8%      +18.7%
 *      8         +8.8%      +17.1%      +24.2%
 *     10         +6.0%      +15.6%      +25.0%
 *     12         +8.4%      +16.3%      +27.8%
 *     15        +16.2%      +19.4%      +20.6%
 *
 * Three separate causes, all pushing the same way:
 *  1. Exercise-class Epley k values (30 / 22 / 15). Epley's k is 30; 22 and 15
 *     were invented here and have no published basis. They were the largest
 *     term for accessory and isolation lifts.
 *  2. `max(Epley, Brzycki)`. Taking the higher of two estimates is not
 *     "conservative" — it is an upward-biased estimator by construction.
 *  3. A +6% sub-maximal bias correction applied in split-strength-engine.ts.
 *     Its premise was that a set not taken to a true max under-reads. That is
 *     true of the athlete AND of every lifter in Strength Level's population,
 *     whose logged sets built the standards being compared against, so
 *     correcting only one side of the comparison is a 6% handout.
 *
 * Cross-checks, all agreeing that the fix is a downward one: the NSCA/Baechle
 * training-load chart (Essentials of Strength Training and Conditioning,
 * Table 17.7) puts an 8RM at 80% of 1RM (multiplier 1.25) against this file's
 * old 1.45 for an accessory lift; Brzycki (1993) gives 1.24, Lombardi (1989)
 * 1.23, Wathan (1994) 1.28, Mayhew (1992) 1.26, Lander (1985) 1.25, Epley
 * (1985) itself 1.27. Every named formula in the literature sits between 1.20
 * and 1.28 at eight reps. Nothing supports 1.45, and nothing at all supports
 * the isolation class's 1.80 cap at twelve.
 *
 * Hoeger et al. (1990), JSCR — the study that actually measured reps to
 * failure at a known percentage of a separately tested 1RM — is the one source
 * that speaks to whether isolation lifts need their own curve, and it points
 * the OPPOSITE way from k=15: trained men managed ~11 reps on the arm curl at
 * 80% of 1RM, i.e. an 11RM multiplier near 1.25, where this file was claiming
 * 1.73.
 *
 * ONE CURVE FOR EVERY EXERCISE, and specifically Strength Level's curve. Not
 * because a single curve is physiologically perfect — Hoeger shows it is not,
 * and a large modern observational fit (arXiv:2603.17495, 303,494 near-failure
 * sets) argues the conversion varies with the weight on the bar — but because
 * Strength Level publishes exactly one rep table, with no per-exercise
 * variation, and applied it across its whole catalogue to produce the
 * standards this engine's tables are built from. Adopting a "better" curve
 * than the source's own would re-introduce the ruler mismatch this change
 * exists to remove. If the tables are ever rebuilt on a different population,
 * this table is the thing that moves with them.
 */

/**
 * Strength Level's published rep → % of 1RM table
 * (strengthlevel.com/one-rep-max-calculator, read September 2026).
 * Index = reps, value = percentage of 1RM. Index 0 is unused padding so the
 * array reads by rep count directly.
 */
const REP_PERCENT_OF_1RM = [
  0,
  100, 97, 94, 92, 89, 86, 83, 81, 78, 75,
  73, 71, 70, 68, 67, 65, 64, 63, 61, 60,
  59, 58, 57, 56, 55, 54, 53, 52, 51, 50,
] as const;

const MAX_TABULATED_REPS = REP_PERCENT_OF_1RM.length - 1; // 30

/**
 * Multiplier taking a set weight to a 1RM: 1RM = weight × repMaxMultiplier(reps).
 *
 * Interpolated between whole reps so a fractional effective rep count (reps +
 * a fractional reps-in-reserve) doesn't jump. Held flat past the end of the
 * published table rather than extrapolated — the same discipline the age
 * coefficients use, and a 40-rep set says nothing useful about a 1RM anyway.
 */
export function repMaxMultiplier(reps: number): number {
  if (reps <= 1) return 1;
  if (reps >= MAX_TABULATED_REPS) return 100 / REP_PERCENT_OF_1RM[MAX_TABULATED_REPS];
  const lower = Math.floor(reps);
  const upper = lower + 1;
  const t = reps - lower;
  const pct = REP_PERCENT_OF_1RM[lower] * (1 - t) + REP_PERCENT_OF_1RM[upper] * t;
  return 100 / pct;
}

/**
 * Movement taxonomy. Retained because callers classify lifts for other
 * reasons (and `EXERCISE_CLASS` in split-strength-engine.ts is the canonical
 * map), but it deliberately NO LONGER varies the rep→1RM curve — see the
 * file header. The parameter stays on the estimator signatures so call sites
 * keep reading self-documentingly, and so that if a future pass ever earns
 * per-class curves from real data, there is one obvious place to put them.
 */
export type ExerciseClass = "compound" | "accessory" | "isolation";

/**
 * Weighted calisthenics 1RM blend: 1 = total-load, 0 = added-only.
 * Applies to weighted pull-ups, chin-ups, dips, muscle-ups.
 *
 * 0.5 -> 1.0 (user feedback: "Pull up score needs recalibrating — 30 x 8
 * scores 72.9, this should be almost 80"). The added-only half of the old
 * 50/50 blend was never an estimate of this movement's 1RM: it applies a
 * rep formula to a load the athlete never lifted on its own. An athlete
 * doing pull-ups at +30kg is moving bodyweight + 30kg on every rep, so
 * treating 30kg as if it were the whole lift understates the set badly —
 * and the understatement grows as bodyweight grows relative to the added
 * load, which is backwards.
 *
 * This is the same defect already fixed for the addedKg <= 0 case in
 * weightedCalisthenic1RM() below (where the added-only term is not merely
 * biased but identically zero); that fix stopped at the boundary instead of
 * following the reasoning through to added-weight sets. The correct
 * estimate on both sides of the boundary is the total-load one: resolve the
 * 1RM of (bodyweight + added), then subtract bodyweight back out to express
 * it the way it was logged.
 *
 * Kept as a named constant rather than deleting the blend: if real logged
 * near-max weighted sets later show total-load Epley/Brzycki over-reading
 * at very high added loads, this is the dial to turn back down.
 */
export const CALISTHENIC_BLEND = 1.0;

/** Flag when stated 1RM differs from formula estimate by more than this fraction (Part B4). */
export const ONE_RM_VARIANCE_THRESHOLD = 0.4;

export type RepsInReserve = number | null | undefined;

/** Blank RIR = assume near failure (Part B3). */
export function effectiveReps(reps: number, repsInReserve?: RepsInReserve): number {
  return reps + (repsInReserve ?? 0);
}

/**
 * Epley (1985): 1RM ≈ weight × (1 + reps/30). The published formula, with the
 * published constant.
 *
 * The exercise-class k parameter this used to take is gone. A formula named
 * after the person who fitted it should compute what they fitted; the
 * scoring-side conversion lives in `bestEstimate1RM`/`repMaxMultiplier`, and
 * that is where a per-class curve would belong if one is ever earned.
 */
export function epley1RM(
  weightKg: number,
  reps: number,
  repsInReserve?: RepsInReserve
): number {
  const effective = effectiveReps(reps, repsInReserve);
  if (effective <= 0 || weightKg <= 0) return 0;
  if (effective === 1) return weightKg;
  return weightKg * (1 + effective / 30);
}

/** Brzycki: 1RM ≈ weight × 36 / (37 − reps). Best for 2–10 reps. */
export function brzycki1RM(
  weightKg: number,
  reps: number,
  repsInReserve?: RepsInReserve
): number {
  const effective = effectiveReps(reps, repsInReserve);
  if (effective <= 0 || weightKg <= 0) return 0;
  if (effective === 1) return weightKg;
  if (effective >= 37) return weightKg;
  return (weightKg * 36) / (37 - effective);
}

/**
 * The one conversion the scoring engine uses, for every lift.
 * Was `max(Epley, Brzycki)` with a class-varying Epley k — see the file header
 * for why that over-read and why this is Strength Level's table instead.
 */
function scoringRepFormula(
  weightKg: number,
  reps: number,
  repsInReserve?: RepsInReserve
): number {
  const effective = effectiveReps(reps, repsInReserve);
  if (effective <= 0 || weightKg <= 0) return 0;
  return weightKg * repMaxMultiplier(effective);
}

/**
 * Weighted calisthenics 1RM in ADDED-weight terms (Part B1).
 * Blends total-load and added-only estimates.
 */
export function weightedCalisthenic1RM(
  addedKg: number,
  reps: number,
  bodyweightKg: number,
  exerciseClass: ExerciseClass = "compound",
  repsInReserve?: RepsInReserve
): number {
  void exerciseClass; // inert — one rep curve for every class, see file header
  if (reps <= 1 && (repsInReserve ?? 0) === 0) return addedKg;
  const effective = effectiveReps(reps, repsInReserve);
  if (effective <= 1) return addedKg;
  const totalLoad1RM =
    scoringRepFormula(bodyweightKg + addedKg, reps, repsInReserve) - bodyweightKg;
  // The added-only side of the blend is degenerate at addedKg <= 0 — any
  // rep formula applied to a 0 weight trivially returns 0 regardless of
  // reps, so blending 50/50 with an always-zero signal silently halved the
  // true credit for pure-bodyweight performances (user feedback: 10 strict
  // bodyweight pull-ups — a genuinely strong "Intermediate" feat per
  // published calisthenics standards — scored as low as 237/1000
  // "Beginner"). Bodyweight-only reps rely on totalLoad1RM alone; the blend
  // only makes sense once there's real added weight for addedOnly1RM to
  // meaningfully estimate against, and is unchanged for addedKg > 0.
  if (addedKg <= 0) return totalLoad1RM;
  const addedOnly1RM = scoringRepFormula(addedKg, reps, repsInReserve);
  return CALISTHENIC_BLEND * totalLoad1RM + (1 - CALISTHENIC_BLEND) * addedOnly1RM;
}

/**
 * The scoring estimate: 1RM implied by a sub-maximal set, on Strength Level's
 * published rep table — the same conversion that produced the population
 * standards every anchor table in split-strength-engine.ts is built from.
 *
 * `exerciseClass` no longer changes the answer. See the file header: the
 * class-varying Epley k it used to select was the largest single term in a
 * 6–28% over-read, and nothing published supports it.
 */
export function bestEstimate1RM(
  weightKg: number,
  reps: number,
  exerciseClass: ExerciseClass = "compound",
  repsInReserve?: RepsInReserve
): number {
  void exerciseClass;
  return scoringRepFormula(weightKg, reps, repsInReserve);
}

/** Best 1RM across multiple sets of the same lift. */
export function bestSet1RM(
  sets: Array<{ weightKg: number; reps: number; repsInReserve?: RepsInReserve }>,
  exerciseClass: ExerciseClass = "compound"
): number {
  let best = 0;
  for (const s of sets) {
    best = Math.max(
      best,
      bestEstimate1RM(s.weightKg, s.reps, exerciseClass, s.repsInReserve)
    );
  }
  return best;
}

/**
 * Exact inverse of `bestEstimate1RM` — the weight this athlete could likely
 * lift for `reps` today, given a known/estimated 1RM. Used by the Training
 * Plan (user feedback: "Allow target in training plan to be a weight for reps
 * as well not just a 1rm") to show a rep-based goal's "current" figure in
 * the SAME units as the goal itself (e.g. "current: ~82kg x5" next to
 * "goal: 100kg x5"), rather than forcing a comparison between a 1RM number
 * and a rep-based target that aren't directly comparable at a glance.
 *
 * It inverts the SCORING conversion, not Epley — the two used to be the same
 * function and are not any more. This is the load-bearing property: the
 * training-goals route converts a "100kg × 5" goal to a 1RM with
 * bestEstimate1RM and converts the athlete's current 1RM back with this, and
 * a goal must not appear already-met (or unreachable) purely because the two
 * directions disagree.
 */
export function estimateWeightForReps(
  oneRM: number,
  reps: number,
  exerciseClass: ExerciseClass = "compound"
): number {
  void exerciseClass;
  if (oneRM <= 0 || reps <= 0) return 0;
  if (reps === 1) return oneRM;
  return oneRM / repMaxMultiplier(reps);
}

/** Data-quality guard: flag when stated 1RM diverges from set-derived estimate (Part B4). */
export function oneRMVarianceFlag(
  setWeightKg: number,
  reps: number,
  statedOneRMKg: number,
  exerciseClass: ExerciseClass = "compound",
  repsInReserve?: RepsInReserve
): boolean {
  if (setWeightKg <= 0 || reps <= 0 || statedOneRMKg <= 0) return false;
  const estimated = bestEstimate1RM(setWeightKg, reps, exerciseClass, repsInReserve);
  if (estimated <= 0) return false;
  return Math.abs(statedOneRMKg - estimated) / estimated > ONE_RM_VARIANCE_THRESHOLD;
}
