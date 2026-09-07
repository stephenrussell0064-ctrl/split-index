/**
 * Split Index — Index aggregation
 * -------------------------------
 * Rolls per-activity scores up into the three headline numbers.
 *
 * The headline is always the combined Split Index (user feedback: "Why is
 * the main score at the top of the dashboard not the combined score between
 * the lab and cardio, it should be this"). It used to switch to a
 * single-side Lab/Engine Index based on the athlete's onboarding profile —
 * which meant a "cardio"-profile athlete who also logged gym sessions never
 * saw their strength side reflected in the one number the app leads with.
 * Profile still isn't discarded entirely: `split` already falls back to
 * whichever single side has data (see below), so a gym-only or cardio-only
 * athlete's headline still equals their one populated side automatically —
 * no special-casing needed.
 *
 * The blend is intentionally NOT a naive average. A hybrid athlete who trains
 * both sides evenly should not be dragged down by having fewer sessions on one
 * side, so each side is scored on its own recent best-and-consistency, then
 * combined by a user-adjustable weight (default 50/50).
 */

export type Profile = 'gym' | 'cardio' | 'hybrid';

export interface ActivityScore {
  side: 'lab' | 'engine';
  score: number;        // 0–1000 from the per-activity engines
  confidence: number;   // 0–1
  date: string;         // ISO
}

export interface IndexResult {
  labIndex: number | null;
  engineIndex: number | null;
  splitIndex: number | null;
  headline: number;
  headlineLabel: 'Lab Index' | 'Engine Index' | 'Split Index';
  breakdown: { lab: number | null; engine: number | null; weightLab: number; weightEngine: number };
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/**
 * How many of the most recent same-side sessions the headline index rolls up
 * from — deliberately small so the number tracks current fitness, not a
 * lifetime average dragged down by sessions from months ago (user feedback).
 */
const RECENT_WINDOW_SIZE = 10;

/**
 * Side index from recent activities: a confidence-weighted blend of the
 * athlete's *best* recent effort (ceiling = what they're capable of) and their
 * *median* recent effort (floor = what they hold consistently). 70/30 toward
 * consistency so one lucky session can't inflate the number.
 */
function sideIndex(activities: ActivityScore[], side: 'lab' | 'engine'): number | null {
  const rows = activities
    .filter(a => a.side === side)
    .sort((a, b) => +new Date(b.date) - +new Date(a.date))
    .slice(0, RECENT_WINDOW_SIZE);
  if (rows.length === 0) return null;

  const weighted = rows.map(r => ({ v: r.score, w: clamp(r.confidence, 0.1, 1) }));
  const sorted = [...weighted].sort((a, b) => a.v - b.v);
  const median = sorted[Math.floor(sorted.length / 2)].v;
  const best = Math.max(...weighted.map(r => r.v));

  // confidence-weighted mean pulls toward well-evidenced sessions
  const totalW = weighted.reduce((s, r) => s + r.w, 0);
  const wMean = weighted.reduce((s, r) => s + r.v * r.w, 0) / totalW;

  const combined = 0.5 * wMean + 0.2 * best + 0.3 * median;
  return Math.round(clamp(combined, 0, 1000));
}

export function aggregateSideIndex(
  activities: ActivityScore[],
  side: "lab" | "engine"
): number | null {
  return sideIndex(activities, side);
}

/**
 * How much confident evidence a side is standing on, 0–1.
 *
 * Five well-evidenced sessions is a real read on a side; one is a data point.
 * Summing the per-activity confidences rather than counting rows means a
 * session the scorer itself was unsure about — a run with no heart rate, a
 * gym session of one working set — counts for less, which is the same signal
 * `sideIndex` already blends by.
 */
const FULL_EVIDENCE_SESSIONS = 5;

function sideEvidence(activities: ActivityScore[], side: 'lab' | 'engine'): number {
  const confidence = activities
    .filter(a => a.side === side)
    .sort((a, b) => +new Date(b.date) - +new Date(a.date))
    .slice(0, RECENT_WINDOW_SIZE)
    .reduce((sum, a) => sum + clamp(a.confidence, 0, 1), 0);

  return clamp(confidence / FULL_EVIDENCE_SESSIONS, 0, 1);
}

export function computeIndexes(
  activities: ActivityScore[],
  profile: Profile,
  weightLab = 0.5
): IndexResult {
  const lab = sideIndex(activities, 'lab');
  const engine = sideIndex(activities, 'engine');
  const wLab = clamp(weightLab, 0, 1);
  const wEng = 1 - wLab;

  /*
   * The blend is weighted by EVIDENCE as well as by the athlete's chosen split.
   *
   * A naive `lab * wLab + engine * wEng` is right once both sides are
   * established and badly wrong before that: with one side populated the
   * headline is that side, and the instant the other logs its first session the
   * headline jumps straight to the full blend. The UAT personas caught this as a
   * 193-point move on one ordinary run — half the gap between the two sides,
   * delivered in a single step, off a single data point.
   *
   * Scaling each side's weight by its evidence and renormalising makes the new
   * side arrive gradually instead. The limits are unchanged, which is what makes
   * this safe: a side with no sessions contributes nothing (so a single-sport
   * athlete still sees exactly their one side), and two established sides give
   * exactly the configured weighting with no residual damping.
   */
  let split: number | null = null;
  if (lab !== null && engine !== null) {
    /*
     * Each side's weight is scaled by how much evidence stands behind it, then
     * renormalised. A side with ten solid sessions carries its full configured
     * weight; a side with one carries a fifth of it.
     *
     * This stops a single session on a newly-taken-up discipline yanking an
     * established athlete's headline — the case the UAT swimmer persona shows,
     * where two gym sessions a week for shoulder health drag a number built on
     * forty swims.
     *
     * What it deliberately does NOT do is damp the case where BOTH sides are
     * thin. There the scaling cancels and the plain weighting returns, which is
     * correct: an athlete with one gym session and one run has genuinely
     * doubled what is known about them, and a headline that moves a long way on
     * their second ever session is information arriving, not instability. An
     * earlier attempt to suppress that anchored the headline on whichever side
     * had more evidence, which inverted on ties — one confident run outweighed
     * one hesitant gym session and the brand-new side became the anchor.
     *
     * Limits, which is what makes this safe under the headline number:
     *   · a side with no sessions leaves the other showing unchanged;
     *   · two established sides give exactly the configured weighting, with no
     *     residual damping.
     */
    const effLab = wLab * sideEvidence(activities, 'lab');
    const effEng = wEng * sideEvidence(activities, 'engine');
    const totalWeight = effLab + effEng;

    split =
      totalWeight > 0
        ? Math.round((lab * effLab + engine * effEng) / totalWeight)
        : // Both sides exist but nothing carries any confidence — fall back to
          // the plain weighting rather than dividing by zero.
          Math.round(lab * wLab + engine * wEng);
  } else {
    split = lab ?? engine; // only one side logged so far
  }

  // Headline is always the combined Split Index, regardless of onboarding
  // profile (user feedback — see file header). `split` already collapses to
  // whichever single side has data when the other is null, so a gym-only or
  // cardio-only athlete's headline still equals their one populated side
  // without needing to branch on `profile` here.
  const headline: number = split ?? 0;
  const headlineLabel: IndexResult['headlineLabel'] = 'Split Index';

  return {
    labIndex: lab,
    engineIndex: engine,
    splitIndex: split,
    headline,
    headlineLabel,
    breakdown: { lab, engine, weightLab: wLab, weightEngine: wEng },
  };
}

/** Linear-regression projection of the headline index N days out. */
export function projectIndex(
  history: { date: string; value: number }[],
  daysAhead: number
): { projected: number; slopePerWeek: number; r2: number } | null {
  if (history.length < 3) return null;
  const t0 = +new Date(history[0].date);
  const xs = history.map(h => (+new Date(h.date) - t0) / 86400000); // days
  const ys = history.map(h => h.value);
  const n = xs.length;
  const sx = xs.reduce((a, b) => a + b, 0);
  const sy = ys.reduce((a, b) => a + b, 0);
  const sxy = xs.reduce((a, b, i) => a + b * ys[i], 0);
  const sxx = xs.reduce((a, b) => a + b * b, 0);
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  const intercept = (sy - slope * sx) / n;

  const meanY = sy / n;
  const ssTot = ys.reduce((a, b) => a + (b - meanY) ** 2, 0);
  const ssRes = ys.reduce((a, b, i) => a + (b - (slope * xs[i] + intercept)) ** 2, 0);
  const r2 = ssTot === 0 ? 0 : 1 - ssRes / ssTot;

  const lastX = xs[xs.length - 1];
  const projected = Math.round(slope * (lastX + daysAhead) + intercept);
  return { projected, slopePerWeek: Math.round(slope * 7 * 10) / 10, r2: Math.round(r2 * 100) / 100 };
}
