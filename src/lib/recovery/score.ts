/**
 * The Recovery score — one number for "what state is the body actually in
 * today", composed from every recovery signal the app holds.
 *
 * WHY THIS EXISTS RATHER THAN A SECOND GAUGE
 * ------------------------------------------
 * Before this, four recovery signals lived in four places and never met:
 * cross-domain readiness on the dashboard (ACWR + fatigue), manual HRV buried
 * in the Injury Risk panel, the ACWR trend chart in Analytics, and session
 * count nowhere in particular. Each was individually defensible and together
 * they answered nothing, because an athlete with readiness 74 and an HRV 18%
 * below baseline has no way to combine those two facts — and the app, which
 * holds both, was leaving that arithmetic to them.
 *
 * Readiness is now an INPUT here, not a rival number. It still exists, it
 * still drives the Today plan, and it is still shown in the breakdown by name
 * — but the headline on the dashboard is the composed score, so there is one
 * answer to "should I train hard today" instead of two that can disagree.
 *
 * MISSING SIGNALS ARE NOT ZERO
 * ----------------------------
 * The trap in any composite is treating an absent input as a bad one. An
 * athlete who has never logged HRV would score identically to one whose HRV
 * has collapsed, which would make the number actively misleading for the
 * majority of users who will never own a strap. So weights are renormalised
 * over the components that are actually present, and every absent component is
 * surfaced in the breakdown as "not contributing yet" with the thing they
 * could do about it. Alcohol is the exception and is handled as a deduction
 * rather than a component, because "no alcohol logged" genuinely is the
 * neutral case: it costs nothing, and it cannot be faked into a bonus by
 * abstaining, which would turn the score into a compliance meter.
 */
import { computeAlcoholImpact, type AlcoholImpact, type AlcoholSex, type DrinkEntry } from "./alcohol";
import type { ReadinessResult } from "@/lib/scoring/readiness";

export type RecoveryBand = "primed" | "steady" | "compromised" | "depleted";

export type RecoveryComponentKey = "load" | "hrv" | "density" | "alcohol";

export interface RecoveryComponent {
  key: RecoveryComponentKey;
  label: string;
  /** 0-100 for contributing components; for alcohol, the points deducted (negative). */
  value: number | null;
  /** Share of the composed score this component carried, 0-1. Zero when absent. */
  weight: number;
  present: boolean;
  /** One line: what this component is saying, or what to do to switch it on. */
  detail: string;
}

export interface RecoveryScoreResult {
  score: number;
  band: RecoveryBand;
  headline: string;
  components: RecoveryComponent[];
  /** The dominant reason the score is not 100, for the one-line dashboard summary. */
  limiter: RecoveryComponentKey | null;
  alcohol: AlcoholImpact;
  /** True when only training load is available — the score is thin and should say so. */
  thin: boolean;
}

export interface RecoveryScoreInput {
  readiness: ReadinessResult;
  /** Most recent HRV reading in ms, and the mean of the readings before it. */
  hrvToday?: number | null;
  hrvBaseline?: number | null;
  /** Start times of sessions in the trailing 7 days, ISO or Date. */
  recentSessionDates: (string | Date)[];
  drinks: DrinkEntry[];
  bodyweightKg: number;
  sex: AlcoholSex;
  timeZone?: string;
  now?: Date;
}

/**
 * Base weights. Load carries the most because it is the only signal the app
 * can compute for every athlete from data they already log; HRV outranks
 * session density when present because it is a measurement of the athlete
 * rather than an inference about them.
 */
const WEIGHTS = { load: 0.5, hrv: 0.3, density: 0.2 } as const;

const DAY_MS = 86_400_000;

/**
 * HRV as a percentage of the athlete's own rolling baseline, mapped to 0-100.
 *
 * Deliberately not linear. A reading 10% below baseline is a meaningful
 * suppression and the curve is steep there; a reading 20% ABOVE baseline is
 * not twice as good as one 10% above, and flattening the top stops a single
 * unusually calm morning from papering over a genuinely heavy training week.
 */
const HRV_ANCHORS: readonly [number, number][] = [
  [0.7, 0],
  [0.8, 22],
  [0.9, 50],
  [0.95, 65],
  [1.0, 78],
  [1.05, 88],
  [1.1, 94],
  [1.2, 100],
];

export function hrvComponentScore(today: number, baseline: number): number {
  if (baseline <= 0) return 50;
  return Math.round(interpolate(HRV_ANCHORS, today / baseline));
}

/**
 * Session density over the trailing 7 days.
 *
 * This is the "how many sessions have you done recently" signal, and it is
 * NOT a duplicate of ACWR. ACWR is about load relative to the athlete's own
 * chronic norm — it goes quiet for someone who is consistently training a lot,
 * because a lot IS their norm. Density is about frequency and, more to the
 * point, about whether a rest day has happened at all: seven sessions in seven
 * days is a recovery problem even when every one of them was easy and ACWR
 * never moved.
 */
const DENSITY_ANCHORS: readonly [number, number][] = [
  [0, 100],
  [3, 92],
  [5, 78],
  [6, 66],
  [7, 52],
  [9, 34],
  [12, 18],
];

/** No rest day in a week is its own signal, independent of how many sessions. */
const NO_REST_DAY_PENALTY = 12;

export function densityComponentScore(sessionDates: Date[], now: Date): {
  score: number;
  sessionCount: number;
  restDays: number;
} {
  const weekAgo = now.getTime() - 7 * DAY_MS;
  const inWindow = sessionDates.filter(
    (d) => d.getTime() >= weekAgo && d.getTime() <= now.getTime()
  );

  const daysWithSession = new Set(inWindow.map((d) => Math.floor(d.getTime() / DAY_MS)));
  const restDays = 7 - Math.min(7, daysWithSession.size);

  let score = interpolate(DENSITY_ANCHORS, inWindow.length);
  if (restDays === 0 && inWindow.length > 0) score -= NO_REST_DAY_PENALTY;

  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    sessionCount: inWindow.length,
    restDays,
  };
}

export function bandFor(score: number): RecoveryBand {
  if (score >= 75) return "primed";
  if (score >= 55) return "steady";
  if (score >= 35) return "compromised";
  return "depleted";
}

export const BAND_LABELS: Record<RecoveryBand, string> = {
  primed: "Primed",
  steady: "Steady",
  compromised: "Compromised",
  depleted: "Depleted",
};

export const BAND_BLURBS: Record<RecoveryBand, string> = {
  primed: "Body is ready for load",
  steady: "Train, but manage intensity",
  compromised: "Back off the top end today",
  depleted: "Rest or move very easy",
};

export function computeRecoveryScore(input: RecoveryScoreInput): RecoveryScoreResult {
  const now = input.now ?? new Date();

  const loadScore = clamp(input.readiness.readiness, 0, 100);

  const hrvPresent =
    input.hrvToday != null &&
    input.hrvBaseline != null &&
    input.hrvBaseline > 0 &&
    input.hrvToday > 0;
  const hrvScore = hrvPresent
    ? hrvComponentScore(input.hrvToday as number, input.hrvBaseline as number)
    : null;

  const sessionDates = input.recentSessionDates
    .map((d) => (typeof d === "string" ? new Date(d) : d))
    .filter((d) => !Number.isNaN(d.getTime()));
  const density = densityComponentScore(sessionDates, now);
  // Density needs at least one session in the window to say anything. With
  // none, "100, perfectly fresh" would be true of a detrained athlete and of
  // somebody who just deleted their account, so it sits out instead.
  const densityPresent = density.sessionCount > 0;

  const parts: { key: RecoveryComponentKey; score: number; weight: number }[] = [
    { key: "load", score: loadScore, weight: WEIGHTS.load },
  ];
  if (hrvPresent) parts.push({ key: "hrv", score: hrvScore as number, weight: WEIGHTS.hrv });
  if (densityPresent) parts.push({ key: "density", score: density.score, weight: WEIGHTS.density });

  const totalWeight = parts.reduce((sum, p) => sum + p.weight, 0);
  const base = parts.reduce((sum, p) => sum + p.score * (p.weight / totalWeight), 0);

  const alcohol = computeAlcoholImpact({
    drinks: input.drinks,
    bodyweightKg: input.bodyweightKg,
    sex: input.sex,
    timeZone: input.timeZone,
    now,
  });

  const score = Math.round(clamp(base - alcohol.penalty, 0, 100));
  const band = bandFor(score);

  const components: RecoveryComponent[] = [
    {
      key: "load",
      label: "Training load",
      value: loadScore,
      weight: WEIGHTS.load / totalWeight,
      present: true,
      detail: input.readiness.reason,
    },
    {
      key: "hrv",
      label: "HRV vs baseline",
      value: hrvScore,
      weight: hrvPresent ? WEIGHTS.hrv / totalWeight : 0,
      present: hrvPresent,
      detail: hrvPresent
        ? describeHrv(input.hrvToday as number, input.hrvBaseline as number)
        : "Log a morning HRV reading for a few days and this starts contributing — until then the score leans on training load.",
    },
    {
      key: "density",
      label: "Session density",
      value: densityPresent ? density.score : null,
      weight: densityPresent ? WEIGHTS.density / totalWeight : 0,
      present: densityPresent,
      detail: densityPresent
        ? describeDensity(density.sessionCount, density.restDays)
        : "No sessions in the last 7 days, so frequency isn't saying anything yet.",
    },
    {
      key: "alcohol",
      label: "Alcohol",
      value: alcohol.penalty > 0 ? -alcohol.penalty : 0,
      weight: 0,
      present: alcohol.penalty > 0,
      detail: alcohol.explanation,
    },
  ];

  const limiter = findLimiter(components, alcohol);

  return {
    score,
    band,
    headline: buildHeadline(score, band, limiter, components, alcohol),
    components,
    limiter,
    alcohol,
    thin: parts.length === 1 && alcohol.penalty === 0,
  };
}

function describeHrv(today: number, baseline: number): string {
  const delta = Math.round((today / baseline - 1) * 100);
  if (delta <= -10) return `${today}ms is ${Math.abs(delta)}% below your baseline — a clear suppression.`;
  if (delta < 0) return `${today}ms is ${Math.abs(delta)}% below your ${Math.round(baseline)}ms baseline.`;
  if (delta === 0) return `${today}ms is right on your baseline.`;
  return `${today}ms is ${delta}% above your ${Math.round(baseline)}ms baseline.`;
}

function describeDensity(sessionCount: number, restDays: number): string {
  if (restDays === 0) return `${sessionCount} sessions and no rest day in the last 7 — frequency alone is a recovery cost.`;
  if (sessionCount >= 7) return `${sessionCount} sessions in 7 days with ${restDays} rest ${restDays === 1 ? "day" : "days"}.`;
  return `${sessionCount} sessions in the last 7 days, ${restDays} rest ${restDays === 1 ? "day" : "days"}.`;
}

/** The component costing the most, which is what the one-line summary names. */
function findLimiter(
  components: RecoveryComponent[],
  alcohol: AlcoholImpact
): RecoveryComponentKey | null {
  const worst = components
    .filter((c) => c.key !== "alcohol" && c.present)
    /*
     * Cost in POINTS OFF THE FINAL SCORE, not in distance from 100. A component
     * sitting at 40 with a 20% weight costs 12 points; one at 70 with a 50%
     * weight costs 15 and is the bigger problem, even though it looks healthier
     * in isolation. Ranking on the raw value would name the wrong driver
     * roughly whenever the weights differ, which is always.
     */
    .map((c) => ({ key: c.key, cost: (100 - (c.value ?? 100)) * c.weight }))
    .sort((a, b) => b.cost - a.cost)[0];

  // Below a couple of points, nothing is meaningfully "the reason" — saying so
  // is more honest than promoting the least-good of four healthy signals.
  const MEANINGFUL = 3;
  if (alcohol.penalty > (worst?.cost ?? 0) && alcohol.penalty > 0) return "alcohol";
  return worst && worst.cost > MEANINGFUL ? worst.key : null;
}

function buildHeadline(
  score: number,
  band: RecoveryBand,
  limiter: RecoveryComponentKey | null,
  components: RecoveryComponent[],
  alcohol: AlcoholImpact
): string {
  if (limiter === null || score >= 85) {
    return "Nothing is holding you back today — every recovery signal is in its normal range.";
  }
  if (limiter === "alcohol") {
    return alcohol.explanation;
  }
  const component = components.find((c) => c.key === limiter);
  if (!component) return BAND_BLURBS[band];
  return `${component.label} is the main thing holding this down — ${lowerFirst(component.detail)}`;
}

function lowerFirst(s: string): string {
  return s.length > 0 ? s[0].toLowerCase() + s.slice(1) : s;
}

function interpolate(anchors: readonly [number, number][], x: number): number {
  if (x <= anchors[0][0]) return anchors[0][1];
  const last = anchors[anchors.length - 1];
  if (x >= last[0]) return last[1];
  for (let i = 1; i < anchors.length; i++) {
    const [x1, y1] = anchors[i];
    const [x0, y0] = anchors[i - 1];
    if (x <= x1) return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
  }
  return last[1];
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
