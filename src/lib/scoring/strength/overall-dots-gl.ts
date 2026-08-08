import { calculateDOTS } from "./dots";
import { calculateGLPoints } from "./gl";
import type { GLEquipment, StrengthSex } from "./coefficients";
import { sbdLiftForExercise, type SBDLift } from "./strength-engine";

export interface OverallDotsGlResult {
  /** Best-ever 1RM logged for each SBD lift, kg (0 if never logged). */
  bestSbdKg: Record<SBDLift, number>;
  /** Sum of whichever SBD lifts have been logged at least once. */
  sbdTotalKg: number;
  /** How many of squat/bench/deadlift have ever been logged. */
  liftsLogged: number;
  dotsScore: number;
  glPoints: number;
}

/**
 * The athlete's profile-level DOTS/GL: built from their single best-ever
 * estimated 1RM for each of squat/bench/deadlift, drawn from every gym
 * session they've ever logged — not just the most recently logged one.
 *
 * This is deliberately distinct from the per-workout DOTS/GL (computed by
 * calculateStrengthIndexV2 from one session's own SBD lifts): a session
 * that only touched bench, or that logged working sets below the athlete's
 * true best, would otherwise make the dashboard's headline DOTS/GL read as
 * "wrong" relative to what the athlete knows they can lift. User feedback:
 * a 135/135/190kg reference lifter expects 317.19 DOTS / 64.88 IPF GL, but
 * the single-session number can read far lower whenever that session's own
 * total doesn't reach the athlete's real best across all three lifts.
 */
export function calculateOverallDotsGl(
  exercises: Array<{ exercise_name: string; estimated_1rm_kg: number | null }>,
  bodyweightKg: number,
  sex: StrengthSex,
  equipment: GLEquipment = "classic"
): OverallDotsGlResult {
  const bestSbdKg: Record<SBDLift, number> = { squat: 0, bench: 0, deadlift: 0 };

  for (const ex of exercises) {
    const lift = sbdLiftForExercise(ex.exercise_name);
    if (!lift) continue;
    const e1rm = ex.estimated_1rm_kg ?? 0;
    if (e1rm > bestSbdKg[lift]) bestSbdKg[lift] = e1rm;
  }

  const liftsLogged = (["squat", "bench", "deadlift"] as SBDLift[]).filter(
    (l) => bestSbdKg[l] > 0
  ).length;
  const sbdTotalKg = bestSbdKg.squat + bestSbdKg.bench + bestSbdKg.deadlift;

  if (sbdTotalKg <= 0 || bodyweightKg <= 0) {
    return { bestSbdKg, sbdTotalKg: 0, liftsLogged: 0, dotsScore: 0, glPoints: 0 };
  }

  return {
    bestSbdKg,
    sbdTotalKg,
    liftsLogged,
    dotsScore: calculateDOTS(sbdTotalKg, bodyweightKg, sex),
    glPoints: calculateGLPoints(sbdTotalKg, bodyweightKg, sex, equipment),
  };
}
