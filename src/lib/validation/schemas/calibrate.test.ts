import { describe, expect, it } from "vitest";
import { calibrateSchema } from "./calibrate";

/**
 * N1 — onboarding calibration refuses an invalid lift instead of dropping it.
 *
 * The old handler filtered: `validLift` was a predicate fed to `.filter()`, so
 * a bad entry was discarded and the request proceeded with what survived. An
 * athlete who typed 600kg for their deadlift finished onboarding with a score
 * calibrated off two lifts, was told it worked, and never learned the third
 * had been thrown away.
 */

const GOOD_LIFT = { weightKg: 140, reps: 5 };
const GOOD_CARDIO = { sport: "running", distanceMeters: 5000, durationSeconds: 1500 };

describe("a filled-in lift that is out of range", () => {
  /**
   * THE CHANGE. Every one of these used to parse fine and silently lose the
   * offending lift.
   */
  const OUT_OF_RANGE: [Record<string, unknown>, string][] = [
    [{ weightKg: 600, reps: 5 }, "a plausible typo for 60 or 160"],
    [{ weightKg: 0, reps: 5 }, "zero weight"],
    [{ weightKg: -10, reps: 5 }, "negative weight"],
    [{ weightKg: 140, reps: 0 }, "zero reps"],
    [{ weightKg: 140, reps: 99 }, "more reps than we score"],
    [{ weightKg: 140 }, "no reps at all"],
  ];

  it.each(OUT_OF_RANGE)("is refused: %o — %s", (squat) => {
    expect(calibrateSchema.safeParse({ sbd: { squat } }).success).toBe(false);
  });

  /**
   * One case that is NOT a converted drop, and is worth separating.
   *
   * `validLift` did `Number(l.weightKg)`, so `"140"` was COERCED and accepted.
   * The schema refuses it, which is a new rejection rather than a silent drop
   * made loud. Defensible — every other body schema in this codebase uses
   * `z.number()` without coercion, and the shipped form sends `Number(...)` —
   * but it is a change to what the endpoint accepts, so it is named here rather
   * than folded into the list above.
   */
  it("refuses a numeric string, which the old predicate coerced and kept", () => {
    expect(
      calibrateSchema.safeParse({ sbd: { squat: { weightKg: "140", reps: 5 } } }).success
    ).toBe(false);
  });

  it("names which lift, so the athlete can find it", () => {
    const parsed = calibrateSchema.safeParse({
      sbd: { squat: GOOD_LIFT, deadlift: { weightKg: 600, reps: 3 } },
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const path = parsed.error.issues[0].path.join(".");
      expect(path).toContain("deadlift");
    }
  });

  /**
   * And the reason this is safe for the shipped form: leaving a lift OUT is
   * still how an athlete says they did not enter it. `score-reveal.tsx` builds
   * the payload from `filledLifts`, so it never sends an untouched one.
   */
  it("still allows a lift to be absent", () => {
    expect(calibrateSchema.safeParse({ sbd: { squat: GOOD_LIFT } }).success).toBe(true);
    expect(calibrateSchema.safeParse({ sbd: {} }).success).toBe(true);
    expect(calibrateSchema.safeParse({}).success).toBe(true);
  });
});

describe("the bounds are the shipped ones, to the comparison operator", () => {
  /**
   * `validLift` used `weightKg > MIN_LIFT_KG` with MIN_LIFT_KG = 0 — strictly
   * greater. `.min(0)` would have accepted a zero-kilo squat that the old code
   * refused, which is the sort of drift that makes a rewrite worse than what it
   * replaced.
   */
  it("keeps weight strictly above zero, not at-or-above", () => {
    expect(calibrateSchema.safeParse({ sbd: { squat: { weightKg: 0, reps: 5 } } }).success).toBe(false);
    expect(calibrateSchema.safeParse({ sbd: { squat: { weightKg: 0.5, reps: 5 } } }).success).toBe(true);
  });

  it("accepts the exact edges the old predicate accepted", () => {
    for (const lift of [
      { weightKg: 500, reps: 50 },
      { weightKg: 0.1, reps: 1 },
    ]) {
      expect(calibrateSchema.safeParse({ sbd: { squat: lift } }).success, JSON.stringify(lift)).toBe(true);
    }
  });

  /**
   * Deliberately NOT tightened. `validLift` never required an integer, and
   * adding one here would be a second behaviour change nobody asked for — so a
   * fractional rep still parses, and the audit records it as an open question
   * rather than a silent decision.
   */
  it("still accepts a fractional rep, as it always did", () => {
    expect(calibrateSchema.safeParse({ sbd: { squat: { weightKg: 100, reps: 5.5 } } }).success).toBe(true);
  });
});

describe("cardio entries", () => {
  it("accepts a real result", () => {
    expect(calibrateSchema.safeParse({ cardio: [GOOD_CARDIO] }).success).toBe(true);
  });

  const BAD_CARDIO: [Record<string, unknown>, string][] = [
    [{ ...GOOD_CARDIO, sport: "gym" }, "gym is not an endurance sport"],
    [{ ...GOOD_CARDIO, distanceMeters: 10 }, "too short to score"],
    [{ ...GOOD_CARDIO, durationSeconds: 5 }, "too quick to score"],
    [{ ...GOOD_CARDIO, distanceMeters: 999_999 }, "further than we score"],
  ];

  it.each(BAD_CARDIO)("refuses %o — %s", (entry) => {
    expect(calibrateSchema.safeParse({ cardio: [entry] }).success).toBe(false);
  });

  /**
   * One bad entry in a list used to cost only that entry. Now it costs the
   * request, which is the point: an athlete who mistyped one of three runs was
   * being scored on two and told it worked.
   */
  it("refuses the whole request for one bad entry among good ones", () => {
    const parsed = calibrateSchema.safeParse({
      cardio: [GOOD_CARDIO, { ...GOOD_CARDIO, distanceMeters: 1 }],
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues[0].path).toContain(1);
  });
});

describe("unknown keys", () => {
  it("are refused, unlike a query string", () => {
    expect(calibrateSchema.safeParse({ sbd: { squat: GOOD_LIFT }, bodyweight: 80 }).success).toBe(false);
    expect(calibrateSchema.safeParse({ sbd: { overheadPress: GOOD_LIFT } }).success).toBe(false);
    expect(
      calibrateSchema.safeParse({ sbd: { squat: { ...GOOD_LIFT, rpe: 9 } } }).success
    ).toBe(false);
  });
});
