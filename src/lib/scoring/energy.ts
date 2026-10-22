/**
 * Energy expenditure for a live indoor session — the "calories burnt" number
 * on the erg screen.
 *
 * TWO MODELS, HONESTLY LABELLED. With a heart-rate source connected, the
 * Keytel et al. (2005) regression is integrated over the session's readings:
 * it was fitted on treadmill and cycle ergometer work against indirect
 * calorimetry, needs weight, age and sex, and is the model every wearable's
 * "active calories" descends from. Without one, a MET value for the sport
 * from the Compendium of Physical Activities (Ainsworth et al. 2011) is
 * multiplied by bodyweight and time — the number is far rougher, and the
 * screen says so.
 *
 * Both are ESTIMATES OF EXPENDITURE and nothing more. This is not a target,
 * not a budget and not nutrition guidance; the Hybrid Plan engine's rule that
 * no calorie target is ever produced (hpe/constants.ts) is untouched, because
 * a readout of what a session cost is a different thing from a prescription
 * of what to eat.
 */
import type { HrReading } from "./gps-track";

export type LiveSport = "rowing" | "bike_erg";

export interface EnergyProfile {
  weightKg: number;
  age: number;
  sex: "male" | "female";
}

/** Bodyweight a 75kg default stands in for when the profile has none; the result is flagged as such. */
export const DEFAULT_WEIGHT_KG = 75;
export const DEFAULT_AGE = 35;

/**
 * [DATA] Compendium of Physical Activities: rowing, stationary, moderate
 * (code 15550, ~100 W) and bicycling, stationary, moderate (code 02040,
 * ~90-100 W). A deliberately middling effort for each — the fallback has no
 * way to know how hard the session was.
 */
export const MET_BY_SPORT: Readonly<Record<LiveSport, number>> = {
  rowing: 7.0,
  bike_erg: 6.8,
};

/** A heart-rate reading older than this is a dropout, not a long interval — the gap is capped rather than counted. */
export const MAX_SAMPLE_GAP_S = 15;

/** Resting expenditure, 1 MET: one kcal per kilogram per hour. The floor under the regression at low heart rates. */
function restingKcalPerMin(weightKg: number): number {
  return weightKg / 60;
}

/**
 * Keytel et al. 2005, the form without VO2max. Valid for roughly 90-180
 * bpm; it goes negative below the fitted range for a light athlete, so it
 * is floored at resting expenditure rather than allowed to subtract.
 */
export function keytelKcalPerMin(bpm: number, profile: EnergyProfile): number {
  const { weightKg, age, sex } = profile;
  const kj =
    sex === "female"
      ? -20.4022 + 0.4472 * bpm - 0.1263 * weightKg + 0.074 * age
      : -55.0969 + 0.6309 * bpm + 0.1988 * weightKg + 0.2017 * age;
  return Math.max(restingKcalPerMin(weightKg), kj / 4.184);
}

export function metKcalPerMin(sport: LiveSport, weightKg: number): number {
  return (MET_BY_SPORT[sport] * weightKg) / 60;
}

export interface EnergyEstimate {
  kcal: number;
  method: "heart-rate" | "met";
  /** True when weight or age had to be assumed rather than read from the profile. */
  assumed: boolean;
}

/**
 * Calories over a session from its heart-rate trace. Each reading is taken
 * to hold until the next one, with a dropout capped at MAX_SAMPLE_GAP_S;
 * the last reading holds until `endTime`. Readings inside a pause are the
 * caller's to exclude — pass only the moving ones.
 */
export function caloriesFromHeartRate(
  readings: readonly HrReading[],
  endTime: number,
  profile: EnergyProfile
): number {
  if (readings.length === 0) return 0;
  let kcal = 0;
  for (let i = 0; i < readings.length; i++) {
    const r = readings[i];
    const next = i + 1 < readings.length ? readings[i + 1].time : endTime;
    const seconds = Math.min(MAX_SAMPLE_GAP_S, Math.max(0, (next - r.time) / 1000));
    kcal += (keytelKcalPerMin(r.bpm, profile) * seconds) / 60;
  }
  return kcal;
}

/**
 * The estimate for a session so far. Heart rate when there is any; the
 * sport's MET otherwise. A profile missing weight or age gets the defaults
 * and an `assumed` flag the screen turns into a caveat.
 */
export function estimateSessionEnergy(args: {
  sport: LiveSport;
  readings: readonly HrReading[];
  movingSeconds: number;
  endTime: number;
  profile: { weightKg: number | null; age: number | null; sex: "male" | "female" };
}): EnergyEstimate {
  const assumed = args.profile.weightKg == null || args.profile.age == null;
  const profile: EnergyProfile = {
    weightKg: args.profile.weightKg ?? DEFAULT_WEIGHT_KG,
    age: args.profile.age ?? DEFAULT_AGE,
    sex: args.profile.sex,
  };
  if (args.readings.length > 0) {
    return { kcal: caloriesFromHeartRate(args.readings, args.endTime, profile), method: "heart-rate", assumed };
  }
  return { kcal: (metKcalPerMin(args.sport, profile.weightKg) * args.movingSeconds) / 60, method: "met", assumed };
}
