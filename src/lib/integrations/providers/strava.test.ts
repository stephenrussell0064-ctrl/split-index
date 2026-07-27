import { describe, expect, it } from "vitest";
import {
  STRAVA_TYPE_TO_SPORT,
  stravaWorkoutTypeToSessionType,
  mapStravaActivity,
} from "./index";

describe("STRAVA_TYPE_TO_SPORT", () => {
  it("maps the common activity types to a real SportType", () => {
    expect(STRAVA_TYPE_TO_SPORT.Run).toBe("running");
    expect(STRAVA_TYPE_TO_SPORT.TrailRun).toBe("running");
    expect(STRAVA_TYPE_TO_SPORT.Walk).toBe("walking");
    expect(STRAVA_TYPE_TO_SPORT.Swim).toBe("swimming");
    expect(STRAVA_TYPE_TO_SPORT.Rowing).toBe("rowing");
    expect(STRAVA_TYPE_TO_SPORT.Ride).toBe("outdoor_cycling");
    expect(STRAVA_TYPE_TO_SPORT.WeightTraining).toBe("gym");
  });

  it("keeps VirtualRide on indoor_cycling (simulated/stationary) while genuinely outdoor ride types map to outdoor_cycling", () => {
    expect(STRAVA_TYPE_TO_SPORT.VirtualRide).toBe("indoor_cycling");
    expect(STRAVA_TYPE_TO_SPORT.GravelRide).toBe("outdoor_cycling");
    expect(STRAVA_TYPE_TO_SPORT.MountainBikeRide).toBe("outdoor_cycling");
    expect(STRAVA_TYPE_TO_SPORT.EBikeRide).toBe("outdoor_cycling");
  });

  it("leaves genuinely unsupported Strava types unmapped rather than guessing", () => {
    expect(STRAVA_TYPE_TO_SPORT.Yoga).toBeUndefined();
    expect(STRAVA_TYPE_TO_SPORT.AlpineSki).toBeUndefined();
    expect(STRAVA_TYPE_TO_SPORT.Surfing).toBeUndefined();
  });
});

describe("stravaWorkoutTypeToSessionType", () => {
  it("maps run and ride race/long-run/workout codes to the matching SessionType", () => {
    expect(stravaWorkoutTypeToSessionType(1)).toBe("race");
    expect(stravaWorkoutTypeToSessionType(11)).toBe("race");
    expect(stravaWorkoutTypeToSessionType(2)).toBe("long");
    expect(stravaWorkoutTypeToSessionType(13)).toBe("long");
    expect(stravaWorkoutTypeToSessionType(3)).toBe("interval");
    expect(stravaWorkoutTypeToSessionType(12)).toBe("interval");
  });

  it("returns undefined for the default/unset workout type rather than guessing a SessionType", () => {
    expect(stravaWorkoutTypeToSessionType(0)).toBeUndefined();
    expect(stravaWorkoutTypeToSessionType(null)).toBeUndefined();
    expect(stravaWorkoutTypeToSessionType(undefined)).toBeUndefined();
  });
});

describe("mapStravaActivity", () => {
  const base = {
    id: 123456789,
    name: "Morning Run",
    type: "Run",
    start_date: "2026-07-20T06:30:00Z",
    elapsed_time: 1900,
    moving_time: 1800,
    distance: 5000,
    total_elevation_gain: 42,
    average_heartrate: 152,
    max_heartrate: 178,
    average_watts: null,
    average_cadence: 172,
    average_temp: 18,
    workout_type: 1,
  };

  it("maps a real Strava run to the internal ExternalActivity shape", () => {
    const result = mapStravaActivity(base);
    expect(result).not.toBeNull();
    expect(result).toMatchObject({
      external_id: "123456789",
      source: "strava",
      sport: "running",
      title: "Morning Run",
      started_at: "2026-07-20T06:30:00Z",
      duration_seconds: 1800, // moving_time, not elapsed_time
      distance_meters: 5000,
      elevation_meters: 42,
      avg_heart_rate: 152,
      max_heart_rate: 178,
      avg_cadence: 172,
      temperature_celsius: 18,
      session_type: "race", // workout_type 1
    });
  });

  it("uses moving_time rather than elapsed_time for duration", () => {
    const result = mapStravaActivity(base)!;
    expect(result.duration_seconds).toBe(base.moving_time);
    expect(result.duration_seconds).not.toBe(base.elapsed_time);
  });

  it("returns null for a Strava activity type with no real SportType equivalent, instead of guessing", () => {
    expect(mapStravaActivity({ ...base, type: "Yoga" })).toBeNull();
    expect(mapStravaActivity({ ...base, type: "AlpineSki" })).toBeNull();
  });

  it("omits distance for a zero-distance activity rather than passing through a misleading 0", () => {
    const result = mapStravaActivity({ ...base, distance: 0 })!;
    expect(result.distance_meters).toBeUndefined();
  });

  it("leaves session_type undefined for the default workout_type", () => {
    const result = mapStravaActivity({ ...base, workout_type: 0 })!;
    expect(result.session_type).toBeUndefined();
  });
});
