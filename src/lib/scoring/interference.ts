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
  // Lowered from 5: still a real statistical minimum (this is the athlete's
  // own paired history, not a population claim, so it can't drop to 1-2
  // without risking a "confidently wrong" finding from noise) but low enough
  // that a normally-active hybrid athlete sees their first real result
  // within a couple of weeks rather than a full training block.
  MIN_PAIRED_SESSIONS: 3,
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

/** A rolling 7-day bucket key (not a calendar Mon-Sun week, just a consistent 7-day grouping) — used only by the weekly fallback comparison below. */
function weekKey(iso: string): number {
  return Math.floor(dateOnlyUtcMs(iso) / (7 * DAY_MS));
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

/**
 * A coarser fallback comparison used only while the precise day-level
 * pairing above doesn't have enough proximate samples yet: splits the
 * athlete's own qualifying easy-effort sessions into weeks that contained a
 * strength session vs weeks that didn't, and compares average efficiency
 * between the two groups. Still genuinely personal (mined from the same
 * athlete's own data), just a coarser time-grain than "the day after leg
 * day" — never a population average, and null unless both groups have
 * enough samples to be a real comparison rather than noise.
 */
export interface WeeklyInterferenceFallback {
  weeksWithStrengthAvgEF: number;
  weeksWithoutStrengthAvgEF: number;
  deltaPct: number;
  sampleCountWithStrength: number;
  sampleCountWithoutStrength: number;
  summary: string;
}

export interface StrengthToCardioFinding {
  /** True only when there's truly nothing to compute yet (zero qualifying sessions, or no rested baseline at all) — the UI should show a "keep logging" placeholder. False as soon as ANY real comparison exists, however thin. */
  calibrating: boolean;
  /** True whenever a real finding exists but sample size is still below minSamples — the UI shows the finding alongside an explicit reliability caveat instead of hiding it (user feedback: "show relevant data regardless of how many exercises completed, just inform the user it's less reliable with fewer sessions"). Always false when calibrating is true (nothing to caveat). */
  lowConfidence: boolean;
  sampleCount: number;
  minSamples: number;
  /** The cardio sport this finding is based on (the athlete's most-logged qualifying sport — comparing pace/EF across different sports isn't meaningful). */
  primarySport: string | null;
  /** Total easy/recovery/long primarySport sessions with HR+EF data, regardless of proximity to a strength session — lets the calibrating message distinguish "not enough easy-effort cardio logged at all" from "plenty logged, just none near a strength session yet". */
  totalQualifyingSessions: number;
  decayByDay: DayBucketStat[];
  summary: string;
  /** Populated only while `calibrating` is true and there's enough weekly-pattern data to say something real at a coarser grain than the day-level pairing needs. Null once the precise finding is ready (or if there still isn't enough data at any grain). */
  weeklyFallback: WeeklyInterferenceFallback | null;
}

export interface CardioToStrengthFinding {
  /** True only when there's truly nothing to compute yet — see StrengthToCardioFinding.calibrating. */
  calibrating: boolean;
  /** See StrengthToCardioFinding.lowConfidence. */
  lowConfidence: boolean;
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

const MIN_WEEKLY_FALLBACK_SAMPLES_PER_GROUP = 2;

/** See WeeklyInterferenceFallback — null unless both "weeks with a strength session" and "weeks without" have enough qualifying sessions to compare. */
function computeWeeklyFallback(
  primarySessions: TimelineSession[],
  allSessions: TimelineSession[],
  sportLabel: string
): WeeklyInterferenceFallback | null {
  const strengthWeeks = new Set(
    allSessions.filter((s) => s.domain === "strength").map((s) => weekKey(s.startedAt))
  );
  if (strengthWeeks.size === 0) return null;

  const withStrength = primarySessions.filter((s) => strengthWeeks.has(weekKey(s.startedAt)));
  const withoutStrength = primarySessions.filter((s) => !strengthWeeks.has(weekKey(s.startedAt)));

  if (
    withStrength.length < MIN_WEEKLY_FALLBACK_SAMPLES_PER_GROUP ||
    withoutStrength.length < MIN_WEEKLY_FALLBACK_SAMPLES_PER_GROUP
  ) {
    return null;
  }

  const withAvg = average(withStrength.map((s) => s.efficiencyFactor!));
  const withoutAvg = average(withoutStrength.map((s) => s.efficiencyFactor!));
  if (withAvg === null || withoutAvg === null || withoutAvg === 0) return null;

  const deltaPct = Math.round(((withAvg - withoutAvg) / withoutAvg) * 1000) / 10;
  const summary =
    Math.abs(deltaPct) < 3
      ? `No measurable weekly pattern yet — your ${sportLabel} efficiency looks about the same whether or not a strength session happened that week.`
      : `Cardio efficiency runs about ${Math.abs(deltaPct)}% ${deltaPct < 0 ? "lower" : "higher"} in weeks that include a strength session, based on your own logged pattern.`;

  return {
    weeksWithStrengthAvgEF: Math.round(withAvg * 1000) / 1000,
    weeksWithoutStrengthAvgEF: Math.round(withoutAvg * 1000) / 1000,
    deltaPct,
    sampleCountWithStrength: withStrength.length,
    sampleCountWithoutStrength: withoutStrength.length,
    summary,
  };
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
      lowConfidence: false,
      sampleCount: 0,
      minSamples,
      primarySport: null,
      totalQualifyingSessions: 0,
      decayByDay: [],
      summary: "Log a few easy/recovery cardio sessions to unlock this — nothing to compare yet.",
      weeklyFallback: null,
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

  // Hard block ONLY when there's truly nothing to compute — no post-strength
  // sample at all, or no rested baseline to compare it against. Below
  // minSamples but above zero is real data; user feedback: show it, with a
  // reliability caveat, rather than hiding it behind a sample-count wall.
  const noDataAtAll = postStrengthTotal === 0 || restedBaseline.length === 0 || restedEF === null;

  if (noDataAtAll) {
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
        : `Log a rested (no strength session nearby) ${sportLabel} session to give this a baseline to compare against.`;

    return {
      calibrating: true,
      lowConfidence: false,
      sampleCount: postStrengthTotal,
      minSamples,
      primarySport,
      totalQualifyingSessions: primarySessions.length,
      decayByDay: [],
      summary,
      weeklyFallback: computeWeeklyFallback(primarySessions, sessions, sportLabel),
    };
  }

  const lowConfidence = postStrengthTotal < minSamples || restedBaseline.length < 2;
  const summary = buildStrengthToCardioSummary(decayByDay, primarySport, lowConfidence, postStrengthTotal);

  return {
    calibrating: false,
    lowConfidence,
    sampleCount: postStrengthTotal,
    minSamples,
    primarySport,
    totalQualifyingSessions: primarySessions.length,
    decayByDay,
    summary,
    weeklyFallback: null,
  };
}

function buildStrengthToCardioSummary(
  decayByDay: DayBucketStat[],
  sport: string,
  lowConfidence = false,
  sampleCount = 0
): string {
  const sportLabel = sport.replace("_", " ");
  // The day-after (d=1) is the most intuitive framing; fall back to same-day if that's all there is.
  const dayOne = decayByDay.find((d) => d.daysSinceStrength === 1 && d.sampleCount > 0);
  const dayZero = decayByDay.find((d) => d.daysSinceStrength === 0 && d.sampleCount > 0);
  const headline = dayOne ?? dayZero;

  const caveat = lowConfidence
    ? ` Based on just ${sampleCount} session${sampleCount === 1 ? "" : "s"} so far — treat this as directional, not definitive, until you've logged more.`
    : "";

  if (!headline || headline.efDeltaPct === null || Math.abs(headline.efDeltaPct) < 3) {
    return `No measurable interference yet — your ${sportLabel} sessions hold up well after strength training.${caveat}`;
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

  return `Strength sessions ${direction} roughly ${magnitude}% efficiency${hrPart} on ${sportLabel} ${when}${recoveryPart}.${caveat}`;
}

function computeCardioToStrength(sessions: TimelineSession[]): CardioToStrengthFinding {
  const minSamples = INTERFERENCE_CONFIG.MIN_PAIRED_SESSIONS;
  const windowDays = INTERFERENCE_CONFIG.LOOKBACK_DAYS_CARDIO_EFFECT_ON_STRENGTH;

  const strengthSessions = sessions.filter(
    (s) => s.domain === "strength" && s.strengthComponent != null
  );

  // Hard block only when there literally aren't enough gym sessions to
  // split into two groups at all (need at least one on each side of the
  // trailing-cardio-load split). Below minSamples but >= 2 still gets a
  // real, flagged-low-confidence comparison — see lowConfidence below.
  if (strengthSessions.length < 2) {
    return {
      calibrating: true,
      lowConfidence: false,
      sampleCount: strengthSessions.length,
      minSamples,
      highCardioAvgStrengthComponent: null,
      lowCardioAvgStrengthComponent: null,
      deltaPct: null,
      summary: `Log a few more gym sessions to unlock this — need at least 2 to compare.`,
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

  if (high.length < 1 || low.length < 1 || highAvg === null || lowAvg === null || lowAvg === 0) {
    return {
      calibrating: true,
      lowConfidence: false,
      sampleCount: strengthSessions.length,
      minSamples,
      highCardioAvgStrengthComponent: null,
      lowCardioAvgStrengthComponent: null,
      deltaPct: null,
      // More concrete than "log a wider mix" — names the specific gap
      // (missing strength scores on some sessions vs. a real lack of
      // cardio-volume variety) so the user knows what to actually change,
      // matching the same "name the specific gap" treatment
      // computeStrengthToCardio already gives its own calibrating cases.
      summary:
        highAvg === null || lowAvg === null
          ? `Some of your recent gym sessions are missing a strength score to compare — log a few more complete sessions to unlock this.`
          : `Your last ${strengthSessions.length} gym sessions have followed similarly light cardio weeks — log a gym session after a genuinely heavier cardio week (or a fully rested one) to give this a real spread to compare.`,
    };
  }

  const lowConfidence = strengthSessions.length < minSamples || high.length < 2 || low.length < 2;
  const deltaPct = Math.round(((highAvg - lowAvg) / lowAvg) * 1000) / 10;
  const caveat = lowConfidence
    ? ` Based on just ${strengthSessions.length} gym session${strengthSessions.length === 1 ? "" : "s"} so far — treat this as directional, not definitive, until you've logged more.`
    : "";
  const summary =
    Math.abs(deltaPct) < 3
      ? `No measurable interference yet — your lifting holds up well regardless of your recent cardio volume.${caveat}`
      : `Heavy cardio weeks ${deltaPct < 0 ? "cost you" : "coincide with"} roughly ${Math.abs(
          deltaPct
        )}% strength performance compared to lighter cardio weeks.${caveat}`;

  return {
    calibrating: false,
    lowConfidence,
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

/**
 * True once there's a genuinely CONFIDENT (not just low-confidence-but-real)
 * signal to share publicly — deliberately a higher bar than what the
 * Interference page itself shows, since this feeds a shareable image/report
 * rather than the athlete's own private dashboard. A directional, small-n
 * finding is useful to show the athlete with a caveat; it's not something
 * that should go out as a shareable claim.
 */
export function hasShareableFinding(report: InterferenceReport): boolean {
  return (
    (!report.strengthToCardio.calibrating && !report.strengthToCardio.lowConfidence) ||
    (!report.cardioToStrength.calibrating && !report.cardioToStrength.lowConfidence) ||
    report.strengthToCardio.weeklyFallback !== null
  );
}

/** The single most useful sentence from a report — prefers the strength->cardio direction (usually the more actionable one) once it's real, falling back to the reverse direction, then the coarser weekly fallback, then a gathering-data message. Shared by the shareable report card and the Hybrid Athlete Report — same confident-only bar as hasShareableFinding. */
export function pickInterferenceHeadline(report: InterferenceReport): string {
  if (!report.strengthToCardio.calibrating && !report.strengthToCardio.lowConfidence) {
    return report.strengthToCardio.summary;
  }
  if (!report.cardioToStrength.calibrating && !report.cardioToStrength.lowConfidence) {
    return report.cardioToStrength.summary;
  }
  if (report.strengthToCardio.weeklyFallback) return report.strengthToCardio.weeklyFallback.summary;
  return "Still gathering paired training data — check back after a few more logged sessions.";
}
