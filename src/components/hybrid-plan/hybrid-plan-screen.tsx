"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils/cn";
import { DiagnosticReport } from "./diagnostic-report";
import { EventDayView } from "./event-day-view";
import { EventOrderDecision } from "./event-order-decision";
import { PlanView, type PlanWeekView } from "./plan-view";
import type { AthleteProfile, AttemptSelection, EventDayStep, EventOrderResult, RacePacing, TaperDay } from "@/lib/scoring/hpe";

/**
 * WP9 container. Four screens behind one fetch: the plan itself, the
 * diagnostic report, the event day, and the Stage F trade-off.
 *
 * The refusal path is a first-class screen rather than an error state. Every
 * refusal this engine makes — safety block, tier 0, missing on-ramp anchor —
 * comes with concrete next steps, because the assurance review is explicit
 * that "a refusal with no next step is a churn event; a refusal with 'here is
 * who to see, come back after' is a retained user."
 */

interface PlanResponse {
  generated: boolean;
  refusal: { reason: string; nextSteps: string[] } | null;
  /** WP2: the refusal is a missing intake answer rather than a safety block, so the fix is a form the athlete can go and fill in. */
  needsIntake?: boolean;
  missingSections?: string[];
  safety?: {
    blocked: boolean;
    blocks: string[];
    warnings: string[];
    referrals: string[];
    offerGeneralPreparationInstead: boolean;
  };
  profile?: AthleteProfile;
  diagnostic?: AthleteProfile | null;
  weeks?: {
    week: number;
    phase: string;
    deload: boolean;
    enduranceMin: number;
    acwr: number;
    stressCapped: number;
    notes: string[];
    placements: {
      day: string;
      slot: string;
      session: {
        kind: string;
        domain: "endurance" | "strength";
        minutes: number;
        isQuality: boolean;
        findingId: string;
        emphasisKey: string;
        prescription: { text: string };
      };
    }[];
  }[];
  feasibility?: { messages: string[] } | null;
  eventOrder?: EventOrderResult | null;
  eventDay?: EventDayStep[] | null;
  taper?: TaperDay[];
  attempts?: AttemptSelection[];
  pacing?: RacePacing | null;
  assumptions?: string[];
  rerun?: { shouldRegenerate: boolean; explanations: string[] } | null;
  /** Generation is paused but a stored plan exists — the kill switch's defining asymmetry. */
  paused?: boolean;
  storedPlan?: { generatedAt: string; constantsVersion: string } | null;
  tailoring?: {
    level: string;
    confidence: number;
    tier: number;
    headline: string;
    explanation: string;
    unlocks: { action: string; unlocks: string }[];
    isProvisional: boolean;
  } | null;
  constantsVersion?: string;
}

type Tab = "plan" | "diagnostic" | "event";

const TABS: { id: Tab; label: string }[] = [
  { id: "plan", label: "Plan" },
  { id: "diagnostic", label: "Diagnostic" },
  { id: "event", label: "Event day" },
];

/** One mapping, used by both the live plan and a stored plan read back while generation is paused. */
function toPlanWeeks(raw: NonNullable<PlanResponse["weeks"]>): PlanWeekView[] {
  return raw.map((w) => ({
    week: w.week,
    phase: w.phase,
    deload: w.deload,
    enduranceMin: w.enduranceMin,
    acwr: w.acwr,
    stressCapped: w.stressCapped,
    notes: w.notes,
    sessions: w.placements.map((p) => ({
      kind: p.session.kind,
      domain: p.session.domain,
      day: p.day,
      slot: p.slot,
      minutes: p.session.minutes,
      isQuality: p.session.isQuality,
      findingId: p.session.findingId as PlanWeekView["sessions"][number]["findingId"],
      emphasisKey: p.session.emphasisKey,
      prescription: p.session.prescription.text,
    })),
  }));
}

export function HybridPlanScreen() {
  const [data, setData] = useState<PlanResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("plan");
  const [overrideOrder, setOverrideOrder] = useState(false);

  // Bumped to force a refetch after a failure, without duplicating the fetch
  // itself outside the effect.
  const [reloadKey, setReloadKey] = useState(0);
  const retry = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    // Deferred past the synchronous effect body so the first paint is not
    // interrupted by a state update from inside the effect.
    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/hpe/plan?overrideEventOrder=${overrideOrder}`);
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        const json = (await res.json()) as PlanResponse;
        if (!cancelled) setData(json);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load your plan.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [overrideOrder, reloadKey]);

  if (loading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-24 w-full rounded-[1.75rem]" />
        <Skeleton className="h-64 w-full rounded-[1.75rem]" />
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <h2 className="text-lg font-semibold">Could not load your plan</h2>
        <p className="mt-1 text-sm text-muted">{error}</p>
        <Button className="mt-4" onClick={retry}>
          Try again
        </Button>
      </Card>
    );
  }

  if (!data) return null;

  const profile = data.profile ?? data.diagnostic ?? null;

  const storedWeeks = data.weeks ?? [];

  // ---- paused, but the plan survives --------------------------------------
  // The kill switch stops NEW generation and leaves existing plans readable.
  // That asymmetry is the whole reason a pause is safe to perform, and it was
  // being asserted in prose next to a screen that showed no plan.
  if (!data.generated && data.paused && storedWeeks.length > 0 && profile) {
    return (
      <div className="space-y-5">
        <PageHeader
          eyebrow="Hybrid plan"
          title="Your block"
          subtitle="New plans are paused right now. This one is unchanged and still yours to train."
        />
        <Card>
          <h2 className="text-base font-semibold tracking-tight">Generation is paused</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">{data.refusal?.reason}</p>
          {data.storedPlan && (
            <p className="mt-2 text-xs text-muted/70">
              Built {new Date(data.storedPlan.generatedAt).toLocaleDateString()} under constants v
              {data.storedPlan.constantsVersion}. Nothing about it has changed.
            </p>
          )}
        </Card>
        <PlanView weeks={toPlanWeeks(storedWeeks)} profile={profile} />
      </div>
    );
  }

  // ---- refusal path -------------------------------------------------------
  if (!data.generated) {
    const blocks = data.safety?.blocks ?? [];
    const referrals = data.safety?.referrals ?? [];
    return (
      <div className="space-y-5">
        <PageHeader
          eyebrow="Hybrid plan"
          title="Not yet"
          subtitle="The engine will not build a plan it cannot stand behind."
        />
        <Card glow="none">
          <h2 className="text-lg font-semibold tracking-tight">Why</h2>
          {blocks.length > 0 ? (
            <ul className="mt-2 space-y-2">
              {blocks.map((b) => (
                <li key={b} className="text-sm leading-relaxed text-foreground/90">
                  {b}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm leading-relaxed text-foreground/90">{data.refusal?.reason}</p>
          )}

          {(data.refusal?.nextSteps.length ?? 0) > 0 && (
            <>
              <h3 className="mt-5 text-sm font-semibold uppercase tracking-widest text-muted">What to do next</h3>
              <ul className="mt-2 space-y-2">
                {data.refusal!.nextSteps.map((step) => (
                  <li key={step} className="text-sm leading-relaxed text-foreground/85">
                    {step}
                  </li>
                ))}
              </ul>
            </>
          )}

          {referrals.length > 0 && (
            <>
              <h3 className="mt-5 text-sm font-semibold uppercase tracking-widest text-muted">Who to see</h3>
              <ul className="mt-2 space-y-2">
                {referrals.map((r) => (
                  <li key={r} className="text-sm leading-relaxed text-foreground/85">
                    {r}
                  </li>
                ))}
              </ul>
            </>
          )}

          {/* WP2: an intake gap is the one refusal with an immediate fix, so it
              gets a route rather than a list of instructions. */}
          {data.needsIntake && (
            <Link
              href="/hybrid-plan/intake"
              className="mt-5 inline-flex min-h-11 items-center rounded-2xl bg-accent px-5 text-sm font-semibold text-accent-foreground transition-colors hover:bg-accent/90"
            >
              Complete your intake
            </Link>
          )}

          {data.safety?.offerGeneralPreparationInstead && (
            <p className="mt-5 rounded-2xl border border-accent/20 bg-accent/[0.06] p-4 text-sm leading-relaxed">
              A general preparation plan is appropriate for you instead. Consistent exposure is what builds a total at
              this stage, not a peak.
            </p>
          )}
        </Card>

        {profile && <DiagnosticReport profile={profile} assumptions={data.assumptions} />}
      </div>
    );
  }

  const weeks: PlanWeekView[] = toPlanWeeks(data.weeks ?? []);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Hybrid plan"
        title="Your block"
        subtitle={
          profile
            ? `Built from ${profile.findings.length} findings in your own logged history. Limiter: ${profile.limiter}.`
            : undefined
        }
      />

      {/* The four-weekly re-run, when it has fired. A plan that changes
          silently is indistinguishable from a plan that is broken. */}
      {data.rerun?.shouldRegenerate && data.rerun.explanations.length > 0 && (
        <Card glow="accent">
          <h2 className="text-base font-semibold tracking-tight">Your plan has been rebuilt</h2>
          <p className="mt-1 text-sm text-muted">Four more weeks of your data moved the diagnosis.</p>
          <ul className="mt-3 space-y-2">
            {data.rerun.explanations.map((e) => (
              <li key={e} className="text-sm leading-relaxed text-foreground/85">
                {e}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* How individual this plan actually is.
          This is the whole justification for generating a plan from thin data
          rather than refusing: the athlete gets something to do today AND an
          honest account of how much of it is them. The ramp-halving shipped
          without this, which left a provisional plan looking identical to a
          fully-diagnosed one — the refusal removed and nothing put in its
          place. */}
      {data.tailoring && (
        <Card glow={data.tailoring.isProvisional ? "none" : "accent"}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-widest text-muted">How tailored this is</p>
              <h2 className="mt-1 text-lg font-semibold tracking-tight">{data.tailoring.headline}</h2>
            </div>
            <span
              className={cn(
                "rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wider",
                data.tailoring.isProvisional ? "bg-warning/15 text-warning" : "bg-endurance/15 text-endurance"
              )}
            >
              {Math.round(data.tailoring.confidence * 100)}% confidence
            </span>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-foreground/85">{data.tailoring.explanation}</p>

          {data.tailoring.unlocks.length > 0 && (
            <div className="mt-4 rounded-2xl border border-accent/20 bg-accent/[0.06] p-4">
              <p className="text-xs font-semibold uppercase tracking-widest text-accent">
                What your next sessions unlock
              </p>
              <ul className="mt-2.5 space-y-3">
                {data.tailoring.unlocks.slice(0, 3).map((u) => (
                  <li key={u.action}>
                    <p className="text-sm font-medium text-foreground/90">{u.action}</p>
                    <p className="mt-0.5 text-sm leading-relaxed text-muted">{u.unlocks}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}

      {(data.safety?.warnings.length ?? 0) > 0 && (
        <Card>
          <h2 className="text-base font-semibold tracking-tight">Before you start</h2>
          <ul className="mt-2 space-y-2">
            {data.safety!.warnings.map((w) => (
              <li key={w} className="text-sm leading-relaxed text-warning/90">
                {w}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {(data.feasibility?.messages.length ?? 0) > 0 && (
        <Card>
          <h2 className="text-base font-semibold tracking-tight">Is the target realistic?</h2>
          <ul className="mt-2 space-y-2">
            {data.feasibility!.messages.map((m) => (
              <li key={m} className="text-sm leading-relaxed text-foreground/85">
                {m}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="flex gap-1.5 rounded-2xl bg-white/[0.03] p-1.5">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            aria-current={tab === t.id ? "page" : undefined}
            className={cn(
              "flex-1 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
              tab === t.id ? "bg-white/[0.08] text-foreground" : "text-muted hover:text-foreground"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "plan" && profile && <PlanView weeks={weeks} profile={profile} />}
      {tab === "diagnostic" && profile && <DiagnosticReport profile={profile} assumptions={data.assumptions} />}
      {tab === "event" && (
        <div className="space-y-5">
          {data.eventOrder && (
            <EventOrderDecision
              order={data.eventOrder}
              overridden={overrideOrder}
              onOverride={(confirmed) => setOverrideOrder(confirmed)}
            />
          )}
          <EventDayView
            taper={data.taper ?? []}
            eventDay={data.eventDay ?? null}
            attempts={data.attempts ?? []}
            pacing={data.pacing ?? null}
          />
        </div>
      )}

      <p className="px-1 text-xs text-muted/60">
        Something above wrong?{" "}
        <Link href="/hybrid-plan/intake" className="text-accent hover:underline">
          Update what we know about you
        </Link>{" "}
        — the plan rebuilds from it.
      </p>

      {data.constantsVersion && (
        <p className="px-1 text-xs text-muted/60">Plan generated under training constants v{data.constantsVersion}.</p>
      )}
    </div>
  );
}
