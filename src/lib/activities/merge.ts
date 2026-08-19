import { ROUTE_CONFIG, parseRoutePolyline, type RoutePoint } from "@/lib/scoring/gps-track";
import { ENDURANCE_SPORTS } from "@/lib/constants/sports";
import { MERGE_MAX_GAP_SECONDS } from "@/lib/activities/merge-eligibility";
import type { SportType } from "@/types";

/**
 * Rejoining a session that was accidentally logged as two.
 *
 * The case this exists for, in the athlete's words: "if you accidentally
 * stopped a run and had to restart it from your phone, you could merge it with
 * the first one you logged." The result has to behave as ONE continuous
 * session — not as two sessions that happen to be displayed together — because
 * everything downstream (the Split Index, ACWR load, race predictions,
 * personal records) reads sessions, not display groupings.
 *
 * Three things are load-bearing here, and each is a way this can be got wrong:
 *
 *  1. PACE IS DERIVED FROM THE TOTALS, NEVER AVERAGED BETWEEN THE HALVES.
 *     Averaging two paces is only correct when the halves are the same length.
 *     A 2 km warm-up jog at 6:00/km followed by 8 km at 4:00/km averages to
 *     5:00/km on the naive arithmetic and 4:24/km on the real one — a 36
 *     s/km error, which for a 10 k is the difference between a good day and a
 *     personal best. Every rate on the merged session (pace, 500 m split) is
 *     recomputed from summed distance over summed duration.
 *
 *  2. THE GAP IS NOT TRAINING TIME. The athlete was standing still swearing at
 *     their phone. Elapsed wall-clock time from the first leg's start to the
 *     last leg's end would inflate duration by exactly that gap, and duration
 *     drives load, which drives ACWR and injury risk. Duration is the sum of
 *     the legs' own durations; the gap is recorded in metadata and surfaced in
 *     the UI, never added.
 *
 *  3. AVERAGES OF INTENSITY ARE DURATION-WEIGHTED. Heart rate, power and
 *     cadence are per-leg means; recombining them means weighting by the time
 *     each mean covers. A flat average would let a 90-second restart fragment
 *     drag a 50-minute run's heart rate around.
 *
 * This module is deliberately pure — no Supabase, no scoring — so the
 * arithmetic can be tested directly, and so the API route and the confirmation
 * UI are computing the same merged session rather than two similar ones.
 */

/**
 * How far apart two legs may be and still plausibly be one interrupted
 * session.
 *
 * The honest answer is that there is no bright line, so this is a judgement
 * call stated in one place rather than a truth: a phone fumble is seconds, a
 * lost-signal restart is a minute or two, and a genuinely interrupted long
 * ride (mechanical, a café stop where the athlete forgot to restart) can run
 * to the better part of an hour. Two hours is comfortably past all of those
 * and comfortably short of "a morning run and an evening run", which is the
 * merge that must never be offered because it would fabricate a session the
 * athlete never did.
 *
 * Above this the merge is refused rather than warned about: the failure mode
 * of allowing it (two real sessions collapsed into one fictitious one, with
 * the second one's date erased) is not something a confirmation dialog can
 * undo the damage of at the point the athlete has already clicked through it.
 *
 * The number itself lives in merge-eligibility.ts, which the logbook imports
 * to decide which rows it may even offer, so the client-side hint and this
 * server-side gate cannot drift apart.
 */
export { MERGE_MAX_GAP_SECONDS };

/**
 * A gap longer than this is real enough to say out loud before merging. Below
 * it, "you stopped your watch for 40 seconds" is not worth a warning.
 */
export const MERGE_GAP_WARN_SECONDS = 10 * 60;

/** Sanity ceiling. A run split into more than this many pieces is a different problem. */
export const MERGE_MAX_SOURCES = 8;

/** The activity columns a merge reads, writes, and can restore from. */
export interface MergeSourceActivity {
  id: string;
  sport: string;
  title?: string | null;
  started_at: string;
  duration_seconds: number;
  distance_meters?: number | null;
  elevation_meters?: number | null;
  avg_heart_rate?: number | null;
  max_heart_rate?: number | null;
  avg_power_watts?: number | null;
  avg_cadence?: number | null;
  avg_pace_seconds_per_km?: number | null;
  avg_split_seconds?: number | null;
  stroke_type?: string | null;
  temperature_celsius?: number | null;
  session_type?: string | null;
  interval_reps?: number | null;
  interval_work_distance_meters?: number | null;
  interval_work_seconds?: number | null;
  interval_rest_seconds?: number | null;
  interval_work_avg_hr?: number | null;
  fartlek_on_distance_meters?: number | null;
  fartlek_on_seconds?: number | null;
  fartlek_on_avg_hr?: number | null;
  rpe?: number | null;
  notes?: string | null;
  source?: string | null;
  is_partial_track?: boolean | null;
  metadata?: Record<string, unknown> | null;
}

/** The merged session's own column values — everything a merge decides. */
export interface MergedActivityFields {
  sport: string;
  title: string | null;
  started_at: string;
  duration_seconds: number;
  distance_meters: number | null;
  elevation_meters: number | null;
  avg_heart_rate: number | null;
  max_heart_rate: number | null;
  avg_power_watts: number | null;
  avg_cadence: number | null;
  avg_pace_seconds_per_km: number | null;
  avg_split_seconds: number | null;
  stroke_type: string | null;
  temperature_celsius: number | null;
  session_type: string | null;
  interval_reps: null;
  interval_work_distance_meters: null;
  interval_work_seconds: null;
  interval_rest_seconds: null;
  interval_work_avg_hr: null;
  fartlek_on_distance_meters: null;
  fartlek_on_seconds: null;
  fartlek_on_avg_hr: null;
  rpe: number | null;
  notes: string | null;
  source: string;
  is_partial_track: boolean;
  route: RoutePoint[] | null;
}

export interface MergeLegSummary {
  id: string;
  startedAt: string;
  durationSeconds: number;
  distanceMeters: number | null;
  /** Seconds of dead time between the previous leg's end and this leg's start. 0 for the first leg. */
  gapBeforeSeconds: number;
}

export interface MergePlan {
  /** The leg whose row survives the merge and becomes the combined session. Always the earliest. */
  survivorId: string;
  /** Legs that are folded into the survivor and then deleted. */
  absorbedIds: string[];
  legs: MergeLegSummary[];
  merged: MergedActivityFields;
  /** Dead time between legs, in seconds. Explicitly excluded from duration. */
  totalGapSeconds: number;
  /** Things the athlete should be told before this happens. Never fatal. */
  warnings: string[];
}

export type MergeAssessment =
  | { ok: true; plan: MergePlan }
  | { ok: false; reason: string };

const ENDURANCE = new Set<string>(ENDURANCE_SPORTS);
/** Rowing and ski-erg express speed as a 500 m split rather than a per-km pace. */
const SPLIT_SPORTS = new Set(["rowing", "ski_erg"]);

function startMs(a: MergeSourceActivity): number {
  return new Date(a.started_at).getTime();
}

function endMs(a: MergeSourceActivity): number {
  return startMs(a) + a.duration_seconds * 1000;
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Duration-weighted mean of a per-leg average, over the legs that actually
 * recorded it. Legs missing the value contribute neither a number nor weight,
 * so a run whose second half has heart rate and whose first half does not
 * reports the second half's heart rate rather than a value diluted toward zero.
 */
function weightedMean(
  legs: MergeSourceActivity[],
  pick: (leg: MergeSourceActivity) => number | null | undefined
): number | null {
  let weighted = 0;
  let weight = 0;
  for (const leg of legs) {
    const value = pick(leg);
    if (value == null || !Number.isFinite(value)) continue;
    const w = Math.max(0, leg.duration_seconds);
    if (w === 0) continue;
    weighted += value * w;
    weight += w;
  }
  return weight > 0 ? weighted / weight : null;
}

function sumOrNull(
  legs: MergeSourceActivity[],
  pick: (leg: MergeSourceActivity) => number | null | undefined
): number | null {
  let total = 0;
  let seen = false;
  for (const leg of legs) {
    const value = pick(leg);
    if (value == null || !Number.isFinite(value)) continue;
    seen = true;
    total += value;
  }
  return seen ? total : null;
}

function hasStructuredEffort(leg: MergeSourceActivity): boolean {
  return (
    leg.interval_reps != null ||
    leg.interval_work_distance_meters != null ||
    leg.interval_work_seconds != null ||
    leg.interval_rest_seconds != null ||
    leg.interval_work_avg_hr != null ||
    leg.fartlek_on_distance_meters != null ||
    leg.fartlek_on_seconds != null ||
    leg.fartlek_on_avg_hr != null
  );
}

/**
 * The legs' routes, end to end, in the order they were run.
 *
 * Each leg's stored polyline has already had its own privacy zone removed at
 * write time (see sanitizeRoute in the create route), so the join is at least
 * as private as the parts: the seam between two legs is 200 m short of one
 * leg's end and 200 m past the next one's start, and the combined line still
 * neither starts nor ends at the athlete's door.
 *
 * Over the stored-point ceiling the combined line is thinned evenly rather
 * than truncated — truncating would draw a run that stops halfway, which is
 * precisely the picture this feature exists to stop showing.
 */
export function concatenateRoutes(legs: MergeSourceActivity[]): RoutePoint[] | null {
  const points: RoutePoint[] = [];
  for (const leg of legs) {
    const parsed = parseRoutePolyline((leg.metadata as { route?: unknown } | null)?.route);
    if (parsed) points.push(...parsed);
  }
  if (points.length < 2) return null;
  if (points.length <= ROUTE_CONFIG.MAX_POINTS) return points;

  const step = (points.length - 1) / (ROUTE_CONFIG.MAX_POINTS - 1);
  const thinned: RoutePoint[] = [];
  for (let i = 0; i < ROUTE_CONFIG.MAX_POINTS; i++) {
    thinned.push(points[Math.round(i * step)]);
  }
  return thinned;
}

/**
 * Whether these sessions can be rejoined, and what the result would be.
 *
 * Returns a reason rather than throwing, because both callers — the API route
 * and the confirmation dialog — want to show the athlete why a selection was
 * refused, not crash on it.
 */
export function assessMerge(sources: MergeSourceActivity[]): MergeAssessment {
  if (sources.length < 2) {
    return { ok: false, reason: "Select at least two sessions to merge." };
  }
  if (sources.length > MERGE_MAX_SOURCES) {
    return {
      ok: false,
      reason: `Merging is limited to ${MERGE_MAX_SOURCES} sessions at a time.`,
    };
  }

  const ids = new Set(sources.map((s) => s.id));
  if (ids.size !== sources.length) {
    return { ok: false, reason: "The same session was selected twice." };
  }

  const sport = sources[0].sport;
  if (!sources.every((s) => s.sport === sport)) {
    return {
      ok: false,
      // The multisport case (a duathlon's ride plus its run) is a genuinely
      // different object — see MULTISPORT in the notes at the bottom of this
      // file — and summing a swim's distance into a bike's would produce a
      // number that means nothing.
      reason:
        "These are different sports. Merging currently rejoins one session that was recorded in pieces, so every part has to be the same sport.",
    };
  }

  if (!ENDURANCE.has(sport)) {
    return {
      ok: false,
      reason:
        "Only cardio sessions can be merged. A gym session is a list of exercises, not a continuous effort, so combining two of them is an edit rather than a rejoin.",
    };
  }

  const legs = [...sources].sort((a, b) => startMs(a) - startMs(b));

  for (const leg of legs) {
    if (!Number.isFinite(startMs(leg))) {
      return { ok: false, reason: "One of these sessions has no valid start time." };
    }
    if (!(leg.duration_seconds > 0)) {
      return { ok: false, reason: "One of these sessions has no duration." };
    }
  }

  const gaps: number[] = [0];
  for (let i = 1; i < legs.length; i++) {
    const gapMs = startMs(legs[i]) - endMs(legs[i - 1]);
    if (gapMs < 0) {
      // Two recordings covering the same wall-clock minutes are far more
      // likely to be the same effort logged twice (a watch and a phone, or a
      // double sync) than one effort in two pieces. Summing them would count
      // the same kilometres twice, in the logbook and in the training load.
      return {
        ok: false,
        reason:
          "These sessions overlap in time, so they look like the same effort recorded twice rather than one session in two parts. Delete the duplicate instead of merging.",
      };
    }
    const gapSeconds = Math.round(gapMs / 1000);
    if (gapSeconds > MERGE_MAX_GAP_SECONDS) {
      return {
        ok: false,
        reason: `These sessions are ${formatGap(gapSeconds)} apart. That is too far apart to be one session that was accidentally stopped and restarted.`,
      };
    }
    gaps.push(gapSeconds);
  }

  const totalGapSeconds = gaps.reduce((sum, g) => sum + g, 0);
  const warnings: string[] = [];

  if (totalGapSeconds >= MERGE_GAP_WARN_SECONDS) {
    warnings.push(
      `${formatGap(totalGapSeconds)} of clock time sits between these sessions. It will not be counted as training time — the merged session's duration is the two recordings added together.`
    );
  }
  if (legs.some(hasStructuredEffort)) {
    warnings.push(
      "Interval and fartlek details will not carry over — rep counts and work/rest splits from separate recordings cannot be added together meaningfully. Re-enter them on the merged session if you need them."
    );
  }
  if (legs.some((leg) => leg.notes && leg.notes.trim().length > 0)) {
    warnings.push("Notes from each session will be kept together on the merged session.");
  }

  const durationSeconds = legs.reduce((sum, leg) => sum + leg.duration_seconds, 0);
  const distanceMeters = sumOrNull(legs, (leg) => leg.distance_meters);
  const elevationMeters = sumOrNull(legs, (leg) => leg.elevation_meters);

  // Rates, recomputed from the totals. This is point 1 in this file's header
  // and the single thing most likely to be got wrong by averaging.
  const paceSecondsPerKm =
    distanceMeters && distanceMeters > 0 ? durationSeconds / (distanceMeters / 1000) : null;
  const splitSeconds =
    distanceMeters && distanceMeters > 0 ? durationSeconds / (distanceMeters / 500) : null;

  const avgHr = weightedMean(legs, (leg) => leg.avg_heart_rate);
  const avgPower = weightedMean(legs, (leg) => leg.avg_power_watts);
  const avgCadence = weightedMean(legs, (leg) => leg.avg_cadence);
  const avgTemperature = weightedMean(legs, (leg) => leg.temperature_celsius);
  const avgRpe = weightedMean(legs, (leg) => leg.rpe);
  const maxHr = legs.reduce<number | null>(
    (max, leg) =>
      leg.max_heart_rate == null ? max : max == null ? leg.max_heart_rate : Math.max(max, leg.max_heart_rate),
    null
  );

  // The session's character comes from the leg that dominates it: a 55-minute
  // long run interrupted by a 90-second restart is a long run, whatever the
  // fragment was tagged as.
  const longestLeg = legs.reduce((longest, leg) =>
    leg.duration_seconds > longest.duration_seconds ? leg : longest
  );
  const sessionType =
    longestLeg.session_type ?? legs.find((leg) => leg.session_type)?.session_type ?? null;

  const strokeTypes = new Set(
    legs.map((leg) => leg.stroke_type).filter((s): s is string => !!s)
  );

  const notes = legs
    .map((leg) => leg.notes?.trim())
    .filter((n): n is string => !!n)
    .join("\n\n");

  const sources_ = new Set(legs.map((leg) => leg.source ?? "manual"));

  const merged: MergedActivityFields = {
    sport,
    title: legs.find((leg) => leg.title?.trim())?.title?.trim() ?? null,
    started_at: legs[0].started_at,
    duration_seconds: durationSeconds,
    distance_meters: distanceMeters == null ? null : round(distanceMeters, 1),
    elevation_meters: elevationMeters == null ? null : round(elevationMeters, 1),
    avg_heart_rate: avgHr == null ? null : Math.round(avgHr),
    max_heart_rate: maxHr,
    avg_power_watts: avgPower == null ? null : round(avgPower, 1),
    avg_cadence: avgCadence == null ? null : round(avgCadence, 1),
    // Only the sport that reads in this unit carries it, matching how the log
    // form and the activity detail page already split pace from split.
    avg_pace_seconds_per_km:
      paceSecondsPerKm == null || SPLIT_SPORTS.has(sport) ? null : round(paceSecondsPerKm, 2),
    avg_split_seconds:
      splitSeconds == null || !SPLIT_SPORTS.has(sport) ? null : round(splitSeconds, 2),
    stroke_type: strokeTypes.size === 1 ? [...strokeTypes][0] : null,
    temperature_celsius: avgTemperature == null ? null : round(avgTemperature, 1),
    session_type: sessionType,
    interval_reps: null,
    interval_work_distance_meters: null,
    interval_work_seconds: null,
    interval_rest_seconds: null,
    interval_work_avg_hr: null,
    fartlek_on_distance_meters: null,
    fartlek_on_seconds: null,
    fartlek_on_avg_hr: null,
    rpe: avgRpe == null ? null : Math.min(10, Math.max(1, round(avgRpe, 1))),
    notes: notes.length > 0 ? notes : null,
    // A stitched GPS run is still a GPS run; a mix of a tracked leg and a
    // typed-in one is not, so it falls back to manual rather than claiming a
    // track it only half has.
    source: sources_.size === 1 ? [...sources_][0] : "manual",
    // Carried, not inferred: merging repairs a split recording, it does not
    // make an already-partial track complete. HPE's load intake reads this
    // flag to decide what counts as clean evidence.
    is_partial_track: legs.some((leg) => leg.is_partial_track === true),
    route: concatenateRoutes(legs),
  };

  return {
    ok: true,
    plan: {
      survivorId: legs[0].id,
      absorbedIds: legs.slice(1).map((leg) => leg.id),
      legs: legs.map((leg, i) => ({
        id: leg.id,
        startedAt: leg.started_at,
        durationSeconds: leg.duration_seconds,
        distanceMeters: leg.distance_meters ?? null,
        gapBeforeSeconds: gaps[i],
      })),
      merged,
      totalGapSeconds,
      warnings,
    },
  };
}

function formatGap(seconds: number): string {
  if (seconds < 90) return `${seconds} second${seconds === 1 ? "" : "s"}`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round((seconds / 3600) * 10) / 10;
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}

/** Current shape version of the undo snapshot stored on a merged activity. */
export const MERGE_METADATA_VERSION = 1;

export interface MergeRecord {
  version: number;
  mergedAt: string;
  totalGapSeconds: number;
  /**
   * Every leg exactly as it was before the merge, INCLUDING the surviving
   * one — this is the whole undo. `wasSurvivor` marks the row that was
   * updated in place rather than deleted, so unmerge knows which id to
   * restore and which ids to re-insert.
   */
  sources: Array<MergeSourceActivity & { wasSurvivor: boolean }>;
}

/** Reads the undo snapshot off an activity's metadata, or null if it was never merged. */
export function readMergeRecord(
  metadata: Record<string, unknown> | null | undefined
): MergeRecord | null {
  const record = metadata?.merge as MergeRecord | undefined;
  if (!record || typeof record !== "object") return null;
  if (!Array.isArray(record.sources) || record.sources.length < 2) return null;
  if (!record.sources.some((s) => s.wasSurvivor)) return null;
  return record;
}

/** The columns a merge snapshot keeps, so a restore writes back exactly what was there. */
export const MERGE_SNAPSHOT_COLUMNS = [
  "id",
  "sport",
  "title",
  "started_at",
  "duration_seconds",
  "distance_meters",
  "elevation_meters",
  "avg_heart_rate",
  "max_heart_rate",
  "avg_power_watts",
  "avg_cadence",
  "avg_pace_seconds_per_km",
  "avg_split_seconds",
  "stroke_type",
  "temperature_celsius",
  "session_type",
  "interval_reps",
  "interval_work_distance_meters",
  "interval_work_seconds",
  "interval_rest_seconds",
  "interval_work_avg_hr",
  "fartlek_on_distance_meters",
  "fartlek_on_seconds",
  "fartlek_on_avg_hr",
  "rpe",
  "notes",
  "source",
  "is_partial_track",
  "metadata",
] as const;

/** Narrows a full activity row down to the columns a merge snapshot restores. */
export function snapshotOf(row: Record<string, unknown>): MergeSourceActivity {
  const snapshot: Record<string, unknown> = {};
  for (const column of MERGE_SNAPSHOT_COLUMNS) {
    snapshot[column] = row[column] ?? null;
  }
  return snapshot as unknown as MergeSourceActivity;
}

/**
 * The merged session as an activity-shaped body, ready for the same scoring
 * path a create or an edit uses. Undefined rather than null for absent
 * optional fields, because ActivityFormData is optional-keyed.
 */
export function mergedActivityBody(merged: MergedActivityFields): {
  sport: SportType;
  title?: string;
  started_at: string;
  duration_seconds: number;
  distance_meters?: number;
  elevation_meters?: number;
  avg_heart_rate?: number;
  max_heart_rate?: number;
  avg_power_watts?: number;
  avg_cadence?: number;
  avg_pace_seconds_per_km?: number;
  avg_split_seconds?: number;
  stroke_type?: string;
  temperature_celsius?: number;
  session_type?: import("@/types").SessionType;
  rpe?: number;
  notes?: string;
} {
  const optional = <T>(value: T | null): T | undefined => (value == null ? undefined : value);
  return {
    sport: merged.sport as SportType,
    title: optional(merged.title),
    started_at: merged.started_at,
    duration_seconds: merged.duration_seconds,
    distance_meters: optional(merged.distance_meters),
    elevation_meters: optional(merged.elevation_meters),
    avg_heart_rate: optional(merged.avg_heart_rate),
    max_heart_rate: optional(merged.max_heart_rate),
    avg_power_watts: optional(merged.avg_power_watts),
    avg_cadence: optional(merged.avg_cadence),
    avg_pace_seconds_per_km: optional(merged.avg_pace_seconds_per_km),
    avg_split_seconds: optional(merged.avg_split_seconds),
    stroke_type: optional(merged.stroke_type),
    temperature_celsius: optional(merged.temperature_celsius),
    session_type: optional(merged.session_type) as import("@/types").SessionType | undefined,
    rpe: optional(merged.rpe),
    notes: optional(merged.notes),
  };
}

/*
 * MULTISPORT (duathlon / triathlon / Ironman) — deliberately NOT handled here.
 *
 * A triathlon is not a sum. Its swim, bike and run are scored by three
 * different models against three different benchmark curves, and adding
 * 1.9 km of swimming to 90 km of cycling produces a number with no unit and no
 * meaning. Forcing the whole thing through one sport's scorer is worse: a
 * 4:30 Ironman run leg, scored as if the preceding 180 km had not happened,
 * reads as a bad run.
 *
 * The shape it wants is a parent activity that OWNS its legs, each leg keeping
 * its own sport, distance, duration and score, with the parent carrying only
 * the combined elapsed time (including transitions, which for multisport ARE
 * part of the result — the opposite of the gap rule above). That needs a
 * schema change this module cannot express, and a scoring decision the Split
 * Index does not currently have a place for. See the handover notes that ship
 * with this change.
 */
