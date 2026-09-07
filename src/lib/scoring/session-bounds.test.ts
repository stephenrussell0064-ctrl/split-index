import { describe, expect, it } from "vitest";
import { assertScoringInput, ScoringInputError } from "./input-guards";

/**
 * A SESSION DATED 2099 IS PERMANENT DAMAGE, NOT A BAD ROW.
 *
 * `started_at` was written verbatim to `activities.started_at`,
 * `workout_scores.created_at` and `split_index_history.recorded_at`, and
 * nothing anywhere checked it. The dashboard reads the athlete's current Split
 * Index as `recorded_at DESC LIMIT 1`, so one mistyped year becomes their
 * index for the next seventy-four years, and every 7-day delta is computed
 * against it. Deleting the session is the only cure, and nothing tells them
 * that is the cause.
 *
 * Alongside it: `reps` had no ceiling on the server, so 1,000,000 reached
 * `gym_exercises` and every piece of volume arithmetic downstream; and `sport`
 * was never validated at all, so an unknown value was stopped only by the
 * Postgres enum and surfaced as a raw driver message in a 500.
 */

const RUN = { sport: "running" as const, durationSeconds: 1800, distanceMeters: 5000 };

function accepts(input: Parameters<typeof assertScoringInput>[0]) {
  return () => assertScoringInput(input);
}

describe("when the session happened", () => {
  it("refuses a date in the future", () => {
    const nextYear = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
    expect(accepts({ ...RUN, startedAt: nextYear })).toThrow(ScoringInputError);
  });

  it("refuses a mistyped century", () => {
    expect(accepts({ ...RUN, startedAt: "2099-12-31T23:59:00Z" })).toThrow(/future/i);
    expect(accepts({ ...RUN, startedAt: "0001-01-01T00:00:00Z" })).toThrow(/past/i);
  });

  it("allows a few hours of slack, because phone clocks run fast", () => {
    // A clock slightly ahead, or a session logged across a timezone the app
    // resolved differently, are ordinary events and must not cost a workout.
    const inTwoHours = new Date(Date.now() + 2 * 3600 * 1000).toISOString();
    expect(accepts({ ...RUN, startedAt: inTwoHours })).not.toThrow();
  });

  it("accepts a session logged days later, which is the normal case", () => {
    const lastWeek = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    expect(accepts({ ...RUN, startedAt: lastWeek })).not.toThrow();
  });

  it("accepts a real training history going decades back", () => {
    // The lower bound catches a stray century, not a masters athlete's log.
    expect(accepts({ ...RUN, startedAt: "1974-06-01T09:00:00Z" })).not.toThrow();
  });

  it("refuses a date it cannot read rather than treating it as now", () => {
    expect(accepts({ ...RUN, startedAt: "not a date" })).toThrow(ScoringInputError);
  });

  it("still scores a session that carries no date at all", () => {
    // Callers that never had one keep working — the guard is opt-in by presence.
    expect(accepts(RUN)).not.toThrow();
    expect(accepts({ ...RUN, startedAt: null })).not.toThrow();
  });
});

describe("what counts as a sport", () => {
  it("refuses one the engine has never heard of", () => {
    expect(
      accepts({ ...RUN, sport: "quidditch" as unknown as typeof RUN.sport })
    ).toThrow(ScoringInputError);
  });

  it("accepts every sport the app itself offers", () => {
    const sports = [
      "running", "walking", "swimming", "rowing", "bike_erg",
      "indoor_cycling", "outdoor_cycling", "ski_erg", "gym",
    ] as const;
    for (const sport of sports) {
      expect(accepts({ sport, durationSeconds: 1800 })).not.toThrow();
    }
  });
});

describe("how many reps a set can hold", () => {
  const gymSet = (reps: number) => ({
    sport: "gym" as const,
    durationSeconds: 3600,
    exercises: [{ exercise_name: "Back Squat", sets: [{ weight_kg: 100, reps }] }],
  });

  it("refuses a number no one performs", () => {
    expect(accepts(gymSet(1_000_000))).toThrow(ScoringInputError);
    expect(accepts(gymSet(201))).toThrow(ScoringInputError);
  });

  it("leaves a genuinely long set alone", () => {
    // A 100-rep squat challenge is a real thing people log.
    expect(accepts(gymSet(100))).not.toThrow();
    expect(accepts(gymSet(200))).not.toThrow();
  });
});
