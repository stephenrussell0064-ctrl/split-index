import { describe, expect, it } from "vitest";
import { weightedCalisthenic1RM, epley1RM, brzycki1RM, estimateWeightForReps } from "./one-rm";

/** Mirrors the private blendedRepFormula() in one-rm.ts (max of Epley/Brzycki) so tests can independently derive the expected value without reaching into module internals. */
function expectedBlendedRepFormula(weightKg: number, reps: number): number {
  return Math.max(epley1RM(weightKg, reps, "compound"), brzycki1RM(weightKg, reps));
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
    // totalLoad1RM = epley/brzycki(83, 10) - 83 ≈ 110.67 - 83 ≈ 27.67
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
    const totalLoad1RM = expectedBlendedRepFormula(BODYWEIGHT_KG + addedKg, reps) - BODYWEIGHT_KG;
    expect(weightedCalisthenic1RM(addedKg, reps, BODYWEIGHT_KG, "compound")).toBeCloseTo(totalLoad1RM, 5);
  });

  it("credits added load ON TOP of bodyweight — a +30kg set implies far more than a 30kg lift", () => {
    // The old 50/50 blend dragged this halfway towards treating 30kg as the
    // entire load, which is what produced the reported shortfall.
    const addedOnlyIfTreatedAsTotalLoad = expectedBlendedRepFormula(30, 8);
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

describe("estimateWeightForReps — inverse of epley1RM, for rep-based Training Plan goals", () => {
  it("round-trips exactly back through epley1RM for the same reps/class", () => {
    const oneRM = epley1RM(100, 5, "compound");
    expect(estimateWeightForReps(oneRM, 5, "compound")).toBeCloseTo(100, 5);
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

  it("differs by exercise class the same way the forward formula does", () => {
    const oneRM = 100;
    const compound = estimateWeightForReps(oneRM, 8, "compound");
    const isolation = estimateWeightForReps(oneRM, 8, "isolation");
    // Isolation's k is smaller (steeper implied dropoff per rep), so the
    // estimated weight at the same rep count should be lower.
    expect(isolation).toBeLessThan(compound);
  });
});
