/**
 * Personal records — user feedback: the `personal_records` table (schema
 * from migration 001) was never actually written to anywhere in the app;
 * it only ever got read from (profile page, analytics page). This module
 * is what's missing: detecting and upserting records at logging time.
 *
 * Metrics tracked, one row per (user, sport, metric) per the table's
 * UNIQUE constraint:
 *  - Endurance sports: `benchmark_time` (this session's Riegel-projected
 *    equivalent at the sport's benchmark distance, lower is better —
 *    "your fastest proven {benchmark distance}"), `longest_distance`
 *    (meters, higher is better), `longest_duration` (seconds, higher is
 *    better).
 *  - Gym: one row per exercise, metric = normalized exercise name, value =
 *    best estimated 1RM ever recorded (kg, higher is better).
 *
 * Create/edit routes upsert incrementally (only when a new session beats
 * the existing record) — this can't detect a record becoming invalid after
 * an edit lowers what used to be the record-holding session, so recompute
 * does a full rebuild from scratch instead (replays all history, so it's
 * always the authoritative source of truth).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SportType } from "@/types";

export type ComparisonDirection = "lower-is-better" | "higher-is-better";

export interface PersonalRecordCandidate {
  sport: SportType;
  metric: string;
  value: number;
  unit: string;
  activityId: string;
  achievedAt: string;
  direction: ComparisonDirection;
}

function isBetter(candidateValue: number, existingValue: number, direction: ComparisonDirection): boolean {
  return direction === "lower-is-better" ? candidateValue < existingValue : candidateValue > existingValue;
}

/**
 * Upserts each candidate only if it beats the currently stored record (or
 * none exists yet) — safe to call on every activity log without
 * accidentally overwriting a genuine best with a worse session.
 */
export async function upsertPersonalRecordsIfBetter(
  supabase: SupabaseClient,
  userId: string,
  candidates: PersonalRecordCandidate[]
): Promise<void> {
  for (const c of candidates) {
    if (!Number.isFinite(c.value) || c.value <= 0) continue;

    const { data: existing } = await supabase
      .from("personal_records")
      .select("value")
      .eq("user_id", userId)
      .eq("sport", c.sport)
      .eq("metric", c.metric)
      .maybeSingle();

    if (existing && !isBetter(c.value, existing.value as number, c.direction)) continue;

    await supabase.from("personal_records").upsert(
      {
        user_id: userId,
        sport: c.sport,
        metric: c.metric,
        value: c.value,
        unit: c.unit,
        activity_id: c.activityId,
        achieved_at: c.achievedAt,
      },
      { onConflict: "user_id,sport,metric" }
    );
  }
}

/** Endurance-sport candidates for a single session — benchmark_time, longest_distance, longest_duration. */
export function enduranceRecordCandidates(input: {
  sport: SportType;
  activityId: string;
  achievedAt: string;
  distanceMeters?: number | null;
  durationSeconds?: number | null;
  benchmarkEquivalentSeconds?: number | null;
}): PersonalRecordCandidate[] {
  const candidates: PersonalRecordCandidate[] = [];
  if (input.benchmarkEquivalentSeconds != null && input.benchmarkEquivalentSeconds > 0) {
    candidates.push({
      sport: input.sport,
      metric: "benchmark_time",
      value: input.benchmarkEquivalentSeconds,
      unit: "seconds",
      activityId: input.activityId,
      achievedAt: input.achievedAt,
      direction: "lower-is-better",
    });
  }
  if (input.distanceMeters != null && input.distanceMeters > 0) {
    candidates.push({
      sport: input.sport,
      metric: "longest_distance",
      value: input.distanceMeters,
      unit: "meters",
      activityId: input.activityId,
      achievedAt: input.achievedAt,
      direction: "higher-is-better",
    });
  }
  if (input.durationSeconds != null && input.durationSeconds > 0) {
    candidates.push({
      sport: input.sport,
      metric: "longest_duration",
      value: input.durationSeconds,
      unit: "seconds",
      activityId: input.activityId,
      achievedAt: input.achievedAt,
      direction: "higher-is-better",
    });
  }
  return candidates;
}

/** Gym candidates for a session's logged exercises — one metric per exercise, best estimated 1RM. */
export function gymRecordCandidates(input: {
  activityId: string;
  achievedAt: string;
  exercises: Array<{ exercise_name: string; estimated_1rm_kg: number }>;
}): PersonalRecordCandidate[] {
  return input.exercises
    .filter((ex) => ex.estimated_1rm_kg > 0)
    .map((ex) => ({
      sport: "gym" as SportType,
      metric: ex.exercise_name,
      value: ex.estimated_1rm_kg,
      unit: "kg",
      activityId: input.activityId,
      achievedAt: input.achievedAt,
      direction: "higher-is-better" as ComparisonDirection,
    }));
}
