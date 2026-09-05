import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildTrainingPlan, computeGapFraction, type TrainingGoalInput } from "@/lib/scoring/training-plan";
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
import { daysUntilDate } from "@/lib/utils/date";
import { bestEstimate1RM, estimateWeightForReps, type ExerciseClass } from "@/lib/scoring/strength/one-rm";
import { COMMON_EXERCISES } from "@/lib/constants/sports";
import { fetchAllTimeLiftRows, bestOneRmByKey } from "@/lib/activities/all-time-one-rm";
import {
  startOfWeek,
  computeWeekProgress,
  computeProgressTrend,
  type LoggedSessionMatch,
  type ProgressSnapshot,
} from "@/lib/scoring/training-progress";
import { movementPatternForExercise } from "@/lib/scoring/training-session-content";
import { computeHybridBalanceGaps, reserveHybridBalanceSessions } from "@/lib/scoring/training-hybrid-balance";
import { loadAthleteProfile } from "@/lib/scoring/hpe/load-profile";

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
const MIN_TARGET_REPS = 1;
const MAX_TARGET_REPS = 20;
/** How far back to pull gapFraction snapshots for the progress-trend timeline estimate — long enough to smooth out a noisy week or two, short enough that a stale trend from months ago doesn't linger. */
const PROGRESS_HISTORY_WINDOW_DAYS = 90;

/** Same compound/accessory split COMMON_EXERCISES already carries — used to pick the right Epley k when converting a rep-based goal to a 1RM-equivalent (bestEstimate1RM/estimateWeightForReps in one-rm.ts), consistent with how every other estimated-1RM in this app is computed. */
function exerciseClassFor(exerciseName: string): ExerciseClass {
  const def = COMMON_EXERCISES.find((e) => e.name.toLowerCase() === exerciseName.toLowerCase());
  return def?.kind === "accessory" ? "accessory" : "compound";
}

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

  const weekStartISO = startOfWeek(new Date()).toISOString();
  const progressCutoff = new Date(Date.now() - PROGRESS_HISTORY_WINDOW_DAYS * 86400000).toISOString().slice(0, 10);

  const [{ data: goalRows }, { data: benchmarks }, allTimeLifts, { data: weekActivities }, { data: progressRows }] =
    await Promise.all([
      supabase
        .from("training_goals")
        .select("id, goal_type, target_key, target_value, target_date, target_distance_meters, target_reps, achieved_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: true }),
      supabase
        .from("predicted_benchmarks")
        .select("sport, benchmark_seconds, riegel_k")
        .eq("user_id", user.id),
      fetchAllTimeLiftRows(supabase, user.id),
      // Scoped to this week only (user feedback: "each activity the user
      // logs, say in the training plan tab what percentage of the day or
      // session they have met") — separate from the all-time lift rows above,
      // which stay all-time because they feed the athlete's all-time-best
      // 1RM ("current value"), a genuinely different question.
      supabase
        .from("activities")
        .select("id, sport, started_at")
        .eq("user_id", user.id)
        .eq("is_draft", false)
        .gte("started_at", weekStartISO),
      // Recent gapFraction history (user feedback: "how on track they are
      // to meeting their goal and provide a timeline estimate") — see
      // computeProgressTrend in training-progress.ts.
      supabase
        .from("training_goal_progress")
        .select("goal_id, recorded_date, gap_fraction")
        .eq("user_id", user.id)
        .gte("recorded_date", progressCutoff),
    ]);

  const weekGymActivityIds = (weekActivities ?? []).filter((a) => a.sport === "gym").map((a) => a.id as string);
  const { data: weekGymExercises } =
    weekGymActivityIds.length > 0
      ? await supabase.from("gym_exercises").select("activity_id, exercise_name").in("activity_id", weekGymActivityIds)
      : { data: [] as { activity_id: string; exercise_name: string }[] };

  const weekStartedAtByActivity = new Map((weekActivities ?? []).map((a) => [a.id as string, a.started_at as string]));
  const loggedThisWeek: LoggedSessionMatch[] = [];
  for (const a of weekActivities ?? []) {
    if (a.sport !== "gym") {
      loggedThisWeek.push({ goalType: "cardio", key: a.sport as string, loggedAt: a.started_at as string });
    }
  }
  for (const ex of weekGymExercises ?? []) {
    const loggedAt = weekStartedAtByActivity.get(ex.activity_id as string);
    if (loggedAt) loggedThisWeek.push({ goalType: "gym", key: ex.exercise_name as string, loggedAt });
  }

  const snapshotsByGoal = new Map<string, ProgressSnapshot[]>();
  for (const row of progressRows ?? []) {
    const list = snapshotsByGoal.get(row.goal_id as string) ?? [];
    list.push({ date: row.recorded_date as string, gapFraction: Number(row.gap_fraction) });
    snapshotsByGoal.set(row.goal_id as string, list);
  }

  const benchmarkBySport = new Map(
    (benchmarks ?? []).map((b) => [b.sport as string, b.benchmark_seconds as number])
  );
  const riegelKBySport = new Map(
    (benchmarks ?? []).map((b) => [b.sport as string, (b.riegel_k as number | null) ?? null])
  );

  // strength_scores, not gym_exercises. A strength goal's "current" figure has
  // to be on the same ruler as the score the athlete is chasing, or a goal can
  // read as already met purely because the flat column over-reads the lift —
  // and for a single-arm or per-hand movement it over-reads it by a factor, not
  // a few percent. See lib/activities/all-time-one-rm.ts.
  const bestByExercise = bestOneRmByKey(allTimeLifts, (name) => name);

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
  ): TrainingGoalInput & {
    targetDate: string | null;
    distanceMeters: number | null;
    sport: BenchmarkSport | null;
    rawTargetValue: number;
    targetReps: number;
    currentAtGoalReps: number | null;
  } {
    const goalType = row.goal_type as "cardio" | "gym";
    const targetKey = row.target_key as string;
    const targetDate = (row.target_date as string | null) ?? null;

    if (goalType === "gym") {
      // Rep-based goal (user feedback: "Allow target in training plan to
      // be a weight for reps as well not just a 1rm") — target_value is
      // the raw weight at target_reps, converted here to a 1RM-equivalent
      // (same Epley/Brzycki formulas the rest of the app already uses) so
      // the priority engine keeps comparing apples-to-apples in 1RM terms
      // without needing to know reps exist at all. target_reps null/1 is
      // the original behavior — target_value IS already the 1RM.
      const rawTargetValue = row.target_value as number;
      const targetReps = (row.target_reps as number | null) ?? 1;
      const exerciseClass = exerciseClassFor(targetKey);
      const targetValue1RM =
        targetReps > 1 ? bestEstimate1RM(rawTargetValue, targetReps, exerciseClass) : rawTargetValue;
      const currentValue1RM = bestByExercise.get(targetKey) ?? null;
      const currentAtGoalReps =
        currentValue1RM != null && targetReps > 1
          ? estimateWeightForReps(currentValue1RM, targetReps, exerciseClass)
          : currentValue1RM;

      return {
        id: row.id as string,
        goalType,
        targetKey,
        targetValue: targetValue1RM,
        currentValue: currentValue1RM,
        label: targetKey,
        daysUntilTarget: daysUntilDate(targetDate),
        targetDate,
        distanceMeters: null,
        sport: null,
        rawTargetValue,
        targetReps,
        currentAtGoalReps,
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
      daysUntilTarget: daysUntilDate(targetDate),
      targetDate,
      distanceMeters,
      sport,
      rawTargetValue: row.target_value as number,
      targetReps: 1,
      currentAtGoalReps: null,
    };
  }

  // Hybrid-balance coverage (user feedback: "the whole purpose is finding
  // a balance between all muscle groups and cardio, and so if the
  // training plan doesn't account for this and only focuses on the users
  // goals, then please amend... these goals should just be prioritised").
  // Computed from the goals actually still ACTIVE (locked/premium-gated
  // goals and already-achieved ones don't count as "covered" — neither is
  // really being trained) and reserved OUT OF weeklyCapacity before real
  // goals are ranked, so real goals still get the clear majority of the
  // week. Uses computeGapFraction directly rather than a full
  // buildTrainingPlan pass just to find out what's achieved.
  const goalInputs = rankedRows.map(toInput);
  const activeGoalInputs = goalInputs.filter((g) => computeGapFraction(g) > 0);
  const hybridBalanceGaps = computeHybridBalanceGaps(activeGoalInputs, movementPatternForExercise);
  const hybridBalanceReserved = reserveHybridBalanceSessions(hybridBalanceGaps, weeklyCapacity, activeGoalInputs.length);

  // HPE WP0 — the athlete's own diagnostic, derived from logged history.
  // Everything downstream that can be individualised is: the mix of
  // easy/threshold/interval sessions comes from their emphasis vector rather
  // than a fixed fraction, easy pace comes from the three-anchor band rather
  // than a multiple of their goal time, and heart-rate bands come from their
  // own HR-vs-pace regression with the source stated. Null when there is not
  // enough logged history to diagnose anything, in which case every one of
  // those falls back to the population-based behaviour — a diagnosis built on
  // four runs would be a guess wearing a lab coat. See lib/scoring/hpe/.
  const priority = goalInputs.length > 0
    ? goalInputs.filter((g) => g.goalType === "gym").length / goalInputs.length
    : undefined;
  const diagnostic = await loadAthleteProfile(supabase, user.id, { priority }).catch((err) => {
    // A diagnostic failure must never take the plan down with it — the plan
    // without individualisation is still a plan.
    console.error("HPE diagnostic failed:", err instanceof Error ? err.message : err);
    return null;
  });
  const athleteProfile = diagnostic?.profile ?? null;

  const plan = buildTrainingPlan(goalInputs, weeklyCapacity - hybridBalanceReserved);
  const locked = lockedRows.map((row) => {
    const input = toInput(row);
    return { ...input, gapFraction: 0, achieved: false, weight: 0, weeklySessions: 0, feasibility: { feasible: true, message: null } };
  });

  // Best-effort daily snapshot for the trend estimate above — never lets a
  // snapshot failure break the actual plan response. ON CONFLICT DO NOTHING
  // (ignoreDuplicates) means at most one row per goal per day regardless of
  // how many times this route gets hit today.
  const activeGoals = plan.filter((g) => !g.achieved);
  if (activeGoals.length > 0) {
    const todayStr = new Date().toISOString().slice(0, 10);
    const { error: snapshotError } = await supabase.from("training_goal_progress").upsert(
      activeGoals.map((g) => ({
        user_id: user.id,
        goal_id: g.id,
        recorded_date: todayStr,
        gap_fraction: g.gapFraction,
        current_value: g.currentValue,
      })),
      { onConflict: "goal_id,recorded_date", ignoreDuplicates: true }
    );
    if (snapshotError) console.error("training_goal_progress snapshot upsert failed:", snapshotError.message);
  }

  const goalsWithProgress = plan.map((g) => ({
    ...g,
    weekProgress: computeWeekProgress(g, loggedThisWeek),
    progressTrend: computeProgressTrend(snapshotsByGoal.get(g.id) ?? [], g.gapFraction),
  }));

  return NextResponse.json({
    goals: goalsWithProgress,
    lockedGoals: locked,
    weeklyCapacity,
    maxWeeklyCapacity,
    hybridBalance: { ...hybridBalanceGaps, reservedSessions: hybridBalanceReserved },
    // The diagnostic report (brief WP9: "the strongest single artefact in the
    // product"). Sent whole so the client can render the derived metrics, the
    // emphasis vector and — most importantly — the findings, which are what
    // make each prescribed session defensible to the athlete reading it.
    diagnostic: athleteProfile
      ? {
          constantsVersion: athleteProfile.constantsVersion,
          tier: athleteProfile.tier,
          confidence: athleteProfile.confidence,
          limiter: athleteProfile.limiter,
          emphasis: athleteProfile.emphasis,
          findings: athleteProfile.findings,
          dataGaps: athleteProfile.dataGaps,
          assumptions: diagnostic?.assumptions ?? [],
          // WP8 (Rev 2): what the four-weekly re-run decided, and what the
          // athlete is told about it. `shouldRegenerate` false with a
          // populated `drift` means the diagnosis moved but not enough to
          // rebuild the block — worth showing, not worth acting on.
          rerun: diagnostic?.rerun
            ? {
                due: diagnostic.rerun.due,
                weeksSinceLastRun: diagnostic.rerun.weeksSinceLastRun,
                shouldRegenerate: diagnostic.rerun.shouldRegenerate,
                explanations: diagnostic.rerun.explanations,
                deltas: diagnostic.rerun.drift?.deltas ?? null,
              }
            : null,
          weeklyVolumeKm: athleteProfile.weeklyVolumeKm,
          weeklyVolumeMin: athleteProfile.weeklyVolumeMin,
          longestRunKm: athleteProfile.longestRunKm,
          volumeAdequacy: athleteProfile.volumeAdequacy,
          riegelK: athleteProfile.riegelK,
          riegelVerdict: athleteProfile.riegelVerdict,
          decoupling: athleteProfile.decoupling,
          decouplingVerdict: athleteProfile.decouplingVerdict,
          easyFraction: athleteProfile.easyFraction,
          easyFractionSource: athleteProfile.easyFractionSource,
          intensityVerdict: athleteProfile.intensityVerdict,
          easyBand: athleteProfile.easyBand,
          predicted5kS: athleteProfile.predicted5kS,
          hrMax: athleteProfile.hrMax,
          hrMaxSource: athleteProfile.hrMaxSource,
          repProfileGap: athleteProfile.repProfileGap,
          repProfileVerdict: athleteProfile.repProfileVerdict,
          weakLift: athleteProfile.weakLift,
          stalledLifts: athleteProfile.stalledLifts,
        }
      : null,
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

  // Rep-based gym goal (user feedback: "Allow target in training plan to
  // be a weight for reps as well not just a 1rm") — null/1 keeps the
  // original "target_value IS the 1RM" behavior.
  let targetReps: number | null = null;
  if (goalType === "gym" && body.targetReps != null) {
    const reps = Number(body.targetReps);
    if (!Number.isFinite(reps) || !Number.isInteger(reps) || reps < MIN_TARGET_REPS || reps > MAX_TARGET_REPS) {
      return NextResponse.json({ error: `Reps must be a whole number between ${MIN_TARGET_REPS} and ${MAX_TARGET_REPS}` }, { status: 400 });
    }
    targetReps = reps;
  }

  // Optional deadline (Stage 2). Empty string / not provided => no
  // deadline, clears any previously-set one on a resave.
  let targetDate: string | null = null;
  if (body.targetDate) {
    const days = daysUntilDate(String(body.targetDate));
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
        target_reps: targetReps,
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
