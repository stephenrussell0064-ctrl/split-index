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

import {
  HPE_CONSTANTS_VERSION,
  MIN_ENDURANCE_SESSION_MIN,
  MMD_STRENGTH_SESSIONS_PER_WEEK,
  type EmphasisKey,
} from "./constants";
import { assessTailoring, type PlanTailoring } from "./tailoring";
import { bodyweightFrontier, classifyDomains, feasibilityScreen, type DomainMode, type FeasibilityResult } from "./feasibility";
import { eventDayPlan, jointTaper, resolveEventOrder, type EventDayStep, type EventOrderResult, type TaperDay } from "./event";
import type { Constraints, Goal, AthleteState } from "./intake";
import { buildMacrocycle, enforceAcwr, type AcwrEnforcement, type MacrocycleWeek } from "./macrocycle";
import { autoregulate, type SessionFeedback } from "./progression";
import { scheduleWeek, type Placement } from "./scheduler";
import { buildSessionSet, fitEnduranceToMinutes, type PlannedSession } from "./session-set";
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
    /**
     * The week's stated budget may not exceed what the week actually contains.
     *
     * `enduranceMin` comes off the macrocycle's volume ramp, which reads the
     * athlete's current weekly running and knows nothing about the rest of
     * their intake. Every endurance session is then capped at their stated
     * `maxSessionMin`, and the number of sessions at their `maxSessionsPerWeek`.
     * Nothing checked that the ramp's answer could survive those two limits, so
     * the surplus was quietly dropped and the athlete was quoted the ramp's
     * figure regardless.
     *
     * Measured across 32,400 generated weeks: 54% prescribed less than 90% of
     * the budget they advertised and the median week spent 84% of it. The worst
     * was 55 minutes of running under a heading of 468 — an athlete who had
     * said 30-minute sessions, four times a week. 4 x 30 is 120, so 468 was
     * never deliverable; it was the ramp extrapolating from their current
     * volume and no part of the engine ever reconciling that against what they
     * had said they could actually do.
     *
     * Giving the budget more slots to spend itself in (see `neededForBudget`
     * in session-set.ts) recovers the cases where there was room. This handles
     * the rest, where there is no room and the two answers genuinely conflict:
     * the plan states what it prescribes. A budget nobody can train is not a
     * target, it is a number that makes the plan look wrong.
     *
     * The gap is reported rather than silently absorbed, because it is
     * actionable in a way most engine internals are not — it names the intake
     * answer that is holding the athlete back, and raising it is entirely
     * within their gift.
     */
    const prescribedEnduranceMin = sessions
      .filter((s) => s.domain === "endurance")
      .reduce((sum, s) => sum + s.minutes, 0);
    if (weekRecord.enduranceMin > 0 && prescribedEnduranceMin < weekRecord.enduranceMin) {
      const shortfall = weekRecord.enduranceMin - prescribedEnduranceMin;
      // Only worth a sentence when the difference is one the athlete would
      // notice. Rounding and floors account for a few minutes in most weeks.
      if (shortfall / weekRecord.enduranceMin > 0.1 && shortfall >= MIN_ENDURANCE_SESSION_MIN) {
        notes.push(
          `Your ramp wants about ${weekRecord.enduranceMin} minutes of endurance this week, and this plan plots ` +
            `${prescribedEnduranceMin}. ${constraints.maxSessionsPerWeek} sessions a week of at most ` +
            `${constraints.maxSessionMin} minutes is the limit you gave, and it is what is binding here — not your ` +
            `fitness. Raising either in your intake is what unlocks the rest.`
        );
      }
      weekRecord.enduranceMin = prescribedEnduranceMin;
    }

    /**
     * The athlete's stated weekly hours bind the WHOLE week.
     *
     * `maxHoursPerWeek` is asked for in the intake, stored on the record,
     * carried into `Constraints` — and read by nothing. It has never been
     * enforced. The comment on STRENGTH_WARMUP_MIN describes giving strength
     * sessions real durations so that "the athlete's own maxHoursPerWeek and
     * maxSessionMin limits could see them", but only maxSessionMin was ever
     * wired up; the hours answer went straight through the ramp, the session
     * set and the scheduler without one line consulting it.
     *
     * Measured across 8,640 generated weeks: 22% exceeded the hours the
     * athlete said they had. The worst handed someone who answered "3 hours a
     * week" a 542-minute week — nine hours, three times what they said they
     * could give it, every week for a block.
     *
     * This is not a preference to be balanced against training theory. Time is
     * the one constraint the engine cannot argue with: an athlete with three
     * hours has three hours, and a plan that ignores that is not a harder plan,
     * it is one that does not get done.
     *
     * ENDURANCE FLEXES FIRST because it is the volume dial — its minutes are a
     * ramped budget, while strength is a session count carrying a minimum
     * effective dose the evidence base is clearest about. Strength is only
     * touched when it alone will not fit, and never below that minimum: a week
     * that has to choose between lifting and honesty about the clock should
     * still be a week that contains lifting.
     */
    const weeklyCapMin = Math.max(0, Math.round(constraints.maxHoursPerWeek * 60));
    const minutesIn = (domain: "endurance" | "strength") =>
      sessions.filter((s) => s.domain === domain).reduce((sum, s) => sum + s.minutes, 0);

    if (weeklyCapMin > 0 && minutesIn("endurance") + minutesIn("strength") > weeklyCapMin) {
      const strengthMin = minutesIn("strength");
      const enduranceAllowance = Math.max(0, weeklyCapMin - strengthMin);

      if (minutesIn("endurance") > enduranceAllowance) {
        const fitted = fitEnduranceToMinutes(sessions, enduranceAllowance);
        sessions.length = 0;
        sessions.push(...fitted.sessions);
        weekRecord.enduranceMin = minutesIn("endurance");
      }

      // Strength only when the lifting alone overruns the whole week, and only
      // down to the minimum dose. Later sessions go first: the rotation's
      // accessory work is built after the lifts the block is actually about.
      while (
        minutesIn("strength") > weeklyCapMin &&
        sessions.filter((s) => s.domain === "strength").length > MMD_STRENGTH_SESSIONS_PER_WEEK
      ) {
        const idx = sessions.map((s) => s.domain).lastIndexOf("strength");
        if (idx < 0) break;
        sessions.splice(idx, 1);
      }

      const finalTotal = minutesIn("endurance") + minutesIn("strength");
      notes.push(
        finalTotal > weeklyCapMin
          ? `You told us you have ${constraints.maxHoursPerWeek} hours a week. The smallest week that still ` +
            `contains a plan is about ${Math.round(finalTotal / 5) * 5} minutes, so this one is over what you said ` +
            `by ${finalTotal - weeklyCapMin}. If that is not findable, the honest fix is a longer block rather than ` +
            `a harder week — tell us and we will spread the same work over more weeks.`
          : `Trimmed to the ${constraints.maxHoursPerWeek} hours a week you said you had — ` +
            `${Math.round(finalTotal)} minutes across ${sessions.length} sessions.`
      );
    }

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
      /**
       * The week's stress was capped; the volume the athlete actually does
       * must follow, or the cap is cosmetic.
       *
       * It was cosmetic. This scaled `enduranceMin` — the number quoted in the
       * week's notes — and stopped there. The sessions had already been built
       * and scheduled by the time this runs, and nothing came back to touch
       * them, so the athlete was told their volume had been trimmed for their
       * own safety and then handed the untrimmed sessions to do. The label
       * moved; the training did not.
       *
       * Trimming really does mean endurance and not strength. Endurance stress
       * is `BASE_STRESS_PER_MIN[kind] * minutes`, so minutes are the lever;
       * strength stress is a flat per-kind constant that does not move with
       * duration at all, so shortening a lifting session would cost the
       * athlete training and reduce the week's load by nothing.
       *
       * `fitEnduranceToMinutes` is the same reconciliation the session set
       * uses against its own budget — durations give way before the count
       * does, floors hold, and the long run is the last thing to go.
       *
       * MEASURED: across 900 generated plans containing 92 ACWR-capped weeks,
       * the reconciliation below currently changes NOTHING. Every capped week
       * was already prescribing far less than its trimmed budget — 180 minutes
       * against 543 in the worst example — because of the separate, unfixed
       * undershoot where `maxSessionMin` caps every session while the slot
       * count comes from the phase tables, so a high budget has nowhere to go.
       *
       * It is kept anyway, as the guard the comment above always claimed was
       * here. The day the undershoot is fixed and weeks start spending their
       * budgets, this becomes load-bearing immediately, and a safety cap that
       * silently stops applying when the rest of the engine improves is the
       * worst possible failure. What must NOT be inferred from it is that
       * capped weeks are being trimmed today: they are not, because they do
       * not need to be.
       */
      const enduranceMinutesOf = (ss: readonly PlannedSession[]) =>
        ss.filter((s) => s.domain === "endurance").reduce((sum, s) => sum + s.minutes, 0);
      const before = enduranceMinutesOf(w.sessions);

      const scale = w.stressCapped / w.stress;
      w.enduranceMin = Math.round(w.enduranceMin * scale);

      const fitted = fitEnduranceToMinutes(w.sessions, w.enduranceMin);
      // `placements` holds references to the very objects in `sessions`, and
      // the reconciliation returns new ones. Rewiring both from the same map
      // keeps the week's two views of a session from disagreeing about how
      // long it is — the schedule the athlete reads is built from placements.
      const replacement = new Map<PlannedSession, PlannedSession>();
      fitted.keptIndices.forEach((srcIdx, i) => {
        const old = w.sessions[srcIdx];
        if (old) replacement.set(old, fitted.sessions[i]);
      });
      // A session with no replacement was dropped, and its placement goes with
      // it — leaving the placement behind would put a session on the calendar
      // that is no longer in the week.
      w.placements = w.placements.flatMap((p) => {
        const next = replacement.get(p.session);
        return next ? [{ ...p, session: next }] : [];
      });
      w.sessions = fitted.sessions;
      w.stress = w.placements.reduce((s, p) => s + p.session.stress, 0);

      /**
       * Only claim a trim when there was one.
       *
       * This note fired on the ratio alone, so in all 92 capped weeks measured
       * it told the athlete their volume had been cut for their safety while
       * handing them exactly the sessions they would otherwise have had. A
       * plan that describes work it did not change is the same defect as one
       * that changes work it did not describe — it just reads more reassuring.
       */
      const after = enduranceMinutesOf(w.sessions);
      if (after < before) {
        w.notes.push(
          `Volume trimmed this week — ${before} minutes down to ${after} — to keep your acute:chronic load ` +
            `inside a safe ramp.`
        );
      }
    }
  });
  for (const week of acwr.belowFloorWeeks) {
    const w = weeks.find((x) => x.week === week);
    // A taper is below the ACWR floor BY DESIGN — that is what tapering is —
    // so calling the last week of a block "your on-ramp" was telling an athlete
    // three days from their event that they were at the start of it. The note
    // exists for the genuinely quiet weeks at the beginning; the taper explains
    // itself through its own phase label.
    if (w?.phase === "taper") continue;
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
