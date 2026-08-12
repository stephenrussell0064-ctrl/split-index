"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils/cn";
import type { MonitoringSnapshot } from "@/lib/scoring/hpe/monitoring";
import type { ROLLOUT_STAGES } from "@/lib/scoring/hpe/rollout";

/**
 * WP10 monitoring dashboard.
 *
 * Ordered deliberately. Alarms first, then the outcome metrics that say
 * whether the plans are any good, then the refusal breakdown, and hard-rule
 * violations last — because the assurance review's closing line is a warning
 * about exactly this screen: "Whatever dashboard you build for this, do not
 * let '0 violations' become the metric anyone watches."
 *
 * Putting the number that is almost always zero at the bottom is the cheapest
 * way to stop it being the number people watch.
 */

interface MonitoringResponse {
  snapshot: MonitoringSnapshot;
  scope: string;
  scopeNote: string;
  rollout: {
    enabled: boolean;
    percentage: number;
    note: string | null;
    updatedAt: string | null;
    stages: typeof ROLLOUT_STAGES;
    nextStage: { percentage: number; label: string; gate: string } | null;
  };
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
      <p className="text-xs uppercase tracking-wider text-muted">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </div>
  );
}

const pct = (v: number | null) => (v == null ? "—" : `${Math.round(v * 100)}%`);

export function MonitoringDashboard() {
  const [data, setData] = useState<MonitoringResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      try {
        const res = await fetch("/api/hpe/monitoring");
        if (res.ok && !cancelled) setData((await res.json()) as MonitoringResponse);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <Skeleton className="h-64 w-full rounded-[1.75rem]" />;
  if (!data) return null;

  const s = data.snapshot;

  return (
    <div className="space-y-5">
      {/* Alarms first. */}
      {s.alarms.length > 0 && (
        <Card className="border-danger/30">
          <h2 className="text-base font-semibold tracking-tight text-danger">Stop the rollout</h2>
          <ul className="mt-3 space-y-2">
            {s.alarms.map((a) => (
              <li key={a} className="text-sm leading-relaxed text-foreground/90">
                {a}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold tracking-tight">Rollout</h2>
            <p className="mt-0.5 text-sm text-muted">
              {data.rollout.enabled ? `Live at ${data.rollout.percentage}%` : "Generation is paused"}
            </p>
          </div>
          <span
            className={cn(
              "rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wider",
              data.rollout.enabled ? "bg-endurance/20 text-endurance" : "bg-danger/20 text-danger"
            )}
          >
            {data.rollout.enabled ? "Enabled" : "Kill switch on"}
          </span>
        </div>
        {data.rollout.note && <p className="mt-3 text-sm leading-relaxed text-muted">{data.rollout.note}</p>}
        {data.rollout.nextStage && (
          <div className="mt-4 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
            <p className="text-xs uppercase tracking-wider text-muted">
              Next stage — {data.rollout.nextStage.label} ({data.rollout.nextStage.percentage}%)
            </p>
            <p className="mt-1.5 text-sm leading-relaxed text-foreground/85">{data.rollout.nextStage.gate}</p>
          </div>
        )}
      </Card>

      <Card>
        <h2 className="text-base font-semibold tracking-tight">Are the plans any good?</h2>
        <p className="mt-0.5 text-sm text-muted">
          The metrics that answer the question. Constraint satisfaction is at the bottom of this page for a reason.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="Sessions logged" value={String(s.adherence.sessionsLogged)} />
          <Stat label="Completed" value={pct(s.adherence.completionRate)} />
          <Stat
            label="Hit prescription"
            value={pct(s.adherence.prescriptionHitRate)}
            hint="of completed sessions"
          />
          <Stat
            label="Mean session RPE"
            value={s.adherence.meanSessionRpe != null ? s.adherence.meanSessionRpe.toFixed(1) : "—"}
          />
          <Stat label="Low-capacity swaps" value={pct(s.adherence.lowCapacitySwapRate)} />
          <Stat
            label="Abandonment"
            value={pct(s.abandonment.abandonmentRate)}
            hint={`${s.abandonment.abandoned} of ${s.abandonment.plansGenerated}`}
          />
        </div>
      </Card>

      <Card>
        <h2 className="text-base font-semibold tracking-tight">Injuries</h2>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="Reports" value={String(s.injuries.reports)} />
          <Stat label="Attributed to plan" value={String(s.injuries.attributedToPlan)} hint="athlete's own view" />
          <Stat label="Stopped training" value={String(s.injuries.stoppedTrainingOrMedical)} />
        </div>
        <p className="mt-3 text-xs leading-relaxed text-muted/70">
          Attribution is self-reported and is not causation. It is also the only signal available, so it is shown
          rather than suppressed — and it stops a rollout advancing until each report has been read.
        </p>
      </Card>

      <Card>
        <h2 className="text-base font-semibold tracking-tight">Who is being turned away</h2>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="Attempts" value={String(s.refusals.attempts)} />
          <Stat label="Generated" value={String(s.refusals.generated)} />
          <Stat label="Safety block rate" value={pct(s.refusals.safetyBlockRate)} />
          <Stat
            label="Refusal churn"
            value={pct(s.refusals.refusalChurnRate)}
            hint={`${s.refusals.refusedUsers - s.refusals.refusedUsersWhoReturned} never came back`}
          />
        </div>
        {Object.keys(s.refusals.byReasonCode).length > 0 && (
          <div className="mt-4">
            <p className="text-xs uppercase tracking-wider text-muted">By reason</p>
            <ul className="mt-2 space-y-1.5">
              {Object.entries(s.refusals.byReasonCode)
                .sort((a, b) => b[1] - a[1])
                .map(([reason, count]) => (
                  <li key={reason} className="flex justify-between text-sm">
                    <span className="text-muted">{reason.replace(/_/g, " ")}</span>
                    <span className="font-semibold tabular-nums">{count}</span>
                  </li>
                ))}
            </ul>
          </div>
        )}
      </Card>

      <Card>
        <h2 className="text-base font-semibold tracking-tight">Is the diagnostic reaching anyone?</h2>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[0, 1, 2, 3].map((tier) => (
            <Stat key={tier} label={`Tier ${tier}`} value={String(s.tiers.byTier[tier] ?? 0)} />
          ))}
        </div>
        <p className="mt-3 text-sm text-muted">
          {pct(s.tiers.shareAtTier2OrAbove)} reach tier 2 or above. Below tier 2 the personal fatigue-resistance model
          is unavailable and bands widen.
        </p>
      </Card>

      <Card>
        <h2 className="text-base font-semibold tracking-tight">Emphasis drift</h2>
        <p className="mt-0.5 text-sm text-muted">
          How much the diagnosis moves between runs. Near-zero across the board means it has either converged or is
          not sensitive to new data, and those are worth telling apart.
        </p>
        <div className="mt-4 space-y-2">
          {Object.entries(s.drift.meanAbsoluteDrift)
            .sort((a, b) => b[1] - a[1])
            .map(([key, value]) => (
              <div key={key} className="flex items-center gap-3">
                <span className="w-36 shrink-0 text-xs text-muted">{key.replace(/_/g, " ")}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/[0.05]">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, value * 500)}%` }} />
                </div>
                <span className="w-12 shrink-0 text-right text-xs tabular-nums">{value.toFixed(3)}</span>
              </div>
            ))}
        </div>
        <p className="mt-3 text-sm text-muted">
          {pct(s.drift.shareRegenerating)} of athletes with two or more runs moved enough to rebuild their block.
        </p>
      </Card>

      <Card>
        <h2 className="text-base font-semibold tracking-tight">ACWR distribution</h2>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Below floor" value={String(s.acwr.belowFloor)} hint="on-ramp weeks" />
          <Stat label="In range" value={String(s.acwr.inRange)} />
          <Stat label="Above warn" value={String(s.acwr.aboveWarn)} />
          <Stat label="Above ceiling" value={String(s.acwr.aboveBlock)} hint="should be zero" />
        </div>
      </Card>

      {/* Last, on purpose. */}
      <Card>
        <div className="flex items-baseline justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold tracking-tight">Hard-rule violations</h2>
            <p className="mt-0.5 text-sm leading-relaxed text-muted">
              This is at the bottom because it is almost always zero, and a metric that is almost always zero is a
              metric nobody reads properly. Rev A of this engine also scored zero and was not safe to ship.
            </p>
          </div>
          <span
            className={cn(
              "text-2xl font-semibold tabular-nums",
              s.hardViolationTotal > 0 ? "text-danger" : "text-muted"
            )}
          >
            {s.hardViolationTotal}
          </span>
        </div>
      </Card>

      <p className="px-1 text-xs leading-relaxed text-muted/60">{data.scopeNote}</p>
    </div>
  );
}
