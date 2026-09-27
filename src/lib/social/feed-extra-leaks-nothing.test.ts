import { describe, expect, it } from "vitest";
import { extractExtra } from "./feed";

/**
 * The jsonb blind spot in public-projections.test.ts.
 *
 * That guard reads the migration SQL and refuses a set of column names,
 * `relative_strength` and `bodyweight_kg` among them, on the stated grounds
 * that "publishing it beside estimated_1rm_kg lets anyone divide and recover
 * exact bodyweight". It cannot see inside a jsonb column. `public_workout_scores`
 * projects `score_breakdown -> 'per_lift'`, legitimately — DOTS and GL points
 * arrive by the same arrow — and inside that blob sat
 * `{ estimated1RM, relativeStrength }`, in camelCase, which the feed card
 * rendered as "Squat: 180kg (2.05xBW)".
 *
 * So the column guard was satisfied and the number went out anyway. This test
 * watches the other end: whatever a scoring change puts in score_breakdown,
 * nothing bodyweight-shaped may reach a feed card, at any depth, in any casing.
 */
const FORBIDDEN = ["relativestrength", "bodyweight", "weightkg", "bodyweightratio", "heightcm", "dateofbirth"];

function offendingKeys(value: unknown, path = ""): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => offendingKeys(v, `${path}[${i}]`));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => {
      const here = path ? `${path}.${k}` : k;
      const normalised = k.toLowerCase().replace(/[^a-z]/g, "");
      const hit = FORBIDDEN.some((f) => normalised.includes(f));
      return hit ? [here] : offendingKeys(v, here);
    });
  }
  return [];
}

describe("feed extras carry nothing bodyweight-shaped", () => {
  it("drops per_lift entirely, rather than trusting its contents", () => {
    const extra = extractExtra({
      vo2max: 52,
      dots_score: 410,
      gl_points: 88,
      // Exactly the shape that shipped: the ratio beside the number it divides.
      per_lift: { squat: { estimated1RM: 180, relativeStrength: 2.05 } },
    } as Parameters<typeof extractExtra>[0]);

    expect(extra).not.toBeNull();
    expect(Object.keys(extra!)).not.toContain("perLift");
    expect(offendingKeys(extra)).toEqual([]);
  });

  it("still surfaces the fields a friend is meant to see", () => {
    const extra = extractExtra({
      vo2max: 52,
      execution_score: 0.9,
      decoupling_pct: 3.1,
      dots_score: 410,
      gl_points: 88,
    } as Parameters<typeof extractExtra>[0]);

    expect(extra).toMatchObject({ vo2max: 52, dotsScore: 410, glPoints: 88 });
  });

  it("finds a bodyweight-shaped key at any depth and in any casing", () => {
    // Guards the guard: if offendingKeys stopped working, the test above would
    // pass on a leak. These are the spellings a future scoring change is most
    // likely to reach for.
    expect(offendingKeys({ a: { b: { relative_strength: 2.05 } } })).toEqual(["a.b.relative_strength"]);
    expect(offendingKeys({ perLift: [{ relativeStrength: 2.05 }] })).toEqual(["perLift[0].relativeStrength"]);
    expect(offendingKeys({ bodyweightKg: 83 })).toEqual(["bodyweightKg"]);
    expect(offendingKeys({ vo2max: 52, dotsScore: 410 })).toEqual([]);
  });
});
