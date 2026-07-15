"use client";

import { PremiumTease } from "@/components/premium/premium-tease";
import { cn } from "@/lib/utils/cn";
import { formatIndex, formatWeight } from "@/lib/utils/format";
import {
  formatPredictionLabel,
  formatRiegelPrediction,
  type GatedCardioResult,
  type GatedStrengthResult,
} from "@/lib/scoring/presentation";
import {
  isCardioResultLocked,
  isStrengthResultLocked,
} from "@/lib/scoring/gates";
import type { CardioResult } from "@/lib/scoring/cardio-activity";
import type { ScoreStrengthResult } from "@/lib/scoring/split-strength-engine";

function CardioFreeStats({ result }: { result: CardioResult }) {
  return (
    <dl className="grid gap-3 sm:grid-cols-2 text-sm">
      <div>
        <dt className="text-[10px] uppercase tracking-wider text-muted">Session score</dt>
        <dd className="font-display text-xl font-bold text-cardio-accent tabular-nums">
          {formatIndex(result.score)}
        </dd>
      </div>
      {result.vo2max !== null && (
        <div>
          <dt className="text-[10px] uppercase tracking-wider text-muted">VO2max estimate</dt>
          <dd className="font-medium tabular-nums text-cardio-text">
            {result.vo2max} ml/kg/min
            <span className="ml-1 text-xs text-muted">({result.vo2maxMethod})</span>
          </dd>
        </div>
      )}
    </dl>
  );
}

function CardioPremiumStats({ result }: { result: CardioResult }) {
  return (
    <div className="space-y-4 text-sm">
      <CardioFreeStats result={result} />
      <dl className="grid gap-3 sm:grid-cols-2 border-t border-white/5 pt-4">
        {result.trimp !== null && (
          <div>
            <dt className="text-[10px] uppercase tracking-wider text-muted">TRIMP</dt>
            <dd className="font-medium tabular-nums">{result.trimp}</dd>
          </div>
        )}
        {result.efficiencyFactor !== null && (
          <div>
            <dt className="text-[10px] uppercase tracking-wider text-muted">Efficiency factor</dt>
            <dd className="font-medium tabular-nums">{result.efficiencyFactor}</dd>
          </div>
        )}
        {result.decouplingPct !== null && (
          <div>
            <dt className="text-[10px] uppercase tracking-wider text-muted">Decoupling</dt>
            <dd className="font-medium tabular-nums">{result.decouplingPct}%</dd>
          </div>
        )}
        <div>
          <dt className="text-[10px] uppercase tracking-wider text-muted">Confidence</dt>
          <dd className="font-medium tabular-nums">{Math.round(result.confidence * 100)}%</dd>
        </div>
      </dl>
      {result.predictions && (
        <div className="border-t border-white/5 pt-4">
          <p className="text-[10px] uppercase tracking-wider text-muted mb-2">Riegel predictions</p>
          <ul className="grid gap-1.5 sm:grid-cols-2 text-xs">
            {Object.entries(result.predictions).map(([dist, sec]) => (
              <li key={dist} className="flex justify-between gap-2 tabular-nums">
                <span className="text-muted">{formatPredictionLabel(dist)}</span>
                <span className="font-medium">{formatRiegelPrediction(sec)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {result.flags.length > 0 && (
        <ul className="text-xs text-muted space-y-1 border-t border-white/5 pt-3">
          {result.flags.map((flag) => (
            <li key={flag}>· {flag.replace(/-/g, " ")}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StrengthRow({ result, liftName }: { result: ScoreStrengthResult; liftName: string }) {
  const isBeta =
    result.flags?.includes("female-strength-beta") ||
    result.flags?.includes("sex-factor-beta") ||
    result.appliedFactors?.some((f) => f.includes("beta"));
  const isEstimated = result.source === "generic";
  return (
    <div className="rounded-lg border border-gym-border/20 bg-gym-bg/40 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-medium">
          {liftName}
          {isEstimated && (
            <span className="ml-1.5 rounded-full bg-white/5 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-muted">
              estimated
            </span>
          )}
        </p>
        <p className="font-display text-lg font-bold text-gym-accent tabular-nums">
          {formatIndex(result.score)}
        </p>
      </div>
      <p className="mt-1 text-xs text-gym-muted tabular-nums">
        Est. 1RM {formatWeight(result.oneRM)} · {result.tier}
        {isBeta ? " (beta)" : ""}
      </p>
      <p className="text-xs text-gym-muted tabular-nums">{result.bodyweightRatio}× bodyweight</p>
      {result.nextTier && (
        <p className="mt-1 text-xs text-gym-accent/80 tabular-nums">
          +{formatWeight(result.nextTier.kgNeeded)} to reach {result.nextTier.tier}
        </p>
      )}
      {"oneRMConfidence" in result && (
        <div className="mt-2 border-t border-white/5 pt-2 text-xs text-gym-muted space-y-1">
          <p className="tabular-nums">
            Confidence {Math.round(result.oneRMConfidence * 100)}%
            {result.oneRMBandKg
              ? ` · 1RM band ${formatWeight(result.oneRMBandKg[0])}–${formatWeight(result.oneRMBandKg[1])}`
              : ""}
            {result.trend ? ` · trend ${result.trend}` : ""}
          </p>
          {result.suggestion && <p>{result.suggestion}</p>}
        </div>
      )}
    </div>
  );
}

export function SessionScoreInsights({
  zone,
  cardioResult,
  strengthResults,
  isPremium,
  className,
}: {
  zone: "gym" | "cardio";
  cardioResult?: CardioResult | GatedCardioResult | null;
  strengthResults?: Array<{
    name: string;
    result: ScoreStrengthResult | GatedStrengthResult;
  }> | null;
  isPremium: boolean;
  className?: string;
}) {
  if (zone === "cardio" && cardioResult) {
    const full =
      isPremium || !isCardioResultLocked(cardioResult)
        ? (cardioResult as CardioResult)
        : null;
    const free = cardioResult as CardioResult;

    const panel = (
      <div
        className={cn(
          "rounded-xl border border-cardio-border/30 bg-cardio-bg-elevated/10 p-4",
          className
        )}
      >
        {full ? <CardioPremiumStats result={full} /> : <CardioFreeStats result={free} />}
      </div>
    );

    if (isPremium || full) return panel;

    return (
      <PremiumTease
        title={`VO2max ${free.vo2max ?? "—"} ml/kg/min · TRIMP & EF locked`}
        subtitle="Premium unlocks TRIMP, efficiency factor, decoupling, and Riegel race predictions."
        className={className}
      >
        <CardioPremiumStats
          result={{
            ...free,
            trimp: 112,
            efficiencyFactor: 0.84,
            decouplingPct: 3.1,
            confidence: 0.92,
            predictions: { "10000": 2814, "21097.5": 6210, "42195": 12948 },
            flags: ["negative-split-strong"],
          }}
        />
      </PremiumTease>
    );
  }

  if (zone === "gym" && strengthResults?.length) {
    return (
      <div className={cn("space-y-3", className)}>
        {strengthResults.map(({ name, result }) => {
          const full =
            isPremium || !isStrengthResultLocked(result) ? (result as ScoreStrengthResult) : null;
          const free = result as ScoreStrengthResult;

          if (full) return <StrengthRow key={name} result={full} liftName={name} />;

          return (
            <PremiumTease
              key={name}
              title={`${name}: ${formatIndex(free.score)} · ${free.tier} · confidence & trend locked`}
              subtitle="Premium unlocks the adaptive 1RM confidence band, trend, and a suggestion when the estimate is uncertain."
            >
              <StrengthRow
                result={{
                  ...free,
                  oneRMConfidence: 0.82,
                  oneRMBandKg: [free.oneRM * 0.94, free.oneRM * 1.05],
                  trend: "up",
                  suggestion: null,
                  appliedFactors: [],
                }}
                liftName={name}
              />
            </PremiumTease>
          );
        })}
      </div>
    );
  }

  return null;
}
