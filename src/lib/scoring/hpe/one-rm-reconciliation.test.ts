import { describe, expect, it } from "vitest";
import { overriddenOneRms, totalKg, type AthleteState } from "./intake";
import { diagnose } from "./diagnostics";
import { prescribeLift } from "./prescription";
import { selectAttempts } from "./progression";

/**
 * ONE set of 1RMs for the whole plan.
 *
 * The Hybrid Plan carried two, built by different code from different sources:
 *
 *   AthleteState.oneRms    max(logged, the athlete's typed correction).
 *                          Read by feasibility.ts and event.ts — what the plan
 *                          PROMISES against.
 *   AthleteProfile.oneRms  the logged estimates alone. Read by prescription.ts,
 *                          selectAttempts and tailoring.ts — what the plan is
 *                          PROGRAMMED from.
 *
 * They agreed only while the athlete never corrected anything. An athlete who
 * typed a tested 180kg squat over a log that inferred 160 was told a meet total
 * was reachable from 180, then given every squat session at percentages of 160,
 * and meet attempts chosen off 160 as well.
 *
 * The fix folds the typed numbers in BEFORE `diagnose` rather than patching the
 * field afterwards, because liftRatios, weakLift and the rep-profile verdict
 * are all derived from this input — patching the output would have left those
 * computed against a squat the athlete had already corrected.
 */

const HR = { hrMax: 190, hrRest: 55 } as const;

function stateWith(oneRms: Record<string, number>): Pick<AthleteState, "oneRms"> {
  return { oneRms };
}

describe("overriddenOneRms", () => {
  it("is a floor, never a replacement", () => {
    // A tested single beats a lower inference...
    expect(overriddenOneRms({ squat: 160 }, { squat: 180 })).toEqual({ squat: 180 });
    // ...and a logged lift that beats the typed number takes over, rather than
    // being held down by an intake answer for the life of the record.
    expect(overriddenOneRms({ squat: 190 }, { squat: 180 })).toEqual({ squat: 190 });
  });

  it("ignores absent, zero and nonsense answers", () => {
    expect(overriddenOneRms({ squat: 160 }, { squat: null, bench: 0, deadlift: NaN })).toEqual({
      squat: 160,
    });
  });

  it("accepts a lift the logs have never seen", () => {
    expect(overriddenOneRms({}, { squat: 150 })).toEqual({ squat: 150 });
  });
});

describe("the promise and the programme use the same numbers", () => {
  const logged = { squat: 160, bench: 110, deadlift: 200 };
  const typed = { squat: 180, bench: null, deadlift: null };

  // What resolveIntakeInputs builds for AthleteState...
  const stateOneRms = overriddenOneRms(logged, typed);
  // ...and what loadAthleteProfile now builds for AthleteProfile.
  const profile = diagnose([], [], overriddenOneRms(logged, typed), HR);

  it("agrees lift for lift", () => {
    expect(profile.oneRms).toEqual(stateOneRms);
  });

  it("agrees on the total the feasibility check is run against", () => {
    // feasibility.ts sums state.oneRms; selectAttempts reads profile.oneRms.
    // A plan that judges a total reachable and then opens with attempts from a
    // different total is not one plan.
    expect(totalKg(stateWith(profile.oneRms))).toBe(totalKg(stateWith(stateOneRms)));
  });

  it("programmes the corrected squat, not the inferred one", () => {
    const rx = (oneRms: Record<string, number>) =>
      prescribeLift(diagnose([], [], oneRms, HR), "weak-lift", {
        lift: "squat",
        sets: 3,
        reps: [5, 5],
        intensity: [0.8, 0.8],
        rir: [2, 2],
      }).text;

    // The weight on the bar is the whole bug: 80% of the corrected 180 is not
    // 80% of the 160 the logs inferred, and it is the athlete's session.
    expect(rx(profile.oneRms)).not.toBe(rx(logged));
    expect(rx(profile.oneRms)).toBe(rx(stateOneRms));
  });

  it("opens the meet from the corrected squat", () => {
    const openerFor = (oneRms: Record<string, number>) =>
      selectAttempts(oneRms, false).find((a) => a.lift === "squat")!.opener;

    // Every attempt is a fraction of the 1RM, so they all move together.
    expect(openerFor(profile.oneRms)).toBeGreaterThan(openerFor(logged));
    expect(openerFor(profile.oneRms)).toBe(openerFor(stateOneRms));
  });
});

describe("derived strength verdicts are built from the corrected numbers too", () => {
  // This is why the override goes in BEFORE diagnose. Patching profile.oneRms
  // afterwards would show the athlete a corrected squat while judging their
  // lift balance against the one they corrected.
  const logged = { squat: 160, bench: 110, deadlift: 200 };

  it("moves the lift ratios", () => {
    const withoutCorrection = diagnose([], [], logged, HR);
    const withCorrection = diagnose([], [], overriddenOneRms(logged, { squat: 180 }), HR);

    // Every ratio is against squat, so raising squat lowers them all.
    expect(withCorrection.liftRatios.bench).toBeLessThan(withoutCorrection.liftRatios.bench);
    expect(withCorrection.liftRatios.deadlift).toBeLessThan(withoutCorrection.liftRatios.deadlift);
  });

  it("can assess an athlete whose only strength evidence is what they typed", () => {
    // The no-logged-history branch. Their typed lifts are the only strength
    // evidence that exists, and dropping them left the plan promised against
    // three lifts it programmed as if it had never heard of them.
    const typedOnly = diagnose([], [], overriddenOneRms({}, { squat: 150, bench: 100 }), HR);

    expect(typedOnly.oneRms).toEqual({ squat: 150, bench: 100 });
    expect(typedOnly.liftRatiosAssessed).toBe(true);
    // Stalling still needs logged sets over time, and no typed number can
    // supply that — "never assessed" must stay distinguishable from "assessed,
    // nothing wrong".
    expect(typedOnly.stallAssessed).toBe(false);
  });
});
