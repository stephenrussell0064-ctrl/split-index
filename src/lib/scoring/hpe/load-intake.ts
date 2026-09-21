import type { SupabaseClient } from "@supabase/supabase-js";
import { ageFromDateOfBirth } from "@/lib/utils/age";
import { loadAthleteProfile } from "./load-profile";
import { loggedWeeklyRunMinutes, type ActivityRow } from "./ingest";
import { BASE_STRESS_PER_MIN, RETURNING_ATHLETE_VOLUME_SHARE, STRENGTH_STRESS } from "./constants";
import type { PrefilledFromSplitIndex } from "./intake-record";
import { onRampAnchorMinutes } from "./intake";

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

  /**
   * The on-ramp anchor: what the athlete has been running lately, with a floor
   * under it for someone coming back.
   *
   * The trailing average alone is right for an athlete who has simply been
   * training less, and wrong for one who has stopped and is now entering a
   * race. Week 1 of the block is a MULTIPLE of this number, and no multiple of
   * something near zero reaches anything — the same reasoning the macrocycle
   * already applies at exactly zero (PROVISIONAL_START_RUN_MIN_PER_WEEK),
   * carried the one step further it needed.
   *
   * `activeRunningVolumeMin` is what they hold when they are training, so half
   * of it is a return-to-training volume rather than a guess. It can only raise
   * the anchor, never lower it, and never above what they have actually held.
   */
  const weeklyMinutes = onRampAnchorMinutes(
    loggedWeeklyRunMinutes(activities, 8),
    diagnostic?.profile.activeRunningVolumeMin ?? 0,
    RETURNING_ATHLETE_VOLUME_SHARE
  );

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
    // RUNNING volume, not total. ACWR's protective value is modality-specific
    // loading tolerance, and rowing confers essentially none of it for impact
    // running. Seeding the denominator from total volume gave a heavy rower
    // four-fold headroom to ramp running against — the opposite of what the
    // control is for.
    // In STRESS UNITS, the same ones the plan's own weeks are measured in.
    // This was running minutes × 4 — a different unit from the numerator —
    // so a normal athlete's first four weeks read as a ratio of 0.5-0.75 and
    // were labelled "deliberately easy" when they were their current volume.
    chronicLoad: chronicLoadFromRuns(activities),
    longestRecentRunMin: longestRunMinutes(activities),
  };
}

/**
 * The athlete's recent weekly training stress, in the engine's own stress
 * units, so the ACWR denominator and numerator measure the same thing.
 *
 * Runs are costed at the easy-run rate per minute; gym sessions at the flat
 * maintenance-session figure. Both are the engine's own tables
 * (`BASE_STRESS_PER_MIN`, `STRENGTH_STRESS`), so a week the athlete has
 * actually done and a week the plan prescribes are on one scale.
 */
export function chronicLoadFromRuns(activities: ActivityRow[]): number {
  const windowWeeks = 4;
  const since = Date.now() - windowWeeks * 7 * 86_400_000;
  let stress = 0;
  for (const a of activities) {
    const startedAt = new Date(a.started_at).getTime();
    if (!Number.isFinite(startedAt) || startedAt < since) continue;
    const minutes = (Number(a.duration_seconds) || 0) / 60;
    if (a.sport === "gym") stress += STRENGTH_STRESS.strength_maintenance ?? 42;
    else if (a.sport === "run") stress += minutes * (BASE_STRESS_PER_MIN.easy_run ?? 0.8);
    else stress += minutes * (BASE_STRESS_PER_MIN.easy_bike ?? 0.55);
  }
  return Math.max(1, stress / windowWeeks);
}

function longestRunMinutes(activities: ActivityRow[]): number | null {
  let longest = 0;
  for (const a of activities) {
    if (a.sport !== "run") continue;
    longest = Math.max(longest, (Number(a.duration_seconds) || 0) / 60);
  }
  return longest > 0 ? Math.round(longest) : null;
}
