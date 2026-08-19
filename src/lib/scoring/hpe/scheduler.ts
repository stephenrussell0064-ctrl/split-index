/**
 * Hybrid Plan Engine — the weekly scheduler.
 *
 * Places each selected session on a day and a slot, scored against the
 * interference and recovery constraints. Port of the Rev B reference
 * scheduler with two deliberate changes, both raised rather than silently
 * chosen:
 *
 *  D7. **Determinism.** The reference uses Python's `random.Random` seeded
 *      per restart. Non-negotiable #2 requires generation to be deterministic
 *      and stamped with the constants version, and reproducing CPython's
 *      Mersenne Twister in TypeScript to get bit-identical placements would
 *      buy nothing real. A seeded LCG is used instead: same input, same
 *      output, every time, on every platform. Placements will differ from the
 *      Python reference's; the acceptance criterion that matters — zero
 *      hard-rule violations — is asserted directly in the tests rather than
 *      by comparing placements.
 *
 *  D8. **Real clock times.** The reference hardcodes AM=07:00 and PM=18:00.
 *      HPE-ATHLETE-INTAKE-SPEC.md is emphatic that this is wrong: "an athlete
 *      training at 06:00 and 12:00 has a 6-hour gap while one training at
 *      12:00 and 17:00 does not. Assuming default clock times silently breaks
 *      the constraint the engine claims to enforce." Separation is computed
 *      from the athlete's own `amHour`/`pmHour`.
 *
 * The assurance review's warning about this whole module is worth keeping in
 * view: both Rev A and Rev B score zero hard-rule violations, and Rev A was
 * not safe to ship. "Constraint satisfaction is a necessary condition and a
 * poor proxy for quality."
 */

import {
  DAILY_STRESS_CAP,
  DAYS,
  DEADLIFT_TO_LONG_RUN_H,
  FLOOR_SEPARATION_H,
  HARD_PENALTIES,
  HEAVY_LOWER_TO_QUALITY_ENDURANCE_H,
  MAX_CONSECUTIVE_TRAINING_DAYS,
  MIN_SEPARATION_H,
  PENALTY,
  QUALITY_ENDURANCE_TO_HEAVY_LOWER_H,
  SCHEDULER_ITERATIONS,
  SCHEDULER_RESTARTS,
  SCHEDULER_PLATEAU_ITERATIONS,
  SCHEDULER_SEED,
} from "./constants";
import type { Constraints } from "./intake";
import type { PlannedSession } from "./session-set";

export type Slot = "AM" | "PM";

export interface Placement {
  session: PlannedSession;
  day: string;
  slot: Slot;
}

/** Deterministic linear congruential generator — same seed, same schedule, always. */
function makeRng(seed: number) {
  let state = seed >>> 0;
  return {
    next(): number {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 4294967296;
    },
    int(max: number): number {
      return Math.floor(this.next() * max);
    },
  };
}

function hourOf(constraints: Constraints, slot: Slot): number {
  return slot === "AM" ? constraints.amHour : constraints.pmHour;
}

function absoluteHour(constraints: Constraints, day: string, slot: Slot): number {
  return DAYS.indexOf(day as (typeof DAYS)[number]) * 24 + hourOf(constraints, slot);
}

/** True for any session whose fatigue lands mostly on the legs and back. */
function isLowerBodyLoad(s: PlannedSession): boolean {
  return (
    s.isHeavyLower ||
    s.kind === "squat_volume" ||
    s.kind === "deadlift_volume" ||
    s.kind === "long_run"
  );
}

export type PenaltyBreakdown = Record<string, number>;

export function scoreWeek(placements: Placement[], constraints: Constraints): PenaltyBreakdown {
  const p: PenaltyBreakdown = Object.fromEntries(Object.keys(PENALTY).map((k) => [k, 0]));
  const usedDays = new Set(placements.map((x) => x.day));

  for (const { day } of placements) {
    if (!constraints.daysAvailable.includes(day)) p.day_unavailable += PENALTY.day_unavailable;
  }

  // Soft preferences. Weighted far below every physiological rule, so they
  // break ties rather than win arguments.
  if (constraints.preferredRestDay && usedDays.has(constraints.preferredRestDay)) {
    p.preferred_rest_day_used += PENALTY.preferred_rest_day_used;
  }
  if (constraints.preferredLongDay) {
    const longRun = placements.find((x) => x.session.kind === "long_run");
    if (longRun && longRun.day !== constraints.preferredLongDay) {
      p.preferred_long_day_missed += PENALTY.preferred_long_day_missed;
    }
  }

  const restDays = 7 - usedDays.size;
  if (restDays < constraints.minRestDays) {
    p.no_rest_day += PENALTY.no_rest_day * (constraints.minRestDays - restDays);
  }

  let streak = 0;
  let longest = 0;
  for (const day of DAYS) {
    streak = usedDays.has(day) ? streak + 1 : 0;
    longest = Math.max(longest, streak);
  }
  if (longest > MAX_CONSECUTIVE_TRAINING_DAYS) {
    p.consecutive_days_exceeded += PENALTY.consecutive_days_exceeded * (longest - MAX_CONSECUTIVE_TRAINING_DAYS);
  }

  const byDay = new Map<string, PlannedSession[]>();
  for (const { session, day } of placements) {
    byDay.set(day, [...(byDay.get(day) ?? []), session]);
  }
  const freeDays = constraints.daysAvailable.filter((d) => !usedDays.has(d));
  for (const daySessions of byDay.values()) {
    const total = daySessions.reduce((s, x) => s + x.stress, 0);
    if (total > DAILY_STRESS_CAP) p.daily_stress_cap += PENALTY.daily_stress_cap * (total - DAILY_STRESS_CAP);
    if (daySessions.length > 1 && freeDays.length > 0) p.avoidable_double_day += PENALTY.avoidable_double_day;
  }

  for (let i = 0; i < placements.length; i++) {
    for (let j = i + 1; j < placements.length; j++) {
      const a = placements[i];
      const b = placements[j];
      const ta = absoluteHour(constraints, a.day, a.slot);
      const tb = absoluteHour(constraints, b.day, b.slot);
      const gap = Math.abs(tb - ta);

      if (a.day === b.day && a.session.domain !== b.session.domain) {
        if (gap < FLOOR_SEPARATION_H) p.sep_below_floor += PENALTY.sep_below_floor;
        else if (gap < MIN_SEPARATION_H) p.sep_below_preferred += PENALTY.sep_below_preferred;
        const first = ta <= tb ? a.session : b.session;
        const second = first === a.session ? b.session : a.session;
        // Quality goes first when two sessions share a day — doing the hard
        // one on the fatigue of the easy one wastes the hard one.
        if (!first.isQuality && second.isQuality) p.wrong_order_same_day += PENALTY.wrong_order_same_day;
      }

      const [x, y, dt] = ta <= tb ? [a.session, b.session, tb - ta] : [b.session, a.session, ta - tb];

      if (x.isHeavyLower && y.domain === "endurance" && y.isQuality && dt < HEAVY_LOWER_TO_QUALITY_ENDURANCE_H) {
        p.heavy_lower_before_quality += PENALTY.heavy_lower_before_quality;
      }
      if (x.domain === "endurance" && x.isQuality && y.isHeavyLower && dt < QUALITY_ENDURANCE_TO_HEAVY_LOWER_H) {
        p.quality_before_heavy_lower += PENALTY.quality_before_heavy_lower;
      }
      if (x.isHeavyLower && y.isHeavyLower && dt < HEAVY_LOWER_TO_QUALITY_ENDURANCE_H) {
        p.heavy_lower_too_close += PENALTY.heavy_lower_too_close;
      }
      // F11-adjacent: deadlifting close before a long run.
      if (x.isDeadlift && y.kind === "long_run" && dt < DEADLIFT_TO_LONG_RUN_H) {
        p.deadlift_before_long_run += PENALTY.deadlift_before_long_run;
      }
      if (x.stress >= 85 && x.intensity < 0.6 && y.intensity >= 0.85 && dt >= 12) {
        p.volume_before_intensity += PENALTY.volume_before_intensity;
      }
      if (isLowerBodyLoad(x) && isLowerBodyLoad(y) && dt > 0 && dt < 36) {
        p.consecutive_lower_days += PENALTY.consecutive_lower_days;
      }
      // F8b: the same lift on back-to-back days.
      if (
        x.domain === "strength" &&
        y.domain === "strength" &&
        x.lift != null &&
        x.lift === y.lift &&
        dt > 0 &&
        dt < 36
      ) {
        p.same_lift_consecutive_days += PENALTY.same_lift_consecutive_days;
      }
    }
  }

  // Nudges the hardest sessions toward the front of the week, where the
  // athlete is freshest.
  for (const { session, day } of placements) {
    if (session.intensity >= 0.88) {
      p.intensity_drift += PENALTY.intensity_drift * DAYS.indexOf(day as (typeof DAYS)[number]);
    }
  }

  return p;
}

export function totalPenalty(placements: Placement[], constraints: Constraints): number {
  return Object.values(scoreWeek(placements, constraints)).reduce((s, v) => s + v, 0);
}

/** The acceptance metric: total penalty from HARD rules only. Must be zero. */
export function hardViolations(placements: Placement[], constraints: Constraints): number {
  const breakdown = scoreWeek(placements, constraints);
  return Object.entries(breakdown)
    .filter(([k]) => HARD_PENALTIES.has(k))
    .reduce((s, [, v]) => s + v, 0);
}

export interface ScheduleResult {
  placements: Placement[];
  penalty: number;
  hardPenalty: number;
  /** Set when there were more sessions than slots — the week is truncated rather than overbooked, and the caller is told. */
  droppedSessions: PlannedSession[];
}

/**
 * Deterministic seeded local search: several restarts, each hill-climbing by
 * moving or swapping one session at a time. Sessions beyond the available
 * slot count are dropped rather than crammed in, lowest-priority first —
 * overbooking a week the athlete cannot physically complete is the failure
 * mode this whole engine exists to avoid.
 */
export function scheduleWeek(sessions: PlannedSession[], constraints: Constraints): ScheduleResult {
  const slots: Slot[] = constraints.twoADaysPossible ? ["AM", "PM"] : ["AM"];
  const candidates: { day: string; slot: Slot }[] = [];
  for (const day of constraints.daysAvailable) {
    for (const slot of slots) candidates.push({ day, slot });
  }

  let toPlace = sessions;
  let droppedSessions: PlannedSession[] = [];
  if (candidates.length < sessions.length) {
    // Drop easy volume before quality — losing the session that was bought by
    // the athlete's strongest diagnostic finding is the wrong trade.
    const ordered = [...sessions].sort((a, b) => Number(b.isQuality) - Number(a.isQuality));
    toPlace = ordered.slice(0, candidates.length);
    droppedSessions = ordered.slice(candidates.length);
  }

  if (toPlace.length === 0) {
    return { placements: [], penalty: 0, hardPenalty: 0, droppedSessions };
  }

  let bestGlobal: Placement[] | null = null;
  let bestGlobalScore = Number.POSITIVE_INFINITY;

  for (let restart = 0; restart < SCHEDULER_RESTARTS; restart++) {
    const rng = makeRng(SCHEDULER_SEED + restart * 101);
    // Fisher-Yates over a copy, so each restart starts somewhere different
    // but reproducibly so.
    const shuffled = [...candidates];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = rng.int(i + 1);
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    let current: Placement[] = toPlace.map((session, i) => ({
      session,
      day: shuffled[i].day,
      slot: shuffled[i].slot,
    }));
    let currentScore = totalPenalty(current, constraints);

    let sinceImprovement = 0;
    for (let iter = 0; iter < SCHEDULER_ITERATIONS; iter++) {
      // Converged: on a seven-day week with a dozen sessions the search
      // settles well inside the budget, and burning the rest changes nothing.
      if (sinceImprovement >= SCHEDULER_PLATEAU_ITERATIONS) break;
      const trial = [...current];
      const i = rng.int(trial.length);
      const pick = candidates[rng.int(candidates.length)];
      const occupant = trial.findIndex((pl) => pl.day === pick.day && pl.slot === pick.slot);
      if (occupant >= 0) {
        if (occupant === i) {
          sinceImprovement++;
          continue;
        }
        trial[i] = { ...trial[i], day: trial[occupant].day, slot: trial[occupant].slot };
        trial[occupant] = { ...trial[occupant], day: current[i].day, slot: current[i].slot };
      } else {
        trial[i] = { ...trial[i], day: pick.day, slot: pick.slot };
      }
      const score = totalPenalty(trial, constraints);
      if (score < currentScore) {
        current = trial;
        currentScore = score;
        sinceImprovement = 0;
      } else if (score === currentScore) {
        // Sideways moves keep the search from stalling in a plateau, but they
        // are not progress and must not reset the convergence counter.
        current = trial;
        sinceImprovement++;
      } else {
        sinceImprovement++;
      }
    }

    if (currentScore < bestGlobalScore) {
      bestGlobal = current;
      bestGlobalScore = currentScore;
    }
  }

  const placements = (bestGlobal ?? []).sort(
    (a, b) => absoluteHour(constraints, a.day, a.slot) - absoluteHour(constraints, b.day, b.slot)
  );
  return {
    placements,
    penalty: bestGlobalScore,
    hardPenalty: hardViolations(placements, constraints),
    droppedSessions,
  };
}
