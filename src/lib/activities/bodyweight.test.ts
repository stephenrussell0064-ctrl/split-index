import { describe, expect, it } from "vitest";
import { resolveScoringBodyweightKg } from "./bodyweight";

/**
 * WHICH BODYWEIGHT AN OLD SESSION IS JUDGED AGAINST.
 *
 * Strength scoring is relative to bodyweight, and the API's plausibility guard
 * asks "is this load possible for this athlete" using the same number. PATCH
 * used to hand it `profiles.weight_kg` — TODAY's weight — while editing a
 * session that might be a year old. An athlete who has since lost 15kg could
 * not open an old gym session to fix a typo: the lift they genuinely performed
 * read as implausible for a person who no longer weighs that much, and the
 * edit came back 400 with no way forward.
 *
 * This function already had the right precedence and POST already used it.
 * These tests pin that order, because the order is the whole point.
 */

describe("the bodyweight a gym session is scored against", () => {
  it("prefers what the athlete submitted with this edit", () => {
    expect(
      resolveScoringBodyweightKg("gym", {
        submittedBodyweight: 82,
        activityMetadata: { bodyweight_kg: 90 },
        strengthScoreBodyweight: 95,
        profileWeightKg: 78,
      })
    ).toBe(82);
  });

  it("falls back to what the session itself recorded, not to today's weight", () => {
    // The case that broke editing: no bodyweight in the edit, an old session,
    // and a profile weight that has moved a long way since.
    expect(
      resolveScoringBodyweightKg("gym", {
        submittedBodyweight: null,
        activityMetadata: { bodyweight_kg: 95 },
        strengthScoreBodyweight: 95,
        profileWeightKg: 78,
      })
    ).toBe(95);
  });

  it("uses the stored strength score when the activity carries no bodyweight", () => {
    expect(
      resolveScoringBodyweightKg("gym", {
        submittedBodyweight: null,
        activityMetadata: {},
        strengthScoreBodyweight: 95,
        profileWeightKg: 78,
      })
    ).toBe(95);
  });

  it("uses the profile only when the session says nothing at all", () => {
    expect(
      resolveScoringBodyweightKg("gym", {
        submittedBodyweight: null,
        activityMetadata: null,
        strengthScoreBodyweight: null,
        profileWeightKg: 78,
      })
    ).toBe(78);
  });

  it("ignores a zero or negative weight at every level", () => {
    // A 0 stored anywhere in the chain must not be read as "0 kg athlete",
    // which would make every lift infinitely impressive.
    expect(
      resolveScoringBodyweightKg("gym", {
        submittedBodyweight: 0,
        activityMetadata: { bodyweight_kg: -5 },
        strengthScoreBodyweight: 0,
        profileWeightKg: 78,
      })
    ).toBe(78);
  });

  it("does not apply to endurance sports at all", () => {
    // Running is not scored relative to bodyweight, and returning one here
    // would put a number into a guard that has no business using it.
    expect(
      resolveScoringBodyweightKg("running", { submittedBodyweight: 82, profileWeightKg: 78 })
    ).toBeNull();
  });
});
