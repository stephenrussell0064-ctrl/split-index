import { describe, expect, it } from "vitest";
import {
  personalizedReferenceHR,
  computeSessionBenchmarkEquivalentSeconds,
  hrAdjustedEquivalentSeconds,
} from "./cardio-predictions";

describe("personalizedReferenceHR", () => {
  it("reduces to the original fixed reference for a population-typical athlete (resting 60, Tanaka max at age 35)", () => {
    const populationMaxHR = 208 - 0.7 * 35;
    expect(personalizedReferenceHR("run", 60, populationMaxHR)).toBeCloseTo(175, 5);
    expect(personalizedReferenceHR("walk", 60, populationMaxHR)).toBeCloseTo(140, 5);
    expect(personalizedReferenceHR("row", 60, populationMaxHR)).toBeCloseTo(175, 5);
    expect(personalizedReferenceHR("swim", 60, populationMaxHR)).toBeCloseTo(160, 5);
    expect(personalizedReferenceHR("cycle", 60, populationMaxHR)).toBeCloseTo(165, 5);
    expect(personalizedReferenceHR("ski", 60, populationMaxHR)).toBeCloseTo(175, 5);
  });

  it("shifts the reference up for an athlete with a higher resting/max HR range", () => {
    const populationMaxHR = 208 - 0.7 * 35;
    const highHrAthleteRef = personalizedReferenceHR("run", 55, 202);
    const populationRef = personalizedReferenceHR("run", 60, populationMaxHR);
    expect(highHrAthleteRef).toBeGreaterThan(populationRef);
  });

  it("shifts the reference down for an athlete with a lower resting/max HR range", () => {
    const populationMaxHR = 208 - 0.7 * 35;
    const lowHrAthleteRef = personalizedReferenceHR("run", 45, 175);
    const populationRef = personalizedReferenceHR("run", 60, populationMaxHR);
    expect(lowHrAthleteRef).toBeLessThan(populationRef);
  });
});

describe("computeSessionBenchmarkEquivalentSeconds — backward compatibility", () => {
  it("behaves identically to before when no personalization is supplied", () => {
    const withoutPersonalization = computeSessionBenchmarkEquivalentSeconds("run", 5000, 1160, 178);
    const withEmptyPersonalization = computeSessionBenchmarkEquivalentSeconds("run", 5000, 1160, 178, undefined, {});
    expect(withEmptyPersonalization).toBe(withoutPersonalization);
  });

  it("falls back to the fixed reference when only one of resting/max HR is known", () => {
    const partial = computeSessionBenchmarkEquivalentSeconds("run", 5000, 1160, 178, undefined, { restingHR: 50 });
    const none = computeSessionBenchmarkEquivalentSeconds("run", 5000, 1160, 178);
    expect(partial).toBe(none);
  });
});

describe("computeSessionBenchmarkEquivalentSeconds — personalization fixes the same-relative-effort case", () => {
  // Two athletes at the SAME relative effort (15 bpm below their own personal
  // reference) but very different absolute HR — a fixed population reference
  // rewards one and not the other; a personalized reference rewards both equally.
  const distanceMeters = 5000;
  const durationSeconds = 1200; // same session, same pace, for both athletes

  const runnerA = { restingHR: 50, maxHR: 190 }; // moderate physiology
  const highHrAthlete = { restingHR: 55, maxHR: 202 }; // naturally higher HR

  it("under the fixed population reference, the high-HR athlete gets less credit for the same relative effort", () => {
    const refA = personalizedReferenceHR("run", runnerA.restingHR, runnerA.maxHR);
    const refHigh = personalizedReferenceHR("run", highHrAthlete.restingHR, highHrAthlete.maxHR);
    const avgHrA = refA - 15;
    const avgHrHigh = refHigh - 15;

    const equivA = computeSessionBenchmarkEquivalentSeconds("run", distanceMeters, durationSeconds, avgHrA);
    const equivHigh = computeSessionBenchmarkEquivalentSeconds("run", distanceMeters, durationSeconds, avgHrHigh);

    // Unpersonalized: the high-HR athlete's actual bpm sits above the fixed
    // 175 reference even though it's an easier relative effort for them, so
    // they get zero bonus while runner A gets a real one.
    expect(equivA!).toBeLessThan(durationSeconds);
    expect(equivHigh!).toBe(durationSeconds);
  });

  it("under personalization, both athletes get the same credit for the same relative effort", () => {
    const refA = personalizedReferenceHR("run", runnerA.restingHR, runnerA.maxHR);
    const refHigh = personalizedReferenceHR("run", highHrAthlete.restingHR, highHrAthlete.maxHR);
    const avgHrA = refA - 15;
    const avgHrHigh = refHigh - 15;

    const equivA = computeSessionBenchmarkEquivalentSeconds(
      "run", distanceMeters, durationSeconds, avgHrA, undefined,
      { restingHR: runnerA.restingHR, maxHR: runnerA.maxHR }
    );
    const equivHigh = computeSessionBenchmarkEquivalentSeconds(
      "run", distanceMeters, durationSeconds, avgHrHigh, undefined,
      { restingHR: highHrAthlete.restingHR, maxHR: highHrAthlete.maxHR }
    );

    expect(equivA).toBeCloseTo(equivHigh!, 5);
  });
});

describe("hrAdjustedEquivalentSeconds — bonus-only, never a penalty", () => {
  it("never makes the time slower than the raw projection, even far above reference", () => {
    expect(hrAdjustedEquivalentSeconds(1200, 220, 175)).toBe(1200);
  });

  it("with no HR data, returns the time unadjusted", () => {
    expect(hrAdjustedEquivalentSeconds(1200, undefined, 175)).toBe(1200);
    expect(hrAdjustedEquivalentSeconds(1200, null, 175)).toBe(1200);
  });

  it("caps the bonus at HR_ADJUST_MAX (10%)", () => {
    // An absurdly low HR relative to reference should clamp at the 10% cap, not extrapolate further.
    const capped = hrAdjustedEquivalentSeconds(1200, 40, 175);
    expect(capped).toBeCloseTo(1200 * 0.9, 5);
  });
});
