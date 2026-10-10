import { describe, expect, it } from "vitest";
import {
  APP_BUNDLE_ID,
  dailyMean,
  healthImportBatchSchema,
  isOwnWorkout,
  nightlySleepHours,
  sportForWorkout,
  workoutToActivity,
  type HealthWorkout,
} from "./samples";

function workout(seed: Partial<HealthWorkout> = {}): HealthWorkout {
  return {
    uuid: "A1B2C3D4-0000-4000-8000-000000000001",
    activityType: "running",
    start: "2026-10-09T07:00:00.000Z",
    end: "2026-10-09T07:40:00.000Z",
    durationSeconds: 2400,
    distanceMeters: 8000,
    avgHr: 152,
    maxHr: 171,
    elevationMeters: 55,
    sourceName: "Apple Watch",
    sourceBundleId: "com.apple.health",
    deviceName: "Apple Watch",
    ...seed,
  };
}

describe("workoutToActivity", () => {
  it("turns a watch run into the fields the activities route scores", () => {
    expect(workoutToActivity(workout())).toEqual({
      sport: "running",
      title: "Run from Apple Watch",
      started_at: "2026-10-09T07:00:00.000Z",
      duration_seconds: 2400,
      distance_meters: 8000,
      elevation_meters: 55,
      avg_heart_rate: 152,
      max_heart_rate: 171,
      // 2400 s over 8 km = 5:00/km
      avg_pace_seconds_per_km: 300,
    });
  });

  it("never re-imports the app's own HealthKit workout session", () => {
    // The GPS run starts an HKWorkoutSession to power the AirPods sensor.
    expect(workoutToActivity(workout({ sourceBundleId: APP_BUNDLE_ID }))).toBeNull();
    expect(isOwnWorkout({ sourceBundleId: `${APP_BUNDLE_ID}.watchkitapp` })).toBe(true);
    expect(isOwnWorkout({ sourceBundleId: "com.garmin.connect.mobile" })).toBe(false);
  });

  it("skips a strength workout rather than logging an empty gym session", () => {
    expect(workoutToActivity(workout({ activityType: "strength" }))).toBeNull();
    expect(workoutToActivity(workout({ activityType: "other" }))).toBeNull();
  });

  it("leaves distance and pace out when the watch recorded none", () => {
    const fields = workoutToActivity(workout({ distanceMeters: null, elevationMeters: null }))!;
    expect(fields).not.toHaveProperty("distance_meters");
    expect(fields).not.toHaveProperty("avg_pace_seconds_per_km");
    expect(fields).not.toHaveProperty("elevation_meters");
  });

  it("names the sport from the device when there is one, else the source", () => {
    expect(workoutToActivity(workout({ deviceName: null, sourceName: "Garmin Connect" }))!.title).toBe(
      "Run from Garmin Connect"
    );
    expect(workoutToActivity(workout({ deviceName: null, sourceName: null }))!.title).toBe("Run");
  });
});

describe("sportForWorkout", () => {
  it("splits cycling on the indoor flag", () => {
    expect(sportForWorkout({ activityType: "cycling", isIndoor: true })).toBe("indoor_cycling");
    expect(sportForWorkout({ activityType: "cycling", isIndoor: false })).toBe("outdoor_cycling");
    expect(sportForWorkout({ activityType: "cycling" })).toBe("outdoor_cycling");
  });

  it("folds hiking into walking", () => {
    expect(sportForWorkout({ activityType: "hiking" })).toBe("walking");
  });
});

describe("dailyMean", () => {
  it("averages the several readings a watch takes in one night into one figure per day", () => {
    const out = dailyMean([
      { uuid: "a", date: "2026-10-09T02:10:00.000Z", value: 40 },
      { uuid: "b", date: "2026-10-09T04:30:00.000Z", value: 60 },
      { uuid: "c", date: "2026-10-10T03:00:00.000Z", value: 55 },
    ]);
    expect(out.get("2026-10-09")).toEqual({ value: 50, uuids: ["a", "b"], latestAt: "2026-10-09T04:30:00.000Z" });
    expect(out.get("2026-10-10")?.value).toBe(55);
  });
});

describe("nightlySleepHours", () => {
  it("sums the asleep stages and keys the night by the morning it ended on", () => {
    const out = nightlySleepHours([
      { uuid: "inbed", start: "2026-10-08T22:30:00.000Z", end: "2026-10-09T06:30:00.000Z", value: 0 },
      { uuid: "core", start: "2026-10-08T23:00:00.000Z", end: "2026-10-09T03:00:00.000Z", value: 3 },
      { uuid: "deep", start: "2026-10-09T03:00:00.000Z", end: "2026-10-09T04:00:00.000Z", value: 4 },
      { uuid: "awake", start: "2026-10-09T04:00:00.000Z", end: "2026-10-09T04:15:00.000Z", value: 2 },
      { uuid: "rem", start: "2026-10-09T04:15:00.000Z", end: "2026-10-09T06:15:00.000Z", value: 5 },
    ]);
    // 4 + 1 + 2 hours asleep; in-bed and awake do not count.
    expect(out.get("2026-10-09")).toEqual({ hours: 7, uuids: ["core", "deep", "rem"] });
  });

  it("takes the longest-sleeping source per night instead of adding two trackers together", () => {
    const out = nightlySleepHours([
      { uuid: "w1", start: "2026-10-08T23:00:00.000Z", end: "2026-10-09T06:00:00.000Z", value: 1, sourceName: "Watch" },
      { uuid: "p1", start: "2026-10-08T23:30:00.000Z", end: "2026-10-09T05:30:00.000Z", value: 1, sourceName: "Phone" },
    ]);
    expect(out.get("2026-10-09")).toEqual({ hours: 7, uuids: ["w1"] });
  });
});

describe("healthImportBatchSchema", () => {
  const batch = {
    workouts: [workout()],
    hrv: [{ uuid: "A1B2C3D4-0000-4000-8000-0000000000H1", date: "2026-10-09T03:00:00.000Z", value: 48.2 }],
    restingHr: [],
    bodyMass: [{ uuid: "A1B2C3D4-0000-4000-8000-0000000000M1", date: "2026-10-09T07:00:00.000Z", value: 78.4 }],
    sleep: [],
    newestSampleAt: "2026-10-09T07:40:00.000Z",
  };

  it("takes a batch as the plugin returns it", () => {
    expect(healthImportBatchSchema.safeParse(batch).success).toBe(true);
  });

  it("refuses a key nobody validated", () => {
    expect(healthImportBatchSchema.safeParse({ ...batch, userId: "x" }).success).toBe(false);
    expect(
      healthImportBatchSchema.safeParse({ ...batch, workouts: [{ ...workout(), steps: 1 }] }).success
    ).toBe(false);
  });

  it("refuses a workout with an impossible duration", () => {
    expect(
      healthImportBatchSchema.safeParse({ ...batch, workouts: [workout({ durationSeconds: 0 })] }).success
    ).toBe(false);
  });
});
