/**
 * Hybrid Plan Engine — WP6: session selection driven by the emphasis vector.
 *
 * This is the module Rev 2 rewrote, and it is where the product claim lives.
 * Rev 1 chose sessions from fixed per-phase counts, so two athletes with the
 * same 5k time, the same goal and the same free days got the same plan. Rev 2
 * allocates the week's available sessions PROPORTIONALLY TO THE EMPHASIS
 * VECTOR, then applies the phase's intensity-distribution targets and the hard
 * interference constraints as filters.
 *
 * Allocation order, from the brief:
 *   1. Reserve the mandatory minimums — one long run, and the minimum
 *      maintenance dose for any domain in maintain mode.
 *   2. Allocate remaining slots proportionally to emphasis, largest remainder
 *      first.
 *   3. Apply hard caps: at most three quality endurance sessions, one heavy
 *      lower-body day once loads exceed 82% 1RM.
 *   4. Reconcile against the phase TID targets; where emphasis and phase
 *      conflict, PHASE WINS in specific/peak/taper, EMPHASIS WINS in
 *      base/build.
 *
 * Non-negotiable #7 is enforced structurally rather than by convention: a
 * session is only ever constructed through `makeSession`, which requires a
 * findingId.
 *
 * Constants 3.0.0 — what changed here and why, each traceable to the evidence
 * register (docs/HPE-EVIDENCE-REVIEW-2026-09.md):
 *
 *  - A quality session is a SESSION SIZE, not a slice of a small budget. The
 *    old 15%-of-budget rule made it structurally impossible for anyone under
 *    200 min/week to be given a hard session; a sub-20 athlete on four sessions
 *    a week went eleven weeks with no speed work and then got the block's
 *    hardest interval session in the taper.
 *  - The priority slider moves whole sessions between domains (Jones 2013:
 *    3:1 matched strength-only gains, 1:1 did not), not one at the margin.
 *  - The athlete's stated hours cap is a cap on the whole week, strength
 *    included. It was collected and never read.
 *  - The long run is bound by the single-session spike rule (Frandsen 2025):
 *    never more than 10% over the longest run of the last month, and never
 *    more than 10% over last week's. On a deload week it comes DOWN.
 *  - Strength progresses inside a phase (the load band walks up week by week)
 *    and the working max walks up with the block's expected gain, so two
 *    weeks are never the same session. A peaking athlete's lower day carries
 *    both lower lifts, so each is met twice a week on three gym days.
 *  - The heavy-lower flag is set from the loads actually prescribed, not from
 *    the unshifted phase table.
 *  - Deloads cut strength sets and add a rep in reserve; the final taper week
 *    caps deadlift, squat and bench at lift-specific ceilings (Travis 2021).
 *  - Disliked accessories are filtered out of the pool.
 */

import {
  BASE_STRESS_PER_MIN,
  DEFAULT_STRENGTH_STRESS,
  DEFAULT_STRESS_PER_MIN,
  DELOAD_LONG_RUN_MULTIPLIER,
  DELOAD_STRENGTH_RIR_BONUS,
  DELOAD_STRENGTH_SET_MULTIPLIER,
  EMPHASIS_KEYS,
  ENDURANCE_SESSIONS_BY_PHASE,
  HEAVY_LOWER_BODY_LOAD_THRESHOLD,
  LIFT_PRESCRIPTIONS,
  GENERAL_STRENGTH_SPEC,
  CORE_ACCESSORY_CAP,
  STRENGTH_WARMUP_MIN,
  STRENGTH_MIN_PER_EXERCISE,
  MIN_EXERCISES_PER_STRENGTH_SESSION,
  TARGET_EXERCISES_PER_STRENGTH_SESSION,
  POSTERIOR_CHAIN_ACCESSORY_POOL,
  STRENGTH_ACCESSORY_POOL,
  PRIMARY_LIFT_VARIANTS,
  MAINTENANCE_REPS,
  MAINTENANCE_SETS,
  DEFAULT_TRAINING_SPLIT,
  TRAINING_SPLITS,
  type SplitDay,
  NO_GYM_REP_RANGE,
  NO_GYM_SUBSTITUTIONS,
  NOVICE_ENDURANCE_YEARS,
  LIFE_LOAD_MAX_QUALITY_SESSIONS,
  LONG_RUN_MAX_MINUTES,
  LONG_RUN_PEAK_FRACTION_OF_RACE,
  LONG_RUN_MIN_MULTIPLE_OF_EASY,
  LONG_RUN_MINUTE_SHARE,
  LONG_RUN_QUALITY_THRESHOLD_MIN,
  MAX_QUALITY_ENDURANCE_SESSIONS,
  MAX_QUALITY_SESSION_MIN,
  MIN_ENDURANCE_SESSION_MIN,
  MIN_QUALITY_SESSION_MIN,
  PRIORITY_LEAN_SESSION_SHIFT,
  PRIORITY_STRONG_LEAN,
  QUALITY_CAP_HIGH_VOLUME_MIN_PER_WEEK,
  QUALITY_CAP_HIGH_VOLUME_MIN_YEARS,
  QUALITY_SESSIONS_CAP_LOW_VOLUME,
  REP_SESSION_PHASES,
  MMD_ENDURANCE_QUALITY_PER_WEEK,
  MMD_ENDURANCE_SESSIONS_PER_WEEK,
  MMD_STRENGTH_MIN_INTENSITY,
  MMD_STRENGTH_SESSIONS_PER_WEEK,
  QUALITY_SESSION_MINUTE_SHARE,
  SECONDARY_LIFT_INTENSITY_OFFSET,
  SECONDARY_LIFT_SET_WEIGHT,
  SECONDARY_LIFT_SETS,
  SESSION_SPIKE_MAX_MULTIPLE,
  STRENGTH_PHASE_SPEC,
  STRENGTH_SESSIONS_BY_PHASE,
  STRENGTH_STRESS,
  STRENGTH_SUBBAND_WIDTH,
  TAPER_FINAL_WEEK_INTENSITY_CEILING,
  TID_BY_PHASE,
  WORKING_MAX_PROGRESSION_CAP,
  type EmphasisKey,
  type Phase,
} from "./constants";
import {
  prescribeEndurance,
  prescribeLift,
  prescribeModalityEndurance,
  type EnduranceKind,
  type EndurancePrescriptionOptions,
  type Prescription,
} from "./prescription";
import {
  emptyModalityFitness,
  modalityForEvent,
  modalitySessionLabel,
  resolveCardioPlan,
  type CardioModality,
  type ModalityFitness,
} from "./modality";
import type { DomainMode } from "./feasibility";
import type { MacrocycleWeek } from "./macrocycle";
import type { Constraints, Goal } from "./intake";
import type { AthleteProfile, Finding, FindingId } from "./types";
import { blockProgress, qualityProgressionFor } from "./progression";

export type SessionKind = EnduranceKind | "squat_heavy" | "squat_volume" | "deadlift_heavy" | "deadlift_volume" | "bench_heavy" | "bench_volume" | "strength_maintenance" | "weak_lift_exposure";

export interface PlannedSession {
  kind: SessionKind;
  /** What the athlete calls this session — "Push", "Legs", "Upper". */
  label?: string;
  domain: "endurance" | "strength";
  /** 0-1, used by the scheduler's ordering and drift penalties. */
  intensity: number;
  /** F10: a long run over 75 minutes counts as quality FOR SPACING PURPOSES, even though it is run at easy effort. */
  isQuality: boolean;
  minutes: number;
  isHeavyLower: boolean;
  isDeadlift: boolean;
  lift?: string;
  /** Which cardio modality an endurance session is performed in. */
  modality?: CardioModality;
  prescription: Prescription;
  /** Which emphasis dimension bought this slot. */
  emphasisKey: EmphasisKey;
  /** Non-negotiable #7 — the named diagnostic finding this session exists to answer. */
  findingId: FindingId;
  stress: number;
  /** Direct hard sets per competition lift in this session — the dose the feasibility model reads. */
  liftSets?: Record<string, number>;
}

/**
 * Which finding drives each emphasis dimension. Ordered by strength of claim —
 * the first finding present in the athlete's own diagnosis wins.
 */
const FINDINGS_BY_EMPHASIS: Record<EmphasisKey, FindingId[]> = {
  aerobic_base: [
    "low-volume",
    "endurance-limited",
    "grey-zone",
    "no-easy-runs-logged",
    "poor-decoupling",
    "easy-anchor-disagreement",
    "pace-vs-hr-discrepancy",
  ],
  threshold: ["no-quality", "endurance-limited", "ample-volume"],
  vo2max_speed: ["speed-limited", "no-quality", "low-speed-reserve", "ample-volume"],
  neuromuscular: ["low-speed-reserve", "speed-limited"],
  maximal_strength: ["under-expressed", "stalled-lift"],
  strength_endurance: ["under-built"],
  weak_lift: ["weak-lift"],
};

export function attributeFinding(emphasisKey: EmphasisKey, findings: Finding[]): FindingId | null {
  const present = new Set(findings.map((f) => f.id));
  for (const candidate of FINDINGS_BY_EMPHASIS[emphasisKey]) {
    if (present.has(candidate)) return candidate;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Proportional allocation, largest remainder first
// ---------------------------------------------------------------------------

export function largestRemainderAllocate(weights: number[], total: number): number[] {
  if (total <= 0) return weights.map(() => 0);
  const sum = weights.reduce((s, w) => s + Math.max(0, w), 0);
  if (sum <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (Math.max(0, w) / sum) * total);
  const base = raw.map(Math.floor);
  let remainder = total - base.reduce((s, v) => s + v, 0);
  const order = raw
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  const result = [...base];
  for (let k = 0; k < order.length && remainder > 0; k++, remainder--) result[order[k].i] += 1;
  return result;
}

// ---------------------------------------------------------------------------
// The week
// ---------------------------------------------------------------------------

export interface SessionSetInput {
  profile: AthleteProfile;
  week: MacrocycleWeek;
  mode: Record<"strength" | "endurance", DomainMode>;
  goal: Goal;
  constraints: Constraints;
  /** From the safety screen — beta blockers and similar drop HR prescription entirely. */
  suppressHeartRate?: boolean;
  /** F16: a reduction imposed by autoregulation on the previous week's feedback. 1 = no reduction. */
  autoregMultiplier?: number;
  /** Ceiling on prescribed relative intensity, from the health screen. 1 means unrestricted. */
  intensityCeiling?: number;
  modalityFitness?: Partial<Record<CardioModality, ModalityFitness>>;
  /** The 5k the block is expected to bring the athlete to. Quality paces progress toward this, never past it. */
  expected5kS?: number | null;
  /** Expected fractional strength gain across the block. Walks the working max up with the projection. */
  expectedStrengthGain?: number;
  /**
   * The long runs of the last four weeks, most recent last, for the spike
   * rule (never more than 10% over the longest of the last month) and the
   * deload rule (a deload long run is a share of the last full one). Empty
   * in week one.
   */
  recentLongRunsMin?: readonly number[];
  /** Years of consistent lifting — a novice's maintenance dose is a hypertrophy dose, not heavy triples. */
  strengthTrainingYears?: number;
  /** The longest run of the last month, for the spike rule in week one. */
  longestRecentRunMin?: number | null;
  /** Years of consistent running — gates the third weekly quality session. */
  enduranceTrainingYears?: number;
  /** High life stress or short sleep: quality held to one session a week. */
  lifeLoad?: boolean;
  /** The final week before the event — the lift-specific taper ceilings apply here only. */
  isFinalTaperWeek?: boolean;
}

export interface SessionSet {
  sessions: PlannedSession[];
  /** How the week's slots were split across emphasis dimensions, after caps and TID reconciliation. */
  allocation: Record<EmphasisKey, number>;
  notes: string[];
  /** The long run prescribed this week, for next week's spike rule. Null when there was none. */
  longRunMinutes: number | null;
  /** Endurance minutes actually prescribed — what the athlete does, as opposed to what was budgeted. */
  deliveredEnduranceMin: number;
  /** Quality endurance sessions this week (the long run excluded). */
  qualityCount: number;
  /** Direct hard sets per competition lift this week, secondary exposures at half weight. */
  strengthSetsByLift: Record<string, number>;
  /** Strength sessions at or above the heavy threshold on a lower-body lift. */
  heavyStrengthSessions: number;
}

function stressFor(kind: SessionKind, minutes: number, domain: "endurance" | "strength"): number {
  if (domain === "strength") return STRENGTH_STRESS[kind] ?? DEFAULT_STRENGTH_STRESS;
  return (BASE_STRESS_PER_MIN[kind] ?? DEFAULT_STRESS_PER_MIN) * minutes;
}

/** Exercises in a prescription. Rationale lives in `notes`, so this counts only lifts. */
function exerciseCount(text: string): number {
  return text.split("·").filter((x) => x.trim().length > 0).length;
}

function makeSession(
  kind: SessionKind,
  domain: "endurance" | "strength",
  emphasisKey: EmphasisKey,
  findingId: FindingId,
  prescription: Prescription,
  opts: {
    intensity: number;
    isQuality: boolean;
    minutes?: number;
    isHeavyLower?: boolean;
    isDeadlift?: boolean;
    lift?: string;
    label?: string;
    modality?: CardioModality;
    liftSets?: Record<string, number>;
  }
): PlannedSession {
  const minutes =
    opts.minutes ??
    (domain === "strength"
      ? STRENGTH_WARMUP_MIN + exerciseCount(prescription.text) * STRENGTH_MIN_PER_EXERCISE
      : 0);
  return {
    kind,
    domain,
    intensity: opts.intensity,
    isQuality: opts.isQuality,
    minutes,
    isHeavyLower: opts.isHeavyLower ?? false,
    isDeadlift: opts.isDeadlift ?? false,
    lift: opts.lift,
    label: opts.label,
    modality: opts.modality,
    prescription,
    emphasisKey,
    findingId,
    stress: stressFor(kind, minutes, domain),
    liftSets: opts.liftSets,
  };
}

const ENDURANCE_EMPHASIS_TO_KIND: Record<string, EnduranceKind> = {
  aerobic_base: "easy_run",
  threshold: "threshold_run",
  vo2max_speed: "interval_run",
  neuromuscular: "rep_run",
};

const QUALITY_EMPHASIS: EmphasisKey[] = ["threshold", "vo2max_speed", "neuromuscular"];

/** Phase ladder, easiest to heaviest. A strength emphasis moves the athlete one rung along it. */
const STRENGTH_LADDER: Phase[] = ["base", "build", "specific", "peak"];

/**
 * Load and rep range move together. `maximal_strength` shifts one rung
 * heavier than the phase would otherwise prescribe, `strength_endurance` one
 * rung lighter — bounded by the ladder.
 */
export function shiftPhaseSpec(phase: Phase, emphasisKey: EmphasisKey) {
  const idx = STRENGTH_LADDER.indexOf(phase);
  if (idx < 0) return STRENGTH_PHASE_SPEC[phase]; // taper is not shifted
  const delta = emphasisKey === "maximal_strength" ? 1 : emphasisKey === "strength_endurance" ? -1 : 0;
  const target = STRENGTH_LADDER[Math.max(0, Math.min(STRENGTH_LADDER.length - 1, idx + delta))];
  return STRENGTH_PHASE_SPEC[target];
}

/**
 * The prescribed sub-band inside a phase's load band, walking up across the
 * phase. Week one of base sits at the bottom of 65-75%; the last week of base
 * sits at the top. Two weeks of a phase are never the same session.
 */
export function subBandFor(
  band: readonly [number, number],
  phaseProgress: number
): readonly [number, number] {
  const width = (band[1] - band[0]) * STRENGTH_SUBBAND_WIDTH;
  const p = Math.min(1, Math.max(0, phaseProgress));
  const lo = band[0] + (band[1] - band[0] - width) * p;
  return [lo, lo + width];
}

/** The working maximum the loads are written against, as a multiple of the logged 1RM. */
export function workingMaxMultiplierFor(expectedStrengthGain: number, progress: number): number {
  const gain = Math.min(WORKING_MAX_PROGRESSION_CAP, Math.max(0, expectedStrengthGain));
  return 1 + gain * Math.min(1, Math.max(0, progress));
}

function isLowerBodyDay(day: SplitDay): boolean {
  const patterns = day.patterns;
  if (patterns.includes("push")) return false;
  if (!patterns.includes("legs")) return false;
  const label = day.label.trim().toLowerCase();
  if (/\bfull\b/.test(label)) return false;
  return /lower|leg|squat|quad|hamstring|glute|posterior/.test(label) || !patterns.includes("pull");
}

function accessoriesForDay(
  day: SplitDay,
  primaryLift: string,
  week: number,
  disliked: readonly string[]
): string[] {
  const patterns = day.patterns.length > 0 ? day.patterns : ["push"];
  const lowerBody = isLowerBodyDay(day);
  const dislikedLower = disliked.map((d) => d.trim().toLowerCase()).filter((d) => d.length > 0);
  const isDisliked = (line: string) => {
    const l = line.toLowerCase();
    return dislikedLower.some((d) => l.includes(d));
  };
  const poolFor = (pattern: string): readonly string[] =>
    (lowerBody && pattern === "pull" ? POSTERIOR_CHAIN_ACCESSORY_POOL : STRENGTH_ACCESSORY_POOL[pattern] ?? []).filter(
      (line) => !isDisliked(line)
    );
  const wanted = Math.max(MIN_EXERCISES_PER_STRENGTH_SESSION, TARGET_EXERCISES_PER_STRENGTH_SESSION) - 1;
  const out: string[] = [];
  const takenPerPattern: Record<string, number> = {};
  for (let depth = 0; out.length < wanted; depth += 1) {
    let addedThisPass = false;
    for (const pattern of patterns) {
      const pool = poolFor(pattern);
      if (pool.length === 0) continue;
      if (pattern === "core" && (takenPerPattern.core ?? 0) >= CORE_ACCESSORY_CAP) continue;
      const line = pool[(depth + week) % pool.length];
      if (out.length >= wanted) break;
      if (line.toLowerCase().includes(primaryLift.toLowerCase())) continue;
      if (out.includes(line)) continue;
      out.push(line);
      takenPerPattern[pattern] = (takenPerPattern[pattern] ?? 0) + 1;
      addedThisPass = true;
    }
    if (!addedThisPass && depth > 8) break;
  }
  return out;
}

function chosenExercisesFor(
  dayLabel: string,
  exercisesByDay: Record<string, string[]> | undefined
): string[] | null {
  if (!exercisesByDay) return null;
  const key = dayLabel.trim().toLowerCase();
  for (const [label, picks] of Object.entries(exercisesByDay)) {
    if (label.trim().toLowerCase() === key && picks.length > 0) return picks;
  }
  return null;
}

const ACCESSORY_DEFAULT_SCHEME = "3x8-12";

function asAccessoryLine(name: string): string {
  const trimmed = name.trim();
  return /\d\s*x\s*\d/i.test(trimmed) ? trimmed : `${trimmed} ${ACCESSORY_DEFAULT_SCHEME}`;
}

function primaryExerciseFor(lift: string, week: number, peakingATotal: boolean): string | undefined {
  if (peakingATotal) return undefined;
  const variants = PRIMARY_LIFT_VARIANTS[lift];
  if (!variants || variants.length === 0) return undefined;
  return variants[week % variants.length];
}

/**
 * Hold a prescribed intensity range under a ceiling, keeping its width. Both
 * ends move, so a band capped at 75% ends at 75% and starts a band-width
 * below it — it does not collapse to "75-75%", which is a point, not a
 * prescription.
 */
function capIntensity(range: readonly [number, number], ceiling: number): readonly [number, number] {
  if (ceiling >= 1) return range;
  const width = Math.max(0.03, range[1] - range[0]);
  const hi = Math.min(range[1], ceiling);
  const lo = Math.max(0.5, Math.min(range[0], hi - width));
  return [lo, hi];
}

/**
 * Which KIND of quality session a single slot should be. The phase's own
 * intensity distribution says which kind belongs — base and build are
 * z2-dominant (threshold), specific and peak are z3-dominant (intervals) —
 * and within a phase the type rotates by week.
 */
function qualityKindForSlot(
  phase: Phase,
  week: number,
  profile: AthleteProfile,
  repSessionsAllowed: boolean,
  longEvent = false
): EmphasisKey {
  const [, z2, z3] = TID_BY_PHASE[phase];
  // A half or marathon is a threshold event: its specific work is sustained
  // pace, with VO2max sessions as the minority. A 5k is the reverse.
  const pool: EmphasisKey[] = longEvent
    ? ["threshold", "threshold", "vo2max_speed"]
    : z3 > z2
      ? ["vo2max_speed", "threshold"]
      : ["threshold", "vo2max_speed"];
  if (repSessionsAllowed && !longEvent && profile.emphasis.neuromuscular > profile.emphasis.threshold) {
    pool.push("neuromuscular");
  }
  return pool[week % pool.length];
}

function buildEnduranceSession(args: {
  profile: AthleteProfile;
  modality: CardioModality;
  fitness: ModalityFitness | undefined;
  kind: EnduranceKind;
  emphasisKey: EmphasisKey;
  findingId: FindingId;
  minutes: number;
  intensity: number;
  isQuality: boolean;
  suppressHeartRate: boolean;
  extra?: string;
  progression?: Omit<EndurancePrescriptionOptions, "minutes">;
}): PlannedSession {
  const { profile, modality, fitness, kind, emphasisKey, findingId, minutes } = args;

  if (modality === "run") {
    const prescription = prescribeEndurance(profile, kind, findingId, {
      minutes,
      suppressHeartRate: args.suppressHeartRate,
      extra: args.extra,
      ...(args.progression ?? {}),
    });
    return makeSession(kind, "endurance", emphasisKey, findingId, prescription, {
      intensity: args.intensity,
      isQuality: args.isQuality,
      // A quality session may have grown to fit its own reps.
      minutes: prescription.minutes > 0 ? prescription.minutes : minutes,
      modality,
    });
  }

  const resolved = fitness ?? emptyModalityFitness(modality);
  const prescription = prescribeModalityEndurance(profile, resolved, kind, findingId, {
    minutes,
    suppressHeartRate: args.suppressHeartRate,
    extra: args.extra,
  });
  return makeSession(kind, "endurance", emphasisKey, findingId, prescription, {
    intensity: args.intensity,
    isQuality: args.isQuality,
    minutes,
    modality,
    label: modalitySessionLabel(modality, kind),
  });
}

/** Sessions per domain the phase wants, after the priority slider has moved whole sessions between them. */
export function domainSessionTargets(
  phase: Phase,
  mode: Record<"strength" | "endurance", DomainMode>,
  priority: number
): { endurance: number; strength: number } {
  let endurance = mode.endurance === "develop" ? ENDURANCE_SESSIONS_BY_PHASE[phase] : MMD_ENDURANCE_SESSIONS_PER_WEEK;
  let strength = mode.strength === "develop" ? STRENGTH_SESSIONS_BY_PHASE[phase] : Math.max(MMD_STRENGTH_SESSIONS_PER_WEEK, 2);
  if (mode.endurance === "develop" && mode.strength === "develop") {
    if (priority >= PRIORITY_STRONG_LEAN) {
      endurance = Math.max(MMD_ENDURANCE_SESSIONS_PER_WEEK + 1, endurance - PRIORITY_LEAN_SESSION_SHIFT);
    } else if (priority <= 1 - PRIORITY_STRONG_LEAN) {
      strength = Math.max(MMD_STRENGTH_SESSIONS_PER_WEEK + 1, strength - PRIORITY_LEAN_SESSION_SHIFT);
    } else if (priority > 0.5) {
      endurance = Math.max(3, endurance - 1);
    } else if (priority < 0.5) {
      strength = Math.max(2, strength - 1);
    } else {
      endurance = Math.max(3, endurance - 1);
    }
  }
  return { endurance, strength };
}

/**
 * F17 — the easy session a flagged low-capacity day swaps a hard one for.
 *
 * Same length, same sport, same finding: the athlete is not losing the slot,
 * they are losing the intensity. Exported because the swap happens in the
 * engine, after scheduling — a low-capacity day is a response to a day rather
 * than to the block, and the week has to already exist for there to be a day
 * to respond to.
 */
export function easySwapFor(
  original: PlannedSession,
  profile: AthleteProfile,
  opts: { suppressHeartRate?: boolean; fitness?: ModalityFitness } = {}
): PlannedSession {
  const modality = original.modality ?? "run";
  return buildEnduranceSession({
    profile,
    modality,
    fitness: opts.fitness,
    kind: "easy_run",
    emphasisKey: "aerobic_base",
    findingId: original.findingId,
    minutes: original.minutes,
    intensity: 0.35,
    isQuality: false,
    suppressHeartRate: opts.suppressHeartRate ?? false,
  });
}

export function buildSessionSet(input: SessionSetInput): SessionSet {
  const {
    profile, week, mode, goal, constraints,
    suppressHeartRate = false, autoregMultiplier = 1, intensityCeiling = 1,
    modalityFitness = {},
    expected5kS = null,
    expectedStrengthGain = 0,
    recentLongRunsMin = [],
    longestRecentRunMin = null,
    enduranceTrainingYears = 0,
    strengthTrainingYears = 1,
    lifeLoad = false,
    isFinalTaperWeek = week.phase === "taper",
  } = input;
  const noviceEndurance = enduranceTrainingYears < NOVICE_ENDURANCE_YEARS;
  const noviceStrength = strengthTrainingYears < 1;
  const longEvent = (goal.enduranceEventKm ?? 0) >= 21;
  const { phase, deload } = week;
  const notes: string[] = [];
  const sessions: PlannedSession[] = [];
  const disliked = constraints.dislikedExercises ?? [];

  if (week.travel) {
    notes.push("A travel week: held as a maintenance week — volume down, intensity kept, nothing new added.");
  }

  // ---- which sport is each endurance session in? --------------------------
  const cardio = resolveCardioPlan(
    constraints.cardioModalities ?? [],
    constraints.crossTrainOk ?? false,
    modalityForEvent(goal.enduranceEventKey)
  );
  for (const note of cardio.notes) notes.push(note);
  let easyRotationCursor = week.week;
  const nextEasyModality = (): CardioModality =>
    cardio.rotation[easyRotationCursor++ % cardio.rotation.length];
  let totalMinutes = Math.max(0, week.enduranceMin * autoregMultiplier);
  if (autoregMultiplier < 1) {
    notes.push(
      `Volume reduced ${Math.round((1 - autoregMultiplier) * 100)}% this week off your logged feedback from last week.`
    );
  }

  // ---- how many slots does each domain get? -------------------------------
  const wanted = domainSessionTargets(phase, mode, goal.priority);
  const affordable = (minutes: number) =>
    minutes > 0 ? Math.max(1, Math.floor(minutes / MIN_ENDURANCE_SESSION_MIN)) : 0;
  let enduranceSlots = Math.min(wanted.endurance, affordable(totalMinutes));
  let strengthSlots = wanted.strength;

  // Fit inside the athlete's own stated session ceiling, trimming whichever
  // domain is furthest above its minimum dose first.
  while (enduranceSlots + strengthSlots > constraints.maxSessionsPerWeek) {
    const enduranceHeadroom = enduranceSlots - MMD_ENDURANCE_SESSIONS_PER_WEEK;
    const strengthHeadroom = strengthSlots - MMD_STRENGTH_SESSIONS_PER_WEEK;
    if (enduranceHeadroom <= 0 && strengthHeadroom <= 0) {
      if (enduranceSlots >= strengthSlots) enduranceSlots--;
      else strengthSlots--;
    } else if (enduranceHeadroom >= strengthHeadroom) {
      enduranceSlots--;
    } else {
      strengthSlots--;
    }
  }
  enduranceSlots = Math.max(0, enduranceSlots);
  strengthSlots = Math.max(0, strengthSlots);

  // ---- the athlete's hours cap binds the WHOLE week -----------------------
  // A strength session is a warm-up plus about six exercises. The cap has
  // to fit BOTH domains: three gym sessions inside a four-hour week left one
  // run and no quality session, which is not a hybrid week. So the slots
  // give way on whichever side is furthest above its minimum dose — the
  // same rule the session cap uses — and the endurance minutes then fit
  // beside the gym time that is left. The sessions built below report their
  // real length, and a final pass trims the easy runs and then the long run
  // if the estimate was short.
  const strengthSessionEstimateMin = STRENGTH_WARMUP_MIN + TARGET_EXERCISES_PER_STRENGTH_SESSION * STRENGTH_MIN_PER_EXERCISE;
  const hoursCapMin = Math.max(0, constraints.maxHoursPerWeek * 60);
  if (hoursCapMin > 0) {
    // A quality session needs its minimum; an easy run and the long run need
    // theirs. The floor a week's endurance slots need, in minutes.
    const enduranceFloor = (slots: number) =>
      slots <= 0 ? 0 : MIN_QUALITY_SESSION_MIN + Math.max(0, slots - 1) * MIN_ENDURANCE_SESSION_MIN;
    let trimmedSlots = false;
    while (
      strengthSlots * strengthSessionEstimateMin + enduranceFloor(enduranceSlots) > hoursCapMin &&
      (strengthSlots > MMD_STRENGTH_SESSIONS_PER_WEEK || enduranceSlots > MMD_ENDURANCE_SESSIONS_PER_WEEK)
    ) {
      const enduranceHeadroom = enduranceSlots - MMD_ENDURANCE_SESSIONS_PER_WEEK;
      const strengthHeadroom = strengthSlots - MMD_STRENGTH_SESSIONS_PER_WEEK;
      if (strengthHeadroom >= enduranceHeadroom && strengthHeadroom > 0) strengthSlots--;
      else enduranceSlots--;
      trimmedSlots = true;
    }
    const estimatedStrengthMin = strengthSlots * strengthSessionEstimateMin;
    const capped = Math.max(0, hoursCapMin - estimatedStrengthMin);
    if (capped < totalMinutes || trimmedSlots) {
      notes.push(
        `Held to your ${constraints.maxHoursPerWeek} hours a week: ${strengthSlots} gym session${strengthSlots === 1 ? "" : "s"} ` +
          `take${strengthSlots === 1 ? "s" : ""} about ${Math.round((estimatedStrengthMin / 60) * 10) / 10} hours, so running ` +
          `is held to ${Math.round(Math.min(capped, totalMinutes))} minutes this week` +
          (capped < totalMinutes ? ` rather than the ${Math.round(totalMinutes)} the ramp would have given it` : "") +
          `. More hours is the lever if the goals are to move faster.`
      );
      totalMinutes = Math.min(totalMinutes, capped);
      enduranceSlots = Math.min(enduranceSlots, affordable(totalMinutes));
    }
  }
  if (enduranceSlots < wanted.endurance && totalMinutes > 0) {
    notes.push(
      `Fewer, longer runs this week — ${Math.round(totalMinutes)} minutes split any further would be sessions too ` +
        `short to be worth doing.`
    );
  }

  // ---- step 1: reserve the mandatory minimums -----------------------------
  const wantsLongRun = phase !== "taper" && enduranceSlots >= 1;
  const remainingEnduranceSlots = Math.max(0, enduranceSlots - (wantsLongRun ? 1 : 0));

  // ---- step 2: allocate the rest proportionally to emphasis ---------------
  const repSessionsAllowed = REP_SESSION_PHASES.includes(phase);
  const enduranceDims: EmphasisKey[] = repSessionsAllowed
    ? ["aerobic_base", "threshold", "vo2max_speed", "neuromuscular"]
    : ["aerobic_base", "threshold", "vo2max_speed"];
  const enduranceWeights = enduranceDims.map((k) =>
    k === "aerobic_base" && !repSessionsAllowed
      ? profile.emphasis.aerobic_base + profile.emphasis.neuromuscular
      : profile.emphasis[k]
  );
  const enduranceCounts = largestRemainderAllocate(enduranceWeights, remainingEnduranceSlots);

  const allocation = Object.fromEntries(EMPHASIS_KEYS.map((k) => [k, 0])) as Record<EmphasisKey, number>;
  enduranceDims.forEach((k, i) => {
    allocation[k] = enduranceCounts[i];
  });
  if (wantsLongRun) allocation.aerobic_base += 1;

  const strengthDims: EmphasisKey[] = profile.weakLift
    ? ["maximal_strength", "strength_endurance", "weak_lift"]
    : ["maximal_strength", "strength_endurance"];
  const strengthWeights = strengthDims.map((k) =>
    k === "maximal_strength" && !profile.weakLift
      ? profile.emphasis.maximal_strength + profile.emphasis.weak_lift
      : profile.emphasis[k]
  );
  const strengthCounts = largestRemainderAllocate(strengthWeights, strengthSlots);
  strengthDims.forEach((k, i) => {
    allocation[k] = strengthCounts[i];
  });

  // ---- quality session size and caps --------------------------------------
  // A quality session is a session size: a share of the week bounded to a
  // real session, never a slice that shrinks below its own warm-up.
  const qualityMinutes = Math.min(
    constraints.maxSessionMin,
    Math.max(MIN_QUALITY_SESSION_MIN, Math.min(MAX_QUALITY_SESSION_MIN, Math.round(totalMinutes * QUALITY_SESSION_MINUTE_SHARE)))
  );
  const qualityAllocated = () => QUALITY_EMPHASIS.reduce((s, k) => s + allocation[k], 0);
  const demote = (reason: string) => {
    const donor = QUALITY_EMPHASIS.filter((k) => allocation[k] > 0).sort(
      (a, b) => profile.emphasis[a] - profile.emphasis[b]
    )[0];
    if (!donor) return false;
    allocation[donor] -= 1;
    allocation.aerobic_base += 1;
    if (reason && !notes.includes(reason)) notes.push(reason);
    return true;
  };

  // How many hard sessions this athlete can absorb in a week.
  const highVolumeAndExperienced =
    totalMinutes >= QUALITY_CAP_HIGH_VOLUME_MIN_PER_WEEK && enduranceTrainingYears >= QUALITY_CAP_HIGH_VOLUME_MIN_YEARS;
  let qualityCap = Math.min(
    MAX_QUALITY_ENDURANCE_SESSIONS,
    highVolumeAndExperienced ? MAX_QUALITY_ENDURANCE_SESSIONS : QUALITY_SESSIONS_CAP_LOW_VOLUME
  );
  if (lifeLoad) qualityCap = Math.min(qualityCap, LIFE_LOAD_MAX_QUALITY_SESSIONS);
  if (deload) qualityCap = Math.min(qualityCap, 1);
  // A novice runner (Videbæk 2015: 2.3× the injury rate of recreational
  // runners) gets one hard session a week at most, and none in the base
  // phase — strides on the easy runs are the neuromuscular work until the
  // base is there to absorb a track session.
  if (noviceEndurance) qualityCap = Math.min(qualityCap, phase === "base" ? 0 : 1);

  // ---- step 2b: size the long run -------------------------------------------
  const qualityEnduranceCount = qualityAllocated();
  const easyRunCount = Math.max(1, allocation.aerobic_base - (wantsLongRun ? 1 : 0));
  const qualityFraction = Math.min(0.8, (qualityEnduranceCount * qualityMinutes) / Math.max(1, totalMinutes));
  const ratioShare =
    (LONG_RUN_MIN_MULTIPLE_OF_EASY * (1 - qualityFraction)) /
    (easyRunCount + LONG_RUN_MIN_MULTIPLE_OF_EASY);
  const longShare = Math.max(LONG_RUN_MINUTE_SHARE, ratioShare);
  const shareLongMinutes = Math.max(MIN_ENDURANCE_SESSION_MIN, Math.round(totalMinutes * longShare));

  let longMinutes = shareLongMinutes;
  const raceKm = goal.enduranceEventKm;
  const easyPaceS = profile.easyBand ? (profile.easyBand.lo + profile.easyBand.hi) / 2 : null;
  if (raceKm != null && goal.enduranceEventKey && easyPaceS != null && phase !== "taper") {
    const peakFraction = LONG_RUN_PEAK_FRACTION_OF_RACE[goal.enduranceEventKey];
    if (peakFraction != null) {
      const peakKm = raceKm * peakFraction;
      const progress = Math.min(1, blockProgress(week));
      const targetKm = peakKm * (0.6 + 0.4 * progress);
      const targetMinutes = Math.min(LONG_RUN_MAX_MINUTES, Math.round((targetKm * easyPaceS) / 60));
      longMinutes = Math.min(targetMinutes, constraints.maxSessionMin);
      if (targetMinutes > constraints.maxSessionMin) {
        notes.push(
          `Your ${goal.enduranceEventKey} needs a long run building toward about ` +
            `${Math.round(targetMinutes / 5) * 5} minutes, and you have said your longest available session is ` +
            `${constraints.maxSessionMin}. The long run is capped at what you said you can fit — if you can free ` +
            `up a longer window once a week, this is the session to spend it on.`
        );
      }
    }
  }
  const capEnduranceMinutes = (m: number) => Math.min(m, constraints.maxSessionMin);
  longMinutes = capEnduranceMinutes(longMinutes);

  // The single-session spike rule, and the deload rule. The long run is the
  // session these bind: it may not exceed 1.1× the longest run of the last
  // month in week one, nor 1.1× last week's long run after that — and on a
  // deload week it comes down from last week's, because it is the most
  // fatiguing session of the week and the one the deload used to leave alone.
  if (wantsLongRun) {
    const recent = recentLongRunsMin.filter((m) => m > 0);
    const longestRecent = recent.length > 0 ? Math.max(...recent) : null;
    const anchor = longestRecent ?? longestRecentRunMin ?? null;
    if (anchor != null && anchor > 0) {
      const spikeCap = Math.max(MIN_ENDURANCE_SESSION_MIN, Math.round(anchor * SESSION_SPIKE_MAX_MULTIPLE));
      if (longMinutes > spikeCap) {
        notes.push(
          `Long run held to ${spikeCap} minutes — no more than 10% over your longest run of the last month. ` +
            `A single run more than 10% beyond that is the best-supported injury signal there is, so the long ` +
            `run builds in steps rather than jumps.`
        );
        longMinutes = spikeCap;
      }
    }
    if (deload && longestRecent != null) {
      longMinutes = Math.min(
        longMinutes,
        Math.max(MIN_ENDURANCE_SESSION_MIN, Math.round(longestRecent * DELOAD_LONG_RUN_MULTIPLIER))
      );
    }
  }

  // ---- step 3: hard caps ---------------------------------------------------
  const longRunCountsAsQuality = wantsLongRun && longMinutes >= LONG_RUN_QUALITY_THRESHOLD_MIN;
  while (qualityAllocated() + (longRunCountsAsQuality ? 1 : 0) > qualityCap && qualityAllocated() > 0) {
    if (!demote(`Quality capped at ${qualityCap} session${qualityCap === 1 ? "" : "s"} this week — the slot moves to easy volume.`)) break;
  }

  // ---- strength load band for this week ------------------------------------
  const strengthEmphasisFindingPresent = profile.findings.some(
    (f) => f.id === "under-expressed" || f.id === "under-built"
  );
  const strengthEmphasisKey: EmphasisKey = strengthEmphasisFindingPresent
    ? profile.emphasis.maximal_strength >= profile.emphasis.strength_endurance
      ? "maximal_strength"
      : "strength_endurance"
    : "maximal_strength";
  const peakingATotal =
    goal.targetTotalKg != null || goal.targetSquatKg != null || goal.targetBenchKg != null || goal.targetDeadliftKg != null;
  // The rep-profile shift only applies when the diagnostic actually found a
  // rep-profile gap. A tie at the floor used to shift every peaking athlete a
  // rung heavier for the whole block, so the base-phase spec was never used.
  const baseSpec = peakingATotal
    ? strengthEmphasisFindingPresent
      ? shiftPhaseSpec(phase, strengthEmphasisKey)
      : STRENGTH_PHASE_SPEC[phase]
    : GENERAL_STRENGTH_SPEC[Math.min(GENERAL_STRENGTH_SPEC.length - 1, Math.floor(blockProgress(week) * GENERAL_STRENGTH_SPEC.length))];
  const progressedBand = phase === "taper" ? baseSpec.pct : subBandFor(baseSpec.pct, week.phaseProgress);
  const workingMax = workingMaxMultiplierFor(expectedStrengthGain, blockProgress(week));

  // ---- step 4: reconcile against the phase's TID target --------------------
  const phaseGovernsTid = phase === "specific" || phase === "peak" || phase === "taper";

  // A quality FLOOR in every phase for anyone with a race goal: even the base
  // phase's own intensity distribution is 20% quality, not none. Only the
  // long run is protected from it.
  if (
    !phaseGovernsTid &&
    mode.endurance === "develop" &&
    !deload &&
    qualityCap >= 1 &&
    qualityAllocated() < MMD_ENDURANCE_QUALITY_PER_WEEK &&
    allocation.aerobic_base > (wantsLongRun ? 1 : 0)
  ) {
    const receiver = qualityKindForSlot(phase, week.week, profile, repSessionsAllowed, longEvent);
    allocation[receiver] += 1;
    allocation.aerobic_base -= 1;
    notes.push(
      "One quality session is held in every week outside a deload — a block of nothing but easy running will not " +
        "move a 5k, whatever your emphasis says."
    );
  }

  if (phaseGovernsTid && qualityCap >= 1) {
    const [, z2, z3] = TID_BY_PHASE[phase];
    const floor = deload || phase === "taper" ? 1 : MMD_ENDURANCE_QUALITY_PER_WEEK;
    const targetQuality = Math.min(
      qualityCap - (longRunCountsAsQuality ? 1 : 0),
      Math.max(floor, Math.round(enduranceSlots * (z2 + z3)))
    );
    let current = qualityAllocated();
    while (current > targetQuality && demote("")) current--;
    while (current < targetQuality && allocation.aerobic_base > (wantsLongRun ? 1 : 0)) {
      const receiver = qualityKindForSlot(phase, week.week + current, profile, repSessionsAllowed, longEvent);
      allocation[receiver] += 1;
      allocation.aerobic_base -= 1;
      current++;
    }
  }

  // ---- build the endurance sessions ---------------------------------------
  const qualityCount = QUALITY_EMPHASIS.reduce((sum, k) => sum + allocation[k], 0);
  const qualitySlots: EmphasisKey[] = Array.from({ length: qualityCount }, (_, i) =>
    qualityKindForSlot(phase, week.week + i, profile, repSessionsAllowed, longEvent)
  );

  for (const emphasisKey of qualitySlots) {
    const kind = ENDURANCE_EMPHASIS_TO_KIND[emphasisKey];
    const findingId = attributeFinding(emphasisKey, profile.findings) ?? "hybrid-baseline";
    const progression = qualityProgressionFor(kind, week, profile, goal, expected5kS);
    sessions.push(
      buildEnduranceSession({
        profile,
        modality: cardio.qualityModality,
        fitness: modalityFitness[cardio.qualityModality],
        kind,
        emphasisKey,
        findingId,
        minutes: qualityMinutes,
        intensity: kind === "interval_run" ? 0.95 : kind === "rep_run" ? 0.9 : 0.8,
        isQuality: true,
        suppressHeartRate,
        progression: { ...progression, maxMinutes: Math.min(constraints.maxSessionMin, MAX_QUALITY_SESSION_MIN) },
      })
    );
  }

  let longRunMinutes: number | null = null;
  if (wantsLongRun) {
    const findingId = attributeFinding("aerobic_base", profile.findings) ?? "hybrid-baseline";
    longRunMinutes = longMinutes;
    sessions.push(
      buildEnduranceSession({
        profile,
        modality: cardio.primary,
        fitness: modalityFitness[cardio.primary],
        kind: "long_run",
        emphasisKey: "aerobic_base",
        findingId,
        minutes: longMinutes,
        intensity: 0.45,
        isQuality: longRunCountsAsQuality,
        suppressHeartRate,
        extra:
          cardio.primary === "run"
            ? "Finish with 6x20s strides, walking back to full recovery between."
            : undefined,
      })
    );
  }

  const easySlots = Math.max(0, allocation.aerobic_base - (wantsLongRun ? 1 : 0));
  const usedMinutes = sessions.reduce((s, x) => s + x.minutes, 0);
  // The long run stays the longest session of the week. With several easy
  // runs each sits well under it; with a single easy run the ceiling is
  // gentler, or a 5k athlete on three running days could never be given the
  // volume the ramp budgeted for them.
  const easyCeiling = wantsLongRun
    ? Math.max(
        MIN_ENDURANCE_SESSION_MIN,
        Math.floor(easySlots >= 2 ? longMinutes / LONG_RUN_MIN_MULTIPLE_OF_EASY : longMinutes * 0.9)
      )
    : constraints.maxSessionMin;
  const easyMinutes =
    easySlots > 0
      ? Math.min(
          capEnduranceMinutes(
            Math.max(MIN_ENDURANCE_SESSION_MIN, Math.round((totalMinutes - usedMinutes) / easySlots))
          ),
          easyCeiling
        )
      : 0;
  const buildEasy = (i: number, minutes: number, easyModality: CardioModality): PlannedSession => {
    const findingId = attributeFinding("aerobic_base", profile.findings) ?? "hybrid-baseline";
    const kind: EnduranceKind = phase === "taper" ? "recovery_run" : "easy_run";
    const stridesHere = !repSessionsAllowed && phase !== "taper" && i < 2 && easyModality === "run";
    return buildEnduranceSession({
      profile,
      modality: easyModality,
      fitness: modalityFitness[easyModality],
      kind,
      emphasisKey: "aerobic_base",
      findingId,
      minutes,
      intensity: kind === "recovery_run" ? 0.3 : 0.35,
      isQuality: false,
      suppressHeartRate,
      extra: stridesHere ? "Finish with 6x20s strides, walking back to full recovery between." : undefined,
    });
  };
  const easySessions: { index: number; modality: CardioModality; session: PlannedSession }[] = [];
  for (let i = 0; i < easySlots; i++) {
    const easyModality = nextEasyModality();
    const session = buildEasy(i, easyMinutes, easyModality);
    easySessions.push({ index: i, modality: easyModality, session });
    sessions.push(session);
  }

  // ---- build the strength sessions ----------------------------------------
  const weakLiftSlots = allocation.weak_lift;
  const rotationSlots = Math.max(0, strengthSlots - weakLiftSlots);
  const split = TRAINING_SPLITS[constraints.trainingSplit ?? DEFAULT_TRAINING_SPLIT];
  const customDays = constraints.customSplitDays ?? [];
  const splitDays: readonly SplitDay[] = customDays.length > 0 ? customDays : split.days;
  if (customDays.length > 0) {
    notes.push(
      `Your gym week runs on your own day structure — ${customDays.map((d) => d.label).join(", ")} — rather than ` +
        `one of the stock splits.`
    );
  }
  if (peakingATotal && Object.keys(constraints.exercisesByDay ?? {}).length > 0) {
    notes.push(
      "Your chosen exercises are in, but the competition lift still leads each day — you have set a numeric lift " +
        "target, and specificity is the whole reason a peaking block exists. Clear the target and your own pick " +
        "leads instead."
    );
  }
  const cycleOffset =
    splitDays.length > 0 ? ((week.week - 1) * Math.max(1, rotationSlots)) % splitDays.length : 0;
  const dayIndexFor = (i: number) => (cycleOffset + i) % Math.max(1, splitDays.length);
  const rotation = Array.from(
    { length: Math.max(2, rotationSlots) },
    (_, i) => splitDays[dayIndexFor(i)]?.primaryLift ?? "squat"
  );

  const hasBarbell = constraints.equipment.includes("barbell");
  const strengthSetsByLift: Record<string, number> = {};
  const addSets = (lift: string, sets: number) => {
    strengthSetsByLift[lift] = (strengthSetsByLift[lift] ?? 0) + sets;
  };
  let heavyStrengthSessions = 0;

  // Lift-specific ceilings inside the final seven days before the event.
  const taperCeilingFor = (lift: string): number =>
    isFinalTaperWeek && phase === "taper" ? TAPER_FINAL_WEEK_INTENSITY_CEILING[lift] ?? 1 : 1;

  let heavyLowerUsed = false;
  for (let i = 0; i < Math.min(rotationSlots, rotation.length); i++) {
    const lift = rotation[i];
    const splitDay = splitDays[dayIndexFor(i)];

    if (mode.strength === "maintain") {
      const findingId = attributeFinding("maximal_strength", profile.findings) ?? "hybrid-baseline";
      // Spiering's maintenance dose holds intensity — for someone with a
      // strength base to maintain. A novice has none yet, and 3x3-5 at 80-85%
      // with no logged 1RM is not a session they can perform; they get the
      // general first-block scheme at a load they can hold.
      const noviceSpec = GENERAL_STRENGTH_SPEC[0];
      const intensity = capIntensity(
        noviceStrength ? noviceSpec.pct : [MMD_STRENGTH_MIN_INTENSITY, MMD_STRENGTH_MIN_INTENSITY + 0.05],
        Math.min(intensityCeiling, taperCeilingFor(lift))
      );
      const prescription = prescribeLift(profile, findingId, {
        lift,
        substitution: hasBarbell ? undefined : NO_GYM_SUBSTITUTIONS[lift],
        sets: MAINTENANCE_SETS,
        reps: noviceStrength ? noviceSpec.reps : MAINTENANCE_REPS,
        intensity,
        rir: noviceStrength ? noviceSpec.rir : [2, 3],
        accessories:
          chosenExercisesFor(splitDay.label, constraints.exercisesByDay)?.map(asAccessoryLine) ??
          accessoriesForDay(splitDay, lift, week.week, disliked),
      });
      addSets(lift, MAINTENANCE_SETS);
      if (lift !== "bench" && intensity[1] >= MMD_STRENGTH_MIN_INTENSITY) heavyStrengthSessions++;
      sessions.push(
        makeSession("strength_maintenance", "strength", "maximal_strength", findingId, prescription, {
          intensity: MMD_STRENGTH_MIN_INTENSITY,
          isQuality: false,
          lift,
          label: splitDay.label,
          liftSets: { [lift]: MAINTENANCE_SETS },
        })
      );
      continue;
    }

    const findingId = attributeFinding(strengthEmphasisKey, profile.findings) ?? "hybrid-baseline";
    const rawSets = baseSpec.sets;
    const sets = deload ? Math.max(2, Math.round(rawSets * DELOAD_STRENGTH_SET_MULTIPLIER)) : rawSets;
    const reps = baseSpec.reps;
    const intensity = capIntensity(progressedBand, Math.min(intensityCeiling, taperCeilingFor(lift)));
    const rir: readonly [number, number] = deload
      ? [baseSpec.rir[0] + DELOAD_STRENGTH_RIR_BONUS, baseSpec.rir[1] + DELOAD_STRENGTH_RIR_BONUS]
      : baseSpec.rir;

    const picks = chosenExercisesFor(splitDay.label, constraints.exercisesByDay);
    const chosenLead = picks && !peakingATotal && hasBarbell ? picks[0] : undefined;
    const accessories = picks
      ? picks.slice(chosenLead ? 1 : 0).map(asAccessoryLine)
      : accessoriesForDay(splitDay, lift, week.week, disliked);

    // A peaking athlete's lower day carries the other lower lift as a
    // secondary, so each is met twice a week on three gym days.
    const secondaryLift =
      peakingATotal && hasBarbell && (lift === "squat" || lift === "deadlift") && splitDay.patterns.includes("legs")
        ? lift === "squat"
          ? "deadlift"
          : "squat"
        : null;
    const secondary = secondaryLift
      ? {
          lift: secondaryLift,
          sets: deload ? 2 : SECONDARY_LIFT_SETS,
          reps,
          intensity: capIntensity(
            [Math.max(0.5, intensity[0] - SECONDARY_LIFT_INTENSITY_OFFSET), Math.max(0.5, intensity[1] - SECONDARY_LIFT_INTENSITY_OFFSET)],
            Math.min(intensityCeiling, taperCeilingFor(secondaryLift))
          ),
          rir: [rir[0] + 1, rir[1] + 1] as readonly [number, number],
        }
      : undefined;

    const prescription = prescribeLift(profile, findingId, {
      lift,
      substitution: hasBarbell ? undefined : NO_GYM_SUBSTITUTIONS[lift],
      variant: hasBarbell ? (chosenLead ?? primaryExerciseFor(lift, week.week, peakingATotal)) : undefined,
      sets,
      reps: hasBarbell ? reps : NO_GYM_REP_RANGE,
      intensity,
      rir,
      accessories: secondary ? accessories.slice(0, Math.max(3, accessories.length - 1)) : accessories,
      workingMaxMultiplier: workingMax,
      secondary,
    });

    const liftSets: Record<string, number> = { [lift]: sets };
    addSets(lift, sets);
    if (secondary) {
      liftSets[secondary.lift] = secondary.sets * SECONDARY_LIFT_SET_WEIGHT;
      addSets(secondary.lift, secondary.sets * SECONDARY_LIFT_SET_WEIGHT);
    }
    const sessionIsHeavy = intensity[1] > HEAVY_LOWER_BODY_LOAD_THRESHOLD;
    if (lift !== "bench" && sessionIsHeavy) heavyStrengthSessions++;

    if (lift === "squat") {
      const isHeavy: boolean = sessionIsHeavy && !heavyLowerUsed;
      heavyLowerUsed = heavyLowerUsed || isHeavy;
      sessions.push(
        makeSession(isHeavy ? "squat_heavy" : "squat_volume", "strength", strengthEmphasisKey, findingId, prescription, {
          intensity: isHeavy ? 0.9 : 0.7,
          isQuality: sessionIsHeavy,
          isHeavyLower: isHeavy,
          isDeadlift: secondary?.lift === "deadlift",
          lift,
          label: splitDay.label,
          liftSets,
        })
      );
    } else if (lift === "deadlift") {
      sessions.push(
        makeSession(sessionIsHeavy ? "deadlift_heavy" : "deadlift_volume", "strength", strengthEmphasisKey, findingId, prescription, {
          intensity: sessionIsHeavy ? 0.9 : 0.72,
          isQuality: sessionIsHeavy,
          isHeavyLower: sessionIsHeavy,
          isDeadlift: true,
          lift,
          label: splitDay.label,
          liftSets,
        })
      );
    } else {
      sessions.push(
        makeSession(sessionIsHeavy ? "bench_heavy" : "bench_volume", "strength", strengthEmphasisKey, findingId, prescription, {
          intensity: sessionIsHeavy ? 0.88 : 0.65,
          isQuality: false,
          lift,
          label: splitDay.label,
          liftSets,
        })
      );
    }
  }

  // A weak lift earns an EXTRA weekly exposure at moderate load.
  if (mode.strength === "develop" && weakLiftSlots > 0) {
    const lift = profile.weakLift ?? rotation[0];
    const findingId = attributeFinding("weak_lift", profile.findings) ?? "hybrid-baseline";
    const wl = LIFT_PRESCRIPTIONS.weak_lift;
    for (let i = 0; i < weakLiftSlots; i++) {
      const wlSets = deload ? Math.max(2, Math.round(wl.sets * DELOAD_STRENGTH_SET_MULTIPLIER)) : wl.sets;
      const prescription = prescribeLift(profile, findingId, {
        lift,
        substitution: hasBarbell ? undefined : NO_GYM_SUBSTITUTIONS[lift],
        sets: wlSets,
        reps: [wl.repsLow, wl.repsHigh],
        intensity: capIntensity([wl.intensityLow, wl.intensityHigh], Math.min(intensityCeiling, taperCeilingFor(lift))),
        rir: [2, 3],
        workingMaxMultiplier: workingMax,
      });
      addSets(lift, wlSets);
      sessions.push(
        makeSession("weak_lift_exposure", "strength", "weak_lift", findingId, prescription, {
          intensity: wl.intensityHigh,
          isQuality: false,
          lift,
          label: `Extra ${lift} exposure`,
          liftSets: { [lift]: wlSets },
        })
      );
    }
  }

  // ---- the hours cap, against the sessions as actually built ---------------
  // The estimate above sized the endurance budget beside an ESTIMATE of the
  // gym time. Now the real sessions exist — a lower day carrying a second
  // lift, a quality session that grew to fit its reps — the easy runs give
  // way until the week fits, because they are the part with the least
  // specific work in them.
  if (hoursCapMin > 0) {
    const totalOf = () => sessions.reduce((s, x) => s + x.minutes, 0);
    let excess = totalOf() - hoursCapMin;
    let easyCut = false;
    if (excess > 0 && easySessions.length > 0) {
      const reducible = easySessions.reduce((s, e) => s + Math.max(0, e.session.minutes - MIN_ENDURANCE_SESSION_MIN), 0);
      const cut = Math.min(excess, reducible);
      if (cut > 0) {
        easyCut = true;
        for (const e of easySessions) {
          const room = Math.max(0, e.session.minutes - MIN_ENDURANCE_SESSION_MIN);
          const take = Math.round((room / reducible) * cut);
          const rebuilt = buildEasy(e.index, e.session.minutes - take, e.modality);
          sessions[sessions.indexOf(e.session)] = rebuilt;
          e.session = rebuilt;
        }
      }
      excess = totalOf() - hoursCapMin;
      // Still over at the floors: the last easy run goes, and the athlete is told.
      while (excess > 0 && easySessions.length > 0) {
        const dropped = easySessions.pop()!;
        easyCut = true;
        sessions.splice(sessions.indexOf(dropped.session), 1);
        allocation.aerobic_base = Math.max(0, allocation.aerobic_base - 1);
        excess = totalOf() - hoursCapMin;
      }
    }
    // Then the long run gives way, down to its floor — it is the one session
    // that is sized by the race rather than by the week, so it is the last
    // to shrink and the athlete is told what it would have been.
    excess = totalOf() - hoursCapMin;
    const longIdx = sessions.findIndex((s) => s.kind === "long_run");
    if (excess > 0 && longIdx >= 0) {
      const current = sessions[longIdx];
      const target = Math.max(MIN_ENDURANCE_SESSION_MIN, Math.round(current.minutes - excess));
      if (target < current.minutes) {
        const findingId = attributeFinding("aerobic_base", profile.findings) ?? "hybrid-baseline";
        sessions[longIdx] = buildEnduranceSession({
          profile,
          modality: cardio.primary,
          fitness: modalityFitness[cardio.primary],
          kind: "long_run",
          emphasisKey: "aerobic_base",
          findingId,
          minutes: target,
          intensity: 0.45,
          isQuality: target >= LONG_RUN_QUALITY_THRESHOLD_MIN,
          suppressHeartRate,
          extra: cardio.primary === "run" ? "Finish with 6x20s strides, walking back to full recovery between." : undefined,
        });
        longRunMinutes = target;
        notes.push(
          `The long run is held to ${target} minutes by your weekly hours; the block wanted ${current.minutes}. ` +
            `If one longer window a week can be found, this is the session to spend it on.`
        );
      }
    }
    if (easyCut && !notes.some((n) => n.startsWith("Held to your"))) {
      notes.push(
        `Held to your ${constraints.maxHoursPerWeek} hours a week — the easy running is what gave way, because the ` +
          `gym sessions and the hard runs carry the work this block is built on.`
      );
    }
  }

  const deliveredEnduranceMin = sessions
    .filter((s) => s.domain === "endurance")
    .reduce((s, x) => s + x.minutes, 0);

  return {
    sessions,
    allocation,
    notes,
    longRunMinutes,
    deliveredEnduranceMin,
    qualityCount,
    strengthSetsByLift,
    heavyStrengthSessions,
  };
}
