import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildTrainingPlan, type TrainingGoalInput } from "@/lib/scoring/training-plan";
import { BENCHMARK_DISTANCE_METERS, type BenchmarkSport } from "@/lib/scoring/cardio-benchmarks";

const BENCHMARK_SPORTS = Object.keys(BENCHMARK_DISTANCE_METERS) as BenchmarkSport[];

const BENCHMARK_LABELS: Record<BenchmarkSport, string> = {
  run: "5K run",
  walk: "Walk pace (2.5K)",
  row: "2K row",
  swim: "400m swim",
  cycle: "20K cycle",
  ski: "2K SkiErg",
};

const DEFAULT_WEEKLY_CAPACITY = 5;
const MIN_TARGET_SECONDS = 30;
const MAX_TARGET_SECONDS = 6 * 60 * 60;
const MIN_TARGET_KG = 1;
const MAX_TARGET_KG = 500;

/**
 * Goal-driven hybrid training plan (user feedback, see training-plan.ts's
 * own doc comment). "Current value" is read straight off infrastructure
 * that already exists elsewhere in the app rather than recomputed here:
 * predicted_benchmarks for cardio (the same per-sport prediction memory
 * Stored Predictions/the dashboard's 5K tile already use), and the
 * all-time best estimated 1RM per exercise for gym (the same source
 * calculateOverallDotsGl and the Lab page's own DOTS/GL card use) — so a
 * goal's progress can never disagree with what the rest of the app already
 * says this athlete's current fitness is.
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
  const weeklyCapacity = Math.max(
    1,
    Math.min(21, Number(searchParams.get("capacity")) || DEFAULT_WEEKLY_CAPACITY)
  );

  const [{ data: goalRows }, { data: benchmarks }, { data: gymActivities }] = await Promise.all([
    supabase
      .from("training_goals")
      .select("id, goal_type, target_key, target_value, achieved_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true }),
    supabase
      .from("predicted_benchmarks")
      .select("sport, benchmark_seconds")
      .eq("user_id", user.id),
    supabase
      .from("activities")
      .select("id")
      .eq("user_id", user.id)
      .eq("sport", "gym")
      .eq("is_draft", false),
  ]);

  const benchmarkBySport = new Map(
    (benchmarks ?? []).map((b) => [b.sport as string, b.benchmark_seconds as number])
  );

  const gymActivityIds = (gymActivities ?? []).map((a) => a.id as string);
  const { data: gymExercises } =
    gymActivityIds.length > 0
      ? await supabase
          .from("gym_exercises")
          .select("exercise_name, estimated_1rm_kg")
          .in("activity_id", gymActivityIds)
      : { data: [] as { exercise_name: string; estimated_1rm_kg: number | null }[] };

  const bestByExercise = new Map<string, number>();
  for (const ex of gymExercises ?? []) {
    const name = ex.exercise_name as string;
    const value = (ex.estimated_1rm_kg as number | null) ?? 0;
    if (value > (bestByExercise.get(name) ?? 0)) bestByExercise.set(name, value);
  }

  // "Achieved" is recomputed live from current data on every request, not
  // trusted from the stored achieved_at flag — a benchmark can regress
  // after a goal was met, and a stale flag would keep showing a goal as
  // done when it no longer is. achieved_at exists for future use
  // (notifications/history), not read here.
  const inputs: TrainingGoalInput[] = (goalRows ?? []).map((row) => {
    const goalType = row.goal_type as "cardio" | "gym";
    const targetKey = row.target_key as string;
    const currentValue =
      goalType === "cardio" ? (benchmarkBySport.get(targetKey) ?? null) : (bestByExercise.get(targetKey) ?? null);
    return {
      id: row.id as string,
      goalType,
      targetKey,
      targetValue: row.target_value as number,
      currentValue,
      label: goalType === "cardio" ? (BENCHMARK_LABELS[targetKey as BenchmarkSport] ?? targetKey) : targetKey,
    };
  });

  const plan = buildTrainingPlan(inputs, weeklyCapacity);

  return NextResponse.json({ goals: plan, weeklyCapacity, benchmarkOptions: BENCHMARK_SPORTS.map((s) => ({ value: s, label: BENCHMARK_LABELS[s] })) });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const goalType = body.goalType === "gym" ? "gym" : body.goalType === "cardio" ? "cardio" : null;
  if (!goalType) {
    return NextResponse.json({ error: "goalType must be 'cardio' or 'gym'" }, { status: 400 });
  }

  const targetKey = String(body.targetKey ?? "").trim();
  if (!targetKey) {
    return NextResponse.json({ error: "targetKey is required" }, { status: 400 });
  }
  if (goalType === "cardio" && !BENCHMARK_SPORTS.includes(targetKey as BenchmarkSport)) {
    return NextResponse.json({ error: "Unrecognized cardio sport" }, { status: 400 });
  }

  const targetValue = Number(body.targetValue);
  if (goalType === "cardio") {
    if (!Number.isFinite(targetValue) || targetValue < MIN_TARGET_SECONDS || targetValue > MAX_TARGET_SECONDS) {
      return NextResponse.json({ error: "Target time must be a realistic duration" }, { status: 400 });
    }
  } else if (!Number.isFinite(targetValue) || targetValue < MIN_TARGET_KG || targetValue > MAX_TARGET_KG) {
    return NextResponse.json({ error: "Target weight must be a realistic value in kg" }, { status: 400 });
  }

  const { data: goal, error } = await supabase
    .from("training_goals")
    .upsert(
      { user_id: user.id, goal_type: goalType, target_key: targetKey, target_value: targetValue, achieved_at: null },
      { onConflict: "user_id,goal_type,target_key" }
    )
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ goal });
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const { error } = await supabase.from("training_goals").delete().eq("id", id).eq("user_id", user.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
