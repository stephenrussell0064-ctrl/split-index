import { redirect } from "next/navigation";
import Link from "next/link";
import { format } from "date-fns";
import { ClipboardList, PlusCircle, RotateCcw } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { TrainZoneSwipe } from "@/components/layout/train-zone-swipe";
import { Button } from "@/components/ui/button";
import { GymStrengthPanel } from "@/components/dashboard/gym-strength-panel";
import { GymQuickStart } from "@/components/gym/gym-quick-start";
import { RepeatLastButton } from "@/components/activities/repeat-last-button";
import { formatIndex, formatDuration } from "@/lib/utils/format";
import { canAccessProfile } from "@/lib/premium/features";
import { WORKOUT_PLANS } from "@/lib/constants/workout-plans";
import type { ExRxTier } from "@/lib/scoring/strength/ratio-tiers";
import type { ScoreBreakdown } from "@/types";

const LEVEL_LABELS: Record<string, string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
};

export default async function GymPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("onboarding_completed, subscription_tier, subscription_status")
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

  const recentForQuickStart = (gymActivities ?? []).map((a) => {
    const score = gymScores?.find((s) => s.activity_id === a.id);
    return {
      id: a.id as string,
      title: (a.title as string) ?? "Gym session",
      startedAt: format(new Date(a.started_at as string), "MMM d"),
      sportIndex: score ? (score.sport_index as number) : undefined,
    };
  });

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
              <RepeatLastButton logHref="/gym/log" />
              <Link href="/gym/log">
                <Button className="bg-gym-accent hover:bg-gym-accent/90 text-[#04120a] border-0 font-semibold">
                  <PlusCircle className="h-4 w-4" />
                  Log session
                </Button>
              </Link>
            </div>
          </div>

          <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
            <div>
              <GymStrengthPanel
                strengthIndex={hasHistory ? strengthIndex : null}
                dotsScore={breakdown.dots_score ?? null}
                glPoints={breakdown.gl_points ?? null}
                lifts={lifts}
                hasHistory={hasHistory}
                showDotsGl={showDotsGl}
                className="mb-8"
              />

              <div className="mb-8">
                <div className="mb-4 flex items-center gap-2">
                  <ClipboardList className="h-4 w-4 text-gym-accent" />
                  <p className="micro-label text-gym-muted">All workout plans</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {WORKOUT_PLANS.map((plan) => (
                    <Link
                      key={plan.id}
                      href={`/gym/log?plan=${plan.id}`}
                      className="group glass-gym rounded-2xl border border-gym-border/40 p-5 transition-all duration-200 hover:border-gym-accent/50 hover:shadow-[0_0_32px_-10px_var(--gym-glow)]"
                    >
                      <div className="mb-3 flex items-center justify-between">
                        <span className="rounded-full bg-gym-accent/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-gym-accent">
                          {LEVEL_LABELS[plan.level]}
                        </span>
                        <span className="text-[10px] uppercase tracking-wider text-gym-muted">
                          ~{plan.durationMinutes} min
                        </span>
                      </div>
                      <p className="font-semibold text-gym-text group-hover:text-gym-accent transition-colors">
                        {plan.name}
                      </p>
                      <p className="mt-1 text-xs text-gym-muted">{plan.focus}</p>
                      <p className="mt-3 text-xs text-gym-muted">
                        {plan.exercises.length} exercises
                      </p>
                    </Link>
                  ))}
                </div>
              </div>

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
                          <Link
                            href={`/gym/log?repeat=${a.id}`}
                            aria-label={`Repeat ${(a.title as string) ?? "gym session"}`}
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-gym-border/50 text-gym-accent transition-colors hover:bg-gym-accent/10"
                          >
                            <RotateCcw className="h-4 w-4" />
                          </Link>
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

            <aside className="lg:sticky lg:top-24 lg:self-start">
              <GymQuickStart recentSessions={recentForQuickStart} />
            </aside>
          </div>
        </div>
      </div>
    </TrainZoneSwipe>
  );
}
