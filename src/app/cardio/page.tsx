import { redirect } from "next/navigation";
import Link from "next/link";
import { format } from "date-fns";
import { Activity, PlusCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/layout/app-shell";
import { TrainZoneSwipe } from "@/components/layout/train-zone-swipe";
import { Button } from "@/components/ui/button";
import { RepeatLastButton } from "@/components/activities/repeat-last-button";
import { formatIndex, formatDuration, formatDistance } from "@/lib/utils/format";
import { SPORT_INDEX_LABELS, ENDURANCE_SPORTS } from "@/lib/constants/sports";
import type { SportType } from "@/types";

export default async function CardioPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("onboarding_completed")
    .eq("user_id", user.id)
    .single();

  if (!profile?.onboarding_completed) redirect("/onboarding");

  const [{ data: latestIndex }, { data: scores }, { data: activities }] =
    await Promise.all([
      supabase
        .from("split_index_history")
        .select("endurance_index")
        .eq("user_id", user.id)
        .order("recorded_at", { ascending: false })
        .limit(1)
        .single(),
      supabase
        .from("workout_scores")
        .select("sport, sport_index, created_at, activity_id")
        .eq("user_id", user.id)
        .neq("sport", "gym")
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("activities")
        .select("id, sport, title, started_at, duration_seconds, distance_meters")
        .eq("user_id", user.id)
        .neq("sport", "gym")
        .eq("is_draft", false)
        .order("started_at", { ascending: false })
        .limit(10),
    ]);

  const enduranceIndex = latestIndex?.endurance_index ?? null;
  const hasHistory = (scores?.length ?? 0) > 0;

  const sportAgg = new Map<string, { sum: number; count: number }>();
  for (const s of scores ?? []) {
    const key = s.sport as string;
    const agg = sportAgg.get(key) ?? { sum: 0, count: 0 };
    agg.sum += s.sport_index as number;
    agg.count += 1;
    sportAgg.set(key, agg);
  }

  const sportLeaderboard = Array.from(sportAgg, ([sport, agg]) => ({
    sport: sport as SportType,
    avg: Math.round(agg.sum / agg.count),
    count: agg.count,
    label: SPORT_INDEX_LABELS[sport as SportType] ?? sport,
  })).sort((a, b) => b.avg - a.avg);

  return (
    <AppShell>
      <TrainZoneSwipe mode="cardio">
        <div className="bg-cardio-zone rounded-2xl overflow-hidden border border-cardio-border/40">
          <div className="p-6 sm:p-10">
            <div className="flex flex-wrap items-start justify-between gap-4 mb-8">
              <div>
                <p className="micro-label text-cardio-accent mb-2">The Engine</p>
                <h1 className="headline-tight text-3xl font-bold text-cardio-text sm:text-4xl">
                  Endurance HQ
                </h1>
                <p className="mt-2 max-w-lg text-sm text-cardio-muted leading-relaxed">
                  Pace, split, and W/kg vs sport-specific benchmarks — ranked against your
                  own session history.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <RepeatLastButton logHref="/cardio/log" />
                <Link href="/cardio/log">
                  <Button className="bg-cardio-accent hover:bg-cardio-accent/90 text-white border-0">
                    <PlusCircle className="h-4 w-4" />
                    Log cardio session
                  </Button>
                </Link>
              </div>
            </div>

            <div className="glass-cardio rounded-2xl p-8 mb-8">
              <p className="micro-label text-cardio-muted mb-2">Endurance Blend</p>
              {hasHistory && enduranceIndex !== null ? (
                <>
                  <p className="index-display text-6xl font-bold text-cardio-accent sm:text-7xl">
                    {formatIndex(enduranceIndex)}
                  </p>
                  <p className="mt-2 text-sm text-cardio-muted">
                    Composite across {ENDURANCE_SPORTS.length} endurance sports
                  </p>
                </>
              ) : (
                <>
                  <p className="text-xl font-semibold text-cardio-text/90">
                    Log workouts to build your endurance index
                  </p>
                  <p className="mt-2 text-sm text-cardio-muted">
                    e.g. 5k pace vs intermediate benchmark + your running history
                  </p>
                </>
              )}
            </div>

            {sportLeaderboard.length > 0 && (
              <div className="grid gap-5 lg:grid-cols-2 mb-8">
                <div className="glass-cardio rounded-2xl p-6">
                  <p className="micro-label text-cardio-muted mb-4">By sport</p>
                  <ul className="space-y-3">
                    {sportLeaderboard.map((s) => (
                      <li key={s.sport} className="flex items-center justify-between">
                        <div>
                          <p className="font-medium text-cardio-text capitalize">
                            {s.sport.replace("_", " ")}
                          </p>
                          <p className="text-xs text-cardio-muted">{s.count} sessions</p>
                        </div>
                        <span className="font-mono text-lg font-semibold tabular-nums text-cardio-accent">
                          {formatIndex(s.avg)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="glass-cardio rounded-2xl p-6">
                  <p className="micro-label text-cardio-muted mb-4">Latest sessions</p>
                  <ul className="space-y-1">
                    {(activities ?? []).slice(0, 6).map((a) => {
                      const score = scores?.find((s) => s.activity_id === a.id);
                      return (
                        <li key={a.id as string}>
                          <Link
                            href={`/activities/${a.id}`}
                            className="flex items-center justify-between py-3 text-sm border-b border-cardio-border/30 last:border-0 hover:bg-black/[0.02] -mx-2 px-2 rounded-lg transition-colors duration-200"
                          >
                            <div>
                              <p className="font-medium text-cardio-text capitalize">
                                {(a.title as string) ?? (a.sport as string).replace("_", " ")}
                              </p>
                              <p className="text-xs text-cardio-muted">
                                {format(new Date(a.started_at as string), "MMM d")} ·{" "}
                                {formatDuration(a.duration_seconds as number)}
                                {a.distance_meters
                                  ? ` · ${formatDistance(a.distance_meters as number)}`
                                  : ""}
                              </p>
                            </div>
                            {score && (
                              <span className="font-mono font-semibold tabular-nums text-cardio-accent">
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
                    className="mt-4 inline-block text-xs text-cardio-accent hover:text-cardio-accent/80"
                  >
                    View all activities →
                  </Link>
                </div>
              </div>
            )}

            {!hasHistory && (
              <div className="text-center py-12 glass-cardio rounded-2xl border border-cardio-border/30">
                <Activity className="mx-auto h-10 w-10 text-cardio-accent/60 mb-4" />
                <p className="text-cardio-text font-medium">No cardio sessions yet</p>
                <p className="text-sm text-cardio-muted mt-1">
                  Log a run, row, or swim to unlock The Engine
                </p>
              </div>
            )}
          </div>
        </div>
      </TrainZoneSwipe>
    </AppShell>
  );
}
