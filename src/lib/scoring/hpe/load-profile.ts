/**
 * Hybrid Plan Engine — server-side profile loader.
 *
 * The one place that reads Supabase and hands back an AthleteProfile. Kept
 * separate from `diagnose` itself so the diagnostic stays a pure function over
 * plain data, and separate from the API route so it can be reused by the
 * weekly plan, the diagnostic report screen (WP9) and the four-weekly re-run
 * (WP8) without any of them duplicating the query.
 *
 * Returns null rather than a degraded profile when there is not enough
 * history: a caller that gets null must fall back to the population-based
 * prescriptions, not to a diagnosis built on nothing. That is the same
 * refusal `diagnose` makes at tier 0 and `predictHrAtPace` makes outside its
 * fitted range — bound every extrapolation or refuse to make it.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { ageFromDateOfBirth } from "@/lib/utils/age";
import { diagnose } from "./diagnostics";
import {
  ingestCrossTraining,
  ingestLiftSets,
  ingestRuns,
  loggedWeeklyRunMinutes,
  resolveHeartRates,
  type ActivityRow,
  type GymExerciseRow,
} from "./ingest";
import {
  evaluateRerun,
  loadLatestStoredProfile,
  saveProfile,
  type RerunDecision,
} from "./persistence";
import type { AthleteProfile, FindingId } from "./types";

/** How much history to pull. Twelve weeks is the tier-3 requirement; there is no value in reading further back for a diagnosis that only looks at 12. */
const HISTORY_WEEKS = 12;

export interface LoadedProfile {
  profile: AthleteProfile;
  /** Weekly running minutes derived from the logs — the on-ramp anchor, and the value the athlete's own stated figure is reconciled against. */
  loggedWeeklyRunMinutes: number | null;
  /** Surfaced so callers can tell the athlete which numbers were assumed rather than known. */
  assumptions: string[];
  /** Row id of the persisted diagnostic run, when one was written. Needed to attach a plan to it. */
  profileId: string | null;
  /** Finding slug to row id, for the NOT NULL foreign key on hpe_sessions. */
  findingIds: Map<FindingId, string>;
  /** The four-weekly re-run verdict (WP8, Rev 2 addition). Null on a first run — nothing to compare against. */
  rerun: RerunDecision | null;
}

/**
 * Loads history, diagnoses, and — unless `persist` is false — stores the run
 * so the four-weekly comparison has something to compare against next time.
 *
 * A new row is written only when the diagnosis has meaningfully moved or
 * enough time has passed. Writing on every request would fill the table with
 * duplicates and turn emphasis-drift analysis into a measure of how often the
 * athlete opened the app.
 */
export async function loadAthleteProfile(
  supabase: SupabaseClient,
  userId: string,
  options: { priority?: number; persist?: boolean } = {}
): Promise<LoadedProfile | null> {
  const since = new Date(Date.now() - HISTORY_WEEKS * 7 * 86_400_000).toISOString();

  const [{ data: profileRow }, { data: activityRows }, { data: benchmarkRow }] = await Promise.all([
    supabase
      .from("profiles")
      .select("age, date_of_birth, height_cm, weight_kg, max_hr, resting_hr, gender")
      .eq("user_id", userId)
      .single(),
    supabase
      .from("activities")
      .select(
        "id, sport, started_at, duration_seconds, distance_meters, avg_heart_rate, max_heart_rate, avg_cadence, session_type, metadata, is_partial_track"
      )
      .eq("user_id", userId)
      .eq("is_draft", false)
      .gte("started_at", since)
      .order("started_at", { ascending: true }),
    // The two-tier race-prediction engine's own answer. The brief says to
    // consume it through a thin adapter rather than reimplement it; this is
    // the adapter. It is built from every logged session, so it knows an
    // athlete's 5k even when no maximal effort falls inside our window.
    supabase
      .from("predicted_benchmarks")
      .select("benchmark_seconds")
      .eq("user_id", userId)
      .eq("sport", "run")
      .maybeSingle(),
  ]);

  const activities = (activityRows ?? []) as unknown as (ActivityRow & { id: string })[];

  // Lift sets come through the activity join rather than a second scan of the
  // whole table — gym_exercises has no user_id of its own.
  const gymActivityIds = activities.filter((a) => a.sport === "gym").map((a) => a.id);
  const { data: exerciseRows } =
    gymActivityIds.length > 0
      ? await supabase
          .from("gym_exercises")
          .select("activity_id, exercise_name, weight_kg, sets, reps, rpe, set_details, estimated_1rm_kg")
          .in("activity_id", gymActivityIds)
      : { data: [] as Record<string, unknown>[] };

  const startedAtById = new Map(activities.map((a) => [a.id, a.started_at]));
  const gymRows: GymExerciseRow[] = (exerciseRows ?? [])
    .map((row): GymExerciseRow | null => {
      const r = row as Record<string, unknown>;
      const startedAt = startedAtById.get(r.activity_id as string);
      if (!startedAt) return null;
      return {
        started_at: startedAt,
        exercise_name: r.exercise_name as string,
        weight_kg: Number(r.weight_kg ?? 0),
        sets: Number(r.sets ?? 1),
        reps: Number(r.reps ?? 0),
        rpe: r.rpe != null ? Number(r.rpe) : null,
        set_details: (r.set_details as GymExerciseRow["set_details"]) ?? null,
      };
    })
    .filter((r): r is GymExerciseRow => r !== null);

  const runs = ingestRuns(activities);
  // Rowing, cycling, the ski erg. Aerobic volume that cannot inform running
  // pace but is unambiguously training — see ingestCrossTraining.
  const crossTraining = ingestCrossTraining(activities, HISTORY_WEEKS);
  const sets = ingestLiftSets(gymRows);
  // Cross-training alone is enough to diagnose from. Returning null here was
  // reporting an athlete who rows four times a week as having no history at
  // all.
  if (runs.length === 0 && sets.length === 0 && crossTraining.sessionCount === 0) return null;

  // Best logged estimated 1RM per competition lift — the SRI engine's own
  // number, consumed through this adapter rather than recomputed here.
  const oneRms: Record<string, number> = {};
  for (const row of exerciseRows ?? []) {
    const r = row as Record<string, unknown>;
    const estimate = r.estimated_1rm_kg != null ? Number(r.estimated_1rm_kg) : 0;
    if (estimate <= 0) continue;
    const lift = normaliseForOneRm(r.exercise_name as string);
    if (!lift) continue;
    oneRms[lift] = Math.max(oneRms[lift] ?? 0, estimate);
  }

  const age =
    ageFromDateOfBirth((profileRow?.date_of_birth as string | null) ?? null) ??
    (profileRow?.age as number | null) ??
    30;

  const { hrRest, hrMax, hrMaxSource, restingAssumed } = resolveHeartRates(
    (profileRow?.resting_hr as number | null) ?? null,
    (profileRow?.max_hr as number | null) ?? null,
    activities,
    age
  );

  const assumptions: string[] = [];
  if (crossTraining.sessionCount > 0 && runs.length === 0) {
    assumptions.push(
      `Your aerobic volume comes entirely from ${crossTraining.sports.join(", ")} — ${Math.round(crossTraining.minPerWeek)} ` +
        `min/week. That counts as your base, but pace, easy-effort bands and your fatigue-resistance profile can only ` +
        `be fitted on running, so those stay population estimates until you log some.`
    );
  } else if (crossTraining.sessionCount > 0) {
    assumptions.push(
      `${Math.round(crossTraining.minPerWeek)} min/week of ${crossTraining.sports.join(", ")} is counted toward your ` +
        `aerobic volume. Pace-derived numbers are still fitted on your running alone, which is the only modality ` +
        `they are meaningful in.`
    );
  }
  if (restingAssumed) {
    assumptions.push(
      "Resting heart rate was assumed rather than measured — the easy-effort band widens because of it. " +
        "Measuring it on waking for three mornings will narrow the band to your own physiology."
    );
  }
  if (hrMaxSource === "estimated") {
    assumptions.push(
      "Maximum heart rate is age-estimated, not measured. Every heart-rate band below inherits that estimate; " +
        "a logged maximal effort replaces it with your own number."
    );
  }

  const profile = diagnose(runs, sets, oneRms, {
    priority: options.priority,
    hrMax,
    hrRest,
    hrMaxSource,
    crossTrainingMinPerWeek: crossTraining.minPerWeek,
    crossTrainingKmPerWeek: crossTraining.kmPerWeek,
    crossTrainingSessions: crossTraining.sessionCount,
    predicted5kFallbackS:
      benchmarkRow?.benchmark_seconds != null ? Number(benchmarkRow.benchmark_seconds) : null,
  });

  // ---- persistence and the four-weekly re-run ----------------------------
  const previous = await loadLatestStoredProfile(supabase, userId);
  const rerun = evaluateRerun(previous, profile);

  let profileId: string | null = previous?.id ?? null;
  let findingIds = new Map<FindingId, string>();

  const shouldWrite =
    options.persist !== false &&
    profile.tier > 0 &&
    (previous === null || rerun.due || rerun.drift?.shouldRegenerate === true ||
      previous.constantsVersion !== profile.constantsVersion);

  if (shouldWrite) {
    const saved = await saveProfile(supabase, userId, profile);
    if (saved) {
      profileId = saved.profileId;
      findingIds = saved.findingIds;
    }
  } else if (previous) {
    // Reuse the stored run's findings rather than rewriting an identical
    // diagnosis — the plan still needs the ids to attach its sessions to.
    const { data: rows } = await supabase
      .from("hpe_findings")
      .select("id, finding_key")
      .eq("profile_id", previous.id);
    for (const row of rows ?? []) findingIds.set(row.finding_key as FindingId, row.id as string);
  }

  if (rerun.shouldRegenerate && rerun.explanations.length > 0) {
    assumptions.push(...rerun.explanations);
  }

  return {
    profile,
    loggedWeeklyRunMinutes: loggedWeeklyRunMinutes(activities),
    assumptions,
    profileId,
    findingIds,
    rerun,
  };
}

/** Only the three competition lifts carry a norm ratio and a rep-profile verdict; everything else is accessory work the strength diagnostic does not reason about. */
function normaliseForOneRm(exerciseName: string): string | null {
  const name = exerciseName.trim().toLowerCase();
  if (name.includes("squat")) return "squat";
  if (name.includes("bench")) return "bench";
  if (name.includes("deadlift")) return "deadlift";
  return null;
}
