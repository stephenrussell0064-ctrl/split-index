import type {
  SportType,
  SessionType,
  Gender,
  ScoringBasis,
  ExperienceLevel,
} from "@/types";

/**
 * The athletes.
 *
 * These are not fixtures chosen to make the engines look good. Each one exists
 * because there is a question about the product that only that athlete can ask,
 * and several of them are here specifically because their sport or their body
 * is one the scoring was NOT primarily calibrated against — swimming, cycling,
 * the SkiErg, female athletes and masters athletes. If those readings are
 * wrong, the athlete does not file a bug. They conclude the app does not work
 * for people like them, and they leave.
 *
 * A persona is a training *behaviour*, not a data dump: a weekly pattern, a
 * trajectory over time, and a statement of what this person would consider
 * getting their money's worth. The simulator turns that into sessions and runs
 * them through the real engines; the assertions ask whether the athlete got
 * what they came for.
 */

export type Trajectory =
  /** Steadily improving, the way a consistent athlete actually does. */
  | "improving"
  /** Flat. Training hard, not getting faster — the most common real case. */
  | "plateau"
  /** Ramping volume recklessly. Injury risk must notice. */
  | "overreaching"
  /** Fitness lost, then returning after time off. */
  | "detrained-returning";

export interface WeeklyPattern {
  sport: SportType;
  sessionType: SessionType;
  /** Sessions of this kind per week. Fractional means "most weeks". */
  perWeek: number;
}

export interface Persona {
  id: string;
  /** Who this is, in the words they would use about themselves. */
  who: string;
  /** What they would count as the app being worth paying for. */
  wants: string;
  /** Why this persona is in the suite — the risk it covers. */
  covers: string;

  weeks: number;
  trajectory: Trajectory;
  pattern: WeeklyPattern[];

  profile: {
    age: number;
    gender: Gender;
    scoring_basis: ScoringBasis;
    weight_kg: number;
    max_hr?: number;
    resting_hr?: number;
    experience: ExperienceLevel;
    preferred_sports: SportType[];
    /**
     * How much the ENDURANCE side counts, 0–1. The app derives the Lab weight
     * as `1 - split_endurance_weight` (see `labWeightFromProfile`), so a
     * swimmer wants a HIGH value and a powerlifter a LOW one.
     *
     * Worth stating explicitly because getting it backwards is silent: the
     * first version of this file gave the swimmer 0.3 and the powerlifter 0.75,
     * which weighted a swimmer's headline index 70% on her gym sessions. The
     * suite then reported the swimmer's index collapsing, which read exactly
     * like a swim-calibration bug and was this field.
     */
    split_endurance_weight?: number;
  };

  /** Starting ability, as a fraction of a strong club athlete. Drives the numbers. */
  baseline: {
    /** Seconds per km at easy pace, for endurance personas. */
    easyPaceSecPerKm?: number;
    /** Estimated 1RM in kg for the big three, for gym personas. */
    squat1RM?: number;
    bench1RM?: number;
    deadlift1RM?: number;
  };
}

export const PERSONAS: Persona[] = [
  {
    id: "first-session",
    who: "Downloaded the app this morning. Lifts three times a week, has never tracked anything.",
    wants: "To see a number after logging one session, and understand what it means.",
    covers:
      "The cold-start cliff. Everything the product promises needs history, and this athlete has none. If the first session returns nothing legible, they never log a second.",
    weeks: 1,
    trajectory: "plateau",
    pattern: [{ sport: "gym", sessionType: "other", perWeek: 1 }],
    profile: {
      age: 27,
      gender: "male",
      scoring_basis: "male",
      weight_kg: 82,
      experience: "beginner",
      preferred_sports: ["gym"],
      split_endurance_weight: 0.5,
    },
    baseline: { squat1RM: 100, bench1RM: 75, deadlift1RM: 130 },
  },

  {
    id: "hyrox-hybrid",
    who: "Hyrox athlete, 12 weeks out. Lifts three times a week and runs four.",
    wants:
      "To know whether the lifting is costing them the running, and to see both sides move.",
    covers:
      "The target customer, and the product's central claim — that it can score strength and endurance in one place and say something true about the interference between them.",
    weeks: 12,
    trajectory: "improving",
    pattern: [
      { sport: "gym", sessionType: "other", perWeek: 3 },
      { sport: "running", sessionType: "easy", perWeek: 2 },
      { sport: "running", sessionType: "interval", perWeek: 1 },
      { sport: "running", sessionType: "long", perWeek: 1 },
    ],
    profile: {
      age: 31,
      gender: "male",
      scoring_basis: "male",
      weight_kg: 84,
      max_hr: 189,
      resting_hr: 52,
      experience: "advanced",
      preferred_sports: ["gym", "running"],
      split_endurance_weight: 0.5,
    },
    baseline: {
      easyPaceSecPerKm: 285,
      squat1RM: 165,
      bench1RM: 115,
      deadlift1RM: 205,
    },
  },

  {
    id: "female-lifter",
    who: "Powerlifter, 34, competes at 63kg. Lifts four times a week, runs occasionally.",
    wants: "DOTS and a strength ranking that compares her against women, not against men.",
    covers:
      "Female scoring basis. DOTS, Glossbrenner and the age-graded references are all sex-segregated, and a female athlete scored against male tables reads as far weaker than she is. Explicitly flagged as a calibration gap.",
    weeks: 10,
    trajectory: "improving",
    pattern: [
      { sport: "gym", sessionType: "other", perWeek: 4 },
      { sport: "running", sessionType: "easy", perWeek: 1 },
    ],
    profile: {
      age: 34,
      gender: "female",
      scoring_basis: "female",
      weight_kg: 63,
      max_hr: 186,
      resting_hr: 58,
      experience: "advanced",
      preferred_sports: ["gym"],
      split_endurance_weight: 0.2,
    },
    baseline: {
      easyPaceSecPerKm: 330,
      squat1RM: 140,
      bench1RM: 75,
      deadlift1RM: 165,
    },
  },

  {
    id: "swimmer",
    who: "Masters swimmer, swims five times a week, lifts twice for shoulder health.",
    wants: "Swim sessions to score like real training, not like an afterthought.",
    covers:
      "Swimming calibration. Pace-per-100m and the swim benchmark ladder behave nothing like running, and an athlete whose main sport reads as noise has no reason to stay. Flagged as an open calibration gap.",
    weeks: 8,
    trajectory: "improving",
    pattern: [
      { sport: "swimming", sessionType: "easy", perWeek: 3 },
      { sport: "swimming", sessionType: "threshold", perWeek: 2 },
      { sport: "gym", sessionType: "other", perWeek: 2 },
    ],
    profile: {
      age: 38,
      gender: "female",
      scoring_basis: "female",
      weight_kg: 66,
      max_hr: 182,
      resting_hr: 55,
      experience: "advanced",
      preferred_sports: ["swimming"],
      split_endurance_weight: 0.85,
    },
    baseline: { easyPaceSecPerKm: 1100, squat1RM: 80, bench1RM: 50, deadlift1RM: 100 },
  },

  {
    id: "cyclist",
    who: "Road cyclist, long weekend rides and two indoor turbo sessions midweek.",
    wants: "Long rides to count for what they cost, and indoor and outdoor to agree.",
    covers:
      "Cycling calibration, and the indoor/outdoor split. A four-hour ride and a 40-minute turbo session must not score alike, and the same effort must not score differently indoors. Flagged as an open calibration gap.",
    weeks: 9,
    trajectory: "improving",
    pattern: [
      { sport: "outdoor_cycling", sessionType: "long", perWeek: 1 },
      { sport: "outdoor_cycling", sessionType: "easy", perWeek: 1 },
      { sport: "indoor_cycling", sessionType: "interval", perWeek: 2 },
    ],
    profile: {
      age: 44,
      gender: "male",
      scoring_basis: "male",
      weight_kg: 74,
      max_hr: 178,
      resting_hr: 48,
      experience: "advanced",
      preferred_sports: ["outdoor_cycling", "indoor_cycling"],
      split_endurance_weight: 0.9,
    },
    baseline: { easyPaceSecPerKm: 150 },
  },

  {
    id: "erg-athlete",
    who: "CrossFit-adjacent, splits time between the rower and the SkiErg, lifts three times a week.",
    wants: "Erg work scored properly rather than lumped in with running.",
    covers:
      "Rowing and SkiErg calibration. Both are distance sports with paces unlike running's, and the SkiErg has the thinnest reference data of any supported sport. Flagged as an open calibration gap.",
    weeks: 8,
    trajectory: "improving",
    pattern: [
      { sport: "rowing", sessionType: "interval", perWeek: 2 },
      { sport: "ski_erg", sessionType: "threshold", perWeek: 2 },
      { sport: "gym", sessionType: "other", perWeek: 3 },
    ],
    profile: {
      age: 29,
      gender: "male",
      scoring_basis: "male",
      weight_kg: 88,
      max_hr: 192,
      resting_hr: 54,
      experience: "intermediate",
      preferred_sports: ["rowing", "ski_erg", "gym"],
      split_endurance_weight: 0.5,
    },
    baseline: {
      easyPaceSecPerKm: 300,
      squat1RM: 150,
      bench1RM: 110,
      deadlift1RM: 190,
    },
  },

  {
    id: "masters-runner",
    who: "52, runs five times a week, has been running for twenty years.",
    wants: "To be told how they compare to other 52-year-olds, not to 25-year-olds.",
    covers:
      "Age grading. Without it a lifetime runner past fifty reads as mediocre against an open standard, which is both wrong and the fastest way to lose an athlete who has more disposable income than the target demographic.",
    weeks: 10,
    trajectory: "plateau",
    pattern: [
      { sport: "running", sessionType: "easy", perWeek: 3 },
      { sport: "running", sessionType: "tempo", perWeek: 1 },
      { sport: "running", sessionType: "long", perWeek: 1 },
    ],
    profile: {
      age: 52,
      gender: "male",
      scoring_basis: "male",
      weight_kg: 71,
      max_hr: 172,
      resting_hr: 50,
      experience: "advanced",
      preferred_sports: ["running"],
      split_endurance_weight: 0.95,
    },
    baseline: { easyPaceSecPerKm: 315 },
  },

  {
    id: "overreacher",
    who: "Marathon block. Went from 40km a week to 90km in three weeks because a plan told them to.",
    wants: "Nothing. This athlete needs to be warned.",
    covers:
      "The Injury Risk Index, which is the app's only safety-shaped claim. ACWR must leave the optimal band and say so. A risk index that never fires is worse than none, because it is trusted.",
    weeks: 8,
    trajectory: "overreaching",
    pattern: [
      { sport: "running", sessionType: "easy", perWeek: 4 },
      { sport: "running", sessionType: "long", perWeek: 1 },
      { sport: "running", sessionType: "interval", perWeek: 1 },
    ],
    profile: {
      age: 26,
      gender: "male",
      scoring_basis: "male",
      weight_kg: 70,
      max_hr: 195,
      resting_hr: 45,
      experience: "intermediate",
      preferred_sports: ["running"],
      split_endurance_weight: 0.95,
    },
    baseline: { easyPaceSecPerKm: 300 },
  },

  {
    id: "returner",
    who: "Six weeks off with a calf tear. Coming back, cautiously, and frightened of it happening again.",
    wants: "To know how much fitness they lost and how fast they can safely rebuild.",
    covers:
      "Detraining and return. The index must fall when someone stops and recover when they restart, and the risk index must not scream at a low absolute load simply because it is rising from nearly zero.",
    weeks: 10,
    trajectory: "detrained-returning",
    pattern: [
      { sport: "running", sessionType: "easy", perWeek: 3 },
      { sport: "gym", sessionType: "other", perWeek: 2 },
    ],
    profile: {
      age: 35,
      gender: "female",
      scoring_basis: "female",
      weight_kg: 61,
      max_hr: 184,
      resting_hr: 56,
      experience: "intermediate",
      preferred_sports: ["running", "gym"],
      split_endurance_weight: 0.6,
    },
    baseline: {
      easyPaceSecPerKm: 340,
      squat1RM: 85,
      bench1RM: 45,
      deadlift1RM: 110,
    },
  },

  {
    id: "sporadic",
    who: "Means to train four times a week. Manages one or two, some weeks none.",
    wants: "Not to be made to feel like a failure by an app they are paying for.",
    covers:
      "The realistic majority, and the churn case. Sparse, gappy data must not produce wild swings or an index that collapses because someone had a bad fortnight.",
    weeks: 12,
    trajectory: "plateau",
    pattern: [
      { sport: "gym", sessionType: "other", perWeek: 1 },
      { sport: "running", sessionType: "easy", perWeek: 0.5 },
    ],
    profile: {
      age: 41,
      gender: "male",
      scoring_basis: "male",
      weight_kg: 91,
      max_hr: 179,
      resting_hr: 64,
      experience: "beginner",
      preferred_sports: ["gym", "running"],
      split_endurance_weight: 0.5,
    },
    baseline: {
      easyPaceSecPerKm: 390,
      squat1RM: 90,
      bench1RM: 70,
      deadlift1RM: 120,
    },
  },
];

export const personaById = (id: string): Persona => {
  const found = PERSONAS.find((p) => p.id === id);
  if (!found) throw new Error(`No persona "${id}"`);
  return found;
};
