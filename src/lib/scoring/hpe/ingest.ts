/**
 * Hybrid Plan Engine — WP0a, ingest.
 *
 * Maps Split Index's own rows onto the diagnostic's data model. This is the
 * only module in `hpe/` that knows what a Supabase row looks like; everything
 * else operates on plain `RunLog`/`LiftSet` values and stays testable without
 * a database.
 *
 * Brief §0a: "Flag maximal efforts (races and time trials) either from user
 * tagging or from a pace-outlier rule." Both are implemented — user tagging
 * is trusted first, and the outlier rule catches the athlete who raced but
 * logged it as an ordinary run, because a missed maximal effort is the
 * difference between a personal Riegel exponent and a population one.
 *
 * The engine consumes the four existing Split Index engines through thin
 * adapters and does not reimplement, refactor or revert any of them:
 *   - adaptive 1RM (SRI)          → `oneRms` passed in by the caller
 *   - two-tier race prediction    → seeds `predicted5kS` on AthleteState
 *   - personalised Karvonen HR    → `restingHr` / `maxHr` from the profile
 *   - ACWR Risk Index             → `chronicLoad` seeds the ACWR denominator
 */

import { estimatedMaxHr } from "./intake";
import type { LiftSet, RunLog } from "./types";

/**
 * The sports whose pace the aerobic diagnostic can reason about, expressed in
 * the vocabulary `activities.sport` actually stores — the app-facing
 * `SportType` enum (`running`, `rowing`, `indoor_cycling`, …), NOT the
 * internal six-way benchmark bucket (`run`, `row`, `cycle`, …) used by
 * `cardio-benchmarks.ts`. Those two vocabularies share no member, so
 * filtering rows against the benchmark buckets discarded every activity ever
 * logged and left `diagnose` with nothing to predict from — the cause of the
 * flat 25:00 predicted 5k (`predicted5kS`'s no-maximal-effort placeholder)
 * reported by athletes whose every logged run was far faster than that.
 *
 * Foot-based running only, and deliberately so. `RunLog` carries no sport of
 * its own, and everything built on it — the median-pace maximal-effort
 * outlier rule, the personal Riegel fit, `predicted5kS`, the easy/quality
 * pace cutoffs, volume adequacy — is denominated in running seconds per
 * kilometre. A 20 km ride enters that pool as a 2:00/km "run" and a 400 m
 * swim as a 15:00/km one; either silently wrecks both the median and the
 * projection. Cross-training belongs to the load/ACWR side of the engine,
 * which reads the activity rows directly.
 */
const DIAGNOSABLE_SPORTS = new Set<string>(["running"]);

/** Session types that ARE a maximal effort by definition. */
const MAX_EFFORT_SESSION_TYPES = new Set(["race"]);

/**
 * A logged session that is this much faster than the athlete's own median
 * training pace is a race or time trial whether or not they tagged it as one.
 * [EST] — deliberately conservative: mislabelling a hard tempo as a maximal
 * effort would bias the Riegel fit toward a flatter curve and understate the
 * athlete's fatigue resistance.
 */
const MAX_EFFORT_PACE_OUTLIER_RATIO = 0.93;
/** Below this many runs, the median is too noisy to call anything an outlier against. */
const MAX_EFFORT_OUTLIER_MIN_RUNS = 6;

export interface ActivityRow {
  started_at: string;
  sport: string;
  duration_seconds: number;
  distance_meters: number | null;
  avg_heart_rate: number | null;
  max_heart_rate: number | null;
  avg_cadence: number | null;
  session_type: string | null;
  /** Per-km splits and per-km HR, where the source provided them. */
  metadata?: { splits_s_per_km?: number[]; hr_by_km?: number[] } | null;
  is_partial_track?: boolean | null;
}

export interface GymExerciseRow {
  started_at: string;
  exercise_name: string;
  weight_kg: number;
  sets: number;
  reps: number;
  rpe: number | null;
  set_details?: { weight_kg: number; reps: number; rpe?: number | null }[] | null;
}

function dayIndex(iso: string, epochMs: number): number {
  return Math.floor((new Date(iso).getTime() - epochMs) / 86_400_000);
}

/**
 * Converts logged activities into RunLogs. Partial GPS tracks are excluded:
 * a session where background tracking was interrupted has a distance that is
 * wrong in an unknown direction, and feeding it to a pace-based diagnostic is
 * exactly the "confidently wrong" failure this codebase has already fixed
 * once.
 */
/** The one definition of "a run this diagnostic can read". */
function usableRuns(rows: ActivityRow[]): ActivityRow[] {
  return rows.filter(
    (r) =>
      DIAGNOSABLE_SPORTS.has(r.sport) &&
      !r.is_partial_track &&
      r.duration_seconds > 0 &&
      (r.distance_meters ?? 0) > 0
  );
}

/**
 * When the athlete's first readable run was, in epoch ms — null when there is
 * no such run.
 *
 * Exists so a caller can work out how long the observation window has actually
 * been open (see `DiagnoseOptions.observationWeeks`) without re-deciding which
 * activities count as runs. Every `RunLog.dateIdx` is measured from this
 * instant, so it is the only anchor that lines up with them.
 */
export function firstRunStartedAtMs(rows: ActivityRow[]): number | null {
  const usable = usableRuns(rows);
  if (usable.length === 0) return null;
  return Math.min(...usable.map((r) => new Date(r.started_at).getTime()));
}

export function ingestRuns(rows: ActivityRow[]): RunLog[] {
  const usable = usableRuns(rows);
  if (usable.length === 0) return [];

  const epochMs = Math.min(...usable.map((r) => new Date(r.started_at).getTime()));

  const runs: RunLog[] = usable.map((r) => ({
    dateIdx: dayIndex(r.started_at, epochMs),
    distanceKm: (r.distance_meters as number) / 1000,
    durationS: r.duration_seconds,
    avgHr: r.avg_heart_rate,
    splitsSPerKm: r.metadata?.splits_s_per_km ?? [],
    hrByKm: r.metadata?.hr_by_km ?? [],
    cadenceSpm: r.avg_cadence != null ? Math.round(r.avg_cadence) : null,
    isMaxEffort: r.session_type != null && MAX_EFFORT_SESSION_TYPES.has(r.session_type),
  }));

  return flagPaceOutliers(runs);
}

/**
 * The pace-outlier half of the maximal-effort rule. Compares each run against
 * the median pace of the athlete's UNTAGGED runs — using the median rather
 * than the mean so that one genuinely fast session cannot drag the reference
 * toward itself and hide the next one.
 */
export function flagPaceOutliers(runs: RunLog[]): RunLog[] {
  const untagged = runs.filter((r) => !r.isMaxEffort);
  if (untagged.length < MAX_EFFORT_OUTLIER_MIN_RUNS) return runs;
  const paces = untagged.map((r) => r.durationS / r.distanceKm).sort((a, b) => a - b);
  const median = paces[Math.floor(paces.length / 2)];
  if (!Number.isFinite(median) || median <= 0) return runs;

  return runs.map((r) => {
    if (r.isMaxEffort) return r;
    const pace = r.durationS / r.distanceKm;
    return pace <= median * MAX_EFFORT_PACE_OUTLIER_RATIO ? { ...r, isMaxEffort: true } : r;
  });
}

/** Maps Split Index exercise names onto the three competition lifts the strength diagnostic reasons about. */
const COMPETITION_LIFT_ALIASES: Record<string, string> = {
  "back squat": "squat",
  squat: "squat",
  "barbell squat": "squat",
  "front squat": "squat",
  "bench press": "bench",
  bench: "bench",
  "barbell bench press": "bench",
  deadlift: "deadlift",
  "conventional deadlift": "deadlift",
  "barbell deadlift": "deadlift",
  "sumo deadlift": "deadlift",
};

export function normaliseLiftName(exerciseName: string): string {
  return COMPETITION_LIFT_ALIASES[exerciseName.trim().toLowerCase()] ?? exerciseName.trim().toLowerCase();
}

/**
 * Expands logged exercises into individual sets. `set_details` takes
 * precedence where present — the flat weight/sets/reps columns are a best-set
 * summary, and treating a summary as N identical sets would inflate the
 * rep-profile comparison at both ends.
 */
export function ingestLiftSets(rows: GymExerciseRow[]): LiftSet[] {
  if (rows.length === 0) return [];
  const epochMs = Math.min(...rows.map((r) => new Date(r.started_at).getTime()));
  const out: LiftSet[] = [];

  for (const row of rows) {
    const lift = normaliseLiftName(row.exercise_name);
    const dateIdx = dayIndex(row.started_at, epochMs);

    if (row.set_details && row.set_details.length > 0) {
      for (const set of row.set_details) {
        if (set.weight_kg > 0 && set.reps > 0) {
          out.push({ dateIdx, lift, loadKg: set.weight_kg, reps: set.reps, rir: set.rpe != null ? 10 - set.rpe : null });
        }
      }
      continue;
    }

    if (row.weight_kg > 0 && row.reps > 0) {
      for (let i = 0; i < Math.max(1, row.sets); i++) {
        out.push({ dateIdx, lift, loadKg: row.weight_kg, reps: row.reps, rir: row.rpe != null ? 10 - row.rpe : null });
      }
    }
  }

  return out;
}

/**
 * Resting and max HR, in the order the intake spec requires: measured first,
 * then the highest HR the athlete has actually hit in a logged session, then
 * Tanaka — and the source is returned, never assumed, because every
 * downstream HR band states where it came from.
 */
export function resolveHeartRates(
  profileRestingHr: number | null,
  profileMaxHr: number | null,
  activities: ActivityRow[],
  age: number
): { hrRest: number; hrMax: number; hrMaxSource: "measured" | "estimated"; restingAssumed: boolean } {
  const observedMax = activities
    .map((a) => a.max_heart_rate)
    .filter((h): h is number => h != null && h > 100 && h < 230);
  const measuredMax = profileMaxHr ?? (observedMax.length > 0 ? Math.max(...observedMax) : null);

  return {
    // The intake spec's documented default, flagged as assumed rather than
    // silently applied.
    hrRest: profileRestingHr ?? 60,
    hrMax: measuredMax ?? estimatedMaxHr(age),
    hrMaxSource: measuredMax != null ? "measured" : "estimated",
    restingAssumed: profileRestingHr == null,
  };
}

/**
 * Weekly running minutes from the last 8 weeks of logs — the on-ramp anchor.
 * The intake spec calls this "the most important field in this document"; see
 * `reconcileCurrentVolume` for what happens when the athlete's own answer
 * disagrees with this number.
 */
export function loggedWeeklyRunMinutes(rows: ActivityRow[], weeks = 8, now = Date.now()): number | null {
  const cutoff = now - weeks * 7 * 86_400_000;
  const recent = rows.filter(
    (r) => DIAGNOSABLE_SPORTS.has(r.sport) && new Date(r.started_at).getTime() >= cutoff && r.duration_seconds > 0
  );
  if (recent.length === 0) return null;
  return recent.reduce((s, r) => s + r.duration_seconds, 0) / 60 / weeks;
}

/**
 * Non-running endurance modalities. These cannot inform running pace — the
 * whole point of the `DIAGNOSABLE_SPORTS` note above — but they are
 * unambiguously aerobic training, and an athlete who rows four times a week
 * does not have an aerobic base of zero.
 */
const CROSS_TRAINING_SPORTS = new Set<string>([
  "rowing",
  "bike_erg",
  "indoor_cycling",
  "outdoor_cycling",
  "ski_erg",
  "swimming",
  "walking",
]);

export interface CrossTrainingVolume {
  minPerWeek: number;
  kmPerWeek: number;
  sessionCount: number;
  /** Which modalities contributed, so the report can say where the volume came from. */
  sports: string[];
}

/**
 * Weekly cross-training volume over the same window the diagnostic uses.
 *
 * Split out from `ingestRuns` rather than merged into it because the two feed
 * different things: this feeds VOLUME (and so volume adequacy, the on-ramp and
 * the chronic-load seed), while running alone feeds PACE. Merging them would
 * put a 2:00/km "run" into the pace pool; dropping them entirely reports a
 * rower as having done no aerobic training at all. Both are wrong, in opposite
 * directions.
 */
export function ingestCrossTraining(rows: ActivityRow[], weeks = 12): CrossTrainingVolume {
  const usable = rows.filter(
    (r) => CROSS_TRAINING_SPORTS.has(r.sport) && !r.is_partial_track && r.duration_seconds > 0
  );
  if (usable.length === 0) return { minPerWeek: 0, kmPerWeek: 0, sessionCount: 0, sports: [] };

  // Span the sessions actually cover, capped at the window — a single session
  // three days ago is not "one session per week for twelve weeks", and dividing
  // by the full window would understate it just as badly as dividing by three
  // days would overstate it.
  const times = usable.map((r) => new Date(r.started_at).getTime());
  const spanWeeks = Math.min(weeks, Math.max(1, (Math.max(...times) - Math.min(...times)) / (7 * 86_400_000)));

  return {
    minPerWeek: usable.reduce((s, r) => s + r.duration_seconds, 0) / 60 / spanWeeks,
    kmPerWeek: usable.reduce((s, r) => s + (r.distance_meters ?? 0), 0) / 1000 / spanWeeks,
    sessionCount: usable.length,
    sports: [...new Set(usable.map((r) => r.sport))],
  };
}
