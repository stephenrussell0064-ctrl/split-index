import { describe, expect, it } from "vitest";
import {
  caloriesFromHeartRate,
  DEFAULT_WEIGHT_KG,
  estimateSessionEnergy,
  keytelKcalPerMin,
  MAX_SAMPLE_GAP_S,
  metKcalPerMin,
} from "./energy";

const MALE = { weightKg: 80, age: 30, sex: "male" as const };
const FEMALE = { weightKg: 60, age: 30, sex: "female" as const };

describe("keytelKcalPerMin", () => {
  it("reproduces the published regression at a working heart rate", () => {
    // Male, 80kg, 30y, 150bpm: (-55.0969 + 94.635 + 15.904 + 6.051) / 4.184
    expect(keytelKcalPerMin(150, MALE)).toBeCloseTo(14.70, 1);
    // Female, 60kg, 30y, 150bpm: (-20.4022 + 67.08 - 7.578 + 2.22) / 4.184
    expect(keytelKcalPerMin(150, FEMALE)).toBeCloseTo(9.87, 1);
  });

  it("rises with heart rate", () => {
    expect(keytelKcalPerMin(170, MALE)).toBeGreaterThan(keytelKcalPerMin(130, MALE));
  });

  it("never goes below resting expenditure, however low the reading", () => {
    expect(keytelKcalPerMin(50, FEMALE)).toBeCloseTo(60 / 60, 6);
    expect(keytelKcalPerMin(40, MALE)).toBeCloseTo(80 / 60, 6);
  });
});

describe("caloriesFromHeartRate", () => {
  it("integrates each reading until the next, and the last until the end", () => {
    const t0 = 1_000_000;
    // Twelve readings ten seconds apart, the last holding to the end: two minutes at 150bpm.
    const readings = Array.from({ length: 12 }, (_, i) => ({ bpm: 150, time: t0 + i * 10_000 }));
    const kcal = caloriesFromHeartRate(readings, t0 + 120_000, MALE);
    expect(kcal).toBeCloseTo(keytelKcalPerMin(150, MALE) * 2, 6);
  });

  it("caps a dropout so a lost strap does not count as an hour of work", () => {
    const t0 = 0;
    const readings = [{ bpm: 160, time: t0 }];
    const kcal = caloriesFromHeartRate(readings, t0 + 3_600_000, MALE);
    expect(kcal).toBeCloseTo((keytelKcalPerMin(160, MALE) * MAX_SAMPLE_GAP_S) / 60, 6);
  });

  it("is zero with no readings", () => {
    expect(caloriesFromHeartRate([], 10_000, MALE)).toBe(0);
  });
});

describe("estimateSessionEnergy", () => {
  it("uses heart rate when there is any", () => {
    const out = estimateSessionEnergy({
      sport: "rowing",
      readings: [{ bpm: 150, time: 0 }],
      movingSeconds: 60,
      endTime: 60_000,
      profile: MALE,
    });
    expect(out.method).toBe("heart-rate");
    expect(out.assumed).toBe(false);
    expect(out.kcal).toBeCloseTo((keytelKcalPerMin(150, MALE) * MAX_SAMPLE_GAP_S) / 60, 6);
  });

  it("falls back to the sport's MET without heart rate, and a bike erg costs a little less than a row", () => {
    const row = estimateSessionEnergy({ sport: "rowing", readings: [], movingSeconds: 1800, endTime: 0, profile: MALE });
    const bike = estimateSessionEnergy({ sport: "bike_erg", readings: [], movingSeconds: 1800, endTime: 0, profile: MALE });
    expect(row.method).toBe("met");
    expect(row.kcal).toBeCloseTo(metKcalPerMin("rowing", 80) * 30, 6);
    expect(row.kcal).toBeCloseTo(280, 0);
    expect(bike.kcal).toBeLessThan(row.kcal);
  });

  it("assumes a weight when the profile has none, and says so", () => {
    const out = estimateSessionEnergy({
      sport: "rowing",
      readings: [],
      movingSeconds: 600,
      endTime: 0,
      profile: { weightKg: null, age: 30, sex: "male" },
    });
    expect(out.assumed).toBe(true);
    expect(out.kcal).toBeCloseTo(metKcalPerMin("rowing", DEFAULT_WEIGHT_KG) * 10, 6);
  });
});
