/**
 * What does the engine actually give people?
 *
 * Prints running and gym scores across a matrix of ages, sexes and
 * bodyweights, so the numbers can be read against what an athlete of that
 * description would really be expected to do. Reference points are marked:
 * where a row corresponds to a published standard or a well-known benchmark,
 * the expectation is printed beside the score.
 *
 *   npx tsx scripts/score-calibration-matrix.ts
 *
 * Reads nothing and writes nothing — it calls the same pure scoring functions
 * the app calls, so what it prints is what an athlete would see.
 */
import { scoreCardioActivity } from "../src/lib/scoring/cardio-activity";
import { scoreStrength } from "../src/lib/scoring/split-strength-engine";

type Sex = "male" | "female";

const pace = (secPerKm: number) =>
  `${Math.floor(secPerKm / 60)}:${String(Math.round(secPerKm % 60)).padStart(2, "0")}/km`;

function runScore(opts: {
  distanceMeters: number;
  secPerKm: number;
  sex: Sex;
  age: number;
  avgHR?: number;
}): number {
  const durationSeconds = Math.round((opts.distanceMeters / 1000) * opts.secPerKm);
  return scoreCardioActivity({
    type: "run",
    benchmarkSport: "run",
    distanceMeters: opts.distanceMeters,
    durationSeconds,
    sex: opts.sex,
    age: opts.age,
    avgHR: opts.avgHR,
  }).populationScore;
}

function liftScore(opts: {
  liftKey: string;
  weightKg: number;
  reps: number;
  bodyweightKg: number;
  sex: Sex;
  age?: number;
}): number {
  const r = scoreStrength({
    liftKey: opts.liftKey,
    history: [],
    latestSet: { weightKg: opts.weightKg, reps: opts.reps },
    bodyweightKg: opts.bodyweightKg,
    sex: opts.sex,
    // 30 sits inside the flat 23-35 age band, so the age factor is exactly 1
    // and these columns isolate bodyweight and sex. Age grading gets its own
    // table below.
    age: opts.age ?? 30,
    isPremium: true,
  });
  return r.score;
}

console.log("\n══════════ RUNNING — 5 km, by pace, sex and age ══════════");
console.log("  Population score. Same performance, so the only movers are the sex");
console.log("  factor and age grading.\n");
console.log(
  "  " +
    "pace".padEnd(10) +
    ["M25", "M40", "M55", "F25", "F40", "F55"].map((h) => h.padStart(7)).join("")
);
for (const secPerKm of [180, 200, 220, 240, 270, 300, 330, 360, 420]) {
  const row = ([
    ["male", 25],
    ["male", 40],
    ["male", 55],
    ["female", 25],
    ["female", 40],
    ["female", 55],
  ] as [Sex, number][]).map(([sex, age]) =>
    String(runScore({ distanceMeters: 5000, secPerKm, sex, age })).padStart(7)
  );
  console.log("  " + pace(secPerKm).padEnd(10) + row.join(""));
}

console.log("\n  Reference points a runner would recognise:");
for (const [label, secPerKm, sex, age] of [
  ["sub-15 5k (elite club)", 179, "male", 25],
  ["20:00 5k (good club)", 240, "male", 25],
  ["25:00 5k (solid)", 300, "male", 25],
  ["30:00 5k (starting out)", 360, "male", 25],
  ["18:00 5k (elite club)", 216, "female", 25],
  ["25:00 5k (good club)", 300, "female", 25],
] as [string, number, Sex, number][]) {
  console.log(
    `    ${label.padEnd(26)} ${pace(secPerKm).padEnd(9)} → ${String(
      runScore({ distanceMeters: 5000, secPerKm, sex, age })
    ).padStart(4)}`
  );
}

console.log("\n══════════ RUNNING — distance at a fixed pace ══════════");
console.log("  5:00/km held for longer should score higher: the same pace over");
console.log("  more ground is a bigger performance.\n");
for (const m of [1000, 5000, 10000, 21097, 42195]) {
  console.log(
    `    ${(m / 1000).toFixed(m < 10000 ? 0 : 3).padStart(6)} km @ 5:00/km → ${String(
      runScore({ distanceMeters: m, secPerKm: 300, sex: "male", age: 30 })
    ).padStart(4)}`
  );
}

console.log("\n══════════ GYM — bench press, by bodyweight and sex ══════════");
console.log("  A 1-rep max, so the score is the lift against the standard for");
console.log("  somebody of that bodyweight and sex.\n");
console.log("  " + "lift".padEnd(9) + ["M60kg", "M75kg", "M90kg", "F55kg", "F70kg"].map((h) => h.padStart(8)).join(""));
for (const weightKg of [40, 60, 80, 100, 120, 140]) {
  const row = ([
    ["male", 60],
    ["male", 75],
    ["male", 90],
    ["female", 55],
    ["female", 70],
  ] as [Sex, number][]).map(([sex, bw]) =>
    String(liftScore({ liftKey: "bench", weightKg, reps: 1, bodyweightKg: bw, sex })).padStart(8)
  );
  console.log("  " + `${weightKg}kg`.padEnd(9) + row.join(""));
}

console.log("\n══════════ GYM — the big three at bodyweight multiples ══════════");
console.log("  The multiples lifters actually talk in. A 1× bodyweight bench and");
console.log("  a 2× bodyweight deadlift are the classic 'intermediate' marks.\n");
for (const [lift, key] of [
  ["Bench", "bench"],
  ["Squat", "squat"],
  ["Deadlift", "deadlift"],
] as [string, string][]) {
  const bw = 80;
  const cells = [1, 1.25, 1.5, 2, 2.5].map((mult) => {
    const s = liftScore({ liftKey: key, weightKg: Math.round(bw * mult), reps: 1, bodyweightKg: bw, sex: "male" });
    return `${mult}×=${String(s).padStart(4)}`;
  });
  console.log(`    ${lift.padEnd(9)} (80 kg male)  ${cells.join("  ")}`);
}

console.log("\n══════════ GYM — the same lift, by age ══════════");
console.log("  80 kg male, 140 kg deadlift. Age grading moves the standard, not");
console.log("  the lift: the flat band is 23-35, so 30 is the unadjusted baseline.\n");
for (const age of [18, 25, 30, 40, 50, 60, 70]) {
  console.log(
    `    age ${String(age).padStart(2)} → ${String(
      liftScore({ liftKey: "deadlift", weightKg: 140, reps: 1, bodyweightKg: 80, sex: "male", age })
    ).padStart(4)}`
  );
}

console.log("\n══════════ GYM — same lift, same body, different sex ══════════");
console.log("  70 kg athlete, 100 kg deadlift. The gap is the sex standard.\n");
for (const sex of ["male", "female"] as Sex[]) {
  console.log(
    `    ${sex.padEnd(7)} → ${String(
      liftScore({ liftKey: "deadlift", weightKg: 100, reps: 1, bodyweightKg: 70, sex })
    ).padStart(4)}`
  );
}
console.log("");
