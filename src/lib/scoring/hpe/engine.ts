/**
 * Hybrid Plan Engine — orchestration.
 *
 * The stage order is not arbitrary and is not configurable:
 *
 *   1. HEALTH SCREEN. Runs first and shapes everything after it. It sets
 *      `intensityCeiling` and `rampMultiplier`, and produces the referrals.
 *   2. DATA SUFFICIENCY. Labelled, not refused — see `assessTailoring`.
 *   3. Feasibility (a first pass, on the priors), develop/maintain, the
 *      macrocycle, the session set week by week, the schedule.
 *   4. ACWR backstop across the finished block, with any capped week REBUILT
 *      so the cap reaches the sessions rather than a number beside them.
 *   5. Feasibility again, on the dose the plan actually delivers — the
 *      projection the athlete reads is for the plan they were given.
 *
 * Non-negotiable #2: generation is deterministic and stamped with the
 * constants version.
 *
 * Non-negotiable #5: no calorie, macro or rate-of-loss output under any
 * configuration.
 *
 * Constants 3.0.0 adds BLOCK CONTINUITY. Every visit to the plan screen used
 * to regenerate the whole block from week one and anchor it to that Monday,
 * so the deload "at week 4", the ramp, the quality progression and the phase
 * ladder were all re-projected forward from today and never arrived — the
 * athlete was permanently in week one. A plan can now be continued: the weeks
 * already lived are carried through, the ramp from the current week restarts
 * at the athlete's real logged volume, and the phase structure keeps its
 * original calendar.
 */

import { HPE_CONSTANTS_VERSION, LIFE_LOAD_SLEEP_HOURS_THRESHOLD, LIFE_LOAD_STRESS_THRESHOLD, type EmphasisKey } from "./constants";
import { assessTailoring, type PlanTailoring } from "./tailoring";
import {
  bodyweightFrontier,
  classifyDomains,
  feasibilityScreen,
  type DeliveredDose,
  type DomainMode,
  type FeasibilityResult,
} from "./feasibility";
import { eventDayPlan, jointTaper, resolveEventOrder, type EventDayStep, type EventOrderResult, type TaperDay } from "./event";
import type { Constraints, Goal, AthleteState } from "./intake";
import { buildMacrocycle, effectiveRamp, enforceAcwr, type AcwrEnforcement, type MacrocycleWeek } from "./macrocycle";
import { applyLowCapacityDay, autoregulate, type SessionFeedback } from "./progression";
import type { ObservedResponse } from "./response";
import { scheduleWeek, type Placement } from "./scheduler";
import { buildSessionSet, easySwapFor, type PlannedSession, type SessionSet } from "./session-set";
import {
  emptyModalityFitness,
  enduranceBenchmark,
  modalityForEvent,
  resolveCardioPlan,
  type CardioModality,
  type EnduranceBenchmark,
  type ModalityFitness,
} from "./modality";
import { safetyScreen, type SafetyResult } from "./safety";
import type { AthleteProfile, Finding } from "./types";

export interface PlanWeek extends MacrocycleWeek {
  sessions: PlannedSession[];
  placements: Placement[];
  /** The week as an ordered list, when the athlete said their availability varies. Null otherwise. */
  prioritisedOrder?: PlannedSession[] | null;
  allocation: Record<EmphasisKey, number>;
  notes: string[];
  penalty: number;
  hardPenalty: number;
  stress: number;
  stressCapped: number;
  acwr: number;
  droppedSessions: PlannedSession[];
  /** True when this week was carried over from the stored plan rather than generated in this run. */
  carriedOver?: boolean;
  /** What the week actually prescribes — the dose the feasibility model reads. */
  delivered?: {
    enduranceMin: number;
    qualityCount: number;
    longRunMinutes: number | null;
    strengthSetsByLift: Record<string, number>;
    heavyStrengthSessions: number;
  };
}

export interface GeneratedPlan {
  constantsVersion: string;
  generated: boolean;
  safety: SafetyResult;
  /** Populated only when generation was refused — the specific next step, never a bare refusal. */
  refusal: { reason: string; nextSteps: string[] } | null;
  profile: AthleteProfile;
  feasibility: FeasibilityResult | null;
  mode: Record<"strength" | "endurance", DomainMode> | null;
  weeks: PlanWeek[];
  acwr: AcwrEnforcement | null;
  bodyweightFrontier: ReturnType<typeof bodyweightFrontier> | null;
  eventOrder: EventOrderResult | null;
  taper: TaperDay[];
  eventDay: EventDayStep[] | null;
  /** Every finding the plan's sessions cite, so the UI can render the trace. */
  findings: Finding[];
  tailoring: PlanTailoring | null;
  cardio: {
    modalities: CardioModality[];
    primary: CardioModality;
    qualityModality: CardioModality;
    crossTrain: boolean;
    suppressRunningDiagnostics: boolean;
    benchmark: EnduranceBenchmark;
  } | null;
  /** The first week generated in this run — 1 for a fresh block, the current week for a continuation. */
  startWeek: number;
  /** The average weekly dose across the development phases, as the feasibility model read it. */
  dose: DeliveredDose | null;
}

export interface ContinueFrom {
  /** The plan week the athlete is currently in (1-based). Weeks before it are carried from `priorWeeks`. */
  week: number;
  /** The stored weeks already lived, keyed by week number. Missing weeks are regenerated. */
  priorWeeks: PlanWeek[];
  /** The athlete's actual current weekly running minutes, which the ramp restarts from. */
  currentVolumeMin: number;
}

export interface GeneratePlanInput {
  state: AthleteState;
  goal: Goal;
  constraints: Constraints;
  /** From WP0. The caller runs `diagnose` and passes the result — the engine never re-derives it. */
  profile: AthleteProfile;
  /**
   * F16: logged feedback, keyed by the plan week it was logged FOR. Week W
   * reads the feedback for week W−1 — a real coach adjusts Monday on what
   * happened at the weekend.
   */
  feedbackByWeek?: Record<number, SessionFeedback[]>;
  /** F11: the athlete has explicitly overridden the safety-constrained event order. */
  overrideEventOrder?: boolean;
  modalityFitness?: Partial<Record<CardioModality, ModalityFitness>>;
  /** Continue an existing block from its current week rather than starting a new one. */
  continueFrom?: ContinueFrom;
  /**
   * This athlete's own measured rate of improvement, from their stored
   * diagnostic history. Blended into the population prior — see `response.ts`.
   */
  observedResponse?: ObservedResponse | null;
  /**
   * F17: days the athlete has flagged as low capacity, as plan week and
   * weekday. The hardest quality session on that day becomes an easy one.
   */
  lowCapacityDays?: { week: number; day: string }[];
}

/** Average weekly dose across the development phases — the numbers the feasibility model reads. */
export function deliveredDose(weeks: PlanWeek[], goal: Goal): DeliveredDose | null {
  const development = weeks.filter((w) => w.phase !== "taper" && w.delivered);
  if (development.length === 0) return null;
  const targetedLifts = (["squat", "bench", "deadlift"] as const).filter((lift) => {
    const t = lift === "squat" ? goal.targetSquatKg : lift === "bench" ? goal.targetBenchKg : goal.targetDeadliftKg;
    return t != null && t > 0;
  });
  const lifts: readonly string[] = targetedLifts.length > 0 ? targetedLifts : ["squat", "bench", "deadlift"];
  let enduranceMin = 0;
  let heavy = 0;
  let sessions = 0;
  let sets = 0;
  for (const w of development) {
    enduranceMin += w.delivered!.enduranceMin;
    heavy += w.delivered!.heavyStrengthSessions;
    sessions += w.placements.length;
    sets += lifts.reduce((s: number, lift) => s + (w.delivered!.strengthSetsByLift[lift] ?? 0), 0) / lifts.length;
  }
  const n = development.length;
  return {
    enduranceMinPerWeek: enduranceMin / n,
    heavyStrengthSessionsPerWeek: heavy / n,
    setsPerLiftPerWeek: sets / n,
    sessionsPerWeek: sessions / n,
  };
}

export function generatePlan(input: GeneratePlanInput): GeneratedPlan {
  const {
    state,
    goal,
    constraints,
    profile,
    feedbackByWeek = {},
    modalityFitness = {},
    continueFrom,
    observedResponse = null,
    lowCapacityDays = [],
  } = input;

  // ---- 1. HEALTH SCREEN, FIRST AND UNCONDITIONAL -------------------------
  const safety = safetyScreen(state, goal);
  // ---- 2. DATA SUFFICIENCY: LABEL IT, DO NOT REFUSE ----------------------
  const tailoring = assessTailoring(profile);

  // ---- 3. FEASIBILITY (PRIORS), MODE, MACROCYCLE --------------------------
  // The first pass has no dose yet. Its expected outcomes are what the
  // quality-session paces progress toward and what the working max walks up
  // with; the athlete-facing result is the second pass below.
  const priorFeasibility = feasibilityScreen(state, goal, {
    maxSessionsPerWeek: constraints.maxSessionsPerWeek,
    observed: observedResponse,
  });
  const mode = classifyDomains(state, goal, constraints.trainingSplit != null);
  const rampMultiplier = safety.rampMultiplier * tailoring.rampMultiplier;
  const ramp = effectiveRamp(state, rampMultiplier);

  const startWeek = continueFrom && continueFrom.week > 1 ? continueFrom.week : 1;
  const priorByWeek = new Map((continueFrom?.priorWeeks ?? []).map((w) => [w.week, w]));
  const macro = buildMacrocycle(state, goal, rampMultiplier, {
    fromWeek: startWeek,
    volumeAtFromWeek: continueFrom?.currentVolumeMin,
    travelWeeks: constraints.travelWeeks ?? [],
  });

  const stress = state.lifeStressNow ?? 3;
  const sleep = state.sleepHoursTypical ?? 7;
  const lifeLoad = stress >= LIFE_LOAD_STRESS_THRESHOLD || sleep < LIFE_LOAD_SLEEP_HOURS_THRESHOLD;
  const lastWeek = macro[macro.length - 1]?.week ?? goal.weeksOut;

  // The projection the sessions are paced to. Starts at the prior; replaced
  // by the dose-aware projection on the second pass below, so the athlete
  // reads the same expected 5k the intervals are built toward.
  let expected5kS = priorFeasibility.endurance.expected;
  let expectedStrengthGain = priorFeasibility.strength.gainFraction;

  const buildWeek = (weekRecord: MacrocycleWeek, recentLongRunsMin: number[], autoregMultiplier: number): SessionSet =>
    buildSessionSet({
      profile,
      week: weekRecord,
      mode,
      goal,
      constraints,
      suppressHeartRate: safety.suppressHeartRatePrescription,
      autoregMultiplier,
      intensityCeiling: safety.intensityCeiling,
      modalityFitness,
      expected5kS,
      expectedStrengthGain,
      recentLongRunsMin,
      longestRecentRunMin: state.longestRecentRunMin ?? null,
      enduranceTrainingYears: state.enduranceTrainingYears,
      strengthTrainingYears: state.strengthTrainingYears,
      lifeLoad,
      isFinalTaperWeek: weekRecord.week === lastWeek,
    });

  /** The long runs of the four weeks before `index`, oldest first, for the spike rule. */
  const recentLongRuns = (index: number): number[] =>
    weeks
      .slice(Math.max(0, index - 4), index)
      .map((w) => w.delivered?.longRunMinutes ?? 0)
      .filter((m) => m > 0);

  const assemble = (
    weekRecord: MacrocycleWeek,
    set: SessionSet,
    extraNotes: string[]
  ): PlanWeek => {
    const schedule = scheduleWeek(set.sessions, constraints);
    const weekStress = schedule.placements.reduce((s, p) => s + p.session.stress, 0);
    const orderNote =
      schedule.prioritisedOrder && schedule.prioritisedOrder.length > 0
        ? [
            `Your week varies, so place these yourself in this order of priority: ` +
              schedule.prioritisedOrder
                .map((s, i) => `${i + 1}. ${s.label ?? s.kind.replace(/_/g, " ")}`)
                .join(", ") +
              `. The days shown are a suggested shape, not a fixture — what matters is keeping the hard sessions ` +
              `apart and doing the ones near the top of this list.`,
          ]
        : [];
    return {
      ...weekRecord,
      // What the athlete is told to do, not what the ramp budgeted. The two
      // diverged by 30-55% for a race athlete and the screen showed the budget.
      enduranceMin: set.deliveredEnduranceMin,
      sessions: set.sessions,
      placements: schedule.placements,
      prioritisedOrder: schedule.prioritisedOrder,
      allocation: set.allocation,
      notes: [...set.notes, ...orderNote, ...extraNotes],
      penalty: schedule.penalty,
      hardPenalty: schedule.hardPenalty,
      stress: weekStress,
      stressCapped: weekStress,
      acwr: 0,
      droppedSessions: schedule.droppedSessions,
      delivered: {
        enduranceMin: set.deliveredEnduranceMin,
        qualityCount: set.qualityCount,
        longRunMinutes: set.longRunMinutes,
        strengthSetsByLift: set.strengthSetsByLift,
        heavyStrengthSessions: set.heavyStrengthSessions,
      },
    };
  };

  const weeks: PlanWeek[] = [];
  const buildAllWeeks = () => {
    weeks.length = 0;
    for (const weekRecord of macro) {
      const prior = priorByWeek.get(weekRecord.week);
      if (weekRecord.week < startWeek && prior) {
        weeks.push({ ...prior, carriedOver: true });
        continue;
      }
      const feedback = feedbackByWeek[weekRecord.week - 1] ?? [];
      const autoreg = autoregulate(feedback);
      const set = buildWeek(weekRecord, recentLongRuns(weeks.length), autoreg.volumeMultiplier);
      const rampNotes =
        weekRecord.week === startWeek && ramp.reasons.length > 0
          ? [`Weekly volume ramps at ${Math.round(ramp.ramp * 100)}%: ${ramp.reasons.join("; ")}.`]
          : [];
      weeks.push(assemble(weekRecord, set, [...rampNotes, ...autoreg.reasons]));
    }
  };

  // ---- 4. ACWR BACKSTOP -----------------------------------------------------
  // Seeded from the athlete's real recent load in the same units, with the
  // plan's own first generated week as a floor so an athlete with no history
  // is measured against the week they are about to do rather than against
  // nothing.
  let acwr: AcwrEnforcement;
  const enforceAndRebuild = () => {
    const firstGenerated = weeks.find((w) => !w.carriedOver);
    const chronicSeed = Math.max(state.chronicLoad, firstGenerated?.stress ?? 0);
    acwr = enforceAcwr(macro, weeks.map((w) => w.stress), chronicSeed);
    // Any capped week is REBUILT at the capped volume so the cap reaches the
    // sessions. The old path scaled a number beside the sessions and left
    // the prescriptions untouched — a control reported as present and not
    // holding.
    let rebuilt = false;
    weeks.forEach((w, i) => {
      if (w.carriedOver) return;
      const capped = acwr.cappedStress[i];
      if (capped < w.stress - 0.5 && w.stress > 0) {
        const scale = capped / w.stress;
        const record: MacrocycleWeek = { ...macro[i], enduranceMin: Math.round(macro[i].enduranceMin * scale) };
        const feedback = feedbackByWeek[record.week - 1] ?? [];
        const autoreg = autoregulate(feedback);
        const set = buildWeek(record, recentLongRuns(i), autoreg.volumeMultiplier);
        weeks[i] = assemble(record, set, [
          ...autoreg.reasons,
          "Volume trimmed this week to keep the jump in total training load inside the backstop.",
        ]);
        rebuilt = true;
      }
    });
    if (rebuilt) acwr = enforceAcwr(macro, weeks.map((w) => w.stress), chronicSeed);
    weeks.forEach((w, i) => {
      w.stressCapped = Math.min(w.stress, acwr.cappedStress[i]);
      w.acwr = acwr.ratios[i];
    });
  };

  buildAllWeeks();
  enforceAndRebuild();

  // ---- 4b. SECOND PASS ON THE DELIVERED DOSE --------------------------------
  // The sessions were paced to the prior projection. The projection the
  // athlete reads is scaled to the dose the plan delivers, and the two must
  // agree — an interval paced to a 21:28 beside a card promising 21:39 is the
  // engine contradicting itself. One rebuild closes the gap; the dose barely
  // moves between passes because the paces do not change the minutes.
  const firstPassDose = deliveredDose(weeks, goal);
  if (firstPassDose) {
    const doseAware = feasibilityScreen(state, goal, {
      dose: firstPassDose,
      maxSessionsPerWeek: constraints.maxSessionsPerWeek,
      observed: observedResponse,
    });
    const moved =
      Math.abs(doseAware.endurance.expected - expected5kS) / Math.max(1, expected5kS) > 0.002 ||
      Math.abs(doseAware.strength.gainFraction - expectedStrengthGain) > 0.002;
    if (moved) {
      expected5kS = doseAware.endurance.expected;
      expectedStrengthGain = doseAware.strength.gainFraction;
      buildAllWeeks();
      enforceAndRebuild();
    }
  }
  acwr = acwr!;
  for (const week of acwr.belowFloorWeeks) {
    const w = weeks.find((x) => x.week === week);
    if (!w || w.phase === "taper" || w.carriedOver || w.deload) continue;
    // Only a genuinely quiet on-ramp week gets the note: a week at or above
    // the athlete's current volume is not an on-ramp whatever the ratio says.
    if (w.delivered && w.delivered.enduranceMin < state.currentRunMinPerWeek * 0.9) {
      w.notes.push("This week is deliberately easy — it is your on-ramp, not an error.");
    }
  }

  // ---- 5. FEASIBILITY ON THE DELIVERED DOSE -------------------------------
  const dose = deliveredDose(weeks, goal);
  const feasibility = feasibilityScreen(state, goal, {
    dose: dose ?? undefined,
    maxSessionsPerWeek: constraints.maxSessionsPerWeek,
    observed: observedResponse,
  });

  // ---- 6. F17: LOW-CAPACITY DAYS -------------------------------------------
  // The athlete has said a given day is a bad one. The hardest quality
  // session on it becomes an easy run of the same length, and the week says
  // so. Applied last, to the scheduled week, because it is a response to a
  // day rather than to the block — and applied to the PLACEMENTS, which is
  // what the screen and the widget read.
  for (const flag of lowCapacityDays) {
    const week = weeks.find((w) => w.week === flag.week);
    if (!week || week.carriedOver) continue;
    const onDay = week.placements.filter((p) => p.day === flag.day);
    if (onDay.length === 0) continue;
    // The originals are captured BEFORE any placement is rewritten. A
    // placement holds its session by reference, so reading `p.session` back
    // after assigning to it finds the replacement and never the session being
    // replaced — the week's own list then keeps the hard session the day was
    // supposed to lose.
    const originals = onDay.map((p) => p.session);
    const swap = applyLowCapacityDay(originals, (original) =>
      easySwapFor(original, profile, { suppressHeartRate: safety.suppressHeartRatePrescription })
    );
    if (!swap.swapped) continue;
    onDay.forEach((placement, i) => {
      const idx = week.sessions.indexOf(originals[i]);
      placement.session = swap.sessions[i];
      if (idx >= 0) week.sessions[idx] = swap.sessions[i];
    });
    // The week costs less than it did. `acwr` is left as computed: it
    // described the week as planned, a swap only ever removes load, so the
    // planned ratio is the conservative one and recomputing it here would
    // report a ratio for a week nobody designed.
    week.stress = week.placements.reduce((s, p) => s + p.session.stress, 0);
    week.stressCapped = Math.min(week.stressCapped, week.stress);
    if (week.delivered) {
      week.delivered.qualityCount = week.placements.filter(
        (p) => p.session.domain === "endurance" && p.session.isQuality && p.session.kind !== "long_run"
      ).length;
      week.delivered.enduranceMin = week.placements
        .filter((p) => p.session.domain === "endurance")
        .reduce((s, p) => s + p.session.minutes, 0);
    }
    if (swap.note) week.notes.push(swap.note);
  }

  const eventOrder = goal.sameDay && !goal.eventOrderKnown ? resolveEventOrder(state, goal) : null;

  return {
    constantsVersion: HPE_CONSTANTS_VERSION,
    generated: true,
    safety,
    refusal: null,
    profile,
    feasibility,
    mode,
    weeks,
    acwr,
    bodyweightFrontier: bodyweightFrontier(state, safety.showBodyweightGuidance),
    eventOrder,
    taper: jointTaper(state, safety.showBodyweightGuidance),
    eventDay: eventOrder ? eventDayPlan(goal, eventOrder) : null,
    findings: profile.findings,
    tailoring,
    cardio: (() => {
      const plan = resolveCardioPlan(
        constraints.cardioModalities ?? [],
        constraints.crossTrainOk ?? false,
        modalityForEvent(goal.enduranceEventKey)
      );
      return {
        modalities: plan.modalities,
        primary: plan.primary,
        qualityModality: plan.qualityModality,
        crossTrain: plan.crossTrain,
        suppressRunningDiagnostics: !plan.modalities.includes("run"),
        benchmark: enduranceBenchmark(
          modalityFitness[plan.primary] ?? emptyModalityFitness(plan.primary)
        ),
      };
    })(),
    startWeek,
    dose,
  };
}
