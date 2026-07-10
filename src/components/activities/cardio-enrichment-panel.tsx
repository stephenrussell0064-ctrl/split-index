"use client";

import { formatIndex } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";
import { PremiumTease } from "@/components/premium/premium-tease";
import type { CardioEnrichment } from "@/lib/scoring/cardio";

function EnrichmentContent({
  enrichment,
}: {
  enrichment: CardioEnrichment;
}) {
  const displayIndex = enrichment.adjustedDisplayIndex ?? enrichment.sportIndex;

  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="micro-label text-cardio-muted">Aerobic insights</p>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider",
            enrichment.confidence === "high" && "bg-success/15 text-success",
            enrichment.confidence === "medium" && "bg-warning/15 text-warning",
            enrichment.confidence === "low" && "bg-muted/20 text-muted"
          )}
        >
          {enrichment.confidence} confidence
        </span>
      </div>

      {enrichment.adjustedDisplayIndex !== undefined &&
        enrichment.adjustedDisplayIndex !== enrichment.sportIndex && (
          <p className="text-xs text-muted">
            Display index{" "}
            <span className="font-mono font-semibold text-cardio-accent tabular-nums">
              {formatIndex(displayIndex)}
            </span>{" "}
            (core index {formatIndex(enrichment.sportIndex)} — HR unverified)
          </p>
        )}

      <dl className="grid gap-2 sm:grid-cols-2">
        {enrichment.vo2maxEstimate && (
          <div>
            <dt className="text-[10px] uppercase tracking-wider text-muted">
              VO2max label
            </dt>
            <dd className="font-medium text-cardio-text">
              ~{enrichment.vo2maxEstimate.estimate} ml/kg/min
              <span className="ml-1 text-xs text-muted">
                ({enrichment.vo2maxEstimate.hrMaxSource} max HR)
              </span>
            </dd>
          </div>
        )}
        {enrichment.trimp && (
          <div>
            <dt className="text-[10px] uppercase tracking-wider text-muted">TRIMP</dt>
            <dd className="font-medium tabular-nums">
              {enrichment.trimp.trimp}{" "}
              <span className="text-xs text-muted capitalize">
                ({enrichment.trimp.label.replace("_", " ")})
              </span>
            </dd>
          </div>
        )}
        {enrichment.efficiencyFactor && (
          <div>
            <dt className="text-[10px] uppercase tracking-wider text-muted">
              Efficiency factor
            </dt>
            <dd className="font-medium tabular-nums">
              {enrichment.efficiencyFactor.displayValue}
            </dd>
          </div>
        )}
        {enrichment.decoupling && (
          <div className="sm:col-span-2">
            <dt className="text-[10px] uppercase tracking-wider text-muted">
              Pacing / decoupling
            </dt>
            <dd className="text-muted text-xs leading-relaxed">
              {enrichment.decoupling.note}
            </dd>
          </div>
        )}
      </dl>

      {enrichment.flags?.includes("no_hr") && (
        <p className="text-xs text-warning/90 border-t border-white/5 pt-2">
          Adding heart rate unlocks aerobic efficiency scoring and removes the
          unverified badge.
        </p>
      )}

      {enrichment.notes?.length > 0 && (
        <ul className="text-xs text-muted space-y-1 border-t border-white/5 pt-2">
          {enrichment.notes.map((note, i) => (
            <li key={i}>· {note}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function CardioEnrichmentPanel({
  enrichment,
  locked = false,
  className,
}: {
  enrichment: CardioEnrichment | Record<string, unknown> | null | undefined;
  locked?: boolean;
  className?: string;
}) {
  if (!enrichment || typeof enrichment !== "object") return null;

  const e = enrichment as CardioEnrichment;
  const vo2 = e.vo2maxEstimate?.estimate;

  const inner = (
    <div
      className={cn(
        "rounded-xl border border-cardio-border/30 bg-cardio-bg-elevated/10 p-4",
        className
      )}
    >
      <EnrichmentContent enrichment={e} />
    </div>
  );

  if (!locked) return inner;

  return (
    <PremiumTease
      title="Aerobic HR accountability"
      subtitle={
        vo2
          ? `VO2max ~${vo2} ml/kg/min with decoupling flags — unlock HR accountability detail with Premium.`
          : "Unlock TRIMP, efficiency trends, decoupling flags, and VO2max confidence with Premium."
      }
    >
      {inner}
    </PremiumTease>
  );
}
