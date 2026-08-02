/**
 * Interference & Synergy Engine (interference-engine brief, Part 1).
 *
 * Mines an athlete's own paired history to answer whether strength
 * sessions measurably affect nearby cardio performance, and vice versa —
 * genuinely personal, not a population claim. Pure functions over a
 * TimelineSession[] (see timeline.ts); the caller supplies the data.
 */
import { RELATIVE_EFFORT_SESSION_TYPES } from "./cardio-predictions";
import type { TimelineSession } from "./timeline";

export const INTERFERENCE_CONFIG = {
  MIN_PAIRED_SESSIONS: 5,
  LOOKBACK_DAYS_STRENGTH_EFFECT_ON_CARDIO: 3, // how many days post-leg-day to track decay
  LOOKBACK_DAYS_CARDIO_EFFECT_ON_STRENGTH: 7, // weekly volume window for the reverse direction
  /** A cardio session preceded by this many rest days (no session at all) or more is the "rested baseline" to compare against. */
  MIN_REST_DAYS_FOR_BASELINE: 2,
} as const;

const DAY_MS = 86400000;

/** Midnight UTC of the calendar date — "days between" must compare dates, not raw elapsed time, or an evening strength session and a next-morning run (only ~14h apart) would wrongly compute as "same day" instead of "the next day". */
function dateOnlyUtcMs(iso: string): number {
  const d = new Date(iso);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function daysBetween(laterIso: string, earlierIso: string): number {
  return Math.round((dateOnlyUtcMs(laterIso) - dateOnlyUtcMs(earlierIso)) / DAY_MS);
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

export interface DayBucketStat {
  daysSinceStrength: number;
  sampleCount: number;
  efDeltaPct: number | null;
  hrDeltaBpm: number | null;
}

export interface StrengthToCardioFinding {
  calibrating: boolean;
  sampleCount: number;
  minSamples: number;
  /** The cardio sport this finding is based on (the athlete's most-logged qualifying sport — comparing pace/EF across different sports isn't meaningful). */
  primarySport: string | null;
  /** Total easy/recovery/long primarySport sessions with HR+EF data, regardless of proximity to a strength session — lets the calibrating message distinguish "not enough easy-effort cardio logged at all" from "plenty logged, just none near a strength session yet". */
  totalQualifyingSessions: number;
  decayByDay: DayBucketStat[];
  summary: string;
}

export interface CardioToStrengthFinding {
  calibrating: boolean;
  sampleCount: number;
  minSamples: number;
  highCardioAvgStrengthComponent: number | null;
  lowCardioAvgStrengthComponent: number | null;
  deltaPct: number | null;
  summary: string;
}

export interface InterferenceReport {
  strengthToCardio: StrengthToCardioFinding;
  cardioToStrength: CardioToStrengthFinding;
}

/** Most recent session strictly before `beforeIso`, optionally restricted to one domain. */
function mostRecentBefore(
  sessions: TimelineSession[],
  beforeIso: string,
  domain?: TimelineSession["domain"]
): TimelineSession | null {
  let best: TimelineSession | null = null;
  for (const s of sessions) {
    if (s.startedAt >= beforeIso) continue;
    if (domain && s.domain !== domain) continue;
    if (!best || s.startedAt > best.startedAt) best = s;
  }
  return best;
}

function computeStrengthToCardio(sessions: TimelineSession[]): StrengthToCardioFinding {
  const minSamples = INTERFERENCE_CONFIG.MIN_PAIRED_SESSIONS;

  const qualifying = sessions.filter(
    (s) =>
      s.domain === "cardio" &&
      s.sessionType &&
      RELATIVE_EFFORT_SESSION_TYPES.has(s.sessionType) &&
      s.avgHeartRate != null &&
      s.efficiencyFactor != null
  );

  if (qualifying.length === 0) {
    return {
      calibrating: true,
      sampleCount: 0,
      minSamples,
      primarySport: null,
      totalQualifyingSessions: 0,
      decayByDay: [],
      summary: "Gathering data — log a few more easy/recovery cardio sessions to unlock this.",
    };
  }

  // Compare within one sport only — EF/pace conventions differ too much
  // across sports (running pace/km vs rowing split/500m) to mix.
  const bySport = new Map<string, TimelineSession[]>();
  for (const s of qualifying) {
    const bucket = bySport.get(s.sport);
    if (bucket) bucket.push(s);
    else bySport.set(s.sport, [s]);
  }
  const [primarySport, primarySessions] = [...bySport.entries()].sort(
    (a, b) => b[1].length - a[1].length
  )[0];

  type Tagged = { session: TimelineSession; daysSinceStrength: number | null; isRestedBaseline: boolean };
  const tagged: Tagged[] = primarySessions.map((s) => {
    const lastStrength = mostRecentBefore(sessions, s.startedAt, "strength");
    const lastAny = mostRecentBefore(
      sessions.filter((x) => x.activityId !== s.activityId),
      s.startedAt
    );
    const daysSinceStrength = lastStrength ? daysBetween(s.startedAt, lastStrength.startedAt) : null;
    const daysSinceAny = lastAny ? daysBetween(s.startedAt, lastAny.startedAt) : null;
    // A clean "no strength influence at all" baseline needs both: a real
    // rest gap immediately before, AND no strength session still within the
    // decay-tracking window — otherwise a session 3 days after leg day (a
    // decay-bucket member) could also qualify as "rested" purely because
    // nothing happened in the 1-2 days right before it, diluting the very
    // baseline it's being compared against.
    const outsideDecayWindow =
      daysSinceStrength === null ||
      daysSinceStrength > INTERFERENCE_CONFIG.LOOKBACK_DAYS_STRENGTH_EFFECT_ON_CARDIO;
    return {
      session: s,
      daysSinceStrength,
      isRestedBaseline:
        daysSinceAny !== null &&
        daysSinceAny >= INTERFERENCE_CONFIG.MIN_REST_DAYS_FOR_BASELINE &&
        outsideDecayWindow,
    };
  });

  const restedBaseline = tagged.filter((t) => t.isRestedBaseline);
  const restedEF = average(restedBaseline.map((t) => t.session.efficiencyFactor!));
  const restedHR = average(restedBaseline.map((t) => t.session.avgHeartRate!));

  const decayByDay: DayBucketStat[] = [];
  let postStrengthTotal = 0;
  for (let d = 0; d <= INTERFERENCE_CONFIG.LOOKBACK_DAYS_STRENGTH_EFFECT_ON_CARDIO; d++) {
    const bucket = tagged.filter((t) => t.daysSinceStrength === d);
    postStrengthTotal += bucket.length;
    const bucketEF = average(bucket.map((t) => t.session.efficiencyFactor!));
    const bucketHR = average(bucket.map((t) => t.session.avgHeartRate!));
    decayByDay.push({
      daysSinceStrength: d,
      sampleCount: bucket.length,
      efDeltaPct:
        bucketEF !== null && restedEF !== null && restedEF !== 0
          ? Math.round(((bucketEF - restedEF) / restedEF) * 1000) / 10
          : null,
      hrDeltaBpm:
        bucketHR !== null && restedHR !== null ? Math.round(bucketHR - restedHR) : null,
    });
  }

  const calibrating =
    postStrengthTotal < minSamples || restedBaseline.length < 2 || restedEF === null;

  if (calibrating) {
    const sportLabel = primarySport.replace("_", " ");
    // The confusing case: plenty of easy-effort sessions logged (so the
    // athlete sees a real, non-zero "sessions" count elsewhere and expects
    // a finding), but none of them happen to fall within the decay window
    // after a strength session — a temporal-proximity gap, not a logging-
    // volume gap. Naming this explicitly instead of just "X/5 logged" is
    // the difference between "makes sense, I need to log closer together"
    // and "why does this say 0 when I've logged so much".
    const summary =
      postStrengthTotal === 0 && primarySessions.length > 0
        ? `You've logged ${primarySessions.length} easy-effort ${sportLabel} session${primarySessions.length === 1 ? "" : "s"}, but none within ${INTERFERENCE_CONFIG.LOOKBACK_DAYS_STRENGTH_EFFECT_ON_CARDIO} days of a strength session yet — log one soon after your next gym day to start building this.`
        : `Gathering data — ${postStrengthTotal}/${minSamples} comparable sessions logged.`;

    return {
      calibrating: true,
      sampleCount: postStrengthTotal,
      minSamples,
      primarySport,
      totalQualifyingSessions: primarySessions.length,
      decayByDay: [],
      summary,
    };
  }

  const summary = buildStrengthToCardioSummary(decayByDay, primarySport);

  return {
    calibrating: false,
    sampleCount: postStrengthTotal,
    minSamples,
    primarySport,
    totalQualifyingSessions: primarySessions.length,
    decayByDay,
    summary,
  };
}

function buildStrengthToCardioSummary(decayByDay: DayBucketStat[], sport: string): string {
  const sportLabel = sport.replace("_", " ");
  // The day-after (d=1) is the most intuitive framing; fall back to same-day if that's all there is.
  const dayOne = decayByDay.find((d) => d.daysSinceStrength === 1 && d.sampleCount > 0);
  const dayZero = decayByDay.find((d) => d.daysSinceStrength === 0 && d.sampleCount > 0);
  const headline = dayOne ?? dayZero;

  if (!headline || headline.efDeltaPct === null || Math.abs(headline.efDeltaPct) < 3) {
    return `No measurable interference — your ${sportLabel} sessions hold up well after strength training.`;
  }

  const direction = headline.efDeltaPct < 0 ? "cost you" : "actually help";
  const magnitude = Math.abs(headline.efDeltaPct);
  const when = headline.daysSinceStrength === 0 ? "the same day" : "the next day";

  const recoveryDay = decayByDay.find(
    (d) => d.daysSinceStrength > headline.daysSinceStrength && d.efDeltaPct !== null && Math.abs(d.efDeltaPct) < 3
  );
  const hrPart =
    headline.hrDeltaBpm !== null && Math.abs(headline.hrDeltaBpm) >= 2
      ? ` and ${headline.hrDeltaBpm > 0 ? "+" : ""}${headline.hrDeltaBpm}bpm`
      : "";
  const recoveryPart = recoveryDay
    ? `, recovering by day ${recoveryDay.daysSinceStrength}`
    : "";

  return `Strength sessions ${direction} roughly ${magnitude}% efficiency${hrPart} on ${sportLabel} ${when}${recoveryPart}.`;
}

function computeCardioToStrength(sessions: TimelineSession[]): CardioToStrengthFinding {
  const minSamples = INTERFERENCE_CONFIG.MIN_PAIRED_SESSIONS;
  const windowDays = INTERFERENCE_CONFIG.LOOKBACK_DAYS_CARDIO_EFFECT_ON_STRENGTH;

  const strengthSessions = sessions.filter(
    (s) => s.domain === "strength" && s.strengthComponent != null
  );

  if (strengthSessions.length < minSamples) {
    return {
      calibrating: true,
      sampleCount: strengthSessions.length,
      minSamples,
      highCardioAvgStrengthComponent: null,
      lowCardioAvgStrengthComponent: null,
      deltaPct: null,
      summary: `Gathering data — ${strengthSessions.length}/${minSamples} gym sessions logged.`,
    };
  }

  const withTrailingCardio = strengthSessions.map((s) => {
    const windowStart = new Date(new Date(s.startedAt).getTime() - windowDays * DAY_MS).toISOString();
    const trailingCardioLoad = sessions
      .filter(
        (x) =>
          x.domain === "cardio" &&
          x.startedAt >= windowStart &&
          x.startedAt < s.startedAt &&
          x.loadScore != null
      )
      .reduce((sum, x) => sum + (x.loadScore ?? 0), 0);
    return { session: s, trailingCardioLoad };
  });

  // Split by rank (top half vs bottom half of sorted order), not by
  // comparing against the median value — a value-based split (">
  // median"/"<= median") can leave one side empty whenever several
  // sessions tie exactly at the median (a common case: many strength
  // sessions genuinely have zero trailing cardio load).
  const sortedByLoad = [...withTrailingCardio].sort((a, b) => a.trailingCardioLoad - b.trailingCardioLoad);
  const splitIndex = Math.floor(sortedByLoad.length / 2);
  const low = sortedByLoad.slice(0, splitIndex);
  const high = sortedByLoad.slice(splitIndex);

  const highAvg = average(high.map((x) => x.session.strengthComponent!));
  const lowAvg = average(low.map((x) => x.session.strengthComponent!));

  if (high.length < 2 || low.length < 2 || highAvg === null || lowAvg === null || lowAvg === 0) {
    return {
      calibrating: true,
      sampleCount: strengthSessions.length,
      minSamples,
      highCardioAvgStrengthComponent: null,
      lowCardioAvgStrengthComponent: null,
      deltaPct: null,
      summary: `Gathering data — need a wider mix of high- and low-cardio-volume weeks to compare.`,
    };
  }

  const deltaPct = Math.round(((highAvg - lowAvg) / lowAvg) * 1000) / 10;
  const summary =
    Math.abs(deltaPct) < 3
      ? "No measurable interference — your lifting holds up well regardless of your recent cardio volume."
      : `Heavy cardio weeks ${deltaPct < 0 ? "cost you" : "coincide with"} roughly ${Math.abs(
          deltaPct
        )}% strength performance compared to lighter cardio weeks.`;

  return {
    calibrating: false,
    sampleCount: strengthSessions.length,
    minSamples,
    highCardioAvgStrengthComponent: Math.round(highAvg),
    lowCardioAvgStrengthComponent: Math.round(lowAvg),
    deltaPct,
    summary,
  };
}

export function computeInterferenceReport(sessions: TimelineSession[]): InterferenceReport {
  return {
    strengthToCardio: computeStrengthToCardio(sessions),
    cardioToStrength: computeCardioToStrength(sessions),
  };
}

/** The single most useful sentence from a report — prefers the strength->cardio direction (usually the more actionable one) once it's real, falling back to the reverse direction, then to a gathering-data message. Shared by the shareable report card and the Hybrid Athlete Report. */
export function pickInterferenceHeadline(report: InterferenceReport): string {
  if (!report.strengthToCardio.calibrating) return report.strengthToCardio.summary;
  if (!report.cardioToStrength.calibrating) return report.cardioToStrength.summary;
  return "Still gathering paired training data — check back after a few more logged sessions.";
}
