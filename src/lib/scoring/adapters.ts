import type { SportType, Gender, ExperienceLevel, SessionType } from "@/types";
import type { Profile as AthleteProfile } from "@/lib/scoring/index-engine";
import type { CardioInput, CardioType, Sex } from "@/lib/scoring/cardio-activity";
import type { ActivityScore } from "@/lib/scoring/index-engine";
import type { CardioResult } from "@/lib/scoring/cardio-activity";
import type { CardioEnrichment } from "@/lib/scoring/cardio/confidence";
import type { BenchmarkSport } from "@/lib/scoring/cardio-benchmarks";

/** Derive onboarding profile from preferred sports — no form changes required. */
export function deriveAthleteProfile(preferredSports: SportType[]): AthleteProfile {
  const hasGym = preferredSports.includes("gym");
  const hasCardio = preferredSports.some((s) => s !== "gym");
  if (hasGym && hasCardio) return "hybrid";
  if (hasGym) return "gym";
  if (hasCardio) return "cardio";
  return "hybrid";
}

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
}): CardioInput {
  return {
    type: mapSportToCardioType(input.sport),
    benchmarkSport: mapSportToBenchmarkSport(input.sport),
    distanceMeters: input.distanceMeters ?? 0,
    durationSeconds: input.durationSeconds,
    sex: mapSex(input.gender),
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
  };
}
