/**
 * Split Index — the personal score
 * --------------------------------
 * Every session gets two numbers. The population score says how good the
 * performance was against everyone (the sport's anchor tables). This module
 * builds the other one: how good it was against the athlete's OWN recent
 * sessions in that sport, on the same 0–1000 scale.
 *
 * 500 means "your normal". Better than your recent norm reads above 500,
 * worse below, and the scale is the same for every sport so the number means
 * the same thing on a run, a row and a bench press: about 22 points per 1%
 * of performance in cardio, about 40 per 1% in strength (lifts vary less
 * session to session than paces do, so the same percentage is a bigger
 * deal, and a lift is a cleaner measurement than a pace). The curve is a
 * tanh, not a clip — a 15% breakthrough still reads higher than a 10% one,
 * it just no longer reads 150 points higher.
 *
 * The cardio slope came down from 30 after an athlete saw a normal week of
 * easy running spread across 50 to 678: correct in direction every time, and
 * far too dramatic to read as "these were all ordinary runs".
 *
 * The baseline is a recency-weighted median rather than a mean: one wild
 * session (a GPS overread, a race, a session logged with the wrong distance)
 * should shift what counts as "normal" a little, not redefine it. Weights
 * halve every BASELINE_HALF_LIFE_DAYS so a block of fitness gained six weeks
 * ago is still remembered, but this month's form counts for more.
 *
 * Shared by cardio (cardio-activity.ts) and strength (split-strength-engine.ts)
 * so the two halves of the app cannot drift onto different definitions of
 * "against your own history".
 */

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

export const PERSONAL_SCORE_CENTER = 500;
/** How far above/below center the curve can reach — 50..950, never the extremes reserved for records. */
export const PERSONAL_SCORE_AMPLITUDE = 450;
/** Points per unit fraction of improvement near center (22 per 1%). */
export const CARDIO_PERSONAL_SLOPE = 2200;
/** Points per unit fraction of improvement near center (40 per 1%). */
export const STRENGTH_PERSONAL_SLOPE = 4000;
/** Fewer comparable sessions than this and the number would be noise, so there is no number. */
export const MIN_PERSONAL_BASELINE_SAMPLES = 3;
export const BASELINE_HALF_LIFE_DAYS = 30;

/**
 * `delta` is the fractional improvement over the baseline, signed so that
 * positive is better in every sport (faster time, heavier lift).
 */
export function personalScoreFromDelta(delta: number, slope: number): number {
  if (!Number.isFinite(delta)) return PERSONAL_SCORE_CENTER;
  const curved = PERSONAL_SCORE_AMPLITUDE * Math.tanh((delta * slope) / PERSONAL_SCORE_AMPLITUDE);
  return Math.round(clamp(PERSONAL_SCORE_CENTER + curved, 0, 1000));
}

/**
 * How far apart two sessions' intensities have to be before they stop being
 * comparable, in units of heart-rate reserve — chosen per athlete, not fixed.
 *
 * This is what the athlete asked for in as many words: a score "based on your
 * previous runs or exercises AT A CERTAIN HEART RATE". It is what makes the
 * personal score say something the population score does not. Without it the
 * baseline is one blended average of every session type, so a tempo always
 * reads as a great day and a recovery jog always as a terrible one, and the
 * personal score degenerates into a restatement of how hard the session was.
 *
 * ## Why this cannot be one number
 *
 * It was 0.09 for everyone, and that quietly broke for the athlete it was
 * built for. Their 26 logged runs span 71% to 94% of reserve — a 23-point
 * range, median 84, nothing easier than 71. A 9-point window on a 23-point
 * training life reaches most of the way across it: their 77% "easy" run was
 * being judged against threshold sessions at 87%, which still carried about
 * a third of the weight. So their easy runs read as below-par days and only
 * races cleared a bar set by their own kind. Both cannot be true at once.
 *
 * A window has to mean the same thing relative to how varied the athlete's
 * training actually is. Someone who genuinely runs 55% to 95% needs a wide
 * one; someone compressed into 71-94% needs a narrow one, or every session
 * is compared with every other and the matching does nothing.
 *
 * ## How the width is chosen
 *
 * Narrowest first, widening only until the baseline rests on enough evidence
 * to be worth reading — see effectiveSampleSize. That way an athlete with a
 * dense log gets tight matching, and one with four sessions gets a window
 * wide enough to actually contain them rather than a median of one.
 *
 * Gaussian rather than a hard window, so nothing falls off a cliff at a
 * boundary, and it still degrades gracefully: when every sample sits at one
 * intensity they all weigh alike, which is the un-weighted behaviour rather
 * than an empty pool.
 */
export const INTENSITY_BANDWIDTH_STEPS = [0.03, 0.045, 0.06, 0.09, 0.14, 0.25] as const;

/**
 * How much independent evidence a set of weights really carries — Kish's
 * effective sample size, sum(w)^2 / sum(w^2). Ten sessions where one carries
 * all the weight is one session's worth of evidence, and a median drawn from
 * it would swing on that session alone.
 */
export function effectiveSampleSize(weights: number[]): number {
  const sum = weights.reduce((a, b) => a + b, 0);
  const sumSquares = weights.reduce((a, b) => a + b * b, 0);
  if (!(sumSquares > 0)) return 0;
  return (sum * sum) / sumSquares;
}

/** Enough comparable evidence that the median means something. */
const MIN_EFFECTIVE_SAMPLES = 3;

export interface WeightedSample {
  value: number;
  /** Days before the session being scored — drives the recency weight. */
  daysBefore: number;
  /**
   * The session's own intensity (heart-rate-reserve fraction), when known.
   * Samples whose intensity is far from the session being scored count for
   * less. Omit on both sides to compare on recency alone.
   */
  intensity?: number | null;
}

export function recencyWeight(daysBefore: number): number {
  const d = Math.max(0, daysBefore);
  return Math.pow(0.5, d / BASELINE_HALF_LIFE_DAYS);
}

/** 1 at identical intensity, falling off smoothly; 1 whenever either side is unknown. */
export function intensitySimilarity(
  sampleIntensity: number | null | undefined,
  targetIntensity: number | null | undefined,
  bandwidth: number
): number {
  if (sampleIntensity == null || targetIntensity == null) return 1;
  const gap = (sampleIntensity - targetIntensity) / bandwidth;
  return Math.exp(-gap * gap);
}

function weightsFor(
  samples: WeightedSample[],
  targetIntensity: number | null | undefined,
  bandwidth: number
): number[] {
  return samples.map(
    (s) => recencyWeight(s.daysBefore) * intensitySimilarity(s.intensity, targetIntensity, bandwidth)
  );
}

/**
 * The narrowest bandwidth whose weights still rest on MIN_EFFECTIVE_SAMPLES
 * of real evidence, or the widest available if none does.
 */
export function resolveIntensityBandwidth(
  samples: WeightedSample[],
  targetIntensity: number | null | undefined
): number {
  const widest = INTENSITY_BANDWIDTH_STEPS[INTENSITY_BANDWIDTH_STEPS.length - 1];
  if (targetIntensity == null) return widest;
  for (const bandwidth of INTENSITY_BANDWIDTH_STEPS) {
    if (effectiveSampleSize(weightsFor(samples, targetIntensity, bandwidth)) >= MIN_EFFECTIVE_SAMPLES) {
      return bandwidth;
    }
  }
  return widest;
}

/** Weighted median: the value at which half the total weight lies on either side. */
export function weightedMedian(
  samples: WeightedSample[],
  targetIntensity?: number | null,
  bandwidth?: number
): number | null {
  const valid = samples.filter((s) => Number.isFinite(s.value) && s.value > 0);
  if (valid.length === 0) return null;
  const width = bandwidth ?? resolveIntensityBandwidth(valid, targetIntensity);
  const weights = weightsFor(valid, targetIntensity, width);
  const weighted = valid
    .map((s, i) => ({ v: s.value, w: weights[i] }))
    .sort((a, b) => a.v - b.v);
  const total = weighted.reduce((sum, s) => sum + s.w, 0);
  // Every sample is vanishingly far from this session's intensity: fall back
  // to recency alone rather than letting floating-point underflow decide.
  if (!(total > 0)) return weightedMedian(valid.map((s) => ({ ...s, intensity: null })));
  let acc = 0;
  for (const s of weighted) {
    acc += s.w;
    if (acc >= total / 2) return s.v;
  }
  return weighted[weighted.length - 1].v;
}

export interface PersonalBaseline {
  /** The athlete's recent norm, in the metric's own units. */
  baseline: number;
  /** Their best in the window, same units (min for times, max for lifts). */
  best: number;
  sampleCount: number;
  /** The intensity window this baseline settled on, in heart-rate reserve. */
  bandwidth: number;
  /** How much independent evidence it rests on, after weighting. */
  effectiveSamples: number;
}

/**
 * `lowerIsBetter` — true for times, false for lifts. `targetIntensity` is
 * the intensity of the session being scored, so like is compared with like
 * (see INTENSITY_SIMILARITY_BANDWIDTH); omit it to weigh on recency alone.
 *
 * Returns null below the minimum sample count: a first-week athlete gets a
 * population score and a "calibrating" note, not a fabricated comparison
 * against one session.
 */
export function buildPersonalBaseline(
  samples: WeightedSample[],
  lowerIsBetter: boolean,
  targetIntensity?: number | null
): PersonalBaseline | null {
  const valid = samples.filter((s) => Number.isFinite(s.value) && s.value > 0);
  if (valid.length < MIN_PERSONAL_BASELINE_SAMPLES) return null;
  const bandwidth = resolveIntensityBandwidth(valid, targetIntensity);
  const baseline = weightedMedian(valid, targetIntensity, bandwidth);
  if (baseline === null) return null;
  const values = valid.map((s) => s.value);
  return {
    baseline,
    best: lowerIsBetter ? Math.min(...values) : Math.max(...values),
    sampleCount: valid.length,
    bandwidth,
    effectiveSamples:
      Math.round(effectiveSampleSize(weightsFor(valid, targetIntensity, bandwidth)) * 10) / 10,
  };
}

/** Signed fractional improvement of `value` over `baseline`, positive = better. */
export function improvementDelta(value: number, baseline: number, lowerIsBetter: boolean): number {
  if (!(baseline > 0) || !Number.isFinite(value)) return 0;
  return lowerIsBetter ? (baseline - value) / baseline : (value - baseline) / baseline;
}

export function daysBetween(earlier: string | Date, later: string | Date): number {
  const a = typeof earlier === "string" ? new Date(earlier).getTime() : earlier.getTime();
  const b = typeof later === "string" ? new Date(later).getTime() : later.getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, (b - a) / 86_400_000);
}
