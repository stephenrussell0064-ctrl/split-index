import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Radar } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { PremiumTease } from "@/components/premium/premium-tease";
import { RecoveryScoreCard } from "@/components/recovery/recovery-score-card";
import { RecoveryBreakdown } from "@/components/recovery/recovery-breakdown";
import { AlcoholStatusCard } from "@/components/recovery/alcohol-status-card";
import { DrinkLogger } from "@/components/recovery/drink-logger";
import { DrinkHistoryList } from "@/components/recovery/drink-history-list";
import { HrvEntryCard } from "@/components/recovery/hrv-entry-card";
import { SessionImpactCard } from "@/components/recovery/session-impact-card";
import { SessionTimingStrip } from "@/components/recovery/session-timing-strip";
import { WeeklyUnitsPanel } from "@/components/recovery/weekly-units-panel";
import { ScoreDisclaimer } from "@/components/legal/score-disclaimer";
import { getCrossDomainTimeline } from "@/lib/scoring/timeline";
import { computeReadiness } from "@/lib/scoring/readiness";
import { INTERFERENCE_LOOKBACK_DAYS } from "@/lib/scoring/interference-data";
import { computeRecoveryScore } from "@/lib/recovery/score";
import {
  bacCurve,
  computeSessionImpact,
  sexForWidmark,
  type SessionImpact,
} from "@/lib/recovery/alcohol";
import { dailyUnits, fetchRecoveryInputs, toDrinkEntries } from "@/lib/recovery/data";
import { canAccessProfile } from "@/lib/premium/features";
import { nextLocalHourInTz, resolveTimezone } from "@/lib/utils/timezone";

/**
 * The Recovery page.
 *
 * ONE SCORE, AND EVERYTHING BEHIND IT. The dashboard shows the number and the
 * single sentence that explains it; this is where the athlete comes to see
 * what it is made of, change the inputs, and — the part no other recovery
 * screen in this app had — find out what last night is going to cost the next
 * session.
 *
 * WHAT IS GATED, AND WHY THAT WAY ROUND. Logging is free and always will be:
 * an athlete who cannot record their own drinking has no reason to open this
 * page twice, and a paywall in front of data entry would make the score worse
 * for everybody by starving it of input. The FORECAST — what a given dose
 * costs a session at a given hour — is the analysis, and that is the paid
 * half, exactly as the Hybrid Plan gates generation while leaving an existing
 * plan readable.
 */

const UNIT_HISTORY_DAYS = 14;

/** Hoisted out of the component body: `Date.now()` inline in render trips the purity rule. */
function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

export default async function RecoveryPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "onboarding_completed, weight_kg, gender, timezone, subscription_tier, subscription_status"
    )
    .eq("user_id", user.id)
    .single();

  if (!profile?.onboarding_completed) redirect("/onboarding");

  const timeZone = resolveTimezone(profile.timezone);
  /*
   * A real paid gate, so the card-less soft trial is deliberately NOT folded
   * in — `trial.ts` is explicit that the showcase trial "is not a substitute
   * for real entitlement checks on paid-feature gates", and premium-policy.test
   * fails the build on a call site that composes the two by hand. This reads
   * the same way /analytics does, which is the closest analogue: the analysis
   * is the paid half, and logging stays free for everyone.
   */
  const premium = canAccessProfile("alcohol_impact_analysis", profile);

  const [sessions, inputs] = await Promise.all([
    getCrossDomainTimeline(supabase, user.id, {
      since: isoDaysAgo(INTERFERENCE_LOOKBACK_DAYS),
    }),
    fetchRecoveryInputs(supabase, user.id, { profileWeightKg: profile.weight_kg }),
  ]);

  const readiness = computeReadiness(sessions);
  const sex = sexForWidmark(profile.gender);
  const drinkEntries = toDrinkEntries(inputs.drinks);
  /*
   * Bodyweight drives grams-per-kilogram, so a missing one would silently
   * change the dose rather than fail. 75kg is the fallback and the page says
   * so out loud below — an unstated default here is the difference between a
   * light dose and a heavy one for a 55kg athlete.
   */
  const bodyweightKg = inputs.bodyweightKg ?? 75;

  const result = computeRecoveryScore({
    readiness,
    hrvToday: inputs.hrvToday,
    hrvBaseline: inputs.hrvBaseline,
    recentSessionDates: inputs.recentSessionDates,
    drinks: drinkEntries,
    bodyweightKg,
    sex,
    timeZone,
  });

  const now = new Date();
  const curve = bacCurve(drinkEntries, bodyweightKg, sex);
  const curvePoints = curve.points.map((p) => ({ t: p.t, bac: Math.round(p.bacGPerL * 1000) / 1000 }));

  // Three candidate session times in the athlete's own day, soonest first.
  const timingOptions: { label: string; at: Date; impact: SessionImpact }[] = [
    { label: "Early morning (7am)", at: nextLocalHourInTz(7, timeZone, now) },
    { label: "Lunchtime (1pm)", at: nextLocalHourInTz(13, timeZone, now) },
    { label: "Evening (6pm)", at: nextLocalHourInTz(18, timeZone, now) },
  ]
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .map((option) => ({
      ...option,
      impact: computeSessionImpact(result.alcohol, option.at, drinkEntries, bodyweightKg, sex),
    }));

  const nextSession = timingOptions[0];
  const hasRecentAlcohol = result.alcohol.hoursSinceLastDrink !== null;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Recovery"
        title="How recovered are you, really"
        subtitle="Training load, heart-rate variability, how often you've trained and what you drank — combined into one number, with every input shown."
      />

      <RecoveryScoreCard result={result} />

      {/* ── Alcohol ─────────────────────────────────────────────────────────
        Directly under the score, ABOVE the breakdown.

        The order used to be score → breakdown → HRV → alcohol, which put the
        one thing an athlete opens this page to DO below three things they
        open it to READ. Logging last night is the daily action here; the
        breakdown explains a number they have already seen at the top. Reading
        material that outranks the action is how a daily habit fails to form,
        so the action goes first and the explanation follows it.
      */}

      <div className="pt-2">
        <h2 className="text-xl font-semibold tracking-tight">Alcohol</h2>
        <p className="mt-1 text-sm text-muted">
          Dose is grams of ethanol against your bodyweight and sex — not a drink count. Two pints
          are a different dose for different people, and a different cost at different hours.
        </p>
      </div>

      <DrinkLogger />

      {hasRecentAlcohol && (
        <AlcoholStatusCard
          impact={result.alcohol}
          curvePoints={curvePoints}
          nowMs={now.getTime()}
          sessionMs={premium ? nextSession.at.getTime() : null}
        />
      )}

      {hasRecentAlcohol &&
        (premium ? (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <SessionImpactCard
              impact={nextSession.impact}
              sessionAt={nextSession.at}
              sessionLabel={`your next session — ${nextSession.label.toLowerCase()}`}
            />
            <SessionTimingStrip options={timingOptions} />
          </div>
        ) : (
          <PremiumTease
            title="What this costs your next session"
            subtitle="Estimated endurance and strength decrement for the hours you might train, from your own dose and bodyweight."
            ctaLabel="Unlock with Premium"
            minHeight={200}
          />
        ))}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {premium ? (
          <WeeklyUnitsPanel daily={dailyUnits(inputs.drinks, UNIT_HISTORY_DAYS)} weeklyUnits={result.alcohol.weeklyUnits} />
        ) : (
          <PremiumTease
            title="Your drinking trend"
            subtitle="Units per day over the fortnight, alcohol-free days, and where the week sits against the UK guideline."
            minHeight={200}
          />
        )}
        <DrinkHistoryList drinks={inputs.drinks} />
      </div>

      {/* ── Why the score is what it is ──────────────────────────────────
        Below the action rather than above it. The athlete has already seen
        the number at the top of the page; this is the explanation, and
        explanations do not outrank the thing you came here to do.
      */}

      <div className="pt-2">
        <h2 className="text-xl font-semibold tracking-tight">What the score is built from</h2>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <RecoveryBreakdown result={result} />
        <div className="space-y-3">
          <HrvEntryCard hrvToday={inputs.hrvToday} hrvBaseline={inputs.hrvBaseline} />

          <Link href="/analytics">
            <Card interactive className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/15">
                  <Radar className="h-5 w-5 text-accent" />
                </div>
                <div>
                  <p className="text-sm font-semibold">ACWR &amp; injury risk trend</p>
                  <p className="text-xs text-muted">
                    The load half of this score, over weeks rather than today.
                  </p>
                </div>
              </div>
              <ArrowRight className="h-4 w-4 shrink-0 text-muted" />
            </Card>
          </Link>

          {inputs.bodyweightKg === null && (
            <Card padding="lg">
              <p className="text-sm font-medium">Set your bodyweight</p>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                The alcohol model works in grams of ethanol per kilogram, so without your weight it
                assumes 75kg — which will overstate the dose if you&apos;re heavier than that and
                understate it if you&apos;re lighter.{" "}
                <Link href="/profile" className="text-accent underline underline-offset-2">
                  Add it to your profile
                </Link>
                .
              </p>
            </Card>
          )}
        </div>
      </div>

      <ScoreDisclaimer />
    </div>
  );
}
