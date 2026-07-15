/**
 * split-strength-engine calibration fixtures — run with:
 *   npx tsx src/lib/scoring/split-strength-engine-check.ts
 */
import { scoreStrength, ageFactor, SEX_FACTORS, type LoggedSet } from "./split-strength-engine";
import { weightedCalisthenic1RM, epley1RM } from "./strength/one-rm";
import { scoreCardioActivity } from "./cardio-activity";
import { buildCardioInput } from "./adapters";
import { FEMALE_CARDIO_FACTORS } from "./cardio-benchmarks";

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
  ["bench", 140, 791, "Advanced"],
  ["squat", 160, 750, "Advanced"],
  ["deadlift", 200, 770, "Advanced"],
  ["ohp", 75, 790, "Advanced"],
  ["barbellRow", 120, 783, "Advanced"],
  ["frontSquat", 120, 720, "Semi-Pro"],
  ["inclineBench", 100, 740, "Advanced"],
  ["weightedPullup", 50, 726, "Advanced"],
  ["inclineDbPress", 55, 492, "Semi-Pro"],
  ["flatDbPress", 50, 690, "Semi-Pro"],
  ["machineChestPress", 120, 732, "Advanced"],
  ["tricepPushdown", 60, 817, "Advanced"],
  ["dbShoulderPress", 40, 805, "Advanced"],
  ["lateralRaise", 22, 710, "Semi-Pro"],
  ["dbRow", 67, 720, "Semi-Pro"],
  ["barbellCurl", 60, 783, "Advanced"],
  ["preacherCurl", 65, 758, "Advanced"],
  ["latPulldown", 145, 760, "Advanced"],
  ["legExtension", 150, 729, "Advanced"],
  ["bulgarianSplit", 55, 387, "Intermediate"],
];

for (const [lift, oneRM, expectedScore, expectedTier] of fixtures) {
  const result = scoreSingleSet(lift, oneRM);
  assertNear(`${lift} ${oneRM}kg -> score`, result.score, expectedScore);
  assertEqual(`${lift} -> tier`, result.tier, expectedTier);
}

console.log("\n— Sex factor (Part A + F regression) —");
assertEqual("SEX_FACTORS.upper", SEX_FACTORS.upperBody, 0.85);
assertEqual("SEX_FACTORS.pull", SEX_FACTORS.pull, 0.73);
assertEqual("SEX_FACTORS.lower", SEX_FACTORS.lowerBody, 0.78);

const maleBench = scoreStrength({
  liftKey: "bench",
  history: [],
  latestSet: { weightKg: 100, reps: 1 },
  bodyweightKg: 83,
  sex: "male",
  age: 28,
  isPremium: false,
});
const femaleBench = scoreStrength({
  liftKey: "bench",
  history: [],
  latestSet: { weightKg: 100, reps: 1 },
  bodyweightKg: 83,
  sex: "female",
  age: 28,
  isPremium: false,
});
console.log(`Male 100kg bench: ${maleBench.score}, Female 100kg bench: ${femaleBench.score}`);
if (!(femaleBench.score > maleBench.score)) {
  console.log("✗ female bench should score higher than male at same absolute weight (easier anchor)");
  failed += 1;
} else {
  console.log("✓ female vs male strength scores differ by sex factor");
}
if (!femaleBench.flags.includes("female-strength-beta")) {
  console.log("✗ female scores should carry female-strength-beta flag");
  failed += 1;
}

const maleRun = scoreCardioActivity(
  buildCardioInput({
    sport: "running",
    durationSeconds: 20 * 60,
    distanceMeters: 5000,
    gender: "male",
    age: 30,
  })
);
const femaleRun = scoreCardioActivity(
  buildCardioInput({
    sport: "running",
    durationSeconds: 20 * 60,
    distanceMeters: 5000,
    gender: "female",
    age: 30,
  })
);
if (femaleRun.score === maleRun.score) {
  console.log("✗ female and male run scores must differ");
  failed += 1;
} else {
  console.log(
    `✓ female vs male run scores differ (F factor ${FEMALE_CARDIO_FACTORS.run}): ${femaleRun.score} vs ${maleRun.score}`
  );
}

console.log("\n— Part B1 weighted calisthenics —");
const wc1rm = weightedCalisthenic1RM(30, 8, 83);
assertNear("30kg×8 weighted pull-up 1RM @83kg BW", wc1rm, 48, 2);

console.log("\n— Part D isolation 1RM —");
const iso1rm = epley1RM(13, 8, "isolation");
assertNear("13kg×8 isolation pushdown 1RM", iso1rm, 19.9, 0.5);

const saPush = scoreStrength({
  liftKey: "Single Arm Pushdown",
  history: [],
  latestSet: { weightKg: 13, reps: 8 },
  bodyweightKg: 83,
  sex: "male",
  age: 28,
  isPremium: false,
  weightEntryMode: "per_hand",
  exerciseName: "Single Arm Pushdown",
});
assertNear("Single-arm pushdown 13×8 end-to-end score", saPush.score, 673, 15);

console.log("\n— Part B2 db curl —");
const dbCurlScore = scoreStrength({
  liftKey: "Dumbbell Curl",
  history: [],
  latestSet: { weightKg: 32.5, reps: 1 },
  bodyweightKg: 83,
  sex: "male",
  age: 28,
  isPremium: false,
  weightEntryMode: "per_hand",
  exerciseName: "Dumbbell Curl",
});
assertNear("32.5kg/hand curl 1RM score", dbCurlScore.score, 675, 40);

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
if (!(olderResult.score > older.score && olderResult.tier === "Advanced")) {
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
