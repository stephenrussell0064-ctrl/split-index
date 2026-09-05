import { describe, expect, it } from "vitest";
import { ageFactor, scoreStrength, type ScoreStrengthInput } from "./split-strength-engine";

/**
 * Part G (scoring-calibration-rewrite): corrected bench/deadlift anchors,
 * sourced from Strength Level's general standards mapped through
 * percentile-framework.ts. These were the FIRST two lifts to get a real anchor
 * table instead of the single-anchorRatio log formula; the rest of the
 * catalogue followed in the junior-age/anchor-table pass further down this
 * file, so "the other ~20 lifts still use the log formula" is no longer true
 * and the fixtures here are simply the oldest of a now-uniform set.
 *
 * A single logged set at reps=1 gives an estimated 1RM exactly equal to the
 * weight lifted (both epley1RM and brzycki1RM special-case effective reps
 * === 1 to return the raw weight, no formula/multiplier applied), so this
 * cleanly isolates the anchor-table calibration from the 1RM-estimation
 * formula (pre-existing, untouched by this brief).
 */
function scoreAtOneRM(liftKey: string, targetOneRMKg: number, overrides: Partial<ScoreStrengthInput> = {}) {
  return scoreStrength({
    liftKey,
    history: [],
    latestSet: { weightKg: targetOneRMKg, reps: 1 },
    bodyweightKg: 83,
    sex: "male",
    age: 30,
    isPremium: false,
    ...overrides,
  });
}

describe("scoreStrength — bench/deadlift corrected anchors (Part G, re-anchored a 3rd time)", () => {
  it("bench: 140kg @ 83kg BW now scores ~872 (Elite), not 752 (Advanced) — user feedback: a 120x3/~132kg 1RM set scoring 724 was 'way too low... comparing to the average person in gym not elite athletes'", () => {
    const result = scoreAtOneRM("bench", 140);
    expect(result.score).toBeCloseTo(872, -1); // within ~10 points
    expect(result.tier).toBe("Elite");
  });

  it("bench matches the re-anchored table exactly (top two anchors raised; bottom three untouched from the prior pass)", () => {
    expect(scoreAtOneRM("bench", 47).score).toBeCloseTo(150, 0);
    expect(scoreAtOneRM("bench", 70).score).toBeCloseTo(400, 0);
    expect(scoreAtOneRM("bench", 98).score).toBeCloseTo(650, 0);
    expect(scoreAtOneRM("bench", 132).score).toBeCloseTo(850, 0); // raised from 725 — now the Elite boundary
    expect(scoreAtOneRM("bench", 169).score).toBeCloseTo(950, 0); // raised from 850 — deep into World Class
  });

  it("bench: 100kg @ 83kg BW (a genuinely good lift) now scores well above 'merely average' 500, not ~501", () => {
    const result = scoreAtOneRM("bench", 100);
    expect(result.score).toBeGreaterThan(600);
  });

  it("deadlift: 200kg @ 83kg BW now scores 850 (Elite), not 725/746 (Advanced) — user feedback: 'a 200kg deadlift scored 746 which is very low for something so impressive'", () => {
    const result = scoreAtOneRM("deadlift", 200);
    expect(result.score).toBeCloseTo(850, 0);
    expect(result.tier).toBe("Elite");
  });

  it("deadlift matches the re-anchored table exactly", () => {
    expect(scoreAtOneRM("deadlift", 78).score).toBeCloseTo(150, 0);
    expect(scoreAtOneRM("deadlift", 112).score).toBeCloseTo(400, 0);
    expect(scoreAtOneRM("deadlift", 152).score).toBeCloseTo(650, 0);
    expect(scoreAtOneRM("deadlift", 200).score).toBeCloseTo(850, 0); // raised from 725
    expect(scoreAtOneRM("deadlift", 250).score).toBeCloseTo(950, 0); // raised from 850
  });

  it("is monotonic — a heavier lift never scores lower than a lighter one", () => {
    const weights = [30, 47, 60, 70, 85, 98, 115, 132, 150, 169, 190];
    const scores = weights.map((w) => scoreAtOneRM("bench", w).score);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeGreaterThanOrEqual(scores[i - 1]);
    }
  });

  it("still applies sex/age adjustment on top of the anchor table", () => {
    const male = scoreAtOneRM("bench", 98);
    const female = scoreAtOneRM("bench", 98, { sex: "female" });
    const older = scoreAtOneRM("bench", 98, { age: 55 });
    expect(female.score).toBeGreaterThan(male.score); // same raw lift, female scores higher (fairness adjustment)
    expect(older.score).toBeGreaterThan(male.score); // same raw lift, older scores higher (age credit)
  });

  it("nextTier still resolves to a sensible kg target for anchor-table lifts", () => {
    const result = scoreAtOneRM("bench", 90); // between 70 (400) and 98 (650) anchors
    expect(result.nextTier).not.toBeNull();
    expect(result.nextTier!.kgNeeded).toBeGreaterThan(0);
  });

  /**
   * Squat had no table when this was written; it does now. Kept, but pointed
   * at a lift that genuinely still uses the log formula — tricepPress, which
   * has no Strength Level population data to build a table from — so the
   * assertion keeps testing what its name says.
   */
  it("lifts with no anchor table still use the log formula and stay in range", () => {
    const result = scoreAtOneRM("Tricep Press", 100);
    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThanOrEqual(999);
  });
});

/**
 * Dumbbell curl. Originally a single-anchor fit to two remembered
 * expectations (user feedback: 20kg/hand x8 scored 669, expected ~750;
 * 12.5kg/hand x8 scored ~475, expected ~550), which no single anchor could
 * satisfy at once under the shared SLOPE.
 *
 * Now on Strength Level's published dumbbell-curl standards, like every other
 * tabled lift. THE UPPER BOUND HERE MOVED, 760 -> 830, and that is a
 * deliberate change to an assertion, not an accident: the table puts a 20kg/
 * hand x8 set at 808 where the hand-fitted anchor put it near 730. The
 * athlete's own remembered target was ~750, so the table lands 58 points ABOVE
 * what they asked for rather than below it — the direction of this whole
 * brief. 12.5kg/hand is essentially unmoved, so the second fixture below is
 * untouched and still pins the bottom of the curve.
 */
describe("scoreStrength — dumbbell curl recalibration", () => {
  function scoreDbCurl(weightKg: number, reps: number) {
    return scoreStrength({
      liftKey: "dumbbell curl",
      exerciseName: "dumbbell curl",
      history: [{ weightKg, reps, performedAt: new Date().toISOString() }],
      latestSet: { weightKg, reps },
      bodyweightKg: 83,
      sex: "male",
      age: 30,
      isPremium: false,
      weightEntryMode: "per_hand",
    });
  }

  it("20kg/hand x8 scores well above the old 669 — now off Strength Level's own curve, ~808", () => {
    const result = scoreDbCurl(20, 8);
    expect(result.score).toBeGreaterThan(700);
    expect(result.score).toBeLessThan(830);
  });

  it("12.5kg/hand x8 now scores close to 550, not ~475", () => {
    const result = scoreDbCurl(12.5, 8);
    expect(result.score).toBeGreaterThan(530);
    expect(result.score).toBeLessThan(570);
  });

  it("heavier weight for the same reps never scores lower (monotonic)", () => {
    expect(scoreDbCurl(20, 8).score).toBeGreaterThan(scoreDbCurl(12.5, 8).score);
  });
});

/**
 * Tricep Press calibration (user feedback: 95kg x8 should score ~700, 125kg
 * x8 should score ~875 — "Tricep Press" had no anchor/alias at all before
 * this, so every set silently fell through to the generic accessory
 * fallback). Same "closest single-anchor fit for both" methodology as
 * dumbbell curl above — 0.89 lands at 95x8 -> ~735, 125x8 -> ~840.
 */
describe("scoreStrength — tricep press calibration", () => {
  function scoreTricepPress(weightKg: number, reps: number) {
    return scoreStrength({
      liftKey: "Tricep Press",
      exerciseName: "Tricep Press",
      history: [],
      latestSet: { weightKg, reps },
      bodyweightKg: 83,
      sex: "male",
      age: 30,
      isPremium: false,
    });
  }

  it("resolves to a real calibrated anchor, not the generic fallback", () => {
    expect(scoreTricepPress(95, 8).source).toBe("accessory");
  });

  it("95kg x8 scores close to 700", () => {
    const result = scoreTricepPress(95, 8);
    expect(result.score).toBeGreaterThan(680);
    expect(result.score).toBeLessThan(760);
  });

  it("125kg x8 scores close to 875", () => {
    const result = scoreTricepPress(125, 8);
    expect(result.score).toBeGreaterThan(800);
    expect(result.score).toBeLessThan(900);
  });

  it("heavier weight for the same reps never scores lower (monotonic)", () => {
    expect(scoreTricepPress(125, 8).score).toBeGreaterThan(scoreTricepPress(95, 8).score);
  });
});

/**
 * Muscle-up bodyweight-relative scoring (user feedback: muscle-ups were
 * entirely unrecognized — fell through to the generic "total weight"
 * default, so bodyweight-only sets scored as if 0kg was the total load
 * lifted). Anchor reasoned from published calisthenics standards (no
 * Strength Level population data exists for muscle-ups specifically) — see
 * the anchor's own comment in split-strength-engine.ts.
 */
describe("scoreStrength — muscle-up bodyweight-relative recognition", () => {
  it("resolves to the dedicated muscleUp lift, not the generic category fallback", () => {
    const result = scoreStrength({
      liftKey: "muscle up",
      history: [],
      latestSet: { weightKg: 0, reps: 5 },
      bodyweightKg: 83,
      sex: "male",
      age: 30,
      isPremium: false,
      isBodyweightRelative: true,
    });
    expect(result.source).not.toBe("generic");
  });

  it("a bodyweight-only set (0kg added) scores meaningfully above zero", () => {
    const result = scoreStrength({
      liftKey: "muscle up",
      history: [],
      latestSet: { weightKg: 0, reps: 5 },
      bodyweightKg: 83,
      sex: "male",
      age: 30,
      isPremium: false,
      isBodyweightRelative: true,
    });
    expect(result.score).toBeGreaterThan(400);
  });

  it("added weight scores higher than bodyweight-only for the same reps", () => {
    const bodyweightOnly = scoreStrength({
      liftKey: "muscle up",
      history: [],
      latestSet: { weightKg: 0, reps: 5 },
      bodyweightKg: 83,
      sex: "male",
      age: 30,
      isPremium: false,
      isBodyweightRelative: true,
    });
    const weighted = scoreStrength({
      liftKey: "muscle up",
      history: [],
      latestSet: { weightKg: 20, reps: 5 },
      bodyweightKg: 83,
      sex: "male",
      age: 30,
      isPremium: false,
      isBodyweightRelative: true,
    });
    expect(weighted.score).toBeGreaterThan(bodyweightOnly.score);
  });

  it("recognizes common name variants (muscle-up, bar muscle up, ring muscle up)", () => {
    const variants = ["muscle-up", "bar muscle up", "ring muscle up", "weighted muscle up"];
    for (const name of variants) {
      const result = scoreStrength({
        liftKey: name,
        history: [],
        latestSet: { weightKg: 0, reps: 5 },
        bodyweightKg: 83,
        sex: "male",
        age: 30,
        isPremium: false,
        isBodyweightRelative: true,
      });
      expect(result.source).not.toBe("generic");
    }
  });
});

/**
 * Junior age coefficients (this pass). Reported symptom: "a 140kg bench press
 * at 80kg bodyweight aged 19 scores 90.8 and this should be slightly higher…
 * most scores in general need a small buff."
 *
 * The lift itself was NOT scoring low — 140x2 at 80kg puts the athlete at
 * roughly Strength Level's 95th percentile and 907 is a fair reading of that.
 * What was wrong is that the engine gave an athlete of 19 exactly the same
 * standard as one of 30, while handing a 50-year-old an 11% easier one. The
 * age curve only ever had its masters half.
 *
 * Source: USA Powerlifting's Foster age coefficients (age 19 = 1.04),
 * corroborated by Strength Level's own by-age tables (20-24 male bench
 * standards sit 2-2.5% under the 25-39 peak).
 */
describe("ageFactor — Foster junior coefficients", () => {
  function bench140(age: number | null) {
    return scoreStrength({
      liftKey: "Bench Press",
      exerciseName: "Bench Press",
      history: [],
      latestSet: { weightKg: 140, reps: 2 },
      bodyweightKg: 80,
      sex: "male",
      age,
      isPremium: false,
    });
  }

  it("matches the published Foster table below 23 and is flat across the peak", () => {
    expect(ageFactor(19)).toBeCloseTo(1.04, 5);
    expect(ageFactor(18)).toBeCloseTo(1.06, 5);
    expect(ageFactor(16)).toBeCloseTo(1.13, 5);
    expect(ageFactor(22)).toBeCloseTo(1.01, 5);
    expect(ageFactor(23)).toBe(1.0);
    expect(ageFactor(30)).toBe(1.0);
    expect(ageFactor(35)).toBe(1.0);
  });

  it("holds at the youngest tabulated age rather than extrapolating off the end of the data", () => {
    expect(ageFactor(14)).toBeCloseTo(1.23, 5);
    expect(ageFactor(11)).toBeCloseTo(1.23, 5);
  });

  it("still climbs for masters — the existing half of the curve is untouched", () => {
    expect(ageFactor(40)).toBeCloseTo(1.02, 5);
    expect(ageFactor(50)).toBeCloseTo(1.11, 5);
  });

  /**
   * The engine used to gate on `age > 35`, which silently discarded every
   * junior coefficient the curve returned. Gating on the factor, not the age,
   * is the actual fix — pin it so the gate can't quietly revert to an age
   * comparison.
   */
  it("APPLIES the junior credit — the reported lift moves 907 -> 923, and 'age-factor-beta' is flagged", () => {
    const junior = bench140(19);
    const peak = bench140(30);
    expect(peak.score).toBe(907);
    expect(junior.score).toBe(923);
    expect(junior.flags).toContain("age-factor-beta");
    expect(junior.appliedFactors.some((f) => f.startsWith("age:19"))).toBe(true);
  });

  it("leaves a peak-age athlete completely alone — no factor, no flag", () => {
    const peak = bench140(30);
    expect(peak.flags).not.toContain("age-factor-beta");
    expect(peak.appliedFactors.some((f) => f.startsWith("age:"))).toBe(false);
  });
});

/**
 * Strength Level anchor tables for the lifts that never got Part G's
 * treatment. Each fixture below is that lift's published 50th and 80th
 * percentile at 80kg bodyweight, which must read 650 and 850 — the same
 * percentile-to-score mapping bench and deadlift have used since Part G.
 *
 * These pin the CLAIM, not just the numbers: two lifts at the same percentile
 * of the same population read as the same index score.
 */
describe("scoreStrength — Strength Level anchor tables (percentile parity)", () => {
  function at1RM(liftKey: string, kg: number) {
    return scoreStrength({
      liftKey,
      exerciseName: liftKey,
      history: [],
      latestSet: { weightKg: kg, reps: 1 },
      bodyweightKg: 80,
      sex: "male",
      age: 30,
      isPremium: false,
    }).score;
  }

  const MEDIAN_AND_ADVANCED: Array<[string, number, number]> = [
    // [lift, Strength Level 50th percentile @80kg, their 80th]
    ["Squat", 132, 168],
    ["Overhead Press", 62, 81],
    ["Barbell Row", 88, 114],
    ["Lat Pulldown", 85, 108],
    ["Pec Deck", 89, 119],
    ["Leg Extension", 103, 140],
    ["Leg Curl", 66, 90],
    ["Tricep Pushdown", 56, 80],
    ["Leg Press", 230, 309],
    ["Hack Squat", 152, 213],
    ["Hip Thrust", 149, 213],
    ["Barbell Curl", 46, 63],
  ];

  it.each(MEDIAN_AND_ADVANCED)(
    "%s: the median lifter reads 650 and the 80th percentile reads 850",
    (lift, median, advanced) => {
      expect(at1RM(lift, median)).toBeCloseTo(650, -1);
      expect(at1RM(lift, advanced)).toBeCloseTo(850, -1);
    }
  );

  it("leg press no longer pins the scale at an ordinary working set — the 7.2x generic overshoot is gone", () => {
    // 230kg is the MEDIAN leg press for this bodyweight. On
    // DEFAULT_GENERIC_ANCHOR it scored 999; input-guards.ts meanwhile allows
    // this lift up to 1000kg, so the guard layer and the scoring layer
    // contradicted each other outright.
    expect(at1RM("Leg Press", 230)).toBeCloseTo(650, -1);
    expect(at1RM("Leg Press", 400)).toBeLessThan(999);
  });

  it("a variant never out-scores the lift it is a variant of, at the same load", () => {
    expect(at1RM("Zercher Squat", 140)).toBe(at1RM("Squat", 140));
    expect(at1RM("Floor Press", 100)).toBe(at1RM("Bench Press", 100));
    expect(at1RM("Smith Machine Squat", 140)).toBe(at1RM("Squat", 140));
    expect(at1RM("Deficit Deadlift", 180)).toBe(at1RM("Deadlift", 180));
  });

  it("the same movement scores the same however the athlete spells it", () => {
    expect(at1RM("Single Arm Tricep Pushdown", 30)).toBe(at1RM("Single Arm Pushdown", 30));
    expect(at1RM("One Arm Pushdown", 30)).toBe(at1RM("Single Arm Pushdown", 30));
  });

  it("every tabled lift is still monotonic in load", () => {
    for (const [lift] of MEDIAN_AND_ADVANCED) {
      const scores = [20, 50, 80, 120, 180, 260, 380].map((w) => at1RM(lift, w));
      for (let i = 1; i < scores.length; i++) {
        expect(scores[i], `${lift} @ index ${i}`).toBeGreaterThanOrEqual(scores[i - 1]);
      }
    }
  });
});

/**
 * The generic fallback. GENERIC_CATEGORY_ANCHORS described a per-movement-
 * pattern fallback and was reachable only through genericAnchorForCategory(),
 * which nothing in the codebase ever called — so in practice sixty-odd
 * catalogue exercises shared one flat 0.35 anchor. Unknown names must still
 * degrade gracefully; catalogue names must now degrade INTELLIGENTLY.
 */
describe("resolveLiftAnchor — generic fallback", () => {
  function score(liftKey: string, kg: number) {
    return scoreStrength({
      liftKey,
      exerciseName: liftKey,
      history: [],
      latestSet: { weightKg: kg, reps: 8 },
      bodyweightKg: 80,
      sex: "male",
      age: 30,
      isPremium: false,
    });
  }

  it("a name that is in no table at all still degrades to a generic anchor rather than throwing", () => {
    const result = score("Completely Made Up Machine", 50);
    expect(result.source).toBe("generic");
    expect(result.flags).toContain("estimated-generic-standard");
    expect(result.score).toBeGreaterThan(0);
  });

  it("an un-anchored CATALOGUE exercise inherits its movement pattern, and stays honestly flagged as generic", () => {
    const clean = score("Power Clean", 60);
    expect(clean.source).toBe("generic");
    expect(clean.flags).toContain("estimated-generic-standard");
    // A legs compound, not a 0.35 upper-body-shaped guess: the same load on
    // the flat generic read 925.
    expect(clean.score).toBeLessThan(700);
  });

  it("a loaded core movement no longer pins the scale at an ordinary working set", () => {
    // 60kg on a cable crunch is a normal set, not a world record.
    expect(score("Cable Crunch", 60).score).toBeLessThan(950);
  });
});
