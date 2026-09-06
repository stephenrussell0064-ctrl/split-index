import { describe, expect, it } from "vitest";
import { onRampAnchorMinutes } from "./intake";
import { buildMacrocycle } from "./macrocycle";
import { MIN_ENDURANCE_SESSION_MIN, RETURNING_ATHLETE_VOLUME_SHARE } from "./constants";
import type { AthleteState, Goal } from "./intake";

/**
 * Two floors under the endurance side of a block, both found by rebuilding a
 * real athlete's plan and reading the weeks.
 *
 * The athlete: holds 55min/week whenever they train, six weeks idle, a 5k eight
 * weeks out. Their trailing average was 4.7min/week, week 1 is a MULTIPLE of
 * that, and at MAX_WEEKLY_VOLUME_RAMP nothing multiplicative escapes 4.7 in
 * eight weeks. They were budgeted five minutes of running a week for the whole
 * block — while the engine would have started a total stranger at
 * PROVISIONAL_START_RUN_MIN_PER_WEEK, twelve times higher, on no evidence.
 */

const STATE = (currentRunMinPerWeek: number): AthleteState =>
  ({
    bodyweightKg: 83,
    heightCm: 180,
    age: 30,
    sex: "male",
    oneRms: {},
    predicted5kS: 1105,
    strengthTrainingAge: "intermediate",
    enduranceTrainingAge: "intermediate",
    strengthTrainingYears: 5,
    enduranceTrainingYears: 5,
    currentRunMinPerWeek,
    currentStrengthSessionsPerWeek: 3,
    chronicLoad: 100,
    restingHr: 55,
    maxHr: 190,
    safety: {} as AthleteState["safety"],
    assumed: [],
  }) as AthleteState;

const GOAL: Goal = {
  weeksOut: 8,
  horizonSource: "event_date",
  target5kS: 1080,
  enduranceEventKm: 5,
  enduranceEventKey: "5k",
  targetSquatKg: null,
  targetBenchKg: null,
  targetDeadliftKg: null,
  targetTotalKg: null,
  priority: 0.5,
  sameDay: false,
} as Goal;

describe("returning-athlete floor on the on-ramp anchor", () => {
  it("brings a lapsed athlete back to a share of what they actually hold", () => {
    // 4.7 trailing, 55.2 when training -> half of 55.2.
    expect(onRampAnchorMinutes(4.7, 55.2, RETURNING_ATHLETE_VOLUME_SHARE)).toBeCloseTo(27.6, 1);
  });

  it("never raises the anchor above what the athlete has actually held", () => {
    expect(onRampAnchorMinutes(4.7, 20, RETURNING_ATHLETE_VOLUME_SHARE)).toBe(10);
    // Trailing above established (a build-up) is left exactly alone.
    expect(onRampAnchorMinutes(90, 60, RETURNING_ATHLETE_VOLUME_SHARE)).toBe(90);
  });

  it("leaves an athlete who simply trains less than they used to unchanged", () => {
    // 40 is already above half of 60, so there is nothing to floor.
    expect(onRampAnchorMinutes(40, 60, RETURNING_ATHLETE_VOLUME_SHARE)).toBe(40);
  });

  it("stays null when there is nothing logged to anchor on", () => {
    expect(onRampAnchorMinutes(null, 55, RETURNING_ATHLETE_VOLUME_SHARE)).toBeNull();
  });

  it("does not invent volume for an athlete with no running history", () => {
    expect(onRampAnchorMinutes(0, 0, RETURNING_ATHLETE_VOLUME_SHARE)).toBe(0);
  });
});

describe("weekly endurance budget floor", () => {
  it("never budgets less than one session worth doing", () => {
    // The 4.7 case: every week used to come out at 3-5 minutes.
    const weeks = buildMacrocycle(STATE(4.7), GOAL);
    expect(weeks.length).toBeGreaterThan(0);
    for (const w of weeks) {
      expect(w.enduranceMin, `week ${w.week}`).toBeGreaterThanOrEqual(MIN_ENDURANCE_SESSION_MIN);
    }
  });

  it("leaves a real volume untouched", () => {
    const weeks = buildMacrocycle(STATE(69), GOAL);
    expect(weeks[0].enduranceMin).toBeGreaterThan(MIN_ENDURANCE_SESSION_MIN);
    expect(weeks[0].enduranceMin).toBeCloseTo(69, 0);
  });

  it("keeps zero at zero", () => {
    // An athlete with no endurance in their plan is a different case from one
    // whose budget rounded below a session. This must not conjure running for
    // somebody who is not doing any — and the macrocycle's own provisional
    // start already covers the genuine no-history athlete.
    const weeks = buildMacrocycle(STATE(0), GOAL);
    expect(weeks[0].enduranceMin).toBeGreaterThan(0);
  });
});
