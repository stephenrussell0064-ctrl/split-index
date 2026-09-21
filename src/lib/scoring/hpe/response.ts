/**
 * Hybrid Plan Engine — what this athlete's own rate of improvement turns out
 * to be.
 *
 * The feasibility model starts from a population prior: a mean and an SD by
 * training age, taken from the cohorts that report one. That is the right
 * place to start and the wrong place to stay. Two athletes with the same
 * training age and the same plan improve at genuinely different rates —
 * HERITAGE found VO2max responses from about −2% to over +40% on an identical
 * 20-week programme, and Hubal 2005 found 1RM changes from 0% to +250% across
 * 585 people — so a prior that never updates is, after a few months of logged
 * data, ignoring the best evidence available about this specific person.
 *
 * The engine already told the athlete it would do this: "the first four weeks
 * are a dose check — the projection is recomputed from your logged sessions as
 * the block goes on". Until this module, it recomputed the projection from an
 * updated STARTING POINT and never from an updated RATE. The promise was half
 * kept.
 *
 * ---------------------------------------------------------------------------
 * WHY THE UPDATE IS DELIBERATELY TIMID
 *
 * A single block's observed deviation from the prior is mostly noise, not
 * trainability. Renwick 2024 (meta-analysis of the SD of individual response
 * for VO2max) concluded that the majority of variation in observed change
 * scores after an intervention is measurement error, and Bonafiglia 2021 found
 * most studies cannot separate true response differences from within-subject
 * noise at all. A 5k time trial repeats to 1-2%; a 1RM swings 2-3% day to day.
 * Over four weeks the expected true gain for a trained athlete is the same
 * size as that noise.
 *
 * So the observed rate is not adopted. It is BLENDED, at a weight that starts
 * near zero and reaches a ceiling of 0.3 only after a full block of
 * observation, and the blend is clamped so no single reading can more than
 * halve or double the athlete's expected rate. The feasibility brief's rule 9
 * is the source of the 0.3: "update the individual's prior from observed
 * submaximal markers using a shrinkage weight of ≈ 0.3 (because ≥ half of a
 * single block's deviation is noise)".
 *
 * The other half of that rule is the direction of response to a shortfall:
 * "raise dose before lowering the goal" (Montero & Lundby 2017 — non-response
 * was abolished by adding training time, not by accepting it). This module
 * only measures; `feasibilityScreen` reports the dose limitation first and the
 * revised projection second, in that order, for exactly that reason.
 */

import {
  RESPONSE_MIN_WEEKS,
  RESPONSE_SHRINKAGE_WEIGHT,
  RESPONSE_FULL_WEIGHT_WEEKS,
  RESPONSE_MAX_RATE_MULTIPLE,
  RESPONSE_MIN_RATE_MULTIPLE,
  RUN_TEST_NOISE_FRACTION,
  ONE_RM_TEST_NOISE_FRACTION,
} from "./constants";

/** One stored diagnostic run, reduced to the two numbers a response estimate needs. */
export interface ProfileObservation {
  /** ISO timestamp of the diagnostic run. */
  generatedAt: string;
  /** The athlete's predicted 5k at that point, in seconds. */
  predicted5kS: number;
  /** Their competition-lift 1RMs at that point. */
  oneRms: Record<string, number>;
}

export interface ObservedResponse {
  /** Fractional 5k-time improvement per 12-week block, as this athlete's own logged history shows it. Null when it cannot be measured. */
  endurancePerBlock: number | null;
  /** Fractional total improvement per 12-week block. Null when it cannot be measured. */
  strengthPerBlock: number | null;
  /** How many weeks of observation the estimate rests on. */
  weeksObserved: number;
  /** How much weight the blend gives the observation, 0 to RESPONSE_SHRINKAGE_WEIGHT. */
  weight: number;
  /** True when the movement is inside the test's own noise, so it is reported as "no signal yet" rather than as a rate. */
  withinNoise: { endurance: boolean; strength: boolean };
}

const WEEK_MS = 7 * 86_400_000;

function totalOf(oneRms: Record<string, number>): number {
  return ["squat", "bench", "deadlift"].reduce((s, l) => s + (oneRms[l] ?? 0), 0);
}

/**
 * The athlete's own rate of change across their logged diagnostic history.
 *
 * Takes the earliest and latest observation at least `RESPONSE_MIN_WEEKS`
 * apart. Deliberately a two-point slope rather than a regression: the series
 * is short, unevenly spaced, and its endpoints are the two the athlete would
 * compare themselves. A regression over four noisy points implies a precision
 * this data does not have.
 *
 * Returns nulls rather than zero where nothing can be measured. "We have not
 * seen you improve yet" and "you are not improving" are different statements
 * and only one of them is supported by four weeks of data.
 */
export function estimateObservedResponse(
  history: ProfileObservation[],
  now: Date = new Date()
): ObservedResponse | null {
  const ordered = [...history]
    .filter((h) => Number.isFinite(new Date(h.generatedAt).getTime()))
    .sort((a, b) => new Date(a.generatedAt).getTime() - new Date(b.generatedAt).getTime());
  if (ordered.length < 2) return null;

  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  const weeksObserved = (new Date(last.generatedAt).getTime() - new Date(first.generatedAt).getTime()) / WEEK_MS;
  if (weeksObserved < RESPONSE_MIN_WEEKS) return null;
  // A diagnosis from months ago says nothing about the block being run now.
  const weeksStale = (now.getTime() - new Date(last.generatedAt).getTime()) / WEEK_MS;
  if (weeksStale > RESPONSE_MIN_WEEKS * 2) return null;

  const blocks = weeksObserved / 12;
  const weight = RESPONSE_SHRINKAGE_WEIGHT * Math.min(1, weeksObserved / RESPONSE_FULL_WEIGHT_WEEKS);

  // Endurance: a FALL in the 5k time is improvement.
  let endurancePerBlock: number | null = null;
  let enduranceWithinNoise = false;
  if (first.predicted5kS > 0 && last.predicted5kS > 0) {
    const change = (first.predicted5kS - last.predicted5kS) / first.predicted5kS;
    enduranceWithinNoise = Math.abs(change) < RUN_TEST_NOISE_FRACTION;
    if (!enduranceWithinNoise) endurancePerBlock = change / blocks;
  }

  let strengthPerBlock: number | null = null;
  let strengthWithinNoise = false;
  const firstTotal = totalOf(first.oneRms);
  const lastTotal = totalOf(last.oneRms);
  if (firstTotal > 0 && lastTotal > 0) {
    const change = (lastTotal - firstTotal) / firstTotal;
    strengthWithinNoise = Math.abs(change) < ONE_RM_TEST_NOISE_FRACTION;
    if (!strengthWithinNoise) strengthPerBlock = change / blocks;
  }

  if (endurancePerBlock == null && strengthPerBlock == null && !enduranceWithinNoise && !strengthWithinNoise) {
    return null;
  }

  return {
    endurancePerBlock,
    strengthPerBlock,
    weeksObserved,
    weight,
    withinNoise: { endurance: enduranceWithinNoise, strength: strengthWithinNoise },
  };
}

/**
 * The prior, moved toward what this athlete has actually done.
 *
 * Clamped both ways. An athlete who improved fast for four weeks is not
 * thereby a different athlete — the clamp is what stops one good block
 * projecting a year of the same, which is the error every training app makes
 * and the reason the engine's own projection needed rebuilding in the first
 * place.
 */
export function blendRate(prior: number, observedPerBlock: number | null, weight: number, blocks: number): number {
  if (observedPerBlock == null || prior <= 0) return prior;
  // The prior is expressed for the whole horizon; the observation is per
  // block. Compare like with like before blending.
  const priorPerBlock = prior / Math.max(blocks, 1e-6);
  const blendedPerBlock = priorPerBlock * (1 - weight) + observedPerBlock * weight;
  const clamped = Math.min(
    priorPerBlock * RESPONSE_MAX_RATE_MULTIPLE,
    Math.max(priorPerBlock * RESPONSE_MIN_RATE_MULTIPLE, blendedPerBlock)
  );
  return Math.max(0, clamped * blocks);
}
