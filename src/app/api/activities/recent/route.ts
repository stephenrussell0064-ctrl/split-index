import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { activityToFormState } from "@/lib/activities/db-form";
import type { SportType } from "@/types";

const DEFAULT_LIMIT = 8;

/**
 * Backs the Lab's "start from a past workout" picker — browse actual logged
 * sessions (not a pre-saved named template) and load one as an editable
 * starting point. Same underlying formState shape "Repeat last" used, just
 * offering a choice of which past session instead of always the most recent.
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
  const sport = searchParams.get("sport") as SportType | null;
  const limit = Math.min(Number(searchParams.get("limit")) || DEFAULT_LIMIT, 20);

  if (!sport) {
    return NextResponse.json({ error: "sport query param required" }, { status: 400 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("weight_kg")
    .eq("user_id", user.id)
    .single();

  const { data: activities } = await supabase
    .from("activities")
    .select("*")
    .eq("user_id", user.id)
    .eq("sport", sport)
    .eq("is_draft", false)
    .order("started_at", { ascending: false })
    .limit(limit);

  if (!activities || activities.length === 0) {
    return NextResponse.json({ workouts: [] });
  }

  const activityIds = activities.map((a) => a.id);
  const exercisesByActivity = new Map<string, Parameters<typeof activityToFormState>[1]>();

  if (sport === "gym") {
    const { data: exRows } = await supabase
      .from("gym_exercises")
      .select("*")
      .in("activity_id", activityIds)
      .order("order_index");

    for (const row of exRows ?? []) {
      const bucket = exercisesByActivity.get(row.activity_id) ?? [];
      bucket.push(row);
      exercisesByActivity.set(row.activity_id, bucket);
    }
  }

  const workouts = activities.map((activity) => {
    const exercises = exercisesByActivity.get(activity.id) ?? [];
    return {
      activityId: activity.id,
      startedAt: activity.started_at,
      title: activity.title,
      // Exercise names give the picker something recognizable at a glance
      // ("Squat, Bench, Row" vs. just a bare date) without fetching every
      // set's detail up front.
      exerciseNames: exercises.map((e) => e.exercise_name),
      formState: activityToFormState(activity, exercises, profile?.weight_kg),
    };
  });

  return NextResponse.json({ workouts });
}
