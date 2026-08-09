import { redirect } from "next/navigation";
import Link from "next/link";
import { Activity, PlusCircle, MapPin } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { TrainZoneSwipe } from "@/components/layout/train-zone-swipe";
import { Button } from "@/components/ui/button";
import { ActivityListSection } from "@/components/activities/activity-list-section";
import { SportComparisonBars } from "@/components/activities/sport-comparison-bars";
import { formatIndex } from "@/lib/utils/format";
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
        // User feedback (Slice 10): "the engine screen isn't nice to view
        // activities" — the old 6-item mini-list forced anyone with a real
        // training history off to /activities just to see last week. 20
        // keeps this a real logbook, not just a preview of one.
        .limit(20),
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

  const cardioScoreMap = Object.fromEntries(
    (scores ?? []).map((s) => [s.activity_id as string, s.sport_index as number])
  );
  const cardioActivityRows = (activities ?? []).map((a) => ({
    id: a.id as string,
    sport: a.sport as string,
    title: a.title as string | null,
    started_at: a.started_at as string,
    duration_seconds: a.duration_seconds as number | null,
    distance_meters: a.distance_meters as number | null,
  }));

  return (
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
              <Link href="/cardio/log">
                <Button variant="secondary">
                  <PlusCircle className="h-4 w-4" />
                  Log manually
                </Button>
              </Link>
              <Link href="/cardio/gps-run">
                <Button className="bg-cardio-accent hover:bg-cardio-accent/90 text-white border-0">
                  <MapPin className="h-4 w-4" />
                  Start GPS tracking
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
            <div className="grid gap-5 lg:grid-cols-[1fr_340px] mb-8">
              <div className="bg-cardio-zone rounded-2xl border border-cardio-border/40 overflow-hidden">
                <div className="px-5 py-4 border-b border-cardio-border/30 flex items-center justify-between">
                  <p className="micro-label text-cardio-muted">Logbook</p>
                  <Link
                    href="/activities"
                    className="text-xs text-cardio-accent hover:text-cardio-accent/80"
                  >
                    Full logbook →
                  </Link>
                </div>
                <ActivityListSection items={cardioActivityRows} zone="cardio" scoreMap={cardioScoreMap} />
              </div>

              <div className="glass-cardio rounded-2xl p-6">
                <p className="micro-label text-cardio-muted mb-4">By sport</p>
                <SportComparisonBars
                  zone="cardio"
                  items={sportLeaderboard.map((s) => ({
                    label: s.sport.replace("_", " "),
                    value: s.avg,
                    displayValue: formatIndex(s.avg),
                    sublabel: `${s.count} session${s.count === 1 ? "" : "s"}`,
                  }))}
                />
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
  );
}
