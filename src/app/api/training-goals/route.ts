import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildTrainingPlan, type TrainingGoalInput } from "@/lib/scoring/training-plan";
import { BENCHMARK_DISTANCE_METERS, type BenchmarkSport } from "@/lib/scoring/cardio-benchmarks";
import { isPremiumUser } from "@/lib/retention/trial";
import {
  MAX_FREE_TRAINING_GOALS,
  MAX_FREE_WEEKLY_CAPACITY,
  MAX_PREMIUM_WEEKLY_CAPACITY,
} from "@/lib/premium/features";

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
const MAX_TARGET_DATE_DAYS_OUT = 3 * 365;
const DAY_MS = 86_400_000;

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
 *
 * Premium gating (user feedback: "Make this part of the premium feature
 * and they can get a small training plan trial but they won't benefit
 * properly unless they have premium"): free accounts can run the whole
 * wizard and see it genuinely work, capped to MAX_FREE_TRAINING_GOALS goal
 * and MAX_FREE_WEEKLY_CAPACITY sessions/week — enough to prove the concept,
 * not enough to get the actual point of the feature (balancing several
 * competing goals against each other).
 *
 * Stage 2 (user feedback: "move on and scope for this" after the Stage 1
 * curated-session-content rework): an optional target_date per goal drives
 * tapering in the generated session content (training-session-content.ts)
 * and a feasibility heads-up in buildTrainingPlan — both computed from
 * daysUntilTarget, derived here from "today" server-side so it's never off
 * by a client clock.
 */
async function loadPremiumStatus(supabase: Awaited<ReturnType<typeof createClient>>, userId: string) {
  const { data: profile } = await supabase
    .from("profiles")
    .select("subscription_tier, subscription_status")
    .eq("user_id", userId)
    .single();
  return isPremiumUser(profile?.subscription_tier ?? "free", profile?.subscription_status ?? null);
}

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const target = new Date(`${dateStr}T00:00:00Z`).getTime();
  if (Number.isNaN(target)) return null;
  const today = new Date();
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.round((target - todayUtc) / DAY_MS);
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const premium = await loadPremiumStatus(supabase, user.id);
  const maxWeeklyCapacity = premium ? MAX_PREMIUM_WEEKLY_CAPACITY : MAX_FREE_WEEKLY_CAPACITY;

  const { searchParams } = new URL(request.url);
  const weeklyCapacity = Math.max(
    1,
    Math.min(maxWeeklyCapacity, Number(searchParams.get("capacity")) || DEFAULT_WEEKLY_CAPACITY)
  );

  const [{ data: goalRows }, { data: benchmarks }, { data: gymActivities }] = await Promise.all([
    supabase
      .from("training_goals")
      .select("id, goal_type, target_key, target_value, target_date, achieved_at")
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
  const allGoalRows = goalRows ?? [];
  // Free accounts keep every goal they already saved (never silently drop
  // data if someone's subscription lapses) but the PLAN itself — the
  // prioritized weekly breakdown — only ever balances across the first
  // MAX_FREE_TRAINING_GOALS of them; the rest still show in the list as
  // locked, not just vanish, so it's obvious what upgrading unlocks rather
  // than looking like data loss.
  const rankedRows = premium ? allGoalRows : allGoalRows.slice(0, MAX_FREE_TRAINING_GOALS);
  const lockedRows = premium ? [] : allGoalRows.slice(MAX_FREE_TRAINING_GOALS);

  function toInput(row: (typeof allGoalRows)[number]): TrainingGoalInput & { targetDate: string | null } {
    const goalType = row.goal_type as "cardio" | "gym";
    const targetKey = row.target_key as string;
    const targetDate = (row.target_date as string | null) ?? null;
    const currentValue =
      goalType === "cardio" ? (benchmarkBySport.get(targetKey) ?? null) : (bestByExercise.get(targetKey) ?? null);
    return {
      id: row.id as string,
      goalType,
      targetKey,
      targetValue: row.target_value as number,
      currentValue,
      label: goalType === "cardio" ? (BENCHMARK_LABELS[targetKey as BenchmarkSport] ?? targetKey) : targetKey,
      daysUntilTarget: daysUntil(targetDate),
      targetDate,
    };
  }

  const plan = buildTrainingPlan(rankedRows.map(toInput), weeklyCapacity);
  const locked = lockedRows.map((row) => {
    const input = toInput(row);
    return { ...input, gapFraction: 0, achieved: false, weight: 0, weeklySessions: 0, feasibility: { feasible: true, message: null } };
  });

  return NextResponse.json({
    goals: plan,
    lockedGoals: locked,
    weeklyCapacity,
    maxWeeklyCapacity,
    premium,
    maxFreeGoals: MAX_FREE_TRAINING_GOALS,
    totalGoalCount: allGoalRows.length,
    benchmarkOptions: BENCHMARK_SPORTS.map((s) => ({
      value: s,
      label: BENCHMARK_LABELS[s],
      distanceMeters: BENCHMARK_DISTANCE_METERS[s],
      currentSeconds: benchmarkBySport.get(s) ?? null,
    })),
  });
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

  // Optional deadline (Stage 2). Empty string / not provided => no
  // deadline, clears any previously-set one on a resave.
  let targetDate: string | null = null;
  if (body.targetDate) {
    const days = daysUntil(String(body.targetDate));
    if (days === null) {
      return NextResponse.json({ error: "Target date is invalid" }, { status: 400 });
    }
    if (days < 0) {
      return NextResponse.json({ error: "Target date must be in the future" }, { status: 400 });
    }
    if (days > MAX_TARGET_DATE_DAYS_OUT) {
      return NextResponse.json({ error: "Target date is too far out" }, { status: 400 });
    }
    targetDate = String(body.targetDate);
  }

  // No premium check here on purpose — free accounts can set up as many
  // goals as they want (never a hard block mid-wizard, never data loss if a
  // subscription lapses). The cap lives entirely in GET: only the first
  // MAX_FREE_TRAINING_GOALS (by creation order) actually feed the balanced
  // weekly plan for a free account; the rest come back as `lockedGoals` for
  // the UI to show behind a Premium upsell instead of just vanishing.
  const { data: goal, error } = await supabase
    .from("training_goals")
    .upsert(
      {
        user_id: user.id,
        goal_type: goalType,
        target_key: targetKey,
        target_value: targetValue,
        target_date: targetDate,
        achieved_at: null,
      },
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
