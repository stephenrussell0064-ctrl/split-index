import { describe, expect, it } from "vitest";
import {
  scoreCardioActivity,
  type CardioInput,
  type RecentCardioSession,
} from "./cardio-activity";
import {
  computeFitnessEquivalent,
  effortTimeRatio,
  effortFractionFromHeartRate,
  effortFractionFromRpe,
  bodyweightTimeFactor,
  elevationTimeFraction,
  temperatureTimeFraction,
  BENCHMARK_EFFORT_FRACTION,
  EFFORT_CREDIT_MEASURED_TO,
  EFFORT_CREDIT_TAPER,
  effortTimeExponent,
} from "./cardio/fitness-equivalent";
import {
  personalScoreFromDelta,
  weightedMedian,
  buildPersonalBaseline,
  CARDIO_PERSONAL_SLOPE,
  PERSONAL_SCORE_CENTER,
} from "./personal-score";

/**
 * The reported defect, as a test.
 *
 * "Why does the engine score runs always 80+ with very little movement per
 * run? Even if it is visibly worse for me — a more elevated heart rate, or a
 * slower split over a given distance at a certain heart rate — I still score
 * around the same."
 *
 * Measured on the old engine, one athlete, 8 km tagged easy, resting 55 /
 * max 190, with a 19:30 5 k ceiling and four prior easy scores around 810:
 *
 *   140 bpm @ 5:20/km              780
 *   145 bpm @ 5:20/km              780   <- identical
 *   157 bpm @ 5:20/km              723
 *   165 bpm @ 5:20/km              723   <- identical
 *   145 bpm @ 5:40/km              723   <- identical to a 20 bpm swing
 *   155 bpm @ 5:50/km              691
 *   160 bpm @ 6:10/km              691   <- identical
 *
 * Seven visibly different sessions, three distinct numbers, every one of them
 * a cap or a floor binding. These tests pin the properties whose absence
 * produced that.
 */
const ATHLETE = {
  type: "run" as const,
  benchmarkSport: "run" as const,
  sex: "male" as const,
  age: 30,
  restingHR: 55,
  maxHR: 190,
  startedAt: "2026-06-01T07:00:00Z",
};

function easyRun(paceSecPerKm: number, avgHR: number | undefined, extra: Partial<CardioInput> = {}) {
  return scoreCardioActivity({
    ...ATHLETE,
    distanceMeters: 8000,
    durationSeconds: 8 * paceSecPerKm,
    avgHR,
    sessionType: "easy",
    ...extra,
  });
}

describe("the reported defect: distinct sessions must produce distinct scores", () => {
  it("separates every one of the seven sessions that used to collapse onto three numbers", () => {
    const sessions: Array<[label: string, pace: number, hr: number]> = [
      ["good day", 320, 140],
      ["normal", 320, 145],
      ["+12 bpm, same pace", 320, 157],
      ["+20 bpm, same pace", 320, 165],
      ["20 s/km slower, same HR", 340, 145],
      ["30 s/km slower, +10 bpm", 350, 155],
      ["50 s/km slower, +15 bpm", 370, 160],
    ];
    const scores = sessions.map(([, pace, hr]) => easyRun(pace, hr).score);
    expect(new Set(scores).size).toBe(sessions.length);
  });

  it("orders them worst-to-best exactly as the athlete would", () => {
    const better = easyRun(320, 140).score;
    const normal = easyRun(320, 145).score;
    const higherHr = easyRun(320, 157).score;
    const slower = easyRun(340, 145).score;
    const worst = easyRun(370, 160).score;

    expect(better).toBeGreaterThan(normal);
    expect(normal).toBeGreaterThan(higherHr);
    expect(normal).toBeGreaterThan(slower);
    expect(worst).toBeLessThan(higherHr);
    expect(worst).toBeLessThan(slower);
  });

  it("moves both scores for a meaningful change in the session, the personal one most", () => {
    // Where the movement the athlete asked for actually comes from, and why
    // there are two numbers rather than one.
    //
    // 25 bpm at the same pace moves the POPULATION score modestly: it should,
    // because the athlete's standing against everyone else genuinely does not
    // swing much between a good easy run and a mediocre one — both are
    // mid-pack 5 k-equivalent performances, and the general-population run
    // table is deliberately shallow through its middle.
    //
    // It moves the PERSONAL score a lot, because against this athlete's own
    // recent form that same session is plainly a bad day. The old engine had
    // only the first number and tried to make it do both jobs, which is how
    // it ended up with a floor, a ceiling and five capped credits fighting
    // each other over the same 60 points.
    const history: RecentCardioSession[] = Array.from({ length: 5 }, (_, i) => ({
      distanceMeters: 8000,
      durationSeconds: 8 * 320,
      avgHR: 145,
      startedAt: new Date(
        Date.parse(ATHLETE.startedAt) - (i + 1) * 4 * 86_400_000
      ).toISOString(),
    }));
    const good = easyRun(320, 140, { recentSessions: history });
    const bad = easyRun(320, 165, { recentSessions: history });

    expect(good.score - bad.score).toBeGreaterThan(25);
    expect(good.personalScore! - bad.personalScore!).toBeGreaterThan(120);
  });

  it("has no plateau: never ties across a real difference in effort, only across rounding", () => {
    // The old defect was a 20 bpm range and a 50 s/km range each landing on
    // one number, because a cap or a floor was binding across both. Nothing
    // binds now, so the only ties left are the ones integer rounding forces:
    // the population score is monotone at 1 bpm and strictly separated by 5.
    const oneBpmApart = [138, 139, 140, 141, 142, 143, 144, 145].map((hr) => easyRun(320, hr).score);
    for (let i = 1; i < oneBpmApart.length; i++) {
      expect(oneBpmApart[i]).toBeLessThanOrEqual(oneBpmApart[i - 1]);
    }
    const fiveBpmApart = [140, 145, 150, 155, 160, 165].map((hr) => easyRun(320, hr).score);
    for (let i = 1; i < fiveBpmApart.length; i++) {
      expect(fiveBpmApart[i]).toBeLessThan(fiveBpmApart[i - 1]);
    }
  });

  it("resolves a single beat per minute on the personal score, which is the one the athlete watches", () => {
    const history: RecentCardioSession[] = Array.from({ length: 5 }, (_, i) => ({
      distanceMeters: 8000,
      durationSeconds: 8 * 320,
      avgHR: 145,
      startedAt: new Date(
        Date.parse(ATHLETE.startedAt) - (i + 1) * 4 * 86_400_000
      ).toISOString(),
    }));
    const scores = [138, 139, 140, 141, 142, 143, 144, 145].map(
      (hr) => easyRun(320, hr, { recentSessions: history }).personalScore!
    );
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeLessThan(scores[i - 1]);
    }
  });

  it("resolves a one-second-per-kilometre change of pace", () => {
    const scores = [318, 319, 320, 321, 322].map((pace) => easyRun(pace, 145).score);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeLessThan(scores[i - 1]);
    }
  });
});

describe("the session-type tag is not read by either score", () => {
  const tags = ["easy", "recovery", "long", "tempo", "threshold", "race", "other", null] as const;

  it("scores an identical session identically under every tag", () => {
    const scores = tags.map(
      (sessionType) =>
        scoreCardioActivity({
          ...ATHLETE,
          distanceMeters: 8000,
          durationSeconds: 2560,
          avgHR: 150,
          sessionType,
        }).score
    );
    expect(new Set(scores).size).toBe(1);
  });

  it("gives the same personal score under every tag, history included", () => {
    const history: RecentCardioSession[] = Array.from({ length: 5 }, (_, i) => ({
      distanceMeters: 8000,
      durationSeconds: 2600,
      avgHR: 150,
      startedAt: new Date(Date.parse(ATHLETE.startedAt) - (i + 1) * 4 * 86_400_000).toISOString(),
    }));
    const scores = tags.map(
      (sessionType) =>
        scoreCardioActivity({
          ...ATHLETE,
          distanceMeters: 8000,
          durationSeconds: 2560,
          avgHR: 150,
          sessionType,
          recentSessions: history,
        }).personalScore
    );
    expect(new Set(scores).size).toBe(1);
    expect(scores[0]).not.toBeNull();
  });
});

describe("effort scaling", () => {
  it("credits a sub-maximal effort and never penalises a maximal one", () => {
    const benchmark = BENCHMARK_EFFORT_FRACTION.run;
    expect(effortTimeRatio(benchmark, benchmark, "run")).toBe(1);
    expect(effortTimeRatio(benchmark + 0.1, benchmark, "run")).toBe(1); // above benchmark intensity: no penalty
    expect(effortTimeRatio(benchmark - 0.2, benchmark, "run")).toBeGreaterThan(1);
  });

  it("keeps rising forever — two very easy sessions never converge on one number", () => {
    const benchmark = BENCHMARK_EFFORT_FRACTION.run;
    const ratios = [0.75, 0.65, 0.55, 0.45, 0.35, 0.3].map((f) => effortTimeRatio(f, benchmark, "run"));
    for (let i = 1; i < ratios.length; i++) {
      expect(ratios[i]).toBeGreaterThan(ratios[i - 1]);
    }
  });

  it("does not cap anything inside the range Daniels actually measured", () => {
    // The old 18% asymptote bound at a gap of 1.2, overriding real data with
    // a smaller number and putting a hard ceiling on easy runs. Through the
    // measured range the credit is now exactly what the physiology says.
    const benchmark = BENCHMARK_EFFORT_FRACTION.run;
    for (const gap of [1.1, 1.25, 1.4, 1.5]) {
      const observed = benchmark / gap;
      const uncapped = Math.pow(gap, 1 / effortTimeExponent("run", gap));
      expect(effortTimeRatio(observed, benchmark, "run")).toBeCloseTo(uncapped, 6);
    }
    // At Daniels' easiest tabulated point an easy run reads about 33% off 5k
    // pace, which is where his own table puts it.
    const atDaniels = effortTimeRatio(benchmark / 1.46, benchmark, "run");
    expect(atDaniels).toBeGreaterThan(1.3);
    expect(atDaniels).toBeLessThan(1.37);
  });

  it("tapers only past the measured range, and says so through confidence", () => {
    const benchmark = BENCHMARK_EFFORT_FRACTION.run;
    const farBeyond = effortTimeRatio(benchmark / 2.6, benchmark, "run");
    const uncappedFarBeyond = Math.pow(2.6, 1 / effortTimeExponent("run", 2.6));
    expect(farBeyond).toBeLessThan(uncappedFarBeyond);
    // Never past the knee plus its whole taper allowance.
    const ceiling = Math.pow(
      EFFORT_CREDIT_MEASURED_TO + EFFORT_CREDIT_TAPER,
      1 / effortTimeExponent("run", 99)
    );
    expect(farBeyond).toBeLessThan(ceiling);
  });

  it("buys far less pace on an erg than on the road for the same intensity gap — power goes as v cubed", () => {
    const gapFromBenchmark = (sport: "run" | "row") =>
      effortTimeRatio(BENCHMARK_EFFORT_FRACTION[sport] - 0.15, BENCHMARK_EFFORT_FRACTION[sport], sport);
    const road = gapFromBenchmark("run");
    const erg = gapFromBenchmark("row");
    expect(erg).toBeGreaterThan(1);
    expect(erg).toBeLessThan(road);
    // Concretely: the erg credit is the cube root of the intensity credit,
    // so it can never exceed ~7.7% of time however easy the piece was.
    // Rowing's band is 214 seconds wide against running's 1,920, so a few
    // percent is worth hundreds of points there and the credit is damped much
    // sooner. See DRAG_LIMITED_CREDIT_MEASURED_TO.
    expect(effortTimeRatio(0.2, BENCHMARK_EFFORT_FRACTION.row, "row")).toBeLessThan(1.18);
  });

  it("eases the running exponent as the gap widens, and holds it flat at race-pace gaps", () => {
    // Daniels' own table implies this shape: easing off buys proportionally
    // more pace the further below race intensity you already are.
    // Near race pace the curve starts at 2.2 and eases away only gradually,
    // so a tempo or threshold effort is left essentially where it was — that
    // end is anchored on this athlete's own validated 6 km tempo.
    expect(effortTimeExponent("run", 1.0)).toBeCloseTo(2.2, 5);
    expect(effortTimeExponent("run", 1.13)).toBeGreaterThan(2.0);
    expect(effortTimeExponent("run", 1.35)).toBeLessThan(2.2);
    expect(effortTimeExponent("run", 1.6)).toBeCloseTo(1.3, 5);
    expect(effortTimeExponent("run", 3)).toBeCloseTo(1.3, 5); // floored, never steeper
    // The drag-limited sports do not vary: the cube law has no opinion on gap.
    for (const sport of ["row", "ski", "swim", "cycle"] as const) {
      expect(effortTimeExponent(sport, 1.05)).toBe(3);
      expect(effortTimeExponent(sport, 1.9)).toBe(3);
    }
  });

  it("reads heart rate as a fraction of this athlete's own reserve, not an absolute bpm", () => {
    // Two athletes, same absolute HR, very different reserves — the one for
    // whom 150 bpm is easy must be credited more than the one for whom it is
    // near the ceiling.
    const lowReserve = effortFractionFromHeartRate(150, 70, 175)!;
    const highReserve = effortFractionFromHeartRate(150, 45, 200)!;
    expect(highReserve).toBeLessThan(lowReserve);
  });

  it("falls back to RPE when there is no heart rate, and says so", () => {
    const withRpe = scoreCardioActivity({
      ...ATHLETE,
      distanceMeters: 8000,
      durationSeconds: 2560,
      rpe: 4,
    });
    const withoutAnything = scoreCardioActivity({
      ...ATHLETE,
      distanceMeters: 8000,
      durationSeconds: 2560,
    });
    expect(withRpe.flags).toContain("effort-from-rpe");
    expect(withoutAnything.flags).toContain("effort-not-scaled");
    // An RPE 4 session is well below a maximal effort, so it implies a faster
    // maximal one — it must score above the unscaled reading of the same run.
    expect(withRpe.score).toBeGreaterThan(withoutAnything.score);
    // ...and be less confident about it than a measured heart rate would be.
    const withHr = scoreCardioActivity({
      ...ATHLETE,
      distanceMeters: 8000,
      durationSeconds: 2560,
      avgHR: 145,
    });
    expect(withRpe.confidence).toBeLessThan(withHr.confidence);
  });

  it("orders RPE monotonically — a harder-felt session at the same pace is worth less", () => {
    const scores = [3, 4, 5, 6, 7, 8].map(
      (rpe) =>
        scoreCardioActivity({
          ...ATHLETE,
          distanceMeters: 8000,
          durationSeconds: 2560,
          rpe,
        }).score
    );
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeLessThan(scores[i - 1]);
    }
  });

  it("prefers heart rate over RPE when both are present", () => {
    const both = scoreCardioActivity({
      ...ATHLETE,
      distanceMeters: 8000,
      durationSeconds: 2560,
      avgHR: 145,
      rpe: 9,
    });
    const hrOnly = scoreCardioActivity({
      ...ATHLETE,
      distanceMeters: 8000,
      durationSeconds: 2560,
      avgHR: 145,
    });
    expect(both.score).toBe(hrOnly.score);
    expect(both.flags).toContain("effort-from-hr");
  });

  it("flags a long extrapolation and discounts its confidence", () => {
    const deepEasy = easyRun(400, 110);
    const nearThreshold = easyRun(300, 170);
    expect(deepEasy.flags).toContain("effort-credit-extrapolated");
    expect(nearThreshold.flags).not.toContain("effort-credit-extrapolated");
    expect(deepEasy.confidence).toBeLessThan(nearThreshold.confidence);
  });

  it("does not effort-scale walking — a stroll is not evidence of a fast benchmark walk", () => {
    const slowHr = scoreCardioActivity({
      type: "run",
      benchmarkSport: "walk",
      distanceMeters: 4000,
      durationSeconds: 2400,
      sex: "male",
      age: 30,
      restingHR: 55,
      maxHR: 190,
      avgHR: 95,
    });
    const higherHr = scoreCardioActivity({
      type: "run",
      benchmarkSport: "walk",
      distanceMeters: 4000,
      durationSeconds: 2400,
      sex: "male",
      age: 30,
      restingHR: 55,
      maxHR: 190,
      avgHR: 135,
    });
    expect(slowHr.score).toBe(higherHr.score);
    expect(slowHr.flags).toContain("effort-not-scaled");
  });
});

describe("conditions: terrain, weather, bodyweight", () => {
  it("credits climbing, proportionally to the climb rate and never unboundedly", () => {
    const flat = easyRun(320, 150, { elevationMeters: 0 });
    const rolling = easyRun(320, 150, { elevationMeters: 80 });
    const hilly = easyRun(320, 150, { elevationMeters: 240 });
    const mountain = easyRun(320, 150, { elevationMeters: 1200 });
    expect(rolling.score).toBeGreaterThan(flat.score);
    expect(hilly.score).toBeGreaterThan(rolling.score);
    expect(mountain.score).toBeGreaterThan(hilly.score);
    // Saturating, so each further metre of climb is worth less than the last.
    // Asserted on the time fraction, which is where the saturation lives: the
    // anchor table is not linear in time, so the same fraction is worth a
    // different number of POINTS depending on where on the curve it lands.
    const perMetre = [80, 240, 1200].map((m) => elevationTimeFraction("run", m, 8000) / m);
    for (let i = 1; i < perMetre.length; i++) {
      expect(perMetre[i]).toBeLessThan(perMetre[i - 1]);
    }
    expect(elevationTimeFraction("run", 100000, 8000)).toBeLessThanOrEqual(0.2);
  });

  it("credits heat and cold, and treats a comfortable day as neutral", () => {
    const comfortable = easyRun(320, 150, { temperatureCelsius: 10 });
    const hot = easyRun(320, 150, { temperatureCelsius: 30 });
    const freezing = easyRun(320, 150, { temperatureCelsius: -5 });
    expect(hot.score).toBeGreaterThan(comfortable.score);
    expect(freezing.score).toBeGreaterThan(comfortable.score);
    expect(temperatureTimeFraction("run", 10)).toBe(0);
  });

  it("applies terrain and weather to the score itself, not just executionScore", () => {
    const flatCool = easyRun(320, 150, { elevationMeters: 0, temperatureCelsius: 10 });
    const hillyHot = easyRun(320, 150, { elevationMeters: 300, temperatureCelsius: 30 });
    expect(hillyHot.score).toBeGreaterThan(flatCool.score);
    expect(hillyHot.adjustments!.elevationFraction).toBeGreaterThan(0);
    expect(hillyHot.adjustments!.temperatureFraction).toBeGreaterThan(0);
  });

  it("has no terrain or weather adjustment for indoor sports", () => {
    expect(elevationTimeFraction("row", 500, 6000)).toBe(0);
    expect(elevationTimeFraction("swim", 500, 2000)).toBe(0);
    expect(temperatureTimeFraction("row", 35)).toBe(0);
  });

  it("weight-adjusts erg times and leaves road sports alone", () => {
    expect(bodyweightTimeFactor("row", 95, "male")).toBeGreaterThan(1);
    expect(bodyweightTimeFactor("row", 65, "male")).toBeLessThan(1);
    expect(bodyweightTimeFactor("row", 80, "male")).toBeCloseTo(1, 6);
    expect(bodyweightTimeFactor("run", 95, "male")).toBe(1);
    expect(bodyweightTimeFactor("swim", 95, "male")).toBe(1);

    const heavy = scoreCardioActivity({
      type: "row",
      benchmarkSport: "row",
      distanceMeters: 2000,
      durationSeconds: 440,
      sex: "male",
      age: 30,
      bodyweightKg: 60,
    });
    const light = scoreCardioActivity({
      type: "row",
      benchmarkSport: "row",
      distanceMeters: 2000,
      durationSeconds: 440,
      sex: "male",
      age: 30,
      bodyweightKg: 100,
    });
    // The same 2 k from a 60 kg athlete is the better performance.
    expect(heavy.score).toBeGreaterThan(light.score);
  });
});

describe("the personal score", () => {
  const anchorMs = Date.parse(ATHLETE.startedAt);
  const historyOf = (
    entries: Array<{ pace: number; hr?: number; daysAgo: number; rpe?: number }>
  ): RecentCardioSession[] =>
    entries.map((e) => ({
      distanceMeters: 8000,
      durationSeconds: 8 * e.pace,
      avgHR: e.hr,
      rpe: e.rpe,
      startedAt: new Date(anchorMs - e.daysAgo * 86_400_000).toISOString(),
    }));

  const normalHistory = historyOf([
    { pace: 320, hr: 145, daysAgo: 3 },
    { pace: 322, hr: 146, daysAgo: 7 },
    { pace: 318, hr: 144, daysAgo: 11 },
    { pace: 325, hr: 147, daysAgo: 15 },
    { pace: 319, hr: 145, daysAgo: 20 },
  ]);

  it("reads an average session as roughly 500", () => {
    const result = easyRun(320, 145, { recentSessions: normalHistory });
    expect(result.personalScore).not.toBeNull();
    expect(Math.abs(result.personalScore! - PERSONAL_SCORE_CENTER)).toBeLessThan(40);
  });

  it("reads a better-than-usual session above 500 and a worse one below", () => {
    const better = easyRun(310, 142, { recentSessions: normalHistory }).personalScore!;
    const worse = easyRun(340, 158, { recentSessions: normalHistory }).personalScore!;
    expect(better).toBeGreaterThan(PERSONAL_SCORE_CENTER);
    expect(worse).toBeLessThan(PERSONAL_SCORE_CENTER);
  });

  it("is null until there is enough history to compare against", () => {
    expect(easyRun(320, 145).personalScore).toBeNull();
    expect(easyRun(320, 145, { recentSessions: normalHistory.slice(0, 2) }).personalScore).toBeNull();
    expect(easyRun(320, 145, { recentSessions: normalHistory.slice(0, 3) }).personalScore).not.toBeNull();
    expect(easyRun(320, 145).flags).toContain("personal-calibrating");
  });

  it("moves in step with the population score for the same session", () => {
    const paces = [300, 310, 320, 330, 340, 350];
    const population = paces.map((p) => easyRun(p, 145, { recentSessions: normalHistory }).score);
    const personal = paces.map(
      (p) => easyRun(p, 145, { recentSessions: normalHistory }).personalScore!
    );
    for (let i = 1; i < paces.length; i++) {
      expect(population[i]).toBeLessThanOrEqual(population[i - 1]);
      expect(personal[i]).toBeLessThan(personal[i - 1]);
    }
  });

  it("weights recent form over old form", () => {
    // Identical session; one athlete's fast sessions are recent, the other's
    // are months-old. The athlete who has been fast lately has a harder bar.
    const fastRecently = historyOf([
      { pace: 300, hr: 145, daysAgo: 3 },
      { pace: 302, hr: 145, daysAgo: 6 },
      { pace: 301, hr: 145, daysAgo: 9 },
      { pace: 340, hr: 145, daysAgo: 70 },
      { pace: 342, hr: 145, daysAgo: 80 },
    ]);
    const fastLongAgo = historyOf([
      { pace: 340, hr: 145, daysAgo: 3 },
      { pace: 342, hr: 145, daysAgo: 6 },
      { pace: 341, hr: 145, daysAgo: 9 },
      { pace: 300, hr: 145, daysAgo: 70 },
      { pace: 302, hr: 145, daysAgo: 80 },
    ]);
    const a = easyRun(320, 145, { recentSessions: fastRecently }).personalScore!;
    const b = easyRun(320, 145, { recentSessions: fastLongAgo }).personalScore!;
    expect(a).toBeLessThan(b);
  });

  it("is not derailed by one outlier session", () => {
    const withOutlier = [
      ...normalHistory,
      // A mis-logged session: 8 km in 12 minutes.
      { distanceMeters: 8000, durationSeconds: 720, avgHR: 145, startedAt: new Date(anchorMs - 5 * 86_400_000).toISOString() },
    ];
    const clean = easyRun(320, 145, { recentSessions: normalHistory }).personalScore!;
    const dirty = easyRun(320, 145, { recentSessions: withOutlier }).personalScore!;
    expect(Math.abs(dirty - clean)).toBeLessThan(60);
  });

  it("ignores sessions outside the window and sessions logged after this one", () => {
    const stale = historyOf([
      { pace: 320, hr: 145, daysAgo: 200 },
      { pace: 322, hr: 145, daysAgo: 210 },
      { pace: 318, hr: 145, daysAgo: 220 },
    ]);
    expect(easyRun(320, 145, { recentSessions: stale }).personalScore).toBeNull();

    const future = historyOf([
      { pace: 320, hr: 145, daysAgo: -3 },
      { pace: 322, hr: 145, daysAgo: -7 },
      { pace: 318, hr: 145, daysAgo: -11 },
    ]);
    expect(easyRun(320, 145, { recentSessions: future }).personalScore).toBeNull();
  });

  it("compares like with like — an HR-less session is not judged against HR-read ones", () => {
    const hrLessHistory = historyOf([
      { pace: 320, daysAgo: 3 },
      { pace: 322, daysAgo: 7 },
      { pace: 318, daysAgo: 11 },
    ]);
    const mixed = [...normalHistory, ...hrLessHistory];
    const result = easyRun(320, undefined, { recentSessions: mixed });
    expect(result.personal!.comparedWith).toBe("effort-matched");
    // An HR-less session read against HR-read history would look like a
    // collapse in form; matched against its own kind it reads as normal.
    expect(Math.abs(result.personalScore! - PERSONAL_SCORE_CENTER)).toBeLessThan(40);
  });

  it("falls back to pace against pace rather than comparing two different quantities", () => {
    // The athlete wears a strap most days and forgot it today. Comparing this
    // session's uncredited equivalent against heart-rate-credited ones reads
    // an ordinary run as a collapse in form — it scored 259 against a norm of
    // 500 before this fallback existed, purely for the missing strap.
    const result = easyRun(320, undefined, { recentSessions: normalHistory });
    expect(result.personalScore).not.toBeNull();
    expect(result.personal!.comparedWith).toBe("pace-only");
    expect(result.flags).toContain("personal-baseline-pace-only");
    // Same pace as the athlete's norm, so it should read as normal.
    expect(Math.abs(result.personalScore! - PERSONAL_SCORE_CENTER)).toBeLessThan(40);
  });

  it("still ranks HR-less sessions against each other on pace", () => {
    const faster = easyRun(300, undefined, { recentSessions: normalHistory }).personalScore!;
    const normal = easyRun(320, undefined, { recentSessions: normalHistory }).personalScore!;
    const slower = easyRun(345, undefined, { recentSessions: normalHistory }).personalScore!;
    expect(faster).toBeGreaterThan(normal);
    expect(normal).toBeGreaterThan(slower);
  });

  it("flags a personal best", () => {
    const breakthrough = easyRun(280, 140, { recentSessions: normalHistory });
    expect(breakthrough.flags).toContain("personal-best");
    expect(easyRun(330, 150, { recentSessions: normalHistory }).flags).not.toContain("personal-best");
  });

  it("reports what it compared against, so the number can be explained", () => {
    const result = easyRun(320, 145, { recentSessions: normalHistory });
    expect(result.personal!.sampleCount).toBe(5);
    expect(result.personal!.baselineEquivalentSeconds).toBeGreaterThan(0);
    expect(result.personal!.bestEquivalentSeconds).toBeLessThanOrEqual(
      result.personal!.baselineEquivalentSeconds
    );
    expect(typeof result.personal!.deltaPct).toBe("number");
  });
});

describe("personal-score mechanics", () => {
  it("is centred, symmetric and saturating", () => {
    expect(personalScoreFromDelta(0, CARDIO_PERSONAL_SLOPE)).toBe(PERSONAL_SCORE_CENTER);
    const up = personalScoreFromDelta(0.03, CARDIO_PERSONAL_SLOPE) - PERSONAL_SCORE_CENTER;
    const down = PERSONAL_SCORE_CENTER - personalScoreFromDelta(-0.03, CARDIO_PERSONAL_SLOPE);
    expect(up).toBe(down);
    // Strictly increasing forever: a bigger breakthrough always scores higher.
    const big = personalScoreFromDelta(0.2, CARDIO_PERSONAL_SLOPE);
    const bigger = personalScoreFromDelta(0.3, CARDIO_PERSONAL_SLOPE);
    expect(bigger).toBeGreaterThan(big);
    expect(bigger).toBeLessThan(1000);
  });

  it("moves roughly 22 points per 1% near the centre", () => {
    // Lowered from 30 after a real athlete's ordinary week of easy running
    // spread from 50 to 678 — right in direction every time, far too loud to
    // read as "these were all normal runs".
    const onePct = personalScoreFromDelta(0.01, CARDIO_PERSONAL_SLOPE) - PERSONAL_SCORE_CENTER;
    expect(onePct).toBeGreaterThan(19);
    expect(onePct).toBeLessThan(24);
  });

  it("weights the median by recency", () => {
    const recentFast = weightedMedian([
      { value: 1000, daysBefore: 1 },
      { value: 1000, daysBefore: 2 },
      { value: 1200, daysBefore: 80 },
      { value: 1200, daysBefore: 85 },
    ]);
    expect(recentFast).toBe(1000);
  });

  it("refuses a baseline below the minimum sample count", () => {
    expect(buildPersonalBaseline([{ value: 1000, daysBefore: 1 }], true)).toBeNull();
    expect(
      buildPersonalBaseline(
        [
          { value: 1000, daysBefore: 1 },
          { value: 1010, daysBefore: 2 },
          { value: 1020, daysBefore: 3 },
        ],
        true
      )
    ).not.toBeNull();
  });
});

describe("the fitness equivalent is the one number both scores read", () => {
  it("is reported, and is what the population score looks up", () => {
    const result = easyRun(320, 145);
    expect(result.fitnessEquivalentSeconds).not.toBeNull();
    expect(result.adjustments).not.toBeNull();
    // A deliberately easy 8 km must imply a faster 5 k than its raw
    // projection, which is the entire point of effort scaling.
    expect(result.fitnessEquivalentSeconds!).toBeLessThan(result.adjustments!.projectedSeconds);
  });

  it("anchors the race-prediction ladder, so an easy run predicts real race times", () => {
    const result = easyRun(320, 140);
    const predicted5k = result.predictions!["5000"];
    expect(Math.round(predicted5k)).toBe(Math.round(result.fitnessEquivalentSeconds!));
    // And the ladder is ordered.
    const ladder = Object.entries(result.predictions!)
      .map(([d, s]) => [Number(d), s] as const)
      .sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < ladder.length; i++) {
      expect(ladder[i][1]).toBeGreaterThan(ladder[i - 1][1]);
    }
  });

  it("returns null cleanly with nothing to project from", () => {
    const empty = scoreCardioActivity({
      ...ATHLETE,
      distanceMeters: 0,
      durationSeconds: 0,
    });
    expect(empty.fitnessEquivalentSeconds).toBeNull();
    expect(empty.adjustments).toBeNull();
    expect(empty.score).toBe(0);
    expect(empty.predictions).toBeNull();
    expect(computeFitnessEquivalent({
      sport: "run",
      distanceMeters: 0,
      durationSeconds: 0,
      sex: "male",
    })).toBeNull();
  });

  it("seeds from the work pieces of a structured interval session, not the whole-session average", () => {
    const structured = scoreCardioActivity({
      ...ATHLETE,
      distanceMeters: 8000,
      durationSeconds: 2400,
      avgHR: 150,
      structuredInterval: {
        reps: 6,
        workDistanceMeters: 800,
        workSecondsPerRep: 160,
        restSeconds: 120,
        workAvgHeartRate: 178,
      },
    });
    const wholeSession = scoreCardioActivity({
      ...ATHLETE,
      distanceMeters: 8000,
      durationSeconds: 2400,
      avgHR: 150,
    });
    expect(structured.flags).toContain("interval-work-piece-scored");
    expect(structured.score).toBeGreaterThan(wholeSession.score);
  });
});

describe("age and sex grading still apply to the population score only", () => {
  it("grades an older athlete's equivalent, and leaves the personal comparison alone", () => {
    const young = scoreCardioActivity({ ...ATHLETE, age: 30, distanceMeters: 5000, durationSeconds: 1500 });
    const masters = scoreCardioActivity({ ...ATHLETE, age: 60, distanceMeters: 5000, durationSeconds: 1500 });
    expect(masters.score).toBeGreaterThan(young.score);
    expect(masters.flags).toContain("age-graded");
  });

  it("scores an equal-ability woman the same as an equal-ability man", () => {
    const man = scoreCardioActivity({
      ...ATHLETE,
      sex: "male",
      distanceMeters: 5000,
      durationSeconds: 1800,
    });
    const woman = scoreCardioActivity({
      ...ATHLETE,
      sex: "female",
      distanceMeters: 5000,
      durationSeconds: Math.round(1800 * 1.191),
    });
    expect(Math.abs(man.score - woman.score)).toBeLessThanOrEqual(2);
  });
});

describe("effort-fraction helpers reject nonsense rather than inventing a number", () => {
  it("returns null for absent or impossible inputs", () => {
    expect(effortFractionFromHeartRate(undefined, 50, 190)).toBeNull();
    expect(effortFractionFromHeartRate(0, 50, 190)).toBeNull();
    expect(effortFractionFromHeartRate(150, 190, 190)).toBeNull();
    expect(effortFractionFromRpe(null)).toBeNull();
    expect(effortFractionFromRpe(0)).toBeNull();
    expect(effortFractionFromRpe(11)).toBeNull();
    expect(effortFractionFromRpe(5)).not.toBeNull();
  });
});

describe("the personal score compares like with like on heart rate", () => {
  const anchorMs = Date.parse(ATHLETE.startedAt);
  const session = (pace: number, hr: number, daysAgo: number): RecentCardioSession => ({
    distanceMeters: 8000,
    durationSeconds: 8 * pace,
    avgHR: hr,
    startedAt: new Date(anchorMs - daysAgo * 86_400_000).toISOString(),
  });

  // A realistic mixed block: recovery jogs, steady easy runs, and tempos.
  const mixed: RecentCardioSession[] = [
    session(400, 125, 2),
    session(405, 126, 9),
    session(398, 124, 16),
    session(320, 145, 4),
    session(322, 146, 11),
    session(318, 144, 18),
    session(265, 175, 6),
    session(268, 176, 13),
    session(263, 174, 20),
  ];

  it("judges a recovery jog against recovery jogs, not against tempos", () => {
    // A bang-on-normal recovery jog. Against one blended baseline of every
    // session type it reads as a disastrous day; against the athlete's own
    // recovery jogs it reads as exactly normal, which is what it is.
    const result = easyRun(400, 125, { recentSessions: mixed });
    expect(Math.abs(result.personalScore! - PERSONAL_SCORE_CENTER)).toBeLessThan(60);
  });

  it("judges a tempo against tempos", () => {
    const result = easyRun(265, 175, { recentSessions: mixed });
    expect(Math.abs(result.personalScore! - PERSONAL_SCORE_CENTER)).toBeLessThan(60);
  });

  it("still calls a bad day a bad day within its own intensity band", () => {
    const normalJog = easyRun(400, 125, { recentSessions: mixed }).personalScore!;
    const laboured = easyRun(430, 132, { recentSessions: mixed }).personalScore!;
    expect(laboured).toBeLessThan(normalJog - 60);
  });

  it("reports how well matched the comparison was", () => {
    const wellMatched = easyRun(320, 145, { recentSessions: mixed });
    // Nothing in this athlete's history is near 105 bpm.
    const stretched = easyRun(480, 105, { recentSessions: mixed });
    expect(wellMatched.personal!.intensityMatch).toBeGreaterThan(stretched.personal!.intensityMatch);
    expect(stretched.flags).toContain("personal-baseline-intensity-stretched");
  });

  it("degrades to recency alone when every session sits at one intensity", () => {
    const uniform = [session(320, 145, 3), session(322, 145, 7), session(318, 145, 11)];
    const result = easyRun(320, 145, { recentSessions: uniform });
    expect(result.personalScore).not.toBeNull();
    expect(Math.abs(result.personalScore! - PERSONAL_SCORE_CENTER)).toBeLessThan(40);
  });
});
