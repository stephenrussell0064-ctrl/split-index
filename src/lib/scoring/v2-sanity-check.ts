/**
 * V2 engine fixtures from scoring-engine README — run with:
 *   npx tsx src/lib/scoring/v2-sanity-check.ts
 */

import { scoreCardioActivity, riegelPredictions } from "./cardio-activity";
import { dotsScore } from "./strength-activity";

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
  distanceMeters: 5000,
  durationSeconds: fiveKSeconds,
  sex: "male",
  age: 30,
  experience: "intermediate",
});

const predictions = riegelPredictions(5000, fiveKSeconds, "intermediate");

console.log("── Cardio: 22:30 5K ──");
assertNear("VO2max with HR", withHr.vo2max ?? 0, 58.1, 0.5);
// +19 vs. the pre-volume-bonus baseline (647): a 22:30 session earns a small
// endurance-volume credit on top of the pace/HR-based base score.
assertNear("Session score with HR", withHr.score, 666, 5);
console.log(`  Riegel 10K: ${formatRace(predictions?.["10000"] ?? 0)} (expect 46:54)`);
console.log(`  Riegel half: ${formatRace(predictions?.["21097.5"] ?? 0)} (expect 1:43:30)`);
console.log(`  Riegel marathon: ${formatRace(predictions?.["42195"] ?? 0)} (expect 3:35:48)`);
console.log(`  Score without HR: ${withoutHr.score} (expect capped well below with-HR score)`);

console.log("\n── Strength: DOTS ──");
assertNear("500 kg @ 90 kg male", dotsScore(500, 90, "male"), 323.3, 0.2);
assertNear("400 kg @ 60 kg female", dotsScore(400, 60, "female"), 443.4, 0.2);

if ((withoutHr.score ?? 0) >= (withHr.score ?? 0) - 50) {
  console.log("✗ Without-HR score should be materially lower than HR-verified score");
  process.exitCode = 1;
} else {
  console.log("✓ HR-verified score exceeds no-HR cap");
}

console.log("\nDone.");
