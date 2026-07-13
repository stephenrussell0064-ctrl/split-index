/**
 * User-reported lift calibration — run with:
 *   npx tsx src/lib/scoring/lift-calibration-check.ts
 */
import { scoreStrength } from "./split-strength-engine";
import { resolveScoringWeight } from "./weight-entry";

const BW = 80;
let failed = 0;

function scoreLift(
  name: string,
  weight: number,
  reps: number,
  mode?: "total" | "per_hand" | "added"
) {
  const resolved = resolveScoringWeight(weight, name, mode);
  return scoreStrength({
    liftKey: name,
    history: [],
    latestSet: { weightKg: resolved.scoringWeightKg, reps },
    bodyweightKg: BW,
    sex: "male",
    age: 28,
    isPremium: false,
    isBodyweightRelative: resolved.isBodyweightRelative,
    weightEntryMode: resolved.mode,
  }).score;
}

function assertNear(label: string, actual: number, expected: number, tol = 25) {
  const ok = Math.abs(actual - expected) <= tol;
  console.log(`${ok ? "✓" : "✗"} ${label}: ${actual} (target ~${expected})`);
  if (!ok) failed += 1;
}

console.log("Lift calibration @ 80kg BW\n");

assertNear("Walking Lunges 25/hand ×8", scoreLift("Walking Lunges", 25, 8, "per_hand"), 525);
assertNear("Bulgarian Split Squat 35/hand ×8", scoreLift("Bulgarian Split Squat", 35, 8, "per_hand"), 600);
assertNear("Leg Extension 96×10", scoreLift("Leg Extension", 96, 10), 700);
assertNear("Standing Calf Raise 100×8", scoreLift("Standing Calf Raise", 100, 8), 675);
assertNear("Hip Adduction 78×8", scoreLift("Hip Adduction", 78, 8), 675);
assertNear("Seated Leg Curl 50×8", scoreLift("Seated Leg Curl", 50, 8), 600);
assertNear("Bench Press 120×4", scoreLift("Bench Press", 120, 4), 800);
assertNear("Bench Press 110×6", scoreLift("Bench Press", 110, 6), 800);
assertNear("Bench Press 100×9", scoreLift("Bench Press", 100, 9), 800);
assertNear("Incline DB Press 45/hand ×8", scoreLift("Incline Dumbbell Press", 45, 8, "per_hand"), 800);
assertNear("Machine Chest Press 75×8", scoreLift("Machine Chest Press", 75, 8), 675);
assertNear("Weighted Dips +20×8", scoreLift("Weighted Dips", 20, 8, "added"), 575);
assertNear("Cable Fly 30×8", scoreLift("Cable Fly", 30, 8), 600);
assertNear("Pec Deck 114×8", scoreLift("Pec Deck", 114, 8), 800);
assertNear("Barbell Row 80×8", scoreLift("Barbell Row", 80, 8), 750);
assertNear("Weighted Pull Up +30×8", scoreLift("Weighted Pull Up", 30, 8, "added"), 800);
assertNear("Dumbbell Curl 20/hand ×8", scoreLift("Dumbbell Curl", 20, 8, "per_hand"), 750);
assertNear("Preacher Curl 45×8", scoreLift("Preacher Curl", 45, 8), 740);
assertNear("Single Arm Pushdown 13×8", scoreLift("Single Arm Pushdown", 13, 8), 550);
assertNear("Rope Pushdown 30×8", scoreLift("Rope Pushdown", 30, 8), 675);

console.log(failed === 0 ? "\nAll calibration checks passed." : `\n${failed} check(s) out of tolerance.`);
if (failed > 0) process.exitCode = 1;
