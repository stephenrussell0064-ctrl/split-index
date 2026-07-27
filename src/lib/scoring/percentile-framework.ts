/**
 * Split Index — unified percentile-to-score framework
 * (CLAUDE-CODE-BRIEF-scoring-calibration-rewrite.md, Part A)
 * -----------------------------------------------------------
 * Every activity's anchor table (cardio and strength) is built the same way:
 * find the real time/lift in the best available population data that
 * corresponds to each of the percentiles below, then assign it the matching
 * score. This is what makes "Advanced" mean the same rarity in rowing as in
 * bench press as in the 5k — previously anchors were set per-activity by
 * feel (own PB, a friend's numbers), which is the root cause of the
 * generosity drift the QA pass found (SPLITINDEX-SCORING-QA-FINDINGS.md).
 *
 * "Percentile" means "you outperform this % of the reference population" —
 * the same convention Strength Level and RowingRegimen both already use.
 *
 * Reference population judgment call: "all race participants" (already
 * self-selected, fitter than general population) and "everyone who has ever
 * logged a Concept2 piece" give different percentile curves. Anchor tables
 * derived from this framework default to the more general/inclusive
 * population where sourcing allows (Concept2 logbook for rowing, general
 * strength-standards databases for lifts) — the more conservative,
 * "not favourable" choice. Long-term plan: replace with live percentiles
 * from Split Index's own user base once there's enough volume.
 */

/** [percentile, score] — the shared scale every anchor table is built against. */
export const PERCENTILE_TO_SCORE = {
  5: 125, // bottom of Beginner tier
  20: 250, // Beginner/Intermediate boundary
  50: 475, // Intermediate/Semi-Pro boundary
  80: 725, // Semi-Pro/Advanced boundary
  95: 850, // Advanced/Elite boundary
  99: 925, // Elite/World Class boundary
} as const;

export type ReferencePercentile = keyof typeof PERCENTILE_TO_SCORE;

const PERCENTILE_POINTS: Array<[percentile: number, score: number]> = Object.entries(
  PERCENTILE_TO_SCORE
).map(([p, s]) => [Number(p), s]);

const MAX_SCORE = 999;
/** Beyond the 99th percentile, approach the ceiling asymptotically rather than linearly — a 99.9th-percentile/world-record-adjacent performance is much rarer than the 95th-to-99th gap alone would suggest. */
const TAIL_START_PERCENTILE = 99;
const TAIL_START_SCORE = PERCENTILE_TO_SCORE[99];
const TAIL_APPROACH_RATE = 0.15; // higher = faster approach to MAX_SCORE per percentile point past 99

/**
 * Score for a given percentile against the shared framework above. Linear
 * interpolation between the defined points; below the 5th percentile
 * continues the 5-20 slope down; beyond the 99th percentile, asymptotically
 * approaches 999 (world-record-adjacent) rather than extrapolating linearly.
 */
export function scoreForPercentile(percentile: number): number {
  if (percentile >= TAIL_START_PERCENTILE) {
    const beyond = percentile - TAIL_START_PERCENTILE;
    return Math.min(
      MAX_SCORE,
      TAIL_START_SCORE + (MAX_SCORE - TAIL_START_SCORE) * (1 - Math.exp(-beyond * TAIL_APPROACH_RATE))
    );
  }

  if (percentile <= PERCENTILE_POINTS[0][0]) {
    const [p0, s0] = PERCENTILE_POINTS[0];
    const [p1, s1] = PERCENTILE_POINTS[1];
    const slope = (s1 - s0) / (p1 - p0);
    return Math.max(0, s0 + slope * (percentile - p0));
  }

  for (let i = 0; i < PERCENTILE_POINTS.length - 1; i++) {
    const [p0, s0] = PERCENTILE_POINTS[i];
    const [p1, s1] = PERCENTILE_POINTS[i + 1];
    if (percentile >= p0 && percentile <= p1) {
      const t = (percentile - p0) / (p1 - p0);
      return s0 + (s1 - s0) * t;
    }
  }

  return TAIL_START_SCORE;
}

/**
 * Inverse of scoreForPercentile — given any 0-999 Split Index score, returns
 * "you outperform N% of the reference population" against the same
 * published/derived standards the score curve itself was calibrated from.
 * Unlike a peer leaderboard, this needs zero Split Index users of its own to
 * be meaningful — it's the standards-based comparison Slice C leans on
 * before real platform scale exists.
 */
export function percentileForScore(score: number): number {
  const clamped = Math.max(0, Math.min(MAX_SCORE, score));

  if (clamped >= TAIL_START_SCORE) {
    if (clamped >= MAX_SCORE) return 99.9;
    const ratio = (MAX_SCORE - clamped) / (MAX_SCORE - TAIL_START_SCORE);
    const beyond = -Math.log(ratio) / TAIL_APPROACH_RATE;
    return Math.min(99.9, TAIL_START_PERCENTILE + beyond);
  }

  const [p0, s0] = PERCENTILE_POINTS[0];
  if (clamped <= s0) {
    const [p1, s1] = PERCENTILE_POINTS[1];
    const slope = (p1 - p0) / (s1 - s0);
    return Math.max(0, p0 + slope * (clamped - s0));
  }

  for (let i = 0; i < PERCENTILE_POINTS.length - 1; i++) {
    const [pA, sA] = PERCENTILE_POINTS[i];
    const [pB, sB] = PERCENTILE_POINTS[i + 1];
    if (clamped >= sA && clamped <= sB) {
      const t = (clamped - sA) / (sB - sA);
      return pA + (pB - pA) * t;
    }
  }

  return TAIL_START_PERCENTILE;
}

/** Same tier labels/boundaries the score curve was calibrated against (StrengthTier in split-strength-engine.ts uses the same cutoffs) — kept here too since a generic Split Index score isn't strength-specific. */
const STANDARDS_TIERS: Array<{ label: string; minScore: number }> = [
  { label: "Beginner", minScore: 0 },
  { label: "Intermediate", minScore: PERCENTILE_TO_SCORE[20] },
  { label: "Semi-Pro", minScore: PERCENTILE_TO_SCORE[50] },
  { label: "Advanced", minScore: PERCENTILE_TO_SCORE[80] },
  { label: "Elite", minScore: PERCENTILE_TO_SCORE[95] },
  { label: "World Class", minScore: PERCENTILE_TO_SCORE[99] },
];

/** The next standards-based tier above this score, and how many points away it is — a real, closeable target that needs no peer-user data at all. Null once already in the top tier. */
export function nextStandardsTierTarget(
  score: number
): { label: string; pointsToClose: number } | null {
  const next = STANDARDS_TIERS.find((t) => t.minScore > score);
  if (!next) return null;
  return { label: next.label, pointsToClose: next.minScore - score };
}
