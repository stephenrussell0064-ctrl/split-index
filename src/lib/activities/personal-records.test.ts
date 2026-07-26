import { describe, expect, it } from "vitest";
import { enduranceRecordCandidates, gymRecordCandidates } from "./personal-records";

describe("enduranceRecordCandidates", () => {
  it("produces benchmark_time (lower-is-better), longest_distance and longest_duration (higher-is-better)", () => {
    const candidates = enduranceRecordCandidates({
      sport: "running",
      activityId: "a1",
      achievedAt: "2026-01-01T00:00:00Z",
      distanceMeters: 5000,
      durationSeconds: 1200,
      benchmarkEquivalentSeconds: 1150,
    });
    expect(candidates).toHaveLength(3);
    const byMetric = Object.fromEntries(candidates.map((c) => [c.metric, c]));
    expect(byMetric.benchmark_time).toMatchObject({ value: 1150, unit: "seconds", direction: "lower-is-better" });
    expect(byMetric.longest_distance).toMatchObject({ value: 5000, unit: "meters", direction: "higher-is-better" });
    expect(byMetric.longest_duration).toMatchObject({ value: 1200, unit: "seconds", direction: "higher-is-better" });
  });

  it("omits candidates for missing data instead of producing zero/invalid entries", () => {
    const candidates = enduranceRecordCandidates({
      sport: "running",
      activityId: "a1",
      achievedAt: "2026-01-01T00:00:00Z",
      distanceMeters: null,
      durationSeconds: 1200,
      benchmarkEquivalentSeconds: null,
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0].metric).toBe("longest_duration");
  });
});

describe("gymRecordCandidates", () => {
  it("produces one higher-is-better candidate per exercise, keyed by exercise name", () => {
    const candidates = gymRecordCandidates({
      activityId: "a1",
      achievedAt: "2026-01-01T00:00:00Z",
      exercises: [
        { exercise_name: "bench_press", estimated_1rm_kg: 100 },
        { exercise_name: "deadlift", estimated_1rm_kg: 150 },
      ],
    });
    expect(candidates).toHaveLength(2);
    expect(candidates.every((c) => c.sport === "gym" && c.direction === "higher-is-better" && c.unit === "kg")).toBe(true);
    expect(candidates.map((c) => c.metric)).toEqual(["bench_press", "deadlift"]);
  });

  it("skips exercises with no valid estimated 1RM", () => {
    const candidates = gymRecordCandidates({
      activityId: "a1",
      achievedAt: "2026-01-01T00:00:00Z",
      exercises: [{ exercise_name: "bench_press", estimated_1rm_kg: 0 }],
    });
    expect(candidates).toHaveLength(0);
  });
});
