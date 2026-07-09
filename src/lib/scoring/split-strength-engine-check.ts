/**
 * split-strength-engine calibration fixtures — run with:
 *   npx tsx src/lib/scoring/split-strength-engine-check.ts
 *
 * Fixtures from IMPLEMENTATION-BRIEF.md, all at 83kg male. Asserts within ±3.
 */
import { scoreStrength, ageFactor, type LoggedSet } from "./split-strength-engine";

let failed = 0;

function assertNear(label: string, actual: number, expected: number, tolerance = 3) {
  const ok = Math.abs(actual - expected) <= tolerance;
  console.log(`${ok ? "✓" : "✗"} ${label}: ${actual} (expected ~${expected})`);
  if (!ok) failed += 1;
}

function assertEqual<T>(label: string, actual: T, expected: T) {
  const ok = actual === expected;
  console.log(`${ok ? "✓" : "✗"} ${label}: ${actual} (expected ${expected})`);
  if (!ok) failed += 1;
}

function scoreSingleSet(liftKey: string, oneRM: number, bodyweightKg = 83) {
  // A single set at reps=1 makes epley1RM(weight, 1) = weight = oneRM exactly.
  return scoreStrength({
    liftKey,
    history: [],
    latestSet: { weightKg: oneRM, reps: 1 },
    bodyweightKg,
    sex: "male",
    age: 28, // inside the flat 20–35 band, so age factor is neutral
    isPremium: false,
  });
}

console.log("split-strength-engine — calibration fixtures\n");

const fixtures: Array<[string, number, number, string]> = [
  ["bench", 140, 850, "Elite"],
  ["squat", 160, 750, "Advanced"],
  ["deadlift", 200, 770, "Advanced"],
  ["ohp", 75, 790, "Advanced"],
  ["barbellRow", 120, 810, "Advanced"],
  ["frontSquat", 120, 720, "Semi-Pro"],
  ["inclineBench", 100, 800, "Advanced"],
  ["weightedPullup", 50, 800, "Advanced"],
  ["inclineDbPress", 55, 875, "Elite"],
  ["flatDbPress", 50, 750, "Advanced"],
  ["machineChestPress", 120, 825, "Advanced"],
  ["tricepPushdown", 60, 810, "Advanced"],
  ["dbShoulderPress", 40, 805, "Advanced"],
  ["lateralRaise", 22, 710, "Semi-Pro"],
  ["dbRow", 67, 720, "Semi-Pro"],
  ["barbellCurl", 60, 810, "Advanced"],
  ["preacherCurl", 65, 810, "Advanced"],
  ["latPulldown", 145, 760, "Advanced"],
  ["legExtension", 150, 758, "Advanced"],
  ["bulgarianSplit", 55, 750, "Advanced"],
];

for (const [lift, oneRM, expectedScore, expectedTier] of fixtures) {
  const result = scoreSingleSet(lift, oneRM);
  assertNear(`${lift} ${oneRM}kg -> score`, result.score, expectedScore);
  assertEqual(`${lift} -> tier`, result.tier, expectedTier);
}

console.log("\n— Sex factor —");
const femaleBench = scoreStrength({
  liftKey: "bench",
  history: [],
  latestSet: { weightKg: 84, reps: 1 },
  bodyweightKg: 83,
  sex: "female",
  age: 28,
  isPremium: false,
});
assertNear("Female 84kg bench @ 83kg BW", femaleBench.score, 850, 5);

console.log("\n— Age factor —");
assertNear("ageFactor(35)", ageFactor(35), 1.0, 0.001);
assertNear("ageFactor(50)", ageFactor(50), 1.11, 0.001);
const older = scoreSingleSet("bench", 140);
const olderResult = scoreStrength({
  liftKey: "bench",
  history: [],
  latestSet: { weightKg: 140, reps: 1 },
  bodyweightKg: 83,
  sex: "male",
  age: 50,
  isPremium: false,
});
console.log(
  `25yo bench 140kg: ${older.score} vs 50yo bench 140kg: ${olderResult.score} (expect 50yo modestly higher, same Elite tier)`
);
if (!(olderResult.score > older.score && olderResult.tier === "Elite")) {
  console.log("✗ age factor did not produce the expected gentle same-tier boost");
  failed += 1;
} else {
  console.log("✓ age factor boosts score while staying in the same tier");
}

console.log("\n— Reported bug regression (lat raise vs pec deck should not both hit extremes) —");
// Matching the originally reported case (8 reps, 3 sets @ 11kg vs 10 reps, 3 sets @ 131kg)
const latRaiseReal = scoreStrength({
  liftKey: "Lateral Raise",
  history: [],
  latestSet: { weightKg: 11, reps: 8 },
  bodyweightKg: 83,
  sex: "male",
  age: 28,
  isPremium: false,
});
const pecDeckReal = scoreStrength({
  liftKey: "Pec Deck",
  history: [],
  latestSet: { weightKg: 131, reps: 10 },
  bodyweightKg: 83,
  sex: "male",
  age: 28,
  isPremium: false,
});
console.log(`Lateral Raise 11kg x8: score=${latRaiseReal.score}, tier=${latRaiseReal.tier}, source=${latRaiseReal.source}`);
console.log(`Pec Deck 131kg x10: score=${pecDeckReal.score}, tier=${pecDeckReal.tier}, source=${pecDeckReal.source}`);
if (pecDeckReal.score >= 999 && !pecDeckReal.flags.includes("near-record")) {
  console.log("✗ pec deck hit 999 without a near-record explanation");
  failed += 1;
}

console.log("\n— Premium adaptive history vs free single-set —");
const history: LoggedSet[] = [
  { weightKg: 100, reps: 5, performedAt: "2026-01-05T00:00:00Z" },
  { weightKg: 110, reps: 5, performedAt: "2026-03-05T00:00:00Z" },
  { weightKg: 120, reps: 3, performedAt: "2026-05-05T00:00:00Z" },
  { weightKg: 125, reps: 5, performedAt: "2026-06-20T00:00:00Z" },
];
const freeResult = scoreStrength({
  liftKey: "bench",
  history,
  latestSet: { weightKg: 125, reps: 5 },
  bodyweightKg: 83,
  sex: "male",
  age: 28,
  isPremium: false,
});
const premiumResult = scoreStrength({
  liftKey: "bench",
  history,
  latestSet: { weightKg: 125, reps: 5 },
  bodyweightKg: 83,
  sex: "male",
  age: 28,
  isPremium: true,
});
console.log(`Free (latest set only): oneRM=${freeResult.oneRM}, oneRMBandKg=${freeResult.oneRMBandKg}, trend=${freeResult.trend}`);
console.log(`Premium (full history): oneRM=${premiumResult.oneRM}, oneRMBandKg=${premiumResult.oneRMBandKg}, trend=${premiumResult.trend}`);
if (premiumResult.oneRMBandKg === null || premiumResult.trend === null) {
  console.log("✗ premium result should expose oneRMBandKg and trend");
  failed += 1;
} else {
  console.log("✓ premium result exposes adaptive fields; free result hides them");
}
if (freeResult.oneRMBandKg !== null || freeResult.trend !== null) {
  console.log("✗ free result should NOT expose oneRMBandKg/trend");
  failed += 1;
}
if (premiumResult.trend !== "up") {
  console.log(`✗ expected an upward trend given rising history, got ${premiumResult.trend}`);
  failed += 1;
}

console.log(
  failed === 0 ? "\nAll split-strength-engine checks passed." : `\n${failed} check(s) failed.`
);
if (failed > 0) process.exitCode = 1;
