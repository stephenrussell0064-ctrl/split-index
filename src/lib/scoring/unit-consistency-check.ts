/**
 * Asserts identical scores when the same workout is expressed in metric vs imperial.
 * Run: npx tsx src/lib/scoring/unit-consistency-check.ts
 */

import { scoreActivity } from "./service";
import {
  kmToMeters,
  milesToMeters,
  lbToKg,
  kgToLb,
  paceSecPerKmFromSpeedKmh,
  speedKmhFromPaceSecPerKm,
} from "@/lib/units/conversions";
import type { SportType } from "@/types";

const profile = {
  max_hr: 190,
  weight_kg: 80,
  age: 30,
  gender: "male" as const,
  experience: "intermediate" as const,
  training_history_years: 3,
  split_endurance_weight: 0.5,
  preferred_sports: ["running" as SportType, "gym" as SportType],
};

const history = { enduranceIndices: [], strengthIndices: [], splitIndices: [] };

function assertEqual(label: string, a: number, b: number, tolerance = 0) {
  const ok = Math.abs(a - b) <= tolerance;
  console.log(`${ok ? "✓" : "✗"} ${label}: ${a} vs ${b}`);
  if (!ok) process.exitCode = 1;
}

console.log("Unit consistency — metric vs imperial round-trips\n");

// Running: 10 km vs 6.2137 miles
const runKm = 10;
const runMetersMetric = kmToMeters(runKm);
const runMetersImperial = milesToMeters(runKm * 0.621371);
const runDuration = 3000;

const runMetric = scoreActivity(
  {
    sport: "running",
    durationSeconds: runDuration,
    distanceMeters: runMetersMetric,
    profile,
    recentLoads: { acute: 100, chronic: 100 },
  },
  history
);

const runImperial = scoreActivity(
  {
    sport: "running",
    durationSeconds: runDuration,
    distanceMeters: runMetersImperial,
    profile,
    recentLoads: { acute: 100, chronic: 100 },
  },
  history
);

assertEqual("10 km run sport index", runMetric.sportIndex, runImperial.sportIndex);
assertEqual("10 km run split index", runMetric.splitIndex, runImperial.splitIndex);

// Pace vs speed equivalence (10 km in 50 min → 12 km/h → 300 sec/km)
const paceSecPerKm = paceSecPerKmFromSpeedKmh(12)!;
const speedFromPace = speedKmhFromPaceSecPerKm(paceSecPerKm)!;
assertEqual("pace/speed round-trip km/h", 12, speedFromPace, 0.1);

const runFromPace = scoreActivity(
  {
    sport: "running",
    durationSeconds: runDuration,
    distanceMeters: runMetersMetric,
    avgPaceSecondsPerKm: paceSecPerKm,
    profile,
    recentLoads: { acute: 100, chronic: 100 },
  },
  history
);
assertEqual("pace-derived run index", runMetric.sportIndex, runFromPace.sportIndex);

// Gym: 100 kg bench @ 80 kg BW vs 220.46 lb @ 176.37 lb BW
const benchKg = 100;
const bwKg = 80;
const benchLb = kgToLb(benchKg);
const bwLb = kgToLb(bwKg);

const gymMetric = scoreActivity(
  {
    sport: "gym",
    durationSeconds: 3600,
    exercises: [
      {
        exercise_name: "Bench Press",
        muscle_group: "chest",
        sets: Array.from({ length: 3 }, () => ({ weight_kg: benchKg, reps: 5 })),
        order_index: 0,
      },
    ],
    profile: { ...profile, weight_kg: bwKg },
    recentLoads: { acute: 100, chronic: 100 },
  },
  history
);

const gymImperial = scoreActivity(
  {
    sport: "gym",
    durationSeconds: 3600,
    exercises: [
      {
        exercise_name: "Bench Press",
        muscle_group: "chest",
        sets: Array.from({ length: 3 }, () => ({ weight_kg: lbToKg(benchLb), reps: 5 })),
        order_index: 0,
      },
    ],
    profile: { ...profile, weight_kg: lbToKg(bwLb) },
    recentLoads: { acute: 100, chronic: 100 },
  },
  history
);

assertEqual("bench sport index (kg vs lb)", gymMetric.sportIndex, gymImperial.sportIndex);
assertEqual("bench DOTS (kg vs lb)", gymMetric.dotsScore ?? 0, gymImperial.dotsScore ?? 0, 0.5);

// Swimming: 1500 m vs 1500 m (no conversion drift)
const swimA = scoreActivity(
  {
    sport: "swimming",
    durationSeconds: 1800,
    distanceMeters: 1500,
    profile,
    recentLoads: { acute: 50, chronic: 50 },
  },
  history
);
const swimB = scoreActivity(
  {
    sport: "swimming",
    durationSeconds: 1800,
    distanceMeters: 1500,
    profile,
    recentLoads: { acute: 50, chronic: 50 },
  },
  history
);
assertEqual("swim distance identity", swimA.sportIndex, swimB.sportIndex);

console.log("\nDone.");
