import { describe, expect, it } from "vitest";
import { timeToScore } from "./cardio-benchmarks";
import { benchmarkRiegelK, riegelEquivalentSeconds } from "./cardio-predictions";

/**
 * RE-ANCHORED (deliberately, not incidentally) when SWIM_400M_ANCHORS was
 * rebased from club/competitive swimmers onto the general population.
 *
 * This file previously asserted timeToScore("swim", 269.5) ≈ 925 and the rest
 * of the Swimming Regimen (swimmingregimen.com) percentile points. Those
 * numbers were not wrong as transcriptions — they are faithfully what that
 * source says. They were wrong as a REFERENCE POPULATION: they are pool-club
 * percentiles, putting the 5th percentile at 1:32.5/100m and the median at
 * 1:19.3/100m. Run and row have both since been rebased to the general
 * population, so the old swim table left one shared 0-1000 ruler measuring
 * club swimmers against ordinary runners.
 *
 * So the old assertions were pinning the defect, not guarding against it, and
 * they are replaced rather than adjusted. To make sure this file cannot
 * quietly pin the next population mismatch the same way, the anchor-value
 * test below is no longer the only thing here: the tests that follow it
 * assert the POPULATION-LEVEL INVARIANTS that the old table actually violated
 * (cross-sport agreement at matched percentiles, and an ordinary adult swim
 * not falling off the bottom of the table). Those hold for any correctly
 * based table and fail for a mis-based one, which raw anchor values do not.
 *
 * See SWIM_400M_ANCHORS in cardio-benchmarks.ts for the full derivation.
 */
describe("timeToScore — swim (general-population 400m anchors)", () => {
  it("matches the male percentile anchors", () => {
    // Re-anchored: these are the general-population 400m times, not the
    // club-swimmer times this file asserted before the rebase (shown for
    // each point so the size of the population shift stays visible).
    expect(timeToScore("swim", 320, "male")).toBeCloseTo(925, 0); // 5:20 — 1:20/100m — 99th (was 4:29.5)
    expect(timeToScore("swim", 360, "male")).toBeCloseTo(850, 0); // 6:00 — 1:30/100m — 95th (was 4:50.7)
    expect(timeToScore("swim", 440, "male")).toBeCloseTo(725, 0); // 7:20 — 1:50/100m — 80th (was 5:04.0)
    expect(timeToScore("swim", 560, "male")).toBeCloseTo(475, 0); // 9:20 — 2:20/100m — 50th (was 5:17.1)
    expect(timeToScore("swim", 760, "male")).toBeCloseTo(250, 0); // 12:40 — 3:10/100m — 20th (was 5:43.5)
    expect(timeToScore("swim", 960, "male")).toBeCloseTo(125, 0); // 16:00 — 4:00/100m — 5th (was 6:10.1)
  });

  /**
   * The invariant the old table broke. An athlete gets ONE Split Index across
   * sports, so the same percentile has to mean the same score in every sport.
   * The old club-percentile swim table failed this badly — its median 400m
   * (5:17.1) scored 475 while being a competitive age-grouper's swim, i.e. the
   * swim "median" was really somewhere near running's 99th percentile.
   */
  it("puts swim on the same ruler as run and row at matched percentiles", () => {
    // 50th percentile of each sport's own general population.
    expect(timeToScore("swim", 560, "male")).toBe(timeToScore("run", 1800, "male"));
    expect(timeToScore("swim", 560, "male")).toBe(timeToScore("row", 483.1, "male"));
    // 80th percentile of each.
    expect(timeToScore("swim", 440, "male")).toBe(timeToScore("run", 1305, "male"));
    expect(timeToScore("swim", 440, "male")).toBe(timeToScore("row", 423.4, "male"));
  });

  /**
   * The reported defect, locked. A 1000m swim in 46:00 (4:36/100m) is a slow
   * but entirely real adult swim, and it scored 0 — the old table was only
   * 1.373x wide from 5th to 99th percentile, so an ordinary swim fell off the
   * bottom of it and the extrapolation ran straight past zero.
   */
  it("does not zero out an ordinary adult swim", () => {
    const projected = riegelEquivalentSeconds(46 * 60, 1000, 400, benchmarkRiegelK("swim"));
    const score = timeToScore("swim", projected, "male");
    expect(score).toBeGreaterThan(0);
    // Still genuinely a low score — this swim IS slow. The fix is that it is
    // on the scale at all, not that it is flattered.
    expect(score).toBeLessThan(150);
  });

  it("keeps the table monotone: slower is never worth more", () => {
    const times = [320, 360, 440, 560, 760, 960, 1100];
    const scores = times.map((t) => timeToScore("swim", t, "male"));
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeLessThan(scores[i - 1]);
    }
  });

  /**
   * Where the table runs out is the single number that caused the reported
   * bug, so it is asserted directly rather than left implicit.
   *
   * The table is linear-extrapolated below its slowest anchor, so it does
   * eventually reach 0. On the OLD club-percentile anchors that happened at a
   * 400m-equivalent pace of 1:39/100m — a respectable fitness-swimmer pace, and
   * far faster than most adults who swim. Everyone slower than that scored
   * zero, which is exactly what was reported. On the rebased anchors it
   * happens at 4:50/100m, which is slower than a person can move through water
   * while swimming at all.
   */
  it("does not run out of scale until a pace nobody actually swims", () => {
    // 4:00/100m — a beginner with rests at the wall — is still on the scale.
    expect(timeToScore("swim", 960, "male")).toBeGreaterThan(100);
    // The old table's zero point (1:39/100m) must now be a solidly mid-table
    // score, not the bottom of the world.
    expect(timeToScore("swim", 397, "male")).toBeGreaterThan(775);
    // The floor sits beyond 4:45/100m.
    expect(timeToScore("swim", 1140, "male")).toBeGreaterThan(0);
  });

  it("scores women on their own curve, which narrows toward the elite end", () => {
    // Was a flat 1.073 multiplier. Swimming really does have the narrowest sex
    // gap of any sport in this file, but flat was still an assertion nobody had
    // checked — the world-record ratio is 1.065 and the middle of the adult
    // population sits nearer 1.14. See SWIM_400M_ANCHORS_FEMALE, including why
    // the bottom of the table is held flat rather than extrapolated.
    const male = timeToScore("swim", 320, "male");
    expect(timeToScore("swim", 320, "female")).toBeGreaterThan(male);
    // 1.065 at the fast anchor, ~1.14 at the median: the gap is NOT constant.
    expect(Math.abs(timeToScore("swim", 320 * 1.065, "female") - male)).toBeLessThanOrEqual(2);
    const medianMale = timeToScore("swim", 560, "male");
    expect(
      Math.abs(timeToScore("swim", 560 * 1.14, "female") - medianMale)
    ).toBeLessThanOrEqual(2);
  });

  it("999 is reserved for the actual 400m freestyle world record (user feedback: never achieved unless it's a world record for age/gender)", () => {
    expect(timeToScore("swim", 3 * 60 + 39.96, "male")).toBe(999); // Lukas Märtens 2025
    expect(timeToScore("swim", 3 * 60 + 45, "male")).toBeLessThan(999);
    expect(timeToScore("swim", 3 * 60 + 54.18, "female")).toBe(999); // Summer McIntosh 2025
    expect(timeToScore("swim", 4 * 60, "female")).toBeLessThan(999);
  });
});

/**
 * The same population defect, one layer up from the anchor table.
 *
 * BENCHMARK_RIEGEL_K.swim was 1.03 — Riegel's published swimming exponent,
 * which is an ELITE number: fitting current 400m->1500m freestyle world
 * records gives k = 1.041 (men) and 1.036 (women). Riegel's running exponent
 * is elite in exactly the same way, which is why this codebase does not use
 * it for running: run sits at 1.08, well above the ~1.03-1.05 that current
 * running world records fit, because real recreational runners decay over
 * distance much faster than record holders do.
 *
 * Swimming was left on the elite exponent while its anchor table was rebased
 * to the general population, so a general-population swimmer was being
 * projected with a record-holder's fatigue curve — under-crediting everyone
 * who swims beyond 400m, which is most people.
 */
describe("swim — session->benchmark Riegel exponent (general population, not elite)", () => {
  it("uses a general-population swim exponent, above the elite/world-record fit", () => {
    expect(benchmarkRiegelK("swim")).toBe(1.05);
    // Above what the actual 400->1500 freestyle world records fit...
    const eliteMen = Math.log(870.67 / 219.96) / Math.log(1500 / 400);
    expect(benchmarkRiegelK("swim")).toBeGreaterThan(eliteMen);
    // ...but still genuinely flatter than running, which is real: drag rises
    // with velocity squared, so a swimmer's pace decays less over distance
    // than a runner's. This ordering is the part that must not invert.
    expect(benchmarkRiegelK("swim")).toBeLessThan(benchmarkRiegelK("run"));
  });

  it("credits holding pace over a long swim, instead of treating distance as nearly free", () => {
    // An untrained swimmer holding 3:20/100m for 1500m is a much better
    // performance than holding it for 400m. On the old elite exponent that
    // was worth ~19 index points; it should be worth appreciably more.
    const k = benchmarkRiegelK("swim");
    const short = timeToScore("swim", riegelEquivalentSeconds(200 * 4, 400, 400, k), "male");
    const long = timeToScore("swim", riegelEquivalentSeconds((200 * 1500) / 100, 1500, 400, k), "male");
    expect(long - short).toBeGreaterThan(30);
  });
});
