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
 * Row uses sex-specific anchor tables rather than a single male curve plus a
 * generic female multiplier.
 *
 * The times below MOVED when the table was rebased onto the same reference
 * population as the run table (see ROW_2K_ANCHORS_MALE's doc comment). They
 * were Concept2-LOGBOOK percentiles — people who own an erg and upload
 * results — while run had already been rebased to the general population,
 * which left one shared 0-1000 ruler measuring two different populations.
 * The percentile CONVENTION (5/20/50/80/95/99 -> 125/250/475/725/850/925) is
 * unchanged; only which population those percentiles are taken over changed.
 */
describe("timeToScore — row (general-population anchors)", () => {
  it("matches the male percentile anchors", () => {
    expect(timeToScore("row", 401.0, "male")).toBeCloseTo(850, 0); // 6:41.0, 95th
    expect(timeToScore("row", 423.4, "male")).toBeCloseTo(725, 0); // 7:03.4, 80th
    expect(timeToScore("row", 483.1, "male")).toBeCloseTo(475, 0); // 8:03.1, 50th
    expect(timeToScore("row", 597.4, "male")).toBeCloseTo(125, 0); // 9:57.4, 5th
  });

  it("matches the female percentile anchors", () => {
    expect(timeToScore("row", 459.1, "female")).toBeCloseTo(850, 0); // 7:39.1, 95th
    expect(timeToScore("row", 496.3, "female")).toBeCloseTo(725, 0); // 8:16.3, 80th
    expect(timeToScore("row", 580.5, "female")).toBeCloseTo(475, 0); // 9:40.5, 50th
  });

  it("no longer lets a beginner (bottom 5%) score into Intermediate territory", () => {
    // A beginner rower's 2k should sit near the bottom of Beginner (125),
    // not Intermediate (the QA-flagged bug this corrects). Same assertion as
    // before the rebase; the bottom-5% time it is made against is now the
    // general population's 9:57.4 rather than the logbook's 8:06.9.
    expect(timeToScore("row", 597.4, "male")).toBeLessThan(250);
  });

  it("puts a runner and a rower of equal aerobic capacity on the same score", () => {
    // The whole point of the rebase, and the thing that was broken: one
    // athlete gets one Split Index across sports, so equal physiology has to
    // read as an equal score. ~45 mL/kg/min is a 21:45 5k on Daniels and a
    // ~7:03 2k on Concept2 power at an 80 kg male reference.
    expect(timeToScore("row", 423.4, "male")).toBeCloseTo(timeToScore("run", 1305, "male"), 0);
    // ...and at the median, where the old logbook table was worst: it scored
    // its median rower 475 against a runner who needed to be top-fifth.
    expect(timeToScore("row", 483.1, "male")).toBeCloseTo(timeToScore("run", 1800, "male"), 0);
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
    // The BAND moved with the anchor-table rebase, the claim did not. Read
    // against the Concept2 logbook this ~7:47 2k sat between that
    // population's 5th and 20th percentile (125-250). Read against the
    // general population — which is what the run table has measured since it
    // was rebased, and therefore what a shared 0-1000 ruler has to mean —
    // the same 2k sits between the median (8:03.1) and the 80th (7:03.4).
    // Both statements describe the identical performance; only the reference
    // population differs. What this test actually exists to pin is the top
    // end: it is not a 95th-percentile 2k, and it is nowhere near the 882 it
    // originally reported.
    expect(bare.score).toBeGreaterThan(timeToScore("row", 483.1, "male")); // faster than median
    expect(bare.score).toBeLessThan(timeToScore("row", 423.4, "male")); // slower than 80th
    expect(bare.score).toBeLessThan(850); // not 95th-percentile, which is the reported bug
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

/**
 * Reported bug, the other direction: "My rowing 6000m in 1:56 average split
 * scores 54.8, which is too low. This is not representative of the
 * performance of the row."
 *
 * 1:56/500m for 6,000m is 23:12 — a genuinely strong club piece, and a
 * harder effort than the 2:08/40:00 row above whose 88.2 prompted the
 * exponent fix. Both complaints were correct and they have DIFFERENT causes.
 * The exponent was not overcorrected (Paul's Law independently confirms
 * k=1.06 above, to within 1.5 seconds). What starved this row was the anchor
 * table: it was built on Concept2-logbook percentiles while the run table had
 * been rebased to the general population, so the same athlete's row and run
 * were being measured against different populations on one shared ruler.
 */
describe("row — reported 6,000m at 1:56/500m scored 54.8, too low", () => {
  const SIX_K_METERS = 6000;
  const SIX_K_SECONDS = 12 * 116; // 1:56/500m held for 6k = 23:12

  const sixK = (extra: Partial<Parameters<typeof scoreCardioActivity>[0]> = {}) =>
    scoreCardioActivity({
      type: "row",
      benchmarkSport: "row",
      distanceMeters: SIX_K_METERS,
      durationSeconds: SIX_K_SECONDS,
      sex: "male",
      age: 30,
      ...extra,
    });

  it("scores the piece as the strong club effort it is, not a below-median one", () => {
    // Was 403 bare / 548 as reported, against a median-2k anchor. The piece
    // projects to a ~7:14 2k, which is between the general population's 80th
    // percentile (7:03.4) and its median (8:03.1) — and much nearer the 80th.
    const bare = sixK().score;
    expect(bare).toBeGreaterThan(timeToScore("row", 483.1, "male")); // well clear of median
    expect(bare).toBeGreaterThan(600);
    // Still honestly short of the 80th-percentile anchor itself: a 23:12 6k
    // is a strong row, not a top-fifth 2k.
    expect(bare).toBeLessThan(timeToScore("row", 423.4, "male"));
  });

  it("lands in the same region as this athlete's trusted 18:25 5k, and below it", () => {
    // The cross-sport reference this athlete trusts. Below it is correct and
    // deliberate — bridged through aerobic capacity, a 23:12 6k at an 80 kg
    // male reference implies noticeably less than an 18:25 5k does, which is
    // the ordinary pattern for a runner on an erg. What was wrong before was
    // the SIZE of the gap: 403 vs 872 is not "a notch below", it is a
    // different athlete.
    const fiveK = scoreCardioActivity({
      type: "run",
      benchmarkSport: "run",
      distanceMeters: 5000,
      durationSeconds: 1105,
      sex: "male",
      age: 30,
      sessionType: "race",
    }).score;
    const withHR = sixK({ avgHR: 160 }).score;
    expect(withHR).toBeLessThan(fiveK);
    expect(fiveK - withHR).toBeLessThan(180);
  });

  it("orders rowing efforts against each other the way Riegel says they should", () => {
    const at = (meters: number, seconds: number) =>
      scoreCardioActivity({
        type: "row",
        benchmarkSport: "row",
        distanceMeters: meters,
        durationSeconds: seconds,
        sex: "male",
        age: 30,
      }).score;
    // Same 1:56 split held for longer is a better performance every time.
    const twoK = at(2000, 4 * 116);
    const sixKScore = at(SIX_K_METERS, SIX_K_SECONDS);
    const fortyMin = at((2400 / 116) * 500, 2400);
    expect(sixKScore).toBeGreaterThan(twoK);
    expect(fortyMin).toBeGreaterThan(sixKScore);
    // And at a fixed duration, a faster split always scores higher.
    expect(at((2400 / 116) * 500, 2400)).toBeGreaterThan(at((2400 / 124) * 500, 2400));
    expect(at((2400 / 124) * 500, 2400)).toBeGreaterThan(at((2400 / 128) * 500, 2400));
  });
});

/**
 * The relative-effort credit stack is capped in INDEX POINTS, not in percent
 * of time — see RELATIVE_EFFORT_CREDIT_KNEE_POINTS in cardio-activity.ts.
 * Percent-of-time is not portable across sports: the 20%-of-time cap is
 * worth a flat ~170-200 points anywhere on running's curve and up to ~630 on
 * rowing's, because erg pace goes as power^(-1/3) and so compresses the same
 * physiological range into a much narrower band of time.
 */
describe("row — relative-effort credit is capped in index points, not percent of time", () => {
  const rowSession = (sessionType: "easy" | "long" | null) =>
    scoreCardioActivity({
      type: "row",
      benchmarkSport: "row",
      distanceMeters: 6000,
      durationSeconds: 12 * 116,
      sex: "male",
      age: 30,
      sessionType,
    }).score;

  it("no longer lets a session type alone swing a row by hundreds of points", () => {
    const untagged = rowSession(null);
    // Before the points cap this identical session scored 403 untagged and
    // 872 tagged "long" — a 469-point swing bought by a dropdown, landing
    // exactly on what the athlete's real 18:25 5k scores.
    expect(rowSession("long") - untagged).toBeLessThan(280);
    expect(rowSession("easy") - untagged).toBeLessThan(280);
  });

  it("compresses credit without flattening it — more credit still scores higher", () => {
    // The failure mode a hard clip has, and the reason this taper is
    // logarithmic rather than an asymptote toward a ceiling: two sessions
    // that earned different credit must keep scoring differently, however
    // far past the knee they both are.
    const base = {
      type: "row" as const,
      benchmarkSport: "row" as const,
      distanceMeters: 7000,
      durationSeconds: 1800,
      sex: "male" as const,
      age: 30,
      sessionType: "easy" as const,
      restingHR: 50,
      maxHR: 207,
      avgHR: 152,
    };
    const corroborated = scoreCardioActivity({ ...base, easyEffortBaselinePaceSeconds: 420 }).score;
    const uncorroborated = scoreCardioActivity(base).score;
    expect(corroborated).toBeGreaterThan(uncorroborated);
  });

  it("leaves running untouched — the knee sits above what 20% of time is worth there", () => {
    // Running's 20%-of-time cap is worth at most +197 points anywhere on its
    // curve, and the knee is 200, so no running session reaches the taper.
    for (const durationSeconds of [1800, 3600, 5400]) {
      for (const distanceMeters of [6000, 10000, 15000, 20000]) {
        const result = scoreCardioActivity({
          type: "run",
          benchmarkSport: "run",
          distanceMeters,
          durationSeconds,
          sex: "male",
          age: 30,
          sessionType: "long",
          restingHR: 50,
          maxHR: 190,
          avgHR: 140,
        });
        expect(result.flags).not.toContain("relative-effort-points-compressed");
      }
    }
  });
});
