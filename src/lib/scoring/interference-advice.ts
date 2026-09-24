/**
 * What the interference numbers MEAN, and what to do about them.
 *
 * User feedback, after two earlier rounds of explaining the page: "the
 * interference screen is still too difficult to comprehend and is not very
 * visually appealing". The numbers were right and the sentences were
 * accurate; what was missing was a verdict. A reader was left to decide for
 * themselves whether −4% was a lot, and was never told what to change.
 *
 * So every direction now resolves to one of five verdicts, each with a
 * plain sentence and one line of advice. The thresholds are the ones the
 * engine already uses (interference.ts treats |Δ| < 3 as "no measurable
 * interference"), with one extra line at 8% separating a cost worth living
 * with from one worth planning around. Pure functions over the report, so
 * the page, the dashboard card and the athlete report all say the same
 * thing.
 */
import {
  INTERFERENCE_CONFIG,
  pickHeadlineBucket,
  type CardioToStrengthFinding,
  type DayBucketStat,
  type StrengthToCardioFinding,
} from "./interference";

export type InterferenceVerdict =
  /** Nothing to compare yet. */
  | "learning"
  /** |Δ| under 3% — checked, and there is no real cost. */
  | "none"
  /** A positive effect of 3% or more. */
  | "helps"
  /** A cost between 3% and 8% — real, but small enough to live with. */
  | "small"
  /** A cost of 8% or more — worth scheduling around. */
  | "real";

export interface DirectionVerdict {
  verdict: InterferenceVerdict;
  /** The headline percentage, signed, or null while learning. */
  deltaPct: number | null;
  /** "No cost", "Small cost", … — the pill text. */
  label: string;
  /** One plain sentence saying what was found. */
  sentence: string;
  /** One line saying what to do about it. */
  advice: string;
  sampleCount: number;
  minSamples: number;
  lowConfidence: boolean;
  /** For the strength→cardio direction: which day the headline number comes from, and when it clears. */
  headlineDay?: number | null;
  recoversByDay?: number | null;
}

export const VERDICT_LABELS: Record<InterferenceVerdict, string> = {
  learning: "Still learning",
  none: "No cost",
  helps: "Helps",
  small: "Small cost",
  real: "Real cost",
};

/** The engine's own "no measurable interference" line. */
export const NO_COST_THRESHOLD_PCT = 3;
/** Above this, the cost is worth planning around rather than living with. */
export const REAL_COST_THRESHOLD_PCT = 8;

export function classifyDelta(deltaPct: number | null): InterferenceVerdict {
  if (deltaPct === null) return "learning";
  if (Math.abs(deltaPct) < NO_COST_THRESHOLD_PCT) return "none";
  if (deltaPct > 0) return "helps";
  if (deltaPct <= -REAL_COST_THRESHOLD_PCT) return "real";
  return "small";
}

/** How one day-bucket should be coloured: no data, no cost, small cost, real cost, or a help. */
export function bucketTone(bucket: DayBucketStat): "empty" | InterferenceVerdict {
  if (bucket.sampleCount === 0 || bucket.efDeltaPct === null) return "empty";
  return classifyDelta(bucket.efDeltaPct);
}

function sportWord(sport: string | null): string {
  return (sport ?? "cardio").replace(/_/g, " ");
}

function whenWord(day: number): string {
  if (day === 0) return "on the same day as";
  if (day === 1) return "the day after";
  return `${day} days after`;
}

function pct(deltaPct: number): string {
  return `${Math.abs(deltaPct)}%`;
}

/** First day after the headline day where the cost has cleared (|Δ| under the no-cost line), if the data shows one. */
export function recoveryDay(decayByDay: DayBucketStat[], headlineDay: number): number | null {
  const cleared = decayByDay.find(
    (d) =>
      d.daysSinceStrength > headlineDay &&
      d.sampleCount > 0 &&
      d.efDeltaPct !== null &&
      Math.abs(d.efDeltaPct) < NO_COST_THRESHOLD_PCT
  );
  return cleared ? cleared.daysSinceStrength : null;
}

export function strengthToCardioVerdict(finding: StrengthToCardioFinding): DirectionVerdict {
  const sport = sportWord(finding.primarySport);
  const base = {
    sampleCount: finding.sampleCount,
    minSamples: finding.minSamples,
    lowConfidence: finding.lowConfidence,
  };

  if (finding.calibrating) {
    const fallback = finding.weeklyFallback;
    if (fallback) {
      const verdict = classifyDelta(fallback.deltaPct);
      return {
        ...base,
        verdict,
        deltaPct: fallback.deltaPct,
        label: VERDICT_LABELS[verdict],
        sentence:
          verdict === "none"
            ? `In weeks where you lifted, your ${sport} was about as efficient as in weeks where you didn't.`
            : verdict === "helps"
              ? `In weeks where you lifted, your ${sport} was about ${pct(fallback.deltaPct)} more efficient.`
              : `In weeks where you lifted, your ${sport} was about ${pct(fallback.deltaPct)} less efficient.`,
        advice:
          "This is a week-by-week comparison. Log an easy session within a few days of a gym session and it sharpens to a day-by-day one.",
        headlineDay: null,
        recoversByDay: null,
      };
    }
    return {
      ...base,
      verdict: "learning",
      deltaPct: null,
      label: VERDICT_LABELS.learning,
      sentence: `Not enough ${sport} sessions close to a gym session to compare yet.`,
      advice: finding.summary,
      headlineDay: null,
      recoversByDay: null,
    };
  }

  const headline = pickHeadlineBucket(finding.decayByDay);
  const deltaPct = headline?.efDeltaPct ?? null;
  const verdict = classifyDelta(deltaPct);
  const day = headline?.daysSinceStrength ?? null;
  const recovers = headline ? recoveryDay(finding.decayByDay, headline.daysSinceStrength) : null;
  const restDays = recovers ?? Math.max(2, (day ?? 1) + 1);

  const common = { ...base, deltaPct, label: VERDICT_LABELS[verdict], headlineDay: day, recoversByDay: recovers };

  switch (verdict) {
    case "none":
      return {
        ...common,
        verdict,
        sentence: `Your ${sport} holds up after lifting — no measurable cost.`,
        advice: "Keep scheduling as you are. Nothing here says to move your runs away from gym days.",
      };
    case "helps":
      return {
        ...common,
        verdict,
        sentence: `Your ${sport} is about ${pct(deltaPct!)} more efficient ${whenWord(day!)} lifting.`,
        advice: "Whatever you are doing works. A gym session before an easy day is fine for you.",
      };
    case "small":
      return {
        ...common,
        verdict,
        sentence: `Your ${sport} is about ${pct(deltaPct!)} less efficient ${whenWord(day!)} lifting${
          recovers ? `, back to normal by day ${recovers}` : ""
        }.`,
        advice: `Small enough to live with. If a ${sport} session matters, give it ${restDays} days after a heavy leg day.`,
      };
    case "real":
      return {
        ...common,
        verdict,
        sentence: `Your ${sport} is about ${pct(deltaPct!)} less efficient ${whenWord(day!)} lifting${
          recovers ? `, back to normal by day ${recovers}` : ""
        }.`,
        advice: `Put your key ${sport} sessions at least ${restDays} days after lifting, and keep the day-after session easy.`,
      };
    default:
      return {
        ...common,
        verdict: "learning",
        sentence: `Not enough ${sport} sessions close to a gym session to compare yet.`,
        advice: finding.summary,
      };
  }
}

export function cardioToStrengthVerdict(finding: CardioToStrengthFinding): DirectionVerdict {
  const base = {
    sampleCount: finding.sampleCount,
    minSamples: finding.minSamples,
    lowConfidence: finding.lowConfidence,
  };
  const days = INTERFERENCE_CONFIG.LOOKBACK_DAYS_CARDIO_EFFECT_ON_STRENGTH;

  if (finding.calibrating || finding.deltaPct === null) {
    return {
      ...base,
      verdict: "learning",
      deltaPct: null,
      label: VERDICT_LABELS.learning,
      sentence: "Not enough gym sessions after both light and heavy cardio weeks to compare yet.",
      advice: finding.summary,
    };
  }

  const verdict = classifyDelta(finding.deltaPct);
  const common = { ...base, deltaPct: finding.deltaPct, label: VERDICT_LABELS[verdict] };

  switch (verdict) {
    case "none":
      return {
        ...common,
        verdict,
        sentence: "Your lifting holds up whatever your cardio week looked like — no measurable cost.",
        advice: "No need to protect gym days from cardio. Train both as you are.",
      };
    case "helps":
      return {
        ...common,
        verdict,
        sentence: `Your lifting scores about ${pct(finding.deltaPct)} higher after a heavier cardio week.`,
        advice: "Heavier cardio weeks are not hurting your lifting. Keep the mix you have.",
      };
    case "small":
      return {
        ...common,
        verdict,
        sentence: `Your lifting scores about ${pct(finding.deltaPct)} lower after a heavier ${days}-day cardio stretch.`,
        advice: "Worth noticing, not worth restructuring. If a lift PB matters, take a lighter cardio week before it.",
      };
    case "real":
      return {
        ...common,
        verdict,
        sentence: `Your lifting scores about ${pct(finding.deltaPct)} lower after a heavier ${days}-day cardio stretch.`,
        advice: "Put your hardest lifting early in the week, before the cardio volume builds, and drop the cardio the week before a PB attempt.",
      };
    default:
      return {
        ...common,
        verdict: "learning",
        sentence: "Not enough gym sessions after both light and heavy cardio weeks to compare yet.",
        advice: finding.summary,
      };
  }
}
