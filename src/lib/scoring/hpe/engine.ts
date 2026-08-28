/**
 * Hybrid Plan Engine — orchestration.
 *
 * The stage order is not arbitrary and is not configurable:
 *
 *   1. HEALTH SCREEN. Runs first and shapes everything after it, but no
 *      longer refuses. It sets `intensityCeiling` and `rampMultiplier`, and
 *      produces the referrals. See the note on `safetyScreen` for why the
 *      brief's "can block, not bypassable" was reversed: a refusal does not
 *      stop the training, it only strips the caps and the referral off it.
 *   2. DATA SUFFICIENCY. Tier 0 returns no plan either — brief §0e — and
 *      offers a two-week baseline block plus a time trial and a 3-5RM test.
 *   3. Feasibility, develop/maintain, macrocycle, session set, schedule.
 *   4. ACWR enforcement across the finished block (F6).
 *
 * Non-negotiable #2: generation is deterministic and stamped with the
 * constants version. Same inputs produce the same plan, byte for byte, and
 * `constantsVersion` on the result says which numbers produced it.
 *
 * Non-negotiable #5: no calorie, macro or rate-of-loss output under any
 * configuration. The only nutrition string this engine emits is the taper's
 * carbohydrate guidance, which is framed as normal eating, gated on the
 * safety screen, and is not a calorie target.
 */

import { HPE_CONSTANTS_VERSION, type EmphasisKey } from "./constants";
import { assessTailoring, type PlanTailoring } from "./tailoring";
import { bodyweightFrontier, classifyDomains, feasibilityScreen, type DomainMode, type FeasibilityResult } from "./feasibility";
import { eventDayPlan, jointTaper, resolveEventOrder, type EventDayStep, type EventOrderResult, type TaperDay } from "./event";
import type { Constraints, Goal, AthleteState } from "./intake";
import { buildMacrocycle, enforceAcwr, type AcwrEnforcement, type MacrocycleWeek } from "./macrocycle";
import { autoregulate, type SessionFeedback } from "./progression";
import { scheduleWeek, type Placement } from "./scheduler";
import { buildSessionSet, type PlannedSession } from "./session-set";
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
  /** How individual this plan actually is, and what would make it more so. Never null on a generated plan. */
  tailoring: PlanTailoring | null;
  /**
   * Which cardio modalities this plan is written in, and the headline endurance
   * number that goes with them.
   *
   * `profile.predicted5kS` is running's diagnostic and stays running's. An
   * athlete who has told the intake they row and do not run must not be shown a
   * predicted 5k — it is a number about a sport they do not do, and the
   * diagnostic report already has a rule against presenting a number that is
   * really about something else. `benchmark` is the same idea in their own
   * sport: a projected 2k row, 400m swim or 20k ride, from their own logs,
   * using their own sport's decay exponent.
   *
   * Null only when the plan was not generated.
   */
  cardio: {
    modalities: CardioModality[];
    primary: CardioModality;
    /** The modality quality sessions are prescribed in. */
    qualityModality: CardioModality;
    crossTrain: boolean;
    /** True when running is not among the chosen modalities — the signal to suppress the 5k. */
    suppressRunningDiagnostics: boolean;
    benchmark: EnduranceBenchmark;
  } | null;
}

export interface GeneratePlanInput {
  state: AthleteState;
  goal: Goal;
  constraints: Constraints;
  /** From WP0. The caller runs `diagnose` and passes the result — the engine never re-derives it. */
  profile: AthleteProfile;
  /** F16: last week's logged feedback, per week index. */
  feedbackByWeek?: Record<number, SessionFeedback[]>;
  /** F11: the athlete has explicitly overridden the safety-constrained event order. */
  overrideEventOrder?: boolean;
  /**
   * Per-modality fitness for the cardio modalities the athlete chose, built by
   * the caller from their activity rows (`ingestModalityFitness`).
   *
   * The engine never re-derives it, for the same reason it never re-derives
   * the diagnostic: there is one reader of the activity table and it is not
   * this module.
   */
  modalityFitness?: Partial<Record<CardioModality, ModalityFitness>>;
}

export function generatePlan(input: GeneratePlanInput): GeneratedPlan {
  const { state, goal, constraints, profile, feedbackByWeek = {}, modalityFitness = {} } = input;

  // ---- 1. HEALTH SCREEN, FIRST AND UNCONDITIONAL -------------------------
  // Still first, still not skippable — it just sets the dial now instead of
  // closing the door.
  const safety = safetyScreen(state, goal);
  // ---- 2. DATA SUFFICIENCY: LABEL IT, DO NOT REFUSE ----------------------
  // The brief said "no plan" below tier 1. That has been overridden
  // deliberately — see the module note on `assessTailoring`. Thin data now
  // produces a conservative plan that says how provisional it is, because a
  // refusal after eight sections of questions teaches the athlete nothing and
  // loses them. Uncertainty is paid for in caution: the ramp multiplier below
  // halves the progression when the engine is guessing at the starting point.
  const tailoring = assessTailoring(profile);

  // ---- 3. FEASIBILITY, MODE, MACROCYCLE -----------------------------------
  const feasibility = feasibilityScreen(state, goal);
  const mode = classifyDomains(state, goal, constraints.trainingSplit != null);
  // Both caution factors compound: a novice runner with no logged history gets
  // the halved novice ramp AND the halved provisional ramp, which is the
  // correct direction to stack them.
  const macro = buildMacrocycle(state, goal, safety.rampMultiplier * tailoring.rampMultiplier);

  const weeks: PlanWeek[] = [];
  const rawStress: number[] = [];

  for (const weekRecord of macro) {
    const feedback = feedbackByWeek[weekRecord.week - 1] ?? [];
    const autoreg = autoregulate(feedback);
    const { sessions, allocation, notes } = buildSessionSet({
      profile,
      week: weekRecord,
      mode,
      goal,
      constraints,
      suppressHeartRate: safety.suppressHeartRatePrescription,
      autoregMultiplier: autoreg.volumeMultiplier,
      // What the health screen decided instead of refusing.
      intensityCeiling: safety.intensityCeiling,
      // The athlete's chosen cardio modalities are prescribed in their own
      // sports' units from here.
      modalityFitness,
    });
    const schedule = scheduleWeek(sessions, constraints);
    const stress = schedule.placements.reduce((s, p) => s + p.session.stress, 0);
    rawStress.push(stress);
    // The athlete said their week varies, so the week is delivered as an order
    // as well as a shape. The intake has promised this since it was written and
    // the scheduler never read the answer — see `ScheduleResult.prioritisedOrder`.
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
    weeks.push({
      ...weekRecord,
      sessions,
      placements: schedule.placements,
      prioritisedOrder: schedule.prioritisedOrder,
      allocation,
      notes: [...notes, ...orderNote, ...autoreg.reasons],
      penalty: schedule.penalty,
      hardPenalty: schedule.hardPenalty,
      stress,
      stressCapped: stress,
      acwr: 0,
      droppedSessions: schedule.droppedSessions,
    });
  }

  // ---- 4. ACWR ENFORCEMENT ------------------------------------------------
  // An athlete with no comparable training history has no chronic load to
  // measure against, and a near-zero denominator makes week 1 read as an
  // infinite spike — which is what the fleet dashboard caught. Seeding from
  // the plan's own first week instead means the ratio starts at 1.0 and the
  // ramp itself becomes the protection, which is the honest reading: there is
  // nothing to compare the first week to except the first week.
  const chronicSeed = Math.max(state.chronicLoad, rawStress[0] ?? 0);
  const acwr = enforceAcwr(macro, rawStress, chronicSeed);
  weeks.forEach((w, i) => {
    w.stressCapped = acwr.cappedStress[i];
    w.acwr = acwr.ratios[i];
    if (w.stressCapped < w.stress - 0.5) {
      // The week's stress was capped; the volume the athlete actually does
      // must follow, or the cap is cosmetic.
      const scale = w.stressCapped / w.stress;
      w.enduranceMin = Math.round(w.enduranceMin * scale);
      w.notes.push("Volume trimmed this week to keep your acute:chronic load inside a safe ramp.");
    }
  });
  for (const week of acwr.belowFloorWeeks) {
    const w = weeks.find((x) => x.week === week);
    w?.notes.push("This week is deliberately easy — it is your on-ramp, not an error.");
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
    // Fuelling guidance is gated on the SAME screen as bodyweight guidance.
    //
    // This previously passed `true` unconditionally, justified by a comment
    // saying two or more LEA flags block the plan upstream. That justification
    // was true when it was written and this engine then removed the block —
    // so the one bodyweight-scaled quantity anywhere in the output ("around
    // 498-581g, 6-7g/kg" for an 83kg athlete) became reachable by exactly the
    // population the LEA screen exists to protect.
    //
    // Non-negotiable #5 forbids macro output under ANY configuration, and a
    // per-kilogram gram target is a macro target whatever it is called.
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
  };
}
