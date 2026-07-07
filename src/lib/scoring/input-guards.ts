import type { SportType } from "@/types";
import { MAX_INDEX, MIN_INDEX } from "@/lib/scoring/constants";

const MAX_DURATION_SECONDS = 24 * 60 * 60; // 24 h
const MAX_DISTANCE_METERS = 500_000; // 500 km
const MAX_WEIGHT_KG = 500;
const MAX_BODYWEIGHT_KG = 300;
const MIN_HEART_RATE_BPM = 20;
const MAX_HEART_RATE_BPM = 250;
const MAX_POWER_WATTS = 2500;
const MAX_PACE_SECONDS = 7200; // 2 h per km / per split — generous upper bound
const MAX_ELEVATION_METERS = 9000;

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
  exercises?: Array<{ weight_kg: number; sets: number; reps: number }>;
  profile?: { weight_kg?: number | null };
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

  const bw = input.profile?.weight_kg;
  if (bw != null && (!Number.isFinite(bw) || bw <= 0 || bw > MAX_BODYWEIGHT_KG)) {
    throw new ScoringInputError("Bodyweight is out of the allowed range.");
  }

  if (input.sport === "gym" && input.exercises?.length) {
    for (const ex of input.exercises) {
      if (ex.weight_kg < 0 || ex.weight_kg > MAX_WEIGHT_KG) {
        throw new ScoringInputError("Lift weight is out of the allowed range.");
      }
      if (ex.sets <= 0 || ex.reps <= 0) {
        throw new ScoringInputError("Sets and reps must be positive.");
      }
      if (bw && bw > 0 && ex.weight_kg > bw * 6) {
        throw new ScoringInputError("Lift weight is implausible for the recorded bodyweight.");
      }
    }
  }
}

export function clampIndexScore(value: number): number {
  if (!Number.isFinite(value)) return MIN_INDEX;
  return Math.max(MIN_INDEX, Math.min(MAX_INDEX, Math.round(value)));
}
