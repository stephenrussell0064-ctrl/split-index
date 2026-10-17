import type { GymExercise, GymExerciseSet } from "@/types";

/** Epley estimate: weight × (1 + reps / 30). Matches the client-side preview in form-state.ts. */
function epley1RM(weightKg: number, reps: number): number {
  if (weightKg <= 0 || reps <= 0) return 0;
  return weightKg * (1 + reps / 30);
}

/**
 * How a set ranks against its siblings when picking the exercise's best.
 *
 * Mirrors bestSetRow() in components/activities/form-state.ts exactly. A
 * bodyweight-only set (pull-ups, dips, push-ups with nothing added) has
 * weight_kg 0, so Epley is 0 for every one of them; ranking on that alone
 * returned `sets[0]` — the FIRST set — while the Lab's picker fell back to
 * reps and chose the highest-rep set. Same session, two different sets
 * scored, two different numbers (owner, 17 Oct 2026: "Why is the score in
 * the logbook different to the score i see next to each set in the lab").
 */
function setRank(s: GymExerciseSet): number {
  const estimate = epley1RM(s.weight_kg, s.reps);
  return estimate > 0 ? estimate : s.reps;
}

/** The set with the highest estimated 1RM — representative of the exercise's peak effort that session. */
export function bestSet(sets: GymExerciseSet[]): GymExerciseSet | null {
  if (sets.length === 0) return null;
  let best = sets[0];
  let bestEstimate = setRank(best);
  for (const s of sets.slice(1)) {
    const estimate = setRank(s);
    if (estimate > bestEstimate) {
      best = s;
      bestEstimate = estimate;
    }
  }
  return best;
}

/** Flat weight_kg/sets/reps/rpe columns, kept in sync for backward compatibility with anything reading them directly. */
export function summarizeSets(sets: GymExerciseSet[]): {
  weight_kg: number;
  sets: number;
  reps: number;
  rpe: number | null;
} {
  const best = bestSet(sets);
  return {
    weight_kg: best?.weight_kg ?? 0,
    sets: sets.length,
    reps: best?.reps ?? 0,
    rpe: best?.rpe ?? null,
  };
}

export function totalVolumeKg(sets: GymExerciseSet[]): number {
  return sets.reduce((sum, s) => sum + s.weight_kg * s.reps, 0);
}

/** Rows logged before set_details existed only have the flat summary — expand it into `sets` identical entries so editing/rescoring behaves the same as before. */
export function expandLegacySets(row: {
  weight_kg: number;
  sets: number;
  reps: number;
  rpe: number | null;
}): GymExerciseSet[] {
  return Array.from({ length: Math.max(1, row.sets) }, () => ({
    weight_kg: row.weight_kg,
    reps: row.reps,
    rpe: row.rpe,
  }));
}

/** Resolve the real per-set array for a DB row, falling back to expanding the legacy flat columns. */
export function setsForExercise(
  row: Pick<GymExercise, "set_details" | "weight_kg" | "sets" | "reps" | "rpe">
): GymExerciseSet[] {
  if (row.set_details && row.set_details.length > 0) return row.set_details;
  return expandLegacySets(row);
}
