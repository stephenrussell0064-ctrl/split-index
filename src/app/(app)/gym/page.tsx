import { redirect } from "next/navigation";
import Link from "next/link";
import { format } from "date-fns";
import { PlusCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { TrainZoneSwipe } from "@/components/layout/train-zone-swipe";
import { Button } from "@/components/ui/button";
import { GymStrengthPanel } from "@/components/dashboard/gym-strength-panel";
import { GymQuickStart } from "@/components/gym/gym-quick-start";
import { WorkoutPlansDisclosure } from "@/components/gym/workout-plans-disclosure";
import { RecommendedSplitCard } from "@/components/gym/recommended-split-card";
import { formatIndex, formatDuration } from "@/lib/utils/format";
import { canAccessProfile } from "@/lib/premium/features";
import {
  recommendNextGymSplit,
  GYM_RECOMMENDATION_CONFIG,
  type LoggedGymSet,
} from "@/lib/scoring/gym-recommendation";
import { requireScoringSex } from "@/lib/scoring/adapters";
import { calculateOverallDotsGl } from "@/lib/scoring/strength/overall-dots-gl";
import type { ExRxTier } from "@/lib/scoring/strength/ratio-tiers";
import type { ScoreBreakdown } from "@/types";

export default async function GymPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("onboarding_completed, subscription_tier, subscription_status, weight_kg, gender")
    .eq("user_id", user.id)
    .single();

  if (!profile?.onboarding_completed) redirect("/onboarding");

  const showDotsGl = canAccessProfile("strength_dots_gl", profile);

  const [{ data: latestIndex }, { data: gymScores }, { data: gymActivities }, { data: latestGymScore }] =
    await Promise.all([
      supabase
        .from("split_index_history")
        .select("strength_index")
        .eq("user_id", user.id)
        .order("recorded_at", { ascending: false })
        .limit(1)
        .single(),
      supabase
        .from("workout_scores")
        .select("sport_index, created_at, activity_id")
        .eq("user_id", user.id)
        .eq("sport", "gym")
        .order("created_at", { ascending: false })
        .limit(10),
      supabase
        .from("activities")
        .select("id, title, started_at, duration_seconds")
        .eq("user_id", user.id)
        .eq("sport", "gym")
        .eq("is_draft", false)
        .order("started_at", { ascending: false })
        .limit(8),
      supabase
        .from("workout_scores")
        .select("score_breakdown, sport_index")
        .eq("user_id", user.id)
        .eq("sport", "gym")
        .order("created_at", { ascending: false })
        .limit(1)
        .single(),
    ]);

  const strengthIndex = latestIndex?.strength_index ?? null;
  const hasHistory = (gymScores?.length ?? 0) > 0;
  const breakdown = (latestGymScore?.score_breakdown ?? {}) as ScoreBreakdown;

  const lifts: Array<{
    name: string;
    estimated1RM: number;
    relativeStrength: number;
    tier?: ExRxTier;
    tierLabel?: string;
  }> = [];

  if (breakdown.per_lift) {
    for (const [key, val] of Object.entries(breakdown.per_lift)) {
      if (!val) continue;
      lifts.push({
        name: key.charAt(0).toUpperCase() + key.slice(1),
        estimated1RM: val.estimated1RM,
        relativeStrength: val.relativeStrength,
      });
    }
  }

  // Overall/profile DOTS & IPF GL — the athlete's best-ever squat/bench/
  // deadlift across every logged gym session, not just the most recently
  // logged one. Shown alongside (never instead of) the per-workout number
  // so it's unambiguous which is which: user feedback flagged the dashboard
  // DOTS/GL as "wrong" against a reference calculator when it was really
  // just reflecting a single session that didn't touch all three lifts.
  const { data: allGymActivities } = await supabase
    .from("activities")
    .select("id")
    .eq("user_id", user.id)
    .eq("sport", "gym")
    .eq("is_draft", false);
  const allGymActivityIds = (allGymActivities ?? []).map((a) => a.id as string);
  const { data: allTimeExercises } =
    allGymActivityIds.length > 0
      ? await supabase
          .from("gym_exercises")
          .select("exercise_name, estimated_1rm_kg")
          .in("activity_id", allGymActivityIds)
      : { data: [] as { exercise_name: string; estimated_1rm_kg: number | null }[] };

  const overallDotsGl =
    profile?.weight_kg && profile.weight_kg > 0
      ? calculateOverallDotsGl(
          allTimeExercises ?? [],
          profile.weight_kg,
          requireScoringSex(profile.gender)
        )
      : null;

  // Balanced-split recommendation: mine muscle-group training recency/volume
  // from the same lookback window the pure engine expects, so "what should I
  // train next" reflects actual logged sets, not a generic program.
  const lookbackSince = new Date(
    Date.now() - GYM_RECOMMENDATION_CONFIG.LOOKBACK_DAYS * 86400000 // eslint-disable-line react-hooks/purity -- server component
  ).toISOString();
  const { data: recentGymActivities } = await supabase
    .from("activities")
    .select("id, started_at")
    .eq("user_id", user.id)
    .eq("sport", "gym")
    .eq("is_draft", false)
    .gte("started_at", lookbackSince);

  const activityDateById = new Map(
    (recentGymActivities ?? []).map((a) => [a.id as string, a.started_at as string])
  );
  const recentActivityIds = [...activityDateById.keys()];

  const { data: recentExercises } =
    recentActivityIds.length > 0
      ? await supabase
          .from("gym_exercises")
          .select("muscle_group, activity_id")
          .in("activity_id", recentActivityIds)
      : { data: [] as { muscle_group: string; activity_id: string }[] };

  const loggedSets: LoggedGymSet[] = (recentExercises ?? [])
    .map((e) => {
      const startedAt = activityDateById.get(e.activity_id as string);
      return startedAt ? { muscleGroup: e.muscle_group as string, startedAt } : null;
    })
    .filter((s): s is LoggedGymSet => s !== null);

  const recommendation = recommendNextGymSplit(loggedSets);

  return (
    <TrainZoneSwipe mode="gym">
      <div className="bg-gym-zone rounded-2xl overflow-hidden border border-gym-border/40 min-h-[80vh]">
        <div className="p-6 sm:p-10">
          <div className="flex flex-wrap items-start justify-between gap-4 mb-8">
            <div>
              <p className="micro-label text-gym-accent mb-2">The Lab</p>
              <h1 className="headline-tight text-3xl font-bold text-gym-text sm:text-5xl">
                Strength HQ
              </h1>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href="/gym/log">
                <Button className="bg-gym-accent hover:bg-gym-accent/90 text-[#04120a] border-0 font-semibold">
                  <PlusCircle className="h-4 w-4" />
                  Log session
                </Button>
              </Link>
            </div>
          </div>

          <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
            <div className="min-w-0">
              <GymStrengthPanel
                strengthIndex={hasHistory ? strengthIndex : null}
                dotsScore={breakdown.dots_score ?? null}
                glPoints={breakdown.gl_points ?? null}
                overallDotsScore={overallDotsGl?.dotsScore ?? null}
                overallGlPoints={overallDotsGl?.glPoints ?? null}
                overallLiftsLogged={overallDotsGl?.liftsLogged}
                lifts={lifts}
                hasHistory={hasHistory}
                showDotsGl={showDotsGl}
                className="mb-8"
              />

              {hasHistory && <RecommendedSplitCard recommendation={recommendation} className="mb-8" />}

              <WorkoutPlansDisclosure />

              {hasHistory && (
                <div className="glass-gym rounded-2xl p-6">
                  <p className="micro-label text-gym-muted mb-4">Session history</p>
                  <ul className="space-y-1">
                    {(gymActivities ?? []).map((a) => {
                      const score = gymScores?.find((s) => s.activity_id === a.id);
                      return (
                        <li
                          key={a.id as string}
                          className="flex items-center justify-between gap-2 py-3 text-sm border-b border-gym-border/30 last:border-0"
                        >
                          <Link
                            href={`/activities/${a.id}`}
                            className="min-w-0 flex-1 hover:opacity-80 transition-opacity"
                          >
                            <p className="font-medium text-gym-text truncate">
                              {(a.title as string) ?? "Gym session"}
                            </p>
                            <p className="text-xs text-gym-muted">
                              {format(new Date(a.started_at as string), "MMM d")} ·{" "}
                              {formatDuration(a.duration_seconds as number)}
                            </p>
                          </Link>
                          {score && (
                            <span className="font-mono font-semibold tabular-nums text-gym-accent">
                              {formatIndex(score.sport_index as number)}
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  <Link
                    href="/activities"
                    className="mt-4 inline-block text-xs text-gym-accent hover:text-gym-accent/80"
                  >
                    Full logbook →
                  </Link>
                </div>
              )}
            </div>

            <aside className="min-w-0 lg:sticky lg:top-24 lg:self-start">
              <GymQuickStart />
            </aside>
          </div>
        </div>
      </div>
    </TrainZoneSwipe>
  );
}
