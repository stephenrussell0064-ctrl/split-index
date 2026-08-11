import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * User feedback: "When logging exercises in the lab, it should inform you
 * of your previous weight and reps on this exercise as well as your
 * personal record on this exercise." Backs a small inline hint on the Lab's
 * exercise row (gym-form.tsx) — fetched per exercise name as it's picked,
 * not bundled into the whole workout form's initial load, since most
 * workouts only touch a handful of exercises out of the full catalog.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const name = searchParams.get("name")?.trim();
  if (!name) {
    return NextResponse.json({ error: "name query param is required" }, { status: 400 });
  }

  const { data: activities } = await supabase
    .from("activities")
    .select("id, started_at")
    .eq("user_id", user.id)
    .eq("sport", "gym")
    .eq("is_draft", false);

  if (!activities || activities.length === 0) {
    return NextResponse.json({ lastSet: null, personalRecord: null });
  }

  const startedAtByActivity = new Map(activities.map((a) => [a.id as string, a.started_at as string]));
  const activityIds = activities.map((a) => a.id as string);

  const { data: exRows } = await supabase
    .from("gym_exercises")
    .select("activity_id, weight_kg, reps, sets, estimated_1rm_kg")
    .in("activity_id", activityIds)
    .eq("exercise_name", name);

  if (!exRows || exRows.length === 0) {
    return NextResponse.json({ lastSet: null, personalRecord: null });
  }

  const withDates = exRows
    .map((r) => ({
      weightKg: r.weight_kg as number,
      reps: r.reps as number,
      sets: r.sets as number,
      estimated1RMKg: (r.estimated_1rm_kg as number | null) ?? null,
      startedAt: startedAtByActivity.get(r.activity_id as string) ?? "",
    }))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));

  const lastSet = withDates[0];
  const personalRecord = withDates.reduce<(typeof withDates)[number] | null>((best, row) => {
    if (row.estimated1RMKg == null) return best;
    if (!best || row.estimated1RMKg > (best.estimated1RMKg ?? 0)) return row;
    return best;
  }, null);

  return NextResponse.json({
    lastSet: {
      weightKg: lastSet.weightKg,
      reps: lastSet.reps,
      sets: lastSet.sets,
      startedAt: lastSet.startedAt,
    },
    personalRecord: personalRecord
      ? {
          weightKg: personalRecord.weightKg,
          reps: personalRecord.reps,
          estimated1RMKg: personalRecord.estimated1RMKg,
          startedAt: personalRecord.startedAt,
        }
      : null,
  });
}
