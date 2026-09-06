import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SessionScoreInsights } from "@/components/scoring/session-score-insights";
import { readAgeAdjustment, readCardioAgeGrade } from "@/lib/scoring/presentation";
import { scoreCardioActivity } from "@/lib/scoring/cardio-activity";
import { enduranceAgeGradeFactor } from "@/lib/scoring/cardio-benchmarks";
import { gateCardioResult } from "@/lib/scoring/gates";
import { ageFactor, scoreStrength, serializeStrengthResult } from "@/lib/scoring/split-strength-engine";
import type { ScoreStrengthResult } from "@/lib/scoring/split-strength-engine";
import type { CardioInput, CardioResult } from "@/lib/scoring/cardio-activity";

/**
 * The age curve was computed and applied in both engines, and correctly
 * premium-gated, but never rendered — its only reader collapsed the whole
 * `appliedFactors` array into an `isBeta` boolean for a badge. These tests
 * pin the readout to the actual DOM output, not to the formatter alone, so
 * deleting the JSX fails here rather than passing quietly.
 *
 * `renderToStaticMarkup` rather than a DOM testing library: the row is a pure
 * function component with no hooks, state or effects, and the repo carries no
 * jsdom/RTL dependency. A static render is enough to answer "is this on the
 * page", which is the whole question.
 */
function renderStrength(result: Partial<ScoreStrengthResult>): string {
  const base: ScoreStrengthResult = {
    liftKey: "bench press",
    score: 700,
    tier: "Advanced",
    oneRM: 100,
    allTimeOneRM: 100,
    currentOneRM: 98,
    oneRMConfidence: 0.9,
    bodyweightRatio: 1.2,
    source: "primary",
    appliedFactors: [],
    nextTier: null,
    flags: [],
    oneRMBandKg: null,
    trend: null,
    suggestion: null,
  };

  return renderToStaticMarkup(
    <SessionScoreInsights
      zone="gym"
      isPremium
      strengthResults={[{ name: "Bench Press", result: { ...base, ...result } }]}
    />
  );
}

describe("age adjustment readout", () => {
  it("renders the age string for a masters athlete whose factor is not 1.0", () => {
    const factor = ageFactor(50);
    expect(factor).not.toBe(1);

    const html = renderStrength({
      appliedFactors: [`age:50 ×${factor.toFixed(3)} standard (beta)`],
      flags: ["age-factor-beta"],
    });

    expect(html).toContain("Age 50");
    // The factor as applied, and the movement it actually produced. The
    // engine divides the anchor by the factor, so ×1.110 is a 9.9% easier
    // standard — quoting "11%" would overstate the athlete's adjustment.
    expect(html).toContain("×1.110");
    expect(html).toContain("9.9%");
    expect(html).toContain("lower");
  });

  it("renders the age string for a junior, not just a master", () => {
    expect(ageFactor(16)).toBe(1.13);

    const html = renderStrength({
      appliedFactors: ["age:16 ×1.130 standard (beta)"],
      flags: ["age-factor-beta"],
    });

    expect(html).toContain("Age 16");
    expect(html).toContain("×1.130");
  });

  it("renders nothing at all across the 23-35 peak band, where the factor is exactly 1.0", () => {
    for (const age of [23, 27, 30, 35]) {
      expect(ageFactor(age)).toBe(1);

      // Faithful to the engine: at factor 1.0 it pushes NO age entry, so the
      // realistic input is an empty array.
      const html = renderStrength({ appliedFactors: [] });
      expect(html).not.toContain(`Age ${age}`);
      expect(html).not.toContain("Age-graded");
      expect(html).not.toContain("standard");
    }
  });

  it("stays silent if a factor of exactly 1.0 ever reaches the reader anyway", () => {
    const html = renderStrength({ appliedFactors: ["age:30 ×1.000 standard (beta)"] });
    expect(html).not.toContain("Age 30");
    expect(html).not.toContain("Age-graded");
  });

  it("keeps the existing beta badge behaviour", () => {
    const html = renderStrength({
      appliedFactors: ["age:50 ×1.110 standard (beta)"],
      flags: ["age-factor-beta"],
    });
    expect(html).toContain("(beta)");
  });

  it("reads the string the engine really produces, end to end", () => {
    const result = scoreStrength({
      liftKey: "bench press",
      history: [],
      latestSet: { weightKg: 100, reps: 5 },
      bodyweightKg: 83,
      sex: "male",
      age: 50,
      isPremium: true,
    });

    const readout = readAgeAdjustment(result.appliedFactors);
    expect(readout).not.toBeNull();
    expect(readout?.age).toBe(50);

    const html = renderStrength(result);
    expect(html).toContain(`Age ${readout!.age}`);
  });
});

/**
 * Cardio's age grading was not invisible — it was worse. `scoreCardioActivity`
 * pushes an `age-graded` flag, which fell through to the generic flag list and
 * rendered as a bullet reading "· age graded": a lowercased dev token, with no
 * number and no explanation, shown to a paying athlete.
 */
function renderCardio(result: Partial<CardioResult>): string {
  const base: CardioResult = {
    score: 620,
    paceScore: 620,
    executionScore: 600,
    vo2max: 48,
    vo2maxMethod: "pace-estimate",
    trimp: 112,
    efficiencyFactor: 0.84,
    decouplingPct: 3.1,
    predictions: null,
    confidence: 0.9,
    flags: [],
  };

  return renderToStaticMarkup(
    <SessionScoreInsights zone="cardio" isPremium cardioResult={{ ...base, ...result }} />
  );
}

/** A minimal, fully-typed 10K — no casts, so the compiler keeps checking this against the real CardioInput. */
function runAged(age: number): CardioInput {
  return {
    type: "run",
    benchmarkSport: "run",
    distanceMeters: 10000,
    durationSeconds: 50 * 60,
    sex: "male",
    age,
  };
}

describe("cardio age grading readout", () => {
  it("explains the adjustment instead of printing the raw flag token", () => {
    const html = renderCardio({ flags: ["age-graded"] });

    expect(html).toContain("Age-graded");
    expect(html).toContain("adjusted for");
    // The bare dashes-to-spaces flag bullet must be gone, not merely
    // duplicated alongside the sentence.
    expect(html).not.toContain("· age graded");
    expect(html).not.toContain(">age graded<");
  });

  it("tells the athlete their displayed times are NOT graded", () => {
    // The engine grades the time for scoring only and stores real times.
    // Without saying so, an age-graded score next to a real predicted time
    // invites the reader to assume the predictions were adjusted too.
    const html = renderCardio({ flags: ["age-graded"] });
    expect(html).toContain("un-graded");
  });

  it("says nothing for an athlete whose factor is 1.0", () => {
    const html = renderCardio({ flags: [] });
    expect(html).not.toContain("Age-graded");
    expect(html).not.toContain("age graded");
  });

  it("leaves other flags rendering as before", () => {
    const html = renderCardio({ flags: ["age-graded", "negative-split-strong"] });
    expect(html).toContain("negative split strong");
    expect(html).toContain("Age-graded");
  });

  it("names the magnitude when the engine reports the factor", () => {
    // enduranceAgeGradeFactor(50) === 0.89. The engine multiplies the
    // athlete's time by it, which is the same as dividing the standard's
    // times by it: 1/0.89 = 1.124, a standard 12.4% slower.
    expect(enduranceAgeGradeFactor(50)).toBeCloseTo(0.89, 5);

    const html = renderCardio({ flags: ["age-graded"], ageGradeFactor: 0.89 });
    expect(html).toContain("12.4%");
    expect(html).toContain("slower");
    expect(html).toContain("×0.890");
  });

  it("says 'slower', never 'lower', for a time-based standard", () => {
    // A LOWER time standard would be HARDER — the opposite of age grading.
    const html = renderCardio({ flags: ["age-graded"], ageGradeFactor: 0.89 });
    expect(html).not.toContain("% lower");
  });

  it("falls back to the numberless wording for a result persisted before the factor was reported", () => {
    const html = renderCardio({ flags: ["age-graded"], ageGradeFactor: undefined });
    expect(html).toContain("Age-graded");
    expect(html).toContain("adjusted for");
    // Must not invent a figure, nor read a missing factor as 1.0 and claim a
    // 0% adjustment. Scoped to the readout's own phrasing: the panel legitimately
    // contains "90%" (confidence) and "×" (the TRIMP note's "duration × intensity"),
    // so a bare not-contains on those would fail for the wrong reason.
    expect(html).not.toContain("standard 0");
    expect(html).not.toContain("(×");
    expect(html).not.toMatch(/standard \d/);
  });

  it("reads the factor the endurance engine really reports, end to end", () => {
    const result = scoreCardioActivity(runAged(50));

    expect(result.flags).toContain("age-graded");
    expect(result.ageGradeFactor).toBeCloseTo(0.89, 5);

    const html = renderCardio(result);
    expect(html).toContain("12.4%");
  });

  it("reports no factor for an athlete inside the ungraded band", () => {
    const result = scoreCardioActivity(runAged(30));

    expect(result.flags).not.toContain("age-graded");
    expect(result.ageGradeFactor).toBeNull();
  });
});

describe("age grading stays behind the premium gate", () => {
  it("never sends the cardio factor to a free user", () => {
    const graded = scoreCardioActivity(runAged(50));
    expect(graded.ageGradeFactor).not.toBeNull();

    const free = gateCardioResult(graded, false);
    // Not merely nulled — absent. The free branch picks fields explicitly,
    // so a newly added premium field must not ride along by default.
    expect("ageGradeFactor" in free).toBe(false);
    expect("flags" in free).toBe(false);
    expect((free as { locked: string[] }).locked).toContain("ageGradeFactor");

    // The premium branch returns the full result. Narrowed rather than cast
    // blindly — GatedCardioResult is a union precisely so a caller cannot
    // reach a premium field without proving it is on the premium branch.
    const premium = gateCardioResult(graded, true);
    expect("locked" in premium).toBe(false);
    expect((premium as CardioResult).ageGradeFactor).toBe(graded.ageGradeFactor);
  });

  it("never sends the strength age string to a free user", () => {
    const result = scoreStrength({
      liftKey: "bench press",
      history: [],
      latestSet: { weightKg: 100, reps: 5 },
      bodyweightKg: 83,
      sex: "male",
      age: 50,
      isPremium: true,
    });
    expect(readAgeAdjustment(result.appliedFactors)).not.toBeNull();

    const free = serializeStrengthResult(result, false);
    expect("appliedFactors" in free).toBe(false);
    expect(readAgeAdjustment((free as { appliedFactors?: string[] }).appliedFactors)).toBeNull();
  });
});

describe("readCardioAgeGrade", () => {
  it("is null for a missing, legacy or unity factor", () => {
    expect(readCardioAgeGrade(undefined)).toBeNull();
    expect(readCardioAgeGrade(null)).toBeNull();
    expect(readCardioAgeGrade(1)).toBeNull();
    expect(readCardioAgeGrade(0)).toBeNull();
  });

  it("reports how far the standard moved, not the raw factor", () => {
    const readout = readCardioAgeGrade(0.89);
    expect(readout?.percentMoved).toBe(12.4);
    expect(readout?.direction).toBe("slower");
  });

  it("uses the same magnitude formula as the strength readout", () => {
    // Both are |1 - 1/factor|: the standard is divided by the factor in each
    // engine. A factor and its reciprocal must therefore move the standard by
    // the same amount in opposite directions.
    expect(readCardioAgeGrade(1 / 1.11)?.percentMoved).toBe(11);
    expect(readAgeAdjustment(["age:50 ×1.110 standard (beta)"])?.percentMoved).toBe(9.9);
    // 1.11 eases a ratio standard by 9.9%; 0.9009 eases a time standard by
    // 11%. Different numbers, same rule — the asymmetry is real, not a bug.
    expect(readCardioAgeGrade(1.11)?.direction).toBe("faster");
  });
});

describe("readAgeAdjustment", () => {
  it("accepts the ASCII 'x' that the hold/carry engine writes", () => {
    // strength/isometric-carry.ts writes `x`, split-strength-engine writes
    // `×`. Matching only one silently hides the readout for every hold and
    // carry.
    expect(readAgeAdjustment(["age:50 x1.110 standard (beta)"])?.age).toBe(50);
    expect(readAgeAdjustment(["age:50 ×1.110 standard (beta)"])?.age).toBe(50);
  });

  it("ignores the other applied factors", () => {
    expect(
      readAgeAdjustment(["sex:female ×0.65 standard (beta)", "attachment:rope ×1.05"])
    ).toBeNull();
  });

  it("is null for missing or gated factors", () => {
    expect(readAgeAdjustment(undefined)).toBeNull();
    expect(readAgeAdjustment(null)).toBeNull();
    expect(readAgeAdjustment([])).toBeNull();
  });

  it("reports the standard's movement, not the raw factor", () => {
    const readout = readAgeAdjustment(["age:50 ×1.110 standard (beta)"]);
    expect(readout?.factor).toBe(1.11);
    expect(readout?.percentMoved).toBe(9.9);
    expect(readout?.direction).toBe("lower");
  });
});
