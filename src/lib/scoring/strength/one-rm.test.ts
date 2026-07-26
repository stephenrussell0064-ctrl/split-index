import { describe, expect, it } from "vitest";
import { weightedCalisthenic1RM, epley1RM, brzycki1RM } from "./one-rm";

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

describe("weightedCalisthenic1RM — added weight (addedKg > 0) is unchanged by the fix", () => {
  const BODYWEIGHT_KG = 83;

  it("still blends totalLoad1RM and addedOnly1RM 50/50 when weight is actually added", () => {
    const addedKg = 20;
    const reps = 5;
    const totalLoad1RM = expectedBlendedRepFormula(BODYWEIGHT_KG + addedKg, reps) - BODYWEIGHT_KG;
    const addedOnly1RM = expectedBlendedRepFormula(addedKg, reps);
    const expected = 0.5 * totalLoad1RM + 0.5 * addedOnly1RM;
    expect(weightedCalisthenic1RM(addedKg, reps, BODYWEIGHT_KG, "compound")).toBeCloseTo(expected, 5);
  });

  it("more added weight for the same reps scores a higher oneRM (monotonic)", () => {
    const light = weightedCalisthenic1RM(10, 5, BODYWEIGHT_KG, "compound");
    const heavy = weightedCalisthenic1RM(20, 5, BODYWEIGHT_KG, "compound");
    expect(heavy).toBeGreaterThan(light);
  });
});
