import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * The exercises this athlete has actually logged, for the intake's per-day
 * exercise picker.
 *
 * The alternative was the full catalogue, and the full catalogue is 186 items.
 * Asking someone to build a push day out of 186 options is not a choice, it is
 * a chore, and the answer they give after scrolling that far is worse than the
 * one the engine would have picked for them. What they have actually done is a
 * far better seed: it is short, it is theirs, and every entry is something they
 * already know they can perform in the gym they actually go to.
 *
 * Ordered by how often they have logged it, because frequency is the honest
 * proxy for "this is one of my exercises" — a bench press logged forty times
 * belongs at the top of a push day and a curiosity tried once does not.
 *
 * `lastLoggedAt` rides along so the picker can say "3 weeks ago" next to an
 * exercise the athlete has drifted away from, rather than presenting a stale
 * list as though it were current.
 */

/** Enough to build a week from without becoming the catalogue again. */
const MAX_EXERCISES = 60;
/** Sessions scanned. Matches the window `exercise-history.ts` uses for the adaptive 1RM. */
const MAX_SESSIONS = 200;

export interface LoggedExerciseSummary {
  name: string;
  /** How many logged entries this exercise has. Drives the ordering. */
  count: number;
  lastLoggedAt: string;
  /** Heaviest logged working weight, so the picker can show it without a second round-trip. */
  bestWeightKg: number | null;
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: activities } = await supabase
    .from("activities")
    .select("id, started_at")
    .eq("user_id", user.id)
    .eq("sport", "gym")
    .eq("is_draft", false)
    .order("started_at", { ascending: false })
    .limit(MAX_SESSIONS);

  if (!activities || activities.length === 0) {
    // A real, meaningful empty: this athlete has logged no gym work, so there
    // is nothing to seed from and the UI says so rather than falling back to
    // the catalogue it was written to avoid.
    return NextResponse.json({ exercises: [] as LoggedExerciseSummary[] });
  }

  const startedAtByActivity = new Map(activities.map((a) => [a.id as string, a.started_at as string]));

  const { data: rows } = await supabase
    .from("gym_exercises")
    .select("exercise_name, weight_kg, activity_id")
    .in(
      "activity_id",
      activities.map((a) => a.id)
    );

  // Grouped case-insensitively but DISPLAYED in the casing the athlete used
  // most recently — the names are theirs and re-casing them makes the list
  // read as somebody else's.
  const byKey = new Map<string, LoggedExerciseSummary>();
  for (const row of rows ?? []) {
    const raw = String(row.exercise_name ?? "").trim();
    if (raw.length === 0) continue;
    const key = raw.toLowerCase();
    const startedAt = startedAtByActivity.get(row.activity_id as string);
    if (!startedAt) continue;
    const weight = row.weight_kg != null ? Number(row.weight_kg) : null;

    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { name: raw, count: 1, lastLoggedAt: startedAt, bestWeightKg: weight });
      continue;
    }
    existing.count += 1;
    if (startedAt > existing.lastLoggedAt) {
      existing.lastLoggedAt = startedAt;
      existing.name = raw;
    }
    if (weight != null && (existing.bestWeightKg == null || weight > existing.bestWeightKg)) {
      existing.bestWeightKg = weight;
    }
  }

  const exercises = [...byKey.values()]
    .sort((a, b) => b.count - a.count || b.lastLoggedAt.localeCompare(a.lastLoggedAt))
    .slice(0, MAX_EXERCISES);

  return NextResponse.json({ exercises });
}
