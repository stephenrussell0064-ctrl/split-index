import { redirect } from "next/navigation";
import Link from "next/link";
import { PlusCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { TrainZoneSwipe } from "@/components/layout/train-zone-swipe";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";
import { GymScoreStrip } from "@/components/gym/gym-score-strip";
import { GymQuickStart } from "@/components/gym/gym-quick-start";
import { WorkoutPlansDisclosure } from "@/components/gym/workout-plans-disclosure";
import { RecommendedSplitCard } from "@/components/gym/recommended-split-card";
import { ZonePlanCard } from "@/components/hybrid-plan/zone-plan-card";
import { loadTodaysSessionPayload } from "@/components/dashboard/todays-session-data";
import { LogbookFeed } from "@/components/activities/logbook-feed";
import { fetchLogbookPage, LOGBOOK_ZONE_PAGE_SIZE } from "@/lib/activities/logbook-query";
import { canAccessProfile } from "@/lib/premium/features";
import {
  recommendNextGymSplit,
  GYM_RECOMMENDATION_CONFIG,
  type LoggedGymSet,
} from "@/lib/scoring/gym-recommendation";
import { resolveScoringSex } from "@/lib/scoring/adapters";
import { calculateOverallDotsGl } from "@/lib/scoring/strength/overall-dots-gl";
import { resolveAnchorKey } from "@/lib/scoring/split-strength-engine";
import { fetchAllTimeLiftRows, bestOneRmByKey } from "@/lib/activities/all-time-one-rm";
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
    .select(
      "onboarding_completed, subscription_tier, subscription_status, weight_kg, gender, scoring_basis"
    )
    .eq("user_id", user.id)
    .single();

  if (!profile?.onboarding_completed) redirect("/onboarding");

  const showDotsGl = canAccessProfile("strength_dots_gl", profile);

  // Balanced-split recommendation: mine muscle-group training recency/volume
  // from the same lookback window the pure engine expects, so "what should I
  // train next" reflects actual logged sets, not a generic program.
  const lookbackSince = new Date(
    Date.now() - GYM_RECOMMENDATION_CONFIG.LOOKBACK_DAYS * 86400000 // eslint-disable-line react-hooks/purity -- server component
  ).toISOString();

  /*
   * ONE ROUND OF QUERIES, NOT FOUR. This page used to await a Promise.all of
   * four selects and THEN the all-time lift rows, THEN the recent activities,
   * THEN their exercises — three extra serial round trips to the database on
   * every tap of the Strength tab, which was most of the "takes a while to
   * load the tab" the owner reported. Everything that only depends on the
   * user id now goes out together; the only thing left in series is the
   * exercise lookup, which needs the activity ids back first.
   */
  const [
    { data: latestIndex },
    { data: gymScores },
    logbookPage,
    { data: latestGymScore },
    allTimeExercises,
    { data: recentGymActivities },
    todaysSessionPayload,
  ] = await Promise.all([
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
      .limit(20),
    // The Lab's session history. User feedback (Slice 10): "not nice to
    // view activities" — the list was capped at 8, then 20, with nothing
    // to say more existed. It now opens on a page and keeps paging through
    // /api/activities/logbook, with the running "showing N of M" count and
    // a link into the full cross-zone logbook.
    fetchLogbookPage(supabase, user.id, {
      zone: "gym",
      limit: LOGBOOK_ZONE_PAGE_SIZE,
    }),
    supabase
      .from("workout_scores")
      .select("score_breakdown, sport_index")
      .eq("user_id", user.id)
      .eq("sport", "gym")
      .order("created_at", { ascending: false })
      .limit(1)
      .single(),
    // Overall/profile DOTS & IPF GL — the athlete's best-ever squat/bench/
    // deadlift across every logged gym session, not just the most recently
    // logged one. From strength_scores, not gym_exercises — the two hold
    // DIFFERENT numbers for the same lift. See lib/activities/all-time-one-rm.ts.
    fetchAllTimeLiftRows(supabase, user.id),
    supabase
      .from("activities")
      .select("id, started_at")
      .eq("user_id", user.id)
      .eq("sport", "gym")
      .eq("is_draft", false)
      .gte("started_at", lookbackSince),
    // Today's prescribed session from the stored hybrid plan — the same two
    // selects the dashboard band uses, never the generating endpoint.
    loadTodaysSessionPayload(supabase, user.id),
  ]);

  const strengthIndex = latestIndex?.strength_index ?? null;
  const hasHistory = (gymScores?.length ?? 0) > 0;
  const breakdown = (latestGymScore?.score_breakdown ?? {}) as ScoreBreakdown;

  const overallDotsGl =
    profile?.weight_kg && profile.weight_kg > 0
      ? calculateOverallDotsGl(
          allTimeExercises,
          profile.weight_kg,
          resolveScoringSex(profile)
        )
      : null;

  // Best ever per lift, from every logged session rather than from the latest
  // one — the same reasoning (and the same already-fetched rows) as the
  // all-time DOTS/GL pair above. Keyed by resolved anchor key so the free-text
  // names athletes actually type ("Bench Press", "Sumo Deadlift") line up with
  // the canonical per_lift keys below.
  const allTime1RmByLift = bestOneRmByKey(allTimeExercises, resolveAnchorKey);

  // per_lift and strength_activities come from the same scoring pass over the
  // same session, so a lift present in one is present in the other — the
  // engine result is where the recency-aware current 1RM lives.
  const strengthResults = breakdown.strength_activities ?? [];

  const lifts: Array<{
    name: string;
    estimated1RM: number;
    currentOneRM?: number;
    allTimeOneRM?: number;
    relativeStrength: number;
    tier?: ExRxTier;
    tierLabel?: string;
  }> = [];

  if (breakdown.per_lift) {
    for (const [key, val] of Object.entries(breakdown.per_lift)) {
      if (!val) continue;
      const result = strengthResults.find((r) => r.liftKey === key);
      lifts.push({
        name: key.charAt(0).toUpperCase() + key.slice(1),
        estimated1RM: val.estimated1RM,
        currentOneRM: result?.currentOneRM,
        // All three are the engine's own figure now, so this max compares like
        // with like: the stored history, whatever the engine remembers of it,
        // and this session.
        allTimeOneRM: Math.max(
          allTime1RmByLift.get(key) ?? 0,
          result?.allTimeOneRM ?? 0,
          val.estimated1RM
        ),
        relativeStrength: val.relativeStrength,
      });
    }
  }

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
      <div className="bg-gym-zone rounded-2xl overflow-hidden border border-gym-border/40 min-h-[80dvh]">
        <div className="p-4 sm:p-10">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="micro-label text-gym-accent mb-1.5">Strength · The Lab</p>
              <h1 className="headline-tight text-3xl font-bold text-gym-text sm:text-5xl">
                Strength
              </h1>
              {/*
                Shown at every width, unlike the Engine's old desktop-only
                paragraph: this is the one line that tells a new athlete what
                the tab they just tapped actually holds, and a phone is where
                they are reading it.
              */}
              <p className="mt-2 max-w-lg text-sm text-gym-muted leading-relaxed">
                Your gym sessions, best lifts and strength score. Log a session and it is
                scored straight away.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                href="/gym/log"
                className={cn(buttonVariants(), "bg-gym-accent hover:bg-gym-accent/90 text-[#04120a] border-0 font-semibold")}
              >
                <PlusCircle className="h-4 w-4" />
                Log session
              </Link>
            </div>
          </div>

          {/*
            SAME ORDER AS BEFORE, LESS AIR. The owner's ask was for the logbook
            to arrive sooner WITHOUT the preset plans or the recommended
            session moving: "just excess space which is not being used to be
            moved around". So the sequence is unchanged — scores, today's
            plan, the recommended split, the plan browser, the preset plans,
            then the session history — and the height came out of the parts:
            the scores are a strip rather than a hero, every gap is 12px
            rather than 32, the recommended split is one row of chips, and
            the preset-plan tiles are shorter. On a 390px phone the logbook
            heading now lands roughly a screen earlier than it did.
          */}
          <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
            <div className="min-w-0 space-y-3">
              <GymScoreStrip
                strengthIndex={hasHistory ? strengthIndex : null}
                dotsScore={breakdown.dots_score ?? null}
                glPoints={breakdown.gl_points ?? null}
                overallDotsScore={overallDotsGl?.dotsScore ?? null}
                overallGlPoints={overallDotsGl?.glPoints ?? null}
                overallLiftsLogged={overallDotsGl?.liftsLogged}
                lifts={lifts}
                hasHistory={hasHistory}
                showDotsGl={showDotsGl}
              />

              <ZonePlanCard zone="gym" payload={todaysSessionPayload} />

              {hasHistory && <RecommendedSplitCard recommendation={recommendation} />}

              <WorkoutPlansDisclosure />

              {/*
                Quick start on a phone, where it always was. The right rail
                below is a sticky sidebar on desktop; on a phone the grid
                collapses to one column and the aside would render last, so
                the phone gets its own copy here and the aside is hidden
                below `xl` — one of the two renders at any width, never both.
              */}
              <div className="xl:hidden">
                <GymQuickStart compact />
              </div>

              {/* Keyed off logged sessions, not scored ones: an unscored
                  session is still a session the athlete logged and expects
                  to find here. */}
              {logbookPage.total > 0 && (
                <LogbookFeed
                  initialPage={logbookPage}
                  surface="gym"
                  mode="zone"
                  zone="gym"
                  pageSize={LOGBOOK_ZONE_PAGE_SIZE}
                  title="Session history"
                  viewAllHref="/activities?zone=gym"
                />
              )}
            </div>

            <aside className="hidden min-w-0 xl:sticky xl:top-24 xl:block xl:self-start">
              <GymQuickStart />
            </aside>
          </div>
        </div>
      </div>
    </TrainZoneSwipe>
  );
}
