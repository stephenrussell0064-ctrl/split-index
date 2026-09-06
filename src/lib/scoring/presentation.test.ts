import { describe, it, expect } from "vitest";
import { describeAgeStandard } from "@/lib/scoring/presentation";
import { ageFactor } from "@/lib/scoring/split-strength-engine";

/**
 * The engine's own template, duplicated here on purpose. If the engine ever
 * changes the string it writes, these tests must fail — that is the point of
 * the round-trip test at the bottom, which builds its input from `ageFactor()`
 * rather than from this helper.
 */
function engineEntry(age: number, factor: number): string {
  return `age:${age} ×${factor.toFixed(3)} standard (beta)`;
}

describe("describeAgeStandard", () => {
  it("reads the age and factor the engine wrote", () => {
    const result = describeAgeStandard([engineEntry(45, 1.065)]);
    expect(result).not.toBeNull();
    expect(result!.age).toBe(45);
    expect(result!.factor).toBeCloseTo(1.065, 3);
  });

  it("expresses the eased standard as 1 - 1/factor, not factor - 1", () => {
    // A junior coefficient of 1.23 is an 18.7% easier standard because the
    // anchor is divided; reporting 23% here would overstate it by a quarter.
    const result = describeAgeStandard([engineEntry(14, 1.23)]);
    expect(result!.easedPct).toBeCloseTo(18.699, 2);
  });

  it("returns null for the flat 23-35 band, where the engine writes no entry", () => {
    // ageFactor() returns exactly 1 here and the engine's `factor !== 1` guard
    // means nothing is pushed, so there is no entry to read.
    for (const age of [23, 28, 35]) {
      expect(ageFactor(age)).toBe(1);
    }
    expect(describeAgeStandard([])).toBeNull();
  });

  it("returns null for a free-tier result, where appliedFactors is gated away", () => {
    expect(describeAgeStandard(undefined)).toBeNull();
    expect(describeAgeStandard(null)).toBeNull();
  });

  it("ignores the other factors the engine records", () => {
    expect(
      describeAgeStandard(["sex:female ×0.78 standard (beta)", "attachment:rope ×1.05"])
    ).toBeNull();
  });

  it("finds the age entry among other factors", () => {
    const result = describeAgeStandard([
      "sex:female ×0.78 standard (beta)",
      engineEntry(52, 1.128),
    ]);
    expect(result!.age).toBe(52);
  });

  it("rejects a malformed entry rather than rendering NaN", () => {
    expect(describeAgeStandard(["age:"])).toBeNull();
    expect(describeAgeStandard(["age:forty ×1.020 standard"])).toBeNull();
    expect(describeAgeStandard(["age:40 ×0 standard"])).toBeNull();
  });

  it("reads the ASCII 'x' that isometric-carry writes, not just U+00D7", () => {
    // split-strength-engine.ts:1605 writes `×`; strength/isometric-carry.ts:387
    // and :485 write an ASCII `x` for the same field. Matching only the former
    // silently rendered nothing for every hold and carry.
    const result = describeAgeStandard(["age:50 x1.110 standard (beta)"]);
    expect(result).not.toBeNull();
    expect(result!.age).toBe(50);
    expect(result!.factor).toBeCloseTo(1.11, 3);
  });

  it("round-trips real ageFactor() output at both ends of the curve", () => {
    // Builds the string from the engine's own factor, so a change to the curve
    // or to the template surfaces here rather than in production.
    for (const age of [14, 19, 22, 38, 45, 60]) {
      const factor = ageFactor(age);
      expect(factor).toBeGreaterThan(1);

      const described = describeAgeStandard([engineEntry(age, factor)]);
      expect(described, `age ${age} should be described`).not.toBeNull();
      expect(described!.age).toBe(age);
      expect(described!.easedPct).toBeGreaterThan(0);
      // toFixed(3) in the engine's template is the only precision loss.
      expect(described!.factor).toBeCloseTo(factor, 3);
    }
  });
});
