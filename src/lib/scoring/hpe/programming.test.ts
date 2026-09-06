/**
 * Regression tests for the five programming defects an athlete found by
 * reading their own plan.
 *
 * Every one of these was live in a plan shown to a real user, and every one is
 * the same shape of failure: a value the athlete supplied never reached the
 * code that needed it, so the engine fell back to a default and presented the
 * default as a decision. The chosen split did not reach the rotation. The
 * "grow muscle" goal did not reach the rep range. The block phase did not
 * reach the quality-session picker. The stored plan did not reach the paused
 * screen. The athlete's actual 5k time did not reach the gain-rate lookup.
 *
 * These test the fixes at the seam where the value was being dropped, not at
 * the surface where it was noticed, because the surface symptom is the easier
 * thing to make pass and the wrong thing to hold still.
 */

import { describe, expect, it } from "vitest";
import { diagnose } from "./diagnostics";
import { generatePlan } from "./engine";
import { feasibilityScreen, inferredEnduranceTrainingAge } from "./feasibility";
import { ENDURANCE_GAIN_PER_BLOCK, MAX_GAIN_MULTIPLE_OF_RATE } from "./constants";
import { DEFAULT_SAFETY_FLAGS, type AthleteState, type Constraints, type Goal } from "./intake";
import type { LiftSet, RunLog } from "./types";

function state(o: Partial<AthleteState> = {}): AthleteState {
  return {
    bodyweightKg: 78, heightCm: 178, age: 32, sex: "male",
    oneRms: { squat: 140, bench: 100, deadlift: 180 }, predicted5kS: 1400,
    strengthTrainingAge: "intermediate", enduranceTrainingAge: "intermediate",
    strengthTrainingYears: 3, enduranceTrainingYears: 3,
    currentRunMinPerWeek: 150, currentStrengthSessionsPerWeek: 3,
    chronicLoad: 400, restingHr: 52, maxHr: 190,
    safety: { ...DEFAULT_SAFETY_FLAGS, injuryLast12Weeks: false, surgeryLast6Months: false },
    assumed: [], ...o,
  };
}
function goal(o: Partial<Goal> = {}): Goal {
  return {
    weeksOut: 12, horizonSource: "chosen_timeframe", target5kS: null,
    enduranceEventKm: null, enduranceEventKey: null,
    targetSquatKg: null, targetBenchKg: null, targetDeadliftKg: null, targetTotalKg: null,
    priority: 0.5, sameDay: false, interEventGapH: 4, weightClassKg: null, eventOrderKnown: false, ...o,
  };
}
function constraints(o: Partial<Constraints> = {}): Constraints {
  return {
    daysAvailable: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    twoADaysPossible: false, dayWindows: [], availabilityVaries: false,
    amHour: 7, pmHour: 18, maxSessionsPerWeek: 6, maxHoursPerWeek: 9,
    maxSessionMin: 90, minRestDays: 1,
    trainingSplit: null,
    gymAccessDays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    equipment: ["barbell"], ...o,
  };
}
const runs = (n: number, km: number, paceS: number, hr: number): RunLog[] =>
  Array.from({ length: n }, (_, i) => ({ dateIdx: i * 3, distanceKm: km, durationS: km * paceS, avgHr: hr }));
const sets = (n: number, lift: string, kg: number, reps: number): LiftSet[] =>
  Array.from({ length: n }, (_, i) => ({ dateIdx: i * 5, lift, loadKg: kg, reps }));

/** A hybrid athlete with enough history for tier 2+ in both domains. */
function hybrid(c: Partial<Constraints> = {}, g: Partial<Goal> = {}) {
  const runLogs = [
    ...runs(14, 8, 300, 148),
    ...runs(6, 5, 224, 178),
    ...runs(5, 16, 330, 145),
  ];
  const liftSets = [
    ...sets(9, "squat", 130, 5), ...sets(9, "bench", 92, 5),
    ...sets(8, "deadlift", 170, 5), ...sets(8, "squat", 120, 8),
  ];
  const s = state();
  const profile = diagnose(runLogs, liftSets, s.oneRms, {
    priority: g.priority ?? 0.5, hrMax: s.maxHr ?? 190, hrRest: s.restingHr ?? 52, hrMaxSource: "measured",
  });
  return generatePlan({ state: s, goal: goal(g), constraints: constraints(c), profile });
}

describe("training split governs the strength rotation", () => {
  it("gives a PPL athlete push, pull and legs days — not bench and squat days", () => {
    const plan = hybrid({ trainingSplit: "ppl" });
    expect(plan.generated).toBe(true);

    const lifts = new Set(
      plan.weeks.flatMap((w) => w.sessions.filter((x) => x.domain === "strength").map((x) => x.lift))
    );
    // A push/pull/legs rotation must reach a pulling primary. The defect was a
    // hardcoded squat/bench alternation that ignored the split entirely, so
    // "deadlift" is the discriminating observation.
    expect(lifts.has("deadlift")).toBe(true);
    expect(lifts.size).toBeGreaterThanOrEqual(3);
  });

  it("gives an upper/lower athlete a different rotation from a PPL athlete", () => {
    const seq = (split: "ppl" | "upper_lower") =>
      hybrid({ trainingSplit: split })
        .weeks[2]?.sessions.filter((s) => s.domain === "strength").map((s) => s.lift).join(",");
    expect(seq("ppl")).not.toEqual(seq("upper_lower"));
  });
});

describe("strength sessions are whole sessions", () => {
  it("prescribes accessories, not a single lift on its own", () => {
    const plan = hybrid({ trainingSplit: "ppl" });
    const strength = plan.weeks.flatMap((w) => w.sessions).filter((s) => s.domain === "strength");
    expect(strength.length).toBeGreaterThan(0);
    // Every strength session should name more than its primary lift. The
    // defect showed "Bench 4x2" as the entire session.
    for (const s of strength) {
      expect(s.prescription.text.split("·").length).toBeGreaterThan(1);
    }
  });
});

describe("rep ranges follow the goal, not a 1RM default", () => {
  it("uses growth ranges when the athlete set no numeric lift target", () => {
    const plan = hybrid({ trainingSplit: "ppl" });
    const texts = plan.weeks
      .flatMap((w) => w.sessions)
      .filter((s) => s.domain === "strength")
      .map((s) => s.prescription.text);

    // The defect prescribed doubles to an athlete who asked for muscle growth
    // and strength. Nothing in a hypertrophy-leaning block should sit at 2 reps.
    expect(texts.some((t) => /x(1|2)\b/.test(t))).toBe(false);
    expect(texts.some((t) => /x[4-9]|x1[0-2]|-\s?(8|10|12)/.test(t))).toBe(true);
  });
});

describe("endurance quality is programmed, not just volume", () => {
  it("schedules interval and threshold work across the block, not only easy and long runs", () => {
    const plan = hybrid({}, { target5kS: 1080, priority: 0.7 });
    const kinds = plan.weeks.flatMap((w) => w.sessions.map((s) => s.kind));
    expect(kinds).toContain("interval_run");
    expect(kinds).toContain("threshold_run");
  });

  it("rotates the quality kind rather than repeating one session every week", () => {
    const plan = hybrid({}, { target5kS: 1080, priority: 0.7 });
    const perWeek = plan.weeks.map((w) =>
      w.sessions.filter((s) => s.kind === "interval_run" || s.kind === "threshold_run").map((s) => s.kind).join("+")
    );
    expect(new Set(perWeek.filter(Boolean)).size).toBeGreaterThan(1);
  });
});

describe("projected improvement stays inside what a human can do", () => {
  it("does not project an 18:25 runner to 16:22 in eleven weeks", () => {
    const s = state({ predicted5kS: 1105, enduranceTrainingAge: "novice" });
    const f = feasibilityScreen(s, goal({ weeksOut: 11, target5kS: 1080, priority: 0 }));
    // Was 16:22 (982s) — a projection no 18:25 runner has any business being
    // shown. Now ~18:03, which is roughly 2% and is what the advanced rate
    // actually supports over eleven weeks.
    expect(f.projected5kS).toBeGreaterThan(1075);
    expect(f.enduranceGainPct).toBeLessThan(2.5);
  });

  it("scales focus down, never up", () => {
    // The defect was a `2 * share` term that DOUBLED the published rate for a
    // single-sport athlete. Focusing entirely on running may not beat the rate
    // for someone who trains running — that rate already assumes they do.
    const s = state({ predicted5kS: 1105 });
    const focused = feasibilityScreen(s, goal({ weeksOut: 12, priority: 0 }));
    const rate = ENDURANCE_GAIN_PER_BLOCK[inferredEnduranceTrainingAge("intermediate", 1105)];
    expect(focused.enduranceGainPct / 100).toBeLessThanOrEqual(rate * MAX_GAIN_MULTIPLE_OF_RATE + 1e-9);

    // And a split athlete gets less than the focused one, not more.
    const split = feasibilityScreen(s, goal({ weeksOut: 12, priority: 0.5 }));
    expect(split.enduranceGainPct).toBeLessThan(focused.enduranceGainPct);
  });

  it("still lets a genuine beginner improve like a beginner", () => {
    // The caps must not flatten everyone. A 30:00 runner really does move.
    const s = state({ predicted5kS: 1800, enduranceTrainingAge: "novice" });
    const f = feasibilityScreen(s, goal({ weeksOut: 11, priority: 0 }));
    expect(f.enduranceGainPct).toBeGreaterThan(3.5);
  });

  it("quotes a range and says plainly that progress is not linear", () => {
    const s = state({ predicted5kS: 1105, enduranceTrainingAge: "novice" });
    const f = feasibilityScreen(s, goal({ weeksOut: 11, target5kS: 1080, priority: 0 }));

    // The whole band is faster than where the athlete is today. Quoting their
    // own PB back at them as a possible outcome of eleven weeks' work is
    // dispiriting and is not what the evidence says — a block that gets
    // completed makes people faster, and how much is the uncertain part.
    expect(f.projected5kRangeS[0]).toBe(f.projected5kS);
    expect(f.projected5kRangeS[1]).toBeLessThan(1105);
    expect(f.projected5kRangeS[1]).toBeGreaterThan(f.projected5kRangeS[0]);
    // The caveat is stated in words rather than smuggled into the arithmetic.
    expect(f.messages.join(" ")).toMatch(/not improve in a straight line/);
    expect(f.messages.join(" ")).toMatch(/from 18:25 today/);
  });

  it("stops treating a fast runner as a novice whatever the intake said", () => {
    // 18:25. Self-reported novice, but nobody runs this as a beginner.
    expect(inferredEnduranceTrainingAge("novice", 1105)).toBe("advanced");
    // A genuinely slow runner keeps the age they reported.
    expect(inferredEnduranceTrainingAge("novice", 1800)).toBe("novice");
    // Inference only ever raises — it never demotes a self-reported veteran.
    expect(inferredEnduranceTrainingAge("elite", 1800)).toBe("elite");
  });
});

describe("a long run is long and an easy run is easy", () => {
  it("makes the long run distinctly the longest session of the week", () => {
    const plan = hybrid({ maxSessionsPerWeek: 5 }, { target5kS: 1080, priority: 0.4 });
    for (const w of plan.weeks) {
      const long = w.sessions.find((s) => s.kind === "long_run");
      const easies = w.sessions.filter((s) => s.kind === "easy_run");
      if (!long || easies.length === 0) continue;
      const longestEasy = Math.max(...easies.map((s) => s.minutes));
      // An athlete was shown a 6.5km easy run beside a 6.7km "long" run. If the
      // long run is not clearly the longest session it is a second easy run
      // wearing the name.
      expect(long.minutes).toBeGreaterThan(longestEasy * 1.25);
    }
  });

  it("never prescribes the long run faster than the easy run", () => {
    const plan = hybrid({ maxSessionsPerWeek: 5 }, { target5kS: 1080, priority: 0.4 });
    for (const w of plan.weeks) {
      const long = w.sessions.find((s) => s.kind === "long_run");
      const easy = w.sessions.find((s) => s.kind === "easy_run");
      if (!long?.prescription.paceLoSPerKm || !easy?.prescription.paceLoSPerKm) continue;
      // Pace is seconds per km, so "not faster" means not a smaller number. The
      // multiplier was 0.99, which made the long run 1% QUICKER at its sharp
      // end than the easy run it is supposed to be gentler than.
      expect(long.prescription.paceLoSPerKm).toBeGreaterThanOrEqual(easy.prescription.paceLoSPerKm);
    }
  });
});

describe("strength sessions are sessions people would actually do", () => {
  const exercisesIn = (text: string) => text.split("·").length;

  it("prescribes five to six exercises, not three", () => {
    const plan = hybrid({ trainingSplit: "ppl" });
    const strength = plan.weeks.flatMap((w) => w.sessions).filter((s) => s.domain === "strength");
    expect(strength.length).toBeGreaterThan(0);
    for (const s of strength) {
      expect(exercisesIn(s.prescription.text)).toBeGreaterThanOrEqual(5);
    }
  });

  it("varies the exercises week to week rather than repeating one session", () => {
    const plan = hybrid({ trainingSplit: "ppl" });
    const pushDays = plan.weeks
      .flatMap((w) => w.sessions)
      .filter((s) => s.domain === "strength" && s.lift === "bench")
      .map((s) => s.prescription.text);
    expect(pushDays.length).toBeGreaterThan(2);
    // Eleven identical sessions is not a programme.
    expect(new Set(pushDays).size).toBeGreaterThan(1);
  });

  it("leads with a rotating variation when the athlete is not peaking a total", () => {
    // Lifts must be PROGRESSING for the rotation to be observable: a stalled
    // lift gets its stall variation instead, which is the more specific reason
    // and correctly outranks variety.
    const climbing = [
      ...Array.from({ length: 10 }, (_, i) => ({ dateIdx: i * 5, lift: "squat", loadKg: 110 + i * 2.5, reps: 5 })),
      ...Array.from({ length: 10 }, (_, i) => ({ dateIdx: i * 5 + 1, lift: "bench", loadKg: 80 + i * 1.5, reps: 5 })),
      ...Array.from({ length: 10 }, (_, i) => ({ dateIdx: i * 6, lift: "deadlift", loadKg: 150 + i * 3, reps: 3 })),
    ];
    const s = state();
    const profile = diagnose(runs(14, 8, 300, 148), climbing, s.oneRms, {
      priority: 0.5, hrMax: 190, hrRest: 52, hrMaxSource: "measured",
    });
    const plan = generatePlan({
      state: s,
      goal: goal(),
      constraints: constraints({ trainingSplit: "ppl" }),
      profile,
    });
    const leads = plan.weeks
      .flatMap((w) => w.sessions)
      .filter((x) => x.domain === "strength")
      .map((x) => x.prescription.text.split("·")[0].trim());
    // A push day led by an incline dumbbell press is still a push day, and the
    // bench goes up anyway.
    expect(leads.some((l) => /Incline dumbbell press|Front squat|Close-grip|Trap-bar|Hack squat/i.test(l))).toBe(true);
  });

  it("prefers the stall variation over the variety rotation", () => {
    // Both mechanisms can name the lead. The stall variation is a response to
    // this athlete's lift not moving; the rotation is variety. The specific
    // reason wins, and the note must name the same exercise as the lead —
    // "Back squat" with "Pause Squat replaces the competition squat" beneath
    // it named two different exercises in the same breath.
    const plan = hybrid({ trainingSplit: "ppl" });
    for (const x of plan.weeks.flatMap((w) => w.sessions).filter((z) => z.domain === "strength")) {
      const lead = x.prescription.text.split("·")[0];
      for (const n of x.prescription.notes ?? []) {
        const named = n.match(/^([A-Z][A-Za-z- ]+?) replaces/);
        if (named) expect(lead).toContain(named[1]);
      }
    }
  });

  it("keeps the competition lift when the athlete IS peaking a total", () => {
    // Specificity is the whole point of a peaking block, so the hypertrophy
    // rotation must not fire. Stall variations (pause squat, deficit deadlift)
    // are a different mechanism and remain correct here — they are prescribed
    // BECAUSE the lift stalled, and they still carry a %1RM because they are
    // loaded off the competition lift.
    const plan = hybrid({ trainingSplit: "lift_specific" }, { targetTotalKg: 500 });
    const leads = plan.weeks
      .flatMap((w) => w.sessions)
      .filter((s) => s.domain === "strength")
      .map((s) => s.prescription.text.split("·")[0].trim());
    expect(leads.length).toBeGreaterThan(0);
    expect(leads.some((l) => /Incline dumbbell|Hack squat|Trap-bar/.test(l))).toBe(false);
    // Every peaking lead is loaded, because a peaking block is about the bar.
    for (const l of leads) expect(l).toMatch(/% 1RM/);
  });

  it("does not turn a legs day into an abs day", () => {
    const plan = hybrid({ trainingSplit: "ppl" });
    const legDays = plan.weeks
      .flatMap((w) => w.sessions)
      .filter((s) => s.domain === "strength" && s.lift === "squat");
    for (const s of legDays) {
      const core = s.prescription.text
        .split("·")
        .filter((l) => /plank|woodchop|ab wheel|leg raise/i.test(l));
      expect(core.length).toBeLessThanOrEqual(1);
    }
  });

  it("never prices a variation off the competition lift's 1RM", () => {
    // 70-80% of a bench 1RM printed beside an incline dumbbell press is a
    // weight nobody can press.
    const plan = hybrid({ trainingSplit: "ppl" });
    for (const s of plan.weeks.flatMap((w) => w.sessions).filter((x) => x.domain === "strength")) {
      const lead = s.prescription.text.split("·")[0];
      if (/Incline dumbbell|Front squat|Hack squat|Trap-bar|Close-grip|Romanian/.test(lead)) {
        expect(lead).not.toMatch(/\d+kg/);
      }
    }
  });
});

describe("the plan is built for the event the athlete entered", () => {
  const raceGoal = (key: string, km: number) =>
    goal({ weeksOut: 16, horizonSource: "event_date", enduranceEventKey: key, enduranceEventKm: km, priority: 0.3 });

  function racePlan(key: string, km: number, maxSessionMin = 200) {
    const s = state({ currentRunMinPerWeek: 300, chronicLoad: 600, predicted5kS: 1105 });
    const profile = diagnose(
      [...runs(16, 10, 312, 150), ...runs(6, 20, 335, 146)],
      [],
      s.oneRms,
      { priority: 0.3, hrMax: 192, hrRest: 48, hrMaxSource: "measured" }
    );
    return generatePlan({
      state: s,
      goal: raceGoal(key, km),
      constraints: constraints({ maxSessionsPerWeek: 6, maxHoursPerWeek: 12, maxSessionMin, trainingSplit: "upper_lower" }),
      profile,
    });
  }
  const peakLongKm = (p: ReturnType<typeof generatePlan>) =>
    Math.max(...p.weeks.flatMap((w) => w.sessions.filter((x) => x.kind === "long_run").map((x) => x.prescription.distanceKm ?? 0)));

  it("gives a marathon runner a longer long run than a half runner, and both more than a 5k runner", () => {
    // The athlete said "half marathon" and was handed a 7km long run, because
    // the event never reached the engine — Goal carried target5kS and nothing
    // else, so every endurance athlete was programmed identically.
    const marathon = peakLongKm(racePlan("marathon", 42.195));
    const half = peakLongKm(racePlan("half", 21.0975));
    const fiveK = peakLongKm(racePlan("5k", 5));
    expect(marathon).toBeGreaterThan(half);
    expect(half).toBeGreaterThan(fiveK);
    expect(half).toBeGreaterThan(14);
  });

  it("says so when the athlete's session ceiling cannot fit the long run", () => {
    // Overriding a stated constraint would prescribe a session they have
    // already said they cannot do. Capping silently would hide that a marathon
    // cannot be trained for in 90-minute pieces.
    const capped = racePlan("marathon", 42.195, 90);
    expect(capped.weeks.flatMap((w) => w.notes).join(" ")).toMatch(/longest available session is 90/);
    for (const w of capped.weeks) {
      for (const x of w.sessions) expect(x.minutes).toBeLessThanOrEqual(90);
    }
  });

  it("programmes speed work for a race entrant who never named a target time", () => {
    // Entering a race is a develop goal. Reading only target5kS classified
    // this athlete as MAINTAINING endurance, and maintain never reaches the
    // quality floor — sixteen weeks of long runs and easy runs, no speed work.
    const plan = racePlan("half", 21.0975);
    const kinds = new Set(plan.weeks.flatMap((w) => w.sessions.map((x) => x.kind)));
    expect(kinds.has("interval_run") || kinds.has("threshold_run")).toBe(true);
    const withoutQuality = plan.weeks.filter(
      (w) => !w.deload && !w.sessions.some((x) => x.kind === "interval_run" || x.kind === "threshold_run")
    );
    expect(withoutQuality.map((w) => w.week)).toEqual([]);
  });
});

describe("upper/lower balances across the block", () => {
  it("does not give two lower days and one upper every single week", () => {
    // `slice(0, slots)` took a prefix of a four-day cycle, so three gym days
    // produced Lower, Upper, Lower forever — the slice always began at zero.
    const plan = hybrid({ trainingSplit: "upper_lower", maxSessionsPerWeek: 6 });
    const labels = plan.weeks.flatMap((w) =>
      w.sessions.filter((x) => x.domain === "strength").map((x) => x.label)
    );
    const upper = labels.filter((l) => l === "Upper").length;
    const lower = labels.filter((l) => l === "Lower").length;
    expect(upper).toBeGreaterThan(0);
    expect(lower).toBeGreaterThan(0);
    // Three sessions cannot be two-and-two inside one week; across a block
    // they must come out close to even.
    expect(Math.abs(upper - lower) / (upper + lower)).toBeLessThan(0.2);
  });
});

describe("injury changes the plan without sending anyone to a clinic", () => {
  it("caps intensity but issues no physiotherapist referral", () => {
    const s = state({ safety: { ...DEFAULT_SAFETY_FLAGS, currentInjuryLimiting: true, injuryLast12Weeks: false, surgeryLast6Months: false } });
    const profile = diagnose(runs(14, 8, 300, 148), [], s.oneRms, { priority: 0.5, hrMax: 190, hrRest: 52, hrMaxSource: "measured" });
    const plan = generatePlan({ state: s, goal: goal(), constraints: constraints(), profile });
    expect(plan.generated).toBe(true);
    // The answer must still change something.
    expect(plan.safety.intensityCeiling).toBeLessThan(1);
    expect(plan.safety.rampMultiplier).toBeLessThan(1);
    // This engine improves hybrid performance; it does not refer people.
    expect(plan.safety.referrals.join(" ")).not.toMatch(/physio/i);
    expect(plan.safety.advisories.join(" ")).not.toMatch(/physio/i);
  });

  it("still writes a full, trainable block with every injury answer at its worst", () => {
    // The owner's requirement, verbatim: "i want to make sure the plan will
    // guaranteed work whether it thinks you should not train due to injury or
    // not." Nothing in the safety screen may empty a week — the caps make the
    // sessions easier, they do not remove them, and an athlete who answers yes
    // to everything must still get something to do on every training day.
    const s = state({
      safety: {
        ...DEFAULT_SAFETY_FLAGS,
        currentInjuryLimiting: true,
        injuryLast12Weeks: true,
        surgeryLast6Months: true,
      },
    });
    const profile = diagnose(runs(14, 8, 300, 148), [], s.oneRms, { priority: 0.5, hrMax: 190, hrRest: 52, hrMaxSource: "measured" });
    const plan = generatePlan({ state: s, goal: goal(), constraints: constraints(), profile });

    expect(plan.generated).toBe(true);
    expect(plan.weeks.length).toBeGreaterThan(0);
    for (const week of plan.weeks) {
      expect(week.sessions.length).toBeGreaterThan(0);
    }
    // And the caps stay minimal rather than rewriting the block into rehab.
    expect(plan.safety.intensityCeiling).toBeGreaterThanOrEqual(0.8);
    expect(plan.safety.rampMultiplier).toBeGreaterThanOrEqual(0.5);
  });
});

describe("the predicted 5k respects what the athlete has actually run", () => {
  const easyRuns = (paceS: number) =>
    Array.from({ length: 12 }, (_, i) => ({ dateIdx: i * 3, distanceKm: 10, durationS: 10 * paceS, avgHr: 148 }));

  it("never predicts a 5k slower than a pace already held for longer than 5k", () => {
    // The fallback is a flat 25:00 and the app's benchmark can be stale.
    // Either can land slower than the athlete's own easy running — and since
    // the easy band is derived FROM the predicted 5k, that yields an easy pace
    // quicker than the 5k pace it was calculated from, which the athlete reads
    // as "my easy runs are prescribed slower than I actually jog".
    const fast = diagnose(easyRuns(240), [], {}, { priority: 0.5, hrMax: 190, hrRest: 52 });
    // 4:00/km held for 10km bounds the 5k at 20:00, well inside the 25:00 default.
    expect(fast.predicted5kS).toBeLessThanOrEqual(240 * 5 + 1);
    expect(fast.predicted5kSource).toBe("sustained_pace_bound");
  });

  it("leaves the fallback alone when it is already the tighter number", () => {
    // 5:12/km implies a 26:00 5k, so the 25:00 default is the better claim and
    // the bound must not loosen it. This only ever pulls toward evidence.
    const slow = diagnose(easyRuns(312), [], {}, { priority: 0.5, hrMax: 190, hrRest: 52 });
    expect(slow.predicted5kS).toBeLessThanOrEqual(1500);
    expect(slow.predicted5kSource).toBe("unknown");
  });

  it("does not touch a genuine maximal effort", () => {
    const withEffort = diagnose(
      [...easyRuns(312), { dateIdx: 40, distanceKm: 5, durationS: 1150, avgHr: 185, isMaxEffort: true }],
      [], {}, { priority: 0.5, hrMax: 190, hrRest: 52 }
    );
    expect(withEffort.predicted5kSource).toBe("maximal_effort");
    expect(withEffort.predicted5kS).toBeCloseTo(1150, 0);
  });
});
