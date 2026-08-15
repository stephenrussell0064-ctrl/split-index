import { describe, expect, it } from "vitest";
import {
  ACCESSORY_METRIC_MAX_SCORE,
  CARRY_FLAG,
  HOLD_FLAG,
  UNMEASURED_FLAG,
  accessoryMetricIndex,
  accessoryMetricVolumeEquivalentKg,
  isAccessoryMetricResult,
  isScoredAccessoryMetricResult,
  resolveTrackedMetric,
  scoreLoadedCarry,
  scoreTimedHold,
  type AccessoryMetricSet,
} from "@/lib/scoring/strength/isometric-carry";

const BW = 80;

function hold(
  liftKey: string,
  sets: AccessoryMetricSet[],
  overrides: { sex?: "male" | "female"; age?: number | null; bodyweightKg?: number } = {}
) {
  return scoreTimedHold({
    liftKey,
    sets,
    bodyweightKg: overrides.bodyweightKg ?? BW,
    sex: overrides.sex ?? "male",
    age: overrides.age ?? 30,
  });
}

function carry(
  liftKey: string,
  sets: AccessoryMetricSet[],
  overrides: { sex?: "male" | "female"; age?: number | null; bodyweightKg?: number } = {}
) {
  return scoreLoadedCarry({
    liftKey,
    sets,
    bodyweightKg: overrides.bodyweightKg ?? BW,
    sex: overrides.sex ?? "male",
    age: overrides.age ?? 30,
  });
}

const plankSet = (durationSeconds: number, weightKg = 0): AccessoryMetricSet => ({
  weightKg,
  durationSeconds,
});
const carrySet = (weightKg: number, distanceMeters: number): AccessoryMetricSet => ({
  weightKg,
  distanceMeters,
});

describe("resolveTrackedMetric", () => {
  it("takes the catalogue's word for planks and carries", () => {
    expect(resolveTrackedMetric("time", [plankSet(60)])).toBe("hold");
    expect(resolveTrackedMetric("distance", [carrySet(40, 20)])).toBe("carry");
  });

  it("infers from the set payload for custom exercise names the catalogue doesn't know", () => {
    // "Copenhagen Hold" isn't in COMMON_EXERCISES, so getExerciseTracking
    // returns "reps" — but the athlete still typed a hold time, and scoring
    // that as a 0kg single rep is the exact bug this module exists to fix.
    expect(resolveTrackedMetric("reps", [plankSet(45)])).toBe("hold");
    expect(resolveTrackedMetric("reps", [carrySet(30, 25)])).toBe("carry");
  });

  it("leaves ordinary rep work alone", () => {
    expect(resolveTrackedMetric("reps", [{}])).toBe("reps");
    expect(resolveTrackedMetric("reps", [{ durationSeconds: 0, distanceMeters: null }])).toBe(
      "reps"
    );
  });
});

describe("timed holds", () => {
  it("scores a two-minute bodyweight plank at the 500 anchor", () => {
    expect(hold("Plank", [plankSet(120)]).score).toBe(500);
  });

  it("scores the side plank against its own (shorter) anchor", () => {
    expect(hold("Side Plank", [plankSet(90)]).score).toBe(500);
    // Same 60s hold is worth more on the harder movement.
    expect(hold("Side Plank", [plankSet(60)]).score).toBeGreaterThan(
      hold("Plank", [plankSet(60)]).score
    );
  });

  it("rises monotonically with hold time", () => {
    const scores = [30, 60, 90, 120, 180, 240, 300].map((s) => hold("Plank", [plankSet(s)]).score);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeGreaterThan(scores[i - 1]);
    }
  });

  it("rises with added load at identical hold time", () => {
    const bodyweightOnly = hold("Weighted Plank", [plankSet(60)]).score;
    const twenty = hold("Weighted Plank", [plankSet(60, 20)]).score;
    const forty = hold("Weighted Plank", [plankSet(60, 40)]).score;
    expect(twenty).toBeGreaterThan(bodyweightOnly);
    expect(forty).toBeGreaterThan(twenty);
  });

  it("stops paying for hold time past five minutes", () => {
    const fiveMinutes = hold("Plank", [plankSet(300)]);
    expect(hold("Plank", [plankSet(600)]).score).toBe(fiveMinutes.score);
    expect(hold("Plank", [plankSet(1800)]).score).toBe(fiveMinutes.score);
    expect(hold("Plank", [plankSet(1800)]).flags).toContain("hold-duration-credit-capped");
    expect(fiveMinutes.flags).not.toContain("hold-duration-credit-capped");
  });

  it("scores the best set, not the first or the sum", () => {
    const best = hold("Plank", [plankSet(45), plankSet(150), plankSet(60)]).score;
    expect(best).toBe(hold("Plank", [plankSet(150)]).score);
    // Not the sum of the three (255s would score higher still).
    expect(best).toBeLessThan(hold("Plank", [plankSet(255)]).score);
  });

  it("applies the age curve but deliberately not the sex factor", () => {
    const young = hold("Plank", [plankSet(120)], { age: 30 }).score;
    const masters = hold("Plank", [plankSet(120)], { age: 50 }).score;
    expect(masters).toBeGreaterThan(young);

    // A hold's load IS the athlete's own bodyweight, so the demand already
    // self-normalizes — borrowing the maximal-strength sex factors here would
    // be applying a calibration from a different quantity.
    expect(hold("Plank", [plankSet(120)], { sex: "female" }).score).toBe(young);
  });

  it("cannot be scored without a hold time, and says so instead of guessing", () => {
    const result = hold("Plank", [{ weightKg: 0 }]);
    expect(result.score).toBe(0);
    expect(result.flags).toContain(UNMEASURED_FLAG);
    expect(isAccessoryMetricResult(result)).toBe(true);
    expect(isScoredAccessoryMetricResult(result)).toBe(false);
  });

  it("never invents a 1RM (which would leak into personal records)", () => {
    const result = hold("Weighted Plank", [plankSet(120, 40)]);
    expect(result.oneRM).toBe(0);
    expect(result.source).toBe("generic");
    expect(result.flags).toContain("estimated-generic-standard");
    expect(result.flags).toContain(HOLD_FLAG);
  });
});

describe("loaded carries", () => {
  it("scores 0.75x bodyweight of total load over 30m at the 500 anchor", () => {
    // 30kg per hand, resolved to 60kg total by weight-entry.ts == 0.75 x 80kg.
    expect(carry("Farmer's Carry", [carrySet(60, 30)]).score).toBe(500);
  });

  it("rises with load and with distance", () => {
    const light = carry("Farmer's Carry", [carrySet(40, 30)]).score;
    const heavy = carry("Farmer's Carry", [carrySet(80, 30)]).score;
    expect(heavy).toBeGreaterThan(light);

    const short = carry("Farmer's Carry", [carrySet(60, 15)]).score;
    const long = carry("Farmer's Carry", [carrySet(60, 45)]).score;
    expect(long).toBeGreaterThan(short);
  });

  it("weights load above distance", () => {
    // Doubling the load beats doubling the distance, every time.
    const doubleLoad = carry("Farmer's Carry", [carrySet(120, 30)]).score;
    const doubleDistance = carry("Farmer's Carry", [carrySet(60, 60)]).score;
    expect(doubleLoad).toBeGreaterThan(doubleDistance);
  });

  it("stops paying for distance past 60m, so a light long walk isn't a strength score", () => {
    const sixty = carry("Farmer's Carry", [carrySet(60, 60)]);
    expect(carry("Farmer's Carry", [carrySet(60, 400)]).score).toBe(sixty.score);
    expect(carry("Farmer's Carry", [carrySet(60, 400)]).flags).toContain(
      "carry-distance-credit-capped"
    );
    // 20kg in each hand for 400m is a walk, and scores below the anchor.
    expect(carry("Farmer's Carry", [carrySet(40, 400)]).score).toBeLessThan(500);
  });

  it("treats a one-sided suitcase carry as half the load for the same score", () => {
    expect(carry("Suitcase Carry", [carrySet(30, 30)]).score).toBe(
      carry("Farmer's Carry", [carrySet(60, 30)]).score
    );
  });

  it("discounts a sled for friction — 100kg dragged is not 100kg carried", () => {
    expect(carry("Sled Push", [carrySet(100, 20)]).score).toBeLessThan(
      carry("Farmer's Carry", [carrySet(100, 20)]).score
    );
    expect(carry("Sled Pull", [carrySet(100, 20)]).score).toBe(
      carry("Sled Push", [carrySet(100, 20)]).score
    );
  });

  it("will not score a carry with no load — that is walking", () => {
    const result = carry("Farmer's Carry", [carrySet(0, 200)]);
    expect(result.score).toBe(0);
    expect(result.flags).toContain(UNMEASURED_FLAG);
    expect(result.flags).toContain(CARRY_FLAG);
  });

  it("applies the sex and age factors the main engine already calibrated", () => {
    const male = carry("Farmer's Carry", [carrySet(60, 30)]).score;
    expect(carry("Farmer's Carry", [carrySet(60, 30)], { sex: "female" }).score).toBeGreaterThan(
      male
    );
    expect(carry("Farmer's Carry", [carrySet(60, 30)], { age: 50 }).score).toBeGreaterThan(male);
  });

  it("scores the best set", () => {
    expect(carry("Farmer's Carry", [carrySet(40, 20), carrySet(80, 40)]).score).toBe(
      carry("Farmer's Carry", [carrySet(80, 40)]).score
    );
  });
});

describe("the top end is bounded", () => {
  it("caps every hold and carry below the Advanced tier threshold (725)", () => {
    const absurd = [
      hold("Plank", [plankSet(3600, 100)]),
      hold("Side Plank", [plankSet(3600, 100)]),
      carry("Farmer's Carry", [carrySet(400, 500)]),
      carry("Suitcase Carry", [carrySet(200, 500)]),
      carry("Sled Push", [carrySet(500, 500)]),
    ];
    for (const result of absurd) {
      expect(result.score).toBe(ACCESSORY_METRIC_MAX_SCORE);
      expect(result.score).toBeLessThan(725);
      expect(result.flags).toContain("accessory-metric-capped");
    }
  });

  it("floors at 1 rather than going negative for a trivial effort", () => {
    expect(hold("Plank", [plankSet(1)]).score).toBeGreaterThanOrEqual(1);
    expect(carry("Farmer's Carry", [carrySet(1, 1)]).score).toBeGreaterThanOrEqual(1);
  });
});

describe("accessoryMetricIndex", () => {
  it("averages the scored results and stays under the family cap", () => {
    const results = [hold("Plank", [plankSet(120)]), carry("Farmer's Carry", [carrySet(60, 30)])];
    expect(accessoryMetricIndex(results)).toBe(500);
    expect(
      accessoryMetricIndex([
        hold("Plank", [plankSet(3600, 100)]),
        carry("Sled Push", [carrySet(500, 500)]),
      ])
    ).toBe(ACCESSORY_METRIC_MAX_SCORE);
  });

  it("ignores results that could not be measured", () => {
    const measured = hold("Plank", [plankSet(120)]);
    const unmeasured = carry("Farmer's Carry", [carrySet(100, 0)]);
    expect(accessoryMetricIndex([measured, unmeasured])).toBe(measured.score);
    expect(accessoryMetricIndex([unmeasured])).toBe(1);
    expect(accessoryMetricIndex([])).toBe(1);
  });
});

describe("training-load equivalence", () => {
  it("gives a bodyweight hold a non-zero load, which weight x reps cannot", () => {
    const volume = accessoryMetricVolumeEquivalentKg(
      "hold",
      [plankSet(120), plankSet(90)],
      BW,
      "Plank"
    );
    // weight_kg is 0 on every one of those sets, so the legacy volume metric
    // would report exactly 0 for a session that clearly involved work.
    expect(volume).toBeGreaterThan(0);
    // Both sets count — load is a volume measure, unlike the index.
    expect(volume).toBeGreaterThan(
      accessoryMetricVolumeEquivalentKg("hold", [plankSet(120)], BW, "Plank")
    );
  });

  it("scales carry load with distance and ignores unmeasured sets", () => {
    const twenty = accessoryMetricVolumeEquivalentKg(
      "carry",
      [carrySet(60, 20)],
      BW,
      "Farmer's Carry"
    );
    const forty = accessoryMetricVolumeEquivalentKg(
      "carry",
      [carrySet(60, 40)],
      BW,
      "Farmer's Carry"
    );
    expect(forty).toBeCloseTo(twenty * 2, 5);
    expect(
      accessoryMetricVolumeEquivalentKg("carry", [{ weightKg: 60 }], BW, "Farmer's Carry")
    ).toBe(0);
  });
});
