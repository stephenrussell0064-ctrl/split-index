import { describe, expect, it } from "vitest";
import { timeToScore } from "./cardio-benchmarks";
import { scoreCardioActivity } from "./cardio-activity";
import {
  BENCHMARK_RIEGEL_K,
  RIEGEL_K,
  benchmarkRiegelK,
  computeSessionBenchmarkEquivalentSeconds,
} from "./cardio-predictions";

/**
 * Part B (scoring-calibration-rewrite): row now uses sex-specific anchor
 * tables sourced from RowingRegimen's Concept2-logbook percentile data,
 * instead of a single male curve + generic female multiplier.
 */
describe("timeToScore — row (Part B corrected anchors)", () => {
  it("matches the corrected male percentile anchors", () => {
    expect(timeToScore("row", 370.2, "male")).toBeCloseTo(850, 0); // 6:10.2, 95th
    expect(timeToScore("row", 395.9, "male")).toBeCloseTo(725, 0); // 6:35.9, 80th
    expect(timeToScore("row", 424.6, "male")).toBeCloseTo(475, 0); // 7:04.6, 50th
    expect(timeToScore("row", 486.9, "male")).toBeCloseTo(125, 0); // 8:06.9, 5th
  });

  it("matches the corrected female percentile anchors", () => {
    expect(timeToScore("row", 423.9, "female")).toBeCloseTo(850, 0); // 7:03.9, 95th
    expect(timeToScore("row", 464.0, "female")).toBeCloseTo(725, 0); // 7:44.0, 80th
    expect(timeToScore("row", 510.2, "female")).toBeCloseTo(475, 0); // 8:30.2, 50th
  });

  it("no longer lets a beginner (bottom 5%) score into Intermediate territory", () => {
    // A beginner rower's ~8:07 2k should sit near the bottom of Beginner
    // (125), not Intermediate (the QA-flagged bug this corrects).
    expect(timeToScore("row", 486.9, "male")).toBeLessThan(250);
  });

  it("999 is reserved for the actual Concept2 2000m world record (user feedback: never achieved unless it's a world record for age/gender)", () => {
    expect(timeToScore("row", 5 * 60 + 33.4, "male")).toBe(999); // Simon van Dorp, 2026
    expect(timeToScore("row", 5 * 60 + 40, "male")).toBeLessThan(999);
    expect(timeToScore("row", 6 * 60 + 21.1, "female")).toBe(999); // Brooke Mooney, 2021
    expect(timeToScore("row", 6 * 60 + 30, "female")).toBeLessThan(999);
  });
});

/**
 * Reported bug: "Rowing scores in the Engine need recalibration — 2:08 for
 * 40:00 shows 88.2 and this is way too high."
 *
 * 2:08/500m held for 40:00 is 9,375m — a solid club-standard steady piece,
 * nowhere near elite. 88.2 is the DISPLAY scale (formatIndex in
 * lib/utils/format.ts divides the internal 0-1000 score by 10), so the
 * engine was returning ~882/1000 — above the 850 anchor that marks the 95th
 * percentile of the Concept2 logbook, i.e. a ~6:06 2k.
 *
 * Root cause: the session -> benchmark Riegel projection used RIEGEL_K
 * (1.08), a running-fitted exponent that this codebase then nudged UP off
 * running feedback. Rowing's benchmark is 2,000m, so a 40-minute row is a
 * 4.7x extrapolation down to it — five times the leverage a typical run has
 * against its 5k benchmark — and the running exponent turned 2:08/500m into
 * a 7:32 2k. Paul's Law (the standard Concept2 rule: +5 sec/500m per
 * doubling of distance) puts the real 2k at 7:47.4.
 */
describe("row — session->benchmark Riegel exponent (reported 2:08/40:00 = 88.2)", () => {
  const REPORTED_DISTANCE_M = 9375; // 2:08/500m held for 40:00
  const REPORTED_DURATION_S = 2400;
  /** Paul's Law: 2k pace = 40-min pace − 5 sec/500m per doubling of distance. */
  const PAULS_LAW_2K_SECONDS = 4 * (128 - 5 * Math.log2(REPORTED_DISTANCE_M / 2000)); // 467.4s = 7:47.4

  it("rowing projects on its own exponent (Paul's Law k=1.06), not running's tuned 1.08", () => {
    expect(benchmarkRiegelK("row")).toBe(1.06);
    expect(benchmarkRiegelK("row")).not.toBe(RIEGEL_K);
    // Ski is the same machine family and already scores on the rowing curve.
    expect(benchmarkRiegelK("ski")).toBe(1.06);
    // Running keeps the exponent its own regression suite is calibrated to.
    expect(benchmarkRiegelK("run")).toBe(RIEGEL_K);
    // Every benchmark sport has an explicit entry — no silent running default.
    expect(Object.keys(BENCHMARK_RIEGEL_K).sort()).toEqual(
      ["cycle", "row", "run", "ski", "swim", "walk"]
    );
  });

  it("2:08/500m for 40:00 projects to the ~7:47 2k Paul's Law implies, not the ~7:32 the running exponent produced", () => {
    const equivalent = computeSessionBenchmarkEquivalentSeconds(
      "row",
      REPORTED_DISTANCE_M,
      REPORTED_DURATION_S
    )!;
    // Within a second of the independent Paul's Law reference.
    expect(equivalent).toBeCloseTo(PAULS_LAW_2K_SECONDS, -0.5);
    expect(Math.abs(equivalent - PAULS_LAW_2K_SECONDS)).toBeLessThan(1.5);
    // And meaningfully slower than what the running exponent claimed (452.5s).
    expect(equivalent).toBeGreaterThan(462);
  });

  it("scores the reported effort as the club-standard piece it is, not a 95th-percentile 2k", () => {
    const bare = scoreCardioActivity({
      type: "row",
      benchmarkSport: "row",
      distanceMeters: REPORTED_DISTANCE_M,
      durationSeconds: REPORTED_DURATION_S,
      sex: "male",
      age: 30,
    });
    // ~7:47 2k sits between the 5th (8:06.9) and 20th (7:35.4) percentile
    // anchors of the Concept2 logbook population.
    expect(bare.score).toBeGreaterThan(125);
    expect(bare.score).toBeLessThan(250);
  });

  it("no easy/long HR-credit combination can push the reported effort back to 88.2", () => {
    // 88.2 display == 882 internal. Sweep the whole relative-effort credit
    // space this session could plausibly land in (every easy/recovery/long
    // tag, resting/max HR profile and avg HR) and assert the reported number
    // is unreachable — the credit stack, not one HR value, is what carried it
    // there before.
    let highest = 0;
    for (const restingHR of [45, 50, 55, 60, 65, 70]) {
      for (const maxHR of [180, 185, 190, 195, 200]) {
        for (let avgHR = 110; avgHR <= 180; avgHR += 5) {
          for (const sessionType of ["easy", "recovery", "long"] as const) {
            const result = scoreCardioActivity({
              type: "row",
              benchmarkSport: "row",
              distanceMeters: REPORTED_DISTANCE_M,
              durationSeconds: REPORTED_DURATION_S,
              sex: "male",
              age: 30,
              avgHR,
              restingHR,
              maxHR,
              sessionType,
            });
            highest = Math.max(highest, result.score);
          }
        }
      }
    }
    expect(highest).toBeLessThan(882);
    // And it stays below what a genuinely strong club 5k race (18:25) scores,
    // which is the cross-sport calibration reference this athlete trusts.
    const fiveK = scoreCardioActivity({
      type: "run",
      benchmarkSport: "run",
      distanceMeters: 5000,
      durationSeconds: 1105,
      sex: "male",
      age: 30,
      sessionType: "race",
    });
    expect(highest).toBeLessThan(fiveK.score);
  });
});
