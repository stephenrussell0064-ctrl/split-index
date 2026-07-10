/**
 * V2 engine fixtures from scoring-engine README — run with:
 *   npx tsx src/lib/scoring/v2-sanity-check.ts
 */

import { scoreCardioActivity, riegelPredictions } from "./cardio-activity";
import { calculateDOTS as dotsScore } from "./strength/dots";

function formatRace(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.round(seconds % 60);
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

function assertNear(label: string, actual: number, expected: number, tolerance: number) {
  const ok = Math.abs(actual - expected) <= tolerance;
  console.log(`${ok ? "✓" : "✗"} ${label}: ${actual} (expected ~${expected})`);
  if (!ok) process.exitCode = 1;
}

console.log("V2 Scoring Engine — README fixtures\n");

const fiveKSeconds = 22.5 * 60;
const withHr = scoreCardioActivity({
  type: "run",
  benchmarkSport: "run",
  distanceMeters: 5000,
  durationSeconds: fiveKSeconds,
  sex: "male",
  age: 30,
  restingHR: 50,
  maxHR: 190,
  avgHR: 165,
  experience: "intermediate",
});

const withoutHr = scoreCardioActivity({
  type: "run",
  benchmarkSport: "run",
  distanceMeters: 5000,
  durationSeconds: fiveKSeconds,
  sex: "male",
  age: 30,
  experience: "intermediate",
});

const predictions = riegelPredictions(5000, fiveKSeconds, "intermediate");

console.log("── Cardio: 22:30 5K ──");
assertNear("VO2max with HR", withHr.vo2max ?? 0, 58.1, 0.5);
// Primary score now comes from the benchmark anchor table (MASTER-BRIEF.md
// §4): 22:30/5k sits on the 575 anchor, +~39 from the endurance-volume
// bonus, then the HR-adjustment nudges it up further since 165bpm is below
// the 175 running reference (proven fitness at a lower HR).
assertNear("Session score with HR", withHr.score, 614, 5);
console.log(`  Riegel 10K: ${formatRace(predictions?.["10000"] ?? 0)} (expect 46:54)`);
console.log(`  Riegel half: ${formatRace(predictions?.["21097.5"] ?? 0)} (expect 1:43:30)`);
console.log(`  Riegel marathon: ${formatRace(predictions?.["42195"] ?? 0)} (expect 3:35:48)`);
console.log(`  Score without HR: ${withoutHr.score} (expect close to, but not above, the with-HR score)`);

console.log("\n── Strength: DOTS ──");
assertNear("500 kg @ 90 kg male", dotsScore(500, 90, "male"), 323.3, 0.2);
assertNear("400 kg @ 60 kg female", dotsScore(400, 60, "female"), 443.4, 0.2);

// Pace (Riegel) is the primary driver now — HR only refines the equivalent
// by up to ±10% (MASTER-BRIEF.md §5), so without-HR should be close to the
// with-HR score, not heavily discounted, but shouldn't exceed it here since
// 165bpm is below the reference and earns a small upward adjustment.
if ((withoutHr.score ?? 0) > (withHr.score ?? 0)) {
  console.log("✗ Without-HR score should not exceed the HR-adjusted score here");
  process.exitCode = 1;
} else {
  console.log("✓ HR-adjusted score is at least as high as the no-HR baseline");
}

console.log("\nDone.");
