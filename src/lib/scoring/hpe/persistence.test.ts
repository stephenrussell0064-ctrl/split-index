/**
 * WP8, Rev 2 addition: "the diagnostic re-runs every four weeks against
 * accumulating data. If the emphasis vector shifts by more than 0.10 on any
 * dimension, the remaining macrocycle is regenerated and the athlete is shown
 * what changed and why."
 *
 * Before persistence existed, `compareEmphasis` was correct code that could
 * never fire — there was nothing stored to compare against. These tests exist
 * to keep it firing.
 */

import { describe, expect, it } from "vitest";
import { evaluateRerun, type StoredProfileSummary } from "./persistence";
import { DIAGNOSTIC_RERUN_WEEKS, EMPHASIS_KEYS, HPE_CONSTANTS_VERSION, type EmphasisKey } from "./constants";
import type { AthleteProfile, EmphasisVector } from "./types";

function vector(overrides: Partial<Record<EmphasisKey, number>> = {}): EmphasisVector {
  const even = 1 / EMPHASIS_KEYS.length;
  const base = Object.fromEntries(EMPHASIS_KEYS.map((k) => [k, even])) as EmphasisVector;
  return { ...base, ...overrides };
}

function storedProfile(overrides: Partial<StoredProfileSummary> = {}): StoredProfileSummary {
  return {
    id: "profile-1",
    generatedAt: new Date("2026-01-01T00:00:00Z").toISOString(),
    constantsVersion: HPE_CONSTANTS_VERSION,
    tier: 2,
    emphasis: vector(),
    ...overrides,
  };
}

function nextProfile(emphasis: EmphasisVector, overrides: Partial<AthleteProfile> = {}): AthleteProfile {
  return {
    constantsVersion: HPE_CONSTANTS_VERSION,
    tier: 2,
    emphasis,
    ...overrides,
  } as AthleteProfile;
}

const FOUR_WEEKS_LATER = new Date("2026-01-29T00:00:00Z");
const ONE_WEEK_LATER = new Date("2026-01-08T00:00:00Z");

describe("WP8 — the four-weekly diagnostic re-run", () => {
  it("does not regenerate before four weeks have passed, however far the vector moved", () => {
    const decision = evaluateRerun(
      storedProfile(),
      nextProfile(vector({ aerobic_base: 0.5, vo2max_speed: 0.03 })),
      ONE_WEEK_LATER
    );
    expect(decision.due).toBe(false);
    expect(decision.shouldRegenerate).toBe(false);
    // The drift is still computed and reported — it is the ACTION that waits,
    // not the observation.
    expect(decision.drift!.shouldRegenerate).toBe(true);
  });

  it("regenerates when a dimension has shifted past the threshold and four weeks have passed", () => {
    const decision = evaluateRerun(
      storedProfile(),
      nextProfile(vector({ aerobic_base: 0.5, vo2max_speed: 0.03 })),
      FOUR_WEEKS_LATER
    );
    expect(decision.due).toBe(true);
    expect(decision.shouldRegenerate).toBe(true);
    // "the athlete is shown what changed and why" — the explanation is not
    // optional garnish, it is the half of the requirement that distinguishes
    // a plan that adapts from a plan that silently changes.
    expect(decision.explanations.join(" ")).toMatch(/aerobic base up/);
    expect(decision.explanations.join(" ")).toMatch(/your own data/);
  });

  it("leaves the plan alone when the vector has barely moved", () => {
    const decision = evaluateRerun(
      storedProfile(),
      nextProfile(vector({ aerobic_base: 1 / EMPHASIS_KEYS.length + 0.02 })),
      FOUR_WEEKS_LATER
    );
    expect(decision.due).toBe(true);
    expect(decision.shouldRegenerate).toBe(false);
  });

  it("regenerates on a constants-version change regardless of drift, and says so", () => {
    const decision = evaluateRerun(
      storedProfile({ constantsVersion: "1.9.0" }),
      nextProfile(vector()),
      FOUR_WEEKS_LATER
    );
    expect(decision.shouldRegenerate).toBe(true);
    expect(decision.explanations.join(" ")).toMatch(/training-logic constants moved from 1\.9\.0/);
  });

  it("tells the athlete when their data-sufficiency tier has risen", () => {
    const decision = evaluateRerun(
      storedProfile({ tier: 2 }),
      nextProfile(vector(), { tier: 3 }),
      FOUR_WEEKS_LATER
    );
    expect(decision.shouldRegenerate).toBe(true);
    expect(decision.explanations.join(" ")).toMatch(/tier rose from 2 to 3/);
    expect(decision.explanations.join(" ")).toMatch(/bands narrow/);
  });

  it("treats a first run as due with no drift — absent history is not zero drift", () => {
    const decision = evaluateRerun(null, nextProfile(vector()), FOUR_WEEKS_LATER);
    expect(decision.due).toBe(true);
    expect(decision.drift).toBeNull();
    expect(decision.shouldRegenerate).toBe(false);
    expect(decision.explanations).toEqual([]);
  });

  it("uses the constant rather than a hardcoded interval", () => {
    const justUnder = new Date(
      new Date("2026-01-01T00:00:00Z").getTime() + (DIAGNOSTIC_RERUN_WEEKS * 7 - 1) * 86_400_000
    );
    const justOver = new Date(
      new Date("2026-01-01T00:00:00Z").getTime() + (DIAGNOSTIC_RERUN_WEEKS * 7 + 1) * 86_400_000
    );
    const moved = nextProfile(vector({ aerobic_base: 0.5, vo2max_speed: 0.03 }));
    expect(evaluateRerun(storedProfile(), moved, justUnder).due).toBe(false);
    expect(evaluateRerun(storedProfile(), moved, justOver).due).toBe(true);
  });
});
