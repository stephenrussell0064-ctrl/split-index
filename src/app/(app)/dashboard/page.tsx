import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { format } from "date-fns";
import { createClient } from "@/lib/supabase/server";
import { EngineLabTrendCard } from "@/components/dashboard/engine-lab-trend-card";
import { IndexHero } from "@/components/dashboard/index-hero";
import {
  LiftPredictionStrip,
  RacePredictionStrip,
  type LiftPrediction,
  type RacePrediction,
} from "@/components/dashboard/prediction-strips";
import { RecentWorkouts, AICoachCard } from "@/components/dashboard/workout-list";
import type { HeatmapDay } from "@/components/dashboard/activity-heatmap";
import { WeekOverWeekCard } from "@/components/dashboard/week-over-week-card";
import { TodaysSessionCard } from "@/components/dashboard/todays-session-card";
import { loadTodaysSessionPayload } from "@/components/dashboard/todays-session-data";
import { GoalsCard, type DashboardGoal } from "@/components/dashboard/goals-card";
import { SplitTrendPanel, type TrendPoint } from "@/components/analytics/charts";
import { SportComparisonGrid } from "@/components/dashboard/sport-comparison-grid";
import { PremiumTease } from "@/components/premium/premium-tease";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FocusWeekCard } from "@/components/retention/focus-week-card";
import { NextRankCard } from "@/components/retention/next-rank-card";
import { EmptyDashboardHero } from "@/components/retention/empty-dashboard-hero";
import { InterferenceRadarCard } from "@/components/analytics/interference-radar-card";
import { UpcomingRacesPanel } from "@/components/analytics/upcoming-races-panel";
import { ReadinessCard } from "@/components/dashboard/readiness-card";
import { TodayCard } from "@/components/dashboard/today-card";
import { INTERFERENCE_LOOKBACK_DAYS } from "@/lib/scoring/interference-data";
import { getCrossDomainTimeline } from "@/lib/scoring/timeline";
import { computeInterferenceReport } from "@/lib/scoring/interference";
import { computeReadiness } from "@/lib/scoring/readiness";
import { buildTodayPlan } from "@/lib/scoring/today-plan";
import { getPredictedBenchmark } from "@/lib/scoring/predicted-benchmark";
import { ScoreDisclaimer } from "@/components/legal/score-disclaimer";
import { calculateTrend } from "@/lib/scoring/service";
import { localDateKeyInTz, resolveTimezone } from "@/lib/utils/timezone";
import {
  buildActivityScores,
  deriveAthleteProfile,
  labWeightFromProfile,
  resolveScoringSex,
} from "@/lib/scoring/adapters";
import { computeIndexes } from "@/lib/scoring/index-engine";
import type { IndexResult } from "@/lib/scoring/index-engine";
import { calculateOverallDotsGl } from "@/lib/scoring/strength/overall-dots-gl";
import { fetchAllTimeLiftRows, fetchBestLoggedSbdSets } from "@/lib/activities/all-time-one-rm";
import { tier2IsCalibrating, TIER2_MIN_SAMPLES_TO_DISPLAY } from "@/lib/scoring/cardio/race-prediction";
import { explainStoredPrediction } from "@/lib/scoring/cardio-predictions";
import { riegelPredictions } from "@/lib/scoring/cardio-activity";
import { formatPredictionLabel, formatShortPredictionLabel } from "@/lib/scoring/presentation";
import { RacePredictionsSync } from "@/lib/native/race-predictions-sync";
import type { SplitIndexWidgetPayload } from "@/lib/native/race-predictions";
import { computeStreakMetrics } from "@/lib/retention/streak-utils";
import { getGlobalRankPercentile, getNextRankTarget, seedRetentionNotifications } from "@/lib/retention/rank";
import { isPremiumUser, hasSoftTrialAccess } from "@/lib/retention/trial";
import { ACTIVATION_EVENT_SESSION_COUNT, PRICING } from "@/lib/pricing/config";
import { computeSplitIndexProjection } from "@/lib/premium/projection";
import { gateAiFeedback } from "@/lib/scoring/gates";
import { formatIndex, formatTrend } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";
import type { SplitIndexSnapshot, SportType } from "@/types";

const DAY_MS = 86400000;
const HEATMAP_DAYS = 112;

/** Race-ladder rungs worth showing on the iOS home-screen widget, as distance-in-meters keys of `riegelPredictions`. 10K and Half only — the 5K is the widget's headline already, and 1500m/marathon don't earn the space on a small card. */
const LADDER_WIDGET_DISTANCES = ["10000", "21097.5"];

/** The big three for the widget's strength half, in platform order. Labels are passed to the widget rather than re-derived natively, exactly as the race labels are, so the two surfaces can't name a lift differently. */
const SBD_WIDGET_LIFTS = [
  { key: "squat", label: "Squat" },
  { key: "bench", label: "Bench" },
  { key: "deadlift", label: "Deadlift" },
] as const;

function findSnapshotOlderThan(
  history: SplitIndexSnapshot[],
  days: number
): SplitIndexSnapshot | undefined {
  const cutoff = Date.now() - days * DAY_MS;
  for (let i = history.length - 1; i >= 0; i--) {
    if (new Date(history[i].recorded_at).getTime() < cutoff) return history[i];
  }
  return undefined;
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * DAY_MS).toISOString();
}

function buildGreetingRecommendation(
  preferredSports: SportType[],
  weakerSide: "endurance" | "strength" | "balanced"
): string {
  const sportNames = preferredSports
    .slice(0, 2)
    .map((s) => s.replace("_", " "))
    .join(" or ");
  if (weakerSide === "endurance") {
    return sportNames
      ? `Bias ${sportNames} today — endurance needs attention`
      : "An endurance session would balance your index";
  }
  if (weakerSide === "strength") {
    return "A gym session would lift your strength side";
  }
  return sportNames
    ? `${sportNames} — keep the hybrid balance going`
    : "Log a session to move your index";
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("user_id", user.id)
    .single();

  if (!profile?.onboarding_completed) redirect("/onboarding");

  const userTimezone = resolveTimezone(profile.timezone);

  // Folds in a card-less signup trial (Slice D) so a brand-new user sees
  // the full premium dashboard by default, without having to notice or
  // activate anything in Settings — every gate below this line that reads
  // `premium` extends automatically for the trial window, then reverts to
  // the real free-tier view once it lapses (unless they've actually paid).
  const premium =
    isPremiumUser(profile.subscription_tier, profile.subscription_status) ||
    hasSoftTrialAccess(profile.created_at, profile.subscription_tier, profile.subscription_status);

  const heatmapCutoff = isoDaysAgo(HEATMAP_DAYS);
  const trendCutoff = isoDaysAgo(premium ? 90 : 7);
  const crossDomainSessionsPromise = getCrossDomainTimeline(supabase, user.id, {
    since: isoDaysAgo(INTERFERENCE_LOOKBACK_DAYS),
  });
  const predictedRunBenchmarkPromise = getPredictedBenchmark(supabase, user.id, "run");
  /*
    Today's prescribed session. Two selects against the plan the engine already
    stored — deliberately NOT a call to /api/hpe/plan, which generates one and
    would turn a dashboard load into a write. See todays-session-data.ts.
  */
  const todaysSessionPromise = loadTodaysSessionPayload(supabase, user.id);

  const [
    { data: latestIndex },
    { data: indexHistory },
    { data: fullHistory },
    { data: recentActivities },
    { data: allActivityDates },
    { data: loadActivities },
    { data: scores },
    { data: aiFeedback },
    { data: goals },
    { data: indexActivities },
  ] = await Promise.all([
    supabase
      .from("split_index_history")
      .select("*")
      .eq("user_id", user.id)
      .order("recorded_at", { ascending: false })
      .limit(1)
      .single(),
    supabase
      .from("split_index_history")
      .select("*")
      .eq("user_id", user.id)
      .gte("recorded_at", trendCutoff)
      .order("recorded_at", { ascending: true })
      .limit(180),
    supabase
      .from("split_index_history")
      .select("*")
      .eq("user_id", user.id)
      .order("recorded_at", { ascending: true })
      .limit(90),
    supabase
      .from("activities")
      .select("*")
      .eq("user_id", user.id)
      .eq("is_draft", false)
      .order("started_at", { ascending: false })
      .limit(10),
    supabase
      .from("activities")
      .select("started_at")
      .eq("user_id", user.id)
      .eq("is_draft", false)
      .order("started_at", { ascending: false })
      .limit(365),
    supabase
      .from("activities")
      .select("id, sport, started_at, duration_seconds")
      .eq("user_id", user.id)
      .eq("is_draft", false)
      .gte("started_at", heatmapCutoff)
      .order("started_at", { ascending: true })
      .limit(500),
    supabase
      .from("workout_scores")
      .select("activity_id, sport, sport_index, load_score, created_at, strength_component, endurance_component")
      .eq("user_id", user.id)
      .gte("created_at", heatmapCutoff)
      .order("created_at", { ascending: false })
      .limit(500),
    supabase
      .from("ai_feedback")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .single(),
    supabase
      .from("goals")
      .select("id, title, target_split_index, deadline, completed")
      .eq("user_id", user.id)
      .order("deadline", { ascending: true, nullsFirst: false })
      .limit(10),
    supabase
      .from("activities")
      .select("sport, started_at, workout_scores(sport_index, score_breakdown)")
      .eq("user_id", user.id)
      .eq("is_draft", false)
      .order("started_at", { ascending: false })
      .limit(20),
  ]);

  // Best-ever SBD total for the home page's lift strip (Slice 7)
  // — same all-time-best-lift source as the Lab page's own DOTS/GL card
  // (gym/page.tsx) and Analytics' new DOTS/GL panel, so all three agree.
  // strength_scores, not gym_exercises: the two columns hold different numbers
  // for the same lift, and this tile has to agree with the Lab and Analytics
  // cards showing the same DOTS/GL. See lib/activities/all-time-one-rm.ts.
  const allTimeGymExercisesPromise = fetchAllTimeLiftRows(supabase, user.id);
  // What the athlete has actually had on the bar, to sit under what the
  // engine predicts they could (user feedback: "give the actual lift
  // predictions vs the best you've recorded"). A different column from the
  // one above on purpose — see fetchBestLoggedSbdSets.
  const bestLoggedSbdPromise = fetchBestLoggedSbdSets(supabase, user.id);

  const [
    crossDomainSessions,
    predictedRunBenchmark,
    allTimeGymExercises,
    todaysSessionPayload,
    bestLoggedSbd,
  ] = await Promise.all([
    crossDomainSessionsPromise,
    predictedRunBenchmarkPromise,
    allTimeGymExercisesPromise,
    todaysSessionPromise,
    bestLoggedSbdPromise,
  ]);
  const interferenceReport = computeInterferenceReport(crossDomainSessions);
  const readiness = computeReadiness(crossDomainSessions);
  const todayPlan = buildTodayPlan(readiness, interferenceReport, predictedRunBenchmark);

  // User feedback (Slice 7): "include things such as 5km race prediction
  // and SBD prediction, that is likely to be most useful to a user just
  // logging onto the app" — the hero wall's two leading tiles.
  const predicted5kSeconds =
    predictedRunBenchmark && !tier2IsCalibrating(predictedRunBenchmark.sampleCount)
      ? predictedRunBenchmark.benchmarkSeconds
      : null;
  // Why the number is what it is, when a training gap has eased it back.
  //
  // The stored value is UNDECAYED: decay is only folded in when the next
  // session is logged and the decayed prior is blended back. So an athlete
  // returning from a break sees their old time, trains, and watches the
  // prediction get WORSE — which reads as the app breaking rather than as
  // detraining being counted. It was reported exactly that way.
  //
  // Deliberately explanatory only: `predicted5kSeconds` above is untouched, so
  // the tile, the widget and every scoring path still agree on the figure.
  const predictionDecay =
    predicted5kSeconds !== null && predictedRunBenchmark
      ? explainStoredPrediction(
          predictedRunBenchmark.benchmarkSeconds,
          predictedRunBenchmark.updatedAt,
          predictedRunBenchmark.lastQualityAt
        )
      : null;
  const overallDotsGl =
    profile.weight_kg && profile.weight_kg > 0
      ? calculateOverallDotsGl(allTimeGymExercises, profile.weight_kg, resolveScoringSex(profile))
      : null;

  // The iOS home-screen widget can't reach Supabase from its own process, so
  // the dashboard hands it the numbers it just computed (see
  // lib/native/race-predictions.ts). Deliberately built from the SAME
  // `predicted5kSeconds` gate the hero tile uses, so the widget and the app
  // can never show different answers — and it publishes the calibrating /
  // empty states explicitly rather than staying silent, so the widget can
  // say why it has no time instead of inventing one.
  //
  // The strength half is gated on the SAME `overallDotsGl` object as the
  // hero wall's "SBD Prediction" tile, for the same reason: whatever makes
  // that tile show a dash must make the widget show words, or the two
  // surfaces contradict each other about the same athlete. Note that DOTS
  // and IPF GL are deliberately NOT published — they're premium-gated
  // (canAccessProfile("strength_dots_gl")), and a widget has nowhere to
  // enforce a gate. Best-ever lifts and the SBD total are free-tier, which
  // is exactly what the hero tile already shows everyone.
  const strengthPayload: SplitIndexWidgetPayload["strength"] =
    overallDotsGl && overallDotsGl.sbdTotalKg > 0
      ? {
          status: "ready",
          // Only lifts actually logged. A squat-and-deadlift athlete gets
          // two rungs, never a 0 kg bench sitting between them.
          lifts: SBD_WIDGET_LIFTS.filter(
            ({ key }) => overallDotsGl.bestSbdKg[key] > 0
          ).map(({ key, label }) => ({ label, kg: overallDotsGl.bestSbdKg[key] })),
          totalKg: overallDotsGl.sbdTotalKg,
          liftsLogged: overallDotsGl.liftsLogged,
        }
      : { status: "noData" };

  /*
    Squat / bench / deadlift, predicted against performed.

    `bestSbdKg` is the scoring engine's best-ever estimated 1RM per lift — a
    projection. `bestLoggedSbd` is the heaviest set the athlete actually did.
    Showing the pair is the point; showing either alone was the old SBD tile,
    which reported a 457kg total and left an athlete no way to tell whether
    that was three numbers they had hit or three the engine had inferred.
  */
  const liftPredictions: LiftPrediction[] = SBD_WIDGET_LIFTS.map(({ key, label }) => {
    const logged = bestLoggedSbd[key];
    return {
      label,
      predictedKg: overallDotsGl && overallDotsGl.bestSbdKg[key] > 0 ? overallDotsGl.bestSbdKg[key] : null,
      bestKg: logged?.weightKg ?? null,
      bestReps: logged?.reps ?? null,
    };
  });

  /*
    The full race ladder, computed once.

    Two surfaces read it and they must not disagree: the home page's race strip
    shows every rung (1500m through the marathon), the iOS widget shows two of
    them. Building it twice from the same inputs would be two chances to pass a
    different Riegel exponent.
  */
  const raceLadder: [string, number][] =
    predicted5kSeconds !== null
      ? Object.entries(
          riegelPredictions(5000, predicted5kSeconds, "intermediate", predictedRunBenchmark?.riegelK) ?? {}
        ).sort(([a], [b]) => Number(a) - Number(b))
      : [];

  const racePredictions: RacePrediction[] = raceLadder.map(([distance, seconds]) => ({
    label: formatShortPredictionLabel(distance),
    seconds,
  }));

  const racePredictionPayload: SplitIndexWidgetPayload =
    predicted5kSeconds !== null
      ? {
          status: "ready",
          headline: { label: "5K", seconds: predicted5kSeconds },
          // The longer rungs only — the 5K is already the headline, and
          // 1500m/marathon don't earn their space on a small widget.
          ladder: raceLadder
            .filter(([distance]) => LADDER_WIDGET_DISTANCES.includes(distance))
            .map(([distance, seconds]) => ({
              label: formatPredictionLabel(distance),
              seconds,
            })),
          sampleCount: predictedRunBenchmark?.sampleCount ?? 0,
          strength: strengthPayload,
        }
      : predictedRunBenchmark
        ? {
            status: "calibrating",
            sampleCount: predictedRunBenchmark.sampleCount,
            samplesNeeded: TIER2_MIN_SAMPLES_TO_DISPLAY,
            strength: strengthPayload,
          }
        : { status: "noData", strength: strengthPayload };

  const hasActivities = (recentActivities?.length ?? 0) > 0;
  const hasIndexHistory = !!latestIndex;
  const sessionCount = allActivityDates?.length ?? 0;
  const showActivationPaywall =
    !premium && sessionCount >= ACTIVATION_EVENT_SESSION_COUNT;
  const streakMetrics = computeStreakMetrics(
    (allActivityDates ?? []).map((a) => a.started_at as string),
    new Date(),
    userTimezone
  );

  const accountAgeDays = Math.floor(
    (Date.now() - new Date(profile.created_at).getTime()) / DAY_MS // eslint-disable-line react-hooks/purity -- server component
  );

  await seedRetentionNotifications(supabase, user.id, {
    atRisk: streakMetrics.atRisk,
    streak: streakMetrics.streak,
    hasActivities,
    isNewAccount: accountAgeDays <= 3,
  });

  const current = hasIndexHistory
    ? latestIndex!
    : {
        split_index: 0,
        endurance_index: 0,
        strength_index: 0,
        recovery_score: 85,
        fatigue_score: 15,
        predicted_index_7d: 0,
      };

  const projection8Weeks = hasIndexHistory
    ? computeSplitIndexProjection(
        (fullHistory ?? []) as SplitIndexSnapshot[],
        8
      )
    : null;

  const history = (indexHistory ?? []) as SplitIndexSnapshot[];
  const weekAgo = findSnapshotOlderThan(history, 7);
  const weeklyTrend = weekAgo
    ? calculateTrend(current.split_index, weekAgo.split_index)
    : 0;

  // One point per calendar day, not per logged activity — several workouts
  // on the same day previously produced several x-axis ticks with the same
  // "MMM d" label, making the chart look frozen. `history` is ascending, so
  // the last write per day-key naturally keeps that day's final index.
  const trendByDay = new Map<string, SplitIndexSnapshot>();
  for (const h of history) {
    trendByDay.set(format(new Date(h.recorded_at), "yyyy-MM-dd"), h);
  }
  const trendData: TrendPoint[] = Array.from(trendByDay.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, h]) => ({
      date: format(new Date(h.recorded_at), "MMM d"),
      split: h.split_index,
      endurance: h.endurance_index,
      strength: h.strength_index,
    }));

  const loadByActivity = new Map(
    (scores ?? []).map((s) => [s.activity_id as string, s.load_score as number])
  );
  const dayBuckets = new Map<string, { load: number; workouts: number }>();
  for (const a of loadActivities ?? []) {
    const key = localDateKeyInTz(a.started_at as string, userTimezone);
    const load =
      loadByActivity.get(a.id as string) ??
      Math.round(((a.duration_seconds as number) ?? 0) / 60);
    const bucket = dayBuckets.get(key) ?? { load: 0, workouts: 0 };
    bucket.load += load;
    bucket.workouts += 1;
    dayBuckets.set(key, bucket);
  }
  const heatmapDays: HeatmapDay[] = Array.from(dayBuckets, ([date, v]) => ({
    date,
    load: v.load,
    workouts: v.workouts,
  }));

  // Most-recent-first per sport (scores is already ordered by created_at
  // desc from the query above) — powers SportComparisonGrid's "latest vs
  // your own recent average" tiles, including gym unlike the old radar.
  const scoresBySport: Record<string, number[]> = {};
  for (const s of scores ?? []) {
    const key = s.sport as string;
    (scoresBySport[key] ??= []).push(s.sport_index as number);
  }

  const scoreMap = Object.fromEntries(
    (scores ?? []).map((s) => [s.activity_id as string, s.sport_index as number])
  );

  const athleteProfile = deriveAthleteProfile((profile.preferred_sports ?? []) as SportType[]);
  const weightLab = labWeightFromProfile(
    typeof profile.split_endurance_weight === "number"
      ? profile.split_endurance_weight
      : 0.5
  );

  const indexActivityRows = (indexActivities ?? [])
    .flatMap((row) => {
      const ws = Array.isArray(row.workout_scores)
        ? row.workout_scores[0]
        : row.workout_scores;
      if (!ws?.sport_index) return [];
      return [
        {
          sport: row.sport as string,
          sport_index: ws.sport_index as number,
          started_at: row.started_at as string,
          score_breakdown: (ws.score_breakdown ?? null) as Record<string, unknown> | null,
        },
      ];
    });

  const liveIndexes: IndexResult | null =
    indexActivityRows.length >= 1
      ? computeIndexes(buildActivityScores(indexActivityRows), athleteProfile, weightLab)
      : null;

  // Headline is always the combined Split Index (user feedback: "Why is the
  // main score at the top of the dashboard not the combined score between
  // the lab and cardio, it should be this") — no more branching on
  // onboarding profile to a single-side Lab/Engine Index. `current.split_index`
  // already stores the combined value computed at log time (index-engine.ts),
  // so this fallback (used when nothing was freshly scored this request)
  // just reads it straight.
  const headlineLabel: IndexResult["headlineLabel"] = liveIndexes?.headlineLabel ?? "Split Index";
  const headlineValue = liveIndexes?.headline ?? current.split_index;
  const displayEnduranceIndex = liveIndexes?.engineIndex ?? current.endurance_index;
  const displayStrengthIndex = liveIndexes?.labIndex ?? current.strength_index;
  /*
    RANK THE NUMBER THE PAGE ACTUALLY SHOWS.

    These two used to be computed from `current.split_index` — the newest
    `split_index_history` row — while the hero above rendered
    `liveIndexes.headline`. Those are different numbers whenever anything was
    freshly scored this request, so the hero could read 701 with a "Top 3%"
    badge sitting beside it, computed from a value the athlete never sees.

    Ranking `headlineValue` closes that specific contradiction. It does NOT
    make the rank correct, and the remaining problem is worth writing down
    rather than leaving for the next person to rediscover:

      * The standards branch (`percentileForScore`) is a pure function of the
        athlete's own score, so ranking the displayed number is now exactly
        right there.
      * The peer branch compares against `profiles.current_split_index`, a
        column a database trigger keeps in step with the athlete's newest
        `split_index_history` row.

    Both of the write-path defects that used to make that peer pool untrustworthy
    have since been fixed, and are recorded here because the shape of the bugs is
    worth remembering:

      * `lib/activities/score-and-persist.ts` — the edit, merge and unmerge path
        — called `scoreActivity` WITHOUT its third argument, so
        `recentActivityRows` defaulted to `[]`, `computeIndexes` saw a single
        activity, and `splitIndex` collapsed to `lab ?? engine` — that one
        session's own score. Editing a gym session and editing a run wrote
        wildly different "current" indexes for the same athlete. It now passes
        the rows, as the create path always did.
      * The trigger itself copied whichever history row was written last onto
        the profile, with no regard for its date — and `recorded_at` carries the
        ACTIVITY's date, not insert time, so logging or editing a back-dated
        session made that older session "current". It now recomputes from the
        newest surviving row (migration 054).
  */
  const rankPercentile =
    hasActivities && hasIndexHistory
      ? await getGlobalRankPercentile(supabase, headlineValue)
      : null;

  const nextRankTarget =
    premium && hasActivities && hasIndexHistory
      ? await getNextRankTarget(supabase, headlineValue)
      : null;

  const indexGap = current.endurance_index - current.strength_index;
  const weakerSide: "endurance" | "strength" | "balanced" =
    indexGap < -15 ? "endurance" : indexGap > 15 ? "strength" : "balanced";

  const displayName =
    profile.username?.trim() ||
    profile.display_name?.split(" ")[0]?.trim() ||
    null;
  const sessionHint = buildGreetingRecommendation(
    (profile.preferred_sports ?? []) as SportType[],
    weakerSide
  );

  return (
    /*
      THE FIRST SCREEN IS THE PRODUCT.

      space-y-3 rather than space-y-5, a one-line greeting rather than a
      two-line one, and a deliberate order: everything an athlete opens the
      app for now sits above the fold on a phone, and everything retrospective
      sits below it (user feedback: "i dont want you to have to scroll very
      much at all on the homepage as you should not need to in an app, all the
      key information should be available on the screen you see").

      The four blocks that make up that screen, in order:

        1. Where I stand   — IndexHero: the Split Index with the words that say
                             what it is, plus its Engine and Lab halves.
        2. What I do today — the Hybrid Plan band, given the second slot
                             because that is the strongest place on the page
                             ("i also want the hybrid plan to be highlighted
                             more greatly in the homepage").
        3. What I could run — every race distance, not just the 5K.
        4. What I could lift — all three lifts, predicted against performed.

      Nothing was deleted to make room: readiness, the AI coach, interference,
      trends, goals and the rest all still follow, in the same order they were
      in, one scroll down.
    */
    <div className="space-y-2.5">
      {/*
        Renders nothing — pushes the predictions above into the iOS
        home-screen widget's shared container. No-op on web and Android.
      */}
      <RacePredictionsSync payload={racePredictionPayload} />

      {/* One line, deliberately. Two lines of greeting is a tenth of a phone
          screen spent on a name the athlete already knows. */}
      <div className="flex items-baseline gap-x-2 overflow-hidden">
        <h1 className="headline-tight shrink-0 text-sm font-bold">
          {displayName ? `Hi, ${displayName}` : "Welcome back"}
        </h1>
        <p className="truncate text-xs text-muted">
          {format(new Date(), "EEE d MMM")} · {sessionHint}
        </p>
      </div>

      {!hasActivities && <EmptyDashboardHero displayName={displayName} />}

      {/*
        WHERE DO I STAND. Stays first because it is the one block that has to
        grab attention before anything is read.

        `predicted5kSeconds` / `overallDotsGl` still feed BOTH the strips below
        and the `RacePredictionsSync` payload above, through the one
        `raceLadder` both are built from — so the phone's home-screen widget
        and the app cannot disagree about a predicted time.
      */}
      {hasActivities && (
        <IndexHero
          headlineLabel={headlineLabel}
          headlineValue={hasIndexHistory ? headlineValue : null}
          weeklyTrend={weeklyTrend}
          hasHistory={hasIndexHistory}
          engineIndex={hasIndexHistory ? displayEnduranceIndex : null}
          labIndex={hasIndexHistory ? displayStrengthIndex : null}
          streak={streakMetrics.streak}
          streakAtRisk={streakMetrics.atRisk}
          weeklySessions={streakMetrics.weeklySessions}
        />
      )}

      {/*
        WHAT DO I DO TODAY. The plan band, full width and directly under the
        index — the hybrid plan used to reach the home page as one third of a
        three-column grid two blocks down, which is not what "the app's only
        planning surface" should look like on the screen everyone lands on.
      */}
      <TodaysSessionCard payload={todaysSessionPayload} variant="band" />

      {/*
        WHAT COULD I DO. Five race distances and three lifts, in the footprint
        the single 5K square and the single SBD square used to occupy between
        them.
      */}
      {hasActivities && (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <RacePredictionStrip
            predictions={racePredictions}
            note={predictionDecay?.explanation ?? null}
          />
          <LiftPredictionStrip
            lifts={liftPredictions}
            totalKg={overallDotsGl && overallDotsGl.sbdTotalKg > 0 ? overallDotsGl.sbdTotalKg : null}
          />
        </div>
      )}

      {/* ── Below the fold: how today is going, then what has happened ── */}

      {hasActivities && <ReadinessCard readiness={readiness} />}

      {/*
        The AI coach was the LAST content block on this page (bottom-right of
        the final grid, below the heatmap and the goals list). The athlete's
        report was blunt: "the AI coach on dashboard is key information and
        this should be higher up". It leads the below-the-fold content, with
        the intensity suggestion as the rail beside it — that qualifies the
        coaching, it is not the answer on its own.
      */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <AICoachCard
          feedback={aiFeedback ? gateAiFeedback(aiFeedback, premium) : aiFeedback}
          isPremium={premium}
          className={hasActivities ? "lg:col-span-2" : "lg:col-span-3"}
        />
        {hasActivities && <TodayCard plan={todayPlan} className="lg:col-span-1" />}
      </div>

      {hasActivities && <InterferenceRadarCard report={interferenceReport} />}

      {showActivationPaywall && (
        <PremiumTease
          title={`Start your ${PRICING.TRIAL_DAYS}-day free trial`}
          subtitle="You've logged a few sessions — see your full trend, projections, and AI coaching."
          ctaLabel={`Start your ${PRICING.TRIAL_DAYS}-day free trial →`}
          className="border border-accent/20"
        >
          <SplitTrendPanel data={trendData} />
        </PremiumTease>
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <EngineLabTrendCard
          data={trendData}
          currentEndurance={displayEnduranceIndex}
          currentStrength={displayStrengthIndex}
          enduranceWeight={
            typeof profile.split_endurance_weight === "number"
              ? profile.split_endurance_weight
              : 0.5
          }
          hasHistory={hasIndexHistory}
          className="lg:col-span-2"
        />

        {hasIndexHistory && projection8Weeks !== null && (
          <div className="lg:col-span-1">
            {premium ? (
              <Card glow="accent" padding="lg" className="flex h-full flex-col justify-center">
                <CardHeader className="mb-2">
                  <CardTitle className="text-sm">8-week projection</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="index-display text-4xl font-bold text-accent tabular-nums">
                    {formatIndex(projection8Weeks)}
                  </p>
                  <p
                    className={cn(
                      "mt-1 text-sm font-semibold tabular-nums",
                      projection8Weeks >= headlineValue ? "text-success" : "text-danger"
                    )}
                  >
                    {formatTrend(projection8Weeks - headlineValue)} from today
                  </p>
                  <p className="mt-3 text-xs text-muted">
                    Linear forecast from your recent {headlineLabel.toLowerCase()} trend
                  </p>
                </CardContent>
              </Card>
            ) : (
              <PremiumTease
                title="8-week Split Index projection"
                subtitle="Premium unlocks trend projections, 90-day history, and period comparisons."
                className="h-full"
              >
                <Card padding="lg" className="flex h-full flex-col justify-center">
                  <CardHeader className="mb-2">
                    <CardTitle className="text-sm">8-week projection</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="index-display text-4xl font-bold text-accent tabular-nums">
                      •••
                    </p>
                    <p className="mt-3 text-xs text-muted">
                      Linear forecast from your recent index trend
                    </p>
                  </CardContent>
                </Card>
              </PremiumTease>
            )}
          </div>
        )}
      </div>

      {/*
        CUT FROM THE HOME PAGE — GymZonePanel and CardioZonePanel.

        Both were a third rendering of two numbers this page already showed
        twice: `current.strength_index` / `current.endurance_index` lead the
        EngineLabTrendCard directly above with trend context attached, and the
        per-sport averages underneath them are what SportComparisonGrid shows
        below. A home page that says the same thing three times has not
        prioritised anything. Neither panel is used anywhere else, so they
        remain in the tree for whoever wants them on a Lab/Engine page.
      */}

      {/*
        THE PUSH ROW — the three cards that ask for something rather than
        report something. Grouped so they read as one prompt instead of being
        scattered through the analysis tail as they were.
      */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        {premium ? (
          <NextRankCard target={nextRankTarget} currentPercentile={rankPercentile?.percentile ?? null} />
        ) : (
          <PremiumTease
            title="Beat the next rank"
            subtitle="Unlock Premium to see exactly how many points separate you from the athlete ahead."
            showPreview={false}
            className="h-full"
          />
        )}
        <FocusWeekCard
          weakerSide={weakerSide}
          enduranceIndex={current.endurance_index}
          strengthIndex={current.strength_index}
        />
        <GoalsCard
          goals={(goals ?? []) as DashboardGoal[]}
          currentIndex={hasIndexHistory ? current.split_index : 0}
        />
      </div>

      {/* User feedback: "Move upcoming races further down on dashboard as
          it is not a key feature unless you can pull the race terrain and
          conditions for each event without the requirement of manual
          intervention to enter elevation gain and gpx" — that automatic
          terrain/conditions lookup isn't built (elevation still needs a
          manual entry or GPX upload), so this moved down from right after
          the hero, below the higher-priority readiness/interference/trend
          content, rather than being removed outright. Not gated behind
          hasActivities — adding an upcoming race is useful even before a
          user has logged their first session. */}
      <UpcomingRacesPanel />

      <div className="flex items-end justify-between">
        <p className="micro-label text-muted">Your data</p>
        <Link
          href="/analytics"
          className="group flex items-center gap-1 text-xs font-medium text-accent hover:text-accent/80"
        >
          Full analytics
          <ChevronRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
        </Link>
      </div>

      {/*
        CUT FROM THE HOME PAGE — the standalone SplitTrendPanel, the
        ActivityHeatmap and the ConsistencyCard.

        All three are retrospective analysis with a page of their own:
        /analytics renders the same trend panel, the same heatmap component
        and its own consistency score. The dashboard was rendering `trendData`
        twice (once through EngineLabTrendCard, once raw) and a 112-day
        heatmap that answers a question nobody opens the app at 6am to ask.
        The "Full analytics" link above is the route to all of it.

        WeekOverWeekCard survives because "did I do more or less than last
        week" is a right-now question and it exists nowhere else. It keeps
        `heatmapDays`, which is why that computation is still above.
      */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <WeekOverWeekCard days={heatmapDays} className="lg:col-span-1" />
        <div className="lg:col-span-2">
          <SportComparisonGrid scoresBySport={scoresBySport} />
        </div>
      </div>

      <RecentWorkouts activities={recentActivities ?? []} scores={scoreMap} />

      <ScoreDisclaimer className="mt-2" />
    </div>
  );
}
