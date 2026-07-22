/**
 * Interval & fartlek scoring — work-piece pace, not whole-session average.
 * --------------------------------------------------------------------------
 * A structured interval session's benchmark-equivalent time comes from the
 * work-piece pace (work distance ÷ work time), not the whole-session average
 * pace — averaging in the rest periods dilutes a hard session down toward an
 * easy one and erases the very thing that makes it a quality effort. Ported
 * from an earlier session-type-matrix branch's `interval-scoring.ts` and
 * grafted onto the simpler calibrated-anchor-table architecture actually in
 * production (see cardio-activity.ts, cardio-predictions.ts) — the rest-ratio
 * conversion below is the same math, but the result now feeds the existing
 * Riegel + HR-bonus + personalization pipeline instead of a separate
 * 5-component formula.
 *
 * Fartlek (unstructured "on/off" speed play) is scored the same way once its
 * "on" distance + time are resolved to a work-piece pace and rest ratio
 * against the remainder of the session.
 */

/** Interval → equivalent pace conversion: equivPace = workPace × (1 + BASE_OFFSET + REST_COEF × min(restSec/workSec, REST_CAP)). Harder rest (more recovery per unit of work) means the work pace understates true fitness, so the conversion scales the equivalent pace slower to compensate. */
const INTERVAL_BASE_OFFSET = 0.03;
const INTERVAL_REST_COEF = 0.02;
const INTERVAL_REST_CAP = 1.5;

export interface IntervalWorkPiece {
  reps: number;
  /** Distance per rep, in meters. */
  workDistanceMeters: number;
  /** Work time per rep, in seconds. */
  workSecondsPerRep: number;
  /** Rest between reps, in seconds. */
  restSeconds: number;
  /** Optional — avg HR during the work reps only (whole-session avg HR blends work and rest and is a poor efficiency signal for structured intervals). */
  workAvgHeartRate?: number | null;
}

export interface FartlekOnPiece {
  /** Total distance covered during "on" (hard-effort) pieces, in meters. */
  onDistanceMeters: number;
  /** Total time spent in "on" pieces, in seconds. */
  onSeconds: number;
  /** Total session duration, in seconds — the remainder after `onSeconds` is treated as rest. */
  totalDurationSeconds: number;
  /** Optional — avg HR during the "on" pieces only. */
  onAvgHeartRate?: number | null;
}

function intervalRestRatioEquivalentPaceSecPerKm(
  workPaceSecPerKm: number,
  restSeconds: number,
  workSeconds: number
): number {
  if (workSeconds <= 0) return workPaceSecPerKm;
  const restRatio = Math.min(restSeconds / workSeconds, INTERVAL_REST_CAP);
  return workPaceSecPerKm * (1 + INTERVAL_BASE_OFFSET + INTERVAL_REST_COEF * restRatio);
}

/** Total work distance across all reps (excludes rest). */
export function intervalTotalWorkDistanceMeters(piece: IntervalWorkPiece): number {
  return piece.reps * piece.workDistanceMeters;
}

/** Race-equivalent pace (sec/km) for a structured interval session, via the rest-ratio conversion. */
export function intervalEquivalentPaceSecPerKm(piece: IntervalWorkPiece): number {
  if (piece.workDistanceMeters <= 0 || piece.workSecondsPerRep <= 0) return 0;
  const workPaceSecPerKm = (piece.workSecondsPerRep / piece.workDistanceMeters) * 1000;
  const totalWorkSeconds = piece.reps * piece.workSecondsPerRep;
  const totalRestSeconds = Math.max(0, piece.reps - 1) * piece.restSeconds;
  return intervalRestRatioEquivalentPaceSecPerKm(workPaceSecPerKm, totalRestSeconds, totalWorkSeconds);
}

/** Race-equivalent pace (sec/km) for a fartlek session's "on" pieces, via the same rest-ratio conversion. */
export function fartlekEquivalentPaceSecPerKm(piece: FartlekOnPiece): number {
  if (piece.onDistanceMeters <= 0 || piece.onSeconds <= 0) return 0;
  const onPaceSecPerKm = (piece.onSeconds / piece.onDistanceMeters) * 1000;
  const offSeconds = Math.max(0, piece.totalDurationSeconds - piece.onSeconds);
  return intervalRestRatioEquivalentPaceSecPerKm(onPaceSecPerKm, offSeconds, piece.onSeconds);
}

export function isValidIntervalWorkPiece(piece: Partial<IntervalWorkPiece> | null | undefined): piece is IntervalWorkPiece {
  return !!piece && (piece.reps ?? 0) > 0 && (piece.workDistanceMeters ?? 0) > 0 && (piece.workSecondsPerRep ?? 0) > 0;
}

export function isValidFartlekOnPiece(piece: Partial<FartlekOnPiece> | null | undefined): piece is FartlekOnPiece {
  return !!piece && (piece.onDistanceMeters ?? 0) > 0 && (piece.onSeconds ?? 0) > 0;
}
