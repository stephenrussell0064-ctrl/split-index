import { z } from "@/lib/validation/boundary";
import type { SportType } from "@/types";

/**
 * What the iOS shell reads out of Apple Health, and what Split Index makes of it.
 *
 * Everything the phone's health store holds was written there by a watch or
 * another app — Apple Watch, Garmin Connect, Whoop, Oura, Coros, Polar, Strava
 * all write workouts and vitals into it. Reading that one store is how Split
 * Index gets every wearable at once without an OAuth partner, a server-side
 * token or a partner agreement (logging-effort plan, phase 1).
 *
 * This module is the pure half: the shape of a batch as the Swift plugin
 * returns it (`HealthImportPlugin.swift`), validated at the API boundary with
 * the same strictness as any other write, and the mapping from Apple's
 * vocabulary to ours. No I/O. The import route owns the writes.
 *
 * Three decisions worth stating once:
 *
 *  - HRV from Apple is SDNN, in milliseconds. Split Index's manual entry is
 *    rMSSD. The two are not interchangeable, so an imported reading carries
 *    `source: "apple_health"` and the recovery baseline is built per source —
 *    see lib/recovery/data.ts. The ratio of today to the athlete's own
 *    baseline is what the score reads, so a consistent source is enough.
 *  - A strength workout from a watch has no sets, reps or loads, and a gym
 *    session without exercises cannot be scored. Those are skipped, not logged
 *    as empty sessions. The gym stays hand-logged on purpose.
 *  - The app's own GPS run starts a HealthKit workout session to switch the
 *    AirPods sensor on. The Swift side already filters workouts by the app's
 *    bundle id; `isOwnWorkout` repeats the check here so the server never
 *    trusts the client on it.
 */

const ISO = z.string().datetime({ offset: true });
const UUID_LIKE = z.string().min(8).max(64);

export const healthWorkoutSchema = z
  .object({
    uuid: UUID_LIKE,
    /** The Swift plugin's own vocabulary, mapped from HKWorkoutActivityType. */
    activityType: z.enum([
      "running",
      "walking",
      "hiking",
      "cycling",
      "swimming",
      "rowing",
      "strength",
      "other",
    ]),
    start: ISO,
    end: ISO,
    durationSeconds: z.number().finite().min(1).max(86_400),
    distanceMeters: z.number().finite().min(0).max(1_000_000).nullish(),
    energyKcal: z.number().finite().min(0).max(50_000).nullish(),
    avgHr: z.number().finite().min(30).max(250).nullish(),
    maxHr: z.number().finite().min(30).max(250).nullish(),
    elevationMeters: z.number().finite().min(0).max(20_000).nullish(),
    isIndoor: z.boolean().nullish(),
    sourceName: z.string().max(120).nullish(),
    sourceBundleId: z.string().max(200).nullish(),
    deviceName: z.string().max(120).nullish(),
  })
  .strict();

export const healthQuantitySampleSchema = z
  .object({
    uuid: UUID_LIKE,
    date: ISO,
    value: z.number().finite(),
    sourceName: z.string().max(120).nullish(),
  })
  .strict();

export const healthSleepSampleSchema = z
  .object({
    uuid: UUID_LIKE,
    start: ISO,
    end: ISO,
    /** HKCategoryValueSleepAnalysis raw value: 0 inBed, 1 asleepUnspecified, 2 awake, 3 core, 4 deep, 5 REM. */
    value: z.number().int().min(0).max(10),
    sourceName: z.string().max(120).nullish(),
  })
  .strict();

/** One sync's worth of samples. Bounded so a first sync of years of history cannot be posted in one request. */
export const healthImportBatchSchema = z
  .object({
    workouts: z.array(healthWorkoutSchema).max(300),
    hrv: z.array(healthQuantitySampleSchema).max(2000),
    restingHr: z.array(healthQuantitySampleSchema).max(2000),
    bodyMass: z.array(healthQuantitySampleSchema).max(2000),
    sleep: z.array(healthSleepSampleSchema).max(4000),
    /** The newest sample date the client saw, so the server can advance the cursor without trusting the clock. */
    newestSampleAt: ISO.nullish(),
  })
  .strict();

export type HealthWorkout = z.infer<typeof healthWorkoutSchema>;
export type HealthQuantitySample = z.infer<typeof healthQuantitySampleSchema>;
export type HealthSleepSample = z.infer<typeof healthSleepSampleSchema>;
export type HealthImportBatch = z.infer<typeof healthImportBatchSchema>;

export const APP_BUNDLE_ID = "co.uk.splitindex.app";

/** The app's own HealthKit workout session (started to power the AirPods sensor) must never come back in as a second copy of the run. */
export function isOwnWorkout(workout: Pick<HealthWorkout, "sourceBundleId">): boolean {
  const id = workout.sourceBundleId?.toLowerCase() ?? "";
  return id === APP_BUNDLE_ID || id.startsWith(`${APP_BUNDLE_ID}.`);
}

/**
 * Apple's workout type to a Split Index sport, or null when there is nothing
 * honest to log it as. Indoor cycling is its own sport here because it is
 * scored off power and HR rather than terrain.
 */
export function sportForWorkout(workout: Pick<HealthWorkout, "activityType" | "isIndoor">): SportType | null {
  switch (workout.activityType) {
    case "running":
      return "running";
    case "walking":
    case "hiking":
      return "walking";
    case "cycling":
      return workout.isIndoor ? "indoor_cycling" : "outdoor_cycling";
    case "swimming":
      return "swimming";
    case "rowing":
      return "rowing";
    default:
      return null;
  }
}

/** The title the logbook shows for an imported session: the sport and where it came from. */
export function importedActivityTitle(sport: SportType, workout: Pick<HealthWorkout, "sourceName" | "deviceName">): string {
  const label: Record<string, string> = {
    running: "Run",
    walking: "Walk",
    outdoor_cycling: "Ride",
    indoor_cycling: "Indoor ride",
    swimming: "Swim",
    rowing: "Row",
  };
  const from = workout.deviceName || workout.sourceName;
  return from ? `${label[sport] ?? "Session"} from ${from}` : (label[sport] ?? "Session");
}

export interface ImportedActivityFields {
  sport: SportType;
  title: string;
  started_at: string;
  duration_seconds: number;
  distance_meters?: number;
  elevation_meters?: number;
  avg_heart_rate?: number;
  max_heart_rate?: number;
  avg_pace_seconds_per_km?: number;
}

/**
 * The activity row a workout becomes, in the shape POST /api/activities
 * validates. Null when the workout is not a sport Split Index scores. Pace is
 * derived here, not read from Apple, so it is exactly distance over time as
 * the scorer would compute it anyway.
 */
export function workoutToActivity(workout: HealthWorkout): ImportedActivityFields | null {
  if (isOwnWorkout(workout)) return null;
  const sport = sportForWorkout(workout);
  if (!sport) return null;
  const duration = Math.round(workout.durationSeconds);
  const distance =
    workout.distanceMeters != null && workout.distanceMeters >= 10
      ? Math.round(workout.distanceMeters)
      : undefined;
  return {
    sport,
    title: importedActivityTitle(sport, workout),
    started_at: workout.start,
    duration_seconds: duration,
    ...(distance != null ? { distance_meters: distance } : {}),
    ...(workout.elevationMeters != null && workout.elevationMeters > 0
      ? { elevation_meters: Math.round(workout.elevationMeters) }
      : {}),
    ...(workout.avgHr != null ? { avg_heart_rate: Math.round(workout.avgHr) } : {}),
    ...(workout.maxHr != null ? { max_heart_rate: Math.round(workout.maxHr) } : {}),
    ...(distance != null && distance > 0
      ? { avg_pace_seconds_per_km: Math.round((duration / distance) * 1000) }
      : {}),
  };
}

/** UTC calendar day of a timestamp — the same bucket the manual HRV route uses. */
export function utcDay(iso: string): string {
  return iso.slice(0, 10);
}

/** Start of that UTC day as an ISO timestamp, for the recovery_snapshots row it belongs to. */
export function utcDayStart(day: string): string {
  return `${day}T00:00:00.000Z`;
}

/**
 * One value per UTC day from a run of samples. Apple Watch records HRV
 * several times a night; the day's figure is their mean, which is also what
 * the Health app shows. Resting HR and bodyweight arrive once a day and the
 * mean of one is itself.
 */
export function dailyMean(samples: HealthQuantitySample[]): Map<string, { value: number; uuids: string[]; latestAt: string }> {
  const byDay = new Map<string, { sum: number; n: number; uuids: string[]; latestAt: string }>();
  for (const s of samples) {
    const day = utcDay(s.date);
    const bucket = byDay.get(day) ?? { sum: 0, n: 0, uuids: [], latestAt: s.date };
    bucket.sum += s.value;
    bucket.n += 1;
    bucket.uuids.push(s.uuid);
    if (s.date > bucket.latestAt) bucket.latestAt = s.date;
    byDay.set(day, bucket);
  }
  return new Map(
    [...byDay.entries()].map(([day, b]) => [day, { value: b.sum / b.n, uuids: b.uuids, latestAt: b.latestAt }])
  );
}

/** HKCategoryValueSleepAnalysis values that mean asleep: unspecified (1), core (3), deep (4), REM (5). In bed (0) and awake (2) are not sleep. */
const ASLEEP_VALUES = new Set([1, 3, 4, 5]);

/**
 * Hours asleep per night. A night is keyed by the UTC day the sleep ENDED
 * on, so Monday night's sleep is Tuesday's recovery input, which is the day
 * it matters to. Overlapping samples from two sources (a watch and a phone
 * both tracking) would double-count; the longest-sleeping source per night
 * wins rather than the sum.
 */
export function nightlySleepHours(samples: HealthSleepSample[]): Map<string, { hours: number; uuids: string[] }> {
  const perNightPerSource = new Map<string, Map<string, { seconds: number; uuids: string[] }>>();
  for (const s of samples) {
    if (!ASLEEP_VALUES.has(s.value)) continue;
    const seconds = (Date.parse(s.end) - Date.parse(s.start)) / 1000;
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 86_400) continue;
    const night = utcDay(s.end);
    const source = s.sourceName ?? "";
    const bySource = perNightPerSource.get(night) ?? new Map();
    const bucket = bySource.get(source) ?? { seconds: 0, uuids: [] };
    bucket.seconds += seconds;
    bucket.uuids.push(s.uuid);
    bySource.set(source, bucket);
    perNightPerSource.set(night, bySource);
  }
  const out = new Map<string, { hours: number; uuids: string[] }>();
  for (const [night, bySource] of perNightPerSource) {
    let best: { seconds: number; uuids: string[] } | null = null;
    for (const bucket of bySource.values()) {
      if (!best || bucket.seconds > best.seconds) best = bucket;
    }
    if (best) out.set(night, { hours: Math.round((best.seconds / 3600) * 10) / 10, uuids: best.uuids });
  }
  return out;
}

/** Apple reports bodyweight in kilograms; anything outside the app's own bound is a scale glitch, not a person. */
export const BODYWEIGHT_BOUND_KG: readonly [number, number] = [25, 300];
export const HRV_BOUND_MS: readonly [number, number] = [1, 500];
export const RESTING_HR_BOUND: readonly [number, number] = [25, 120];

export function withinBound(value: number, bound: readonly [number, number]): boolean {
  return Number.isFinite(value) && value >= bound[0] && value <= bound[1];
}
