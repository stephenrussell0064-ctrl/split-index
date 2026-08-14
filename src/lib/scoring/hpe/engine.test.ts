/**
 * Acceptance tests for WP3-WP8 and the Rev 2 test matrix.
 *
 * The assurance review's warning is worth restating here, because these tests
 * are exactly the dashboard it was warning about: "Both revisions score zero
 * hard-rule violations, and Rev A was not safe to ship. Constraint
 * satisfaction is a necessary condition and a poor proxy for quality."
 * Everything below is necessary. None of it is sufficient.
 */

import { describe, expect, it } from "vitest";
import { diagnose } from "./diagnostics";
import { generatePlan } from "./engine";
import { bodyweightFrontier, classifyDomains, frontierPoint } from "./feasibility";
import { acwrSeries, buildMacrocycle, enforceAcwr } from "./macrocycle";
import { hrBandFor, paceBandFor } from "./prescription";
import { applyLowCapacityDay, autoregulate, compareEmphasis, qualityProgressionFor, racePacing, selectAttempts } from "./progression";
import { hardViolations } from "./scheduler";
import { buildSessionSet, largestRemainderAllocate } from "./session-set";
import { safetyScreen } from "./safety";
import { DEFAULT_SAFETY_FLAGS, type AthleteState, type Constraints, type Goal } from "./intake";
import {
  ACWR_BLOCK,
  DELOAD_EVERY_N_WEEKS,
  EMPHASIS_KEYS,
  MAX_QUALITY_ENDURANCE_SESSIONS,
  MIN_ENDURANCE_SESSION_MIN,
  MIN_HEALTHY_BMI,
  MIN_QUALITY_SESSION_MIN,
} from "./constants";
import type { LiftSet, RunLog } from "./types";

// ---------------------------------------------------------------------------
// Fixtures — the calibration athlete from the Rev B reference
// ---------------------------------------------------------------------------

function calibrationState(overrides: Partial<AthleteState> = {}): AthleteState {
  return {
    bodyweightKg: 83,
    heightCm: 180,
    age: 25,
    sex: "male",
    oneRms: { squat: 160, bench: 140, deadlift: 200 },
    predicted5kS: 19 * 60 + 20,
    strengthTrainingAge: "advanced",
    enduranceTrainingAge: "intermediate",
    strengthTrainingYears: 6,
    enduranceTrainingYears: 2,
    currentRunMinPerWeek: 75,
    currentStrengthSessionsPerWeek: 4,
    chronicLoad: 430,
    restingHr: 52,
    maxHr: 196,
    safety: { ...DEFAULT_SAFETY_FLAGS, injuryLast12Weeks: false, surgeryLast6Months: false },
    assumed: [],
    ...overrides,
  };
}

function calibrationGoal(overrides: Partial<Goal> = {}): Goal {
  return {
    weeksOut: 24,
    horizonSource: "event_date",
    target5kS: 17 * 60 + 30,
    targetSquatKg: 200,
    targetBenchKg: 150,
    targetDeadliftKg: 200,
    targetTotalKg: 550,
    priority: 0.5,
    sameDay: true,
    interEventGapH: 4,
    weightClassKg: 83,
    eventOrderKnown: false,
    ...overrides,
  };
}

function calibrationConstraints(overrides: Partial<Constraints> = {}): Constraints {
  return {
    daysAvailable: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    twoADaysPossible: true,
    dayWindows: [],
    availabilityVaries: false,
    amHour: 7,
    pmHour: 18,
    maxSessionsPerWeek: 9,
    maxHoursPerWeek: 10,
    maxSessionMin: 90,
    minRestDays: 1,
    gymAccessDays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    equipment: ["barbell", "treadmill"],
    ...overrides,
  };
}

/** History that clears tier 2, with the 10k time chosen to produce a given k. */
function historyWithK(tenKSeconds: number): { runs: RunLog[]; sets: LiftSet[] } {
  const runs: RunLog[] = [
    { dateIdx: 0, distanceKm: 5.0, durationS: 1110, avgHr: 181, isMaxEffort: true },
    { dateIdx: 28, distanceKm: 10.0, durationS: tenKSeconds, avgHr: 178, isMaxEffort: true },
  ];
  for (let w = 0; w < 12; w++) {
    runs.push({
      dateIdx: w * 7,
      distanceKm: 8.0,
      durationS: 8 * 285,
      avgHr: 162,
      splitsSPerKm: [283, 284, 285, 285, 287, 288, 290, 292],
      hrByKm: [152, 158, 161, 163, 166, 168, 170, 172],
    });
    runs.push({ dateIdx: w * 7 + 3, distanceKm: 6.0, durationS: 6 * 290, avgHr: 158 });
    runs.push({ dateIdx: w * 7 + 5, distanceKm: 6.0, durationS: 6 * 300, avgHr: 154 });
  }
  const sets: LiftSet[] = [];
  for (let w = 0; w < 12; w++) {
    sets.push(
      { dateIdx: w * 7, lift: "squat", loadKg: 140 + w, reps: 8 },
      { dateIdx: w * 7 + 2, lift: "squat", loadKg: 150 + w, reps: 3 },
      { dateIdx: w * 7 + 1, lift: "bench", loadKg: 110 + w, reps: 8 },
      { dateIdx: w * 7 + 4, lift: "bench", loadKg: 125 + w, reps: 3 },
      { dateIdx: w * 7 + 4, lift: "deadlift", loadKg: 170 + w, reps: 8 },
      { dateIdx: w * 7 + 6, lift: "deadlift", loadKg: 185 + w, reps: 3 }
    );
  }
  return { runs, sets };
}

function calibrationProfile(tenKSeconds = 39 * 60 + 45, priority = 0.5) {
  const { runs, sets } = historyWithK(tenKSeconds);
  return diagnose(runs, sets, { squat: 160, bench: 140, deadlift: 200 }, {
    priority,
    hrMax: 196,
    hrRest: 52,
    hrMaxSource: "measured",
  });
}

// ---------------------------------------------------------------------------
// WP3 — the safety screen (F1, F2)
// ---------------------------------------------------------------------------

describe("WP3 — safety screen blocks and is not bypassable", () => {
  const cases: { name: string; state: AthleteState; goal?: Goal; expectBlock: RegExp }[] = [
    {
      name: "under 18",
      state: calibrationState({ age: 17, safety: { ...DEFAULT_SAFETY_FLAGS, under18: true, injuryLast12Weeks: false, surgeryLast6Months: false } }),
      expectBlock: /Under 18/,
    },
    {
      name: "PAR-Q positive",
      state: calibrationState({ safety: { ...DEFAULT_SAFETY_FLAGS, parqPositive: true, injuryLast12Weeks: false, surgeryLast6Months: false } }),
      expectBlock: /PAR-Q/,
    },
    {
      name: "exertional chest pain",
      state: calibrationState({ safety: { ...DEFAULT_SAFETY_FLAGS, chestPainOnExertion: true, injuryLast12Weeks: false, surgeryLast6Months: false } }),
      expectBlock: /PAR-Q/,
    },
    {
      name: "pregnant or postpartum",
      state: calibrationState({ sex: "female", safety: { ...DEFAULT_SAFETY_FLAGS, pregnantOrPostpartum12wk: true, injuryLast12Weeks: false, surgeryLast6Months: false } }),
      expectBlock: /postpartum/,
    },
    {
      name: "current limiting injury",
      state: calibrationState({ safety: { ...DEFAULT_SAFETY_FLAGS, currentInjuryLimiting: true, injuryLast12Weeks: false, surgeryLast6Months: false } }),
      expectBlock: /injury/,
    },
    {
      name: "under 12 months of lifting with a total target",
      state: calibrationState({ strengthTrainingYears: 0.5 }),
      expectBlock: /peaking block is not appropriate/,
    },
    {
      name: "weight cut declared alongside a same-day race",
      state: calibrationState({ safety: { ...DEFAULT_SAFETY_FLAGS, intendsWeightCut: true, injuryLast12Weeks: false, surgeryLast6Months: false } }),
      expectBlock: /weight cut/,
    },
  ];

  for (const c of cases) {
    it(`blocks: ${c.name}`, () => {
      const result = safetyScreen(c.state, c.goal ?? calibrationGoal());
      expect(result.blocked).toBe(true);
      expect(result.blocks.join(" ")).toMatch(c.expectBlock);
    });
  }

  it("produces a referral or a concrete alternative with every refusal, never a bare no", () => {
    for (const c of cases) {
      const result = safetyScreen(c.state, c.goal ?? calibrationGoal());
      const hasNextStep = result.referrals.length > 0 || result.offerGeneralPreparationInstead;
      expect(hasNextStep, `${c.name} refused with no next step`).toBe(true);
    }
  });

  it("a blocked screen means generatePlan returns no plan at all", () => {
    const plan = generatePlan({
      state: calibrationState({ safety: { ...DEFAULT_SAFETY_FLAGS, parqPositive: true } }),
      goal: calibrationGoal(),
      constraints: calibrationConstraints(),
      profile: calibrationProfile(),
    });
    expect(plan.generated).toBe(false);
    expect(plan.weeks).toHaveLength(0);
    expect(plan.refusal?.nextSteps.length).toBeGreaterThan(0);
  });

  it("suppresses bodyweight guidance on one LEA flag but still generates a plan", () => {
    const state = calibrationState({ safety: { ...DEFAULT_SAFETY_FLAGS, leaRiskFlags: 1, injuryLast12Weeks: false, surgeryLast6Months: false } });
    const screen = safetyScreen(state, calibrationGoal());
    expect(screen.blocked).toBe(false);
    expect(screen.showBodyweightGuidance).toBe(false);
    expect(bodyweightFrontier(state, screen.showBodyweightGuidance).points).toHaveLength(0);
  });

  it("suppresses bodyweight guidance below the BMI floor", () => {
    // 55kg at 180cm is BMI 17.0.
    const state = calibrationState({ bodyweightKg: 55 });
    expect(safetyScreen(state, calibrationGoal()).showBodyweightGuidance).toBe(false);
  });

  it("halves the ramp for a novice runner and for a recent injury", () => {
    expect(safetyScreen(calibrationState({ enduranceTrainingYears: 0.2 }), calibrationGoal()).rampMultiplier).toBe(0.5);
    expect(
      safetyScreen(calibrationState({ safety: { ...DEFAULT_SAFETY_FLAGS, injuryLast12Weeks: true } }), calibrationGoal())
        .rampMultiplier
    ).toBe(0.5);
  });

  it("switches to pace and RPE when medication affects heart rate", () => {
    const state = calibrationState({ safety: { ...DEFAULT_SAFETY_FLAGS, medicationAffectingHr: true, injuryLast12Weeks: false, surgeryLast6Months: false } });
    const plan = generatePlan({ state, goal: calibrationGoal(), constraints: calibrationConstraints(), profile: calibrationProfile() });
    expect(plan.generated).toBe(true);
    const allText = plan.weeks.flatMap((w) => w.sessions.map((s) => s.prescription.text)).join(" ");
    expect(allText).not.toMatch(/HR \d+-\d+/);
    expect(allText).toMatch(/pace and RPE/);
  });
});

// ---------------------------------------------------------------------------
// WP4 — feasibility and the bounded frontier (F7)
// ---------------------------------------------------------------------------

describe("WP4 — the frontier refuses to extrapolate", () => {
  const state = calibrationState();

  it("returns null beyond ±8% bodyweight — no 14:10 5k at 60kg", () => {
    expect(frontierPoint(state, 60)).toBeNull();
    expect(frontierPoint(state, 95)).toBeNull();
    expect(frontierPoint(state, 78)).not.toBeNull();
  });

  it("returns null below the BMI floor even inside the ±8% band", () => {
    // 62kg at 180cm is BMI 19.1 — above the floor, so the athlete themselves
    // is reportable. A 4% cut to 59.5kg lands at BMI 18.4, below it. The
    // ±8% bound alone would permit that row; the BMI floor is what stops it.
    const light = calibrationState({ bodyweightKg: 62 });
    expect(light.bodyweightKg / (light.heightCm / 100) ** 2).toBeGreaterThan(MIN_HEALTHY_BMI);
    expect(59.5 / (light.heightCm / 100) ** 2).toBeLessThan(MIN_HEALTHY_BMI);
    expect(frontierPoint(light, 59.5)).toBeNull();
    // Upward from the same weight is still reportable — the floor is a floor,
    // not a blanket refusal.
    expect(frontierPoint(light, 65)).not.toBeNull();
  });

  it("states how many weeks each row would take, reframing it as a cost", () => {
    const point = frontierPoint(state, 78)!;
    expect(point.minWeeks).toBeGreaterThan(0);
    expect(point.projectedTotalKg).toBeLessThan(500);
  });

  it("emits no calorie, macro or rate-of-loss output anywhere in a generated plan", () => {
    const plan = generatePlan({
      state,
      goal: calibrationGoal(),
      constraints: calibrationConstraints(),
      profile: calibrationProfile(),
    });
    const everything = JSON.stringify(plan).toLowerCase();
    // Note "rehydration deficit" appears legitimately in the event-day plan
    // and is a fluid deficit, not an energy one — hence the specific phrases
    // rather than a bare "deficit".
    const forbidden = [
      "calorie",
      "kcal",
      "macro split",
      "energy deficit",
      "calorie deficit",
      "protein target",
      "rate of loss",
      "per week weight loss",
      "cut to ",
    ];
    for (const phrase of forbidden) {
      expect(everything, `plan mentioned "${phrase}"`).not.toContain(phrase);
    }
  });

  it("classifies a domain with no target as maintain, which still means a minimum dose", () => {
    // All four must be cleared: per-lift targets now count as a strength goal
    // in their own right, which is the point of asking for them separately.
    const mode = classifyDomains(
      state,
      calibrationGoal({ targetTotalKg: null, targetSquatKg: null, targetBenchKg: null, targetDeadliftKg: null })
    );
    expect(mode.strength).toBe("maintain");
    expect(mode.endurance).toBe("develop");
  });
});

// ---------------------------------------------------------------------------
// WP5 — macrocycle: on-ramp, deloads, progression, ACWR (F3-F6)
// ---------------------------------------------------------------------------

describe("WP5 — the macrocycle", () => {
  const state = calibrationState();
  const macro = buildMacrocycle(state, calibrationGoal());

  it("F3: week 1 is exactly what the athlete is already doing", () => {
    expect(macro[0].enduranceMin).toBe(Math.round(state.currentRunMinPerWeek));
  });

  it("F4: a deload lands every fourth week", () => {
    const deloads = macro.filter((w) => w.deload).map((w) => w.week);
    expect(deloads.length).toBeGreaterThanOrEqual(4);
    for (const w of deloads) expect(w % DELOAD_EVERY_N_WEEKS).toBe(0);
    // Volume drops on a deload; intensity is held (the phase does not change).
    for (const w of macro.filter((x) => x.deload)) {
      const prior = macro.find((x) => x.week === w.week - 1);
      if (prior && !prior.deload) expect(w.enduranceMin).toBeLessThan(prior.enduranceMin);
    }
  });

  it("F5: volume genuinely progresses rather than repeating the same week", () => {
    const peak = Math.max(...macro.map((w) => w.enduranceMin));
    expect(peak).toBeGreaterThan(macro[0].enduranceMin * 1.5);
  });

  it("never ramps faster than 8% week on week", () => {
    for (let i = 1; i < macro.length; i++) {
      if (macro[i].deload || macro[i - 1].deload || macro[i].phase === "taper") continue;
      // enduranceMin is rounded to whole minutes, so a true 8.00% step can
      // display as up to 8.5% on small numbers. The +1 absorbs the rounding
      // without loosening the underlying cap.
      expect(macro[i].enduranceMin).toBeLessThanOrEqual(macro[i - 1].enduranceMin * 1.08 + 1);
    }
  });

  it("halves the ramp when the safety screen says to", () => {
    const halved = buildMacrocycle(state, calibrationGoal(), 0.5);
    expect(Math.max(...halved.map((w) => w.enduranceMin))).toBeLessThan(
      Math.max(...macro.map((w) => w.enduranceMin))
    );
  });

  it("holds volume flat through specific and peak while intensity rises", () => {
    const late = macro.filter((w) => (w.phase === "specific" || w.phase === "peak") && !w.deload);
    const volumes = new Set(late.map((w) => w.enduranceMin));
    expect(volumes.size).toBeLessThanOrEqual(2);
  });

  it("F6: ACWR is seeded from real chronic load, not zero", () => {
    const flat = Array.from({ length: 6 }, () => 430);
    const ratios = acwrSeries(flat, 430);
    expect(ratios[0]).toBeCloseTo(1.0, 6);
    // Unseeded, week 1 would be a divide-by-zero or an infinite spike.
    expect(acwrSeries(flat, 0)[0]).toBe(0);
  });

  it("F6: enforcement actually caps a breaching week, not merely flags it", () => {
    const spiking = [430, 430, 430, 2000, 430, 430];
    const before = acwrSeries(spiking, 430);
    expect(Math.max(...before)).toBeGreaterThan(ACWR_BLOCK);
    const after = enforceAcwr(
      spiking.map((_, i) => ({ week: i + 1, phase: "base" as const, deload: false, enduranceMin: 60, phaseProgress: 0 })),
      spiking,
      430
    );
    expect(after.peakAcwr).toBeLessThanOrEqual(ACWR_BLOCK + 1e-9);
    expect(after.notes.length).toBeGreaterThan(0);
    expect(after.cappedStress[3]).toBeLessThan(2000);
  });
});

// ---------------------------------------------------------------------------
// WP6 — emphasis-driven session selection: THE product claim
// ---------------------------------------------------------------------------

describe("WP6 — individualisation", () => {
  it("largest-remainder allocation sums exactly to the slot count", () => {
    for (const total of [0, 1, 3, 5, 7, 9]) {
      const out = largestRemainderAllocate([0.5, 0.2, 0.15, 0.1, 0.05], total);
      expect(out.reduce((s, v) => s + v, 0)).toBe(total);
    }
  });

  it("two athletes with the SAME 5k but opposite k get materially different weeks", () => {
    // Both ran 18:30 for 5k. The only difference is how they fade over 10k.
    const enduranceLimited = calibrationProfile(39 * 60 + 45); // k ≈ 1.103
    const speedLimited = calibrationProfile(37 * 60 + 47); // k ≈ 1.03

    expect(enduranceLimited.riegelK! > 1.075).toBe(true);
    expect(speedLimited.riegelK! < 1.045).toBe(true);
    expect(enduranceLimited.predicted5kS).toBeCloseTo(speedLimited.predicted5kS, 0);

    // Compared across the whole block rather than one week: in any single
    // week the integer slot count can coincide, and the claim is about the
    // plan, not about week seven.
    const macro = buildMacrocycle(calibrationState(), calibrationGoal());
    const blockFor = (profile: typeof enduranceLimited) =>
      macro.reduce(
        (acc, week) => {
          const { allocation, sessions } = buildSessionSet({
            profile,
            week,
            mode: { strength: "develop", endurance: "develop" },
            goal: calibrationGoal(),
            constraints: calibrationConstraints(),
          });
          acc.aerobic += allocation.aerobic_base;
          acc.vo2max += allocation.vo2max_speed;
          acc.kinds.push(...sessions.map((s) => s.kind));
          return acc;
        },
        { aerobic: 0, vo2max: 0, kinds: [] as string[] }
      );

    const blockA = blockFor(enduranceLimited);
    const blockB = blockFor(speedLimited);

    // The endurance-limited athlete gets more easy volume; the speed-limited
    // one gets more vVO2max work. That difference IS the product claim.
    expect(blockA.aerobic).toBeGreaterThan(blockB.aerobic);
    expect(blockB.vo2max).toBeGreaterThan(blockA.vo2max);
    expect(blockA.kinds.sort().join(",")).not.toBe(blockB.kinds.sort().join(","));
  });

  it("never schedules more than three quality endurance sessions", () => {
    for (const tenK of [37 * 60 + 47, 39 * 60 + 45, 41 * 60]) {
      const profile = calibrationProfile(tenK);
      for (const week of buildMacrocycle(calibrationState(), calibrationGoal())) {
        const { sessions } = buildSessionSet({
          profile,
          week,
          mode: { strength: "develop", endurance: "develop" },
          goal: calibrationGoal(),
          constraints: calibrationConstraints(),
        });
        const quality = sessions.filter((s) => s.domain === "endurance" && s.isQuality).length;
        expect(quality).toBeLessThanOrEqual(MAX_QUALITY_ENDURANCE_SESSIONS);
      }
    }
  });

  it("never schedules more than one heavy lower-body day", () => {
    const profile = calibrationProfile();
    for (const week of buildMacrocycle(calibrationState(), calibrationGoal())) {
      const { sessions } = buildSessionSet({
        profile,
        week,
        mode: { strength: "develop", endurance: "develop" },
        goal: calibrationGoal(),
        constraints: calibrationConstraints(),
      });
      expect(sessions.filter((s) => s.isHeavyLower && s.lift === "squat").length).toBeLessThanOrEqual(1);
    }
  });

  it("reserves a long run in every non-taper week", () => {
    const profile = calibrationProfile();
    for (const week of buildMacrocycle(calibrationState(), calibrationGoal())) {
      if (week.phase === "taper") continue;
      const { sessions } = buildSessionSet({
        profile,
        week,
        mode: { strength: "develop", endurance: "develop" },
        goal: calibrationGoal(),
        constraints: calibrationConstraints(),
      });
      expect(sessions.some((s) => s.kind === "long_run"), `week ${week.week} had no long run`).toBe(true);
    }
  });

  it("keeps the minimum maintenance dose for a domain in maintain mode", () => {
    const profile = calibrationProfile();
    const { sessions } = buildSessionSet({
      profile,
      week: buildMacrocycle(calibrationState(), calibrationGoal())[4],
      mode: { strength: "maintain", endurance: "develop" },
      goal: calibrationGoal({ targetTotalKg: null }),
      constraints: calibrationConstraints(),
    });
    const strength = sessions.filter((s) => s.domain === "strength");
    expect(strength.length).toBeGreaterThanOrEqual(1);
    // Spiering: maintenance works because INTENSITY is held. Dropping it too
    // would be detraining dressed up as a deload.
    for (const s of strength) expect(s.intensity).toBeGreaterThanOrEqual(0.8);
  });
});

// ---------------------------------------------------------------------------
// WP7 — prescription resolution (F9)
// ---------------------------------------------------------------------------

describe("WP7 — every session is an executable prescription", () => {
  const profile = calibrationProfile();
  const plan = generatePlan({
    state: calibrationState(),
    goal: calibrationGoal(),
    constraints: calibrationConstraints(),
    profile,
  });

  it("generates a plan for the calibration athlete", () => {
    expect(plan.generated).toBe(true);
    expect(plan.weeks.length).toBe(24);
    expect(plan.constantsVersion).toBe(profile.constantsVersion);
  });

  it("every endurance session carries a distance, a duration and a pace band", () => {
    for (const week of plan.weeks) {
      for (const s of week.sessions.filter((x) => x.domain === "endurance")) {
        expect(s.prescription.distanceKm, s.kind).toBeGreaterThan(0);
        expect(s.prescription.minutes, s.kind).toBeGreaterThan(0);
        expect(s.prescription.text).toMatch(/\d+:\d{2}\/km/);
        expect(s.prescription.text).toMatch(/km/);
      }
    }
  });

  it("every endurance session states an HR band with its source, or says HR is not the target", () => {
    for (const week of plan.weeks) {
      for (const s of week.sessions.filter((x) => x.domain === "endurance")) {
        const text = s.prescription.text;
        const hasSourcedHr = /HR \d+-\d+ \(.+?\)/.test(text);
        const saysNotTheTarget = /HR is not the target/.test(text);
        expect(hasSourcedHr || saysNotTheTarget, `${s.kind}: ${text}`).toBe(true);
      }
    }
  });

  it("labels the fallback honestly when the pace is outside the fitted regression range", () => {
    // The athlete's HR model is fitted on easy running only, so interval pace
    // must fall back rather than extrapolate — and must say so.
    const band = paceBandFor(profile, "interval_run");
    const hr = hrBandFor(profile, "interval_run", band)!;
    expect(hr.source).toMatch(/outside the range your own HR data covers/);
    expect(hr.hi).toBeLessThanOrEqual(profile.hrMax);
  });

  it("uses the athlete's own regression when the pace IS inside its fitted range", () => {
    const model = profile.hrPaceModel!;
    const insidePace = 3600 / ((model.loKph + model.hiKph) / 2);
    const hr = hrBandFor(profile, "threshold_run", { lo: insidePace, hi: insidePace })!;
    expect(hr.source).toMatch(/your own HR-vs-pace data/);
  });

  it("no prescribed heart rate ever exceeds the athlete's max HR", () => {
    for (const week of plan.weeks) {
      for (const s of week.sessions) {
        if (s.prescription.hrHi != null) expect(s.prescription.hrHi).toBeLessThanOrEqual(profile.hrMax);
        if (s.prescription.hrLo != null) expect(s.prescription.hrLo).toBeLessThanOrEqual(profile.hrMax);
        for (const match of s.prescription.text.matchAll(/HR (\d+)-(\d+)/g)) {
          expect(Number(match[2])).toBeLessThanOrEqual(profile.hrMax);
        }
      }
    }
  });

  it("makes the upper HR bound the primary instruction on easy days", () => {
    const easy = plan.weeks
      .flatMap((w) => w.sessions)
      .find((s) => s.kind === "easy_run" || s.kind === "long_run");
    expect(easy!.prescription.text).toMatch(/Do not exceed \d+/);
  });

  it("anchors easy pace to the diagnostic's band, never to the naive 5k multiplier", () => {
    const band = paceBandFor(profile, "easy_run");
    expect(band.lo).toBeCloseTo(profile.easyBand!.lo, 6);
    // The 5k multiplier would be materially faster and must not govern.
    expect(band.lo).toBeGreaterThan(profile.easyBand!.candidates["5k_multiplier"]!.lo);
  });

  it("every lift prescription carries kg, %1RM, sets, reps and RIR", () => {
    for (const week of plan.weeks) {
      for (const s of week.sessions.filter((x) => x.domain === "strength")) {
        expect(s.prescription.text).toMatch(/\d+x\d+(-\d+)?/);
        expect(s.prescription.text).toMatch(/% 1RM/);
        expect(s.prescription.text).toMatch(/RIR/);
      }
    }
  });

  it("pairs load and rep range coherently — no heavy-single rep target at sub-maximal load", () => {
    // Regression: taking the rep range from the emphasis dimension and the
    // load from the phase produced "4x1-3 @ 65-75% 1RM", which is neither a
    // heavy single nor a volume set. Load and reps have to move together.
    for (const week of plan.weeks) {
      for (const s of week.sessions.filter((x) => x.domain === "strength")) {
        const reps = /(\d+)x(\d+)-(\d+)/.exec(s.prescription.text);
        const pct = /\((\d+)-(\d+)% 1RM\)/.exec(s.prescription.text);
        if (!reps || !pct) continue;
        const topReps = Number(reps[3]);
        const lowPct = Number(pct[1]);
        // A 1-3 rep prescription must be genuinely heavy.
        if (topReps <= 3) expect(lowPct, s.prescription.text).toBeGreaterThanOrEqual(80);
        // A 6+ rep prescription must not be at near-maximal load.
        if (topReps >= 6) expect(lowPct, s.prescription.text).toBeLessThanOrEqual(85);
      }
    }
  });

  it("never prescribes a weak-lift session for an athlete with no weak lift", () => {
    expect(profile.weakLift).toBeNull();
    for (const week of plan.weeks) {
      for (const s of week.sessions) {
        expect(s.kind, "weak-lift session with no weak-lift finding").not.toBe("weak_lift_exposure");
      }
    }
  });

  it("does prescribe the extra exposure when there IS a weak lift", () => {
    const weak = diagnose(
      historyWithK(39 * 60 + 45).runs,
      historyWithK(39 * 60 + 45).sets,
      // Bench far below its norm ratio to squat.
      { squat: 200, bench: 100, deadlift: 240 },
      { hrMax: 196, hrRest: 52 }
    );
    expect(weak.weakLift).toBe("bench");
    const weekSet = buildSessionSet({
      profile: weak,
      week: buildMacrocycle(calibrationState(), calibrationGoal())[8],
      mode: { strength: "develop", endurance: "develop" },
      goal: calibrationGoal(),
      constraints: calibrationConstraints(),
    });
    const weakSessions = weekSet.sessions.filter((s) => s.kind === "weak_lift_exposure");
    expect(weakSessions.length).toBeGreaterThan(0);
    for (const s of weakSessions) {
      expect(s.lift).toBe("bench");
      expect(s.findingId).toBe("weak-lift");
    }
  });

  it("never prescribes a session too short to be one", () => {
    for (const week of plan.weeks) {
      for (const s of week.sessions.filter((x) => x.domain === "endurance")) {
        expect(s.minutes, `${s.kind} was ${s.minutes}min`).toBeGreaterThanOrEqual(MIN_ENDURANCE_SESSION_MIN);
        if (s.isQuality && s.kind !== "long_run") {
          expect(s.minutes, `${s.kind} was ${s.minutes}min`).toBeGreaterThanOrEqual(MIN_QUALITY_SESSION_MIN);
        }
      }
    }
  });

  it("keeps strength in the week even for a strongly endurance-tilted athlete", () => {
    // Regression: a single seven-way allocation across the whole week let an
    // endurance-tilted vector round every strength dimension to zero, and the
    // session cap then truncated strength away entirely.
    const endurancePriority = generatePlan({
      state: calibrationState(),
      goal: calibrationGoal({ priority: 0.1 }),
      constraints: calibrationConstraints({ maxSessionsPerWeek: 8 }),
      profile: calibrationProfile(39 * 60 + 45, 0.1),
    });
    for (const week of endurancePriority.weeks) {
      expect(week.sessions.some((s) => s.domain === "strength"), `week ${week.week} had no strength work`).toBe(true);
      expect(week.sessions.some((s) => s.domain === "endurance"), `week ${week.week} had no running`).toBe(true);
    }
  });

  it("reports cadence but never prescribes it", () => {
    const everything = JSON.stringify(plan).toLowerCase();
    expect(everything).not.toMatch(/(target|aim for|increase your) cadence/);
  });

  it("schedules zero hard-rule violations across the whole block", () => {
    const constraints = calibrationConstraints();
    const total = plan.weeks.reduce((s, w) => s + hardViolations(w.placements, constraints), 0);
    expect(total).toBe(0);
  });

  it("is deterministic — the same input produces byte-identical output", () => {
    const again = generatePlan({
      state: calibrationState(),
      goal: calibrationGoal(),
      constraints: calibrationConstraints(),
      profile: calibrationProfile(),
    });
    expect(JSON.stringify(again)).toBe(JSON.stringify(plan));
  });
});

// ---------------------------------------------------------------------------
// Traceability — non-negotiable #7
// ---------------------------------------------------------------------------

describe("traceability", () => {
  it("every session in every week maps to a named diagnostic finding", () => {
    const profile = calibrationProfile();
    const plan = generatePlan({
      state: calibrationState(),
      goal: calibrationGoal(),
      constraints: calibrationConstraints(),
      profile,
    });
    const known = new Set([...profile.findings.map((f) => f.id), "hybrid-baseline"]);
    for (const week of plan.weeks) {
      for (const s of week.sessions) {
        expect(s.findingId, `${s.kind} had no finding`).toBeTruthy();
        expect(known.has(s.findingId), `${s.kind} cited unknown finding ${s.findingId}`).toBe(true);
        expect(s.prescription.findingId).toBe(s.findingId);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Data sufficiency — tier 0 returns no plan
// ---------------------------------------------------------------------------

describe("data sufficiency — labelled, never refused", () => {
  it("still generates a plan at tier 0, and says plainly that it is provisional", () => {
    // The behaviour change: refusing after eight sections of questions taught
    // the athlete nothing and lost them. A labelled provisional plan gives
    // them something to do today and a reason to log it.
    const profile = diagnose([], [], {}, { hrMax: 190, hrRest: 55 });
    expect(profile.tier).toBe(0);

    const plan = generatePlan({
      state: calibrationState(),
      goal: calibrationGoal(),
      constraints: calibrationConstraints(),
      profile,
    });

    expect(plan.generated).toBe(true);
    expect(plan.weeks.length).toBeGreaterThan(0);
    expect(plan.refusal).toBeNull();
    expect(plan.tailoring!.level).toBe("provisional");
    expect(plan.tailoring!.isProvisional).toBe(true);
    expect(plan.tailoring!.headline).toMatch(/not yet a personal one/i);
  });

  it("pays for the uncertainty in caution rather than in a refusal", () => {
    // A provisional plan must ramp more slowly than a diagnosed one from the
    // same starting volume. Being wrong about a beginner should cost them a
    // fortnight of easy running, not an injury.
    const args = { state: calibrationState(), goal: calibrationGoal(), constraints: calibrationConstraints() };
    const provisional = generatePlan({ ...args, profile: diagnose([], [], {}, { hrMax: 190, hrRest: 55 }) });
    const diagnosed = generatePlan({ ...args, profile: calibrationProfile() });

    const peak = (p: typeof provisional) => Math.max(...p.weeks.map((w) => w.enduranceMin));
    expect(peak(provisional)).toBeLessThan(peak(diagnosed));
    expect(provisional.tailoring!.rampMultiplier).toBeLessThan(diagnosed.tailoring!.rampMultiplier);
  });

  it("names what to do next, and what each thing specifically unlocks", () => {
    const plan = generatePlan({
      state: calibrationState(),
      goal: calibrationGoal(),
      constraints: calibrationConstraints(),
      profile: diagnose([], [], {}, { hrMax: 190, hrRest: 55 }),
    });
    const unlocks = plan.tailoring!.unlocks;
    expect(unlocks.length).toBeGreaterThan(0);
    // "Log more runs" is a chore. "A second maximal effort unlocks your
    // personal fatigue-resistance model" is a reason.
    for (const u of unlocks) {
      expect(u.action.length).toBeGreaterThan(10);
      expect(u.unlocks.length).toBeGreaterThan(20);
    }
    expect(unlocks.map((u) => u.unlocks).join(" ")).toMatch(/fatigue-resistance/);
  });

  it("still refuses on safety, which is not a data gap", () => {
    // The line that did NOT move. More logging fills a missing bodyweight; it
    // does not fill exertional chest pain.
    const plan = generatePlan({
      state: calibrationState({ safety: { ...DEFAULT_SAFETY_FLAGS, chestPainOnExertion: true } }),
      goal: calibrationGoal(),
      constraints: calibrationConstraints(),
      profile: calibrationProfile(),
    });
    expect(plan.generated).toBe(false);
    expect(plan.weeks).toHaveLength(0);
    expect(plan.refusal!.nextSteps.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// WP8 — F15 to F18
// ---------------------------------------------------------------------------

describe("WP8 — F15: quality sessions progress across the block", () => {
  const profile = calibrationProfile();
  const goal = calibrationGoal();
  const macro = buildMacrocycle(calibrationState(), goal);

  it("interval sessions gain reps, lose recovery and quicken across the block", () => {
    const early = qualityProgressionFor("interval_run", macro[1], profile, goal);
    const late = qualityProgressionFor("interval_run", macro[macro.length - 4], profile, goal);
    expect(late.intervalReps!).toBeGreaterThan(early.intervalReps!);
    expect(late.intervalRecoveryS!).toBeLessThan(early.intervalRecoveryS!);
    expect(late.paceOverride!.lo).toBeLessThan(early.paceOverride!.lo);
  });

  it("threshold blocks lengthen across the block", () => {
    const early = qualityProgressionFor("threshold_run", macro[1], profile, goal);
    const late = qualityProgressionFor("threshold_run", macro[macro.length - 4], profile, goal);
    expect(late.thresholdBlockMin!).toBeGreaterThan(early.thresholdBlockMin!);
  });

  it("never prescribes faster than the athlete's own target pace", () => {
    const targetPace = goal.target5kS! / 5;
    for (const week of macro) {
      const p = qualityProgressionFor("interval_run", week, profile, goal);
      // The band's fast end sits at 0.96 x the anchor; the anchor itself must
      // never pass the target.
      expect(p.paceOverride!.lo / 0.96).toBeGreaterThanOrEqual(targetPace - 1e-6);
    }
  });

  it("the same week number does not produce the same session twice in a block", () => {
    const plan = generatePlan({
      state: calibrationState(),
      goal,
      constraints: calibrationConstraints(),
      profile,
    });
    const intervals = plan.weeks
      .flatMap((w) => w.sessions)
      .filter((s) => s.kind === "interval_run")
      .map((s) => s.prescription.text);
    if (intervals.length > 1) expect(new Set(intervals).size).toBeGreaterThan(1);
  });
});

describe("WP8 — F16: autoregulation", () => {
  const base = { kind: "easy_run", completed: true, sessionRpe: 4, metPrescription: true };

  it("does nothing without feedback", () => {
    expect(autoregulate([]).triggered).toBe(false);
    expect(autoregulate([{ ...base, loggedAt: "2026-01-01" }]).volumeMultiplier).toBe(1);
  });

  it("reduces the following week after three consecutive sessions below prescription", () => {
    const feedback = ["2026-01-01", "2026-01-02", "2026-01-03"].map((loggedAt) => ({
      ...base,
      metPrescription: false,
      loggedAt,
    }));
    const result = autoregulate(feedback);
    expect(result.triggered).toBe(true);
    expect(result.volumeMultiplier).toBeLessThan(1);
    expect(result.reasons[0]).toMatch(/under prescription/);
  });

  it("reduces when session RPE overshoots the expected value by more than two", () => {
    const result = autoregulate([{ kind: "easy_run", completed: true, sessionRpe: 8, metPrescription: true, loggedAt: "2026-01-01" }]);
    expect(result.triggered).toBe(true);
    expect(result.reasons[0]).toMatch(/RPE 8/);
  });

  it("only ever reduces — an easy week never ramps the plan up", () => {
    const result = autoregulate(
      ["2026-01-01", "2026-01-02", "2026-01-03"].map((loggedAt) => ({ ...base, sessionRpe: 1, loggedAt }))
    );
    expect(result.volumeMultiplier).toBeLessThanOrEqual(1);
  });

  it("feeds through to the generated week's volume", () => {
    const feedback = ["2026-01-01", "2026-01-02", "2026-01-03"].map((loggedAt) => ({
      ...base,
      metPrescription: false,
      loggedAt,
    }));
    const plan = generatePlan({
      state: calibrationState(),
      goal: calibrationGoal(),
      constraints: calibrationConstraints(),
      profile: calibrationProfile(),
      feedbackByWeek: { 5: feedback },
    });
    expect(plan.weeks[5].notes.join(" ")).toMatch(/reduced|steps back/i);
  });
});

describe("WP8 — F17: low-capacity day", () => {
  it("swaps the hardest quality session for an easy one and says the quality is not lost", () => {
    const sessions = [
      { kind: "easy_run", isQuality: false, intensity: 0.35 },
      { kind: "interval_run", isQuality: true, intensity: 0.95 },
      { kind: "threshold_run", isQuality: true, intensity: 0.8 },
    ];
    const result = applyLowCapacityDay(sessions, (s) => ({ ...s, kind: "easy_run", isQuality: false, intensity: 0.35 }));
    expect(result.swapped).toBe(true);
    expect(result.sessions[1].kind).toBe("easy_run");
    expect(result.note).toMatch(/moves to the next week/);
  });

  it("does nothing when there is no quality session to swap", () => {
    const result = applyLowCapacityDay([{ kind: "easy_run", isQuality: false, intensity: 0.35 }], (s) => s);
    expect(result.swapped).toBe(false);
  });
});

describe("WP8 — F18: attempt selection and race pacing", () => {
  it("sets openers, seconds and thirds at the right fractions of expected best", () => {
    const attempts = selectAttempts({ squat: 200, bench: 140, deadlift: 240 }, false);
    const squat = attempts.find((a) => a.lift === "squat")!;
    expect(squat.opener / 200).toBeGreaterThanOrEqual(0.9);
    expect(squat.opener / 200).toBeLessThanOrEqual(0.94);
    expect(squat.second).toBeGreaterThan(squat.opener);
    expect(squat.third).toBeGreaterThan(squat.second);
  });

  it("opens more conservatively on a dual-event day", () => {
    const solo = selectAttempts({ squat: 200 }, false)[0];
    const dual = selectAttempts({ squat: 200 }, true)[0];
    expect(dual.opener).toBeLessThan(solo.opener);
    expect(dual.note).toMatch(/racing the same day/);
  });

  it("slows the first kilometre when the race follows a meet", () => {
    const solo = racePacing(1050, false);
    const afterMeet = racePacing(1050, true);
    expect(afterMeet.firstKmPaceSPerKm).toBeGreaterThan(solo.firstKmPaceSPerKm);
    expect(afterMeet.note).toMatch(/protect the back half/);
  });
});

describe("WP8 — Rev 2: the diagnostic re-runs and the plan says what changed", () => {
  it("regenerates when any dimension shifts by more than 0.10, and explains it", () => {
    const previous = Object.fromEntries(EMPHASIS_KEYS.map((k) => [k, 1 / EMPHASIS_KEYS.length])) as Record<string, number>;
    const next = { ...previous, aerobic_base: previous.aerobic_base + 0.2, vo2max_speed: previous.vo2max_speed - 0.2 };
    const drift = compareEmphasis(previous as never, next as never);
    expect(drift.shouldRegenerate).toBe(true);
    expect(drift.explanations.join(" ")).toMatch(/aerobic base up/);
  });

  it("leaves the plan alone for a small shift", () => {
    const previous = Object.fromEntries(EMPHASIS_KEYS.map((k) => [k, 1 / EMPHASIS_KEYS.length])) as Record<string, number>;
    const next = { ...previous, aerobic_base: previous.aerobic_base + 0.02 };
    expect(compareEmphasis(previous as never, next as never).shouldRegenerate).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// F11 — the safety block that is not a costed trade-off
// ---------------------------------------------------------------------------

describe("F11 — deadlifting after a maximal 5k is a safety block", () => {
  const plan = generatePlan({
    state: calibrationState(),
    goal: calibrationGoal(),
    constraints: calibrationConstraints(),
    profile: calibrationProfile(),
  });

  it("marks race-first unsafe and recommends meet-first anyway", () => {
    const order = plan.eventOrder!;
    const raceFirst = order.options.find((o) => o.order.startsWith("5k"))!;
    expect(raceFirst.safe).toBe(false);
    expect(order.recommended).toMatch(/^Powerlifting/);
    expect(order.safetyConstrained).toBe(true);
  });

  it("recommends meet-first even when the cost model prefers race-first", () => {
    const order = plan.eventOrder!;
    const raceFirst = order.options.find((o) => o.order.startsWith("5k"))!;
    const meetFirst = order.options.find((o) => o.order.startsWith("Powerlifting"))!;
    if (raceFirst.weightedCostPct < meetFirst.weightedCostPct) {
      expect(order.recommended).toBe(meetFirst.order);
    }
  });

  it("includes a re-warm-up before the second event", () => {
    expect(plan.eventDay!.some((s) => /re-warm-up/i.test(s.note))).toBe(true);
  });

  it("F12: taper carbohydrate guidance is not a marathon load", () => {
    const carbDay = plan.taper.find((d) => d.day === -1)!;
    expect(carbDay.note).toMatch(/6-7g\/kg/);
    expect(carbDay.note).toMatch(/NOT a marathon-style/);
    expect(carbDay.note).toMatch(/No weight cut/);
  });
});

// ---------------------------------------------------------------------------
// Property tests across randomised athletes
// ---------------------------------------------------------------------------

describe("safety properties across randomised athletes", () => {
  function makeRng(seed: number) {
    let state = seed >>> 0;
    return () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 4294967296;
    };
  }

  it("no prescribed HR exceeds max HR, and no plan overbooks the week", { timeout: 120_000 }, () => {
    for (let seed = 1; seed <= 30; seed++) {
      const rng = makeRng(seed);
      const hrRest = 40 + Math.floor(rng() * 30);
      const hrMax = hrRest + 90 + Math.floor(rng() * 70);
      const tenK = 2200 + Math.floor(rng() * 700);
      const { runs, sets } = historyWithK(tenK);
      const profile = diagnose(runs, sets, { squat: 100 + rng() * 120, bench: 60 + rng() * 90, deadlift: 120 + rng() * 140 }, {
        priority: rng(),
        hrMax,
        hrRest,
      });
      const maxSessions = 4 + Math.floor(rng() * 6);
      const daysAvailable = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].slice(0, 3 + Math.floor(rng() * 5));
      const plan = generatePlan({
        state: calibrationState({ restingHr: hrRest, maxHr: hrMax, currentRunMinPerWeek: 30 + rng() * 200 }),
        goal: calibrationGoal({ weeksOut: 8 + Math.floor(rng() * 40), priority: rng() }),
        constraints: calibrationConstraints({ maxSessionsPerWeek: maxSessions, daysAvailable, gymAccessDays: daysAvailable }),
        profile,
      });
      if (!plan.generated) continue;

      for (const week of plan.weeks) {
        expect(week.sessions.length).toBeLessThanOrEqual(maxSessions);
        expect(week.placements.length).toBeLessThanOrEqual(daysAvailable.length * 2);
        for (const s of week.sessions) {
          for (const match of s.prescription.text.matchAll(/HR (\d+)-(\d+)/g)) {
            expect(Number(match[1]), `seed ${seed}`).toBeLessThanOrEqual(hrMax);
            expect(Number(match[2]), `seed ${seed}`).toBeLessThanOrEqual(hrMax);
          }
          expect(s.findingId).toBeTruthy();
        }
      }
    }
  });

  it("ACWR stays inside the block ceiling for every generated plan", { timeout: 120_000 }, () => {
    for (let seed = 1; seed <= 15; seed++) {
      const rng = makeRng(seed * 7);
      const { runs, sets } = historyWithK(2300 + Math.floor(rng() * 500));
      const profile = diagnose(runs, sets, { squat: 150, bench: 110, deadlift: 190 }, { hrMax: 195, hrRest: 55 });
      const plan = generatePlan({
        state: calibrationState({ currentRunMinPerWeek: 30 + rng() * 150, chronicLoad: 200 + rng() * 400 }),
        goal: calibrationGoal({ weeksOut: 12 + Math.floor(rng() * 30) }),
        constraints: calibrationConstraints(),
        profile,
      });
      if (!plan.generated) continue;
      expect(plan.acwr!.peakAcwr, `seed ${seed}`).toBeLessThanOrEqual(ACWR_BLOCK + 1e-6);
    }
  });
});

describe("WP3 — low energy availability warns and protects, without withholding training", () => {
  const leaState = (flags: number) =>
    calibrationState({ safety: { ...DEFAULT_SAFETY_FLAGS, leaRiskFlags: flags, injuryLast12Weeks: false, surgeryLast6Months: false } });

  it("no longer blocks the plan at two or more flags", () => {
    // Reversing the assurance review's Rev B position deliberately. The harm
    // it identified was the engine NUDGING an at-risk athlete toward weight
    // loss, and that is addressed by suppressing bodyweight guidance — which
    // still happens. Withholding the training plan treats nothing.
    const screen = safetyScreen(leaState(2), calibrationGoal());
    expect(screen.blocked).toBe(false);
    expect(screen.warnings.join(" ")).toMatch(/fuelling/i);
  });

  it("still suppresses every trace of bodyweight guidance, at any flag count", () => {
    for (const flags of [1, 2, 3, 4, 5]) {
      const state = leaState(flags);
      const screen = safetyScreen(state, calibrationGoal());
      expect(screen.showBodyweightGuidance, `${flags} flags`).toBe(false);
      expect(bodyweightFrontier(state, screen.showBodyweightGuidance).points).toHaveLength(0);
    }
  });

  it("still refers, because the referral is the actual intervention", () => {
    const screen = safetyScreen(leaState(2), calibrationGoal());
    expect(screen.referrals.join(" ")).toMatch(/dietitian/i);
    expect(screen.referrals.join(" ")).toMatch(/Eating Disorders/i);
  });

  it("generates a plan containing no calorie, macro or weight-loss output", () => {
    const plan = generatePlan({
      state: leaState(3),
      goal: calibrationGoal(),
      constraints: calibrationConstraints(),
      profile: calibrationProfile(),
    });
    expect(plan.generated).toBe(true);
    const everything = JSON.stringify(plan).toLowerCase();
    for (const phrase of ["calorie", "kcal", "energy deficit", "rate of loss", "lose weight"]) {
      expect(everything, phrase).not.toContain(phrase);
    }
    // The phrase list above passed while the plan contained "6-7g/kg" and a
    // 498-581g target. A per-kilogram gram quantity is a macro target whatever
    // it is called, so match the SHAPE rather than a vocabulary list.
    expect(everything).not.toMatch(/\d+\s*-\s*\d+\s*g\/kg/);
    expect(everything).not.toMatch(/\d{3,}\s*-\s*\d{3,}g\b/);
    expect(plan.bodyweightFrontier?.points ?? []).toHaveLength(0);
  });
});

describe("regressions found by review of the always-generate change", () => {
  const rowerOnly = () =>
    diagnose([], [], {}, { hrMax: 190, hrRest: 55, crossTrainingMinPerWeek: 427, crossTrainingKmPerWeek: 90 });

  it("does not tell a non-runner they have ample RUNNING volume", () => {
    // Cross-training counting toward total volume leaked into volumeAdequacy,
    // whose denominator is a running requirement measured against a 5k. A
    // rower was told they were on 356% of the volume they need and should now
    // train intensity — the inverse of what a non-runner needs, and it moved
    // the whole emphasis vector that way.
    const profile = rowerOnly();
    expect(profile.weeklyVolumeMin).toBeGreaterThan(400);
    expect(profile.runningVolumeMin).toBe(0);
    expect(profile.findings.map((f) => f.id)).not.toContain("ample-volume");
  });

  it("emits no per-kilogram fuelling target to an athlete with fuelling flags", () => {
    // The taper's carbohydrate guidance was gated on a block this engine then
    // removed, making a bodyweight-scaled gram target reachable by exactly the
    // population the screen protects.
    const plan = generatePlan({
      state: calibrationState({ safety: { ...DEFAULT_SAFETY_FLAGS, leaRiskFlags: 3, leaScreenAnswered: true } }),
      goal: calibrationGoal(),
      constraints: calibrationConstraints(),
      profile: calibrationProfile(),
    });
    expect(plan.generated).toBe(true);
    const everything = JSON.stringify(plan);
    expect(everything).not.toMatch(/g\/kg/);
    expect(everything).not.toMatch(/\d{3,}\s*-\s*\d{3,}g\b/);
  });

  it("still gives fuelling guidance to an athlete with no flags", () => {
    const plan = generatePlan({
      state: calibrationState(),
      goal: calibrationGoal(),
      constraints: calibrationConstraints(),
      profile: calibrationProfile(),
    });
    expect(plan.taper.find((d) => d.day === -1)!.note).toMatch(/carbohydrate/i);
  });

  it("does not assert fuelling answers that were never given", () => {
    // Unanswered resolves to positive so suppression errs safe. Suppressing on
    // a guess is defensible; ASSERTING on one is not — an athlete who skipped
    // the section was being shown an eating-disorder helpline.
    const unanswered = safetyScreen(
      calibrationState({ safety: { ...DEFAULT_SAFETY_FLAGS, leaRiskFlags: 5, leaScreenAnswered: false } }),
      calibrationGoal()
    );
    expect(unanswered.blocked).toBe(false);
    expect(unanswered.showBodyweightGuidance).toBe(false);
    expect(unanswered.warnings.join(" ")).not.toMatch(/your answers/i);
    expect(unanswered.referrals).toHaveLength(0);
    expect(unanswered.warnings.join(" ")).toMatch(/have not been answered/i);

    // Answered, same count: the assertion and the referral are correct here.
    const answered = safetyScreen(
      calibrationState({ safety: { ...DEFAULT_SAFETY_FLAGS, leaRiskFlags: 5, leaScreenAnswered: true } }),
      calibrationGoal()
    );
    expect(answered.warnings.join(" ")).toMatch(/your answers/i);
    expect(answered.referrals.join(" ")).toMatch(/dietitian/i);
  });
});

describe("per-lift targets count as a strength goal", () => {
  it("a lifter with only per-lift targets is developed, not maintained", () => {
    // The five-persona simulation caught this: a powerlifter whose entire goal
    // was squat/bench/deadlift was classified "maintain" because only
    // `targetTotalKg` was read, and maintain mode prescribes two generic
    // maintenance sessions — so they received no barbell work at all.
    const mode = classifyDomains(
      calibrationState(),
      calibrationGoal({ targetTotalKg: null, targetSquatKg: 200, targetBenchKg: null, targetDeadliftKg: null })
    );
    expect(mode.strength).toBe("develop");
  });
});

describe("the on-ramp starts from a floor rather than from zero", () => {
  it("gives endurance minutes to an athlete currently doing no running", () => {
    // No multiple of zero is anything but zero, so a powerlifter adding
    // conditioning got a plan with no endurance in any week, forever.
    const macro = buildMacrocycle(calibrationState({ currentRunMinPerWeek: 0 }), calibrationGoal());
    expect(macro[0].enduranceMin).toBeGreaterThan(0);
    expect(Math.max(...macro.map((w) => w.enduranceMin))).toBeGreaterThan(macro[0].enduranceMin);
  });

  it("still starts an existing runner exactly where they are", () => {
    const macro = buildMacrocycle(calibrationState({ currentRunMinPerWeek: 75 }), calibrationGoal());
    expect(macro[0].enduranceMin).toBe(75);
  });
});
