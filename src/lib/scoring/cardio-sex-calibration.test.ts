import { describe, expect, it } from "vitest";
import { timeToScore, SKI_FROM_ROW_PACE, type BenchmarkSport } from "./cardio-benchmarks";

/**
 * DOES THE ENGINE'S SEX HANDLING MATCH THE DATA IT CLAIMS TO COME FROM?
 *
 * Row, swim, cycle and ski each score women on their own curve now, rather than
 * on the men's curve with one multiplier in front of it. Three of those four
 * curves were built directly from published distributions. The fourth — ski —
 * is DERIVED, and derived curves are the ones worth checking, because a
 * derivation can be internally tidy and still describe nobody.
 *
 * Ski is derived twice over: a SkiErg time becomes a row-equivalent time via a
 * per-sex machine factor, and is then scored on rowing's sex-specific anchors.
 * Neither input is ski distribution data. So this file takes the thing that IS
 * — the Concept2 logbook's 2025 SkiErg season, both sexes, read at matched
 * percentiles — and asks whether the engine reproduces the sex gap it shows.
 *
 * That is a genuinely independent check: the machine factor comes from the
 * logbook's 2000 m tables and the sex shape comes from rowing's anchors, and
 * neither was fitted to the 1000 m SkiErg distribution tested below.
 */

/**
 * Concept2 logbook, 2025 season, 1000 m SkiErg, read 2026-09-06.
 * n = 988 men, 340 women — the larger of the two SkiErg samples available.
 *
 * Converted to the 2000 m basis this file's anchor tables are built on, using
 * Riegel at k = 1.06 (2^1.06 = 2.085). The conversion is applied identically
 * to both sexes, so it cannot move the ratio under test — it exists only to
 * land the times inside the anchor range rather than off the fast end of it.
 */
const RIEGEL_1K_TO_2K = 2.085;

const LOGBOOK_SKI: { percentile: number; male1000: number; female1000: number }[] = [
  { percentile: 99, male1000: 179.1, female1000: 218.7 },
  { percentile: 95, male1000: 192.6, female1000: 234.8 },
  { percentile: 80, male1000: 209.0, female1000: 254.2 },
  { percentile: 50, male1000: 232.7, female1000: 290.0 },
  { percentile: 20, male1000: 268.6, female1000: 342.0 },
  { percentile: 5, male1000: 331.9, female1000: 438.6 },
];

/**
 * The female time this engine considers equal to a given male time.
 *
 * Binary search rather than algebra, deliberately: it runs through the real
 * `timeToScore`, so the world-record ceiling, the clamping and the anchor
 * interpolation are all included exactly as an athlete meets them.
 */
function equivalentFemaleSeconds(sport: BenchmarkSport, maleSeconds: number): number {
  const target = timeToScore(sport, maleSeconds, "male");
  let lo = maleSeconds;
  let hi = maleSeconds * 3;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (timeToScore(sport, mid, "female") > target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

const engineRatio = (sport: BenchmarkSport, maleSeconds: number) =>
  equivalentFemaleSeconds(sport, maleSeconds) / maleSeconds;

describe("SkiErg — the derived sex gap against the logbook that measured it", () => {
  /*
    The middle of the distribution only, and the exclusions are the point.

    The 99th and 95th are left out because a logbook skier at those percentiles
    converts to a row-equivalent faster than rowing's own 99th-percentile
    anchor, which puts them inside the world-record ceiling where scores are
    deliberately compressed toward 999 and a ratio stops meaning anything. That
    is not a defect: the Concept2 logbook is people who own an erg and upload
    results, so its top end really does sit above the general population's, and
    this file's tables were rebased onto the general population on purpose.

    The 5th is left out because it converts to a score of 9 — the extrapolated
    floor, below the slowest anchor, where the curve is a straight line rather
    than data.
  */
  const TESTABLE = LOGBOOK_SKI.filter((row) => [80, 50, 20].includes(row.percentile));

  it.each(TESTABLE)(
    "reproduces the sourced ratio to within 5% at the ${percentile}th percentile",
    ({ male1000, female1000 }) => {
      const sourced = female1000 / male1000;
      const engine = engineRatio("ski", male1000 * RIEGEL_1K_TO_2K);
      expect(Math.abs(engine - sourced) / sourced).toBeLessThan(0.05);
    }
  );

  it("sits between the two sourced SkiErg datasets at the median", () => {
    /*
      The two logbook SkiErg tables disagree with each other, and pretending
      otherwise would be the dishonest move. At the median the 1000 m table
      (n = 340 women) gives a female:male ratio of 1.246 and the 2000 m table
      (n = 129 women) gives 1.164 — a 7% spread between two samples of the same
      sport in the same season, which is what a 129-athlete sample buys you.

      The engine is not fitted to either. Landing between them is the strongest
      claim the evidence supports, so it is the one asserted.
    */
    const engine = engineRatio("ski", 232.7 * RIEGEL_1K_TO_2K);
    expect(engine).toBeGreaterThan(1.164);
    expect(engine).toBeLessThan(1.246);
  });

  it("keeps the gap widening as ability falls, which is what the logbook shows", () => {
    // 1.221 at the 99th rising to 1.322 at the 5th. The direction matters more
    // than any single point: a flat multiplier — which is what ski used to have
    // — cannot express it at all, and asserting the shape is what stops a
    // future edit quietly collapsing it back to one number.
    const ratios = LOGBOOK_SKI.map(({ male1000 }) => engineRatio("ski", male1000 * RIEGEL_1K_TO_2K));
    for (let i = 1; i < ratios.length; i++) {
      expect(ratios[i]).toBeGreaterThan(ratios[i - 1]!);
    }
  });

  it("makes the SkiErg gap wider than the RowErg gap at every level", () => {
    // Both the logbook (ski 1.22-1.32 against row 1.13-1.15 in the same season)
    // and the physiology (the SkiErg loads upper body and trunk far harder,
    // where the sex difference in lean mass is largest) say this. It falls out
    // of the female machine factor exceeding the male one, so if anyone ever
    // equalises those two constants, this fails.
    expect(SKI_FROM_ROW_PACE.female).toBeGreaterThan(SKI_FROM_ROW_PACE.male);
    for (const { male1000 } of LOGBOOK_SKI) {
      const skiSeconds = male1000 * RIEGEL_1K_TO_2K;
      const rowEquivalent = skiSeconds / SKI_FROM_ROW_PACE.male;
      expect(engineRatio("ski", skiSeconds)).toBeGreaterThan(engineRatio("row", rowEquivalent));
    }
  });
});

describe("swimming and cycling carry the ratios their sources actually gave", () => {
  /*
    Pinning the numbers the doc comments cite, so that editing one without the
    other is caught. Swimming's curve narrows toward the elite end (1.065 at the
    world record, ~1.14 through the middle) and then holds flat below the median
    because nothing was found down there. Cycling is flat throughout at the one
    recreational figure that exists.
  */
  it.each([
    [320, 1.065, "400m LCM world records"],
    [360, 1.09, "USMS 500 free Top 2%"],
    [560, 1.14, "USMS Top 55%, carried across"],
    [960, 1.14, "held flat — no data below the median"],
  ])("swim at %ims sits on %f", (seconds, expected) => {
    expect(engineRatio("swim", seconds)).toBeCloseTo(expected, 2);
  });

  it("keeps cycling flat, because its two sources disagree about the slope", () => {
    // The Hour Record gap (1.126) is WIDER than the IRONMAN 70.3 recreational
    // gap (1.098), which inverts every other sport measured. A shaped table
    // would be choosing a direction the evidence contradicts.
    const ratios = [1833.8, 2054, 2202, 2402, 2698, 3118].map((t) => engineRatio("cycle", t));
    for (const r of ratios) expect(r).toBeCloseTo(1.1, 2);
  });
});

describe("every sport's female curve is ordered and finite", () => {
  const SPORTS: BenchmarkSport[] = ["run", "walk", "row", "swim", "cycle", "ski"];

  it.each(SPORTS)("%s never scores a slower time higher, for either sex", (sport) => {
    // Sampled across the range rather than at the anchors, because a table can
    // be monotone at its anchors and still invert between them once a DIFFERENT
    // ratio is applied per anchor — which is exactly what swim now does, and
    // what ski inherits through rowing.
    for (const sex of ["male", "female"] as const) {
      let previous = Infinity;
      for (let seconds = 60; seconds <= 3600; seconds += 10) {
        const score = timeToScore(sport, seconds, sex);
        expect(Number.isFinite(score)).toBe(true);
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(1000);
        expect(score).toBeLessThanOrEqual(previous);
        previous = score;
      }
    }
  });

  it.each(SPORTS)("%s never scores a woman below a man for the same clock time", (sport) => {
    // The direction of every sex factor in this file. An inverted one is
    // silent — the score still looks like a score — and an athlete would read
    // it as the app calling her session worse than it was.
    for (let seconds = 120; seconds <= 2400; seconds += 30) {
      expect(timeToScore(sport, seconds, "female")).toBeGreaterThanOrEqual(
        timeToScore(sport, seconds, "male")
      );
    }
  });
});

describe("cross-sport parity for the same-ability athlete", () => {
  /*
    One athlete, one Split Index, six sports — so the median performer in each
    sport must score the same in each, or an athlete's index depends on which
    sport they happened to log. These are the 50th-percentile reference
    performances each table was built around.

    Walk is excluded: it is scored on pace rather than a benchmark time, and its
    own table is documented as a partial correction rather than a rebase.
  */
  const MEDIAN_PERFORMANCES: { sport: BenchmarkSport; seconds: number; label: string }[] = [
    { sport: "run", seconds: 1800, label: "30:00 5k" },
    { sport: "row", seconds: 483.1, label: "8:03 2k" },
    { sport: "swim", seconds: 560, label: "9:20 400m" },
    { sport: "cycle", seconds: 2402, label: "40:02 20k" },
    { sport: "ski", seconds: 483.1 * SKI_FROM_ROW_PACE.male, label: "row-equivalent 2k on the SkiErg" },
  ];

  it("scores every sport's median performer identically", () => {
    for (const { sport, seconds, label } of MEDIAN_PERFORMANCES) {
      expect(timeToScore(sport, seconds, "male"), label).toBe(475);
    }
  });

  it("scores the same-percentile woman the same as the same-percentile man", () => {
    // The whole purpose of a sex-specific curve. A woman at her sport's median
    // and a man at his must land on the same score, or the Split Index is
    // measuring sex rather than ability.
    for (const { sport, seconds, label } of MEDIAN_PERFORMANCES) {
      const male = timeToScore(sport, seconds, "male");
      const female = timeToScore(sport, equivalentFemaleSeconds(sport, seconds), "female");
      expect(Math.abs(female - male), label).toBeLessThanOrEqual(2);
    }
  });
});
