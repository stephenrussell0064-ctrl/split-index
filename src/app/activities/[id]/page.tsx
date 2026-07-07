import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { format } from "date-fns";
import { Pencil } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { SportComparisonPanel } from "@/components/dashboard/sport-comparison";
import { formatIndex, formatDuration, formatDistance, formatWeight } from "@/lib/utils/format";
import { SPORT_INDEX_LABELS, SPORTS } from "@/lib/constants/sports";
import { computeSportComparison } from "@/lib/utils/sport-comparison";
import {
  buildExerciseScoreDisplays,
  formatLiftRelativeStrength,
  strengthIndexContext,
} from "@/lib/utils/scoring-display";
import { ActivityDetailActions } from "@/components/activities/activity-detail-actions";
import { CardioEnrichmentPanel } from "@/components/activities/cardio-enrichment-panel";
import { SessionScoreInsights } from "@/components/scoring/session-score-insights";
import { canAccessProfile } from "@/lib/premium/features";
import { isPremiumUser } from "@/lib/retention/trial";
import {
  extractGatedCardioInsight,
  extractGatedStrengthInsights,
} from "@/lib/scoring/activity-insights";
import type { ScoreBreakdown } from "@/types";

export default async function ActivityDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: activity } = await supabase
    .from("activities")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (!activity) notFound();

  const { data: profile } = await supabase
    .from("profiles")
    .select("gender, experience, subscription_tier, subscription_status")
    .eq("user_id", user.id)
    .single();

  const showHrAccountability = profile
    ? canAccessProfile("cardio_hr_accountability", profile)
    : false;
  const showStrengthTiers = profile
    ? canAccessProfile("strength_dots_gl", profile)
    : false;
  const isPremium = profile
    ? isPremiumUser(profile.subscription_tier, profile.subscription_status)
    : false;

  const [{ data: score }, { data: exercises }, { data: priorScores }] =
    await Promise.all([
      supabase.from("workout_scores").select("*").eq("activity_id", id).single(),
      supabase
        .from("gym_exercises")
        .select("*")
        .eq("activity_id", id)
        .order("order_index"),
      supabase
        .from("workout_scores")
        .select("sport_index, created_at")
        .eq("user_id", user.id)
        .eq("sport", activity.sport)
        .neq("activity_id", id)
        .order("created_at", { ascending: false })
        .limit(10),
    ]);

  const meta = SPORTS.find((s) => s.id === activity.sport);
  const sportIndex = score?.sport_index as number | undefined;
  const comparison = sportIndex
    ? computeSportComparison(
        sportIndex,
        (priorScores ?? []).map((s) => s.sport_index as number)
      )
    : null;

  const metadata = (activity.metadata ?? {}) as Record<string, unknown>;
  const bodyweightKg =
    typeof metadata.bodyweight_kg === "number" ? metadata.bodyweight_kg : null;

  const zone = activity.sport === "gym" ? "gym" : "cardio";
  const scoreBreakdown = (score?.score_breakdown ?? {}) as ScoreBreakdown;
  const cardioEnrichment = scoreBreakdown.cardio_enrichment;
  const gatedCardioInsight = extractGatedCardioInsight(scoreBreakdown, isPremium);
  const gatedStrengthInsights = extractGatedStrengthInsights(
    scoreBreakdown,
    exercises ?? [],
    isPremium
  );

  const exerciseBreakdown =
    activity.sport === "gym" && exercises?.length
      ? buildExerciseScoreDisplays(
          exercises.map((ex) => ({
            name: ex.exercise_name,
            estimated1RM: ex.estimated_1rm_kg ?? 0,
            relativeStrength:
              bodyweightKg && ex.estimated_1rm_kg
                ? Math.round((ex.estimated_1rm_kg / bodyweightKg) * 100) / 100
                : 0,
          })),
          profile?.gender ?? null,
          profile?.experience ?? null
        )
      : undefined;

  const strengthContext =
    activity.sport === "gym" && exerciseBreakdown?.length
      ? strengthIndexContext(
          exerciseBreakdown.reduce((s, e) => s + e.relativeStrength, 0) /
            exerciseBreakdown.length,
          profile?.gender ?? null,
          profile?.experience ?? null
        )
      : null;

  return (
    <AppShell>
      <div className="max-w-2xl mx-auto">
        <div className="flex items-start justify-between gap-4 mb-8">
          <div>
            <p className="micro-label text-muted mb-2">{SPORT_INDEX_LABELS[activity.sport as keyof typeof SPORT_INDEX_LABELS]}</p>
            <h1 className="page-title flex items-center gap-2">
              <span>{meta?.icon}</span>
              {(activity.title as string) ?? meta?.name}
            </h1>
            <p className="mt-2 text-sm text-muted tabular-nums">
              {format(new Date(activity.started_at as string), "EEEE, MMM d · h:mm a")} ·{" "}
              {formatDuration(activity.duration_seconds as number)}
              {activity.distance_meters
                ? ` · ${formatDistance(activity.distance_meters as number)}`
                : ""}
            </p>
          </div>
          <div className="flex gap-2">
            <Link href={`/activities/${id}/edit`}>
              <Button variant="secondary" size="sm">
                <Pencil className="h-4 w-4" />
                Edit
              </Button>
            </Link>
            <ActivityDetailActions
              activityId={id}
              activityTitle={(activity.title as string) ?? meta?.name ?? "Activity"}
            />
          </div>
        </div>

        {sportIndex !== undefined && (
          <div
            className={`rounded-2xl border p-8 mb-6 ${
              zone === "gym"
                ? "border-gym-border/40 bg-gym-bg-elevated/50"
                : "border-cardio-border/40 bg-cardio-bg-elevated/10"
            }`}
          >
            <p className="micro-label text-muted mb-2">Session index</p>
            <p
              className={`index-display text-5xl font-bold ${
                zone === "gym" ? "text-gym-accent" : "text-cardio-accent"
              }`}
            >
              {formatIndex(sportIndex)}
            </p>
            {strengthContext && showStrengthTiers && (
              <p className="mt-2 text-sm text-muted">{strengthContext}</p>
            )}
            {strengthContext && !showStrengthTiers && (
              <p className="mt-2 text-sm text-muted">
                Strength index {formatIndex(sportIndex)} — DOTS tier context requires
                Premium
              </p>
            )}
            {comparison && (
              <div className="mt-6 border-t border-white/10 pt-6">
                <SportComparisonPanel
                  label={SPORT_INDEX_LABELS[activity.sport as keyof typeof SPORT_INDEX_LABELS]}
                  currentScore={sportIndex}
                  comparison={comparison}
                  zone={zone}
                  exerciseBreakdown={showStrengthTiers ? exerciseBreakdown : undefined}
                />
              </div>
            )}
            {zone === "cardio" && gatedCardioInsight && (
              <div className="mt-6 border-t border-white/10 pt-6">
                <SessionScoreInsights
                  zone="cardio"
                  isPremium={isPremium}
                  cardioResult={gatedCardioInsight}
                />
              </div>
            )}
            {zone === "cardio" && !gatedCardioInsight && cardioEnrichment && (
              <div className="mt-6">
                <CardioEnrichmentPanel
                  enrichment={cardioEnrichment}
                  locked={!showHrAccountability}
                />
              </div>
            )}
            {zone === "gym" && gatedStrengthInsights && (
              <div className="mt-6 border-t border-white/10 pt-6">
                <p className="micro-label text-muted mb-3">Per-lift scoring</p>
                <SessionScoreInsights
                  zone="gym"
                  isPremium={isPremium}
                  strengthResults={gatedStrengthInsights}
                />
              </div>
            )}
          </div>
        )}

        {activity.sport === "gym" && (exercises ?? []).length > 0 && (
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6 mb-6">
            <p className="micro-label text-muted mb-4">Exercises</p>
            <ul className="space-y-3">
              {(exercises ?? []).map((ex) => {
                const ratio =
                  bodyweightKg && ex.estimated_1rm_kg
                    ? ex.estimated_1rm_kg / bodyweightKg
                    : null;
                return (
                  <li
                    key={ex.id}
                    className="flex flex-wrap items-baseline justify-between gap-2 border-b border-white/5 pb-3 last:border-0"
                  >
                    <div>
                      <p className="font-medium">{ex.exercise_name}</p>
                      <p className="text-xs text-muted">
                        {ex.sets}×{ex.reps} @ {formatWeight(ex.weight_kg)}
                        {ex.estimated_1rm_kg
                          ? ` · est. 1RM ${formatWeight(ex.estimated_1rm_kg)}`
                          : ""}
                      </p>
                    </div>
                    {ratio && (
                      <span className="text-sm font-medium text-strength tabular-nums">
                        {showStrengthTiers
                          ? formatLiftRelativeStrength(ex.exercise_name, ratio)
                          : `${ex.exercise_name}: ${ratio.toFixed(1)}× BW`}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
            {bodyweightKg && (
              <p className="mt-4 text-xs text-muted">Bodyweight: {formatWeight(bodyweightKg)}</p>
            )}
          </div>
        )}

        {activity.notes && (
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.01] p-5">
            <p className="micro-label text-muted mb-2">Notes</p>
            <p className="text-sm leading-relaxed">{activity.notes as string}</p>
          </div>
        )}
      </div>
    </AppShell>
  );
}
