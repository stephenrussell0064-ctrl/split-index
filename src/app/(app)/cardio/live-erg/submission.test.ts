import { describe, expect, it } from "vitest";
import { buildErgActivityPayload, splitSecondsPer500, summariseErgSession } from "./submission";
import { createActivitySchema } from "@/lib/validation/schemas/activity";

const PROFILE = { weightKg: 80, age: 30, sex: "male" as const };
const T0 = Date.parse("2026-10-22T07:00:00Z");

function readings(fromMs: number, toMs: number, bpm: number, everyMs = 1000) {
  const out = [];
  for (let t = fromMs; t < toMs; t += everyMs) out.push({ bpm, time: t });
  return out;
}

describe("summariseErgSession", () => {
  it("takes the paused time out of the moving time and out of the heart-rate averages", () => {
    const summary = summariseErgSession({
      sport: "rowing",
      startedAt: T0,
      endedAt: T0 + 600_000,
      pauses: [{ startTime: T0 + 200_000, endTime: T0 + 260_000 }],
      hrReadings: [...readings(T0, T0 + 200_000, 150), ...readings(T0 + 200_000, T0 + 260_000, 100), ...readings(T0 + 260_000, T0 + 600_000, 150)],
      hrSource: "ble",
      profile: PROFILE,
    });
    expect(summary.movingSeconds).toBe(540);
    expect(summary.avgHr).toBe(150);
    expect(summary.maxHr).toBe(150);
    expect(summary.energy.method).toBe("heart-rate");
    expect(summary.energy.kcal).toBeGreaterThan(100);
  });

  it("has no heart-rate figures and a MET estimate without a monitor", () => {
    const summary = summariseErgSession({
      sport: "bike_erg", startedAt: T0, endedAt: T0 + 1_800_000, pauses: [], hrReadings: [], hrSource: null, profile: PROFILE,
    });
    expect(summary.avgHr).toBeNull();
    expect(summary.maxHr).toBeNull();
    expect(summary.energy.method).toBe("met");
    expect(summary.energy.kcal).toBeCloseTo(272, 0);
  });
});

describe("splitSecondsPer500", () => {
  it("is the erg's convention: 2000m in 8:00 is a 2:00 split", () => {
    expect(splitSecondsPer500(2000, 480)).toBe(120);
    expect(splitSecondsPer500(0, 480)).toBeNull();
  });
});

describe("buildErgActivityPayload", () => {
  const base = {
    sport: "rowing" as const,
    sessionType: "easy" as const,
    startedAt: T0,
    endedAt: T0 + 1_200_000,
    pauses: [],
    hrReadings: readings(T0, T0 + 1_200_000, 145, 2000),
    hrSource: "ble" as const,
    profile: PROFILE,
    distanceMeters: 5000,
    hpeSessionId: null,
  };

  it("is a body the activities route accepts, with the split derived from the monitor's distance", () => {
    const payload = buildErgActivityPayload(base);
    expect(payload).toMatchObject({
      sport: "rowing",
      duration_seconds: 1200,
      distance_meters: 5000,
      avg_split_seconds: 120,
      avg_heart_rate: 145,
      max_heart_rate: 145,
      source: "live",
      logging_effort: { entry: "live", fields_touched: 2, seconds_to_save: 0 },
    });
    expect((payload.live_session as { calories_kcal: number }).calories_kcal).toBeGreaterThan(200);
    expect(createActivitySchema.safeParse(payload).success).toBe(true);
  });

  it("saves without a distance, a split or heart rate when none were recorded", () => {
    const payload = buildErgActivityPayload({ ...base, sport: "bike_erg", hrReadings: [], hrSource: null, distanceMeters: null });
    expect(payload).not.toHaveProperty("distance_meters");
    expect(payload).not.toHaveProperty("avg_split_seconds");
    expect(payload).not.toHaveProperty("avg_heart_rate");
    expect((payload.live_session as { calories_method: string }).calories_method).toBe("met");
    expect(createActivitySchema.safeParse(payload).success).toBe(true);
  });

  it("carries the plan link when the session was started from a prescription", () => {
    const payload = buildErgActivityPayload({ ...base, hpeSessionId: "11111111-2222-4333-8444-555555555555" });
    expect(payload.hpe_session_id).toBe("11111111-2222-4333-8444-555555555555");
    expect(createActivitySchema.safeParse(payload).success).toBe(true);
  });
});
