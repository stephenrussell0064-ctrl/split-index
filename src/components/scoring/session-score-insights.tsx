"use client";

import { HelpCircle } from "lucide-react";
import { useState } from "react";
import { PremiumTease } from "@/components/premium/premium-tease";
import { PersonalScoreExplainer } from "@/components/scoring/personal-score-explainer";
import { StandardsScoreExplainer } from "@/components/scoring/standards-score-explainer";
import { ScoringExplainerNote } from "@/components/scoring/scoring-explainer-note";
import { isBodyweightOnlyExercise } from "@/lib/scoring/weight-entry";
import { cn } from "@/lib/utils/cn";
import { formatIndex, formatWeight } from "@/lib/utils/format";
import {
  formatAgeAdjustmentNote,
  formatPredictionLabel,
  formatRiegelPrediction,
  readAgeAdjustment,
  readCardioAgeGrade,
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

/**
 * Says how this session's score was arrived at — what the athlete's heart
 * rate, the hills and the weather did to it.
 *
 * This replaced a note that explained the old easy-run credit stack: which
 * heart-rate zone the session landed in, whether the below-base guard had
 * fired, whether a mistagged-hard-effort guard had. None of that exists any
 * more. The session tag is not read by either score, and there is no stack of
 * capped credits to explain — there is one number, the fitness equivalent,
 * and a short list of what moved it.
 */
function ScoreBasisNote({ result }: { result: CardioResult }) {
  const flags = result.flags ?? [];
  const adjustments = result.adjustments;

  const detail: string = (() => {
    if (flags.includes("effort-from-hr")) {
      const estimated = flags.includes("resting-hr-estimated")
        ? " Your resting heart rate is estimated from your experience level — add the real one in Settings to sharpen this."
        : "";
      const stretched = flags.includes("effort-credit-extrapolated")
        ? " This was well below race effort, so reading a maximal pace off it is more of a stretch than usual."
        : "";
      return `Scored on what this pace at this heart rate implies you could do flat out.${estimated}${stretched}`;
    }
    if (flags.includes("effort-from-rpe")) {
      return "No heart rate for this session, so your effort rating was used instead — a rougher signal, and the score is less confident because of it.";
    }
    if (flags.includes("effort-not-scaled")) {
      return "No heart rate or effort rating, so this was scored on pace alone. Adding either tells the engine how hard the session actually was.";
    }
    return "";
  })();

  const conditions = [
    adjustments && adjustments.elevationFraction > 0
      ? `${Math.round(adjustments.elevationFraction * 1000) / 10}% credited for the climbing`
      : null,
    adjustments && adjustments.temperatureFraction > 0
      ? `${Math.round(adjustments.temperatureFraction * 1000) / 10}% credited for the weather`
      : null,
    adjustments && adjustments.bodyweightFactor !== 1
      ? `adjusted for your bodyweight on the erg`
      : null,
  ].filter(Boolean);

  if (!detail && conditions.length === 0) return null;

  return (
    <ScoringExplainerNote href="/how-scoring-works#two-scores">
      {detail}
      {conditions.length > 0 ? ` ${conditions.join(", ")}.` : ""}
    </ScoringExplainerNote>
  );
}

/** How this session compared with the athlete's own recent ones. */
function PersonalComparison({ result }: { result: CardioResult }) {
  const personal = result.personal;
  if (!personal || result.personalScore == null) return null;
  const better = personal.deltaPct > 0;
  return (
    <div className="border-t border-white/5 pt-4">
      <p className="text-[10px] uppercase tracking-wider text-muted">Against your own recent sessions</p>
      <p className="mt-1 text-sm tabular-nums">
        <span className={cn("font-semibold", better ? "text-success" : "text-warning")}>
          {better ? "+" : ""}
          {personal.deltaPct}%
        </span>
        <span className="text-muted">
          {" "}
          vs your normal, across {personal.sampleCount} session
          {personal.sampleCount === 1 ? "" : "s"}
        </span>
      </p>
      <ScoringExplainerNote href="/how-scoring-works#two-scores" className="mt-1">
        {personal.comparedWith === "pace-only"
          ? "Compared on pace alone, because too few of your recent sessions were recorded the same way as this one — so it cannot tell whether today was harder work for the same pace."
          : personal.intensityMatch < 0.25
            ? "You have not done a session at this heart rate lately, so this is compared across intensities and is rougher than usual."
            : "Compared against your own sessions at a similar heart rate, so an easy run is judged against your easy runs."}
      </ScoringExplainerNote>
    </div>
  );
}

function CardioFreeStats({
  result,
  sport,
}: {
  result: CardioResult;
  sessionType?: SessionType | null;
  flags?: string[];
  /** Threaded only so the explainer can draw this sport's trend. */
  sport?: SportType | null;
}) {
  const [explaining, setExplaining] = useState(false);
  const [explainingEngine, setExplainingEngine] = useState(false);
  return (
    <div className="space-y-3">
      <dl className="grid gap-3 sm:grid-cols-2 text-sm">
        <div>
          <dt className="text-[10px] uppercase tracking-wider text-muted">Session score · vs everyone</dt>
          <dd className="font-display text-xl font-bold text-cardio-accent tabular-nums">
            <button
              type="button"
              onClick={() => setExplainingEngine(true)}
              aria-label={`Your Engine score, ${formatIndex(result.populationScore ?? result.score)}. What this means`}
              className="-mx-1 -my-0.5 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-1 py-0.5 text-left underline decoration-dotted decoration-white/25 underline-offset-4 hover:bg-white/5 hover:decoration-white/60"
            >
              {formatIndex(result.populationScore ?? result.score)}
              <HelpCircle className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
            </button>
          </dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wider text-muted">vs you</dt>
          <dd
            className={cn(
              "font-display text-xl font-bold tabular-nums",
              result.personalScore == null
                ? "text-muted"
                : result.personalScore >= 525
                  ? "text-success"
                  : result.personalScore <= 475
                    ? "text-warning"
                    : "text-cardio-text"
            )}
          >
            {result.personalScore == null ? (
              "—"
            ) : (
              /* Tappable, because two digits labelled "vs you" do not say what
                 they are measured against or where their middle is. Everything
                 the sheet shows was already computed and rendered nowhere. */
              <button
                type="button"
                onClick={() => setExplaining(true)}
                aria-label={`Your score against yourself, ${formatIndex(result.personalScore)}. What this means`}
                className="-mx-1 -my-0.5 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-1 py-0.5 text-left underline decoration-dotted decoration-white/25 underline-offset-4 hover:bg-white/5 hover:decoration-white/60"
              >
                {formatIndex(result.personalScore)}
                <HelpCircle className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
              </button>
            )}
          </dd>
          {result.personalScore == null && (
            <p className="text-[10px] text-muted">calibrating</p>
          )}
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
      <ScoreBasisNote result={result} />
      {explainingEngine && (
        <StandardsScoreExplainer
          score={result.populationScore ?? result.score}
          variant="engine"
          seriesKey={sport ?? null}
          onClose={() => setExplainingEngine(false)}
        />
      )}
      {explaining && result.personalScore != null && (
        <PersonalScoreExplainer
          score={result.personalScore}
          comparison={result.personal ?? null}
          sport={sport ?? null}
          onClose={() => setExplaining(false)}
        />
      )}
    </div>
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
  // Flags the notes above already say in words — listing them raw as well
  // just repeats the explanation in engine vocabulary.
  /*
    `in` rather than a plain read: a gated (free-tier) result has the field
    stripped by `gates.ts` rather than set to null, so a direct
    `result.workPiece` would be `undefined` on a shape that does not declare
    it. Null here means "no breakdown to show", which is also the honest
    answer for a free account — and for a session scored before this field
    existed.

    Derived BEFORE `hiddenFlags` because the suppression below depends on it.
  */
  const workPiece = "workPiece" in result ? result.workPiece : null;
  const hiddenFlags = new Set([
    "effort-from-hr",
    "effort-from-rpe",
    "effort-not-scaled",
    "effort-credit-extrapolated",
    "resting-hr-estimated",
    "terrain-adjusted",
    "weather-adjusted",
    "bodyweight-adjusted",
    "personal-calibrating",
    "personal-baseline-pace-only",
    "personal-baseline-intensity-stretched",
    /*
     * The ten `hr-zone-*` and `relative-effort-*` flags that main lists here
     * are deliberately absent: the two-score model deleted the credit stack
     * that raised them, and nothing emits them any more. Reinstating them
     * would put dead strings in front of a reader looking for what the engine
     * can actually say.
     */
    // Rendered as a sentence below instead of as a raw "· age graded"
    // bullet — the same adjustment the strength side now names outright.
    "age-graded",
    /*
     * Hidden ONLY when there is a breakdown to show in its place.
     *
     * The activity page does not re-score on read — `extractGatedCardioInsight`
     * casts the stored `breakdown.cardio_activity` JSONB straight through, and
     * `activity-scorer.ts` writes that blob at log/edit time only. So every
     * interval session logged before `workPiece` existed carries the flag and
     * no `workPiece` key, for months. Suppressing the slug unconditionally
     * would replace it with NOTHING on all of that history — a net loss for
     * exactly the premium athletes this is meant to serve.
     *
     * Same problem `strengthResultFromScoreRow` already solved a few functions
     * away: rows written before a field existed get the honest fallback rather
     * than an invented one.
     */
    ...(workPiece ? ["interval-work-piece-scored", "fartlek-work-piece-scored"] : []),
  ]);
  const remainingFlags = result.flags.filter((f) => !hiddenFlags.has(f));
  const isAgeGraded = result.flags.includes("age-graded");
  // Null for a session scored before `ageGradeFactor` was reported. Those
  // results carry the flag but no magnitude, so they keep the numberless
  // wording rather than showing a fabricated or defaulted figure.
  const cardioAgeGrade = readCardioAgeGrade(result.ageGradeFactor);
  const predictionVerb = (sport && PREDICTION_VERB[sport]) || "run";

  return (
    <div className="space-y-4 text-sm">
      <CardioFreeStats result={result} sessionType={sessionType} flags={result.flags} sport={sport} />
      <PersonalComparison result={result} />
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
      {isAgeGraded && (
        <>
          {cardioAgeGrade && (
            <p className="mt-3 text-xs text-cardio-accent/80 tabular-nums">
              {cardioAgeGrade.label}
            </p>
          )}
          <ScoringExplainerNote href="/how-scoring-works#age-grading">
            {cardioAgeGrade
              ? // The label line above already carries the "Age-graded:" term
                // and the figures, so the sentence explains rather than repeats.
                `Your benchmark-equivalent time was compared against a standard ${cardioAgeGrade.percentMoved}% ${cardioAgeGrade.direction} than the open-class one, so the same finish time scores higher than it would for an open-class athlete.`
              : // No label line for a pre-`ageGradeFactor` result, so this
                // sentence must still name the adjustment itself.
                "Age-graded: your benchmark-equivalent time was compared against a standard adjusted for your age, so the same finish time scores higher than it would for an open-class athlete."}{" "}
            The times shown here — including the predictions — are your real, un-graded times.
          </ScoringExplainerNote>
        </>
      )}
      {workPiece && (
        <div className="border-t border-white/5 pt-4">
          <p className="text-[10px] uppercase tracking-wider text-muted mb-2">
            Scored on your {workPiece.kind === "interval" ? "reps" : "hard efforts"}, not your
            session average
          </p>
          <dl className="grid gap-1.5 text-xs sm:grid-cols-3">
            <div>
              <dt className="text-muted">
                {workPiece.kind === "interval" ? "Rep pace" : "On pace"}
              </dt>
              <dd className="font-medium tabular-nums">
                {formatRiegelPrediction(workPiece.workPaceSecPerKm)}/km
              </dd>
            </div>
            <div>
              <dt className="text-muted">Scored as</dt>
              <dd className="font-medium tabular-nums">
                {formatRiegelPrediction(workPiece.equivalentPaceSecPerKm)}/km
              </dd>
            </div>
            {workPiece.sessionAvgPaceSecPerKm !== null && (
              <div>
                <dt className="text-muted">Session average</dt>
                <dd className="font-medium tabular-nums line-through opacity-60">
                  {formatRiegelPrediction(workPiece.sessionAvgPaceSecPerKm)}/km
                </dd>
              </div>
            )}
          </dl>
          <ScoringExplainerNote>
            Your {workPiece.kind === "interval" ? "rep" : "hard-effort"} pace is converted to a
            race-equivalent using the rest you took — recovery makes a pace easier to hold, so the
            scored figure sits behind the raw one. The standing around never counts.
          </ScoringExplainerNote>
        </div>
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
  const [explainingLab, setExplainingLab] = useState(false);
  const isBeta =
    result.flags?.includes("female-strength-beta") ||
    result.flags?.includes("sex-factor-beta") ||
    result.appliedFactors?.some((f) => f.includes("beta"));
  const isEstimated = result.source === "generic";
  // The age curve has always been computed, applied and gated correctly — it
  // just had no reader. `isBeta` above collapses the whole appliedFactors
  // array into a badge, so a masters athlete paying for premium could see
  // "(beta)" next to their tier and never learn what was adjusted or by how
  // much, while the pricing page sold "published age-graded standards".
  const ageAdjustment = readAgeAdjustment(result.appliedFactors);
  // Results persisted before the 1RM split existed carry only the single
  // blended figure — show it as both rather than a blank or a zero.
  const currentOneRM = result.currentOneRM ?? result.oneRM;
  const allTimeOneRM = result.allTimeOneRM ?? result.oneRM;
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
        <div className="text-right">
          <p className="font-display text-lg font-bold text-gym-accent tabular-nums">
            <button
              type="button"
              onClick={() => setExplainingLab(true)}
              aria-label={`Your Lab score for ${liftName}, ${formatIndex(result.score)}. What this means`}
              className="-mx-1 -my-0.5 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-1 py-0.5 underline decoration-dotted decoration-white/25 underline-offset-4 hover:bg-white/5 hover:decoration-white/60"
            >
              {formatIndex(result.score)}
              <HelpCircle className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
            </button>
          </p>
          <p className="text-[9px] uppercase tracking-wider text-gym-muted">vs everyone</p>
          {explainingLab && (
            <StandardsScoreExplainer
              score={result.score}
              variant="lab"
              seriesKey={liftName}
              tier={result.tier}
              onClose={() => setExplainingLab(false)}
            />
          )}
          {result.personalScore != null && (
            <>
              <p
                className={cn(
                  "mt-1 font-display text-base font-bold tabular-nums",
                  result.personalScore >= 525
                    ? "text-success"
                    : result.personalScore <= 475
                      ? "text-warning"
                      : "text-gym-text"
                )}
              >
                {formatIndex(result.personalScore)}
              </p>
              <p className="text-[9px] uppercase tracking-wider text-gym-muted">vs you</p>
            </>
          )}
        </div>
      </div>
      <p className="mt-1 text-xs text-gym-muted tabular-nums">
        Current 1RM {formatWeight(currentOneRM)} · All-time best {formatWeight(allTimeOneRM)}
      </p>
      <p className="text-xs text-gym-muted tabular-nums">
        {result.tier}
        {isBeta ? " (beta)" : ""} · {result.bodyweightRatio}× bodyweight
      </p>
      {ageAdjustment && (
        <>
          <p className="mt-1 text-xs text-gym-accent/80 tabular-nums">{ageAdjustment.label}</p>
          <ScoringExplainerNote href="/how-scoring-works#age-grading" className="text-gym-muted">
            {formatAgeAdjustmentNote(ageAdjustment)}
          </ScoringExplainerNote>
        </>
      )}
      {isBodyweightOnlyExercise(liftName) && (
        <ScoringExplainerNote className="text-gym-muted">
          Both 1RM figures here are the added weight a weighted {liftName.toLowerCase()} would need
          to be equally hard for one rep — not your bodyweight, and not a literal weight you lifted.
        </ScoringExplainerNote>
      )}
      {result.personal && (
        <p className="mt-1 text-xs text-gym-muted tabular-nums">
          {result.personal.deltaPct > 0 ? "+" : ""}
          {result.personal.deltaPct}% vs your recent {formatWeight(result.personal.baselineOneRM)} norm
          {" "}across {result.personal.sampleCount} session
          {result.personal.sampleCount === 1 ? "" : "s"}
        </p>
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
          <CardioFreeStats result={free} sessionType={sessionType} sport={sport} />
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
              // `appliedFactors` is premium-gated, so the age readout is
              // correctly absent from the blurred preview below (which passes
              // an empty array rather than inventing an age for this athlete).
              // Naming it here is the honest way to advertise it: it is what
              // the pricing page already promises, and a masters athlete on
              // the free tier otherwise has no way to learn the feature exists.
              subtitle="Premium unlocks the adaptive 1RM confidence band, trend, the age-graded standard behind your score, and a suggestion when the estimate is uncertain."
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
