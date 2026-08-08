/**
 * Lactate threshold & race-effort VO2max estimates (user feedback: "what
 * other data can I add in that we don't already have, e.g. can you compute
 * a lactate threshold or additional features which Garmin has which Split
 * Index may currently be falling behind on").
 *
 * Neither of these measures actual blood lactate or gas exchange — no
 * consumer wearable does either, Garmin included. Both are estimated from
 * logged pace/HR/duration the same way every mainstream platform does it:
 *
 *  - Lactate threshold: the HR/pace an athlete can sustain for a genuinely
 *    hard, non-maximal effort (~20-60min) — approximated from this
 *    athlete's own sessions explicitly tagged "threshold" or "tempo",
 *    never a population formula. Sessions tagged "race" are deliberately
 *    excluded: a 5K race sits near VO2max effort, a marathon sits well
 *    below threshold — mixing them in would corrupt the estimate.
 *
 *  - VO2max (race-effort / VDOT method): Jack Daniels & Jimmy Gilbert's
 *    published VDOT formula (Daniels' Running Formula), distinct from and
 *    complementary to the existing per-session HR-ratio/pace estimate in
 *    cardio/vo2max.ts — VDOT specifically corrects for how long the effort
 *    was sustained, which the simpler per-session estimate doesn't, so a
 *    genuine race effort (or the athlete's own blended 5K prediction)
 *    typically yields a more accurate number than any single easy run.
 */
import type { SessionType, SportType } from "@/types";

export interface LactateThresholdEstimate {
  hrBpm: number;
  paceSecondsPerKm: number;
  /** The sport these sessions were drawn from — LT is sport-specific (running pace and rowing split aren't comparable). */
  sport: SportType;
  sampleCount: number;
  confidence: "low" | "medium" | "high";
  asOfIso: string;
}

interface ThresholdSession {
  sport: SportType;
  sessionType: SessionType | null;
  startedAt: string;
  durationSeconds: number;
  distanceMeters: number | null;
  avgHeartRate: number | null;
}

/** Genuinely sustained efforts only — a 3-minute "threshold" interval rep isn't a real LT reading. */
const MIN_THRESHOLD_DURATION_SECONDS = 15 * 60;
/** Anything longer starts drifting toward a long-run/endurance effort rather than a true threshold test. */
const MAX_THRESHOLD_DURATION_SECONDS = 70 * 60;
const QUALIFYING_SESSION_TYPES = new Set<SessionType>(["threshold", "tempo"]);
/** How many of the most recent qualifying sessions to average for a smoothed, less noise-prone reading. */
const SMOOTHING_WINDOW = 3;

export function estimateLactateThreshold(
  sessions: ThresholdSession[]
): LactateThresholdEstimate | null {
  const qualifying = sessions.filter(
    (s) =>
      s.sessionType != null &&
      QUALIFYING_SESSION_TYPES.has(s.sessionType) &&
      s.avgHeartRate != null &&
      s.avgHeartRate > 0 &&
      s.distanceMeters != null &&
      s.distanceMeters > 0 &&
      s.durationSeconds >= MIN_THRESHOLD_DURATION_SECONDS &&
      s.durationSeconds <= MAX_THRESHOLD_DURATION_SECONDS
  );
  if (qualifying.length === 0) return null;

  // LT is sport-specific — running pace and rowing split/500m aren't
  // comparable, so (as with the interference engine) pick whichever sport
  // actually has qualifying sessions, most-logged first.
  const bySport = new Map<SportType, ThresholdSession[]>();
  for (const s of qualifying) {
    const bucket = bySport.get(s.sport);
    if (bucket) bucket.push(s);
    else bySport.set(s.sport, [s]);
  }
  const [sport, sportSessions] = [...bySport.entries()].sort(
    (a, b) => b[1].length - a[1].length
  )[0];

  const sorted = [...sportSessions].sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
  );
  const window = sorted.slice(0, SMOOTHING_WINDOW);

  const avgHr =
    window.reduce((sum, s) => sum + (s.avgHeartRate as number), 0) / window.length;
  const avgPaceSecPerKm =
    window.reduce(
      (sum, s) => sum + s.durationSeconds / ((s.distanceMeters as number) / 1000),
      0
    ) / window.length;

  return {
    hrBpm: Math.round(avgHr),
    paceSecondsPerKm: Math.round(avgPaceSecPerKm),
    sport,
    sampleCount: window.length,
    confidence: window.length >= 3 ? "high" : window.length === 2 ? "medium" : "low",
    asOfIso: sorted[0].startedAt,
  };
}

export interface RaceEffortVo2MaxEstimate {
  value: number; // ml/kg/min
  source: "logged-race" | "predicted-5k";
  asOfIso: string | null;
}

/** Sane bounds for a race-like effort the VDOT formula is calibrated for — roughly 3min (1500m-ish) to 4h (marathon-plus). Outside this, the formula's underlying regression breaks down. */
const MIN_VDOT_MINUTES = 3;
const MAX_VDOT_MINUTES = 240;

/**
 * Daniels & Gilbert's VDOT formula (Daniels' Running Formula, 3rd ed.) —
 * the same math behind McMillan/most public race-time calculators.
 * distanceMeters/durationSeconds should be a genuine hard-effort
 * performance (a race, or this athlete's own blended race prediction),
 * not an easy run — feeding it an easy pace would read as a much lower
 * VO2max than the athlete actually has.
 */
export function vdot(distanceMeters: number, durationSeconds: number): number | null {
  const minutes = durationSeconds / 60;
  if (distanceMeters <= 0 || minutes < MIN_VDOT_MINUTES || minutes > MAX_VDOT_MINUTES) {
    return null;
  }
  const velocityMetersPerMin = distanceMeters / minutes;
  const vo2 =
    -4.6 + 0.182258 * velocityMetersPerMin + 0.000104 * velocityMetersPerMin ** 2;
  const percentMax =
    0.8 +
    0.1894393 * Math.exp(-0.012778 * minutes) +
    0.2989558 * Math.exp(-0.1932605 * minutes);
  if (percentMax <= 0) return null;
  return Math.round((vo2 / percentMax) * 10) / 10;
}

export function estimateRaceEffortVo2Max(
  raceSessions: { distanceMeters: number | null; durationSeconds: number; startedAt: string }[],
  predicted5kSeconds: number | null
): RaceEffortVo2MaxEstimate | null {
  // Prefer a real logged race over the blended prediction — an actual
  // performance beats a model's estimate of one.
  const qualifying = raceSessions
    .filter((s) => s.distanceMeters != null && s.distanceMeters > 0)
    .map((s) => ({ ...s, value: vdot(s.distanceMeters as number, s.durationSeconds) }))
    .filter((s): s is typeof s & { value: number } => s.value !== null)
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());

  if (qualifying.length > 0) {
    return { value: qualifying[0].value, source: "logged-race", asOfIso: qualifying[0].startedAt };
  }

  if (predicted5kSeconds != null && predicted5kSeconds > 0) {
    const value = vdot(5000, predicted5kSeconds);
    if (value !== null) return { value, source: "predicted-5k", asOfIso: null };
  }

  return null;
}
