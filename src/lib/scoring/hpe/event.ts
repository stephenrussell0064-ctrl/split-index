/**
 * Hybrid Plan Engine — event order, joint taper and event day.
 *
 * Closes F11 (Critical), F12 (Major) and F14 (Major).
 *
 * F11 is the one to read carefully. Rev A modelled a maximal 5k followed by a
 * powerlifting meet as an 8% decrement on the deadlift and weighed it against
 * the athlete's priority slider. That framing is wrong: "Maximal deadlift
 * attempts with fatigued erectors, compromised bracing and depleted glycogen
 * are not merely lighter — they are the highest-risk lumbar loading scenario
 * in the sport, attempted in the worst possible state. A coach does not let
 * an athlete trade that off against a priority weighting."
 *
 * So race-first is a SAFETY BLOCK requiring explicit override, not a costed
 * option. The engine recommends meet-first even where the cost model prefers
 * race-first, and labels the recommendation as safety-constrained.
 */

import {
  DEADLIFT_AFTER_RACE_IS_UNSAFE,
  INTER_EVENT_RECOVERY_MAX,
  INTER_EVENT_RECOVERY_PER_HOUR,
  MEET_THEN_RACE_5K_PENALTY,
  RACE_THEN_MEET_BENCH_PENALTY,
  RACE_THEN_MEET_DEADLIFT_PENALTY,
  RACE_THEN_MEET_SQUAT_PENALTY,
  TAPER_CHO_G_PER_KG,
  TAPER_ENDURANCE_VOLUME_REDUCTION,
} from "./constants";
import { totalKg, type AthleteState, type Goal } from "./intake";

export interface EventOrderOption {
  order: string;
  totalKg: number;
  totalCostKg: number;
  fiveKS: number;
  fiveKCostS: number;
  safe: boolean;
  safetyNote: string;
  weightedCostPct: number;
}

export interface EventOrderResult {
  options: EventOrderOption[];
  recommended: string;
  interEventGapH: number;
  recoveryClearedPct: number;
  /** True when the recommendation was driven by safety rather than by the cost model — surfaced so the athlete is told, not quietly steered. */
  safetyConstrained: boolean;
  /** All decrement constants here are tagged [BETA] — unvalidated. Said out loud rather than presented as precision. */
  confidenceNote: string;
}

function recoveryFactor(gapHours: number): number {
  return Math.min(INTER_EVENT_RECOVERY_MAX, INTER_EVENT_RECOVERY_PER_HOUR * gapHours);
}

export function resolveEventOrder(state: AthleteState, goal: Goal): EventOrderResult {
  const gap = goal.interEventGapH;
  const cleared = recoveryFactor(gap);
  const currentTotal = totalKg(state);

  const racePenalty = MEET_THEN_RACE_5K_PENALTY * (1 - cleared);
  const meetFirst: EventOrderOption = {
    order: "Powerlifting meet → 5k race",
    totalKg: currentTotal,
    totalCostKg: 0,
    fiveKS: state.predicted5kS * (1 + racePenalty),
    fiveKCostS: state.predicted5kS * racePenalty,
    safe: true,
    safetyNote: "",
    weightedCostPct: 0,
  };

  const squat = (state.oneRms.squat ?? 0) * (1 - RACE_THEN_MEET_SQUAT_PENALTY * (1 - cleared));
  const bench = (state.oneRms.bench ?? 0) * (1 - RACE_THEN_MEET_BENCH_PENALTY * (1 - cleared));
  const deadlift = (state.oneRms.deadlift ?? 0) * (1 - RACE_THEN_MEET_DEADLIFT_PENALTY * (1 - cleared));
  const raceFirst: EventOrderOption = {
    order: "5k race → powerlifting meet",
    totalKg: squat + bench + deadlift,
    totalCostKg: currentTotal - (squat + bench + deadlift),
    fiveKS: state.predicted5kS,
    fiveKCostS: 0,
    safe: !DEADLIFT_AFTER_RACE_IS_UNSAFE,
    safetyNote:
      "Maximal deadlifting on fatigued erectors after a maximal 5k is a lumbar injury risk, not merely a " +
      "performance cost. This order requires an explicit override, and if you take it the event-day plan " +
      "instructs conservative attempts.",
    weightedCostPct: 0,
  };

  const cost = (o: EventOrderOption) =>
    goal.priority * (o.totalCostKg / Math.max(currentTotal, 1)) +
    (1 - goal.priority) * (o.fiveKCostS / Math.max(state.predicted5kS, 1));
  meetFirst.weightedCostPct = cost(meetFirst) * 100;
  raceFirst.weightedCostPct = cost(raceFirst) * 100;

  const safeOptions = [meetFirst, raceFirst].filter((o) => o.safe);
  const pool = safeOptions.length > 0 ? safeOptions : [meetFirst, raceFirst];
  const recommended = pool.reduce((best, o) => (o.weightedCostPct < best.weightedCostPct ? o : best));

  return {
    options: [meetFirst, raceFirst],
    recommended: recommended.order,
    interEventGapH: gap,
    recoveryClearedPct: cleared * 100,
    safetyConstrained: safeOptions.length < 2,
    confidenceNote:
      "The decrement figures behind these two options are unvalidated estimates, not measured constants. " +
      "They are good enough to rank the orders and not good enough to plan attempts around to the kilo. " +
      "Note also that federation weigh-in timing often forces the meet-first order regardless of preference.",
  };
}

// ---------------------------------------------------------------------------
// Joint taper (F12)
// ---------------------------------------------------------------------------

export interface TaperDay {
  day: number;
  note: string;
}

export function jointTaper(state: AthleteState, showFuellingGuidance: boolean): TaperDay[] {
  const choLo = Math.round(TAPER_CHO_G_PER_KG[0] * state.bodyweightKg);
  const choHi = Math.round(TAPER_CHO_G_PER_KG[1] * state.bodyweightKg);
  const carbNote = showFuellingGuidance
    ? `Full rest. Eat normally and carbohydrate-forward across the day — around ${choLo}-${choHi}g ` +
      `(${TAPER_CHO_G_PER_KG[0]}-${TAPER_CHO_G_PER_KG[1]}g/kg). This is NOT a marathon-style carbohydrate load: ` +
      `the water that comes with one adds 1.5-2kg, which costs you 5k time and moves your weigh-in mass. ` +
      `No weight cut.`
    : "Full rest. Eat normally and carbohydrate-forward across the day. No weight cut.";

  return [
    { day: -10, note: "Last heavy lower-body session (squat). ≥85% 1RM, singles and doubles, no failure, volume-load down 50%." },
    { day: -9, note: "LAST DEADLIFT of the block. One single at about 90% of your planned opener. Nothing heavier before the platform." },
    { day: -7, note: `Last hard interval session (5x1km at 5k pace). Endurance volume down ${Math.round(TAPER_ENDURANCE_VOLUME_REDUCTION * 100)}% from peak.` },
    { day: -5, note: "Openers: squat and bench at about 90% of your planned first attempt, one single each. No deadlift, no lower-body volume." },
    { day: -4, note: "Race-pace sharpener: 6x400m at 5k pace, full recovery. Nothing eccentric, no downhill." },
    { day: -3, note: "Upper body only, 2 sets, RIR 3. 30min easy aerobic." },
    { day: -2, note: "20min easy plus 4 strides. No lifting." },
    { day: -1, note: carbNote },
    { day: 0, note: "Event day — see the event-day plan." },
  ];
}

// ---------------------------------------------------------------------------
// Event day (F14)
// ---------------------------------------------------------------------------

export interface EventDayStep {
  t: string;
  note: string;
}

/**
 * The re-warm-up is the part that matters most here: "Going from four hours
 * of sitting between attempts straight into 5k race pace is a hamstring or
 * calf strain waiting to happen."
 */
export function eventDayPlan(goal: Goal, order: EventOrderResult): EventDayStep[] {
  const meetFirst = order.recommended.startsWith("Powerlifting");
  const gap = goal.interEventGapH;

  if (meetFirst) {
    return [
      { t: "T-2h00", note: "Weigh-in. Rehydrate and eat normally afterwards — no cut, so there is no rehydration deficit to recover from." },
      { t: "T-0h40", note: "Lift warm-up: 10min general, then ramping singles." },
      { t: "T+0h00", note: "Powerlifting meet: squat, bench, deadlift." },
      { t: `T+${gap.toFixed(0)}h`, note: "Between events: 60-90g carbohydrate per hour, fluid to thirst, legs up, stay warm." },
      { t: `T+${(gap - 0.5).toFixed(1)}h`, note: "5k re-warm-up: 12min easy, mobility, 4x20s strides. Do NOT go from sitting straight to race pace." },
      { t: `T+${gap.toFixed(0)}h`, note: "5k race. Run the first kilometre 3-5s/km slower than target — your expressed fitness is down and even splits protect the back half." },
    ];
  }

  return [
    { t: "T-2h00", note: "Weigh-in (federation timing may force the meet-first order regardless of preference)." },
    { t: "T-0h30", note: "5k warm-up: 15min easy, drills, 4x20s strides." },
    { t: "T+0h00", note: "5k race." },
    {
      t: `T+${gap.toFixed(0)}h`,
      note:
        "Meet. SAFETY: you overrode the recommended order, so deadlift attempts must be conservative — bracing " +
        "and erector function are measurably impaired after a maximal 5k. Reduce every attempt.",
    },
  ];
}
