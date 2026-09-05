import { describe, expect, it } from "vitest";
import {
  weightedCalisthenic1RM,
  epley1RM,
  brzycki1RM,
  bestEstimate1RM,
  estimateWeightForReps,
  repMaxMultiplier,
} from "./one-rm";

/** Mirrors the private scoringRepFormula() in one-rm.ts so tests can independently derive the expected value without reaching into module internals. */
function expectedScoringRepFormula(weightKg: number, reps: number): number {
  return weightKg * repMaxMultiplier(reps);
}

/**
 * Bodyweight-only calisthenics 1RM (user feedback: pull-ups/dips/muscle-ups
 * "are weighted only... need them to have accurate scores"). Root cause: the
 * added-only side of CALISTHENIC_BLEND is degenerate at addedKg <= 0 — any
 * rep formula applied to a 0 weight trivially returns 0 regardless of reps —
 * so blending 50/50 with an always-zero signal silently halved the true
 * credit for pure-bodyweight performances. 10 strict bodyweight pull-ups (a
 * genuinely strong "Intermediate" feat per published calisthenics standards)
 * used to imply an oneRM of only ~13.8kg added-equivalent; it should be
 * close to the full totalLoad1RM estimate instead.
 */
describe("weightedCalisthenic1RM — bodyweight-only (addedKg = 0)", () => {
  const BODYWEIGHT_KG = 83;

  it("bodyweight-only reps rely on the full totalLoad1RM estimate, not a halved blend", () => {
    const oneRM = weightedCalisthenic1RM(0, 10, BODYWEIGHT_KG, "compound");
    // totalLoad1RM = 83 / 0.75 - 83 ≈ 110.67 - 83 ≈ 27.67. Unmoved by the
    // estimator change: at exactly ten reps Strength Level's table (75%),
    // Epley and Brzycki all agree on the same multiplier of 1.3333.
    expect(oneRM).toBeGreaterThan(27);
    expect(oneRM).toBeLessThan(28);
  });

  it("more bodyweight reps imply a higher added-equivalent 1RM (monotonic)", () => {
    const five = weightedCalisthenic1RM(0, 5, BODYWEIGHT_KG, "compound");
    const ten = weightedCalisthenic1RM(0, 10, BODYWEIGHT_KG, "compound");
    const fifteen = weightedCalisthenic1RM(0, 15, BODYWEIGHT_KG, "compound");
    expect(ten).toBeGreaterThan(five);
    expect(fifteen).toBeGreaterThan(ten);
  });

  it("negative added weight (e.g. assisted reps) still uses the totalLoad1RM path, not the degenerate blend", () => {
    // -5kg "added" implies 78kg of total load (assisted) rather than 83kg —
    // genuinely lower than the bodyweight-only case, which is correct; the
    // point of this test is just that it goes through the same totalLoad1RM
    // branch as addedKg === 0, not the halved 50/50 blend.
    const zero = weightedCalisthenic1RM(0, 10, BODYWEIGHT_KG, "compound");
    const negative = weightedCalisthenic1RM(-5, 10, BODYWEIGHT_KG, "compound");
    expect(negative).toBeLessThan(zero);
    expect(negative).toBeGreaterThan(0);
  });
});

/**
 * DELIBERATE BEHAVIOUR CHANGE (user feedback: "Pull up score needs
 * recalibrating — 30 x 8 scores 72.9, this should be almost 80").
 *
 * This block previously asserted the 50/50 blend of totalLoad1RM and
 * addedOnly1RM for added-weight sets, under the heading "unchanged by the
 * fix" — that assertion is now inverted on purpose, not incidentally broken.
 * CALISTHENIC_BLEND moved 0.5 -> 1.0: the added-only term applies a rep
 * formula to a load the athlete never lifted on its own, so an athlete doing
 * pull-ups at +30kg (moving bodyweight + 30kg every rep) was being scored as
 * though 30kg were the whole lift. See the constant's doc comment in
 * one-rm.ts.
 */
describe("weightedCalisthenic1RM — added weight (addedKg > 0) is credited on top of bodyweight", () => {
  const BODYWEIGHT_KG = 83;

  it("uses the total-load estimate, not a 50/50 blend with the degenerate added-only term", () => {
    const addedKg = 20;
    const reps = 5;
    const totalLoad1RM = expectedScoringRepFormula(BODYWEIGHT_KG + addedKg, reps) - BODYWEIGHT_KG;
    expect(weightedCalisthenic1RM(addedKg, reps, BODYWEIGHT_KG, "compound")).toBeCloseTo(totalLoad1RM, 5);
  });

  it("credits added load ON TOP of bodyweight — a +30kg set implies far more than a 30kg lift", () => {
    // The old 50/50 blend dragged this halfway towards treating 30kg as the
    // entire load, which is what produced the reported shortfall.
    const addedOnlyIfTreatedAsTotalLoad = expectedScoringRepFormula(30, 8);
    expect(weightedCalisthenic1RM(30, 8, BODYWEIGHT_KG, "compound")).toBeGreaterThan(
      addedOnlyIfTreatedAsTotalLoad * 1.4
    );
  });

  it("is continuous across the addedKg = 0 boundary (no jump between the two branches)", () => {
    const atZero = weightedCalisthenic1RM(0, 8, BODYWEIGHT_KG, "compound");
    const justAbove = weightedCalisthenic1RM(0.001, 8, BODYWEIGHT_KG, "compound");
    expect(justAbove).toBeCloseTo(atZero, 2);
  });

  it("more added weight for the same reps scores a higher oneRM (monotonic)", () => {
    const light = weightedCalisthenic1RM(10, 5, BODYWEIGHT_KG, "compound");
    const heavy = weightedCalisthenic1RM(20, 5, BODYWEIGHT_KG, "compound");
    expect(heavy).toBeGreaterThan(light);
  });
});

/**
 * TWO ASSERTIONS IN THIS BLOCK ARE DELIBERATELY INVERTED, not incidentally
 * broken — flagged here rather than quietly rewritten.
 *
 * This suite used to pin `estimateWeightForReps` as the inverse of `epley1RM`
 * and, below, to require that it "differs by exercise class the same way the
 * forward formula does" — i.e. it defended the class-varying Epley k (30 /
 * 22 / 15) that turned out to be the largest term in a 6-28% over-read of
 * every logged set. See the header of one-rm.ts for the measurement and the
 * sources. Nothing published supports those k values; Hoeger et al. (1990),
 * the one study that measured reps at a known %1RM, points the other way.
 *
 * The invariant that actually matters is unchanged and is now pinned
 * directly: this function must invert whatever `bestEstimate1RM` does, or any
 * "current: ~82kg x5 / goal: 100kg x5" pairing compares two numbers produced
 * by disagreeing conversions. The Training Plan that needed that pairing is
 * retired; the invariant outlives it, which is why these tests remain the only
 * caller — see the note on estimateWeightForReps itself.
 */
describe("estimateWeightForReps — inverse of the scoring estimator", () => {
  it("round-trips exactly back through bestEstimate1RM for the same reps", () => {
    const oneRM = bestEstimate1RM(100, 5);
    expect(estimateWeightForReps(oneRM, 5)).toBeCloseTo(100, 5);
  });

  it("round-trips at every rep count the rep table covers, and past its end", () => {
    for (const reps of [1, 2, 3, 5, 8, 10, 12, 15, 20, 30, 40]) {
      const oneRM = bestEstimate1RM(100, reps);
      expect(estimateWeightForReps(oneRM, reps)).toBeCloseTo(100, 5);
    }
  });

  it("returns the 1RM itself unchanged at reps=1", () => {
    expect(estimateWeightForReps(120, 1, "compound")).toBe(120);
  });

  it("returns a lighter weight for more reps (monotonically decreasing)", () => {
    const oneRM = 120;
    const at3 = estimateWeightForReps(oneRM, 3, "compound");
    const at8 = estimateWeightForReps(oneRM, 8, "compound");
    expect(at3).toBeGreaterThan(at8);
    expect(at8).toBeLessThan(oneRM);
  });

  it("is defensive against non-positive inputs", () => {
    expect(estimateWeightForReps(0, 5, "compound")).toBe(0);
    expect(estimateWeightForReps(100, 0, "compound")).toBe(0);
  });

  // INVERTED ON PURPOSE. Previously: "differs by exercise class the same way
  // the forward formula does", asserting isolation < compound at the same rep
  // count because isolation's Epley k was 15. That k had no published basis
  // and produced a 1.80x multiplier at twelve reps, against ~1.41x from
  // Strength Level's own table and ~1.25x measured by Hoeger for an arm curl
  // at eleven. One curve now, for every class, and the parameter is inert.
  it("does NOT vary by exercise class — one published curve for every lift", () => {
    const oneRM = 100;
    const compound = estimateWeightForReps(oneRM, 8, "compound");
    const accessory = estimateWeightForReps(oneRM, 8, "accessory");
    const isolation = estimateWeightForReps(oneRM, 8, "isolation");
    expect(accessory).toBe(compound);
    expect(isolation).toBe(compound);
  });
});

/**
 * The rep table itself. It is the ruler the anchor tables in
 * split-strength-engine.ts are read against, so its published values matter
 * more than any behaviour derived from them.
 */
describe("repMaxMultiplier — Strength Level's published rep → %1RM table", () => {
  it("returns the published multipliers at the reps athletes actually log", () => {
    expect(repMaxMultiplier(1)).toBeCloseTo(1, 6); // 100%
    expect(repMaxMultiplier(3)).toBeCloseTo(100 / 94, 6);
    expect(repMaxMultiplier(5)).toBeCloseTo(100 / 89, 6);
    expect(repMaxMultiplier(8)).toBeCloseTo(100 / 81, 6);
    expect(repMaxMultiplier(10)).toBeCloseTo(100 / 75, 6);
    expect(repMaxMultiplier(12)).toBeCloseTo(100 / 71, 6);
    expect(repMaxMultiplier(15)).toBeCloseTo(100 / 67, 6);
  });

  it("agrees with the independent published formulas it has to live alongside", () => {
    // Sanity, not identity: the whole argument for adopting Strength Level's
    // table is that it sits inside the band every named formula occupies. If
    // a future edit ever moves it outside that band, this fails loudly.
    for (const reps of [3, 5, 8, 10]) {
      const mine = repMaxMultiplier(reps);
      expect(mine).toBeGreaterThan(brzycki1RM(100, reps) / 100 - 0.05);
      expect(mine).toBeLessThan(epley1RM(100, reps) / 100 + 0.05);
    }
  });

  it("is monotonic and never claims a set below one rep is worth more", () => {
    let previous = 0;
    for (let reps = 1; reps <= 30; reps += 1) {
      const m = repMaxMultiplier(reps);
      expect(m).toBeGreaterThan(previous);
      previous = m;
    }
    expect(repMaxMultiplier(0)).toBe(1);
    expect(repMaxMultiplier(-3)).toBe(1);
  });

  it("holds flat past the end of the published table rather than extrapolating off it", () => {
    const atThirty = repMaxMultiplier(30);
    expect(repMaxMultiplier(45)).toBe(atThirty);
    expect(repMaxMultiplier(200)).toBe(atThirty);
  });

  it("interpolates between whole reps so a fractional RIR doesn't step", () => {
    const at8 = repMaxMultiplier(8);
    const at9 = repMaxMultiplier(9);
    const mid = repMaxMultiplier(8.5);
    expect(mid).toBeGreaterThan(at8);
    expect(mid).toBeLessThan(at9);
  });
});
