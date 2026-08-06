import { describe, expect, it } from "vitest";
import { scoreCardioActivity, type CardioInput } from "./cardio-activity";
import { personalizeRiegelKFromWindow, type HistorySession } from "./cardio/race-prediction";
import { RIEGEL_K } from "./cardio-predictions";

/**
 * Follow-up user feedback on the same thread: "this is still not fully
 * accurate, especially over the course of the longer runs such as over
 * 21km... runs such as a tempo 6km at 4:06/km at 178hr, even if the user
 * had a max hr of 190, then they would still be able to run about 3:50-3:55
 * for 5km... We need to work on calibrating a more realistic 5km score
 * based off each run and also allow it to be tailored to the running data
 * in the past for the last 10 runs the user has done."
 *
 * Two real, verified gaps, confirmed against the user's own account data:
 *
 * 1. Population HR-adjustment reference (resolveReferenceHR in
 *    cardio-predictions.ts) requires a real restingHR to personalize —
 *    with none set, EVERY tempo/race/threshold session fell back to a
 *    flat, sport-generic reference (175bpm for running), which for an
 *    athlete who trains/races well above 175bpm (this account's real races
 *    sit at 188-192bpm) meant ZERO HR credit ever applied outside the
 *    easy/recovery/long HR-zone branch. Estimating resting HR the same way
 *    the HR-zone branch already does fixes this.
 *
 * 2. `personalizeRiegelKFromWindow` mixed easy/recovery/long-tagged
 *    sessions into the "shortest vs longest distance" evidence used to
 *    imply this athlete's personal Riegel k — an easy run's slow pace at a
 *    longer distance implied a wildly inflated k (verified: this exact
 *    account's real data implied k~1.6, clamped to the 1.10 ceiling),
 *    which — now that personalizedRiegelK is threaded into
 *    scoreCardioActivity — would have made every long-run prediction MORE
 *    conservative, the opposite of the user's ask. See
 *    cardio/race-prediction.test.ts for the fix itself; this file covers
 *    the threading into scoreCardioActivity.
 */
describe("population HR-adjustment reference is estimated when resting HR is unset", () => {
  // Real account profile: age 18, male, max HR 206, intermediate,
  // resting HR NOT set.
  const profile = {
    sex: "male" as const,
    age: 18,
    maxHR: 206,
    experience: "intermediate" as const,
  };

  it("gives real HR credit to a hard-but-submaximal tempo run instead of none at all", () => {
    // User's own example: 6km @ 4:06/km (246s/km), 178bpm.
    const tempo: CardioInput = {
      type: "run",
      benchmarkSport: "run",
      distanceMeters: 6000,
      durationSeconds: 6 * 246,
      ...profile,
      avgHR: 178,
      sessionType: "tempo",
    };
    const result = scoreCardioActivity(tempo);
    expect(result.predictions).not.toBeNull();
    const fiveK = result.predictions!["5000"];
    // Before this fix: 178bpm > the flat 175bpm reference, so the
    // adjustment clamped to 0 and this predicted ~20:13 (raw Riegel, no
    // credit at all). After: the personalized reference (estimated resting
    // HR + this athlete's real max) recognizes 178bpm as sub-maximal for
    // THIS athlete and credits accordingly — landing in the user's own
    // stated expectation of ~3:50-3:55/km (19:10-19:35).
    expect(fiveK).toBeLessThan(20 * 60);
    expect(fiveK).toBeGreaterThan(19 * 60);
  });

  it("still lets a genuinely maximal race effort predict itself almost exactly", () => {
    const race: CardioInput = {
      type: "run",
      benchmarkSport: "run",
      distanceMeters: 5000,
      durationSeconds: 1105, // this account's real 18:25 5K PR
      ...profile,
      avgHR: 192,
      sessionType: "race",
    };
    const result = scoreCardioActivity(race);
    // A real near-max effort should stay close to its own actual time —
    // the personalized reference only credits a genuine gap to max, not a
    // large one, so this shouldn't move far from the 1105s actually run.
    expect(Math.abs(result.predictions!["5000"] - 1105)).toBeLessThan(30);
  });
});

describe("personalizedRiegelK threads into both the score anchor and the predictions ladder", () => {
  const base: CardioInput = {
    type: "run",
    benchmarkSport: "run",
    distanceMeters: 10000,
    durationSeconds: 2400, // 4:00/km
    sex: "male",
    age: 30,
    restingHR: 50,
    maxHR: 190,
    avgHR: 175,
    experience: "intermediate",
  };

  it("a different personal k moves the projected 5K in the mathematically correct direction for a down-projection (10K -> 5K benchmark)", () => {
    // NOTE on direction: projecting from a LONGER source distance down to
    // the (shorter) 5000m benchmark is a ratio < 1 (5000/10000 = 0.5).
    // Since 0.5^k shrinks as k grows, a LARGER k predicts a FASTER
    // (smaller) 5K here — the opposite of a ratio > 1 projection (e.g.
    // 5K -> marathon), where a larger k predicts a SLOWER result. Both
    // directions are exercised in cardio/race-prediction.test.ts and
    // cardio-race-ladders.test.ts; this test just confirms
    // scoreCardioActivity's own anchor computation (not just the ladder)
    // responds to personalizedRiegelK consistently with that same math —
    // this is the lever that answers the user's "long runs over 21km
    // should predict faster 5Ks" ask: a larger personalized k for an
    // athlete whose own cross-distance evidence supports it.
    const withDefault = scoreCardioActivity(base);
    const withSmallerK = scoreCardioActivity({ ...base, personalizedRiegelK: 1.03 });
    const withLargerK = scoreCardioActivity({ ...base, personalizedRiegelK: 1.10 });

    expect(withLargerK.predictions!["5000"]).toBeLessThan(withDefault.predictions!["5000"]);
    expect(withSmallerK.predictions!["5000"]).toBeGreaterThan(withDefault.predictions!["5000"]);
    // The score itself (anchored on the same benchmark-equivalent) moves
    // the same direction — not just the outward-facing ladder display.
    expect(withLargerK.score).toBeGreaterThan(withDefault.score);
    expect(withSmallerK.score).toBeLessThan(withDefault.score);
  });

  it("omitting personalizedRiegelK falls back to the system default (RIEGEL_K) unchanged", () => {
    const withDefault = scoreCardioActivity(base);
    const withExplicitDefault = scoreCardioActivity({ ...base, personalizedRiegelK: RIEGEL_K });
    expect(withExplicitDefault.predictions!["5000"]).toBeCloseTo(withDefault.predictions!["5000"], 6);
  });
});

describe("personalizeRiegelKFromWindow real-account sanity check (see cardio/race-prediction.test.ts for the core fix)", () => {
  it("doesn't personalize k yet for an athlete whose only comparable-effort evidence is same-distance races", () => {
    // This account's actual logged history: three 5K races + one genuinely
    // easy 12.52km run. With easy/long sessions correctly excluded, there's
    // no genuine second RACE distance yet to imply a personal k from.
    const sessions: HistorySession[] = [
      { distanceMeters: 5000, durationSeconds: 1105, sessionType: "race", startedAt: new Date().toISOString() },
      { distanceMeters: 5000, durationSeconds: 1151, sessionType: "race", startedAt: new Date().toISOString() },
      { distanceMeters: 5000, durationSeconds: 1160, sessionType: "race", startedAt: new Date().toISOString() },
      { distanceMeters: 12520, durationSeconds: 3929, sessionType: "easy", startedAt: new Date().toISOString() },
    ];
    expect(personalizeRiegelKFromWindow(sessions, null)).toBeNull();
  });
});
