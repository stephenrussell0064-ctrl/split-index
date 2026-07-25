/**
 * Bracket widening fixtures — run with:
 *   npx tsx src/lib/social/leaderboard-brackets-check.ts
 */
import {
  MIN_BRACKET_SIZE,
  formatExactBracketLabel,
  resolveBracket,
  ageBandFor,
  weightBandFor,
  type BracketCandidate,
} from "./leaderboard-brackets";

let failed = 0;

function assert(label: string, ok: boolean, detail?: string) {
  console.log(`${ok ? "✓" : "✗"} ${label}${detail ? `: ${detail}` : ""}`);
  if (!ok) failed += 1;
}

function makeCandidate(
  id: string,
  age: number,
  weightKg: number,
  gender: "male" | "female"
): BracketCandidate {
  return { userId: id, age, weightKg, gender };
}

console.log("leaderboard-brackets — fixtures\n");

const age = ageBandFor(28);
assert("age 28 → 25-34", age.label === "25-34", age.label);
const weight = weightBandFor(83);
assert("weight 83 → 80-90kg", weight.label === "80-90kg", weight.label);
assert(
  "exact label format",
  formatExactBracketLabel("male", age, weight) === "Male · 25-34 · 80-90kg"
);

// Sparse exact bracket → widen toward nearer weight boundary.
// 83kg is closer to 80 than 90, so adjacent band is 70-80kg.
const sparse: BracketCandidate[] = [
  makeCandidate("me", 28, 83, "male"),
  makeCandidate("a", 28, 84, "male"),
  makeCandidate("b", 27, 81, "male"),
];
for (let i = 0; i < MIN_BRACKET_SIZE; i++) {
  sparse.push(makeCandidate(`w${i}`, 28, 75, "male")); // 70-80kg adjacent
}

const r1 = resolveBracket({ age: 28, weightKg: 83, gender: "male" }, sparse);
assert("sparse exact widens", r1 != null && r1.effective.widenLevel !== "exact");
assert(
  "exact label preserved after widen",
  r1?.exact.label === "Male · 25-34 · 80-90kg",
  r1?.exact.label
);
assert(
  "weight widen preferred first when adjacent fills",
  r1?.effective.widenLevel === "weight",
  r1?.effective.widenLevel
);
assert("no invite prompt on weight widen", r1?.showInvitePrompt === false);

// Only a few males total → sex-only then global with invite.
const tiny: BracketCandidate[] = [
  makeCandidate("me", 28, 83, "male"),
  makeCandidate("a", 40, 70, "male"),
  makeCandidate("f1", 28, 60, "female"),
];
for (let i = 0; i < 5; i++) {
  tiny.push(makeCandidate(`f${i + 2}`, 30, 65, "female"));
}
const r2 = resolveBracket({ age: 28, weightKg: 83, gender: "male" }, tiny);
assert(
  "tiny male pool → sex_only or global",
  r2?.effective.widenLevel === "sex_only" || r2?.effective.widenLevel === "global",
  r2?.effective.widenLevel
);
assert("invite prompt at sex_only/global", r2?.showInvitePrompt === true);

// Missing profile fields.
const r3 = resolveBracket({ age: null, weightKg: 80, gender: "male" }, sparse);
assert("missing age → null resolution", r3 === null);

// Well-populated exact bracket — no widen.
const full: BracketCandidate[] = [];
for (let i = 0; i < MIN_BRACKET_SIZE; i++) {
  full.push(makeCandidate(`m${i}`, 28, 82 + (i % 5) * 0.5, "male"));
}
const r4 = resolveBracket({ age: 28, weightKg: 83, gender: "male" }, full);
assert("full bracket stays exact", r4?.effective.widenLevel === "exact");
assert("full bracket size", (r4?.size ?? 0) >= MIN_BRACKET_SIZE, String(r4?.size));
assert("no invite on exact", r4?.showInvitePrompt === false);

console.log(failed === 0 ? "\nAll bracket checks passed.\n" : `\n${failed} failed.\n`);
process.exit(failed === 0 ? 0 : 1);
