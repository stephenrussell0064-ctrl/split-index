import { describe, expect, it } from "vitest";
import { gateCardioResult } from "./gates";
import type { CardioResult } from "./cardio-activity";

/**
 * A FREE USER MUST NEVER SEE A WORK PACE THEY DID NOT RUN.
 *
 * `gates.ts` has two gating mechanisms and only one of them is safe for this
 * field.
 *
 *  - `gateCardioResult` OMITS: it destructures the handful of free fields
 *    into a new object and names everything else in `locked`. The field is
 *    genuinely absent from the payload. This is the one `workPiece` uses.
 *  - `gateCardioEnrichment` SUBSTITUTES: it returns fabricated stand-ins
 *    (`trimp: 112`, EF `0.84`, decoupling `3.1%`) for display behind a blur.
 *
 * Routing `workPiece` through anything shaped like the second would be worse
 * than the invented physiological ratios already there, because a rep pace is
 * checkable. An athlete can hold this number against the watch on their
 * wrist. For a product whose pitch is that every figure is mined from the
 * athlete's own history, showing someone a 400m split they never ran is not a
 * paywall — it is a fabrication, and there is no recovering from it.
 *
 * A blurred number present in the JSON is not gated, it is decorated. So this
 * asserts on the serialized payload, not just the type: the numbers must not
 * be in the bytes that reach the client.
 */

const WORK_PIECE = {
  kind: "interval",
  workPaceSecPerKm: 210,
  equivalentPaceSecPerKm: 232,
  sessionAvgPaceSecPerKm: 323,
} as const;

function resultWithWorkPiece(): CardioResult {
  return {
    score: 700,
    paceScore: 700,
    populationScore: 700,
    personalScore: null,
    personal: null,
    fitnessEquivalentSeconds: null,
    adjustments: null,
    ageGradeFactor: null,
    executionScore: 80,
    vo2max: 50,
    vo2maxMethod: "pace-estimate",
    trimp: 100,
    efficiencyFactor: 1,
    decouplingPct: 1,
    predictions: null,
    confidence: 1,
    flags: ["interval-work-piece-scored"],
    workPiece: { ...WORK_PIECE },
  } as unknown as CardioResult;
}

describe("the work-piece breakdown is omitted for free users, never faked", () => {
  it("is absent from the free payload — not null, not blurred, absent", () => {
    const free = gateCardioResult(resultWithWorkPiece(), false) as Record<string, unknown>;
    expect("workPiece" in free).toBe(false);
  });

  it("puts none of its numbers in the bytes sent to a free client", () => {
    // The assertion that would catch a blur-in-CSS "gate". If any of these
    // reach the wire, the field is decorated rather than gated.
    const wire = JSON.stringify(gateCardioResult(resultWithWorkPiece(), false));
    expect(wire).not.toContain("workPaceSecPerKm");
    expect(wire).not.toContain(String(WORK_PIECE.workPaceSecPerKm));
    expect(wire).not.toContain(String(WORK_PIECE.equivalentPaceSecPerKm));
  });

  it("names it as withheld, so the client can say what is behind the gate", () => {
    const free = gateCardioResult(resultWithWorkPiece(), false);
    expect(free.locked).toContain("workPiece");
  });

  it("reaches a premium user intact", () => {
    const paid = gateCardioResult(resultWithWorkPiece(), true);
    expect(paid.workPiece).toEqual(WORK_PIECE);
  });
});
