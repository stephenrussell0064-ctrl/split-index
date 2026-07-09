import type { createClient } from "@/lib/supabase/server";
import { normalizeName } from "@/lib/scoring/split-strength-engine";
import { setsForExercise } from "@/lib/activities/gym-sets";
import type { LoggedSet } from "@/lib/scoring/split-strength-engine";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Full logged history per exercise (across all of the user's past gym
 * sessions), keyed by normalized exercise name — the premium adaptive 1RM
 * model needs the whole history, not just the current session's sets.
 * `excludeActivityId` lets an edit exclude the activity being edited so its
 * own (about-to-be-overwritten) sets aren't double-counted.
 */
export async function fetchExerciseHistory(
  supabase: Supabase,
  userId: string,
  exerciseNames: string[],
  excludeActivityId?: string
): Promise<Record<string, LoggedSet[]>> {
  const uniqueNames = [...new Set(exerciseNames)];
  if (uniqueNames.length === 0) return {};

  const { data: activities } = await supabase
    .from("activities")
    .select("id, started_at")
    .eq("user_id", userId)
    .eq("sport", "gym")
    .eq("is_draft", false)
    .order("started_at", { ascending: false })
    .limit(200);

  const relevantActivities = (activities ?? []).filter(
    (a) => a.id !== excludeActivityId
  );
  if (relevantActivities.length === 0) return {};

  const startedAtByActivity = new Map(
    relevantActivities.map((a) => [a.id as string, a.started_at as string])
  );

  // Filtered in-memory by normalized name below rather than via `.in()` on
  // exercise_name, since that's a case-sensitive exact match and a custom-
  // typed exercise could have inconsistent casing across sessions.
  const { data: rows } = await supabase
    .from("gym_exercises")
    .select("exercise_name, weight_kg, sets, reps, rpe, set_details, activity_id")
    .in("activity_id", relevantActivities.map((a) => a.id));

  const wantedKeys = new Set(uniqueNames.map(normalizeName));
  const history: Record<string, LoggedSet[]> = {};
  for (const row of rows ?? []) {
    const key = normalizeName(row.exercise_name as string);
    if (!wantedKeys.has(key)) continue;
    const performedAt = startedAtByActivity.get(row.activity_id as string);
    if (!performedAt) continue;
    const sets = setsForExercise(row as Parameters<typeof setsForExercise>[0]);
    const logged = sets.map((s) => ({
      weightKg: s.weight_kg,
      reps: s.reps,
      performedAt,
    }));
    history[key] = [...(history[key] ?? []), ...logged];
  }

  return history;
}
