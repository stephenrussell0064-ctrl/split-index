/**
 * Per-segment race splits for a chosen pacing strategy.
 *
 * The engine already answers "what pace should I average" (`racePacing` in
 * `hpe/progression.ts` — target pace, plus a slower first kilometre when the
 * race follows a meet). What it does not answer is the question an athlete
 * standing on a start line actually has: *what should my watch say at each
 * kilometre*. A single average pace is not a plan you can run to, because
 * nobody runs an average — they run kilometre one, then kilometre two.
 *
 * So this turns the target into splits, under a strategy the athlete picks.
 *
 * The load-bearing property is arithmetic: **the splits must sum to the target
 * time exactly**. A pacing card whose kilometres add up to 19:57 for a 20:00
 * target is worse than no card at all, because the athlete trusts it and comes
 * up short at the line. That is guaranteed here by construction rather than by
 * rounding luck — segment times are derived by differencing rounded CUMULATIVE
 * times, with the last cumulative pinned to the target, so every rounding error
 * is absorbed inside the race rather than escaping past the finish.
 *
 * Presentation-layer only. Nothing here feeds back into the engine.
 */

export type PacingStrategy = "even" | "negative" | "fast_start";

export interface PacingStrategyMeta {
  id: PacingStrategy;
  /** Short enough for a segmented control at 375px. */
  label: string;
  /** One line, on the strategy's own terms. */
  summary: string;
}

export const PACING_STRATEGIES: PacingStrategyMeta[] = [
  {
    id: "even",
    label: "Even",
    summary: "The same pace every kilometre. The cheapest way to run a given time, and what most PBs look like.",
  },
  {
    id: "negative",
    label: "Negative split",
    summary:
      "Start controlled, finish faster than you started. Costs the least in the last third, which is where races are lost.",
  },
  {
    id: "fast_start",
    label: "Hard start, strong finish",
    summary:
      "Go out quick, hold the middle, close hard. The middle has to be slower than target to pay for both ends — that is the trade.",
  },
];

/**
 * How far each end deviates from the average, as a fraction of pace.
 *
 * Deliberately small. A 2% spread on a 20-minute 5k is about 5 s/km between
 * the opening and closing kilometre, which is a real, runnable difference; the
 * "aggressive negative split" numbers people quote are usually the difference
 * between a good race and a bad one rather than a plan to execute.
 */
const NEGATIVE_SPREAD = 0.02;
/** The opening kilometre of a hard start, relative to the average of the race. */
const FAST_START_OPEN = 0.03;
/** And its closing one. */
const FAST_START_CLOSE = 0.02;

export interface PaceSegment {
  /** "1 km", "2 km" … or "5-10 km" for multi-kilometre segments. */
  label: string;
  fromKm: number;
  toKm: number;
  /** Whole seconds for this segment alone. Sums across segments equal `totalS` exactly. */
  splitS: number;
  /** Whole seconds elapsed at the end of this segment — what the watch shows. */
  cumulativeS: number;
  paceSPerKm: number;
  /** Versus target pace. Negative is faster. */
  deltaSPerKm: number;
}

export interface PacingPlan {
  strategy: PacingStrategy;
  distanceKm: number;
  /** The target, unchanged. Every segment is derived from it, never the other way round. */
  totalS: number;
  targetPaceSPerKm: number;
  segments: PaceSegment[];
}

/**
 * Relative time-per-kilometre for each segment, before normalisation.
 *
 * These are shape only. `buildPacingPlan` scales whatever comes back so the
 * total lands exactly on the target, which is why the numbers here can be read
 * as "how this race feels" rather than having to be balanced by hand.
 */
function segmentWeights(strategy: PacingStrategy, n: number): number[] {
  if (n <= 1) return [1];
  switch (strategy) {
    case "even":
      return Array.from({ length: n }, () => 1);
    case "negative":
      // Linear from slower-than-average to faster-than-average.
      return Array.from({ length: n }, (_, i) => 1 + NEGATIVE_SPREAD - (2 * NEGATIVE_SPREAD * i) / (n - 1));
    case "fast_start":
      // Both ends quick. Normalisation then pushes the middle out past the
      // average, which is the honest consequence of spending at both ends.
      return Array.from({ length: n }, (_, i) => {
        if (i === 0) return 1 - FAST_START_OPEN;
        if (i === n - 1) return 1 - FAST_START_CLOSE;
        return 1;
      });
  }
}

/** Segment size that keeps the card readable: never more than 8 rows, never fewer than 3. */
export function segmentSizeKm(distanceKm: number): number {
  if (distanceKm <= 8) return 1;
  if (distanceKm <= 16) return 2;
  return Math.round(distanceKm / 6);
}

function segmentLabel(fromKm: number, toKm: number): string {
  const round = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
  if (toKm - fromKm <= 1.0001) return `${round(toKm)} km`;
  return `${round(fromKm)}-${round(toKm)} km`;
}

/**
 * Splits for one strategy at one target time.
 *
 * `totalS` is treated as immutable: the athlete chose the time, and a pacing
 * plan that quietly re-targets it is answering a question they did not ask.
 */
export function buildPacingPlan(
  totalS: number,
  distanceKm: number,
  strategy: PacingStrategy
): PacingPlan {
  const target = Math.max(1, Math.round(totalS));
  const dist = Math.max(0.1, distanceKm);
  const targetPaceSPerKm = target / dist;

  // Segment boundaries. The final one absorbs any remainder — a 5k split into
  // 2km chunks ends on a 1km segment rather than on a phantom 6th kilometre.
  const size = segmentSizeKm(dist);
  const bounds: number[] = [];
  for (let km = size; km < dist - 1e-6; km += size) bounds.push(Number(km.toFixed(3)));
  bounds.push(dist);

  const n = bounds.length;
  const weights = segmentWeights(strategy, n);

  // Raw time per segment = its relative pace × its length.
  let previous = 0;
  const raw: number[] = [];
  for (let i = 0; i < n; i += 1) {
    raw.push(weights[i]! * (bounds[i]! - previous));
    previous = bounds[i]!;
  }
  const rawTotal = raw.reduce((s, v) => s + v, 0);

  // Cumulative-then-difference. Rounding each split independently would let
  // the errors accumulate and miss the target by a second or two; rounding the
  // cumulative and pinning the last one to `target` cannot.
  const segments: PaceSegment[] = [];
  let rawRunning = 0;
  let previousCumulative = 0;
  previous = 0;
  for (let i = 0; i < n; i += 1) {
    rawRunning += raw[i]!;
    const cumulative = i === n - 1 ? target : Math.round((rawRunning / rawTotal) * target);
    const splitS = cumulative - previousCumulative;
    const segKm = bounds[i]! - previous;
    segments.push({
      label: segmentLabel(previous, bounds[i]!),
      fromKm: previous,
      toKm: bounds[i]!,
      splitS,
      cumulativeS: cumulative,
      paceSPerKm: splitS / segKm,
      deltaSPerKm: splitS / segKm - targetPaceSPerKm,
    });
    previousCumulative = cumulative;
    previous = bounds[i]!;
  }

  return { strategy, distanceKm: dist, totalS: target, targetPaceSPerKm, segments };
}

/** m:ss. Used for both a split and a pace, which are the same shape at these distances. */
export function mmss(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** h:mm:ss when the race is long enough to need it, m:ss when it is not. */
export function clockTime(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 3600) return mmss(s);
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** "+4s" / "-3s" / "on target" against the average pace. */
export function deltaLabel(deltaSPerKm: number): string {
  const rounded = Math.round(deltaSPerKm);
  if (rounded === 0) return "on target";
  return rounded > 0 ? `+${rounded}s/km` : `${rounded}s/km`;
}
