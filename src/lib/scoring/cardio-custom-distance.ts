/**
 * Custom-distance cardio goals (user feedback: "scope both and... make
 * this training plan as sophisticated as possible" — following up on the
 * flagged Stage 3 item: "letting cardio goals target distances other than
 * the fixed benchmark").
 *
 * Reuses the app's own existing, already-calibrated race-prediction math
 * (riegelEquivalentSeconds/RIEGEL_K in cardio-predictions.ts — the same
 * function that powers every other race-time projection in this app,
 * including each athlete's own personalized k stored on
 * predicted_benchmarks.riegel_k) rather than inventing a second
 * projection model. A "10K run" goal's current predicted time is a real,
 * defensible number Riegel-projected from the athlete's own 5K benchmark,
 * not a guess or a null.
 */

import { riegelEquivalentSeconds, benchmarkRiegelK } from "./cardio-predictions";
import type { BenchmarkSport } from "./cardio-benchmarks";

export interface DistanceOption {
  meters: number;
  label: string;
}

/**
 * Curated, standard race/piece distances per sport — the same ladder this
 * app's own live race-prediction ladder already uses for run
 * (LIVE_LADDER_METERS) and row/ski/swim (SPORT_LADDER_METERS) in
 * cardio-activity.ts, plus walk's own linear ladder. Cycling has no entry
 * beyond its canonical distance — course/terrain/drafting mean "harder
 * over more distance" doesn't hold the same fatigue-curve shape running
 * and rowing/erging do, and this app has no cycling race-ladder model to
 * project from.
 */
export const DISTANCE_LADDER: Partial<Record<BenchmarkSport, DistanceOption[]>> = {
  run: [
    { meters: 5000, label: "5K" },
    { meters: 10000, label: "10K" },
    { meters: 21097.5, label: "Half Marathon" },
    { meters: 42195, label: "Marathon" },
  ],
  row: [
    { meters: 500, label: "500m" },
    { meters: 1000, label: "1K" },
    { meters: 2000, label: "2K" },
    { meters: 5000, label: "5K" },
    { meters: 10000, label: "10K" },
  ],
  ski: [
    { meters: 500, label: "500m" },
    { meters: 1000, label: "1K" },
    { meters: 2000, label: "2K" },
    { meters: 5000, label: "5K" },
  ],
  swim: [
    { meters: 100, label: "100m" },
    { meters: 200, label: "200m" },
    { meters: 400, label: "400m" },
    { meters: 800, label: "800m" },
    { meters: 1500, label: "1500m" },
  ],
  walk: [
    { meters: 1000, label: "1K" },
    { meters: 2500, label: "2.5K" },
    { meters: 5000, label: "5K" },
    { meters: 10000, label: "10K" },
    { meters: 21097.5, label: "Half Marathon" },
  ],
};

/** Sports Riegel actually models (a fatigue-curve exponent makes sense for a sustained, pacing-limited effort). Walk is deliberately excluded — it's scored on a flat pace everywhere else in this app, so it gets a flat (linear) projection here too, not a fatigue curve that would imply walking gets disproportionately slower over distance the way running does. */
const RIEGEL_SPORTS = new Set<BenchmarkSport>(["run", "row", "ski", "swim"]);

/**
 * Projects an athlete's own canonical-distance time to a different
 * distance in the same sport. `personalizedRiegelK` should be the
 * athlete's own predicted_benchmarks.riegel_k for this sport when
 * available (falls back to the population-average RIEGEL_K).
 */
export function projectToDistance(
  sport: BenchmarkSport,
  canonicalSeconds: number,
  canonicalMeters: number,
  targetMeters: number,
  personalizedRiegelK: number | null = null
): number {
  if (canonicalSeconds <= 0 || canonicalMeters <= 0 || targetMeters <= 0) return canonicalSeconds;
  if (!RIEGEL_SPORTS.has(sport)) {
    // Linear pace scaling — walk's own documented model elsewhere in this app.
    return (canonicalSeconds / canonicalMeters) * targetMeters;
  }
  // Sport-specific exponent (BENCHMARK_RIEGEL_K) rather than the flat
  // running-tuned RIEGEL_K — see cardio-predictions.ts. Row/ski project on
  // Paul's Law, swim on Riegel's swimming exponent; run is unchanged.
  return riegelEquivalentSeconds(
    canonicalSeconds,
    canonicalMeters,
    targetMeters,
    personalizedRiegelK ?? benchmarkRiegelK(sport)
  );
}

/** Parses a training_goals target_key of the form "sport" (canonical distance) or "sport_meters" (custom distance) back into its parts. */
export function parseCardioTargetKey(
  targetKey: string,
  benchmarkSports: readonly BenchmarkSport[]
): { sport: BenchmarkSport; customMeters: number | null } | null {
  if ((benchmarkSports as string[]).includes(targetKey)) {
    return { sport: targetKey as BenchmarkSport, customMeters: null };
  }
  const match = targetKey.match(/^(.+)_(\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const [, sportPart, metersPart] = match;
  if (!(benchmarkSports as string[]).includes(sportPart)) return null;
  const meters = Number(metersPart);
  if (!Number.isFinite(meters) || meters <= 0) return null;
  return { sport: sportPart as BenchmarkSport, customMeters: meters };
}

/** Builds the stable storage key for a cardio goal at a given distance — plain sport string at the canonical distance (matches every existing row/lookup), "sport_meters" otherwise, so multiple distance goals for the same sport can coexist without colliding. */
export function buildCardioTargetKey(sport: BenchmarkSport, distanceMeters: number, canonicalMeters: number): string {
  return Math.round(distanceMeters) === Math.round(canonicalMeters) ? sport : `${sport}_${Math.round(distanceMeters)}`;
}
