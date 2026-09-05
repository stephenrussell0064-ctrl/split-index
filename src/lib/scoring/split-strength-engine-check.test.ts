import { describe, expect, it } from "vitest";
import {
  scoreStrength,
  tierForScore,
  ageFactor,
  SEX_FACTORS,
  type LoggedSet,
  type StrengthTier,
} from "./split-strength-engine";
import { weightedCalisthenic1RM, bestEstimate1RM } from "./strength/one-rm";
import { scoreCardioActivity } from "./cardio-activity";
import { buildCardioInput } from "./adapters";
import { FEMALE_CARDIO_FACTORS } from "./cardio-benchmarks";

/**
 * split-strength-engine calibration fixtures.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A TEST NOW
 * ---------------------------------------------------------------------------
 * This was `split-strength-engine-check.ts`, a standalone script run by hand
 * with `npx tsx`. Nothing ran it. By the time it was next executed it reported
 * 28 failing assertions — every one of them a stale expectation rather than an
 * engine defect, accumulated across the anchor-table rewrite, the estimator
 * correction, and the single-arm pushdown reshape. The file had even started
 * documenting its own staleness in passing ("a stale expectation in a script
 * nothing runs automatically, so nothing caught it") without the obvious
 * conclusion being drawn.
 *
 * A calibration fixture that nobody runs is worse than none: it looks like
 * cover. So it runs with the suite now, and the numbers below were each
 * re-derived rather than copied from the engine's current output — the anchor
 * interval every pinned score falls in is written next to it, so the next
 * person can check a value by eye instead of trusting it.
 *
 * ---------------------------------------------------------------------------
 * HOW TO READ A FAILURE HERE
 * ---------------------------------------------------------------------------
 * The pinned fixtures are DELIBERATELY brittle: they are what catches an
 * unintended recalibration. A failure means one of two things, and the comment
 * on each fixture is what tells them apart:
 *
 *   - the anchor table for that lift changed on purpose -> update the number
 *     AND the interval comment, in the same commit as the table change; or
 *   - it did not -> something moved that should not have.
 *
 * The property tests below are the opposite: they hold for any calibration, so
 * they should never need updating, and a failure there is always a real bug.
 */

const BODYWEIGHT_KG = 83;

/**
 * A single rep at the target weight: repMaxMultiplier(1) is exactly 1, so the
 * estimated 1RM IS the weight and the fixture isolates the anchor curve from
 * the rep-to-1RM conversion.
 */
function scoreSingleSet(liftKey: string, oneRM: number, bodyweightKg = BODYWEIGHT_KG) {
  return scoreStrength({
    liftKey,
    history: [],
    latestSet: { weightKg: oneRM, reps: 1 },
    bodyweightKg,
    sex: "male",
    age: 28, // inside the flat 20-35 band, so the age factor is neutral
    isPremium: false,
  });
}

/**
 * Every anchor table maps Strength Level's five published standards onto
 * [150, 400, 650, 850, 950] — 5th, 20th, 50th, 80th, 95th percentile. The
 * "between X and Y" note on each fixture names the two standards (in kg at
 * Strength Level's 80kg row) the test weight falls between, which is what makes
 * the expected score checkable without running the engine.
 *
 * Lifts marked "log curve" have no published table — dbRow's alias list mixes
 * movements too different to share one, and the machine-press family has no
 * population data at all — so they keep a documented single-anchor curve.
 */
const ANCHOR_FIXTURES: Array<{
  lift: string;
  kg: number;
  score: number;
  tier: StrengthTier;
  note: string;
}> = [
  { lift: "bench", kg: 140, score: 872, tier: "Elite", note: "between 132kg(850) and 169kg(950)" },
  { lift: "squat", kg: 160, score: 784, tier: "Advanced", note: "between 132kg(650) and 168kg(850)" },
  { lift: "deadlift", kg: 200, score: 850, tier: "Elite", note: "sits ON the 200kg 80th-percentile anchor, so 850 exactly" },
  { lift: "ohp", kg: 75, score: 768, tier: "Advanced", note: "between 62kg(650) and 81kg(850)" },
  { lift: "barbellRow", kg: 120, score: 861, tier: "Elite", note: "between 114kg(850) and 141kg(950)" },
  { lift: "frontSquat", kg: 120, score: 720, tier: "Semi-Pro", note: "log curve, no published table" },
  { lift: "inclineBench", kg: 100, score: 759, tier: "Advanced", note: "log curve, no published table" },
  { lift: "weightedPullup", kg: 50, score: 726, tier: "Advanced", note: "log curve, no published table" },
  { lift: "inclineDbPress", kg: 55, score: 322, tier: "Intermediate", note: "TOTAL load: between 44kg(150) and 58kg(400) — 27.5kg per hand" },
  { lift: "flatDbPress", kg: 50, score: 300, tier: "Intermediate", note: "TOTAL load: between 38kg(150) and 56kg(400) — 25kg per hand" },
  { lift: "machineChestPress", kg: 120, score: 765, tier: "Advanced", note: "log curve, no published table" },
  { lift: "tricepPushdown", kg: 60, score: 671, tier: "Semi-Pro", note: "between 56kg(650) and 80kg(850)" },
  { lift: "dbShoulderPress", kg: 40, score: 311, tier: "Intermediate", note: "TOTAL load: between 30kg(150) and 44kg(400) — 20kg per hand" },
  { lift: "lateralRaise", kg: 22, score: 771, tier: "Advanced", note: "PER HAND: between 16kg(650) and 25kg(850)" },
  { lift: "dbRow", kg: 67, score: 720, tier: "Semi-Pro", note: "log curve, aliases too mixed to table" },
  { lift: "barbellCurl", kg: 60, score: 798, tier: "Advanced", note: "between 46kg(650) and 63kg(850)" },
  { lift: "preacherCurl", kg: 65, score: 758, tier: "Advanced", note: "log curve, no published table" },
  { lift: "latPulldown", kg: 145, score: 984, tier: "World Class", note: "ABOVE the 133kg 95th-percentile anchor" },
  { lift: "legExtension", kg: 150, score: 866, tier: "Elite", note: "between 140kg(850) and 180kg(950)" },
  { lift: "bulgarianSplit", kg: 55, score: 387, tier: "Intermediate", note: "log curve, no published table" },
];

describe("anchor-table fixtures", () => {
  for (const { lift, kg, score, tier, note } of ANCHOR_FIXTURES) {
    it(`${lift} ${kg}kg -> ${score} ${tier} (${note})`, () => {
      const result = scoreSingleSet(lift, kg);
      expect(result.score).toBeGreaterThanOrEqual(score - 3);
      expect(result.score).toBeLessThanOrEqual(score + 3);
      expect(result.tier).toBe(tier);
    });
  }
});

/**
 * These hold for ANY calibration. They are what remains true when the tables
 * are legitimately re-anchored, so a failure here is a real defect rather than
 * a fixture needing an update.
 */
describe("properties that survive any recalibration", () => {
  const LIFTS = ANCHOR_FIXTURES.map((f) => f.lift);

  it("never scores outside the 0-999 scale", () => {
    for (const lift of LIFTS) {
      for (let kg = 5; kg <= 300; kg += 5) {
        const { score } = scoreSingleSet(lift, kg);
        expect(score, `${lift} at ${kg}kg`).toBeGreaterThanOrEqual(0);
        expect(score, `${lift} at ${kg}kg`).toBeLessThanOrEqual(999);
      }
    }
  });

  it("never scores a heavier lift lower than a lighter one", () => {
    // A table entered out of order, or an anchor interval crossing itself,
    // shows up here and nowhere else.
    for (const lift of LIFTS) {
      let previous = -1;
      for (let kg = 5; kg <= 300; kg += 5) {
        const { score } = scoreSingleSet(lift, kg);
        expect(score, `${lift} fell from ${previous} to ${score} at ${kg}kg`).toBeGreaterThanOrEqual(
          previous
        );
        previous = score;
      }
    }
  });

  it("labels every score with the tier that score actually falls in", () => {
    // The displayed tier and the number under it come from different places.
    // They have disagreed before, and an athlete told they are "Advanced" next
    // to a World Class number has no way to know which one to believe.
    for (const lift of LIFTS) {
      for (let kg = 10; kg <= 300; kg += 10) {
        const result = scoreSingleSet(lift, kg);
        expect(tierForScore(result.score), `${lift} at ${kg}kg scored ${result.score}`).toBe(
          result.tier
        );
      }
    }
  });
});

describe("sex factors", () => {
  it("keeps the published factors", () => {
    expect(SEX_FACTORS.upperBody).toBe(0.85);
    expect(SEX_FACTORS.pull).toBe(0.73);
    expect(SEX_FACTORS.lowerBody).toBe(0.78);
  });

  it("scores the same absolute bench higher for a woman, and says so in the flags", () => {
    const of = (sex: "male" | "female") =>
      scoreStrength({
        liftKey: "bench",
        history: [],
        latestSet: { weightKg: 100, reps: 1 },
        bodyweightKg: BODYWEIGHT_KG,
        sex,
        age: 28,
        isPremium: false,
      });
    const male = of("male");
    const female = of("female");

    expect(female.score).toBeGreaterThan(male.score);
    // The factor is a beta, and the athlete is told so rather than being shown
    // a number that silently differs from the one a man would get.
    expect(female.flags).toContain("female-strength-beta");
    expect(male.flags).not.toContain("female-strength-beta");
  });

  it("applies the cardio sex factor too", () => {
    const run = (gender: "male" | "female") =>
      scoreCardioActivity(
        buildCardioInput({
          sport: "running",
          durationSeconds: 20 * 60,
          distanceMeters: 5000,
          gender,
          age: 30,
        })
      );
    expect(FEMALE_CARDIO_FACTORS.run).toBeGreaterThan(1);
    expect(run("female").score).toBeGreaterThan(run("male").score);
  });
});

describe("1RM estimation", () => {
  it("expresses a weighted pull-up in added-weight terms after resolving total load", () => {
    // (83 + 30) x Strength Level's 8-rep multiplier 1.2346 = 139.5, minus the
    // 83kg of bodyweight that was moved but not added = 56.5.
    expect(weightedCalisthenic1RM(30, 8, BODYWEIGHT_KG)).toBeCloseTo(56.5, 1);
  });

  it("runs one rep curve for every exercise class", () => {
    // 13 x 1.2346 = 16.05. The class-varying Epley k this replaced was the
    // largest single term in a 6-28% over-read, and nothing published supports
    // it — so `exerciseClass` no longer changes the answer.
    expect(bestEstimate1RM(13, 8, "isolation")).toBeCloseTo(16.05, 2);
    expect(bestEstimate1RM(13, 8, "compound")).toBeCloseTo(bestEstimate1RM(13, 8, "isolation"), 6);
  });
});

describe("single-arm pushdown — the curve the athlete specified", () => {
  const pushdown = (weightKg: number, reps: number) =>
    scoreStrength({
      liftKey: "Single Arm Pushdown",
      history: [],
      latestSet: { weightKg, reps },
      bodyweightKg: BODYWEIGHT_KG,
      sex: "male",
      age: 28,
      isPremium: false,
      weightEntryMode: "per_hand",
      exerciseName: "Single Arm Pushdown",
    });

  it("credits a real working set: 15kg x 12 lands in the asked-for 65-70 band", () => {
    // "15 x 12 still scores fairly highly at 65-70 but then the score increases
    // up slowly as the weight gets heavier." This is the athlete's own
    // acceptance criterion, pinned so a future recalibration cannot quietly
    // walk it back — as the estimator correction nearly did, which is why the
    // table below it carries a compensating scalar.
    const score = pushdown(15, 12).score;
    expect(score).toBeGreaterThanOrEqual(650);
    expect(score).toBeLessThanOrEqual(700);
  });

  it("then climbs slowly rather than pinning", () => {
    const curve = [
      pushdown(15, 12).score,
      pushdown(20, 10).score,
      pushdown(25, 8).score,
      pushdown(30, 6).score,
      pushdown(40, 5).score,
      pushdown(50, 3).score,
    ];
    // Rising throughout...
    for (let i = 1; i < curve.length; i++) {
      expect(curve[i]).toBeGreaterThan(curve[i - 1]);
    }
    // ...and compressing, not sprinting to the ceiling. The original anchor put
    // 35kg x 8 at a perfect 999 for a light isolation movement.
    expect(curve[curve.length - 1]).toBeLessThan(999);
    const firstStep = curve[1] - curve[0];
    const lastStep = curve[curve.length - 1] - curve[curve.length - 2];
    expect(lastStep).toBeLessThan(firstStep);
  });
});

describe("age factor", () => {
  it("keeps the published coefficients", () => {
    expect(ageFactor(35)).toBeCloseTo(1.0, 3);
    expect(ageFactor(50)).toBeCloseTo(1.11, 3);
  });

  it("gives an older athlete a gentle boost without moving them a tier", () => {
    const young = scoreSingleSet("bench", 140);
    const older = scoreStrength({
      liftKey: "bench",
      history: [],
      latestSet: { weightKg: 140, reps: 1 },
      bodyweightKg: BODYWEIGHT_KG,
      sex: "male",
      age: 50,
      isPremium: false,
    });

    expect(older.score).toBeGreaterThan(young.score);
    // Compared against the younger athlete's OWN tier, not a hard-coded label.
    // The previous version pinned "Advanced" while its own console message said
    // "same Elite tier" — the assertion and the description had drifted apart,
    // and the assertion was the one that was wrong.
    expect(older.tier).toBe(young.tier);
  });
});

describe("reported bug: lateral raise and pec deck both hit the extremes", () => {
  // The originally reported pair, at the weights that were reported.
  const latRaise = scoreStrength({
    liftKey: "Lateral Raise",
    history: [],
    latestSet: { weightKg: 11, reps: 8 },
    bodyweightKg: BODYWEIGHT_KG,
    sex: "male",
    age: 28,
    isPremium: false,
  });
  const pecDeck = scoreStrength({
    liftKey: "Pec Deck",
    history: [],
    latestSet: { weightKg: 131, reps: 10 },
    bodyweightKg: BODYWEIGHT_KG,
    sex: "male",
    age: 28,
    isPremium: false,
  });

  it("no longer scores an ordinary lateral raise at the bottom of the scale", () => {
    expect(latRaise.score).toBeGreaterThan(400);
    expect(latRaise.score).toBeLessThan(999);
  });

  it("explains a pinned pec deck rather than just showing 999", () => {
    // 131kg x 10 is an estimated 1RM of ~175kg, past the 152kg 95th-percentile
    // anchor, so the scale genuinely runs out. What must never happen is
    // reaching the ceiling with nothing saying why.
    if (pecDeck.score >= 999) {
      expect(pecDeck.flags).toContain("near-record");
    }
  });
});

describe("premium adaptive 1RM vs the free single-set estimate", () => {
  const history: LoggedSet[] = [
    { weightKg: 100, reps: 5, performedAt: "2026-01-05T00:00:00Z" },
    { weightKg: 110, reps: 5, performedAt: "2026-03-05T00:00:00Z" },
    { weightKg: 120, reps: 3, performedAt: "2026-05-05T00:00:00Z" },
    { weightKg: 125, reps: 5, performedAt: "2026-06-20T00:00:00Z" },
  ];
  const of = (isPremium: boolean) =>
    scoreStrength({
      liftKey: "bench",
      history,
      latestSet: { weightKg: 125, reps: 5 },
      bodyweightKg: BODYWEIGHT_KG,
      sex: "male",
      age: 28,
      isPremium,
    });

  it("exposes the band and trend only to premium", () => {
    const premium = of(true);
    const free = of(false);

    expect(premium.oneRMBandKg).not.toBeNull();
    expect(premium.trend).not.toBeNull();
    expect(free.oneRMBandKg).toBeNull();
    expect(free.trend).toBeNull();
  });

  it("reads a rising history as an upward trend", () => {
    expect(of(true).trend).toBe("up");
  });

  it("lets the adaptive estimate sit below the latest single set", () => {
    // The free number is whatever the last set implies. The premium one is
    // recency-weighted across the history, so it can be lower — that is the
    // point of it, not a regression.
    expect(of(true).oneRM).toBeLessThan(of(false).oneRM);
  });
});
