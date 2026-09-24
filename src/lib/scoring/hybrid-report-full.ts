/**
 * The Hybrid Athlete Report, in full.
 *
 * User feedback (24 Sep 2026): "the hybrid athlete report is very poor with
 * very little information and almost seems like a waste... please populate
 * this with much more information regarding the athlete's hybrid
 * performance... use as much data you can capture from the app as possible."
 *
 * The stored monthly report (hybrid-report.ts) carried four fields. This is
 * built LIVE, on every visit, from everything the app already computes for
 * the other screens — the index history, every session in the period, the
 * strength engine's lifts, the race predictions and records, the composed
 * recovery score, the interference findings — and it says in one place what
 * those screens say in seven. Pure function: the caller
 * (hybrid-report-full-data.ts) does the reading.
 *
 * The period is the trailing 30 days, not the calendar month. A report that
 * opens on the 2nd with one day of data in it is not a report.
 */
import type { PersonalRecord, SportType } from "@/types";
import type { AnalyticsActivity, PredictedBenchmark, StrengthEstimate } from "@/components/analytics/types";
import { buildFitnessEstimates } from "@/components/analytics/utils";
import type { RaceRecord } from "./race-records";
import type { OverallDotsGlResult } from "./strength/overall-dots-gl";
import type { TimelineSession } from "./timeline";
import type { ReadinessResult } from "./readiness";
import type { RecoveryScoreResult } from "@/lib/recovery/score";
import { BAND_LABELS } from "@/lib/recovery/score";
import { computeInterferenceReport, type DayBucketStat } from "./interference";
import {
  cardioToStrengthVerdict,
  strengthToCardioVerdict,
  type DirectionVerdict,
} from "./interference-advice";
import { injuryRisk, type InjuryRiskResult } from "./injury-risk";
import { tierForScore } from "./split-strength-engine";
import { riegelPredictions } from "./cardio-activity";
import { tier2IsCalibrating, TIER2_MIN_SAMPLES_TO_DISPLAY } from "./cardio/race-prediction";
import { formatPredictionLabel } from "./presentation";
import { SPORTS } from "@/lib/constants/sports";
import { formatIndex, formatTrend } from "@/lib/utils/format";

const DAY_MS = 86_400_000;

export interface ReportIndexPoint {
  split_index: number;
  endurance_index: number;
  strength_index: number;
  recorded_at: string;
}

export interface ReportScore {
  activity_id: string;
  sport: SportType;
  sport_index: number;
  load_score: number;
  created_at: string;
}

export interface FullReportInputs {
  now: Date;
  periodDays: number;
  /** Ascending, as far back as the caller fetched (a year is plenty). */
  indexHistory: ReportIndexPoint[];
  /** Ascending; must cover at least the period plus the four weeks before it. */
  activities: AnalyticsActivity[];
  scores: ReportScore[];
  sessions: TimelineSession[];
  readiness: ReadinessResult | null;
  recovery: RecoveryScoreResult | null;
  hrvToday: number | null;
  hrvBaseline: number | null;
  predictedBenchmarks: PredictedBenchmark[];
  strengthEstimates: StrengthEstimate[];
  overallDotsGl: OverallDotsGlResult | null;
  /** DOTS/GL is a paid feature; the report shows the lifts either way. */
  showDotsGl: boolean;
  raceRecords: RaceRecord[];
  personalRecords: PersonalRecord[];
  /** The injury Risk Index states a conclusion about the body; it needs Article 9 consent. */
  article9Consent: boolean;
  targetSessionsPerWeek: number;
  /** Consecutive training days, from streak-utils. */
  streak: number;
}

export interface ScoreLine {
  /** Raw 0–1000 scale, or null with no history. */
  now: number | null;
  /** Where it stood at the start of the period; null with no earlier point. */
  start: number | null;
  /** Raw delta over the period; null when either end is missing. */
  delta: number | null;
}

export interface SportSummary {
  sport: SportType;
  label: string;
  sessions: number;
  minutes: number;
  distanceKm: number;
  avgIndex: number | null;
}

export interface FullHybridReport {
  generatedAt: string;
  periodDays: number;
  periodStart: string;
  headline: {
    split: ScoreLine;
    endurance: ScoreLine;
    strength: ScoreLine;
    tier: string | null;
    bestEver: { value: number; at: string } | null;
    atBestNow: boolean;
    weakerSide: "endurance" | "strength" | "balanced" | null;
  };
  balance: {
    sessions: number;
    strengthSessions: number;
    cardioSessions: number;
    strengthMinutes: number;
    cardioMinutes: number;
    /** Share of training TIME that was strength work, 0–1; null with no sessions. */
    strengthShare: number | null;
    distanceKm: number;
    totalLoad: number;
    strengthLoad: number;
    cardioLoad: number;
    bySport: SportSummary[];
  };
  consistency: {
    sessionsPerWeek: number;
    targetPerWeek: number;
    weeksHit: number;
    weeksCounted: number;
    longestGapDays: number | null;
    streak: number;
    /** Sessions per rolling 7-day window, oldest first. */
    weekly: number[];
  };
  strength: {
    sbd: { squat: number; bench: number; deadlift: number } | null;
    total: number | null;
    liftsLogged: number;
    dots: number | null;
    gl: number | null;
    dotsLocked: boolean;
    lifts: StrengthEstimate[];
    rising: number;
    falling: number;
  };
  endurance: {
    benchmarks: {
      sport: PredictedBenchmark["sport"];
      label: string;
      seconds: number | null;
      calibrating: boolean;
      sampleCount: number;
      samplesNeeded: number;
    }[];
    runLadder: { label: string; seconds: number }[];
    raceRecords: RaceRecord[];
    vo2max: number | null;
    lactateThreshold: { hrBpm: number; paceSecondsPerKm: number; sport: SportType } | null;
  };
  recovery: {
    score: number | null;
    band: string | null;
    headline: string | null;
    thin: boolean;
    readiness: number | null;
    acwr: number | null;
    injury: InjuryRiskResult | null;
    injuryHidden: boolean;
    hrvToday: number | null;
    hrvBaseline: number | null;
    weekLoad: number;
    avgWeekLoad: number;
  };
  interference: {
    strengthToCardio: DirectionVerdict;
    cardioToStrength: DirectionVerdict;
    decayByDay: DayBucketStat[];
    primarySport: string | null;
  };
  recordsThisPeriod: PersonalRecord[];
  /** Three to six plain sentences a coach would say first. */
  notes: string[];
}

const BENCHMARK_LABELS: Record<PredictedBenchmark["sport"], string> = {
  run: "5K run",
  walk: "Walking pace",
  row: "2K row",
  swim: "400m swim",
  cycle: "20K ride",
  ski: "2K SkiErg",
};

function sportLabel(sport: SportType): string {
  return SPORTS.find((s) => s.id === sport)?.name ?? sport.replace(/_/g, " ");
}

function scoreLine(
  history: ReportIndexPoint[],
  key: "split_index" | "endurance_index" | "strength_index",
  periodStartIso: string
): ScoreLine {
  if (history.length === 0) return { now: null, start: null, delta: null };
  const latest = history[history.length - 1];
  // Where you stood at the start: the last reading before the period, or the
  // first one inside it if you had none before.
  const before = [...history].reverse().find((p) => p.recorded_at < periodStartIso);
  const startPoint = before ?? history.find((p) => p.recorded_at >= periodStartIso) ?? null;
  const now = latest[key];
  const start = startPoint ? startPoint[key] : null;
  return { now, start, delta: start === null ? null : now - start };
}

function roundTo(value: number, places: number): number {
  const f = 10 ** places;
  return Math.round(value * f) / f;
}

export function buildFullHybridReport(input: FullReportInputs): FullHybridReport {
  const nowMs = input.now.getTime();
  const periodStartIso = new Date(nowMs - input.periodDays * DAY_MS).toISOString();
  const inPeriod = input.activities.filter((a) => a.started_at >= periodStartIso && a.started_at <= input.now.toISOString());

  // ── Headline ──────────────────────────────────────────────────────────
  const split = scoreLine(input.indexHistory, "split_index", periodStartIso);
  const endurance = scoreLine(input.indexHistory, "endurance_index", periodStartIso);
  const strength = scoreLine(input.indexHistory, "strength_index", periodStartIso);
  let bestEver: { value: number; at: string } | null = null;
  for (const p of input.indexHistory) {
    if (!bestEver || p.split_index > bestEver.value) bestEver = { value: p.split_index, at: p.recorded_at };
  }
  const gap = endurance.now !== null && strength.now !== null ? endurance.now - strength.now : null;
  const weakerSide = gap === null ? null : gap < -15 ? "endurance" : gap > 15 ? "strength" : "balanced";

  // ── Balance ───────────────────────────────────────────────────────────
  const loadByActivity = new Map(input.scores.map((s) => [s.activity_id, s.load_score]));
  const indexByActivity = new Map(input.scores.map((s) => [s.activity_id, s.sport_index]));
  const bySportMap = new Map<SportType, SportSummary & { indexSum: number; indexCount: number }>();
  let strengthSessions = 0;
  let cardioSessions = 0;
  let strengthMinutes = 0;
  let cardioMinutes = 0;
  let strengthLoad = 0;
  let cardioLoad = 0;
  let distanceKm = 0;
  for (const a of inPeriod) {
    const minutes = a.duration_seconds / 60;
    const load = loadByActivity.get(a.id) ?? 0;
    const isGym = a.sport === "gym";
    if (isGym) {
      strengthSessions++;
      strengthMinutes += minutes;
      strengthLoad += load;
    } else {
      cardioSessions++;
      cardioMinutes += minutes;
      cardioLoad += load;
      distanceKm += (a.distance_meters ?? 0) / 1000;
    }
    const entry =
      bySportMap.get(a.sport) ??
      { sport: a.sport, label: sportLabel(a.sport), sessions: 0, minutes: 0, distanceKm: 0, avgIndex: null, indexSum: 0, indexCount: 0 };
    entry.sessions++;
    entry.minutes += minutes;
    entry.distanceKm += (a.distance_meters ?? 0) / 1000;
    const idx = indexByActivity.get(a.id);
    if (idx != null) {
      entry.indexSum += idx;
      entry.indexCount++;
    }
    bySportMap.set(a.sport, entry);
  }
  const bySport: SportSummary[] = [...bySportMap.values()]
    .map(({ indexSum, indexCount, ...rest }) => ({
      ...rest,
      minutes: Math.round(rest.minutes),
      distanceKm: roundTo(rest.distanceKm, 1),
      avgIndex: indexCount > 0 ? Math.round(indexSum / indexCount) : null,
    }))
    .sort((a, b) => b.sessions - a.sessions || b.minutes - a.minutes);
  const totalMinutes = strengthMinutes + cardioMinutes;

  // ── Consistency ───────────────────────────────────────────────────────
  const weeksCounted = Math.max(1, Math.floor(input.periodDays / 7));
  const weekly: number[] = [];
  for (let w = weeksCounted - 1; w >= 0; w--) {
    const start = nowMs - (w + 1) * 7 * DAY_MS;
    const end = nowMs - w * 7 * DAY_MS;
    weekly.push(
      input.activities.filter((a) => {
        const t = new Date(a.started_at).getTime();
        return t >= start && t < end;
      }).length
    );
  }
  const weeksHit = weekly.filter((n) => n >= input.targetSessionsPerWeek).length;
  const dayKeys = [...new Set(inPeriod.map((a) => a.started_at.slice(0, 10)))].sort();
  let longestGapDays: number | null = null;
  for (let i = 1; i < dayKeys.length; i++) {
    const gapDays = Math.round((Date.parse(dayKeys[i]) - Date.parse(dayKeys[i - 1])) / DAY_MS) - 1;
    if (longestGapDays === null || gapDays > longestGapDays) longestGapDays = gapDays;
  }

  // ── Strength ──────────────────────────────────────────────────────────
  const lifts = [...input.strengthEstimates].sort(
    (a, b) => b.current1RmKg - a.current1RmKg || a.exerciseName.localeCompare(b.exerciseName)
  );
  const dots = input.overallDotsGl;

  // ── Endurance ─────────────────────────────────────────────────────────
  const benchmarks = input.predictedBenchmarks.map((b) => {
    const calibrating = tier2IsCalibrating(b.sampleCount);
    return {
      sport: b.sport,
      label: BENCHMARK_LABELS[b.sport],
      seconds: calibrating ? null : b.benchmarkSeconds,
      calibrating,
      sampleCount: b.sampleCount,
      samplesNeeded: TIER2_MIN_SAMPLES_TO_DISPLAY,
    };
  });
  const run = input.predictedBenchmarks.find((b) => b.sport === "run");
  const runLadder =
    run && !tier2IsCalibrating(run.sampleCount)
      ? Object.entries(riegelPredictions(5000, run.benchmarkSeconds, "intermediate", run.riegelK) ?? {})
          .sort(([a], [b]) => Number(a) - Number(b))
          .map(([dist, seconds]) => ({ label: formatPredictionLabel(dist), seconds }))
      : [];
  const fitness = buildFitnessEstimates(input.activities, input.predictedBenchmarks);

  // ── Recovery & load ───────────────────────────────────────────────────
  const weekLoad = input.scores
    .filter((s) => nowMs - new Date(s.created_at).getTime() <= 7 * DAY_MS)
    .reduce((sum, s) => sum + s.load_score, 0);
  const avgWeekLoad =
    input.scores
      .filter((s) => nowMs - new Date(s.created_at).getTime() <= 28 * DAY_MS)
      .reduce((sum, s) => sum + s.load_score, 0) / 4;
  const acwr = input.readiness?.overallAcwr ?? null;
  const injury = input.article9Consent && acwr !== null && input.sessions.length > 0 ? injuryRisk(acwr) : null;

  // ── Interference ──────────────────────────────────────────────────────
  const interferenceReport = computeInterferenceReport(input.sessions);
  const s2c = strengthToCardioVerdict(interferenceReport.strengthToCardio);
  const c2s = cardioToStrengthVerdict(interferenceReport.cardioToStrength);

  // ── Records ───────────────────────────────────────────────────────────
  const recordsThisPeriod = input.personalRecords
    .filter((r) => r.achieved_at >= periodStartIso)
    .sort((a, b) => (a.achieved_at < b.achieved_at ? 1 : -1));

  const report: FullHybridReport = {
    generatedAt: input.now.toISOString(),
    periodDays: input.periodDays,
    periodStart: periodStartIso,
    headline: {
      split,
      endurance,
      strength,
      tier: split.now !== null ? tierForScore(split.now) : null,
      bestEver,
      atBestNow: bestEver !== null && split.now !== null && split.now >= bestEver.value,
      weakerSide,
    },
    balance: {
      sessions: inPeriod.length,
      strengthSessions,
      cardioSessions,
      strengthMinutes: Math.round(strengthMinutes),
      cardioMinutes: Math.round(cardioMinutes),
      strengthShare: totalMinutes > 0 ? roundTo(strengthMinutes / totalMinutes, 2) : null,
      distanceKm: roundTo(distanceKm, 1),
      totalLoad: Math.round(strengthLoad + cardioLoad),
      strengthLoad: Math.round(strengthLoad),
      cardioLoad: Math.round(cardioLoad),
      bySport,
    },
    consistency: {
      sessionsPerWeek: roundTo(inPeriod.length / (input.periodDays / 7), 1),
      targetPerWeek: input.targetSessionsPerWeek,
      weeksHit,
      weeksCounted,
      longestGapDays,
      streak: input.streak,
      weekly,
    },
    strength: {
      sbd: dots ? { squat: dots.bestSbdKg.squat, bench: dots.bestSbdKg.bench, deadlift: dots.bestSbdKg.deadlift } : null,
      total: dots && dots.sbdTotalKg > 0 ? dots.sbdTotalKg : null,
      liftsLogged: dots?.liftsLogged ?? 0,
      dots: dots && input.showDotsGl ? dots.dotsScore : null,
      gl: dots && input.showDotsGl ? dots.glPoints : null,
      dotsLocked: !input.showDotsGl,
      lifts,
      rising: lifts.filter((l) => l.trend === "up").length,
      falling: lifts.filter((l) => l.trend === "down").length,
    },
    endurance: {
      benchmarks,
      runLadder,
      raceRecords: input.raceRecords,
      vo2max: fitness.vo2max ? roundTo(fitness.vo2max.value, 1) : null,
      lactateThreshold: fitness.lactateThreshold
        ? {
            hrBpm: fitness.lactateThreshold.hrBpm,
            paceSecondsPerKm: fitness.lactateThreshold.paceSecondsPerKm,
            sport: fitness.lactateThreshold.sport,
          }
        : null,
    },
    recovery: {
      score: input.recovery?.score ?? null,
      band: input.recovery ? BAND_LABELS[input.recovery.band] : null,
      headline: input.recovery?.headline ?? null,
      thin: input.recovery?.thin ?? true,
      readiness: input.readiness?.readiness ?? null,
      acwr: acwr === null ? null : roundTo(acwr, 2),
      injury,
      injuryHidden: !input.article9Consent,
      hrvToday: input.hrvToday,
      hrvBaseline: input.hrvBaseline === null ? null : Math.round(input.hrvBaseline),
      weekLoad: Math.round(weekLoad),
      avgWeekLoad: Math.round(avgWeekLoad),
    },
    interference: {
      strengthToCardio: s2c,
      cardioToStrength: c2s,
      decayByDay: interferenceReport.strengthToCardio.decayByDay,
      primarySport: interferenceReport.strengthToCardio.primarySport,
    },
    recordsThisPeriod,
    notes: [],
  };
  report.notes = buildNotes(report);
  return report;
}

/**
 * What a coach would say first, from the numbers above. Each rule fires only
 * when it has something specific to say; the list is capped so the report
 * opens with the important sentences, not every sentence.
 */
export function buildNotes(r: FullHybridReport): string[] {
  const notes: string[] = [];
  const { headline, balance, consistency, strength, endurance, recovery, interference } = r;

  if (headline.split.now !== null && headline.split.delta !== null) {
    const dir = headline.split.delta > 0 ? "up" : headline.split.delta < 0 ? "down" : "unchanged";
    notes.push(
      dir === "unchanged"
        ? `Your Split Index held at ${formatIndex(headline.split.now)} over the last ${r.periodDays} days.`
        : `Your Split Index is ${dir} ${formatTrend(headline.split.delta).replace(/^\+|-/, "")} to ${formatIndex(headline.split.now)} over the last ${r.periodDays} days.`
    );
  }
  if (headline.atBestNow && headline.split.now !== null) {
    notes.push("You are at your best-ever Split Index right now.");
  }

  if (balance.strengthShare !== null && balance.sessions >= 4) {
    const pct = Math.round(balance.strengthShare * 100);
    if (balance.strengthShare >= 0.65) {
      notes.push(
        `Strength took ${pct}% of your training time. ${
          headline.weakerSide === "endurance" ? "Endurance is the side with the lower score, so that is where the next gains are." : "Add an easy endurance session if you want the two sides to move together."
        }`
      );
    } else if (balance.strengthShare <= 0.35) {
      notes.push(
        `Endurance took ${100 - pct}% of your training time. ${
          headline.weakerSide === "strength" ? "Strength is the side with the lower score, so a second gym session a week would pay off." : "Keep a gym session in each week so the strength score holds."
        }`
      );
    } else {
      notes.push(`A genuinely hybrid month: ${pct}% strength, ${100 - pct}% endurance by time.`);
    }
  }

  if (consistency.weeksCounted > 0 && balance.sessions > 0) {
    notes.push(
      `You hit ${consistency.targetPerWeek} sessions in ${consistency.weeksHit} of the last ${consistency.weeksCounted} weeks (${consistency.sessionsPerWeek} a week on average).`
    );
  }
  if (consistency.longestGapDays !== null && consistency.longestGapDays >= 5) {
    notes.push(`Your longest break was ${consistency.longestGapDays} days without a session.`);
  }

  if (strength.rising > 0 && strength.falling > 0) {
    notes.push(`${lifts(strength.rising)} trending up and ${strength.falling} trending down.`);
  } else if (strength.rising > 0) {
    notes.push(`${lifts(strength.rising)} trending up.`);
  } else if (strength.falling > 0) {
    notes.push(`${lifts(strength.falling)} trending down — a lighter block, or fewer gym sessions, usually explains it.`);
  }

  const run = endurance.benchmarks.find((b) => b.sport === "run");
  if (run && run.seconds !== null) {
    const m = Math.floor(run.seconds / 60);
    const s = Math.round(run.seconds % 60);
    notes.push(`Your predicted 5K is ${m}:${s.toString().padStart(2, "0")} from ${run.sampleCount} runs of evidence.`);
  }

  if (recovery.score !== null && recovery.score < 50 && recovery.headline) {
    notes.push(`Recovery is ${recovery.band?.toLowerCase()} today — ${recovery.headline.replace(/\.$/, "")}.`);
  }
  if (recovery.injury && (recovery.injury.zone === "Caution" || recovery.injury.zone === "Danger")) {
    notes.push(
      `Training load has spiked: this week is ${recovery.weekLoad} against a ${recovery.avgWeekLoad} weekly average (${recovery.injury.zone.toLowerCase()} zone). Ease off before adding more.`
    );
  }

  for (const v of [interference.strengthToCardio, interference.cardioToStrength]) {
    if (v.verdict === "small" || v.verdict === "real") notes.push(`${v.sentence} ${v.advice}`);
  }

  return notes.slice(0, 6);
}

function lifts(n: number): string {
  return `${n} lift${n === 1 ? " is" : "s are"}`;
}
