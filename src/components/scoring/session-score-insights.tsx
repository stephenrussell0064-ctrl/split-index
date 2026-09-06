"use client";

import { PremiumTease } from "@/components/premium/premium-tease";
import { ScoringExplainerNote } from "@/components/scoring/scoring-explainer-note";
import { isBodyweightOnlyExercise } from "@/lib/scoring/weight-entry";
import { cn } from "@/lib/utils/cn";
import { formatIndex, formatWeight } from "@/lib/utils/format";
import {
  describeAgeStandard,
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
import type { SessionType, SportType } from "@/types";

/** Session types scored relative to the athlete's own history — mirrors RELATIVE_EFFORT_SESSION_TYPES in cardio-predictions.ts (kept as a local literal set to avoid a server-only import chain from a "use client" component). */
const RELATIVE_EFFORT_SESSION_TYPES = new Set<SessionType>(["easy", "recovery", "long"]);

/** The predictions ladder now covers row/ski/swim/walk too (previously running-only) — this verb keeps the header sport-accurate instead of hardcoding "run". */
const PREDICTION_VERB: Record<SportType, string> = {
  running: "run",
  walking: "walk",
  rowing: "row",
  swimming: "swim",
  ski_erg: "ski",
  bike_erg: "ride",
  indoor_cycling: "ride",
  outdoor_cycling: "ride",
  gym: "lift",
};

/** Explains the relative-effort scoring model — shown for every tier (session_type isn't premium-gated), since the score itself is affected by this regardless of tier. */
function RelativeEffortNote({ sessionType, flags }: { sessionType?: SessionType | null; flags?: string[] }) {
  if (!sessionType || !RELATIVE_EFFORT_SESSION_TYPES.has(sessionType)) return null;

  let detail = "Scored relative to your own recent easy-effort history, not absolute pace.";
  if (flags?.includes("easy-tag-pace-mismatch")) {
    detail = "This pace looked more like a hard effort, so it was scored on the standard scale instead.";
  } else if (flags?.includes("hr-zone-scored")) {
    const estimatedNote = flags.includes("hr-zone-resting-hr-estimated")
      ? " Your resting heart rate is estimated from your experience level — add the real value in Settings for more accurate scoring."
      : "";
    if (flags.includes("hr-zone-below-base-guard")) {
      detail = `Your heart rate read very low for this effort — a partial credit applied since your pace didn't fully back it up.${estimatedNote}`;
    } else if (flags.includes("hr-zone-penalty")) {
      detail = `Your heart rate drifted well above your target zone for an easy effort — credit reduced.${estimatedNote}`;
    } else if (flags.includes("hr-zone-above-target")) {
      detail = `Your heart rate sat above your target zone — still credited, but less than a right-on-target effort.${estimatedNote}`;
    } else if (flags.includes("hr-zone-at-or-below-target")) {
      detail = `Right at or below your target heart rate — a well-executed easy effort, credited in full.${estimatedNote}`;
    } else {
      detail = `Scored on your personalized heart-rate zones.${estimatedNote}`;
    }
  } else if (flags?.includes("relative-effort-scored")) {
    detail = "This session beat your recent easy-effort average — pace credit applied.";
  } else if (flags?.includes("hr-zone-assumed-target")) {
    detail = "No heart-rate data for this session — scored as if executed right at your target heart-rate zone. This is an assumption, not a measurement, so it may not be accurate.";
  } else if (flags?.includes("hr-zone-data-missing")) {
    detail = "Add your resting & max heart rate in Settings to unlock more accurate, personalized effort scoring.";
  }

  return <ScoringExplainerNote>{detail}</ScoringExplainerNote>;
}

function CardioFreeStats({
  result,
  sessionType,
  flags,
}: {
  result: CardioResult;
  sessionType?: SessionType | null;
  flags?: string[];
}) {
  return (
    <dl className="grid gap-3 sm:grid-cols-2 text-sm">
      <div>
        <dt className="text-[10px] uppercase tracking-wider text-muted">Session score</dt>
        <dd className="font-display text-xl font-bold text-cardio-accent tabular-nums">
          {formatIndex(result.score)}
        </dd>
        <RelativeEffortNote sessionType={sessionType} flags={flags} />
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

function CardioPremiumStats({
  result,
  sessionType,
  sport,
}: {
  result: CardioResult;
  sessionType?: SessionType | null;
  sport?: SportType | null;
}) {
  const hiddenFlags = new Set([
    "relative-effort-scored",
    "easy-tag-pace-mismatch",
    "hr-zone-scored",
    "hr-zone-at-or-below-target",
    "hr-zone-above-target",
    "hr-zone-penalty",
    "hr-zone-below-base-guard",
    "hr-zone-data-missing",
    "hr-zone-resting-hr-estimated",
    "hr-zone-assumed-target",
  ]);
  const remainingFlags = result.flags.filter((f) => !hiddenFlags.has(f));
  const predictionVerb = (sport && PREDICTION_VERB[sport]) || "run";

  return (
    <div className="space-y-4 text-sm">
      <CardioFreeStats result={result} sessionType={sessionType} flags={result.flags} />
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
      {(result.trimp !== null || result.efficiencyFactor !== null || result.decouplingPct !== null) && (
        <ScoringExplainerNote href="/how-scoring-works#trimp">
          TRIMP is training cost (duration × intensity); efficiency factor is speed per
          heartbeat, best read as a trend against your own history; decoupling is how much your
          heart rate drifted upward relative to pace.
        </ScoringExplainerNote>
      )}
      {result.predictions && (
        <div className="border-t border-white/5 pt-4">
          <p className="text-[10px] uppercase tracking-wider text-muted mb-2">
            At this pace, you could {predictionVerb}:
          </p>
          <ul className="grid gap-1.5 sm:grid-cols-2 text-xs">
            {Object.entries(result.predictions)
              // JS object key order sorts integer-like keys (e.g. "42195")
              // numerically ahead of any key containing a decimal point
              // (e.g. "21097.5", the half-marathon distance in meters),
              // regardless of insertion order — silently put Marathon
              // before Half in every ladder (user feedback: "why is half
              // below marathon"). Sort explicitly by the real distance.
              .sort(([a], [b]) => Number(a) - Number(b))
              .map(([dist, sec]) => (
              <li key={dist} className="tabular-nums">
                <span className="text-muted">{formatPredictionLabel(dist)} in </span>
                <span className="font-medium">{formatRiegelPrediction(sec)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {remainingFlags.length > 0 && (
        <ul className="text-xs text-muted space-y-1 border-t border-white/5 pt-3">
          {remainingFlags.map((flag) => (
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
  // Results persisted before the 1RM split existed carry only the single
  // blended figure — show it as both rather than a blank or a zero.
  const currentOneRM = result.currentOneRM ?? result.oneRM;
  const allTimeOneRM = result.allTimeOneRM ?? result.oneRM;
  // The engine has always computed this and always carried it here; nothing
  // rendered it, so an athlete whose score was age-adjusted had no way to see
  // that it was. Null for free results (premium-gated) and for the flat 23–35
  // band, so this line simply does not appear rather than reading "×1.000".
  const ageStandard = describeAgeStandard(result.appliedFactors);
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
        Current 1RM {formatWeight(currentOneRM)} · All-time best {formatWeight(allTimeOneRM)}
      </p>
      <p className="text-xs text-gym-muted tabular-nums">
        {result.tier}
        {isBeta ? " (beta)" : ""} · {result.bodyweightRatio}× bodyweight
      </p>
      {ageStandard && (
        <p className="mt-1 text-xs text-gym-muted tabular-nums">
          Age {ageStandard.age} · standard {ageStandard.easedPct.toFixed(1)}% easier · your lift is
          not adjusted (beta)
        </p>
      )}
      {isBodyweightOnlyExercise(liftName) && (
        <ScoringExplainerNote className="text-gym-muted">
          Both 1RM figures here are the added weight a weighted {liftName.toLowerCase()} would need
          to be equally hard for one rep — not your bodyweight, and not a literal weight you lifted.
        </ScoringExplainerNote>
      )}
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
  sessionType,
  sport,
  className,
}: {
  zone: "gym" | "cardio";
  cardioResult?: CardioResult | GatedCardioResult | null;
  strengthResults?: Array<{
    name: string;
    result: ScoreStrengthResult | GatedStrengthResult;
  }> | null;
  isPremium: boolean;
  sessionType?: SessionType | null;
  sport?: SportType | null;
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
        {full ? (
          <CardioPremiumStats result={full} sessionType={sessionType} sport={sport} />
        ) : (
          <CardioFreeStats result={free} sessionType={sessionType} />
        )}
      </div>
    );

    if (isPremium || full) return panel;

    return (
      <PremiumTease
        title={`VO2max ${free.vo2max ?? "—"} ml/kg/min · TRIMP & EF locked`}
        subtitle="Premium unlocks TRIMP, efficiency factor, decoupling, and race-pace predictions."
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
          sessionType={sessionType}
          sport={sport}
        />
      </PremiumTease>
    );
  }

  if (zone === "gym" && strengthResults?.length) {
    return (
      <div className={cn("space-y-3", className)}>
        <ScoringExplainerNote href="/how-scoring-works#one-rm" className="mt-0 text-gym-muted">
          All-time best is a high-water mark — a worse session can never lower it, only beating it
          moves it. Current 1RM is read from your recent training, so it falls when your sessions do.
        </ScoringExplainerNote>
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
