/**
 * Sanity checks for the scoring engine — run with:
 *   npx tsx src/lib/scoring/sanity-check.ts
 */

import { calculateEnduranceIndex } from "./engine";
import { scoreActivity } from "./service";
import { calculateDOTS, calculateGLPoints } from "./strength";
import { dotsToStrengthIndex } from "./strength/mapping";

const baseProfile = {
  max_hr: 190,
  weight_kg: 75,
  experience: "intermediate" as const,
  gender: "male" as const,
  training_history_years: 5,
  split_endurance_weight: 0.5,
};

const neutralLoads = { acuteLoad: 200, chronicLoad: 200 };

function print(label: string, index: number, explanation: string[]) {
  console.log(`\n── ${label} ──`);
  console.log(`  Index: ${index}`);
  console.log(`  ${explanation.slice(0, 4).join("\n  ")}`);
}

console.log("Split Index Scoring Engine — Sanity Checks\n");

// ─── Cardio regression (frozen engine — outputs must match prior runs) ───────

const refRun = calculateEnduranceIndex({
  sport: "running",
  durationSeconds: 27.5 * 60,
  distanceMeters: 5000,
  elevationMeters: null,
  avgHeartRate: 165,
  avgPowerWatts: null,
  avgPaceSecondsPerKm: 330,
  avgSplitSeconds: null,
  temperatureCelsius: 15,
  sessionType: "tempo",
  profile: baseProfile,
  ...neutralLoads,
});
print("Reference 5k (5:30/km, intermediate male)", refRun.index, refRun.breakdown.explanation);

const fastRun = calculateEnduranceIndex({
  sport: "running",
  durationSeconds: 19 * 60,
  distanceMeters: 5000,
  elevationMeters: null,
  avgHeartRate: 178,
  avgPowerWatts: null,
  avgPaceSecondsPerKm: 228,
  avgSplitSeconds: null,
  temperatureCelsius: 12,
  sessionType: "race",
  profile: { ...baseProfile, experience: "advanced" },
  acuteLoad: 180,
  chronicLoad: 350,
});
print("Elite-adjacent 5k (3:48/km)", fastRun.index, fastRun.breakdown.explanation);

const hilly = calculateEnduranceIndex({
  sport: "running",
  durationSeconds: 95 * 60,
  distanceMeters: 21097,
  elevationMeters: 350,
  avgHeartRate: 158,
  avgPowerWatts: null,
  avgPaceSecondsPerKm: 270,
  avgSplitSeconds: null,
  temperatureCelsius: 18,
  sessionType: "long",
  profile: baseProfile,
  ...neutralLoads,
});
print("Hilly half (GAP + Riegel)", hilly.index, hilly.breakdown.explanation);

const hot = calculateEnduranceIndex({
  sport: "running",
  durationSeconds: 50 * 60,
  distanceMeters: 10000,
  elevationMeters: null,
  avgHeartRate: 170,
  avgPowerWatts: null,
  avgPaceSecondsPerKm: 300,
  avgSplitSeconds: null,
  temperatureCelsius: 32,
  sessionType: "easy",
  profile: baseProfile,
  ...neutralLoads,
});
print("Hot 10k (32°C)", hot.index, hot.breakdown.explanation);

const overreach = calculateEnduranceIndex({
  sport: "running",
  durationSeconds: 27.5 * 60,
  distanceMeters: 5000,
  elevationMeters: null,
  avgHeartRate: 165,
  avgPowerWatts: null,
  avgPaceSecondsPerKm: 330,
  avgSplitSeconds: null,
  temperatureCelsius: 15,
  sessionType: "tempo",
  profile: baseProfile,
  acuteLoad: 600,
  chronicLoad: 200,
});
print("Same 5k but overreached (ACWR≈3)", overreach.index, overreach.breakdown.explanation);

const swim = calculateEnduranceIndex({
  sport: "swimming",
  durationSeconds: 40 * 60,
  distanceMeters: 2000,
  elevationMeters: null,
  avgHeartRate: 145,
  avgPowerWatts: null,
  avgPaceSecondsPerKm: null,
  avgSplitSeconds: null,
  temperatureCelsius: null,
  sessionType: "easy",
  profile: baseProfile,
  ...neutralLoads,
});
print("2 km swim", swim.index, swim.breakdown.explanation);

const row = calculateEnduranceIndex({
  sport: "rowing",
  durationSeconds: 20 * 60,
  distanceMeters: 5000,
  elevationMeters: null,
  avgHeartRate: 168,
  avgPowerWatts: null,
  avgPaceSecondsPerKm: null,
  avgSplitSeconds: 130,
  temperatureCelsius: null,
  sessionType: "threshold",
  profile: baseProfile,
  ...neutralLoads,
});
print("5k row (2:10/500 split)", row.index, row.breakdown.explanation);

// ─── Strength V2 (DOTS / GL) ─────────────────────────────────────────────────

/** IPF reference: 75 kg male, 500 kg total → DOTS ≈ 414.7 */
const refTotal = 500;
const refBw = 75;
const refDots = calculateDOTS(refTotal, refBw, "male");
const refGl = calculateGLPoints(refTotal, refBw, "male", "classic");
console.log("\n── DOTS reference (500 kg @ 75 kg male) ──");
console.log(`  DOTS: ${refDots.toFixed(1)} (expect ~359 for 500 kg @ 75 kg)`);
console.log(`  → Strength Index: ${dotsToStrengthIndex(refDots)}`);
console.log(`  GL Points: ${refGl.toFixed(1)}`);

const gym = scoreActivity(
  {
    sport: "gym",
    durationSeconds: 3600,
    exercises: [
      { exercise_name: "Squat", muscle_group: "legs", weight_kg: 140, sets: 1, reps: 1, rpe: 9 },
      { exercise_name: "Bench Press", muscle_group: "chest", weight_kg: 100, sets: 1, reps: 1, rpe: 9 },
      { exercise_name: "Deadlift", muscle_group: "back", weight_kg: 180, sets: 1, reps: 1, rpe: 9 },
    ],
    profile: baseProfile,
    recentLoads: { acute: neutralLoads.acuteLoad, chronic: neutralLoads.chronicLoad },
  },
  { enduranceIndices: [], strengthIndices: [], splitIndices: [] }
);
print("Gym SBD singles (420 kg total, 75 kg male)", gym.sportIndex, gym.breakdown.explanation);
console.log(`  DOTS: ${gym.dotsScore?.toFixed(1)} | GL: ${gym.glPoints?.toFixed(1)}`);

// ─── Split index with custom weights ─────────────────────────────────────────

const split = scoreActivity(
  {
    sport: "running",
    durationSeconds: 27.5 * 60,
    distanceMeters: 5000,
    avgHeartRate: 165,
    avgPaceSecondsPerKm: 330,
    temperatureCelsius: 15,
    sessionType: "tempo",
    profile: { ...baseProfile, split_endurance_weight: 0.6 },
    recentLoads: { acute: neutralLoads.acuteLoad, chronic: neutralLoads.chronicLoad },
  },
  {
    enduranceIndices: [480, 470],
    strengthIndices: [520, 510],
    splitIndices: [500, 495],
  }
);
console.log("\n── Split Index (60/40 endurance bias) ──");
console.log(`  Sport index: ${split.sportIndex}`);
console.log(`  Endurance (recency-blended): ${split.enduranceIndex}`);
console.log(`  Strength (recency-blended): ${split.strengthIndex}`);
console.log(`  Split Index: ${split.splitIndex}`);
console.log(`  Breakdown: ${split.splitBreakdownLabel}`);
console.log(`  Fatigue: ${split.fatigueScore} | Recovery: ${split.recoveryScore}`);

console.log("\n✓ Sanity checks complete");
