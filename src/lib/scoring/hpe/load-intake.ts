import type { SupabaseClient } from "@supabase/supabase-js";
import { ageFromDateOfBirth } from "@/lib/utils/age";
import { loadAthleteProfile } from "./load-profile";
import { loggedWeeklyRunMinutes, type ActivityRow } from "./ingest";
import type { PrefilledFromSplitIndex } from "./intake-record";

/**
 * WP2 — the pre-fill half of the intake, and the reason the flow is short
 * enough that anyone finishes it.
 *
 * The intake spec puts this first among its design rules: "Nothing is asked
 * twice. Anything Split Index already holds is pre-filled and shown for
 * confirmation, never re-entered. Roughly 60% of these fields fall into that
 * category, which is the reason this product is buildable at all."
 *
 * Everything here is read from an engine that already exists — adaptive 1RM,
 * race prediction, personalised HR, the logs — through the same thin adapters
 * the rest of the HPE uses. Nothing is recomputed.
 */

const HISTORY_WEEKS = 12;

export async function loadPrefilledIntake(
  supabase: SupabaseClient,
  userId: string
): Promise<PrefilledFromSplitIndex> {
  const since = new Date(Date.now() - HISTORY_WEEKS * 7 * 86_400_000).toISOString();

  const [{ data: profileRow }, { data: activityRows }] = await Promise.all([
    supabase
      .from("profiles")
      .select("age, date_of_birth, height_cm, weight_kg, max_hr, resting_hr, gender")
      .eq("user_id", userId)
      .single(),
    supabase
      .from("activities")
      .select("id, sport, started_at, duration_seconds, distance_meters, max_heart_rate")
      .eq("user_id", userId)
      .eq("is_draft", false)
      .gte("started_at", since),
  ]);

  const activities = (activityRows ?? []) as unknown as ActivityRow[];
  const age =
    ageFromDateOfBirth((profileRow?.date_of_birth as string | null) ?? null) ??
    (profileRow?.age as number | null) ??
    30;

  const gender = profileRow?.gender as string | null;
  const sex: PrefilledFromSplitIndex["sex"] = gender === "female" ? "female" : gender === "male" ? "male" : "other";

  // The diagnostic already reads the logs, the SRI 1RMs and the prediction
  // engine. Reusing it here means the numbers shown for confirmation on the
  // intake form are exactly the ones the plan will be built from — a form
  // that pre-fills from a different source than the engine reads is a form
  // that confirms the wrong thing.
  const diagnostic = await loadAthleteProfile(supabase, userId, { persist: false });

  const weeklyMinutes = loggedWeeklyRunMinutes(activities, 8);

  return {
    age,
    sex,
    bodyweightKg: profileRow?.weight_kg != null ? Number(profileRow.weight_kg) : null,
    heightCm: profileRow?.height_cm != null ? Number(profileRow.height_cm) : null,
    restingHr: profileRow?.resting_hr != null ? Number(profileRow.resting_hr) : null,
    maxHr: profileRow?.max_hr != null ? Number(profileRow.max_hr) : null,
    oneRms: diagnostic?.profile.oneRms ?? {},
    predicted5kS: diagnostic?.profile.predicted5kS ?? 1500,
    loggedWeeklyRunMinutes: weeklyMinutes,
    // Seeds the ACWR denominator so week 1 is measured against reality rather
    // than zero — the F6 finding.
    chronicLoad: Math.max(1, (diagnostic?.profile.weeklyVolumeMin ?? 0) * 4),
  };
}
