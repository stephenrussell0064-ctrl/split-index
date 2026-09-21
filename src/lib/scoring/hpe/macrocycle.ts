/**
 * Hybrid Plan Engine — WP5: the macrocycle, on-ramp, deloads and ACWR.
 *
 * Closes four Critical assurance findings at once:
 *
 *  F3 — Week 1 volume IS the athlete's current weekly running minutes. Not a
 *       fraction of a target, not an idealised base week — the number they
 *       are already doing.
 *
 *  F4 — A deload every fourth week with intensity HELD. The intensity-held
 *       detail matters: dropping both is detraining, not deloading.
 *
 *  F5 — Genuine progressive overload, capped per week.
 *
 *  F6 — ACWR computed and enforced. Since constants 3.0.0 it is a BACKSTOP
 *       rather than the control: the evidence for the ratio as an injury
 *       predictor did not survive scrutiny (Impellizzeri 2020; Frandsen 2025
 *       found it inversely associated with injury in 5,205 runners). The
 *       controls that carry evidence are the weekly ramp cap here and the
 *       single-session spike rule in session-set.ts.
 *
 * Constants 3.0.0 changes, each traceable to the evidence register:
 *
 *  - The ramp multipliers no longer compound below a floor. Novice, provisional
 *    and safety-screen halvings stacked to a 1-2% weekly ramp, so a beginner
 *    went from 60 to 63 minutes in twelve weeks — a block that did nothing.
 *  - The novice halving lives here only. It used to fire here AND in the
 *    safety screen for the same answer.
 *  - Taper length follows the event (Bosquet 2007; Spilsbury 2015; Smyth &
 *    Lawlor 2021): one week for a 5k or 10k, two for a half, three for a
 *    marathon, always progressive and monotone.
 *  - The athlete's own previous maximum volume is a soft ceiling: the ramp
 *    halves above it and the block never exceeds it by more than a quarter.
 *  - Life load — stress 4+/5 or under six hours' sleep — slows the ramp.
 *  - Travel weeks become maintenance weeks rather than holes.
 *  - A plan can be CONTINUED from a given week, anchored to the athlete's
 *    current logged volume, so the block the athlete is living through is
 *    the block that gets adjusted rather than restarted.
 *
 * Volume is held flat through the specific and peak phases while intensity
 * rises — you do not add volume and intensity simultaneously in the specific
 * phase.
 */

import {
  ABOVE_PREVIOUS_MAX_RAMP_MULTIPLIER,
  ACWR_BLOCK,
  ACWR_CHRONIC_WEEKS,
  ACWR_ENFORCEMENT_PASSES,
  ACWR_FLOOR,
  ACWR_WARN,
  DELOAD_EVERY_N_WEEKS,
  DELOAD_VOLUME_MULTIPLIER,
  LIFE_LOAD_RAMP_MULTIPLIER,
  LIFE_LOAD_SLEEP_HOURS_THRESHOLD,
  LIFE_LOAD_STRESS_THRESHOLD,
  MAX_WEEKLY_VOLUME_RAMP,
  MIN_COMBINED_RAMP_MULTIPLIER,
  MIN_ENDURANCE_SESSION_MIN,
  NOVICE_ENDURANCE_YEARS,
  NOVICE_RAMP_MULTIPLIER,
  ONRAMP_MAX_MULTIPLE,
  ONRAMP_START_MULTIPLIER,
  PHASE_SHARE,
  PREVIOUS_MAX_VOLUME_HEADROOM,
  PROVISIONAL_START_RUN_MIN_PER_WEEK,
  TAPER_ENDURANCE_SHARE_BY_WEEK_FROM_RACE,
  TAPER_WEEKS_BY_EVENT,
  type Phase,
} from "./constants";
import type { AthleteState, Goal } from "./intake";

export interface MacrocycleWeek {
  /** 1-indexed week of the block. */
  week: number;
  phase: Phase;
  deload: boolean;
  /** Set when this is a travel week the athlete declared — a maintenance week, labelled as such. */
  travel?: boolean;
  /** Target endurance minutes for the week, after any deload reduction. */
  enduranceMin: number;
  /** Position within this phase, 0 (first week) to 1 (last week). Drives quality-session progression — see progression.ts, F15. */
  phaseProgress: number;
}

export interface MacrocycleOptions {
  /**
   * Continue an existing block from this week (1-based). Weeks before it are
   * emitted with the ramp they would have had — the caller replaces them with
   * the stored weeks the athlete has actually lived — and the ramp from this
   * week onwards starts at `volumeAtFromWeek`, the athlete's real current
   * volume, rather than at the plan's original projection.
   */
  fromWeek?: number;
  volumeAtFromWeek?: number;
  /** Plan weeks the athlete has said they will be away. */
  travelWeeks?: readonly number[];
}

/** Taper length in weeks for the athlete's event. A block with no event has a one-week test week. */
export function taperWeeksFor(goal: Pick<Goal, "enduranceEventKey" | "horizonSource" | "weeksOut">): number {
  const byEvent = goal.enduranceEventKey ? TAPER_WEEKS_BY_EVENT[goal.enduranceEventKey] : undefined;
  const wanted = goal.horizonSource === "event_date" && byEvent != null ? byEvent : 1;
  // A very short block cannot spend most of itself tapering.
  return Math.max(1, Math.min(wanted, Math.floor(goal.weeksOut / 4)));
}

/**
 * The effective weekly ramp for this athlete: the constant ceiling, scaled by
 * every caution factor, floored so the factors cannot compound the block into
 * standing still.
 */
export function effectiveRamp(state: AthleteState, rampMultiplier: number): { ramp: number; reasons: string[] } {
  const reasons: string[] = [];
  let multiplier = rampMultiplier;
  if (state.enduranceTrainingYears < NOVICE_ENDURANCE_YEARS) {
    multiplier *= NOVICE_RAMP_MULTIPLIER;
    reasons.push("under six months of running halves the ramp");
  }
  const stress = state.lifeStressNow ?? 3;
  const sleep = state.sleepHoursTypical ?? 7;
  if (stress >= LIFE_LOAD_STRESS_THRESHOLD || sleep < LIFE_LOAD_SLEEP_HOURS_THRESHOLD) {
    multiplier *= LIFE_LOAD_RAMP_MULTIPLIER;
    reasons.push(
      stress >= LIFE_LOAD_STRESS_THRESHOLD
        ? "high life stress right now slows the ramp (a coaching rule — recovery is slower under chronic stress)"
        : "under six hours' sleep slows the ramp (a coaching rule — recovery is slower short of sleep)"
    );
  }
  return { ramp: MAX_WEEKLY_VOLUME_RAMP * Math.max(MIN_COMBINED_RAMP_MULTIPLIER, multiplier), reasons };
}

/**
 * Builds one record per week. `rampMultiplier` comes from the safety screen
 * and the tailoring level and is applied on top of the weekly ceiling, never
 * instead of it.
 */
export function buildMacrocycle(
  state: AthleteState,
  goal: Goal,
  rampMultiplier = 1,
  options: MacrocycleOptions = {}
): MacrocycleWeek[] {
  const taperWeeks = taperWeeksFor(goal);
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
    let deficit = 1 - allocation.base;
    allocation.base = 1;
    for (const phase of ["peak", "specific", "build"] as Phase[]) {
      const take = Math.min(deficit, allocation[phase] - 1);
      allocation[phase] -= take;
      deficit -= take;
      if (deficit <= 0) break;
    }
  }

  const { ramp } = effectiveRamp(state, rampMultiplier);

  const viableWeeklyMinutes = (minutes: number): number =>
    minutes <= 0 ? 0 : Math.max(MIN_ENDURANCE_SESSION_MIN, Math.round(minutes));

  // F3: week 1 is exactly what the athlete is already doing. What they
  // already do may be nothing, in which case week 1 is deliberately small
  // rather than absent.
  const startingVolume =
    state.currentRunMinPerWeek > 0 ? state.currentRunMinPerWeek : PROVISIONAL_START_RUN_MIN_PER_WEEK;
  let volume = startingVolume * ONRAMP_START_MULTIPLIER;

  // The block's ceiling: a multiple of the start, and never more than a
  // quarter past the most the athlete has ever held for a month.
  const previousMax = state.previousMaxVolumeMin ?? null;
  let ceiling = startingVolume * ONRAMP_MAX_MULTIPLE;
  if (previousMax != null && previousMax > 0) {
    ceiling = Math.min(ceiling, Math.max(startingVolume, previousMax * PREVIOUS_MAX_VOLUME_HEADROOM));
  }

  const travel = new Set(options.travelWeeks ?? []);
  const fromWeek = options.fromWeek ?? 1;

  let peakVolume = volume;
  let week = 1;
  const weeks: MacrocycleWeek[] = [];

  for (const phase of developmentPhases) {
    const phaseWeeks = allocation[phase];
    for (let i = 0; i < phaseWeeks; i++) {
      const isTravel = travel.has(week);
      const deload = week % DELOAD_EVERY_N_WEEKS === 0 || isTravel;

      if (week === fromWeek && fromWeek > 1 && options.volumeAtFromWeek != null && options.volumeAtFromWeek > 0) {
        // Continuing the block: the ramp restarts from what the athlete is
        // actually doing now, not from where the original projection said
        // they would be.
        volume = Math.min(options.volumeAtFromWeek, ceiling);
      } else if (week > 1 && !deload) {
        // Above the athlete's own proven ceiling the ramp halves.
        const stepRamp = previousMax != null && previousMax > 0 && volume >= previousMax
          ? ramp * ABOVE_PREVIOUS_MAX_RAMP_MULTIPLIER
          : ramp;
        volume = Math.min(volume * (1 + stepRamp), ceiling);
      }
      // Specific and peak hold volume and raise intensity instead.
      if (phase === "specific" || phase === "peak") volume = Math.min(volume, peakVolume);
      peakVolume = Math.max(peakVolume, volume);
      weeks.push({
        week,
        phase,
        deload,
        travel: isTravel || undefined,
        enduranceMin: viableWeeklyMinutes(volume * (deload ? DELOAD_VOLUME_MULTIPLIER : 1)),
        phaseProgress: phaseWeeks > 1 ? i / (phaseWeeks - 1) : 1,
      });
      week++;
    }
  }

  // Progressive, monotone taper: race week is the deepest cut, and every
  // week before it is a step above the one after.
  for (let i = 0; i < taperWeeks; i++) {
    const weeksFromRace = taperWeeks - 1 - i;
    const share =
      TAPER_ENDURANCE_SHARE_BY_WEEK_FROM_RACE[
        Math.min(weeksFromRace, TAPER_ENDURANCE_SHARE_BY_WEEK_FROM_RACE.length - 1)
      ];
    weeks.push({
      week,
      phase: "taper",
      deload: false,
      travel: travel.has(week) || undefined,
      enduranceMin: viableWeeklyMinutes(peakVolume * share),
      phaseProgress: taperWeeks > 1 ? i / (taperWeeks - 1) : 1,
    });
    week++;
  }

  return weeks;
}

// ---------------------------------------------------------------------------
// F6 — ACWR (backstop)
// ---------------------------------------------------------------------------

/**
 * Acute (1 week) : chronic (rolling 4-week mean), seeded from the athlete's
 * ACTUAL chronic load — in the same stress units as the plan's own weeks —
 * so week 1 is measured against reality rather than zero.
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
  /** Weeks sitting below the detraining floor. */
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

  const maxPasses = Math.max(ACWR_ENFORCEMENT_PASSES, stress.length * 2);
  for (let pass = 0; pass < maxPasses; pass++) {
    const ratios = acwrSeries(stress, seedChronic);
    const breaching = ratios.map((r, i) => ({ r, i })).filter(({ r }) => r > ACWR_BLOCK);
    if (breaching.length === 0) break;

    const padded = [...Array.from({ length: ACWR_CHRONIC_WEEKS }, () => seedChronic), ...stress];
    // Earliest first: capping an early week lowers the chronic denominator for
    // every week after it, so working forwards converges.
    const { i: worst, r } = breaching[0];
    const window = padded.slice(worst, worst + ACWR_CHRONIC_WEEKS);
    const chronic = window.reduce((s, v) => s + v, 0) / window.length;
    const capped = chronic * ACWR_WARN;
    if (notes.length < stress.length) {
      notes.push(
        `Week ${weeks[worst]?.week ?? worst + 1}: the jump in total training load (${r.toFixed(2)}× your recent ` +
          `average) was over the ${ACWR_BLOCK} backstop, so this week is trimmed from ${stress[worst].toFixed(0)} to ` +
          `${capped.toFixed(0)} stress units. The ramp is the constraint here, not your ambition.`
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
