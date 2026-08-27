/**
 * User-reported cardio calibration — run with:
 *   npx tsx src/lib/scoring/cardio-calibration-check.ts
 *
 * This is a tsx script, NOT a vitest suite, so nothing runs it in CI and it
 * can drift silently — it had been failing for some time before anyone
 * looked. Each target below now records WHICH user report it came from and
 * whether a later deliberate recalibration has superseded it, because a
 * stale target that nobody can date is worse than no target: it gets "fixed"
 * to whatever the code currently says.
 */
import { scoreCardioActivity } from "./cardio-activity";

let failed = 0;

function assertNear(label: string, actual: number, expected: number, tol = 30) {
  const ok = Math.abs(actual - expected) <= tol;
  console.log(`${ok ? "✓" : "✗"} ${label}: ${actual} (target ~${expected})`);
  if (!ok) failed += 1;
}

console.log("Cardio calibration\n");

// 19:20 5k, near-max effort HR — reported 668, user expected ~760.
//
// SUPERSEDED, and left here rather than deleted because the reason matters.
// The 760 target was set against the old Motera-derived run table. That
// table was then replaced wholesale, with the user's explicit sign-off, by
// the general-population one ("i want split index scores to be for the
// average people getitng into runs not elite athletes") — which by design
// moved every run score up. 835 is that rebase working, not a regression:
// the user's underlying complaint was that 668 was too LOW, and 835 honours
// it more fully than 760 did. Target restated to the post-rebase curve.
const run5k = scoreCardioActivity({
  type: "run",
  benchmarkSport: "run",
  distanceMeters: 5000,
  durationSeconds: 1160,
  sex: "male",
  age: 30,
  avgHR: 190,
});
assertNear("19:20 5k @ HR190", run5k.score, 835, 40);

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
//
// STILL LIVE, and the most useful check in this file. It sat at 346 for
// months — the row anchor table was on Concept2-logbook percentiles while
// run had been rebased to the general population, so rowing was scored
// against a far fitter reference population than running was. Rebasing row
// onto run's population brings this to ~646 against a target set long
// before, from an independent direction. Nothing here was tuned to hit it.
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

// 6,000m row at 1:56/500m (23:12) — reported 548, "too low. This is not
// representative of the performance of the row." Same root cause as the
// 2:04/40:00 check above. A strong club 6k should read as a strong effort,
// a notch under this athlete's own 18:25 5k (872) rather than half of it.
const row6k = scoreCardioActivity({
  type: "row",
  benchmarkSport: "row",
  distanceMeters: 6000,
  durationSeconds: 12 * 116,
  sex: "male",
  age: 30,
  avgHR: 160,
});
assertNear("6,000m row @ 1:56/500m, HR160", row6k.score, 745, 45);

console.log(failed === 0 ? "\nAll cardio calibration checks passed." : `\n${failed} check(s) out of tolerance.`);
if (failed > 0) process.exitCode = 1;
