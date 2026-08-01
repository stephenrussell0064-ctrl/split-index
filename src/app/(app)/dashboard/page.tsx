import { redirect } from "next/navigation";
import { format } from "date-fns";
import { createClient } from "@/lib/supabase/server";
import { EngineLabTrendCard } from "@/components/dashboard/engine-lab-trend-card";
import { HeroStatWall } from "@/components/dashboard/hero-stat-wall";
import { GymZonePanel, CardioZonePanel } from "@/components/dashboard/zone-panels";
import { RecentWorkouts, AICoachCard } from "@/components/dashboard/workout-list";
import { ActivityHeatmap, type HeatmapDay } from "@/components/dashboard/activity-heatmap";
import { ConsistencyCard } from "@/components/dashboard/training-cards";
import { WeekOverWeekCard } from "@/components/dashboard/week-over-week-card";
import { RecommendationCard } from "@/components/dashboard/recommendation-card";
import { GoalsCard, type DashboardGoal } from "@/components/dashboard/goals-card";
import { SplitTrendPanel, type TrendPoint } from "@/components/analytics/charts";
import { SportComparisonGrid } from "@/components/dashboard/sport-comparison-grid";
import { PremiumGate } from "@/components/analytics/premium-gate";
import { PremiumTease } from "@/components/premium/premium-tease";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FocusWeekCard } from "@/components/retention/focus-week-card";
import { NextRankCard } from "@/components/retention/next-rank-card";
import { EmptyDashboardHero } from "@/components/retention/empty-dashboard-hero";
import { FriendInviteBanner } from "@/components/retention/friend-invite-banner";
import { CompleteProfileBanner } from "@/components/retention/complete-profile-banner";
import { InterferenceRadarCard } from "@/components/analytics/interference-radar-card";
import { fetchInterferenceReport } from "@/lib/scoring/interference-data";
import { ScoreDisclaimer } from "@/components/legal/score-disclaimer";
import { calculateTrend } from "@/lib/scoring/service";
import { localDateKeyInTz, resolveTimezone } from "@/lib/utils/timezone";
import {
  buildActivityScores,
  deriveAthleteProfile,
  labWeightFromProfile,
} from "@/lib/scoring/adapters";
import { computeIndexes } from "@/lib/scoring/index-engine";
import type { IndexResult } from "@/lib/scoring/index-engine";
import { computeStreakMetrics } from "@/lib/retention/streak-utils";
import { getGlobalRankPercentile, getNextRankTarget, seedRetentionNotifications } from "@/lib/retention/rank";
import { isPremiumUser, hasSoftTrialAccess } from "@/lib/retention/trial";
import { ACTIVATION_EVENT_SESSION_COUNT, PRICING } from "@/lib/pricing/config";
import { computeSplitIndexProjection } from "@/lib/premium/projection";
import { gateAiFeedback } from "@/lib/scoring/gates";
import { formatIndex, formatTrend } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";
import type { PersonalRecord, SplitIndexSnapshot, SportType } from "@/types";

const DAY_MS = 86400000;
const HEATMAP_DAYS = 112;

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
  const interferenceReportPromise = fetchInterferenceReport(supabase, user.id);

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
    { data: latestPersonalRecord },
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
    supabase
      .from("personal_records")
      .select("*")
      .eq("user_id", user.id)
      .order("achieved_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const interferenceReport = await interferenceReportPromise;

  const hasActivities = (recentActivities?.length ?? 0) > 0;
  const needsExtendedProfile = hasActivities && profile.experience == null;
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

  const rankPercentile = hasActivities && hasIndexHistory
    ? await getGlobalRankPercentile(supabase, current.split_index)
    : null;

  const nextRankTarget =
    premium && hasActivities && hasIndexHistory
      ? await getNextRankTarget(supabase, current.split_index)
      : null;

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

  const sportAgg = new Map<string, { sum: number; count: number }>();
  for (const s of scores ?? []) {
    const key = s.sport as string;
    if (key === "gym") continue;
    const agg = sportAgg.get(key) ?? { sum: 0, count: 0 };
    agg.sum += s.sport_index as number;
    agg.count += 1;
    sportAgg.set(key, agg);
  }
  const cardioSportScores = Array.from(sportAgg, ([sport, agg]) => ({
    sport,
    avg: Math.round(agg.sum / agg.count),
    count: agg.count,
  })).sort((a, b) => b.count - a.count);

  const recentGymScores = (scores ?? [])
    .filter((s) => s.sport === "gym")
    .slice(0, 8)
    .map((s) => ({
      date: s.created_at as string,
      score: s.sport_index as number,
    }))
    .reverse();

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

  const headlineLabel: IndexResult["headlineLabel"] =
    liveIndexes?.headlineLabel ??
    (athleteProfile === "gym"
      ? "Lab Index"
      : athleteProfile === "cardio"
        ? "Engine Index"
        : "Split Index");
  const headlineValue =
    liveIndexes?.headline ??
    (athleteProfile === "gym"
      ? current.strength_index
      : athleteProfile === "cardio"
        ? current.endurance_index
        : current.split_index);
  const displayEnduranceIndex = liveIndexes?.engineIndex ?? current.endurance_index;
  const displayStrengthIndex = liveIndexes?.labIndex ?? current.strength_index;
  const indexGap = current.endurance_index - current.strength_index;
  const weakerSide: "endurance" | "strength" | "balanced" =
    indexGap < -15 ? "endurance" : indexGap > 15 ? "strength" : "balanced";

  const recovery = current.recovery_score ?? 85;
  const fatigue = current.fatigue_score ?? 15;
  const displayName =
    profile.username?.trim() ||
    profile.display_name?.split(" ")[0]?.trim() ||
    null;
  const sessionHint = buildGreetingRecommendation(
    (profile.preferred_sports ?? []) as SportType[],
    weakerSide
  );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="headline-tight text-2xl font-bold sm:text-3xl">
          {displayName ? `Welcome back, ${displayName}` : "Welcome back"}
        </h1>
        <p className="mt-1 text-sm text-muted">
          {format(new Date(), "EEEE, MMMM d")} · {sessionHint}
        </p>
      </div>

      {!hasActivities && <EmptyDashboardHero displayName={displayName} />}

      {hasActivities && (
        <HeroStatWall
          headlineLabel={headlineLabel}
          headlineValue={hasIndexHistory ? headlineValue : null}
          weeklyTrend={weeklyTrend}
          hasHistory={hasIndexHistory}
          recovery={recovery}
          fatigue={fatigue}
          streak={streakMetrics.streak}
          streakAtRisk={streakMetrics.atRisk}
          trainedToday={streakMetrics.trainedToday}
          weeklySessions={streakMetrics.weeklySessions}
          rankPercentile={rankPercentile}
          isPremium={premium}
          latestPr={(latestPersonalRecord as PersonalRecord | null) ?? null}
        />
      )}

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

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
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

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <GymZonePanel
          strengthIndex={hasIndexHistory ? current.strength_index : null}
          recentGymScores={recentGymScores}
          hasHistory={hasActivities && recentGymScores.length > 0}
        />
        <CardioZonePanel
          enduranceIndex={hasIndexHistory ? current.endurance_index : null}
          sportScores={cardioSportScores}
          hasHistory={hasActivities && cardioSportScores.length > 0}
        />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <div className="lg:col-span-8">
          <PremiumGate
            locked={!premium && history.length > 7}
            feature="90-day index history"
          >
            <SplitTrendPanel data={trendData} />
          </PremiumGate>
        </div>
        <div className="lg:col-span-4">
          <SportComparisonGrid scoresBySport={scoresBySport} />
        </div>

        <div className="lg:col-span-4">
          {premium ? (
            <NextRankCard target={nextRankTarget} />
          ) : (
            <PremiumTease
              title="Beat the next rank"
              subtitle="Unlock Premium to see exactly how many points separate you from the athlete ahead."
              showPreview={false}
              className="h-full"
            />
          )}
        </div>
        <div className="lg:col-span-4">
          <FocusWeekCard
            weakerSide={weakerSide}
            enduranceIndex={current.endurance_index}
            strengthIndex={current.strength_index}
          />
        </div>
        <div className="lg:col-span-4">
          <ConsistencyCard days={heatmapDays} />
        </div>

        <div className="lg:col-span-8 overflow-x-auto">
          <ActivityHeatmap days={heatmapDays} />
        </div>
        <div className="lg:col-span-4">
          <WeekOverWeekCard days={heatmapDays} />
        </div>

        <div className="lg:col-span-4">
          <RecommendationCard
            aiRecommendation={premium ? aiFeedback?.next_workout_recommendation ?? null : null}
            recovery={recovery}
            fatigue={fatigue}
            weakerSide={weakerSide}
          />
        </div>
        <div className="lg:col-span-4">
          <GoalsCard
            goals={(goals ?? []) as DashboardGoal[]}
            currentIndex={hasIndexHistory ? current.split_index : 0}
          />
        </div>

        <div className="lg:col-span-7">
          <RecentWorkouts activities={recentActivities ?? []} scores={scoreMap} />
        </div>
        <div className="lg:col-span-5">
          <AICoachCard
            feedback={aiFeedback ? gateAiFeedback(aiFeedback, premium) : aiFeedback}
            isPremium={premium}
          />
        </div>
      </div>

      <CompleteProfileBanner needsProfile={needsExtendedProfile} />
      <FriendInviteBanner />

      <ScoreDisclaimer className="mt-2" />
    </div>
  );
}
