import { describe, expect, it } from "vitest";
import {
  FEMALE_CARDIO_FACTORS,
  SKI_FROM_ROW_PACE,
  skiToRowEquivalentSeconds,
  timeToScore,
} from "./cardio-benchmarks";

/*
 * SkiErg, and the female factors, as behaviour rather than as constants.
 *
 * The registry milestone is "Swimming, cycling, SkiErg and female-athlete
 * scoring calibrated", and it was checked by testing that
 * `docs/pre-launch/calibration-data.md` exists. That document's own second
 * line reads "raw sourced research. No scoring decisions made here" — it is
 * the INPUT to the calibration, and it would sit there unchanged if every
 * anchor table were deleted.
 *
 * Two of the four named things then turned out to have no test at all:
 *
 *   SkiErg — the only assertions anywhere were `benchmarkRiegelK("ski")` and
 *   "ski is in the sport list". Nothing checked the row conversion, in either
 *   direction. `skiToRowEquivalentSeconds` DIVIDES by SKI_FROM_ROW_PACE;
 *   multiplying instead is a one-character change that still returns a
 *   plausible number, still scores every athlete, and quietly moves every
 *   SkiErg session by about 60 points in the wrong direction.
 *
 *   The female factors — swim and cycle each had one test, of the form
 *   "a woman's score at the same clock time is higher than a man's". That
 *   passes for a factor of 1.001 and for a factor of 1.5. It pins the sign
 *   and nothing else, and the sign was never the risk: the risk named in the
 *   source's own comment is reusing the running factor for everything, and
 *   1.152 is greater than 1.0 too.
 *
 * So these tests pin the factor VALUES by round-trip — a woman's equivalent
 * time must score exactly what the man's does — which fails for any factor
 * but the calibrated one.
 */

describe("SkiErg — scored through the rowing curve", () => {
  it("treats a ski time as equivalent to a FASTER row time", () => {
    /*
     * The direction that matters. SkiErg is roughly 10% less power than
     * RowErg for the same effort, so the same clock time is a HARDER effort
     * on the ski — it has to convert to a faster row-equivalent, not a
     * slower one. Multiplying instead of dividing inverts exactly this and
     * changes nothing else that any test looks at.
     */
    expect(skiToRowEquivalentSeconds(436)).toBeLessThan(436);
    expect(skiToRowEquivalentSeconds(436)).toBeCloseTo(436 / SKI_FROM_ROW_PACE, 6);
    expect(timeToScore("ski", 420, "male")).toBeGreaterThan(timeToScore("row", 420, "male"));
  });

  /*
   * There is deliberately NO assertion here that 7:16 ski scores what 7:00
   * row does, even though the constant's own comment says "Validated: 7:00
   * row ≈ 7:16 ski".
   *
   * That sentence is not a validation. 7:00 × 1.0357 = 7:14.9, so it restates
   * the constant rather than testing it, and `calibration-data.md` §3d says
   * the constant is wrong — the Concept2 logbook gives 1.045-1.059 for men,
   * not 1.0357. Asserting the round trip would pin the defect, which is
   * exactly the mistake `cardio-benchmarks-swim.test.ts` documents in its own
   * header. Whether the number is right belongs in
   * `scripts/check-cardio-calibration-sourced.mjs`, which compares it against
   * the research and currently fails.
   *
   * What is safe to assert here is everything that must hold whatever the
   * constant becomes: direction, monotonicity, and which female factor is
   * applied.
   */

  it("scores a whole range of ski times, strictly better for faster", () => {
    // A conversion that returned a constant, or fell off the end of the
    // table, would still produce a number for any single time.
    const times = [400, 440, 480, 520, 560];
    const scores = times.map((t) => timeToScore("ski", t, "male"));
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i], `${times[i]}s should score below ${times[i - 1]}s`).toBeLessThan(scores[i - 1]);
    }
    expect(Math.min(...scores)).toBeGreaterThan(0);
  });

  it("uses rowing's female factor, not running's", () => {
    /*
     * Ski has no sex-specific data of its own and deliberately inherits
     * rowing's 1.187 (same machine family). The documented mistake is
     * reaching for the running factor, and 1.152 is close enough to 1.187
     * that a "female scores higher" test cannot tell them apart. This can.
     */
    const male = timeToScore("ski", 480, "male");
    expect(timeToScore("ski", 480 * FEMALE_CARDIO_FACTORS.ski, "female")).toBe(male);
    expect(timeToScore("ski", 480 * FEMALE_CARDIO_FACTORS.run, "female")).not.toBe(male);
  });
});

/**
 * A mid-table time per sport — far from both the world-record ceiling and the
 * extrapolated tails, so the round-trip below tests the anchor tables rather
 * than the clamps at either end.
 */
const MID_TABLE: Record<"run" | "walk" | "swim" | "cycle" | "ski", number> = {
  run: 1800, // 30:00 5k
  walk: 400, // per-km pace
  swim: 560, // 9:20 400m
  cycle: 2400, // 40:00 20k
  ski: 480, // 8:00 2k
};

describe("female athletes — the factor applied is the calibrated one", () => {
  it.each(Object.entries(MID_TABLE) as [keyof typeof MID_TABLE, number][])(
    "%s: a woman's equivalent time scores exactly what the man's does",
    (sport, seconds) => {
      const factor = FEMALE_CARDIO_FACTORS[sport];
      expect(timeToScore(sport, seconds * factor, "female")).toBe(
        timeToScore(sport, seconds, "male"),
      );
    },
  );

  it.each(Object.entries(MID_TABLE) as [keyof typeof MID_TABLE, number][])(
    "%s: a different sport's factor gives a different answer",
    (sport, seconds) => {
      /*
       * The point of the round-trip above is that it is tight. This says so:
       * substituting another sport's factor must be visible.
       *
       * Swimming is the substitute because it is the outlier — 1.073 against
       * everything else's 1.15–1.22. Running's factor cannot be used here:
       * walk deliberately shares it ("mirrors running per instruction"), so
       * substituting it into walk is a no-op and the assertion would be
       * asserting nothing. Found by this test failing on walk when it was
       * written that way.
       */
      const wrong =
        sport === "swim" ? FEMALE_CARDIO_FACTORS.cycle : FEMALE_CARDIO_FACTORS.swim;
      expect(timeToScore(sport, seconds * wrong, "female")).not.toBe(
        timeToScore(sport, seconds, "male"),
      );
    },
  );

  it("keeps a distinct factor per sport rather than one number everywhere", () => {
    /*
     * The mistake the source's own comment names — "do not reuse the running
     * factor elsewhere" — flattens this table to a single number, and every
     * "a woman scores higher" test passes on a flattened table.
     *
     * No ordering is asserted. It is tempting to say swimming's gap is the
     * narrowest and cycling's the widest, which is what the constants
     * currently say; `calibration-data.md` §5 does not support it (its only
     * two sourced cycling ratios, 1.098 and 1.126, are NARROWER than
     * running's), so asserting it would pin the unsourced arrangement in
     * place. Walk is excluded because it mirrors run deliberately.
     */
    const sports = ["run", "swim", "cycle", "ski"] as const;
    const distinct = new Set(sports.map((s) => FEMALE_CARDIO_FACTORS[s]));
    /*
     * All four, not "more than one". Written first as `size > 2`, which
     * `scripts/mutation-check.mjs` immediately went through: setting cycle to
     * running's 1.152 still leaves three distinct values, and the round-trip
     * tests above cannot see it because they read the same constant they are
     * checking. A loose distinctness bound is the same decoration as a
     * "female scores higher" bound, one level up.
     */
    expect(distinct.size).toBe(sports.length);
  });

  it("scores rowing women off their own anchor table, not off the multiplier", () => {
    /*
     * Row is the exception: it has sex-specific percentile data, so
     * FEMALE_CARDIO_FACTORS.row is carried only for ski to inherit. If row
     * ever silently fell back to the single-curve-plus-multiplier path, the
     * first line here would start passing.
     */
    const male50th = timeToScore("row", 483.1, "male");
    expect(timeToScore("row", 483.1 * FEMALE_CARDIO_FACTORS.row, "female")).not.toBe(male50th);
    // Her own table's 50th percentile is 9:40.5, and it means the same thing
    // his 8:03.1 does.
    expect(timeToScore("row", 580.5, "female")).toBe(male50th);
  });
});
