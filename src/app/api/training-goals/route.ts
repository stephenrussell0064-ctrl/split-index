import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildTrainingPlan, type TrainingGoalInput } from "@/lib/scoring/training-plan";
import { BENCHMARK_DISTANCE_METERS, type BenchmarkSport } from "@/lib/scoring/cardio-benchmarks";
import {
  DISTANCE_LADDER,
  projectToDistance,
  buildCardioTargetKey,
  parseCardioTargetKey,
} from "@/lib/scoring/cardio-custom-distance";
import { isPremiumUser } from "@/lib/retention/trial";
import {
  MAX_FREE_TRAINING_GOALS,
  MAX_FREE_WEEKLY_CAPACITY,
  MAX_PREMIUM_WEEKLY_CAPACITY,
  splitGoalsByPremiumLimit,
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

const SPORT_NOUN: Record<BenchmarkSport, string> = {
  run: "run",
  walk: "walk",
  row: "row",
  swim: "swim",
  cycle: "cycle",
  ski: "SkiErg",
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
 * Stage 2: an optional target_date per goal drives tapering in the
 * generated session content (training-session-content.ts) and a
 * feasibility heads-up in buildTrainingPlan — both computed from
 * daysUntilTarget, derived here from "today" server-side so it's never off
 * by a client clock.
 *
 * Stage 3 (user feedback: "scope both and... make this training plan as
 * sophisticated as possible"): cardio goals can now target any distance in
 * cardio-custom-distance.ts's curated ladder, not just the sport's single
 * canonical benchmark distance — "current value" for a non-canonical
 * distance is Riegel-projected (or linearly scaled for walk) from the
 * athlete's own canonical benchmark time, using their own personalized
 * riegel_k when predicted_benchmarks has one.
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

function distanceLabelFor(sport: BenchmarkSport, meters: number): string {
  const match = DISTANCE_LADDER[sport]?.find((d) => Math.round(d.meters) === Math.round(meters));
  if (match) return match.label;
  return meters >= 1000 ? `${(meters / 1000).toFixed(meters % 1000 === 0 ? 0 : 1)}K` : `${Math.round(meters)}m`;
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
      .select("id, goal_type, target_key, target_value, target_date, target_distance_meters, achieved_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true }),
    supabase
      .from("predicted_benchmarks")
      .select("sport, benchmark_seconds, riegel_k")
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
  const riegelKBySport = new Map(
    (benchmarks ?? []).map((b) => [b.sport as string, (b.riegel_k as number | null) ?? null])
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

  function cardioCurrentValue(sport: BenchmarkSport, distanceMeters: number): number | null {
    const canonicalSeconds = benchmarkBySport.get(sport);
    if (canonicalSeconds == null) return null;
    const canonicalMeters = BENCHMARK_DISTANCE_METERS[sport];
    if (Math.round(distanceMeters) === Math.round(canonicalMeters)) return canonicalSeconds;
    return projectToDistance(sport, canonicalSeconds, canonicalMeters, distanceMeters, riegelKBySport.get(sport) ?? null);
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
  // than looking like data loss. See splitGoalsByPremiumLimit's own tests
  // for the actual gating behavior verification.
  const { included: rankedRows, locked: lockedRows } = splitGoalsByPremiumLimit(
    allGoalRows,
    premium,
    MAX_FREE_TRAINING_GOALS
  );

  function toInput(
    row: (typeof allGoalRows)[number]
  ): TrainingGoalInput & { targetDate: string | null; distanceMeters: number | null; sport: BenchmarkSport | null } {
    const goalType = row.goal_type as "cardio" | "gym";
    const targetKey = row.target_key as string;
    const targetDate = (row.target_date as string | null) ?? null;

    if (goalType === "gym") {
      return {
        id: row.id as string,
        goalType,
        targetKey,
        targetValue: row.target_value as number,
        currentValue: bestByExercise.get(targetKey) ?? null,
        label: targetKey,
        daysUntilTarget: daysUntil(targetDate),
        targetDate,
        distanceMeters: null,
        sport: null,
      };
    }

    // targetKey may be the plain sport ("run", canonical distance) or an
    // encoded custom-distance key ("run_10000") — `sport` below is always
    // the plain sport either way, needed by the client to re-edit this
    // goal (re-submitting must send the plain sport back, not the encoded
    // key, which POST would reject as "unrecognized").
    const parsed = parseCardioTargetKey(targetKey, BENCHMARK_SPORTS);
    const sport = parsed?.sport ?? (BENCHMARK_SPORTS.includes(targetKey as BenchmarkSport) ? (targetKey as BenchmarkSport) : null);
    const distanceMeters =
      (row.target_distance_meters as number | null) ?? (sport ? BENCHMARK_DISTANCE_METERS[sport] : null);
    const canonicalMeters = sport ? BENCHMARK_DISTANCE_METERS[sport] : null;
    const isCustomDistance = sport && distanceMeters != null && canonicalMeters != null && Math.round(distanceMeters) !== Math.round(canonicalMeters);

    return {
      id: row.id as string,
      goalType,
      targetKey,
      targetValue: row.target_value as number,
      currentValue: sport && distanceMeters != null ? cardioCurrentValue(sport, distanceMeters) : null,
      label:
        isCustomDistance && sport && distanceMeters != null
          ? `${distanceLabelFor(sport, distanceMeters)} ${SPORT_NOUN[sport]}`
          : (BENCHMARK_LABELS[sport as BenchmarkSport] ?? targetKey),
      daysUntilTarget: daysUntil(targetDate),
      targetDate,
      distanceMeters,
      sport,
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
      // Every distance this sport supports beyond its own canonical one —
      // [] when the sport has no curated ladder (e.g. cycle).
      distanceOptions: (DISTANCE_LADDER[s] ?? []).map((d) => ({
        meters: d.meters,
        label: d.label,
        currentSeconds:
          benchmarkBySport.get(s) != null ? cardioCurrentValue(s, d.meters) : null,
      })),
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

  const rawTargetKey = String(body.targetKey ?? "").trim();
  if (!rawTargetKey) {
    return NextResponse.json({ error: "targetKey is required" }, { status: 400 });
  }

  let targetKey = rawTargetKey;
  let targetDistanceMeters: number | null = null;

  if (goalType === "cardio") {
    if (!BENCHMARK_SPORTS.includes(rawTargetKey as BenchmarkSport)) {
      return NextResponse.json({ error: "Unrecognized cardio sport" }, { status: 400 });
    }
    const sport = rawTargetKey as BenchmarkSport;
    const canonicalMeters = BENCHMARK_DISTANCE_METERS[sport];
    const requestedMeters = body.distanceMeters != null ? Number(body.distanceMeters) : canonicalMeters;
    const isCanonical = Math.round(requestedMeters) === Math.round(canonicalMeters);
    const isCuratedOption = (DISTANCE_LADDER[sport] ?? []).some((d) => Math.round(d.meters) === Math.round(requestedMeters));
    if (!Number.isFinite(requestedMeters) || requestedMeters <= 0 || !(isCanonical || isCuratedOption)) {
      return NextResponse.json({ error: "Unrecognized distance for this sport" }, { status: 400 });
    }
    targetKey = buildCardioTargetKey(sport, requestedMeters, canonicalMeters);
    targetDistanceMeters = requestedMeters;
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
        target_distance_meters: targetDistanceMeters,
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
