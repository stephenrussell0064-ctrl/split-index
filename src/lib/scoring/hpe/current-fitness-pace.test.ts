/**
 * The paces an athlete is given have to be paces they can run at the heart
 * rate printed beside them.
 *
 * Reproduced from a live plan: "12.3km in 63min at 5:02-5:14/km. HR 147-164",
 * for an athlete whose own fitted HR-vs-pace regression put 5:02/km at 174 bpm
 * and 164 bpm at about 5:30/km. Three things conspired, and each is pinned
 * here: the predicted 5k came from a two-month-old race 16% faster than their
 * most recent one; the easy band's measured HR anchor was thrown away because
 * its FLOOR fell outside the regression's fitted range; and the derived anchor
 * that survived was clamped to 1.5x that stale 5k pace, collapsing the band to
 * a single number.
 */
import { describe, expect, it } from "vitest";
import { diagnose, easyPaceBand, predictHrAtPace } from "./diagnostics";
import { paceAtHr, prescribeEndurance, reconcilePaceWithHrCeiling } from "./prescription";
import { EASY_PACE_BOUNDS_VS_5K, MAX_EFFORT_RECENCY_DAYS, MIN_EASY_BAND_WIDTH_S_PER_KM } from "./constants";
import type { HrPaceModel, RunLog } from "./types";

const HR_MAX = 209;
const HR_REST = 47;

/** Easy running near the ceiling: 5:04-5:29/km at 166-177 bpm, the pattern of a grey-zone runner. */
function easyRuns(): RunLog[] {
  const out: RunLog[] = [];
  const paces = [319, 329, 310, 321, 320, 318, 314, 304];
  const hrs = [175, 167, 177, 173, 169, 166, 166, 173];
  paces.forEach((pace, i) => out.push({ dateIdx: 10 + i * 7, distanceKm: 9, durationS: 9 * pace, avgHr: hrs[i] }));
  return out;
}

describe("the predicted 5k is current fitness", () => {
  it("takes the most recent maximal effort over an older, faster one", () => {
    const runs: RunLog[] = [
      ...easyRuns(),
      // A 10k in August at 3:58/km extrapolates to a mid-16 5k.
      { dateIdx: 20, distanceKm: 9.9, durationS: 39 * 60, avgHr: 196, isMaxEffort: true },
      // A 5k seven weeks later at 20:00 flat.
      { dateIdx: 20 + MAX_EFFORT_RECENCY_DAYS + 7, distanceKm: 5, durationS: 1200, avgHr: 190, isMaxEffort: true },
    ];
    const p = diagnose(runs, [], {}, { hrMax: HR_MAX, hrRest: HR_REST, hrMaxSource: "measured" });
    expect(p.predicted5kSource).toBe("maximal_effort");
    expect(p.predicted5kS).toBeCloseTo(1200, 0);
  });

  it("still takes the best of several efforts that are close together in time", () => {
    const runs: RunLog[] = [
      ...easyRuns(),
      { dateIdx: 30, distanceKm: 5, durationS: 1200, avgHr: 190, isMaxEffort: true },
      { dateIdx: 30 + 14, distanceKm: 5, durationS: 1105, avgHr: 192, isMaxEffort: true },
      { dateIdx: 30 + 28, distanceKm: 5, durationS: 1150, avgHr: 191, isMaxEffort: true },
    ];
    const p = diagnose(runs, [], {}, { hrMax: HR_MAX, hrRest: HR_REST, hrMaxSource: "measured" });
    expect(p.predicted5kS).toBeCloseTo(1105, 0);
  });
});

describe("the easy band's heart-rate anchor", () => {
  // The live regression: HR = 87.7 + 7.25 x kph, fitted on 10.95-11.86 kph.
  const model: HrPaceModel = { intercept: 87.73, slope: 7.2546, loKph: 10.953, hiKph: 11.856 };
  const hrr = HR_MAX - HR_REST;
  const ceiling = Math.round(HR_REST + 0.72 * hrr); // 164

  it("is kept when the ceiling inverts inside the fitted range even though the floor does not", () => {
    const band = easyPaceBand(1200, 1.14, model, HR_MAX, HR_REST);
    expect(band.candidates.hr_inverted).toBeDefined();
    // The fast bound is the pace at the ceiling — the one number the athlete
    // will be asked not to exceed.
    const atCeiling = paceAtHr(model, ceiling)!;
    expect(band.candidates.hr_inverted!.lo).toBeCloseTo(atCeiling, 0);
    // The slow bound is not extrapolated below the fit.
    expect(band.candidates.hr_inverted!.hi).toBeLessThanOrEqual(3600 / (model.loKph * 0.92) + 1e-6);
  });

  it("governs the band, and the prescribed fast end sits at or below the ceiling on the athlete's own model", () => {
    const band = easyPaceBand(1200, 1.14, model, HR_MAX, HR_REST);
    expect(band.governing).toBe("hr_inverted");
    const hrAtFastEnd = predictHrAtPace(model, band.lo, HR_MAX, HR_REST);
    expect(hrAtFastEnd).not.toBeNull();
    expect(hrAtFastEnd!).toBeLessThanOrEqual(ceiling);
  });

  // A weak fatigue-resistance exponent pushes the 90-minute anchor past 1.5x
  // 5k pace, where it used to sit clamped — 6:00-6:00 — and win the
  // slowest-governs vote with a number that was the clamp's, not the athlete's.
  const SATURATING_K = 1.25;

  it("outranks a derived anchor that has saturated the plausibility clamp", () => {
    const unclamped = easyPaceBand(1200, SATURATING_K, null, HR_MAX, HR_REST);
    expect(unclamped.candidates.long_effort!.lo).toBeCloseTo((1200 / 5) * EASY_PACE_BOUNDS_VS_5K[1], 6);

    const band = easyPaceBand(1200, SATURATING_K, model, HR_MAX, HR_REST);
    expect(band.candidates.long_effort).toBeUndefined();
    expect(band.governing).toBe("hr_inverted");
    expect(band.lo).toBeLessThan((1200 / 5) * EASY_PACE_BOUNDS_VS_5K[1]);
  });

  it("keeps the saturated anchor when there is no HR anchor to defer to", () => {
    const band = easyPaceBand(1200, SATURATING_K, null, HR_MAX, HR_REST);
    expect(band.candidates.long_effort).toBeDefined();
    expect(band.governing).toBe("long_effort");
  });

  it("is never a single pace", () => {
    const band = easyPaceBand(1200, SATURATING_K, null, HR_MAX, HR_REST);
    expect(band.hi - band.lo).toBeGreaterThanOrEqual(MIN_EASY_BAND_WIDTH_S_PER_KM - 1e-9);
  });

  it("still prescribes the slowest of the anchors that remain", () => {
    const band = easyPaceBand(1200, 1.14, model, HR_MAX, HR_REST);
    for (const c of Object.values(band.candidates)) {
      expect(band.lo).toBeGreaterThanOrEqual(c.lo - 1e-9);
    }
  });
});

describe("a continuous run's pace follows its heart-rate ceiling", () => {
  const model: HrPaceModel = { intercept: 87.73, slope: 7.2546, loKph: 10.953, hiKph: 11.856 };

  it("slows a band the athlete's own data puts above the ceiling, and leaves one inside it alone", () => {
    const profile = diagnose([], [], {}, { hrMax: HR_MAX, hrRest: HR_REST, hrMaxSource: "measured" });
    const withModel = { ...profile, hrPaceModel: model };
    // 5:02/km is 11.92 kph: the model says 174 bpm, ten over a 164 ceiling.
    const slowed = reconcilePaceWithHrCeiling(withModel, { lo: 302, hi: 314 }, 164);
    expect(slowed.slowed).toBe(true);
    expect(predictHrAtPace(model, slowed.band.lo, HR_MAX, HR_REST)!).toBeLessThanOrEqual(164);
    expect(slowed.band.hi - slowed.band.lo).toBeGreaterThanOrEqual(12);

    // 5:45/km is 10.43 kph: the model says 163, inside the ceiling.
    const fine = reconcilePaceWithHrCeiling(withModel, { lo: 345, hi: 365 }, 164);
    expect(fine.slowed).toBe(false);
    expect(fine.band).toEqual({ lo: 345, hi: 365 });
  });

  it("refuses to move a pace the regression does not cover", () => {
    const profile = diagnose([], [], {}, { hrMax: HR_MAX, hrRest: HR_REST, hrMaxSource: "measured" });
    const withModel = { ...profile, hrPaceModel: model };
    // 4:00/km is far above the fitted range; the model may not be asked.
    expect(reconcilePaceWithHrCeiling(withModel, { lo: 240, hi: 250 }, 164).slowed).toBe(false);
  });

  it("says so in the prescription the athlete reads", () => {
    const runs = easyRuns();
    const profile = diagnose(runs, [], {}, { hrMax: HR_MAX, hrRest: HR_REST, hrMaxSource: "measured" });
    // Force a race-derived band well above what the model allows, as the live
    // profile had, by removing the band the diagnostic computed.
    const stale = { ...profile, easyBand: null, predicted5kS: 1081 };
    const rx = prescribeEndurance(stale, "easy_run", "hybrid-baseline", { minutes: 40 });
    if (rx.hrHi != null && profile.hrPaceModel) {
      const hrAtFast = predictHrAtPace(profile.hrPaceModel, rx.paceLoSPerKm!, HR_MAX, HR_REST);
      if (hrAtFast != null) expect(hrAtFast).toBeLessThanOrEqual(rx.hrHi);
    }
  });

  it("the live case: a long run is prescribed at a pace its own ceiling allows", () => {
    const runs: RunLog[] = [
      ...easyRuns(),
      { dateIdx: 20, distanceKm: 9.9, durationS: 39 * 60, avgHr: 196, isMaxEffort: true },
      { dateIdx: 20 + MAX_EFFORT_RECENCY_DAYS + 7, distanceKm: 5, durationS: 1200, avgHr: 190, isMaxEffort: true },
    ];
    const profile = diagnose(runs, [], {}, { hrMax: HR_MAX, hrRest: HR_REST, hrMaxSource: "measured" });
    expect(profile.hrPaceModel).not.toBeNull();
    const rx = prescribeEndurance(profile, "long_run", "hybrid-baseline", { minutes: 60 });
    const hrAtFast = predictHrAtPace(profile.hrPaceModel, rx.paceLoSPerKm!, HR_MAX, HR_REST);
    // Either the model covers the pace and agrees it is under the ceiling, or
    // the pace is slower than anything the model was fitted on.
    if (hrAtFast != null) expect(hrAtFast).toBeLessThanOrEqual(rx.hrHi!);
    else expect(3600 / rx.paceLoSPerKm!).toBeLessThan(profile.hrPaceModel!.loKph);
    expect(rx.paceHiSPerKm! - rx.paceLoSPerKm!).toBeGreaterThan(0);
  });
});
