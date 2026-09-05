import type { createClient } from "@/lib/supabase/server";
import type { GymExerciseInput } from "@/types";
import { bestSet, summarizeSets } from "@/lib/activities/gym-sets";
import { computeExercise1RM } from "@/lib/scoring/service";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/** The shape PostgREST hands back on a failed write — only the fields we branch on. */
type WriteError = { message: string; code?: string } | null;

/**
 * Columns that exist because an ADDITIVE migration added them, and which the
 * session is still worth saving without.
 *
 * `attachment` (migration 028) is the attachment id for cable/machine work —
 * rope vs straight bar on a pushdown. That migration's own contract is
 * "additive/nullable — existing rows and any code not yet updated keep
 * working", and scoring already treats a missing attachment as no adjustment
 * (resolveAttachmentMultiplierByKey). Losing it costs one scoring refinement
 * on one exercise. It must never cost the workout.
 *
 * `set_details` is deliberately NOT in this list even though migration 009 was
 * equally additive: it carries the real measurement for timed holds and
 * carries (a plank's duration_seconds), so dropping it would silently score a
 * 60-second plank as a 0 kg single rep. A database missing THAT column should
 * fail the write loudly and be fixed, not quietly mis-score the athlete.
 */
const DEGRADABLE_COLUMNS = ["attachment"] as const;

type DegradableColumn = (typeof DEGRADABLE_COLUMNS)[number];

export interface GymExerciseRow {
  activity_id: string;
  exercise_name: string;
  muscle_group: string;
  weight_kg: number;
  sets: number;
  reps: number;
  rpe: number | null;
  set_details: GymExerciseInput["sets"];
  estimated_1rm_kg: number;
  order_index: number;
  attachment: string | null;
}

/**
 * The flat `gym_exercises` row for each submitted exercise.
 *
 * weight_kg/sets/reps/rpe are the best-set summary kept in sync for anything
 * reading the flat columns directly; the full per-set breakdown rides along in
 * set_details. Shared by the create (POST) and edit (PATCH) paths so the two
 * can never drift apart in what they persist.
 */
export function buildGymExerciseRows(
  activityId: string,
  exercises: GymExerciseInput[]
): GymExerciseRow[] {
  return exercises.map((ex, i) => {
    const summary = summarizeSets(ex.sets);
    const top = bestSet(ex.sets);
    return {
      activity_id: activityId,
      exercise_name: ex.exercise_name,
      muscle_group: ex.muscle_group,
      weight_kg: summary.weight_kg,
      sets: summary.sets,
      reps: summary.reps,
      rpe: summary.rpe,
      set_details: ex.sets,
      estimated_1rm_kg: top ? computeExercise1RM(top.weight_kg, top.reps) : 0,
      order_index: i,
      attachment: ex.attachment ?? null,
    };
  });
}

/**
 * Does this error say the table has no such column?
 *
 * PostgREST reports an unknown column on a WRITE as PGRST204 ("Could not find
 * the 'attachment' column of 'gym_exercises' in the schema cache") and on a
 * READ as Postgres' own 42703 ("column gym_exercises.attachment does not
 * exist"). Both shapes are matched, and the message is checked too, because
 * which one comes back depends on the PostgREST version in front of the
 * database rather than on anything this code controls.
 */
function missingColumn(error: WriteError, candidates: readonly string[]): string | null {
  if (!error) return null;
  const code = error.code ?? "";
  const message = error.message ?? "";
  const looksLikeMissingColumn =
    code === "PGRST204" ||
    code === "42703" ||
    /schema cache|does not exist/i.test(message);
  if (!looksLikeMissingColumn) return null;
  return candidates.find((column) => new RegExp(`\\b${column}\\b`).test(message)) ?? null;
}

/**
 * Insert the exercises for a gym session, surviving a database that is behind
 * on an additive migration.
 *
 * WHY THIS RETRIES RATHER THAN JUST REPORTING. `gym_exercises` is the primary
 * write of a gym session — an activity without it is a workout with no
 * exercises — so the create path rightly unwinds the whole session when it
 * fails. That makes every column in this insert load-bearing, including the
 * ones added later for optional features. A database missing one additive,
 * nullable column therefore took down gym logging ENTIRELY: PostgREST rejects
 * the whole statement for an unknown column, the compensating delete ran, and
 * the athlete was told, truthfully, that nothing was recorded. One unapplied
 * migration, no gym workouts.
 *
 * The invariant that was missing is that a feature column must not be able to
 * cost the athlete the session that feature decorates. So an unknown-column
 * failure naming a degradable column drops that column and retries once per
 * column; anything else is returned unchanged for the caller to handle as the
 * real failure it is. The drop is reported back (never swallowed) so the
 * caller can log which column the database is missing — that log is what tells
 * an operator to apply the migration, and it is the only cost of doing so.
 */
export async function insertGymExercises(
  supabase: SupabaseServerClient,
  rows: GymExerciseRow[]
): Promise<{ error: WriteError; droppedColumns: DegradableColumn[] }> {
  let payload: Record<string, unknown>[] = rows.map((row) => ({ ...row }));
  const droppedColumns: DegradableColumn[] = [];

  // At most one attempt per degradable column, plus the first — a bounded
  // loop, so a database missing several of them still terminates.
  for (let attempt = 0; attempt <= DEGRADABLE_COLUMNS.length; attempt++) {
    const { error } = await supabase.from("gym_exercises").insert(payload);
    if (!error) return { error: null, droppedColumns };

    const remaining = DEGRADABLE_COLUMNS.filter((c) => !droppedColumns.includes(c));
    const absent = missingColumn(error, remaining) as DegradableColumn | null;
    if (!absent) return { error, droppedColumns };

    droppedColumns.push(absent);
    payload = payload.map((row) => {
      const rest = { ...row };
      delete rest[absent];
      return rest;
    });
  }

  return { error: null, droppedColumns };
}
