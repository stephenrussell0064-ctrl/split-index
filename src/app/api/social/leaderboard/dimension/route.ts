import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  fetchActivityLeaderboard,
  fetchExerciseLeaderboard,
  fetchMuscleGroupLeaderboard,
} from "@/lib/social/dimension-leaderboards";
import type { SportType } from "@/types";

const VALID_TYPES = new Set(["exercise", "muscleGroup", "activity"]);

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type") ?? "";
  const value = searchParams.get("value") ?? "";

  if (!VALID_TYPES.has(type) || !value) {
    return NextResponse.json({ error: "Missing or invalid type/value" }, { status: 400 });
  }

  const rows =
    type === "exercise"
      ? await fetchExerciseLeaderboard(supabase, value)
      : type === "muscleGroup"
        ? await fetchMuscleGroupLeaderboard(supabase, value)
        : await fetchActivityLeaderboard(supabase, value as SportType);

  return NextResponse.json({ rows });
}
