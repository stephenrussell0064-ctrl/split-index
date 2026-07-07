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
  bodyweightKg: number | null,
  effectiveMaxHr?: number | null
): Profile {
  return {
    ...profile,
    ...(bodyweightKg ? { weight_kg: bodyweightKg } : {}),
    ...(effectiveMaxHr ? { max_hr: effectiveMaxHr } : {}),
  };
}

/**
 * The age-based max-HR formula (Tanaka: 208 − 0.7×age) systematically
 * underestimates max HR for many trained athletes — if a session's own
 * avg HR already meets or exceeds it, every effort-fraction calculation
 * downstream treats that (and easier) sessions as harder than they were.
 * Prefer real evidence — a profile-set max HR, or the highest max HR ever
 * recorded across the athlete's own logged activities — over the formula.
 */
export function resolveEffectiveMaxHr(
  profileMaxHr: number | null | undefined,
  observedMaxHr: number | null | undefined
): number | null {
  const candidates = [profileMaxHr, observedMaxHr].filter(
    (v): v is number => typeof v === "number" && v > 0
  );
  return candidates.length > 0 ? Math.max(...candidates) : null;
}
