"use client";

import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils/cn";
import type { MonitoringSnapshot } from "@/lib/scoring/hpe/monitoring";

/**
 * Fleet operations view. This is the screen the kill-switch decision is made
 * from, so it is ordered by what an operator in an incident actually needs:
 * alarms, then the switch itself, then the evidence.
 *
 * Aggregate-only by construction — the endpoint refuses to serialise a UUID
 * or an email. An operator deciding whether to pause a rollout needs
 * distributions, not a list of who is injured.
 */

interface FleetResponse {
  scope: "fleet";
  windowDays: number;
  populationSize: number;
  truncated: boolean;
  snapshot: MonitoringSnapshot;
  reviewRecorded: boolean;
  rollout: {
    enabled: boolean;
    percentage: number;
    note: string | null;
    updatedAt: string | null;
    stages: { percentage: number; label: string; gate: string }[];
    nextStage: { percentage: number; label: string; gate: string } | null;
    gate: { allowed: boolean; reason: string | null; isDeEscalation: boolean } | null;
    canChange: boolean;
  };
}

const pct = (v: number | null) => (v == null ? "—" : `${Math.round(v * 100)}%`);

function Stat({ label, value, hint, alarm }: { label: string; value: string; hint?: string; alarm?: boolean }) {
  return (
    <div
      className={cn(
        "rounded-2xl border p-4",
        alarm ? "border-danger/30 bg-danger/[0.06]" : "border-white/[0.06] bg-white/[0.02]"
      )}
    >
      <p className="text-xs uppercase tracking-wider text-muted">{label}</p>
      <p className={cn("mt-1 text-xl font-semibold tabular-nums", alarm && "text-danger")}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function FleetDashboard() {
  const [data, setData] = useState<FleetResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      setLoading(true);
      try {
        const res = await fetch("/api/hpe/admin/fleet");
        if (res.status === 404 || res.status === 401) {
          if (!cancelled) setForbidden(true);
          return;
        }
        if (res.ok && !cancelled) setData((await res.json()) as FleetResponse);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const changeRollout = useCallback(
    async (payload: { enabled?: boolean; percentage?: number }) => {
      setBusy(true);
      setActionError(null);
      try {
        const res = await fetch("/api/hpe/admin/rollout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, reason }),
        });
        const json = await res.json();
        if (!res.ok) {
          setActionError(json.error ?? "The change was refused.");
          return;
        }
        setReason("");
        setReloadKey((k) => k + 1);
      } catch (e) {
        setActionError(e instanceof Error ? e.message : "The change failed.");
      } finally {
        setBusy(false);
      }
    },
    [reason]
  );

  if (loading) return <p className="text-sm text-muted">Loading fleet view…</p>;

  if (forbidden || !data) {
    return (
      <Card>
        <h2 className="text-lg font-semibold">Not available</h2>
        <p className="mt-1 text-sm text-muted">
          This view needs an admin role. Roles are granted directly in the database — there is deliberately no
          in-app path to grant one.
        </p>
      </Card>
    );
  }

  const s = data.snapshot;
  const smallPopulation = data.populationSize < 20;

  return (
    <div className="space-y-5">
      {/* 1. Alarms. */}
      {s.alarms.length > 0 ? (
        <Card className="border-danger/30">
          <h2 className="text-base font-semibold tracking-tight text-danger">
            {s.alarms.length} alarm{s.alarms.length === 1 ? "" : "s"} — do not advance the rollout
          </h2>
          <ul className="mt-3 space-y-2">
            {s.alarms.map((a) => (
              <li key={a} className="text-sm leading-relaxed text-foreground/90">
                {a}
              </li>
            ))}
          </ul>
        </Card>
      ) : (
        <Card className="border-endurance/25">
          <p className="text-sm font-semibold text-endurance">No alarms across the fleet.</p>
          <p className="mt-1 text-sm text-muted">
            Necessary, not sufficient. Rev A of this engine also had a clean board and was not safe to ship.
          </p>
        </Card>
      )}

      {/* 2. The switch. */}
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold tracking-tight">Rollout control</h2>
            <p className="mt-0.5 text-sm text-muted">
              {data.rollout.enabled ? `Live at ${data.rollout.percentage}%` : "Generation is paused"}
              {data.rollout.updatedAt && ` · changed ${new Date(data.rollout.updatedAt).toLocaleDateString()}`}
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

        {data.rollout.canChange ? (
          <div className="mt-5 space-y-3">
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why are you making this change?"
              aria-label="Reason for the rollout change"
            />
            <div className="flex flex-wrap gap-2">
              {/* Never gated. Turning it off must always be the easiest thing
                  on this screen. */}
              <Button
                variant="destructive"
                size="sm"
                disabled={busy || reason.trim().length < 8 || !data.rollout.enabled}
                onClick={() => void changeRollout({ enabled: false })}
              >
                Kill switch
              </Button>
              {data.rollout.nextStage && (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busy || reason.trim().length < 8 || data.rollout.gate?.allowed === false}
                  onClick={() =>
                    void changeRollout({ enabled: true, percentage: data.rollout.nextStage!.percentage })
                  }
                >
                  Advance to {data.rollout.nextStage.label} ({data.rollout.nextStage.percentage}%)
                </Button>
              )}
            </div>

            {data.rollout.gate?.allowed === false && (
              <p className="rounded-2xl border border-warning/25 bg-warning/[0.06] p-3 text-sm leading-relaxed text-warning/90">
                {data.rollout.gate.reason}
              </p>
            )}
            {actionError && (
              <p className="rounded-2xl border border-danger/25 bg-danger/[0.06] p-3 text-sm leading-relaxed text-danger">
                {actionError}
              </p>
            )}
          </div>
        ) : (
          <p className="mt-4 text-sm text-muted">Your role is read-only. Changing the rollout needs the operator role.</p>
        )}

        {data.rollout.nextStage && (
          <div className="mt-4 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
            <p className="text-xs uppercase tracking-wider text-muted">
              Gate for {data.rollout.nextStage.label}
            </p>
            <p className="mt-1.5 text-sm leading-relaxed text-foreground/85">{data.rollout.nextStage.gate}</p>
          </div>
        )}
      </Card>

      {/* 3. The evidence. */}
      <Card>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold tracking-tight">Population</h2>
          <span className="text-sm text-muted">last {data.windowDays} days</span>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="Athletes" value={String(data.populationSize)} />
          <Stat label="Attempts" value={String(s.refusals.attempts)} />
          <Stat label="Plans generated" value={String(s.refusals.generated)} />
        </div>
        {smallPopulation && (
          <p className="mt-3 text-sm leading-relaxed text-warning/90">
            Fewer than 20 athletes in this window. Every rate below is noise at this size — read it as a smoke test,
            not as evidence for advancing a rollout.
          </p>
        )}
        {data.truncated && (
          <p className="mt-3 text-sm text-warning/90">
            Row cap reached — these figures cover a truncated window and under-report totals.
          </p>
        )}
      </Card>

      <Card>
        <h2 className="text-base font-semibold tracking-tight">Adherence and abandonment</h2>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="Sessions logged" value={String(s.adherence.sessionsLogged)} />
          <Stat label="Completed" value={pct(s.adherence.completionRate)} />
          <Stat label="Hit prescription" value={pct(s.adherence.prescriptionHitRate)} hint="of completed" />
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
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Reports" value={String(s.injuries.reports)} />
          <Stat
            label="Attributed to plan"
            value={String(s.injuries.attributedToPlan)}
            alarm={s.injuries.attributedToPlan > 0}
          />
          <Stat
            label="Stopped training"
            value={String(s.injuries.stoppedTrainingOrMedical)}
            alarm={s.injuries.stoppedTrainingOrMedical > 0}
          />
          <Stat label="Niggles" value={String(s.injuries.bySeverity.niggle ?? 0)} />
        </div>
        <p className="mt-3 text-xs leading-relaxed text-muted/70">
          Attribution is self-reported and is not causation. It is also the only signal available, so it is shown
          rather than suppressed — and any non-zero figure stops the rollout advancing until each report has been read.
        </p>
      </Card>

      <Card>
        <h2 className="text-base font-semibold tracking-tight">Safety-screen blocks by reason</h2>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="Safety block rate" value={pct(s.refusals.safetyBlockRate)} />
          <Stat
            label="Refusal churn"
            value={pct(s.refusals.refusalChurnRate)}
            hint={`${s.refusals.refusedUsers - s.refusals.refusedUsersWhoReturned} never returned`}
          />
          <Stat label="Refused athletes" value={String(s.refusals.refusedUsers)} />
        </div>
        {Object.keys(s.refusals.byReasonCode).length > 0 ? (
          <ul className="mt-4 space-y-1.5">
            {Object.entries(s.refusals.byReasonCode)
              .sort((a, b) => b[1] - a[1])
              .map(([code, count]) => (
                <li key={code} className="flex justify-between text-sm">
                  <span className="text-muted">{code.replace(/_/g, " ")}</span>
                  <span className="font-semibold tabular-nums">{count}</span>
                </li>
              ))}
          </ul>
        ) : (
          <p className="mt-4 text-sm text-muted">No refusals in this window.</p>
        )}
        <p className="mt-3 text-xs leading-relaxed text-muted/70">
          A high block rate on one reason is a screening question doing its job. A high churn rate on the same reason
          is a refusal with no usable next step, which is a different problem with a different fix.
        </p>
      </Card>

      <Card>
        <h2 className="text-base font-semibold tracking-tight">Data-sufficiency tiers</h2>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[0, 1, 2, 3].map((tier) => (
            <Stat key={tier} label={`Tier ${tier}`} value={String(s.tiers.byTier[tier] ?? 0)} />
          ))}
        </div>
        <p className="mt-3 text-sm text-muted">
          {pct(s.tiers.shareAtTier2OrAbove)} reach tier 2 or above — the question that decides whether any other
          number on this page describes the product or describes a handful of unusual accounts.
        </p>
      </Card>

      <Card>
        <h2 className="text-base font-semibold tracking-tight">ACWR distribution</h2>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Below floor" value={String(s.acwr.belowFloor)} hint="on-ramp weeks" />
          <Stat label="In range" value={String(s.acwr.inRange)} />
          <Stat label="Above warn" value={String(s.acwr.aboveWarn)} />
          <Stat label="Above ceiling" value={String(s.acwr.aboveBlock)} alarm={s.acwr.aboveBlock > 0} />
        </div>
        <p className="mt-3 text-sm text-muted">
          Peak observed: {s.acwr.peakObserved != null ? s.acwr.peakObserved.toFixed(2) : "—"}. Anything above the
          ceiling means enforcement failed, not that an athlete trained hard.
        </p>
      </Card>

      <Card>
        <div className="flex items-baseline justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold tracking-tight">Hard-rule violations</h2>
            <p className="mt-0.5 text-sm leading-relaxed text-muted">
              Last, on purpose. It is almost always zero, and a metric that is almost always zero is a metric nobody
              reads properly.
            </p>
          </div>
          <span
            className={cn("text-2xl font-semibold tabular-nums", s.hardViolationTotal > 0 ? "text-danger" : "text-muted")}
          >
            {s.hardViolationTotal}
          </span>
        </div>
      </Card>

      <p className="px-1 text-xs leading-relaxed text-muted/60">
        Aggregate-only: no user id, email or per-athlete row is served by this endpoint, and the response is checked
        for both before it is sent. {data.reviewRecorded && "Opening this view recorded a fleet review."}
      </p>
    </div>
  );
}
