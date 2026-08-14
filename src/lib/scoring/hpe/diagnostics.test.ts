/**
 * WP0 acceptance: "running the reference data reproduces tier 2, k = 1.103,
 * volume adequacy 42%, limiter = endurance, an easy band of 4:59-5:30/km at
 * HR 141-155 governed by the long-effort anchor, and the seven findings"
 * — plus the brief's property tests over randomised histories.
 *
 * The fixture below is the reference athlete from `hpe_diagnostics.py`'s own
 * main(): real logged running figures, illustrative HR-by-km/strength detail.
 */

import { describe, expect, it } from "vitest";
import {
  canGeneratePlan,
  deriveEmphasis,
  diagnose,
  easyPaceBand,
  fitRiegelK,
  normaliseEmphasis,
  predictHrAtPace,
} from "./diagnostics";
import { EMPHASIS_FLOOR, EMPHASIS_KEYS, type EmphasisKey } from "./constants";
import type { LiftSet, RunLog } from "./types";

const HR_MAX = 196;
const HR_REST = 50;

function referenceRuns(): RunLog[] {
  const runs: RunLog[] = [
    { dateIdx: 0, distanceKm: 5.0, durationS: 18 * 60 + 30, avgHr: 181, cadenceSpm: 159, isMaxEffort: true },
    { dateIdx: 28, distanceKm: 10.0, durationS: 39 * 60 + 45, avgHr: 178, cadenceSpm: 166, isMaxEffort: true },
  ];
  for (let w = 0; w < 12; w++) {
    runs.push({
      dateIdx: w * 7,
      distanceKm: 8.0,
      durationS: 8 * 285,
      avgHr: 162,
      splitsSPerKm: [283, 284, 285, 285, 287, 288, 290, 292],
      hrByKm: [152, 158, 161, 163, 166, 168, 170, 172],
    });
    runs.push({ dateIdx: w * 7 + 3, distanceKm: 6.0, durationS: 6 * 290, avgHr: 158 });
    runs.push({ dateIdx: w * 7 + 5, distanceKm: 6.0, durationS: 6 * 300, avgHr: 154 });
  }
  return runs;
}

function referenceSets(): LiftSet[] {
  const sets: LiftSet[] = [];
  for (let w = 0; w < 12; w++) {
    sets.push(
      { dateIdx: w * 7, lift: "squat", loadKg: 100, reps: 8 },
      { dateIdx: w * 7, lift: "squat", loadKg: 105, reps: 8 },
      { dateIdx: w * 7 + 2, lift: "squat", loadKg: 125, reps: 3 },
      { dateIdx: w * 7 + 1, lift: "bench", loadKg: 70, reps: 8 },
      { dateIdx: w * 7 + 1, lift: "bench", loadKg: 72.5, reps: 8 },
      { dateIdx: w * 7 + 4, lift: "bench", loadKg: 85, reps: 3 },
      { dateIdx: w * 7 + 4, lift: "deadlift", loadKg: 130, reps: 8 },
      { dateIdx: w * 7 + 4, lift: "deadlift", loadKg: 160, reps: 3 },
      { dateIdx: w * 7 + 6, lift: "deadlift", loadKg: 135, reps: 8 }
    );
  }
  return sets;
}

const REFERENCE_ONE_RMS = { squat: 140.0, bench: 92.0, deadlift: 175.0 };

export function referenceProfile() {
  return diagnose(referenceRuns(), referenceSets(), REFERENCE_ONE_RMS, {
    priority: 0.4,
    hrMax: HR_MAX,
    hrRest: HR_REST,
    hrMaxSource: "measured",
  });
}

describe("WP0 — reference athlete reproduction", () => {
  const p = referenceProfile();

  it("assigns tier 2 at 72% confidence", () => {
    expect(p.tier).toBe(2);
    expect(p.confidence).toBeCloseTo(0.72, 6);
  });

  it("fits the athlete's own fatigue-resistance exponent k = 1.103", () => {
    expect(p.riegelK).not.toBeNull();
    expect(p.riegelK as number).toBeCloseTo(1.1034, 4);
    expect(p.riegelVerdict).toBe("endurance-limited");
  });

  it("predicts 5k from the best maximal effort using that k", () => {
    expect(p.predicted5kS).toBeCloseTo(1110, 0);
    expect(p.predicted5kFromEffort).toBe(true);
  });

  it("reports volume adequacy of 42% and endurance as the limiter", () => {
    // 104.3 logged min/week against the 250 min/week the table associates
    // with an 18:30 5k — displays as 42%, the brief's acceptance figure.
    expect(p.volumeAdequacy).toBeCloseTo(0.4174, 4);
    expect(Math.round(p.volumeAdequacy * 100)).toBe(42);
    expect(p.limiter).toBe("endurance");
  });

  it("classifies intensity by heart rate, not pace", () => {
    // The whole point of critical implementation note 2: pace says 100% easy,
    // HR says 31%. The HR answer must win.
    expect(p.easyFractionSource).toBe("heart-rate");
    expect(p.easyFraction as number).toBeCloseTo(0.31, 2);
    expect(p.intensityVerdict).toBe("grey-zone risk");
  });

  it("prescribes an easy band of 4:59-5:30/km at HR 141-155, governed by the long-effort anchor", () => {
    const band = p.easyBand!;
    const mmss = (s: number) => `${Math.floor(Math.round(s) / 60)}:${String(Math.round(s) % 60).padStart(2, "0")}`;
    expect(band.governing).toBe("long_effort");
    expect(mmss(band.lo)).toBe("4:59");
    expect(mmss(band.hi)).toBe("5:30");
    expect(band.hrLo).toBe(141);
    expect(band.hrHi).toBe(155);
    // The naive 5k anchor is ~23s/km faster and must NOT govern.
    expect(band.candidates["5k_multiplier"]!.lo).toBeLessThan(band.lo - 20);
    expect(band.spreadSPerKm).toBeGreaterThan(15);
  });

  it("emits exactly the seven expected findings, in order", () => {
    // Seven, not eight. The reference's eighth was the spurious
    // low-speed-reserve finding, which fired for every athlete because the
    // metric behind it was a tautology. This athlete has logged no short
    // maximal effort, so speed reserve is null and nothing fires.
    expect(p.findings.map((f) => f.id)).toEqual([
      "endurance-limited",
      "low-volume",
      "easy-anchor-disagreement",
      "pace-vs-hr-discrepancy",
      "grey-zone",
      "no-quality",
      "stalled-lift",
    ]);
  });

  it("returns a null speed reserve and offers the unlock prompt instead", () => {
    expect(p.speedReserveMs).toBeNull();
    expect(p.maximalSprintSpeedMs).toBeNull();
    expect(p.maximalAerobicSpeedMs).toBeGreaterThan(0);
    expect(p.dataGaps.join(" ")).toContain("flat-out 400m");
    expect(p.findings.map((f) => f.id)).not.toContain("low-speed-reserve");
  });

  it("derives a real speed reserve once a flat-out 400m is logged", () => {
    const runs = [
      ...referenceRuns(),
      // 400m in 58s = 6.9 m/s against a maximal aerobic speed of ~4.5 m/s.
      { dateIdx: 40, distanceKm: 0.4, durationS: 58, isMaxEffort: true },
    ];
    const withSprint = diagnose(runs, referenceSets(), REFERENCE_ONE_RMS, {
      priority: 0.4,
      hrMax: HR_MAX,
      hrRest: HR_REST,
    });
    expect(withSprint.speedReserveMs).not.toBeNull();
    expect(withSprint.speedReserveMs as number).toBeCloseTo(6.9 - withSprint.maximalAerobicSpeedMs, 1);
    expect(withSprint.dataGaps.join(" ")).not.toContain("flat-out 400m");
    // A 400m must never contaminate the fatigue-resistance fit — k is about
    // how the athlete fades over distance, and a sprint is a different test.
    expect(withSprint.riegelK).toBeCloseTo(p.riegelK as number, 6);
  });

  it("keeps speed reserve out of the aerobic/threshold split, so it cannot double-count with k", () => {
    const slowSprint = [
      ...referenceRuns(),
      // A 400m barely quicker than maximal aerobic speed: a low reserve.
      { dateIdx: 40, distanceKm: 0.4, durationS: 74, isMaxEffort: true },
    ];
    const lowReserve = diagnose(slowSprint, referenceSets(), REFERENCE_ONE_RMS, {
      priority: 0.4,
      hrMax: HR_MAX,
      hrRest: HR_REST,
    });
    expect(lowReserve.findings.map((f) => f.id)).toContain("low-speed-reserve");
    // Neuromuscular moves; vo2max_speed's share relative to threshold does
    // not, because k alone governs that split.
    expect(lowReserve.emphasis.neuromuscular).toBeGreaterThan(p.emphasis.neuromuscular);
    expect(lowReserve.emphasis.vo2max_speed / lowReserve.emphasis.threshold).toBeCloseTo(
      p.emphasis.vo2max_speed / p.emphasis.threshold,
      6
    );
  });

  it("weights the emphasis vector toward aerobic base", () => {
    // The corrected figures the brief states for this athlete once the
    // spurious speed-reserve finding no longer fires: aerobic_base back up to
    // 0.532 from 0.500, and neuromuscular back down to 0.077 from 0.116 — a
    // 50% relative distortion removed from the dimension that was stealing
    // weight from exactly the quality this athlete was diagnosed as lacking.
    expect(p.emphasis.aerobic_base).toBeCloseTo(0.532, 2);
    expect(p.emphasis.threshold).toBeCloseTo(0.162, 2);
    expect(p.emphasis.neuromuscular).toBeCloseTo(0.077, 2);
    // vo2max_speed drops further than the brief's two stated figures because
    // the reference's spurious finding also carried a x1.3 on this dimension.
    // Removing it restores the aerobic/threshold split to what k alone says.
    expect(p.emphasis.vo2max_speed).toBeCloseTo(0.065, 2);
    // Endurance-limited athlete: aerobic base outweighs vVO2max intervals by
    // a wide margin. That difference is the entire product claim.
    expect(p.emphasis.aerobic_base).toBeGreaterThan(p.emphasis.vo2max_speed * 5);
  });

  it("bounds the HR-vs-pace regression to its fitted range", () => {
    const model = p.hrPaceModel!;
    expect(model.loKph).toBeCloseTo(12.0, 1);
    expect(model.hiKph).toBeCloseTo(12.63, 1);
    // Interval pace is far outside the easy-run range the model was fitted
    // on — it must refuse rather than extrapolate.
    expect(predictHrAtPace(model, p.vo2maxPaceSPerKm, HR_MAX, HR_REST)).toBeNull();
    // Inside the range it answers.
    expect(predictHrAtPace(model, 3600 / 12.3, HR_MAX, HR_REST)).toBeGreaterThan(HR_REST);
  });

  it("names the specific data gap holding this athlete below tier 3", () => {
    // Deviation D6: this athlete clears every tier-3 requirement except the
    // 12-week history span (they have 11.7). The reference reports no gap at
    // all here, which leaves the athlete with no idea what to do next.
    expect(p.dataGaps.join(" ")).toContain("week");
    expect(p.dataGaps.join(" ")).toContain("logged history");
  });

  it("prompts for a second maximal effort when that is what is missing", () => {
    const runs = referenceRuns().filter((r) => !(r.isMaxEffort && r.distanceKm === 10));
    const p1 = diagnose(runs, referenceSets(), REFERENCE_ONE_RMS, { hrMax: HR_MAX, hrRest: HR_REST });
    expect(p1.dataGaps.join(" ")).toContain("maximal effort");
    // And with only one effort the personal k is unavailable, exactly as the
    // tier-2 row in the brief says.
    expect(p1.riegelK).toBeNull();
  });

  it("flags the stalled competition lifts", () => {
    expect(p.stalledLifts).toEqual(["squat", "bench", "deadlift"]);
    expect(p.weakLift).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Property tests from the brief's Rev 2 test matrix
// ---------------------------------------------------------------------------

/** Deterministic LCG — a seeded generator keeps a failing case reproducible. */
function makeRng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function randomHistory(rng: () => number) {
  const hrRest = 40 + Math.floor(rng() * 40);
  const hrMax = hrRest + 80 + Math.floor(rng() * 90);
  const runCount = Math.floor(rng() * 40);
  const runs: RunLog[] = [];
  for (let i = 0; i < runCount; i++) {
    // Some athletes have logged a flat-out short effort; most have not.
    // That split is the point of the metric — it must be null for the ones
    // who have not, and a real, varying number for the ones who have.
    const isSprint = rng() < 0.25;
    const distanceKm = isSprint ? 0.2 + rng() * 0.6 : 1 + rng() * 25;
    const paceS = isSprint ? 100 + rng() * 90 : 200 + rng() * 300;
    runs.push({
      dateIdx: Math.floor(rng() * 120),
      distanceKm,
      durationS: distanceKm * paceS,
      avgHr: rng() < 0.8 ? hrRest + Math.floor(rng() * (hrMax - hrRest)) : null,
      isMaxEffort: rng() < 0.15,
      splitsSPerKm: rng() < 0.3 ? Array.from({ length: 8 }, () => paceS + rng() * 20) : [],
      hrByKm: rng() < 0.3 ? Array.from({ length: 8 }, () => hrRest + Math.floor(rng() * (hrMax - hrRest))) : [],
    });
  }
  const setCount = Math.floor(rng() * 60);
  const lifts = ["squat", "bench", "deadlift"];
  const sets: LiftSet[] = Array.from({ length: setCount }, () => ({
    dateIdx: Math.floor(rng() * 120),
    lift: lifts[Math.floor(rng() * lifts.length)],
    loadKg: 20 + rng() * 200,
    reps: 1 + Math.floor(rng() * 12),
  }));
  const squat = 60 + rng() * 150;
  const oneRms = { squat, bench: squat * (0.4 + rng() * 0.6), deadlift: squat * (0.8 + rng() * 0.8) };
  return { runs, sets, oneRms, hrMax, hrRest, priority: rng() };
}

describe("WP0 — property tests over 500 randomised histories", () => {
  const histories = Array.from({ length: 500 }, (_, i) => randomHistory(makeRng(i + 1)));

  it("emphasis vectors always sum to 1.0 with no weight below the floor", () => {
    for (const h of histories) {
      const p = diagnose(h.runs, h.sets, h.oneRms, {
        priority: h.priority,
        hrMax: h.hrMax,
        hrRest: h.hrRest,
      });
      const sum = EMPHASIS_KEYS.reduce((s, k) => s + p.emphasis[k], 0);
      expect(sum).toBeCloseTo(1.0, 3);
      for (const k of EMPHASIS_KEYS) {
        expect(p.emphasis[k]).toBeGreaterThanOrEqual(EMPHASIS_FLOOR - 1e-9);
        expect(Number.isFinite(p.emphasis[k])).toBe(true);
      }
    }
  });

  it("never prescribes a heart rate above the athlete's max HR", () => {
    for (const h of histories) {
      const p = diagnose(h.runs, h.sets, h.oneRms, {
        priority: h.priority,
        hrMax: h.hrMax,
        hrRest: h.hrRest,
      });
      if (p.easyBand) {
        expect(p.easyBand.hrHi).toBeLessThanOrEqual(h.hrMax);
        expect(p.easyBand.hrLo).toBeLessThanOrEqual(h.hrMax);
      }
      for (const pace of [p.thresholdPaceSPerKm, p.vo2maxPaceSPerKm, p.easyBand?.lo ?? 300]) {
        const hr = predictHrAtPace(p.hrPaceModel, pace, h.hrMax, h.hrRest);
        if (hr != null) expect(hr).toBeLessThanOrEqual(h.hrMax);
      }
    }
  });

  it("never lets the easy HR ceiling exceed 72% of HR reserve", () => {
    for (const h of histories) {
      const p = diagnose(h.runs, h.sets, h.oneRms, { hrMax: h.hrMax, hrRest: h.hrRest });
      if (!p.easyBand) continue;
      const ceiling = h.hrRest + 0.72 * (h.hrMax - h.hrRest);
      expect(p.easyBand.hrHi).toBeLessThanOrEqual(Math.round(ceiling));
    }
  });
});

describe("WP0 — data sufficiency", () => {
  it("returns tier 0 and offers a baseline block when there is no history", () => {
    const p = diagnose([], [], {}, { hrMax: 190, hrRest: 55 });
    expect(p.tier).toBe(0);
    expect(canGeneratePlan(p)).toBe(false);
    expect(p.dataGaps[0]).toContain("No logged history");
  });

  it("falls back to the population k when there are too few maximal efforts", () => {
    const runs: RunLog[] = Array.from({ length: 10 }, (_, i) => ({
      dateIdx: i * 3,
      distanceKm: 8,
      durationS: 8 * 300,
      avgHr: 150,
    }));
    expect(fitRiegelK(runs)).toBeNull();
    const p = diagnose(runs, [], {}, { hrMax: 190, hrRest: 55 });
    expect(p.riegelK).toBeNull();
    expect(p.riegelVerdict).toBe("insufficient data");
  });

  it("refuses to fit k from two efforts at the same distance", () => {
    const runs: RunLog[] = [
      { dateIdx: 0, distanceKm: 5, durationS: 1150, isMaxEffort: true },
      { dateIdx: 30, distanceKm: 5, durationS: 1110, isMaxEffort: true },
    ];
    expect(fitRiegelK(runs)).toBeNull();
  });
});

describe("WP0 — easy-pace anchoring", () => {
  it("always prescribes the slowest of the three anchors", () => {
    const rng = makeRng(99);
    for (let i = 0; i < 200; i++) {
      const predicted5k = 900 + rng() * 900;
      const k = 1.0 + rng() * 0.2;
      const hrRest = 40 + Math.floor(rng() * 30);
      const hrMax = hrRest + 100 + Math.floor(rng() * 60);
      const model = { intercept: rng() * 60, slope: 5 + rng() * 15, loKph: 9, hiKph: 14 };
      const band = easyPaceBand(predicted5k, k, model, hrMax, hrRest);
      for (const candidate of Object.values(band.candidates)) {
        expect(band.lo).toBeGreaterThanOrEqual(candidate.lo - 1e-9);
        expect(band.hi).toBeGreaterThanOrEqual(candidate.hi - 1e-9);
      }
    }
  });

  it("works without an HR-pace model at all", () => {
    const band = easyPaceBand(1110, 1.1034, null, 196, 50);
    expect(band.candidates.hr_inverted).toBeUndefined();
    expect(band.governing).toBe("long_effort");
  });
});

describe("WP0 — emphasis normalisation (deviation D1)", () => {
  it("keeps every weight at or above the floor even when one dimension dominates", () => {
    const raw = Object.fromEntries(EMPHASIS_KEYS.map((k) => [k, k === "aerobic_base" ? 1000 : 0.0001])) as Record<
      EmphasisKey,
      number
    >;
    const v = normaliseEmphasis(raw);
    expect(EMPHASIS_KEYS.reduce((s, k) => s + v[k], 0)).toBeCloseTo(1, 9);
    for (const k of EMPHASIS_KEYS) expect(v[k]).toBeGreaterThanOrEqual(EMPHASIS_FLOOR - 1e-12);
  });

  it("handles an all-zero vector without producing NaN", () => {
    const raw = Object.fromEntries(EMPHASIS_KEYS.map((k) => [k, 0])) as Record<EmphasisKey, number>;
    const v = normaliseEmphasis(raw);
    for (const k of EMPHASIS_KEYS) expect(v[k]).toBeCloseTo(1 / EMPHASIS_KEYS.length, 9);
  });

  it("emits a finding for every multiplier it applies", () => {
    const { findings } = deriveEmphasis(
      {
        riegelK: 1.09,
        volumeAdequacy: 0.4,
        decoupling: 0.15,
        easyBand: null,
        runsInsideEasyBand: 0,
        easyFractionByPace: 1,
        easyFractionByHr: 0.3,
        easyFraction: 0.3,
        noQuality: true,
        speedReserveMs: 1.2,
        runsWithHr: 12,
        repProfileGap: 0.09,
        weakLift: "bench",
        liftRatios: { squat: 1, bench: 0.6 },
        stalledLifts: ["squat"],
      },
      0.5
    );
    expect(findings.map((f) => f.id)).toEqual([
      "endurance-limited",
      "low-volume",
      "poor-decoupling",
      "no-easy-runs-logged",
      "pace-vs-hr-discrepancy",
      "grey-zone",
      "no-quality",
      "low-speed-reserve",
      "under-expressed",
      "weak-lift",
      "stalled-lift",
    ]);
    for (const f of findings) expect(f.text.length).toBeGreaterThan(40);
  });
});

describe("WP0 — individualisation (amended Rev 2 test matrix)", () => {
  const histories = Array.from({ length: 500 }, (_, i) => randomHistory(makeRng(i + 1)));
  const profiles = histories.map((h) =>
    diagnose(h.runs, h.sets, h.oneRms, { priority: h.priority, hrMax: h.hrMax, hrRest: h.hrRest })
  );

  it("speed reserve varies across athletes and is null where no short maximal effort exists", () => {
    // The defect this replaces: the reference's speed_reserve evaluated to
    // 0.1146 for every athlete alive. A metric with one value carries no
    // information, and worse, it fired a finding and two multipliers off that
    // non-information for 100% of users.
    const derived = profiles.map((p) => p.speedReserveMs).filter((v): v is number => v != null);
    const nulls = profiles.filter((p) => p.speedReserveMs == null);

    expect(derived.length).toBeGreaterThan(20);
    expect(nulls.length).toBeGreaterThan(20);
    expect(new Set(derived.map((v) => v.toFixed(3))).size).toBeGreaterThan(20);
    expect(Math.max(...derived) - Math.min(...derived)).toBeGreaterThan(1);

    // Null is never a silent zero: it must come with the unlock prompt and
    // without the finding.
    for (const p of nulls) {
      if (p.tier > 0) expect(p.dataGaps.join(" ")).toContain("flat-out 400m");
      expect(p.findings.map((f) => f.id)).not.toContain("low-speed-reserve");
      expect(p.findings.map((f) => f.id)).not.toContain("ample-speed-reserve");
    }
  });

  it("no finding fires for 100% of athletes", () => {
    // A finding true of everyone is not a diagnosis, it is a constant with a
    // sentence attached — and it distorts every emphasis vector it touches by
    // exactly the same amount, which is the same as touching none of them
    // except that it moves weight away from whatever IS individual.
    const counts = new Map<string, number>();
    for (const p of profiles) {
      for (const id of new Set(p.findings.map((f) => f.id))) {
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
    }
    for (const [id, count] of counts) {
      expect(count, `finding "${id}" fired for all ${profiles.length} athletes`).toBeLessThan(profiles.length);
    }
    // And the diagnosis genuinely differentiates: no two-thirds of athletes
    // should share an identical finding set.
    const signatures = profiles.map((p) => p.findings.map((f) => f.id).join("|"));
    const commonest = Math.max(...[...new Set(signatures)].map((sig) => signatures.filter((s) => s === sig).length));
    expect(commonest).toBeLessThan(profiles.length * 0.67);
  });
});
