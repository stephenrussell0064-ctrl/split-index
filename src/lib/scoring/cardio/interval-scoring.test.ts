import { describe, expect, it } from "vitest";
import {
  intervalEquivalentPaceSecPerKm,
  intervalTotalWorkDistanceMeters,
  fartlekEquivalentPaceSecPerKm,
  isValidIntervalWorkPiece,
  isValidFartlekOnPiece,
} from "./interval-scoring";
import { computeIntervalBenchmarkEquivalentSeconds } from "@/lib/scoring/cardio-predictions";
import { scoreCardioActivity, type CardioInput } from "@/lib/scoring/cardio-activity";

describe("intervalEquivalentPaceSecPerKm", () => {
  it("returns the raw work pace when rest is negligible relative to work (still applies the fixed base offset)", () => {
    // 400m in 75s = 187.5 sec/km work pace; rest ~0 relative to work.
    const piece = { reps: 6, workDistanceMeters: 400, workSecondsPerRep: 75, restSeconds: 0 };
    const equivPace = intervalEquivalentPaceSecPerKm(piece);
    const workPace = (75 / 400) * 1000;
    expect(equivPace).toBeGreaterThan(workPace);
    expect(equivPace).toBeCloseTo(workPace * 1.03, 5); // BASE_OFFSET only, no rest contribution
  });

  it("produces a slower (larger) equivalent pace as rest increases relative to work", () => {
    const shortRest = intervalEquivalentPaceSecPerKm({
      reps: 6,
      workDistanceMeters: 400,
      workSecondsPerRep: 75,
      restSeconds: 30,
    });
    const longRest = intervalEquivalentPaceSecPerKm({
      reps: 6,
      workDistanceMeters: 400,
      workSecondsPerRep: 75,
      restSeconds: 180,
    });
    expect(longRest).toBeGreaterThan(shortRest);
  });

  it("caps the rest-ratio contribution at INTERVAL_REST_CAP (1.5×) — an absurdly long rest doesn't extrapolate further", () => {
    // totalWorkSeconds = 6 x 75 = 450; restRatio = ((reps-1) x restSeconds) / totalWorkSeconds.
    // restSeconds = 135 -> (5 x 135)/450 = 1.5 exactly (at the cap).
    const atCap = intervalEquivalentPaceSecPerKm({
      reps: 6,
      workDistanceMeters: 400,
      workSecondsPerRep: 75,
      restSeconds: 135,
    });
    const beyondCap = intervalEquivalentPaceSecPerKm({
      reps: 6,
      workDistanceMeters: 400,
      workSecondsPerRep: 75,
      restSeconds: 750,
    });
    expect(beyondCap).toBeCloseTo(atCap, 5);
  });
});

describe("intervalTotalWorkDistanceMeters", () => {
  it("multiplies reps × per-rep distance, excluding rest", () => {
    expect(
      intervalTotalWorkDistanceMeters({ reps: 6, workDistanceMeters: 400, workSecondsPerRep: 75, restSeconds: 90 })
    ).toBe(2400);
  });
});

describe("fartlekEquivalentPaceSecPerKm", () => {
  it("treats the remaining session time as rest against the 'on' pieces", () => {
    const piece = { onDistanceMeters: 2400, onSeconds: 600, totalDurationSeconds: 1800 };
    const equivPace = fartlekEquivalentPaceSecPerKm(piece);
    const onPace = (600 / 2400) * 1000;
    expect(equivPace).toBeGreaterThan(onPace);
  });
});

describe("isValidIntervalWorkPiece / isValidFartlekOnPiece", () => {
  it("rejects incomplete or zeroed structured data", () => {
    expect(isValidIntervalWorkPiece(null)).toBe(false);
    expect(isValidIntervalWorkPiece({ reps: 0, workDistanceMeters: 400, workSecondsPerRep: 75, restSeconds: 90 })).toBe(false);
    expect(isValidIntervalWorkPiece({ reps: 6, workDistanceMeters: 400, workSecondsPerRep: 75, restSeconds: 90 })).toBe(true);

    expect(isValidFartlekOnPiece(undefined)).toBe(false);
    expect(isValidFartlekOnPiece({ onDistanceMeters: 0, onSeconds: 600, totalDurationSeconds: 1800 })).toBe(false);
    expect(isValidFartlekOnPiece({ onDistanceMeters: 2400, onSeconds: 600, totalDurationSeconds: 1800 })).toBe(true);
  });
});

describe("computeIntervalBenchmarkEquivalentSeconds", () => {
  it("projects the work-piece equivalent pace over the work distance to the benchmark distance", () => {
    const equiv = computeIntervalBenchmarkEquivalentSeconds("run", 2400, 200); // 200 sec/km over 2.4km
    expect(equiv).not.toBeNull();
    expect(equiv!).toBeGreaterThan(0);
  });

  it("returns null for zero/invalid inputs", () => {
    expect(computeIntervalBenchmarkEquivalentSeconds("run", 0, 200)).toBeNull();
    expect(computeIntervalBenchmarkEquivalentSeconds("run", 2400, 0)).toBeNull();
  });
});

describe("scoreCardioActivity — structured interval scoring beats whole-session-average dilution", () => {
  const baseInput: CardioInput = {
    type: "run",
    benchmarkSport: "run",
    distanceMeters: 4800, // 6 x 400m reps + ~2000m of jogged recovery, roughly
    durationSeconds: 2400, // 40 min whole session including rest jogging
    sex: "male",
    age: 30,
  };

  it("scores a fast structured interval session higher than treating it as one long whole-session average", () => {
    const wholeSessionResult = scoreCardioActivity(baseInput);

    const intervalResult = scoreCardioActivity({
      ...baseInput,
      structuredInterval: {
        reps: 6,
        workDistanceMeters: 400,
        workSecondsPerRep: 75, // fast 400m reps
        restSeconds: 90,
      },
    });

    expect(intervalResult.flags).toContain("interval-work-piece-scored");
    expect(intervalResult.score).toBeGreaterThan(wholeSessionResult.score);
  });

  it("falls back to whole-session-average scoring when structured data is absent or incomplete", () => {
    const noStructuredData = scoreCardioActivity(baseInput);
    const incompleteStructuredData = scoreCardioActivity({
      ...baseInput,
      structuredInterval: { reps: 0, workDistanceMeters: 400, workSecondsPerRep: 75, restSeconds: 90 },
    });
    expect(incompleteStructuredData.score).toBe(noStructuredData.score);
    expect(incompleteStructuredData.flags).not.toContain("interval-work-piece-scored");
  });

  it("fartlek structured data is flagged and scored via the work-piece path", () => {
    const result = scoreCardioActivity({
      ...baseInput,
      structuredFartlek: {
        onDistanceMeters: 2400,
        onSeconds: 480, // fast "on" pace
        totalDurationSeconds: baseInput.durationSeconds,
      },
    });
    expect(result.flags).toContain("fartlek-work-piece-scored");
  });
});
