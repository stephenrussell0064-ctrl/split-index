/**
 * Cardio prediction regression checks — run with:
 *   npx tsx src/lib/scoring/cardio-predictions-check.ts
 */
import {
  blendPredictedBenchmark,
  updatePrediction,
  applyDecay,
  effectiveStoredPrediction,
  QUALITY_PROXIMITY,
} from "./cardio-predictions";

let failed = 0;

function assertNear(label: string, actual: number, expected: number, tolerance = 2) {
  const ok = Math.abs(actual - expected) <= tolerance;
  console.log(`${ok ? "✓" : "✗"} ${label}: ${actual.toFixed(1)} (expected ~${expected})`);
  if (!ok) failed += 1;
}

function assertEqual(label: string, actual: number, expected: number) {
  const ok = actual === expected;
  console.log(`${ok ? "✓" : "✗"} ${label}: ${actual} (expected ${expected})`);
  if (!ok) failed += 1;
}

console.log("cardio-predictions — Part E regression\n");

const pr = 19 * 60 + 20; // 19:20
const easyEquiv = 25 * 60 + 30; // ~25:30 easy 10k equivalent

console.log("— E1: easy runs never move prediction slower —");
let stored = pr;
for (let i = 0; i < 4; i++) {
  stored = updatePrediction(stored, easyEquiv);
}
assertEqual("4 easy runs leave PR unchanged", stored, pr);

const hardRegress = 20 * 60 + 32; // 20:32 hard 5k
stored = pr;
stored = updatePrediction(stored, hardRegress);
assertNear("Hard regression gently pulls prediction", stored, 19 * 60 + 30, 5);

console.log("\n— E2: time-based decay —");
const decayedInactive = applyDecay(pr, 56, 30);
assertNear("56d inactive ≈ 19:47", decayedInactive, 19 * 60 + 47, 5);

const noDecayEasy = applyDecay(pr, 10, 30);
assertNear("Easy running within grace: no decay", noDecayEasy, pr, 1);

console.log(
  failed === 0 ? "\nAll cardio-predictions checks passed." : `\n${failed} check(s) failed.`
);
if (failed > 0) process.exitCode = 1;
