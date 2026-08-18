import type { SportType, Gender, ScoringBasis, ExperienceLevel, SessionType } from "@/types";
import type { Profile as AthleteProfile } from "@/lib/scoring/index-engine";
import type { CardioInput, CardioType, Sex } from "@/lib/scoring/cardio-activity";
import { DEFAULT_SCORING_BASIS } from "@/lib/scoring/constants";
import { isValidIntervalWorkPiece, isValidFartlekOnPiece } from "@/lib/scoring/cardio/interval-scoring";
import type { ActivityScore } from "@/lib/scoring/index-engine";
import type { CardioResult } from "@/lib/scoring/cardio-activity";
import type { CardioEnrichment } from "@/lib/scoring/cardio/confidence";
import type { BenchmarkSport } from "@/lib/scoring/cardio-benchmarks";
import {
  computeSessionBenchmarkEquivalentSeconds,
  computeIntervalBenchmarkEquivalentSeconds,
} from "@/lib/scoring/cardio-predictions";
import {
  intervalEquivalentPaceSecPerKm,
  intervalTotalWorkDistanceMeters,
  fartlekEquivalentPaceSecPerKm,
} from "@/lib/scoring/cardio/interval-scoring";

/** Derive onboarding profile from preferred sports — no form changes required. */
export function deriveAthleteProfile(preferredSports: SportType[]): AthleteProfile {
  const hasGym = preferredSports.includes("gym");
  const hasCardio = preferredSports.some((s) => s !== "gym");
  if (hasGym && hasCardio) return "hybrid";
  if (hasGym) return "gym";
  if (hasCardio) return "cardio";
  return "hybrid";
}

export interface ScoringBasisResolution {
  sex: Sex;
  /** Where the answer came from — "default" means nobody has told us. */
  source: "explicit" | "identity" | "default";
  /** True when `sex` is a fallback rather than the athlete's own answer. */
  isDefault: boolean;
}

/**
 * Resolve which sex-segregated standards to score an athlete against.
 *
 * Precedence, and the reason for it:
 *  1. `scoring_basis` — the athlete answered the scoring question directly.
 *  2. `gender`, when it is male/female — identity already answers it, so the
 *     athlete is never asked the same thing twice (the onboarding and profile
 *     forms only show the basis question when this branch cannot fire).
 *  3. DEFAULT_SCORING_BASIS (see scoring/constants.ts), flagged. Reached by
 *     athletes who chose "other"/"prefer_not_to_say" and have not set a basis
 *     yet. They get a working app immediately and a prompt to correct it,
 *     instead of the hard throw that used to make every single workout
 *     unloggable for them.
 *
 * NEVER throws. Callers that need to know whether the number is calibrated
 * read `isDefault`.
 */
export function resolveScoringBasis(profile: {
  gender?: Gender | null;
  scoring_basis?: ScoringBasis | null;
}): ScoringBasisResolution {
  const explicit = profile.scoring_basis;
  if (explicit === "male" || explicit === "female") {
    return { sex: explicit, source: "explicit", isDefault: false };
  }
  const gender = profile.gender;
  if (gender === "male" || gender === "female") {
    return { sex: gender, source: "identity", isDefault: false };
  }
  return { sex: DEFAULT_SCORING_BASIS, source: "default", isDefault: true };
}

/** Shorthand for callers that only need the sex and not the provenance. */
export function resolveScoringSex(profile: {
  gender?: Gender | null;
  scoring_basis?: ScoringBasis | null;
}): Sex {
  return resolveScoringBasis(profile).sex;
}

/** @deprecated Use resolveScoringSex — kept for non-scoring display paths only. */
export function mapSex(gender: Gender | null | undefined): Sex {
  return gender === "female" ? "female" : "male";
}

export function mapSportToCardioType(sport: SportType): CardioType {
  if (sport === "swimming") return "swim";
  if (sport === "rowing" || sport === "bike_erg" || sport === "ski_erg") return "row";
  return "run";
}

/** Granular benchmark bucket driving the primary anchor-table score — finer than mapSportToCardioType (walk/cycle/ski each get their own curve; see cardio-benchmarks.ts). */
export function mapSportToBenchmarkSport(sport: SportType): BenchmarkSport {
  switch (sport) {
    case "walking":
      return "walk";
    case "swimming":
      return "swim";
    case "rowing":
      return "row";
    case "bike_erg":
    case "indoor_cycling":
    case "outdoor_cycling":
      return "cycle";
    case "ski_erg":
      return "ski";
    default:
      return "run";
  }
}

export function mapExperience(
  experience: ExperienceLevel | null | undefined
): CardioInput["experience"] {
  if (experience === "beginner" || experience === "advanced") return experience;
  return "intermediate";
}

export function labWeightFromProfile(enduranceWeight = 0.5): number {
  return 1 - enduranceWeight;
}

export function buildActivityScores(
  rows: Array<{
    sport: string;
    sport_index: number;
    started_at: string;
    score_breakdown?: Record<string, unknown> | null;
  }>
): ActivityScore[] {
  return rows.map((row) => ({
    side: row.sport === "gym" ? ("lab" as const) : ("engine" as const),
    score: row.sport_index,
    confidence: extractActivityConfidence(row.score_breakdown),
    date: row.started_at,
  }));
}

function extractActivityConfidence(
  breakdown: Record<string, unknown> | null | undefined
): number {
  const cardio = breakdown?.cardio_activity as CardioResult | undefined;
  if (typeof cardio?.confidence === "number") return cardio.confidence;
  return 1;
}

/** Map v2 cardio result into existing enrichment panel shape. */
export function cardioResultToEnrichment(
  result: CardioResult,
  sportIndex: number
): CardioEnrichment {
  const flags: CardioEnrichment["flags"] = [];
  if (result.flags.includes("no-hr-data")) flags.push("no_hr", "unverified");
  if (result.flags.includes("positive-split-fade")) flags.push("positive_split");
  if (result.flags.includes("negative-split-strong")) flags.push("negative_split");
  if (result.decouplingPct !== null && result.decouplingPct > 5) flags.push("decoupling");

  const confidence: CardioEnrichment["confidence"] =
    result.confidence >= 0.85 ? "high" : result.confidence >= 0.6 ? "medium" : "low";

  const adjustedDisplayIndex =
    result.confidence < 0.7 ? Math.round(sportIndex * 0.93) : undefined;

  return {
    sportIndex,
    adjustedDisplayIndex,
    confidence,
    flags,
    executionScore: result.executionScore ?? undefined,
    vo2maxEstimate: result.vo2max
      ? {
          estimate: result.vo2max,
          hrMax: 190,
          hrRest: 60,
          hrMaxSource:
            result.vo2maxMethod === "hr-ratio" ? ("measured" as const) : ("tanaka" as const),
          confidence:
            result.confidence >= 0.85 ? ("high" as const) : ("medium" as const),
        }
      : undefined,
    trimp: result.trimp
      ? {
          trimp: result.trimp,
          hrReserveRatio: 0,
          durationMinutes: 0,
          label:
            result.trimp > 150
              ? ("very_hard" as const)
              : result.trimp > 100
                ? ("hard" as const)
                : result.trimp > 50
                  ? ("moderate" as const)
                  : ("light" as const),
        }
      : undefined,
    efficiencyFactor: result.efficiencyFactor
      ? {
          efficiencyFactor: result.efficiencyFactor,
          unit: "pace_per_hr" as const,
          displayValue: String(result.efficiencyFactor),
        }
      : undefined,
    decoupling:
      result.decouplingPct !== null
        ? {
            firstHalfEF: 0,
            secondHalfEF: 0,
            decouplingPct: result.decouplingPct,
            flag:
              result.decouplingPct > 6
                ? ("decoupling" as const)
                : result.decouplingPct < -2
                  ? ("negative_split" as const)
                  : ("stable" as const),
            note:
              result.decouplingPct > 6
                ? `Aerobic decoupling ${result.decouplingPct.toFixed(1)}% — pace faded relative to heart rate.`
                : result.decouplingPct < -2
                  ? `Negative split — ${Math.abs(result.decouplingPct).toFixed(1)}% efficiency gain in the second half.`
                  : "Pacing held steady between halves.",
          }
        : undefined,
    notes: result.flags.map((f) => f.replace(/-/g, " ")),
  };
}

export function buildCardioInput(input: {
  sport: SportType;
  durationSeconds: number;
  distanceMeters?: number | null;
  avgHeartRate?: number | null;
  maxHr?: number | null;
  age?: number | null;
  gender?: Gender | null;
  /** Which standards to compare against — see resolveScoringBasis. Falls back to `gender` when omitted. */
  scoringBasis?: ScoringBasis | null;
  experience?: ExperienceLevel | null;
  restingHr?: number | null;
  firstHalfAvgHR?: number | null;
  secondHalfAvgHR?: number | null;
  firstHalfPaceSecPerKm?: number | null;
  secondHalfPaceSecPerKm?: number | null;
  sessionType?: SessionType | null;
  rpe?: number | null;
  elevationMeters?: number | null;
  temperatureCelsius?: number | null;
  storedPredictionSeconds?: number | null;
  intervalReps?: number | null;
  intervalWorkDistanceMeters?: number | null;
  intervalWorkSeconds?: number | null;
  intervalRestSeconds?: number | null;
  intervalWorkAvgHr?: number | null;
  fartlekOnDistanceMeters?: number | null;
  fartlekOnSeconds?: number | null;
  fartlekOnAvgHr?: number | null;
  easyEffortBaselineEF?: number | null;
  recentHardEffortBenchmarkSeconds?: number | null;
  easyEffortBaselinePaceSeconds?: number | null;
  recentEasyEffortScores?: number[] | null;
  personalizedRiegelK?: number | null;
}): CardioInput {
  const structuredInterval = {
    reps: input.intervalReps ?? 0,
    workDistanceMeters: input.intervalWorkDistanceMeters ?? 0,
    workSecondsPerRep: input.intervalWorkSeconds ?? 0,
    restSeconds: input.intervalRestSeconds ?? 0,
    workAvgHeartRate: input.intervalWorkAvgHr ?? undefined,
  };
  const structuredFartlek = {
    onDistanceMeters: input.fartlekOnDistanceMeters ?? 0,
    onSeconds: input.fartlekOnSeconds ?? 0,
    totalDurationSeconds: input.durationSeconds,
    onAvgHeartRate: input.fartlekOnAvgHr ?? undefined,
  };

  return {
    type: mapSportToCardioType(input.sport),
    benchmarkSport: mapSportToBenchmarkSport(input.sport),
    distanceMeters: input.distanceMeters ?? 0,
    durationSeconds: input.durationSeconds,
    sex: resolveScoringSex({ gender: input.gender, scoring_basis: input.scoringBasis }),
    age: input.age ?? 30,
    restingHR: input.restingHr ?? undefined,
    maxHR: input.maxHr ?? undefined,
    avgHR: input.avgHeartRate ?? undefined,
    firstHalfAvgHR: input.firstHalfAvgHR ?? undefined,
    secondHalfAvgHR: input.secondHalfAvgHR ?? undefined,
    firstHalfPaceSecPerKm: input.firstHalfPaceSecPerKm ?? undefined,
    secondHalfPaceSecPerKm: input.secondHalfPaceSecPerKm ?? undefined,
    experience: mapExperience(input.experience),
    sessionType: input.sessionType ?? undefined,
    elevationMeters: input.elevationMeters ?? undefined,
    temperatureCelsius: input.temperatureCelsius ?? undefined,
    rpe: input.rpe ?? undefined,
    storedPredictionSeconds: input.storedPredictionSeconds ?? undefined,
    easyEffortBaselineEF: input.easyEffortBaselineEF ?? undefined,
    recentHardEffortBenchmarkSeconds: input.recentHardEffortBenchmarkSeconds ?? undefined,
    easyEffortBaselinePaceSeconds: input.easyEffortBaselinePaceSeconds ?? undefined,
    recentEasyEffortScores: input.recentEasyEffortScores ?? undefined,
    personalizedRiegelK: input.personalizedRiegelK ?? undefined,
    structuredInterval: isValidIntervalWorkPiece(structuredInterval) ? structuredInterval : undefined,
    structuredFartlek: isValidFartlekOnPiece(structuredFartlek) ? structuredFartlek : undefined,
  };
}

/**
 * Same benchmark-equivalent projection `buildCardioInput` feeds into the
 * per-activity score, used standalone by the memory-prediction block in the
 * activities API routes (which computes `predicted_benchmarks` updates
 * outside of `scoreCardioActivity`) — kept consistent so a structured
 * interval/fartlek session updates the stored prediction off the same
 * work-piece equivalent it was scored with, not the diluted whole-session
 * average.
 */
export function computeBodyBenchmarkEquivalentSeconds(
  benchmarkSport: BenchmarkSport,
  body: {
    distance_meters?: number | null;
    duration_seconds: number;
    avg_heart_rate?: number | null;
    interval_reps?: number | null;
    interval_work_distance_meters?: number | null;
    interval_work_seconds?: number | null;
    interval_rest_seconds?: number | null;
    interval_work_avg_hr?: number | null;
    fartlek_on_distance_meters?: number | null;
    fartlek_on_seconds?: number | null;
    fartlek_on_avg_hr?: number | null;
  },
  /** Personalized Riegel k (race-prediction-model.md) — omit to use the population default. */
  riegelK?: number
): number | null {
  const structuredInterval = {
    reps: body.interval_reps ?? 0,
    workDistanceMeters: body.interval_work_distance_meters ?? 0,
    workSecondsPerRep: body.interval_work_seconds ?? 0,
    restSeconds: body.interval_rest_seconds ?? 0,
    workAvgHeartRate: body.interval_work_avg_hr ?? undefined,
  };
  if (isValidIntervalWorkPiece(structuredInterval)) {
    return computeIntervalBenchmarkEquivalentSeconds(
      benchmarkSport,
      intervalTotalWorkDistanceMeters(structuredInterval),
      intervalEquivalentPaceSecPerKm(structuredInterval),
      structuredInterval.workAvgHeartRate,
      riegelK
    );
  }

  const structuredFartlek = {
    onDistanceMeters: body.fartlek_on_distance_meters ?? 0,
    onSeconds: body.fartlek_on_seconds ?? 0,
    totalDurationSeconds: body.duration_seconds,
    onAvgHeartRate: body.fartlek_on_avg_hr ?? undefined,
  };
  if (isValidFartlekOnPiece(structuredFartlek)) {
    return computeIntervalBenchmarkEquivalentSeconds(
      benchmarkSport,
      structuredFartlek.onDistanceMeters,
      fartlekEquivalentPaceSecPerKm(structuredFartlek),
      structuredFartlek.onAvgHeartRate,
      riegelK
    );
  }

  return computeSessionBenchmarkEquivalentSeconds(
    benchmarkSport,
    body.distance_meters ?? 0,
    body.duration_seconds,
    body.avg_heart_rate,
    riegelK
  );
}
