import type { Profile, SportType } from "@/types";

/** Bodyweight captured at workout time — never substitute current profile weight on edits. */
export function resolveScoringBodyweightKg(
  sport: SportType,
  opts: {
    submittedBodyweight?: number | null;
    activityMetadata?: Record<string, unknown> | null;
    strengthScoreBodyweight?: number | null;
    profileWeightKg?: number | null;
  }
): number | null {
  if (sport !== "gym") return null;

  const { submittedBodyweight, activityMetadata, strengthScoreBodyweight, profileWeightKg } =
    opts;

  if (typeof submittedBodyweight === "number" && submittedBodyweight > 0) {
    return submittedBodyweight;
  }

  const metaBw = activityMetadata?.bodyweight_kg;
  if (typeof metaBw === "number" && metaBw > 0) {
    return metaBw;
  }

  if (typeof strengthScoreBodyweight === "number" && strengthScoreBodyweight > 0) {
    return strengthScoreBodyweight;
  }

  // Legacy workouts logged before bodyweight was stored — only then use profile.
  if (typeof profileWeightKg === "number" && profileWeightKg > 0) {
    return profileWeightKg;
  }

  return null;
}

export function buildScoringProfile(
  profile: Profile,
  bodyweightKg: number | null
): Profile {
  return bodyweightKg ? { ...profile, weight_kg: bodyweightKg } : profile;
}
