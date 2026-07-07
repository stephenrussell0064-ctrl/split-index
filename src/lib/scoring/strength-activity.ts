/**
 * Split Index — Strength scoring engine ("The Lab")
 * -------------------------------------------------
 * Per-exercise strength scoring on a 0–1000 scale, expressed as strength
 * RELATIVE TO BODYWEIGHT against recognised standards.
 *
 * FREE tier reads `score` and `estimated1RM`.
 * PREMIUM tier additionally surfaces `dots`, `bodyweightRatio`, `tier`,
 * and `percentileVsStandards`.
 *
 * Sources (verify on review):
 *  - 1RM:  Epley (1985) and Brzycki (1993)
 *  - DOTS: OpenPowerlifting coefficient set (replaces Wilks); confirm current
 *          coefficients + female set against openpowerlifting.org before ship.
 *  - Ratio tiers: ExRx.net / Strength Level style bodyweight multiples.
 */

import type { Sex } from './cardio-activity';

export type Lift =
  | 'squat' | 'bench' | 'deadlift'      // the powerlifting total (DOTS-eligible)
  | 'ohp' | 'pullup';                   // supplementary (ratio-scored)

export interface StrengthInput {
  lift: Lift;
  weightKg: number;        // load lifted (added load for pullups; see note)
  reps: number;            // reps performed at weightKg (1 = a true 1RM)
  bodyweightKg: number;
  sex: Sex;
  oneRepMaxOverride?: number; // if the user logged a true tested 1RM
  formula?: 'epley' | 'brzycki';
}

export interface StrengthResult {
  score: number;                    // 0–1000, the per-exercise Lab contribution
  estimated1RM: number;             // kg
  bodyweightRatio: number;          // 1RM / bodyweight
  dots: number | null;              // only meaningful on the big three, individually indicative
  tier: string;                     // Untrained … World Class
  percentileVsStandards: number;    // 0–100 against ratio standards
  flags: string[];
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/** Epley: 1RM = w × (1 + reps/30). Brzycki: 1RM = w × 36 / (37 − reps). */
export function estimate1RM(weightKg: number, reps: number, formula: 'epley' | 'brzycki' = 'epley'): number {
  if (reps <= 1) return weightKg;
  if (formula === 'brzycki') {
    if (reps >= 37) return weightKg * 2; // guard asymptote
    return weightKg * 36 / (37 - reps);
  }
  return weightKg * (1 + reps / 30);
}

/**
 * DOTS score. Primary cross-bodyweight comparison for the big three.
 * NOTE: DOTS is defined on the squat+bench+deadlift TOTAL. Applied to a single
 * lift it's only indicative — we expose it per-lift for premium insight but
 * combine at the total level in strengthIndex().
 */
const DOTS_COEFF: Record<Sex, [number, number, number, number, number]> = {
  // a·bw^4 + b·bw^3 + c·bw^2 + d·bw + e
  male:   [-0.000001093, 0.0007391293, -0.1918759221, 24.0900756, -307.75076],
  female: [-0.0000010706, 0.0005158568, -0.1126655495, 13.6175032, -57.96288],
};

export function dotsScore(totalKg: number, bodyweightKg: number, sex: Sex): number {
  const [a, b, c, d, e] = DOTS_COEFF[sex];
  const bw = bodyweightKg;
  const denom = a * bw ** 4 + b * bw ** 3 + c * bw ** 2 + d * bw + e;
  return totalKg * 500 / denom;
}

/**
 * Bodyweight-ratio standards by lift (approximate male intermediate anchors;
 * scaled by sex). These are the tier *midpoints* used to derive a percentile.
 * Confirm against ExRx.net tables on review.
 */
const RATIO_ANCHORS: Record<Lift, number> = {
  squat: 1.5, bench: 1.0, deadlift: 2.0, ohp: 0.6, pullup: 0.33, // bodyweight multiples ~intermediate
};
const TIERS = ['Untrained', 'Novice', 'Intermediate', 'Advanced', 'Elite', 'World Class'];

function tierFromRatio(ratio: number, anchor: number): { tier: string; pct: number } {
  // Map ratio to 0–100 where `anchor` sits at ~50 (intermediate midpoint).
  const norm = clamp((ratio / (anchor * 2)) * 100, 0, 100);
  const idx = clamp(Math.floor(norm / (100 / TIERS.length)), 0, TIERS.length - 1);
  return { tier: TIERS[idx], pct: Math.round(norm) };
}

/**
 * Per-exercise strength score (0–1000).
 * Built from bodyweight-relative strength so a lighter athlete lifting big for
 * their size scores correctly against a heavier one.
 */
export function scoreStrengthActivity(input: StrengthInput): StrengthResult {
  const flags: string[] = [];
  const oneRM = input.oneRepMaxOverride && input.oneRepMaxOverride > 0
    ? input.oneRepMaxOverride
    : estimate1RM(input.weightKg, input.reps, input.formula);
  if (!input.oneRepMaxOverride && input.reps > 10) flags.push('1rm-estimate-low-confidence');

  const ratio = oneRM / input.bodyweightKg;
  const anchor = RATIO_ANCHORS[input.lift];
  const { tier, pct } = tierFromRatio(ratio, anchor);

  // Score: percentile-driven, so 0–1000 tracks standing against standards.
  const score = Math.round(clamp(pct * 10, 0, 1000));

  const isBigThree = input.lift === 'squat' || input.lift === 'bench' || input.lift === 'deadlift';
  const dots = isBigThree ? Math.round(dotsScore(oneRM, input.bodyweightKg, input.sex) * 10) / 10 : null;

  return {
    score,
    estimated1RM: Math.round(oneRM * 10) / 10,
    bodyweightRatio: Math.round(ratio * 100) / 100,
    dots,
    tier,
    percentileVsStandards: pct,
    flags,
  };
}
