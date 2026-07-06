import { redirect } from "next/navigation";
import Link from "next/link";
import { format } from "date-fns";
import { Dumbbell, PlusCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/layout/app-shell";
import { TrainZoneSwipe } from "@/components/layout/train-zone-swipe";
import { Button } from "@/components/ui/button";
import { GymStrengthPanel } from "@/components/dashboard/gym-strength-panel";
import { RepeatLastButton } from "@/components/activities/repeat-last-button";
import { formatIndex, formatDuration } from "@/lib/utils/format";
import { canAccessProfile } from "@/lib/premium/features";
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

  return (
    <AppShell>
      <TrainZoneSwipe mode="gym">
        <div className="bg-gym-zone rounded-2xl overflow-hidden border border-gym-border/30">
          <div className="p-6 sm:p-10">
            <div className="flex flex-wrap items-start justify-between gap-4 mb-8">
              <div>
                <p className="micro-label text-gym-muted mb-2">The Lab</p>
                <h1 className="headline-tight text-3xl font-bold text-gym-text sm:text-4xl">
                  Strength HQ
                </h1>
                <p className="mt-2 max-w-lg text-sm text-gym-muted leading-relaxed">
                  DOTS-scored SBD total with ExRx tier labels for accessories —
                  IPF GL available as secondary view.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <RepeatLastButton logHref="/gym/log" />
                <Link href="/gym/log">
                  <Button className="bg-gym-accent hover:bg-gym-accent/90 text-white border-0">
                    <PlusCircle className="h-4 w-4" />
                    Log gym session
                  </Button>
                </Link>
              </div>
            </div>

            <GymStrengthPanel
              strengthIndex={hasHistory ? strengthIndex : null}
              dotsScore={breakdown.dots_score ?? null}
              glPoints={breakdown.gl_points ?? null}
              lifts={lifts}
              hasHistory={hasHistory}
              showDotsGl={showDotsGl}
              className="mb-8"
            />

            {hasHistory && (
              <div className="grid gap-5 lg:grid-cols-2">
                <div className="glass-gym rounded-2xl p-6">
                  <p className="micro-label text-gym-muted mb-4">Recent sessions</p>
                  <ul className="space-y-1">
                    {(gymActivities ?? []).map((a) => {
                      const score = gymScores?.find((s) => s.activity_id === a.id);
                      return (
                        <li key={a.id as string}>
                          <Link
                            href={`/activities/${a.id}`}
                            className="flex items-center justify-between py-3 text-sm border-b border-gym-border/30 last:border-0 hover:bg-white/[0.02] -mx-2 px-2 rounded-lg transition-colors duration-200"
                          >
                            <div>
                              <p className="font-medium text-gym-text">
                                {(a.title as string) ?? "Gym session"}
                              </p>
                              <p className="text-xs text-gym-muted">
                                {format(new Date(a.started_at as string), "MMM d")} ·{" "}
                                {formatDuration(a.duration_seconds as number)}
                              </p>
                            </div>
                            {score && (
                              <span className="font-mono font-semibold tabular-nums text-gym-accent">
                                {formatIndex(score.sport_index as number)}
                              </span>
                            )}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                  <Link
                    href="/activities"
                    className="mt-4 inline-block text-xs text-gym-accent hover:text-gym-accent/80"
                  >
                    View all activities →
                  </Link>
                </div>
              </div>
            )}

            {!hasHistory && (
              <div className="text-center py-12 glass-gym rounded-2xl border border-gym-border/20">
                <Dumbbell className="mx-auto h-10 w-10 text-gym-accent/60 mb-4" />
                <p className="text-gym-text font-medium">No gym sessions yet</p>
                <p className="text-sm text-gym-muted mt-1">
                  Log squat, bench, and deadlift to unlock DOTS scoring
                </p>
              </div>
            )}
          </div>
        </div>
      </TrainZoneSwipe>
    </AppShell>
  );
}
