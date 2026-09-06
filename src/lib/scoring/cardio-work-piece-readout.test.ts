import { describe, expect, it } from "vitest";
import { scoreCardioActivity, type CardioInput } from "./cardio-activity";

/**
 * The engine has always scored structured intervals off the work pieces. What
 * it did not do was say so in any form an athlete could read — only an
 * `interval-work-piece-scored` flag, which reached the UI as the bare words
 * "interval work piece scored". These cover the readout that replaces it.
 */

// 8 x 400m in 84s with 90s recovery: total work 3200m in 11:12, whole session
// 6.4km in 34:30 once the standing around is counted.
const INTERVAL_SESSION: CardioInput = {
  type: "run",
  benchmarkSport: "run",
  distanceMeters: 6400,
  durationSeconds: 2070,
  sex: "male",
  age: 30,
  sessionType: "interval",
  structuredInterval: {
    reps: 8,
    workDistanceMeters: 400,
    workSecondsPerRep: 84,
    restSeconds: 90,
  },
};

describe("workPiece readout", () => {
  it("reports the rep pace, what was scored, and the session average", () => {
    const result = scoreCardioActivity(INTERVAL_SESSION);
    expect(result.workPiece).not.toBeNull();
    expect(result.workPiece!.kind).toBe("interval");

    // 84s per 400m is 210 s/km.
    expect(result.workPiece!.workPaceSecPerKm).toBe(210);
    // 2070s over 6.4km is ~323 s/km.
    expect(result.workPiece!.sessionAvgPaceSecPerKm).toBe(323);
  });

  it("scores slower than the raw rep pace, because rest makes a pace easier to hold", () => {
    const { workPiece } = scoreCardioActivity(INTERVAL_SESSION);
    expect(workPiece!.equivalentPaceSecPerKm).toBeGreaterThan(workPiece!.workPaceSecPerKm);
  });

  it("still scores far faster than the session average — the whole point of the feature", () => {
    const { workPiece } = scoreCardioActivity(INTERVAL_SESSION);
    // If this ever inverts, the athlete is being judged on their standing
    // around and the readout would be advertising a lie.
    expect(workPiece!.equivalentPaceSecPerKm).toBeLessThan(workPiece!.sessionAvgPaceSecPerKm!);
  });

  it("is null when an interval is logged without the optional breakdown", () => {
    // null rather than absent: that is what the log form submits when the
    // optional work/rest breakdown is left blank.
    const result = scoreCardioActivity({ ...INTERVAL_SESSION, structuredInterval: null });
    expect(result.workPiece).toBeNull();
    // Falling back to session-average scoring is the documented behaviour;
    // the readout must not claim otherwise by appearing anyway.
    expect(result.flags).not.toContain("interval-work-piece-scored");
  });

  it("is null for an ordinary steady run", () => {
    const result = scoreCardioActivity({
      type: "run",
      benchmarkSport: "run",
      distanceMeters: 10000,
      durationSeconds: 2700,
      sex: "male",
      age: 30,
      sessionType: "easy",
    });
    expect(result.workPiece).toBeNull();
  });

  it("reports fartlek 'on' pieces the same way", () => {
    const result = scoreCardioActivity({
      type: "run",
      benchmarkSport: "run",
      distanceMeters: 9000,
      durationSeconds: 2700,
      sex: "male",
      age: 30,
      sessionType: "fartlek",
      structuredFartlek: {
        onDistanceMeters: 3000,
        onSeconds: 660,
        totalDurationSeconds: 2700,
      },
    });
    expect(result.workPiece!.kind).toBe("fartlek");
    // 660s over 3km is 220 s/km.
    expect(result.workPiece!.workPaceSecPerKm).toBe(220);
    expect(result.workPiece!.equivalentPaceSecPerKm).toBeLessThan(
      result.workPiece!.sessionAvgPaceSecPerKm!
    );
  });

  it("rounds every pace to whole seconds so the three numbers compare cleanly", () => {
    const { workPiece } = scoreCardioActivity(INTERVAL_SESSION);
    for (const v of [
      workPiece!.workPaceSecPerKm,
      workPiece!.equivalentPaceSecPerKm,
      workPiece!.sessionAvgPaceSecPerKm!,
    ]) {
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it("leaves sessionAvgPaceSecPerKm null when there is no distance to average over", () => {
    const result = scoreCardioActivity({
      ...INTERVAL_SESSION,
      distanceMeters: 0,
    });
    expect(result.workPiece?.sessionAvgPaceSecPerKm ?? null).toBeNull();
  });
});
