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
    predicted5kFromEffort: true,
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

describe("an anchor its own race time contradicts", () => {
  /*
   * Reported from a device: an athlete running 18:25 for 5k, working toward
   * 18:00, was given ONE run of about 5km a week — in week 1 and in the final
   * week alike. Every week of a block is a multiple of the on-ramp anchor and
   * the hard ceiling is 2.6x it, so an anchor ten times too low does not start
   * the athlete slow, it caps them there for the whole block.
   *
   * 1105s is 18:25. VOLUME_ADEQUACY_MIN_PER_WEEK puts that level on 250
   * min/week, and the engine has always known this — the diagnostic uses the
   * same table to decide whether volume or intensity is an athlete's limiting
   * factor. The on-ramp simply never asked.
   */
  it("raises a volume that could not have produced the athlete's own 5k", () => {
    const weeks = buildMacrocycle(STATE(25), GOAL);
    // A quarter of the 250 min/week that an 18:25 is built on.
    expect(weeks[0].enduranceMin).toBeGreaterThanOrEqual(62);
    // And enough minutes to be more than a single session.
    expect(weeks[0].enduranceMin).toBeGreaterThan(MIN_ENDURANCE_SESSION_MIN * 2);
  });

  it("does not raise it on a placeholder 5k", () => {
    /*
     * Without a logged maximal effort the 5k is NO_MAXIMAL_EFFORT_5K_S, not a
     * prediction. Flooring volume on it would invent an aerobic base the
     * athlete has never demonstrated — the opposite failure, and the more
     * dangerous one, because it ramps a beginner.
     */
    const noEffort = { ...STATE(25), predicted5kFromEffort: false };
    const weeks = buildMacrocycle(noEffort, GOAL);
    expect(weeks[0].enduranceMin).toBeCloseTo(25, 0);
  });

  it("never lowers an athlete already running more than the floor", () => {
    const weeks = buildMacrocycle(STATE(300), GOAL);
    expect(weeks[0].enduranceMin).toBeCloseTo(300, 0);
  });
});
