/**
 * Scoring edge-case harness — run with:
 *   npx tsx src/lib/scoring/edge-case-check.ts
 */

import { scoreCardioActivity } from "./cardio-activity";
import { scoreStrength } from "./split-strength-engine";
import { assertScoringInput, ScoringInputError } from "./input-guards";

let failed = 0;

function expectThrows(label: string, fn: () => void) {
  try {
    fn();
    console.log(`✗ ${label}: expected throw, got success`);
    failed += 1;
  } catch {
    console.log(`✓ ${label}: rejected`);
  }
}

function expectFinite(label: string, score: number) {
  const ok = Number.isFinite(score) && score >= 0 && score <= 1000;
  console.log(`${ok ? "✓" : "✗"} ${label}: score=${score}`);
  if (!ok) failed += 1;
}

console.log("Scoring edge-case checks\n");

expectThrows("zero duration", () =>
  assertScoringInput({ sport: "running", durationSeconds: 0 })
);
expectThrows("negative distance", () =>
  assertScoringInput({ sport: "running", durationSeconds: 1800, distanceMeters: -100 })
);
expectThrows("absurd distance", () =>
  assertScoringInput({ sport: "running", durationSeconds: 3600, distanceMeters: 10_000_000 })
);
expectThrows("500kg bench at 40kg BW", () =>
  assertScoringInput({
    sport: "gym",
    durationSeconds: 3600,
    profile: { weight_kg: 40 },
    exercises: [{ sets: [{ weight_kg: 500, reps: 1 }] }],
  })
);

const tinySwim = scoreCardioActivity({
  type: "swim",
  benchmarkSport: "swim",
  distanceMeters: 2,
  durationSeconds: 60,
  sex: "male",
  age: 30,
});
expectFinite("2m swim", tinySwim.score);

const fiveK = scoreCardioActivity({
  type: "run",
  benchmarkSport: "run",
  distanceMeters: 5000,
  durationSeconds: 22.5 * 60,
  sex: "male",
  age: 30,
  restingHR: 50,
  maxHR: 190,
  avgHR: 165,
});
expectFinite("valid 5K with HR", fiveK.score);

const noHr = scoreCardioActivity({
  type: "run",
  benchmarkSport: "run",
  distanceMeters: 5000,
  durationSeconds: 22.5 * 60,
  sex: "male",
  age: 30,
});
expectFinite("5K without HR", noHr.score);

const squat = scoreStrength({
  liftKey: "squat",
  history: [],
  latestSet: { weightKg: 100, reps: 5 },
  bodyweightKg: 80,
  sex: "male",
  age: 28,
  isPremium: false,
});
expectFinite("valid squat", squat.score);

try {
  assertScoringInput({
    sport: "gym",
    durationSeconds: 3600,
    profile: { weight_kg: 75 },
    exercises: [{ sets: [{ weight_kg: 140, reps: 5 }, { weight_kg: 140, reps: 5 }, { weight_kg: 140, reps: 5 }] }],
  });
  console.log("✓ normal gym session passes guards");
} catch (e) {
  console.log(`✗ normal gym session rejected: ${(e as Error).message}`);
  failed += 1;
}

console.log(failed === 0 ? "\nAll edge-case checks passed." : `\n${failed} check(s) failed.`);
if (failed > 0) process.exitCode = 1;
