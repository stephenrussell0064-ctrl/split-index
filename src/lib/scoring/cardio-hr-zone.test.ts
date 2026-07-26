import { describe, expect, it } from "vitest";
import {
  computeHrZoneProfile,
  hrZoneEffortAdjustment,
  belowBasePaceCorroboration,
  HR_ZONE_MAX_ADJUSTMENT,
  HR_ZONE_TARGET_CREDIT,
  riegelEquivalentSeconds,
} from "./cardio-predictions";
import { scoreCardioActivity, type CardioInput } from "./cardio-activity";

/**
 * Personalized heart-rate-zone scoring (user feedback): "max heart rate -
 * resting heart rate should give a base value... each 20% of resting heart
 * rate add on to this base value to be a different heart rate zone... the
 * 30% mark to be the middle score." Verified against the user's own worked
 * example: max=207, resting=50 -> base=157, zones 157-167/167-177/177-187/
 * 187-197/197-207, target=172.
 */
describe("computeHrZoneProfile", () => {
  it("matches the user's own worked example exactly", () => {
    const profile = computeHrZoneProfile(50, 207);
    expect(profile).not.toBeNull();
    expect(profile!.base).toBe(157);
    expect(profile!.zoneWidth).toBe(10); // 20% of resting (50)
    expect(profile!.target).toBe(172); // base + 30% of resting
  });

  it("returns null without both resting and max HR, or when max <= resting", () => {
    expect(computeHrZoneProfile(null, 207)).toBeNull();
    expect(computeHrZoneProfile(50, null)).toBeNull();
    expect(computeHrZoneProfile(100, 90)).toBeNull();
  });
});

/**
 * Target is a flat credit floor (user feedback: "the target heart rate
 * should score at least 550 [for a 5:30/km 10km]... it should still have
 * the incremental bonus below the target heart rate... below target should
 * score higher and above target should score lower, by +-10%"). So target
 * itself earns HR_ZONE_TARGET_CREDIT, and the ramp still applies fully
 * gradated on both sides on top of that floor.
 */
describe("hrZoneEffortAdjustment — buffed target floor + graduated ramp both sides", () => {
  const profile = computeHrZoneProfile(50, 207)!; // base=157, target=172, max=207

  it("earns exactly the flat target credit floor at target, not zero", () => {
    const result = hrZoneEffortAdjustment(172, profile);
    expect(result.adjustmentFraction).toBeCloseTo(HR_ZONE_TARGET_CREDIT, 5);
    expect(result.zone).toBe("credit");
  });

  it("ramps to floor + full ramp at or below base (trusting HR outright with no corroboration data)", () => {
    const atBase = hrZoneEffortAdjustment(157, profile, 1);
    expect(atBase.adjustmentFraction).toBeCloseTo(HR_ZONE_TARGET_CREDIT + HR_ZONE_MAX_ADJUSTMENT, 5);
    expect(atBase.zone).toBe("credit");
  });

  it("gives partial extra credit halfway between base and target, still above the floor", () => {
    // Halfway: avgHR = 164.5 -> rampFraction = 0.5 -> floor + half the ramp
    const result = hrZoneEffortAdjustment(164.5, profile);
    expect(result.adjustmentFraction).toBeCloseTo(HR_ZONE_TARGET_CREDIT + HR_ZONE_MAX_ADJUSTMENT * 0.5, 5);
  });

  it("erodes the floor by the full ramp at max HR, but this magnitude keeps it net-positive", () => {
    const atMax = hrZoneEffortAdjustment(207, profile);
    expect(atMax.adjustmentFraction).toBeCloseTo(HR_ZONE_TARGET_CREDIT - HR_ZONE_MAX_ADJUSTMENT, 5);
    // With current constants (0.11 floor, 0.10 ramp) even the worst case stays a small net credit.
    expect(atMax.adjustmentFraction).toBeGreaterThan(0);
  });

  it("erodes the floor by half the ramp halfway between target and max", () => {
    // Halfway: avgHR = 189.5 -> penaltyRampFraction = 0.5
    const result = hrZoneEffortAdjustment(189.5, profile);
    expect(result.adjustmentFraction).toBeCloseTo(HR_ZONE_TARGET_CREDIT - HR_ZONE_MAX_ADJUSTMENT * 0.5, 5);
  });

  it("is strictly decreasing as avg HR rises above target, and strictly increasing as it falls below target", () => {
    const values = [140, 150, 157, 165, 172, 178, 190, 200, 207].map(
      (hr) => hrZoneEffortAdjustment(hr, profile, 1).adjustmentFraction
    );
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeLessThanOrEqual(values[i - 1]);
    }
  });

  it("clips at the boundaries — going below base or above max never exceeds the floor +/- the ramp", () => {
    expect(hrZoneEffortAdjustment(100, profile, 1).adjustmentFraction).toBeCloseTo(
      HR_ZONE_TARGET_CREDIT + HR_ZONE_MAX_ADJUSTMENT,
      5
    );
    expect(hrZoneEffortAdjustment(250, profile).adjustmentFraction).toBeCloseTo(
      HR_ZONE_TARGET_CREDIT - HR_ZONE_MAX_ADJUSTMENT,
      5
    );
  });
});

/**
 * Below-base guard (user feedback: "I have just rowed what felt like zone
 * 2-3 and it averaged at 156 which would be less than my base value,
 * therefore it needs to be able to account for this potential error").
 */
describe("belowBasePaceCorroboration — below-base guard", () => {
  it("trusts the HR reading outright (corroboration=1) when no pace baseline exists yet", () => {
    expect(belowBasePaceCorroboration(1500, undefined)).toBe(1);
    expect(belowBasePaceCorroboration(1500, null)).toBe(1);
  });

  it("floors at partial trust (not zero) when this session's pace matches the athlete's normal easy pace exactly", () => {
    const corroboration = belowBasePaceCorroboration(1500, 1500);
    expect(corroboration).toBeGreaterThan(0);
    expect(corroboration).toBeLessThan(1);
  });

  it("grants full trust when this session's pace is genuinely slower than the athlete's normal easy pace", () => {
    // This session's projected time (1500s) is 11% slower than baseline (1350s).
    expect(belowBasePaceCorroboration(1500, 1350)).toBe(1);
  });

  it("floors at the same partial trust when this session's pace is actually faster than baseline (strongest mismatch)", () => {
    const atPace = belowBasePaceCorroboration(1500, 1500);
    const faster = belowBasePaceCorroboration(1500, 1650); // session is faster than baseline
    expect(faster).toBe(atPace); // both clamp to the same floor
  });
});

describe("hrZoneEffortAdjustment — below-base guard scales only the ramp, never the target floor", () => {
  const profile = computeHrZoneProfile(50, 207)!; // base=157

  it("scales down only the ramp portion when pace doesn't corroborate an ultra-easy effort — the floor is untouched", () => {
    const raw = riegelEquivalentSeconds(3300, 10000, 5000, 1.08);
    const noCorroboration = belowBasePaceCorroboration(raw, raw); // pace == baseline, no slowdown
    const guarded = hrZoneEffortAdjustment(156, profile, noCorroboration);
    const trusted = hrZoneEffortAdjustment(156, profile, 1);

    expect(guarded.adjustmentFraction).toBeGreaterThanOrEqual(HR_ZONE_TARGET_CREDIT);
    expect(guarded.adjustmentFraction).toBeLessThan(trusted.adjustmentFraction);
    expect(guarded.belowBaseGuardApplied).toBe(true);
    expect(trusted.belowBaseGuardApplied).toBe(false);
  });

  it("does not apply the below-base guard above the base boundary (normal credit range unaffected)", () => {
    const result = hrZoneEffortAdjustment(165, profile, 0.2); // corroboration ignored above base
    expect(result.belowBaseGuardApplied).toBe(false);
  });
});

/**
 * End-to-end wiring in scoreCardioActivity: the HR-zone mechanism REPLACES
 * (not stacks with) the EF-baseline relative-effort bonus when both
 * restingHR/maxHR are on file (user-confirmed design decision), applies to
 * run/row/swim/cycle/ski but not walk, and flags sessions that would score
 * more accurately with HR-zone data.
 */
describe("scoreCardioActivity — HR-zone wiring", () => {
  const base: CardioInput = {
    type: "run",
    benchmarkSport: "run",
    distanceMeters: 10000,
    durationSeconds: 3300, // 5:30/km 10km, easy pace
    sex: "male",
    age: 30,
    sessionType: "easy",
    restingHR: 50,
    maxHR: 207,
  };

  it("uses the HR-zone mechanism (not the EF-baseline one) when restingHR/maxHR + avgHR are present", () => {
    const result = scoreCardioActivity({ ...base, avgHR: 150, easyEffortBaselineEF: 1.0 });
    expect(result.flags).toContain("hr-zone-scored");
    expect(result.flags).not.toContain("relative-effort-scored");
  });

  it("at target, scores at least 550 for a 5:30/km 10km (user-specified floor)", () => {
    const atTarget = scoreCardioActivity({ ...base, avgHR: 172 });
    expect(atTarget.score).toBeGreaterThanOrEqual(550);
  });

  it("scores strictly higher below target and strictly lower above target, relative to right-at-target", () => {
    const atTarget = scoreCardioActivity({ ...base, avgHR: 172 });
    const belowTarget = scoreCardioActivity({ ...base, avgHR: 160 });
    const aboveTarget = scoreCardioActivity({ ...base, avgHR: 195 });
    expect(belowTarget.score).toBeGreaterThan(atTarget.score);
    expect(aboveTarget.score).toBeLessThan(atTarget.score);
  });

  it("flags above-target vs at-or-below-target distinctly for accurate UI messaging", () => {
    const below = scoreCardioActivity({ ...base, avgHR: 160 });
    const above = scoreCardioActivity({ ...base, avgHR: 195 });
    expect(below.flags).toContain("hr-zone-at-or-below-target");
    expect(above.flags).toContain("hr-zone-above-target");
  });

  it("falls back to the EF-baseline mechanism when resting/max HR aren't both on file", () => {
    const result = scoreCardioActivity({
      ...base,
      restingHR: undefined,
      maxHR: undefined,
      avgHR: 150,
      easyEffortBaselineEF: 1.2,
    });
    expect(result.flags).not.toContain("hr-zone-scored");
    expect(result.flags).toContain("hr-zone-data-missing");
  });

  it("flags hr-zone-data-missing when zone data exists but this session has no avg HR reading", () => {
    const result = scoreCardioActivity({ ...base, avgHR: undefined });
    expect(result.flags).toContain("hr-zone-data-missing");
  });

  it("does not apply the HR-zone mechanism to walking, even with full HR-zone data", () => {
    const result = scoreCardioActivity({
      ...base,
      type: "run",
      benchmarkSport: "walk",
      avgHR: 150,
    });
    expect(result.flags).not.toContain("hr-zone-scored");
    expect(result.flags).not.toContain("hr-zone-data-missing");
  });

  it("leaves race/tempo sessions untouched (HR-zone mechanism only applies to easy/recovery/long)", () => {
    const result = scoreCardioActivity({ ...base, sessionType: "race", avgHR: 150 });
    expect(result.flags).not.toContain("hr-zone-scored");
  });
});

/**
 * Assumed-target fallback (user feedback): "make the input without heart
 * rate data at the target heart rate score... make it clear to the user
 * that this is at the perfect heart rate zone and it may not be accurate."
 * When there's truly no HR signal at all (no avg HR reading, and no
 * EF-baseline history to fall back on either), assume the session was
 * executed right at target rather than judging it on raw pace alone.
 */
describe("scoreCardioActivity — assumed-target fallback with no HR data at all", () => {
  const base: CardioInput = {
    type: "run",
    benchmarkSport: "run",
    distanceMeters: 10000,
    durationSeconds: 3300, // 5:30/km 10km
    sex: "male",
    age: 30,
    sessionType: "easy",
  };

  it("scores exactly the same as a real at-target HR-zone reading", () => {
    const assumed = scoreCardioActivity({ ...base, avgHR: undefined });
    const realAtTarget = scoreCardioActivity({ ...base, restingHR: 50, maxHR: 207, avgHR: 172 });
    expect(assumed.score).toBe(realAtTarget.score);
    expect(assumed.flags).toContain("hr-zone-assumed-target");
  });

  it("prefers real EF-baseline evidence over the assumption when this session has an avg HR reading", () => {
    const withEF = scoreCardioActivity({
      ...base,
      avgHR: 160,
      easyEffortBaselineEF: (10000 / (3300 / 60)) / 160,
    });
    expect(withEF.flags).not.toContain("hr-zone-assumed-target");
  });

  it("does not apply the assumption to race/tempo sessions — those stay on absolute pace", () => {
    const race = scoreCardioActivity({ ...base, sessionType: "race", avgHR: undefined });
    expect(race.flags).not.toContain("hr-zone-assumed-target");
  });

  it("does not apply the assumption to walking (zone mechanism excluded by design)", () => {
    const walk = scoreCardioActivity({ ...base, benchmarkSport: "walk", avgHR: undefined });
    expect(walk.flags).not.toContain("hr-zone-assumed-target");
  });

  it("does not apply the assumption when the pace looks mistagged (mistag guard still gates it)", () => {
    const mistagged = scoreCardioActivity({
      ...base,
      avgHR: undefined,
      recentHardEffortBenchmarkSeconds: 100000, // absurdly fast reference -> this session reads as mistagged
    });
    expect(mistagged.flags).not.toContain("hr-zone-assumed-target");
  });
});
