/**
 * Hybrid Plan Engine — WP5: the macrocycle, on-ramp, deloads and ACWR
 * enforcement.
 *
 * Closes four Critical assurance findings at once:
 *
 *  F3 — "Rev A's week 1 prescribed four to five endurance sessions to an
 *       athlete currently running twice a week, and did so at full base-phase
 *       volume. The `chronic_load` field existed on the athlete record and was
 *       never read by a single line of code. This is the single most common
 *       way generated plans injure people: the plan is internally coherent and
 *       starts 60% above where the athlete actually is." Week 1 volume IS the
 *       athlete's current weekly running minutes. Not a fraction of a target,
 *       not an idealised base week — the number they are already doing.
 *
 *  F4 — A deload every fourth week at 60% volume with intensity HELD. The
 *       intensity-held detail matters: dropping both is detraining, not
 *       deloading.
 *
 *  F5 — Genuine progressive overload, capped at 8%/week. Rev A ran 505 in base
 *       week 1 and 540 in specific week 17, "not a training plan, it is the
 *       same week repeated with different labels."
 *
 *  F6 — ACWR computed and ENFORCED, not merely specified. The review names
 *       this pattern explicitly: "a control that is specified but not
 *       implemented is worse than no control, because it is reported as
 *       present." The chronic denominator is seeded from the athlete's real
 *       chronic load so week 1 is measured against reality rather than zero.
 *
 * Volume is held flat through the specific and peak phases while intensity
 * rises — you do not add volume and intensity simultaneously in the specific
 * phase.
 */

import {
  MIN_ENDURANCE_SESSION_MIN,
  ACWR_BLOCK,
  ACWR_CHRONIC_WEEKS,
  ACWR_ENFORCEMENT_PASSES,
  ACWR_FLOOR,
  ACWR_WARN,
  DELOAD_EVERY_N_WEEKS,
  DELOAD_VOLUME_MULTIPLIER,
  MAX_WEEKLY_VOLUME_RAMP,
  NOVICE_ENDURANCE_YEARS,
  NOVICE_RAMP_MULTIPLIER,
  ONRAMP_MAX_MULTIPLE,
  ONRAMP_START_MULTIPLIER,
  PROVISIONAL_START_RUN_MIN_PER_WEEK,
  PHASE_SHARE,
  TAPER_DAYS,
  TAPER_ENDURANCE_VOLUME_REDUCTION,
  type Phase,
} from "./constants";
import type { AthleteState, Goal } from "./intake";

export interface MacrocycleWeek {
  /** 1-indexed week of the block. */
  week: number;
  phase: Phase;
  deload: boolean;
  /** Target endurance minutes for the week, after any deload reduction. */
  enduranceMin: number;
  /** Position within this phase, 0 (first week) to 1 (last week). Drives quality-session progression — see progression.ts, F15. */
  phaseProgress: number;
}

/**
 * Builds one record per week. `rampMultiplier` comes from the safety screen
 * (halved for novice runners and for a recent injury) and is applied on top
 * of the 8% ceiling, never instead of it.
 */
export function buildMacrocycle(state: AthleteState, goal: Goal, rampMultiplier = 1): MacrocycleWeek[] {
  const taperWeeks = Math.max(1, Math.round(TAPER_DAYS / 7));
  const remaining = Math.max(1, goal.weeksOut - taperWeeks);

  // Allocate the non-taper weeks across the four development phases.
  const developmentPhases: Phase[] = ["base", "build", "specific", "peak"];
  const allocation: Record<string, number> = {};
  let assigned = 0;
  for (const phase of developmentPhases) {
    const share = PHASE_SHARE[phase] / (1 - PHASE_SHARE.taper);
    const n = Math.max(1, Math.round(remaining * share));
    allocation[phase] = n;
    assigned += n;
  }
  // Any rounding drift lands in base — the phase that most tolerates being
  // longer, and the one an under-prepared athlete benefits most from.
  allocation.base += remaining - assigned;
  if (allocation.base < 1) {
    // A very short block can drive base negative; take the shortfall back off
    // the later phases rather than emitting a phase of negative length.
    let deficit = 1 - allocation.base;
    allocation.base = 1;
    for (const phase of ["peak", "specific", "build"] as Phase[]) {
      const take = Math.min(deficit, allocation[phase] - 1);
      allocation[phase] -= take;
      deficit -= take;
      if (deficit <= 0) break;
    }
  }

  let ramp = MAX_WEEKLY_VOLUME_RAMP * rampMultiplier;
  if (state.enduranceTrainingYears < NOVICE_ENDURANCE_YEARS) ramp *= NOVICE_RAMP_MULTIPLIER;

  /**
   * A week's endurance budget, floored at one session that is worth doing.
   *
   * The budget decides how many endurance slots the week gets
   * (session-set.ts, affordableBySessionLength) and is quoted back to the
   * athlete in the week's notes. Below MIN_ENDURANCE_SESSION_MIN it can buy no
   * session at all, so it stopped describing anything: a real block budgeted
   * 5 minutes a week for eight weeks while the session generator — which
   * applies its own floor — wrote 35, 41, 47 and 59-minute runs into those same
   * weeks. The athlete's note read "5 minutes split any further would be
   * sessions too short to be worth doing" beside a 35-minute run.
   *
   * Zero stays zero. An athlete with no endurance in their plan at all is a
   * different case from one whose budget rounded below a session, and this must
   * not conjure running for someone who is not doing any.
   */
  const viableWeeklyMinutes = (minutes: number): number =>
    minutes <= 0 ? 0 : Math.max(MIN_ENDURANCE_SESSION_MIN, Math.round(minutes));

  const weeks: MacrocycleWeek[] = [];
  // F3: week 1 is exactly what the athlete is already doing.
  // An on-ramp is multiplicative, and no multiple of zero is anything but
  // zero. An athlete currently doing no running — a powerlifter adding
  // conditioning, a complete beginner — was therefore given a plan with no
  // endurance minutes in any week, forever. Found by the five-persona
  // simulation, where three of five athletes received a two-session week of
  // nothing but generic maintenance.
  //
  // Starting from a low floor instead is the conservative reading of "week 1
  // is what you already do": what they already do is nothing, so week 1 is
  // deliberately small rather than absent.
  const startingVolume =
    state.currentRunMinPerWeek > 0 ? state.currentRunMinPerWeek : PROVISIONAL_START_RUN_MIN_PER_WEEK;
  let volume = startingVolume * ONRAMP_START_MULTIPLIER;
  const ceiling = startingVolume * ONRAMP_MAX_MULTIPLE;
  let peakVolume = volume;
  let week = 1;

  for (const phase of developmentPhases) {
    const phaseWeeks = allocation[phase];
    for (let i = 0; i < phaseWeeks; i++) {
      const deload = week % DELOAD_EVERY_N_WEEKS === 0;
      if (week > 1 && !deload) volume = Math.min(volume * (1 + ramp), ceiling);
      // Specific and peak hold volume and raise intensity instead.
      if (phase === "specific" || phase === "peak") volume = Math.min(volume, peakVolume);
      peakVolume = Math.max(peakVolume, volume);
      weeks.push({
        week,
        phase,
        deload,
        enduranceMin: viableWeeklyMinutes(volume * (deload ? DELOAD_VOLUME_MULTIPLIER : 1)),
        phaseProgress: phaseWeeks > 1 ? i / (phaseWeeks - 1) : 1,
      });
      week++;
    }
  }

  for (let i = 0; i < taperWeeks; i++) {
    weeks.push({
      week,
      phase: "taper",
      deload: false,
      enduranceMin: viableWeeklyMinutes(peakVolume * (1 - TAPER_ENDURANCE_VOLUME_REDUCTION)),
      phaseProgress: taperWeeks > 1 ? i / (taperWeeks - 1) : 1,
    });
    week++;
  }

  return weeks;
}

// ---------------------------------------------------------------------------
// F6 — ACWR
// ---------------------------------------------------------------------------

/**
 * Acute (1 week) : chronic (rolling 4-week mean), seeded from the athlete's
 * ACTUAL chronic load so week 1 is measured against reality rather than zero.
 * Seeding is the whole point — an unseeded series makes every on-ramp week
 * look like a spike and every real spike look normal.
 */
export function acwrSeries(weeklyStress: number[], seedChronic: number): number[] {
  const out: number[] = [];
  const history: number[] = Array.from({ length: ACWR_CHRONIC_WEEKS }, () => seedChronic);
  for (const stress of weeklyStress) {
    const window = history.slice(-ACWR_CHRONIC_WEEKS);
    const chronic = window.reduce((s, v) => s + v, 0) / window.length;
    out.push(chronic > 0 ? stress / chronic : 0);
    history.push(stress);
  }
  return out;
}

export interface AcwrEnforcement {
  /** Weekly stress after capping. */
  cappedStress: number[];
  ratios: number[];
  /** One note per week that had to be scaled back — shown to the athlete, not just logged. */
  notes: string[];
  /** Weeks sitting below the detraining floor. An on-ramp week here is fine, but it must be surfaced as deliberately easy rather than left looking like a bug. */
  belowFloorWeeks: number[];
  /** Weeks between the warning line and the block ceiling. */
  warningWeeks: number[];
  peakAcwr: number;
}

/**
 * Iteratively scales back any week breaching the block ceiling, recomputing
 * the series each pass because capping one week changes the chronic
 * denominator of every week after it.
 */
export function enforceAcwr(
  weeks: MacrocycleWeek[],
  weeklyStress: number[],
  seedChronic: number
): AcwrEnforcement {
  const stress = [...weeklyStress];
  const notes: string[] = [];

  // Cap EVERY breaching week each pass, not just the worst one.
  //
  // Capping one week per pass and stopping after ten meant a long block where
  // many weeks breach simply never converged — the enforcement ran, reported
  // notes, and shipped a plan still above the ceiling. That is the exact
  // failure mode the assurance review named: a control that is reported as
  // present while not actually holding. The passes now scale with the block
  // length and the loop asserts convergence rather than assuming it.
  const maxPasses = Math.max(ACWR_ENFORCEMENT_PASSES, stress.length * 2);
  for (let pass = 0; pass < maxPasses; pass++) {
    const ratios = acwrSeries(stress, seedChronic);
    const breaching = ratios.map((r, i) => ({ r, i })).filter(({ r }) => r > ACWR_BLOCK);
    if (breaching.length === 0) break;

    const padded = [...Array.from({ length: ACWR_CHRONIC_WEEKS }, () => seedChronic), ...stress];
    // Earliest first: capping an early week lowers the chronic denominator for
    // every week after it, so working forwards converges where working from
    // the worst backwards oscillates.
    const { i: worst, r } = breaching[0];
    const window = padded.slice(worst, worst + ACWR_CHRONIC_WEEKS);
    const chronic = window.reduce((s, v) => s + v, 0) / window.length;
    const capped = chronic * ACWR_WARN;
    if (notes.length < stress.length) {
      notes.push(
        `Week ${weeks[worst]?.week ?? worst + 1}: acute:chronic load ${r.toFixed(2)} exceeded the ` +
          `${ACWR_BLOCK} ceiling, so this week is capped from ${stress[worst].toFixed(0)} to ${capped.toFixed(0)} ` +
          `stress units. The ramp is the constraint here, not your ambition.`
      );
    }
    stress[worst] = capped;
  }

  const ratios = acwrSeries(stress, seedChronic);
  return {
    cappedStress: stress,
    ratios,
    notes,
    belowFloorWeeks: ratios.map((r, i) => (r < ACWR_FLOOR ? weeks[i]?.week ?? i + 1 : -1)).filter((w) => w > 0),
    warningWeeks: ratios
      .map((r, i) => (r > ACWR_WARN && r <= ACWR_BLOCK ? weeks[i]?.week ?? i + 1 : -1))
      .filter((w) => w > 0),
    peakAcwr: ratios.length > 0 ? Math.max(...ratios) : 0,
  };
}
