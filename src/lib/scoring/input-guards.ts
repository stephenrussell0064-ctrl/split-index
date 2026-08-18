import type { SportType } from "@/types";
import { MAX_INDEX, MIN_INDEX } from "@/lib/scoring/constants";

const MAX_DURATION_SECONDS = 24 * 60 * 60; // 24 h
const MAX_DISTANCE_METERS = 500_000; // 500 km
const MAX_WEIGHT_KG = 500;
const MAX_BODYWEIGHT_KG = 300;
/**
 * Absolute ceiling for machine-anchored leg movements. A plate-loaded leg
 * press sled is counterweighted and runs on a ~45° rail, so the number the
 * athlete loads onto it is not comparable to a barbell load: 600–800 kg is an
 * ordinary strong-gym-member entry, not a typo. 1000 kg still catches the
 * fat-finger cases this guard exists for (2250 for 225).
 */
const MAX_MACHINE_WEIGHT_KG = 1000;
const MIN_HEART_RATE_BPM = 20;
const MAX_HEART_RATE_BPM = 250;
const MAX_POWER_WATTS = 2500;
const MAX_PACE_SECONDS = 7200; // 2 h per km / per split — generous upper bound
const MAX_ELEVATION_METERS = 9000;

/**
 * Bodyweight multiple a free-weight / cable lift may not exceed. Six times
 * bodyweight is already beyond any barbell world record, so anything past it
 * is a data-entry error (a 10×BW "bench press" is still rejected).
 */
const MAX_BODYWEIGHT_MULTIPLE = 6;
/**
 * The same sanity check for machine-anchored leg movements. Leverage, a
 * counterweighted sled and a fixed rail mean these genuinely take multiples of
 * what the same athlete can squat — an 80 kg lifter pressing 700 kg on a leg
 * press is unremarkable, so 6×BW (480 kg) rejected real sessions.
 */
const MAX_MACHINE_BODYWEIGHT_MULTIPLE = 12;

/**
 * Exercises whose load is carried by a machine frame rather than by the
 * athlete's skeleton, so the plausible-load ceiling is set by the machine, not
 * by bodyweight-relative strength.
 *
 * Deliberately narrow: the leg-press family (including the calf raise done on
 * the same sled), the plate-loaded squat machines — hack, pendulum and belt,
 * all of which carry the load on a frame rather than on the spine — and the
 * sleds. Everything else —
 * including machine chest/shoulder presses, which are loaded through the same
 * joints as their barbell equivalents — keeps the free-weight ceiling.
 *
 * Names mirror COMMON_EXERCISES in lib/constants/sports.ts. Kept here rather
 * than as another field on ExerciseDefinition so the scoring guards stay
 * self-contained; if a third piece of per-exercise metadata appears, this
 * belongs next to `tracking` on ExerciseDefinition instead.
 */
const MACHINE_ANCHORED_EXERCISES = new Set([
  "leg press",
  "single leg press",
  "iso-lateral leg press",
  "leg press calf raise",
  "hack squat",
  "hack squat machine",
  "pendulum squat",
  "belt squat",
  "sled push",
  "sled pull",
]);

/** True for movements whose load ceiling is set by the machine, not the athlete. */
export function isMachineAnchoredLift(exerciseName?: string | null): boolean {
  if (!exerciseName) return false;
  return MACHINE_ANCHORED_EXERCISES.has(exerciseName.trim().toLowerCase());
}

/**
 * Per-exercise load ceilings. Unknown/custom exercise names fall back to the
 * free-weight limits, which is both the common case and the pre-existing
 * behaviour.
 *
 * Exported so the client-side form validator can cap the weight field at the
 * same number the server will accept — a form that permits more than this
 * only produces a whole-session 400 that never names the offending lift.
 */
export function liftWeightLimits(exerciseName?: string | null): {
  maxWeightKg: number;
  maxBodyweightMultiple: number;
} {
  return isMachineAnchoredLift(exerciseName)
    ? { maxWeightKg: MAX_MACHINE_WEIGHT_KG, maxBodyweightMultiple: MAX_MACHINE_BODYWEIGHT_MULTIPLE }
    : { maxWeightKg: MAX_WEIGHT_KG, maxBodyweightMultiple: MAX_BODYWEIGHT_MULTIPLE };
}

export class ScoringInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScoringInputError";
  }
}

/** Server-side guards before invoking score engines. Does not alter coefficient tables. */
export function assertScoringInput(input: {
  sport: SportType;
  durationSeconds: number;
  distanceMeters?: number | null;
  avgHeartRate?: number | null;
  maxHeartRate?: number | null;
  avgPowerWatts?: number | null;
  avgPaceSecondsPerKm?: number | null;
  avgSplitSeconds?: number | null;
  elevationMeters?: number | null;
  splitPacesSec?: number[] | null;
  rpe?: number | null;
  exercises?: Array<{
    /** Optional: absent for callers that only have set data. Selects the load ceiling — see liftWeightLimits. */
    exercise_name?: string;
    sets: Array<{ weight_kg: number; reps: number; rpe?: number | null }>;
  }>;
  /**
   * `gender` is accepted so callers can hand over a whole profile, but it is
   * deliberately NOT validated here — see the note in the body. Only
   * `weight_kg` is guarded, and only as a plausibility range.
   */
  profile?: { weight_kg?: number | null; gender?: import("@/types").Gender | null };
}): void {
  if (!Number.isFinite(input.durationSeconds) || input.durationSeconds <= 0) {
    throw new ScoringInputError("Duration must be greater than zero.");
  }
  if (input.durationSeconds > MAX_DURATION_SECONDS) {
    throw new ScoringInputError("Duration exceeds the maximum allowed session length.");
  }

  if (input.distanceMeters != null) {
    if (!Number.isFinite(input.distanceMeters) || input.distanceMeters < 0) {
      throw new ScoringInputError("Distance cannot be negative.");
    }
    if (input.distanceMeters > MAX_DISTANCE_METERS) {
      throw new ScoringInputError("Distance exceeds the maximum allowed value.");
    }
  }

  for (const [label, hr] of [
    ["Average heart rate", input.avgHeartRate],
    ["Max heart rate", input.maxHeartRate],
  ] as const) {
    if (hr != null && (!Number.isFinite(hr) || hr < MIN_HEART_RATE_BPM || hr > MAX_HEART_RATE_BPM)) {
      throw new ScoringInputError(`${label} is out of the plausible range.`);
    }
  }

  if (
    input.avgPowerWatts != null &&
    (!Number.isFinite(input.avgPowerWatts) || input.avgPowerWatts < 0 || input.avgPowerWatts > MAX_POWER_WATTS)
  ) {
    throw new ScoringInputError("Average power is out of the plausible range.");
  }

  for (const [label, pace] of [
    ["Average pace", input.avgPaceSecondsPerKm],
    ["Average split time", input.avgSplitSeconds],
  ] as const) {
    if (pace != null && (!Number.isFinite(pace) || pace <= 0 || pace > MAX_PACE_SECONDS)) {
      throw new ScoringInputError(`${label} is out of the plausible range.`);
    }
  }

  if (
    input.elevationMeters != null &&
    (!Number.isFinite(input.elevationMeters) || input.elevationMeters < 0 || input.elevationMeters > MAX_ELEVATION_METERS)
  ) {
    throw new ScoringInputError("Elevation gain is out of the plausible range.");
  }

  if (input.splitPacesSec?.length) {
    for (const p of input.splitPacesSec) {
      if (!Number.isFinite(p) || p <= 0 || p > MAX_PACE_SECONDS) {
        throw new ScoringInputError("Split pace data contains an implausible value.");
      }
    }
  }

  if (input.rpe != null && (!Number.isFinite(input.rpe) || input.rpe < 1 || input.rpe > 10)) {
    throw new ScoringInputError("RPE must be between 1 and 10.");
  }

  const bw = input.profile?.weight_kg;
  if (bw != null && (!Number.isFinite(bw) || bw <= 0 || bw > MAX_BODYWEIGHT_KG)) {
    throw new ScoringInputError("Bodyweight is out of the allowed range.");
  }

  /**
   * There is deliberately NO check on gender / scoring basis here.
   *
   * This guard used to throw for anything other than male/female, and it runs
   * on every sport and every submit — so an athlete who answered the
   * onboarding gender question with "Other" or "Prefer not to say" (both
   * offered by GENDERS, both stored happily by the database) could never log a
   * single workout. That is a signup-to-dead-end, and losing the workout is a
   * far worse outcome than an imperfect comparison.
   *
   * Which sex-segregated standards to score against is now resolved, never
   * demanded: see resolveScoringBasis in scoring/adapters.ts, which falls back
   * to a documented default and flags reduced confidence. Nothing about the
   * athlete's profile may block a log from here.
   */

  if (input.sport === "gym" && input.exercises?.length) {
    for (const ex of input.exercises) {
      if (!ex.sets?.length) {
        throw new ScoringInputError("Each exercise needs at least one set.");
      }
      // A leg press is not a bench press: the ceiling follows the movement.
      const limits = liftWeightLimits(ex.exercise_name);
      const named = ex.exercise_name ? `${ex.exercise_name}: ` : "";
      for (const s of ex.sets) {
        if (!Number.isFinite(s.weight_kg) || s.weight_kg < 0 || s.weight_kg > limits.maxWeightKg) {
          throw new ScoringInputError(`${named}Lift weight is out of the allowed range.`);
        }
        if (!Number.isInteger(s.reps) || s.reps <= 0) {
          throw new ScoringInputError(`${named}Reps must be a positive whole number.`);
        }
        if (s.rpe != null && (!Number.isFinite(s.rpe) || s.rpe < 1 || s.rpe > 10)) {
          throw new ScoringInputError("RPE must be between 1 and 10.");
        }
        if (bw && bw > 0 && s.weight_kg > bw * limits.maxBodyweightMultiple) {
          throw new ScoringInputError(
            `${named}Lift weight is implausible for the recorded bodyweight.`
          );
        }
      }
    }
  }
}

export function clampIndexScore(value: number): number {
  if (!Number.isFinite(value)) return MIN_INDEX;
  return Math.max(MIN_INDEX, Math.min(MAX_INDEX, Math.round(value)));
}
