/**
 * User-reported cardio calibration — run with:
 *   npx tsx src/lib/scoring/cardio-calibration-check.ts
 */
import { scoreCardioActivity } from "./cardio-activity";

let failed = 0;

function assertNear(label: string, actual: number, expected: number, tol = 30) {
  const ok = Math.abs(actual - expected) <= tol;
  console.log(`${ok ? "✓" : "✗"} ${label}: ${actual} (target ~${expected})`);
  if (!ok) failed += 1;
}

console.log("Cardio calibration\n");

// 19:20 5k, near-max effort HR — reported 668, expected ~760.
const run5k = scoreCardioActivity({
  type: "run",
  benchmarkSport: "run",
  distanceMeters: 5000,
  durationSeconds: 1160,
  sex: "male",
  age: 30,
  avgHR: 190,
});
assertNear("19:20 5k @ HR190", run5k.score, 760, 40);

// 18.24km @ 4:55/km, HR173 — reported 642, expected ~770.
const longRun = scoreCardioActivity({
  type: "run",
  benchmarkSport: "run",
  distanceMeters: 18240,
  durationSeconds: 18.24 * 295,
  sex: "male",
  age: 30,
  avgHR: 173,
});
assertNear("18.24km @ 4:55/km, HR173", longRun.score, 770, 110);

// 2:04/500m row, 40min, HR166 — reported 580, expected ~650.
const row40 = scoreCardioActivity({
  type: "row",
  benchmarkSport: "row",
  distanceMeters: (2400 / 124) * 500,
  durationSeconds: 2400,
  sex: "male",
  age: 30,
  avgHR: 166,
});
assertNear("2:04/500m row x40min, HR166", row40.score, 650, 40);

console.log(failed === 0 ? "\nAll cardio calibration checks passed." : `\n${failed} check(s) out of tolerance.`);
if (failed > 0) process.exitCode = 1;
