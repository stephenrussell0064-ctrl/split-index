/**
 * In-code reference standards for the scoring engine.
 * Mirrors `reference_values` seed data — kept local so scoring never depends on DB reads.
 */

import type {
  EnduranceSport,
  ExperienceLevel,
  Gender,
  SessionType,
} from "@/types";

export const MAX_INDEX = 999;
export const MIN_INDEX = 1;

/** Index anchor: matching reference performance maps to 500 */
export const INDEX_ANCHOR = 500;

/** Exponential sensitivity for pace vs reference (higher = steeper curve) */
export const PACE_EXP_SENSITIVITY = 2.5;
export const STRENGTH_EXP_SENSITIVITY = 2.2;

/** Riegel endurance exponent (T₂/T₁ = (D₂/D₁)^k) */
export const RIEGEL_EXPONENT = 1.06;

/** Banister time constants (days) for fitness vs fatigue decay */
export const BANISTER_FITNESS_TAU = 42;
export const BANISTER_FATIGUE_TAU = 7;

/** ACWR optimal training zone */
export const ACWR_OPTIMAL_LOW = 0.8;
export const ACWR_OPTIMAL_HIGH = 1.3;
export const ACWR_DANGER = 1.5;

export const ENDURANCE_SPORTS: EnduranceSport[] = [
  "running",
  "walking",
  "swimming",
  "rowing",
  "bike_erg",
  "indoor_cycling",
  "ski_erg",
];

/** Session type intensity multipliers (training load, not raw talent) */
export const SESSION_TYPE_MODIFIERS: Record<SessionType, number> = {
  recovery: 0.6,
  easy: 0.75,
  long: 0.9,
  tempo: 1.0,
  threshold: 1.1,
  interval: 1.15,
  fartlek: 1.15,
  race: 1.2,
  other: 0.85,
};

/** Default resting HR when not tracked (Karvonen fallback) */
export const DEFAULT_RESTING_HR = 60;

/** Reference bodyweight (kg) for minor running economy adjustment */
export const REFERENCE_BODYWEIGHT_KG = 70;

/**
 * Benchmark 5k pace (sec/km) by gender × experience — index 500 anchor for running.
 * Seeded from reference_values `benchmark_pace_5k`.
 */
export const REFERENCE_PACE_5K: Record<
  Gender,
  Record<ExperienceLevel, number>
> = {
  male: {
    beginner: 390,
    intermediate: 330,
    advanced: 280,
    elite: 230,
  },
  female: {
    beginner: 420,
    intermediate: 360,
    advanced: 305,
    elite: 255,
  },
  other: {
    beginner: 405,
    intermediate: 345,
    advanced: 292,
    elite: 242,
  },
  prefer_not_to_say: {
    beginner: 405,
    intermediate: 345,
    advanced: 292,
    elite: 242,
  },
};

/**
 * Sport-specific reference pace at index 500 (sec/km equivalent).
 * Erg/cycle sports use sec/km after normalising splits/power.
 */
export const SPORT_REFERENCE_PACE: Record<EnduranceSport, number> = {
  running: 330,
  walking: 720,
  swimming: 1200, // 2:00/100m → 120 s/100m × 10 = sec/km equivalent
  rowing: 260, // 2:10/500m split → 260 sec/km equiv
  bike_erg: 90,
  indoor_cycling: 90,
  ski_erg: 250,
};

/** Swimming uses sec per 100m instead of sec/km */
export const SWIM_PACE_UNIT_METERS = 100;

/** Rowing/ski erg split distance (m) */
export const ERG_SPLIT_METERS = 500;

/** Reference FTP proxy (W/kg) at index 500 for cycling/erg sports */
export const REFERENCE_WATTS_PER_KG = 3.0;

/** Big-3 1RM / bodyweight ratios at index 500 (male intermediate baseline) */
export const STRENGTH_REFERENCE_RATIOS: Record<
  string,
  Record<Gender, Record<ExperienceLevel, number>>
> = {
  squat: {
    male: { beginner: 1.0, intermediate: 1.5, advanced: 2.0, elite: 2.5 },
    female: { beginner: 0.75, intermediate: 1.25, advanced: 1.5, elite: 2.0 },
    other: { beginner: 0.88, intermediate: 1.38, advanced: 1.75, elite: 2.25 },
    prefer_not_to_say: { beginner: 0.88, intermediate: 1.38, advanced: 1.75, elite: 2.25 },
  },
  bench_press: {
    male: { beginner: 0.75, intermediate: 1.25, advanced: 1.5, elite: 2.0 },
    female: { beginner: 0.5, intermediate: 0.75, advanced: 1.0, elite: 1.25 },
    other: { beginner: 0.63, intermediate: 1.0, advanced: 1.25, elite: 1.63 },
    prefer_not_to_say: { beginner: 0.63, intermediate: 1.0, advanced: 1.25, elite: 1.63 },
  },
  deadlift: {
    male: { beginner: 1.25, intermediate: 1.75, advanced: 2.25, elite: 2.75 },
    female: { beginner: 1.0, intermediate: 1.25, advanced: 1.75, elite: 2.25 },
    other: { beginner: 1.13, intermediate: 1.5, advanced: 2.0, elite: 2.5 },
    prefer_not_to_say: { beginner: 1.13, intermediate: 1.5, advanced: 2.0, elite: 2.5 },
  },
};

/** Default strength ratio for unmapped exercises */
export const DEFAULT_STRENGTH_RATIO = 1.0;

/** Compound lift name patterns → reference metric key */
export const COMPOUND_LIFT_MAP: Record<string, string> = {
  squat: "squat",
  "back squat": "squat",
  "front squat": "squat",
  deadlift: "deadlift",
  "romanian deadlift": "deadlift",
  "bench press": "bench_press",
  bench: "bench_press",
  "overhead press": "bench_press",
  "military press": "bench_press",
  "barbell row": "deadlift",
  "pull up": "deadlift",
  "chin up": "deadlift",
};

export const COMPOUND_LIFT_WEIGHT = 1.2;
export const ACCESSORY_LIFT_WEIGHT = 0.85;
