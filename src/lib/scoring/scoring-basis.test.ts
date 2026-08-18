import { describe, expect, it } from "vitest";
import { resolveScoringBasis, resolveScoringSex } from "@/lib/scoring/adapters";
import { scoreActivity } from "@/lib/scoring/service";
import { DEFAULT_SCORING_BASIS } from "@/lib/scoring/constants";
import type { Profile } from "@/types";

/**
 * Identity and scoring basis are two different questions, and conflating them
 * shipped a signup-to-dead-end: `profiles.gender` has always offered four
 * options, while the scoring guard accepted two and threw on the rest. That
 * throw sat in assertScoringInput, which runs on every sport and every
 * submit, so an athlete who answered "Other" or "Prefer not to say" could
 * never log a single workout.
 *
 * The end-to-end cases below are the actual user-facing promise. The unit
 * cases above them pin the precedence that makes it work.
 */

const baseProfile = {
  id: "p",
  user_id: "u",
  username: null,
  display_name: null,
  avatar_url: null,
  bio: null,
  country: null,
  age: 30,
  date_of_birth: null,
  height_cm: 180,
  weight_kg: 80,
  max_hr: 190,
  resting_hr: null,
  gender: "male",
  experience: "intermediate",
  training_history_years: 5,
  goals: [],
  preferred_sports: ["gym"],
  onboarding_completed: true,
  current_split_index: null,
  current_endurance_index: null,
  current_strength_index: null,
  index_updated_at: null,
  subscription_tier: "free",
  subscription_status: null,
  subscription_sku: null,
  subscription_source: null,
  primary_motivation: null,
  stripe_customer_id: null,
  created_at: "",
  updated_at: "",
} as unknown as Profile;

const EMPTY_HISTORY = { enduranceIndices: [], strengthIndices: [], splitIndices: [] };

function scoreGymSessionFor(profile: Profile) {
  return scoreActivity(
    {
      sport: "gym",
      durationSeconds: 3600,
      exercises: [
        {
          exercise_name: "Bench Press",
          muscle_group: "Chest",
          order_index: 0,
          sets: [{ weight_kg: 100, reps: 5 }],
        },
      ],
      profile,
      recentLoads: { acute: 0, chronic: 1 },
    } as never,
    EMPTY_HISTORY,
    []
  );
}

describe("resolveScoringBasis precedence", () => {
  it("uses an explicitly chosen basis over identity", () => {
    const resolved = resolveScoringBasis({ gender: "male", scoring_basis: "female" });
    expect(resolved).toEqual({ sex: "female", source: "explicit", isDefault: false });
  });

  it("derives from identity when it already answers the question", () => {
    // The point of this branch: an athlete who said male/female is never
    // asked the same thing twice by the onboarding or profile forms.
    expect(resolveScoringBasis({ gender: "female" })).toEqual({
      sex: "female",
      source: "identity",
      isDefault: false,
    });
  });

  it.each(["other", "prefer_not_to_say", null] as const)(
    "falls back to a flagged default for gender %s",
    (gender) => {
      const resolved = resolveScoringBasis({ gender });
      expect(resolved.sex).toBe(DEFAULT_SCORING_BASIS);
      expect(resolved.source).toBe("default");
      // isDefault is how callers know the number is uncalibrated rather than
      // chosen — it must not silently look like a real answer.
      expect(resolved.isDefault).toBe(true);
    }
  );

  it("prefers an explicit basis for an athlete whose identity does not imply one", () => {
    const resolved = resolveScoringBasis({ gender: "other", scoring_basis: "female" });
    expect(resolved).toEqual({ sex: "female", source: "explicit", isDefault: false });
  });

  it("never throws for any gender value", () => {
    for (const gender of ["male", "female", "other", "prefer_not_to_say", null] as const) {
      expect(() => resolveScoringSex({ gender })).not.toThrow();
    }
  });
});

describe("an athlete who is not male or female can still log", () => {
  it.each(["other", "prefer_not_to_say", null] as const)(
    "scores a gym session for gender %s instead of refusing it",
    (gender) => {
      const result = scoreGymSessionFor({ ...baseProfile, gender } as Profile);
      expect(result.sportIndex).toBeGreaterThan(0);
    }
  );

  it("scores the same session identically once they pick a basis matching their identity", () => {
    // A male-identifying athlete and an "other" athlete who chose the male
    // standards are being compared against the same table, so the number must
    // be the same — the basis is what scores, not the identity.
    const viaIdentity = scoreGymSessionFor({ ...baseProfile, gender: "male" } as Profile);
    const viaExplicitBasis = scoreGymSessionFor({
      ...baseProfile,
      gender: "other",
      scoring_basis: "male",
    } as unknown as Profile);
    expect(viaExplicitBasis.sportIndex).toBe(viaIdentity.sportIndex);
  });

  it("honours a chosen basis that differs from the default", () => {
    const female = scoreGymSessionFor({
      ...baseProfile,
      gender: "prefer_not_to_say",
      scoring_basis: "female",
    } as unknown as Profile);
    const fallback = scoreGymSessionFor({
      ...baseProfile,
      gender: "prefer_not_to_say",
    } as Profile);
    // Same lift, different reference population — the scores must diverge, or
    // the chosen basis is not actually reaching the strength standards.
    expect(female.sportIndex).not.toBe(fallback.sportIndex);
  });
});
