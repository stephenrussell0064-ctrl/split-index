import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { activityToFormState } from "@/lib/activities/db-form";
import type { SportType } from "@/types";

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

  if (!sport) {
    return NextResponse.json({ error: "sport query param required" }, { status: 400 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("weight_kg")
    .eq("user_id", user.id)
    .single();

  const { data: activity } = await supabase
    .from("activities")
    .select("*")
    .eq("user_id", user.id)
    .eq("sport", sport)
    .eq("is_draft", false)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!activity) {
    return NextResponse.json({ found: false });
  }

  let exercises: Parameters<typeof activityToFormState>[1] = [];
  if (sport === "gym") {
    const { data: exRows } = await supabase
      .from("gym_exercises")
      .select("*")
      .eq("activity_id", activity.id)
      .order("order_index");
    exercises = exRows ?? [];
  }

  const formState = activityToFormState(activity, exercises, profile?.weight_kg);

  return NextResponse.json({
    found: true,
    activityId: activity.id,
    sport,
    formState,
    title: activity.title,
    startedAt: activity.started_at,
  });
}
