import { redirect } from "next/navigation";
import Link from "next/link";
import { Activity, PlusCircle, MapPin } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { TrainZoneSwipe } from "@/components/layout/train-zone-swipe";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";
import { LogbookFeed } from "@/components/activities/logbook-feed";
import { fetchLogbookPage, LOGBOOK_ZONE_PAGE_SIZE } from "@/lib/activities/logbook-query";
import { SportComparisonBars } from "@/components/activities/sport-comparison-bars";
import { ZonePlanCard } from "@/components/hybrid-plan/zone-plan-card";
import { loadTodaysSessionPayload } from "@/components/dashboard/todays-session-data";
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

  const [{ data: latestIndex }, { data: scores }, logbookPage, todaysSessionPayload] =
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
      // The Engine's session history. User feedback (Slice 10): "the engine
      // screen isn't nice to view activities" — successive fixes just raised
      // the cap (6, then 20) without ever making the rest reachable. It now
      // pages through /api/activities/logbook and says how much it is
      // showing, so the cap stops being a silent wall.
      fetchLogbookPage(supabase, user.id, {
        zone: "cardio",
        limit: LOGBOOK_ZONE_PAGE_SIZE,
      }),
      // Today's prescribed session from the stored hybrid plan — the same
      // two selects the dashboard band uses, never the generating endpoint.
      loadTodaysSessionPayload(supabase, user.id),
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

  const topSports = sportLeaderboard.slice(0, 3);
  const topMax = Math.max(...topSports.map((s) => s.avg), 1);

  return (
    <TrainZoneSwipe mode="cardio">
      <div className="bg-cardio-zone rounded-2xl overflow-hidden border border-cardio-border/40">
        <div className="p-4 sm:p-10">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="micro-label text-cardio-accent mb-1.5">The Engine</p>
              <h1 className="headline-tight text-3xl font-bold text-cardio-text sm:text-4xl">
                Endurance HQ
              </h1>
              {/* Hidden on phones: at 390px this wrapped to five lines of
                  product copy on a screen the athlete opens daily. */}
              <p className="mt-2 hidden max-w-lg text-sm text-cardio-muted leading-relaxed sm:block">
                Pace, split, and W/kg vs sport-specific benchmarks — ranked against your
                own session history.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href="/cardio/log" className={buttonVariants({ variant: "secondary" })}>
                <PlusCircle className="h-4 w-4" />
                Log manually
              </Link>
              <Link
                href="/cardio/gps-run"
                className={cn(buttonVariants(), "bg-cardio-accent hover:bg-cardio-accent/90 text-cardio-text border-0")}
              >
                <MapPin className="h-4 w-4" />
                Start GPS tracking
              </Link>
            </div>
          </div>

          {/*
            ONE STRIP, NOT A HERO. The Endurance Blend used to be a card on its
            own: a 72px number, a label and a caption, 215px tall before
            anything the athlete could act on (owner: the scores "take up too
            much space when u first click on the tab"). It is now one row —
            the index on the left, the three strongest sports as thin bars on
            the right — and the full by-sport comparison keeps its own card
            beside the logbook on wide screens.
          */}
          <div className="glass-cardio mb-4 rounded-2xl p-4 sm:p-5">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0 shrink-0">
                <p className="micro-label text-cardio-muted">Endurance Blend</p>
                {hasHistory && enduranceIndex !== null ? (
                  <>
                    <p className="index-display mt-1 text-4xl font-bold text-cardio-accent sm:text-5xl">
                      {formatIndex(enduranceIndex)}
                    </p>
                    <p className="mt-1 text-[11px] text-cardio-muted">
                      Across {ENDURANCE_SPORTS.length} endurance sports
                    </p>
                  </>
                ) : (
                  <>
                    <p className="mt-1 text-base font-semibold text-cardio-text/90">
                      Log a session to build your index
                    </p>
                    <p className="mt-1 text-[11px] text-cardio-muted">
                      e.g. 5k pace vs intermediate benchmark + your running history
                    </p>
                  </>
                )}
              </div>

              {topSports.length > 0 && (
                <ul className="min-w-0 flex-1 space-y-1.5 sm:max-w-xs">
                  {topSports.map((s) => (
                    <li key={s.sport} className="min-w-0">
                      <div className="flex items-baseline justify-between gap-2 text-[11px]">
                        <span className="truncate font-medium capitalize text-cardio-text">
                          {s.sport.replace("_", " ")}
                        </span>
                        <span className="shrink-0 font-mono font-semibold tabular-nums text-cardio-text">
                          {formatIndex(s.avg)}
                        </span>
                      </div>
                      <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-cardio-border/25">
                        <div
                          className="h-full rounded-full bg-cardio-accent"
                          style={{ width: `${Math.max(4, (s.avg / topMax) * 100)}%` }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <ZonePlanCard zone="cardio" payload={todaysSessionPayload} className="mb-4" />

          {/* Driven by logged sessions rather than the sport leaderboard —
              the logbook used to be nested inside the leaderboard's own
              condition, so an athlete with sessions but no scores yet saw no
              logbook at all. */}
          {logbookPage.total > 0 && (
            <div className="grid gap-4 lg:grid-cols-[1fr_340px] mb-6">
              <LogbookFeed
                initialPage={logbookPage}
                surface="cardio"
                mode="zone"
                zone="cardio"
                pageSize={LOGBOOK_ZONE_PAGE_SIZE}
                title="Session history"
                viewAllHref="/activities?zone=cardio"
              />

              {sportLeaderboard.length > 0 && (
                <div className="glass-cardio rounded-2xl p-5 lg:self-start">
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
              )}
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
