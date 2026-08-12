/**
 * Session-content engine for the Training Plan weekly schedule.
 *
 * User feedback: "this training plan should be fully curated from scratch
 * as a plan which is reputable and realistic to achieve the goals. Your
 * current plan tells me to do bench press and to do a 5km run twice a
 * week, this is not going to benefit me is it? ... this would involve
 * aerobic training, strength training, other training (e.g. if training
 * for bench press increase then maybe increasing the amount of push
 * sessions including bench press or other chest and tricep exercises)."
 *
 * buildWeeklySchedule (training-plan.ts) already answers WHICH DAY each
 * session lands on. This module answers what actually HAPPENS in that
 * session — real accessory work built off the app's own existing
 * exercise taxonomy (COMMON_EXERCISES' muscle/category/kind fields, the
 * same data split-strength-engine.ts already uses to score every lift),
 * a gap-driven periodization phase (build → strength → peak, the standard
 * progression as an athlete gets closer to a strength goal), session-to-
 * session intensity undulation (DUP) when a lift gets more than one
 * weekly session so "twice a week" isn't the identical stimulus twice,
 * and a real easy/quality/long distribution for cardio goals instead of
 * repeating the same run.
 */

import { COMMON_EXERCISES, SESSION_TYPES } from "@/lib/constants/sports";
import { formatPace, formatSpeed } from "@/lib/utils/format";
import type { RankedGoal } from "./training-plan";
import type { SessionType } from "@/types";

// ---------- Movement-pattern taxonomy ----------

export type MovementPattern = "push" | "pull" | "legs" | "core";

/** Which broad training day a muscle group belongs to — the same push/pull/legs split any real program is built around. */
const MUSCLE_PATTERN: Record<string, MovementPattern> = {
  Chest: "push",
  Shoulders: "push",
  Triceps: "push",
  Back: "pull",
  Biceps: "pull",
  Quads: "legs",
  Hamstrings: "legs",
  Glutes: "legs",
  Calves: "legs",
  Core: "core",
};

const PATTERN_DAY_LABEL: Record<MovementPattern, string> = {
  push: "Push Day",
  pull: "Pull Day",
  legs: "Leg Day",
  core: "Core",
};

/** Priority-ordered synergist muscles for accessory selection per pattern — e.g. a push day pulls one chest, one shoulder, and one triceps accessory, not three chest isolation moves. */
const PATTERN_ACCESSORY_MUSCLES: Record<MovementPattern, string[]> = {
  push: ["Chest", "Shoulders", "Triceps"],
  pull: ["Back", "Biceps"],
  legs: ["Hamstrings", "Glutes", "Quads", "Calves"],
  core: ["Core"],
};

export function movementPatternForExercise(exerciseName: string): MovementPattern | null {
  const def = COMMON_EXERCISES.find((e) => e.name.toLowerCase() === exerciseName.toLowerCase());
  if (!def) return null;
  return MUSCLE_PATTERN[def.muscle] ?? null;
}

// ---------- Strength periodization ----------

/** Classic linear-periodization progression as a strength goal gets closer: build volume/hypertrophy first, then strength, then peak/specificity. */
export type StrengthPhase = "build" | "strength" | "peak";

const PHASE_ORDER: StrengthPhase[] = ["build", "strength", "peak"];

/** >20% off target: still building the base. 8-20%: dedicated strength work. <8%: peaking — heavier, lower volume, closer to the actual goal lift. */
export function strengthPhaseFromGap(gapFraction: number): StrengthPhase {
  if (gapFraction > 0.2) return "build";
  if (gapFraction > 0.08) return "strength";
  return "peak";
}

function shiftedPhase(phase: StrengthPhase, delta: number): StrengthPhase {
  const idx = PHASE_ORDER.indexOf(phase);
  return PHASE_ORDER[Math.max(0, Math.min(PHASE_ORDER.length - 1, idx + delta))];
}

/**
 * Stage 2 (user feedback: "move on and scope for this" after Stage 1's
 * gap-only phase selection). A target date bends the gap-driven phase
 * toward peaking as the deadline nears, regardless of how far off the
 * numbers still say — the whole point of a taper is arriving at a goal
 * date fresh and sharp even if the gap hasn't fully closed, not grinding
 * base volume right up to the deadline.
 */
export const TAPER_WINDOW_DAYS = 10;
export const PEAK_WINDOW_DAYS = 28;

export function isTaperWindow(daysUntilTarget: number | null): boolean {
  return daysUntilTarget !== null && daysUntilTarget >= 0 && daysUntilTarget <= TAPER_WINDOW_DAYS;
}

export function strengthPhaseFromGapAndUrgency(gapFraction: number, daysUntilTarget: number | null): StrengthPhase {
  const gapPhase = strengthPhaseFromGap(gapFraction);
  if (daysUntilTarget === null || daysUntilTarget < 0) return gapPhase;
  if (daysUntilTarget <= TAPER_WINDOW_DAYS) return "peak";
  if (daysUntilTarget <= PEAK_WINDOW_DAYS) return shiftedPhase(gapPhase, 1);
  return gapPhase;
}

export interface StrengthPrescription {
  sets: number;
  reps: string;
  intensity: string;
  /** Numeric %1RM bounds backing `intensity`'s display string — main-lift prescriptions only (see weightRangeFor below). Undefined for accessory prescriptions, which aren't tied to a tracked 1RM. */
  intensityLowPct?: number;
  intensityHighPct?: number;
}

const STRENGTH_PHASE_MAIN: Record<StrengthPhase, StrengthPrescription> = {
  build: { sets: 4, reps: "8-10", intensity: "~70-75% 1RM", intensityLowPct: 0.7, intensityHighPct: 0.75 },
  strength: { sets: 5, reps: "4-6", intensity: "~80-85% 1RM", intensityLowPct: 0.8, intensityHighPct: 0.85 },
  peak: { sets: 4, reps: "2-4", intensity: "~88-93% 1RM", intensityLowPct: 0.88, intensityHighPct: 0.93 },
};

/** Finest realistic jump on a standard barbell/plate setup — a prescribed weight rounded to anything less than this isn't actually loadable. */
const WEIGHT_ROUNDING_KG = 2.5;

function roundToPlate(kg: number): number {
  return Math.round(kg / WEIGHT_ROUNDING_KG) * WEIGHT_ROUNDING_KG;
}

/**
 * User feedback: "For strength goals, attempt to recommend a weight based
 * off the user's current strength performance in their recent 1rms and
 * activities logged." Converts the phase's %1RM band into an actual kg
 * number off the athlete's own current estimated 1RM (goal.currentValue —
 * already the athlete's real best-ever estimate for this exact lift, see
 * /api/training-goals's bestByExercise), rounded to a loadable plate
 * increment — "67.5-70kg x 8-10" instead of making the athlete work out
 * "75% of what?" themselves. Null when there's no current 1RM on record
 * yet (never logged this lift) — the %1RM text alone is all that's honest
 * to show in that case.
 */
function weightRangeFor(prescription: StrengthPrescription, currentOneRM: number | null): string | null {
  if (currentOneRM == null || currentOneRM <= 0) return null;
  if (prescription.intensityLowPct == null || prescription.intensityHighPct == null) return null;
  const low = roundToPlate(currentOneRM * prescription.intensityLowPct);
  const high = roundToPlate(currentOneRM * prescription.intensityHighPct);
  return low === high ? `${low}kg` : `${low}-${high}kg`;
}

const STRENGTH_PHASE_ACCESSORY: Record<StrengthPhase, StrengthPrescription> = {
  build: { sets: 3, reps: "10-12", intensity: "moderate" },
  strength: { sets: 3, reps: "8-10", intensity: "moderate-heavy" },
  peak: { sets: 2, reps: "8-10", intensity: "light (recovery volume — main lift is the priority this phase)" },
};

/**
 * DUP (daily undulating periodization): when the same lift gets more than
 * one weekly session, alternate a heavier/lower-rep session with a
 * lighter/higher-rep one instead of repeating the identical prescription —
 * real programs vary the stimulus session to session, which is exactly
 * what "bench press twice a week" was missing.
 */
export function mainLiftPrescription(phase: StrengthPhase, instanceIndex: number, totalInstances: number): StrengthPrescription {
  if (totalInstances <= 1) return STRENGTH_PHASE_MAIN[phase];
  const variantPhase = shiftedPhase(phase, instanceIndex % 2 === 0 ? 1 : -1);
  return STRENGTH_PHASE_MAIN[variantPhase];
}

export function dupVariantLabel(instanceIndex: number, totalInstances: number): "Heavy day" | "Volume day" | null {
  if (totalInstances <= 1) return null;
  return instanceIndex % 2 === 0 ? "Heavy day" : "Volume day";
}

export interface AccessoryPick {
  name: string;
  muscle: string;
  prescription: StrengthPrescription;
}

/**
 * Pulls one accessory per synergist muscle for this lift's movement
 * pattern (chest/shoulders/triceps for a push goal, back/biceps for pull,
 * hamstrings/glutes/quads/calves for legs) — a genuine push/pull/legs
 * accessory spread, not repeated isolation of the same muscle. Excludes
 * any exercise that's already someone's OWN explicit goal elsewhere in
 * the plan, so accessory work never just re-lists a dedicated session.
 */
export function pickAccessories(
  mainExerciseName: string,
  phase: StrengthPhase,
  excludeNames: Set<string>,
  maxCount = 3
): AccessoryPick[] {
  const pattern = movementPatternForExercise(mainExerciseName);
  if (!pattern) return [];
  const muscles = PATTERN_ACCESSORY_MUSCLES[pattern];
  const picks: AccessoryPick[] = [];
  for (const muscle of muscles) {
    if (picks.length >= maxCount) break;
    const candidate = COMMON_EXERCISES.find(
      (e) =>
        e.kind === "accessory" &&
        e.muscle === muscle &&
        e.name !== mainExerciseName &&
        !excludeNames.has(e.name) &&
        !picks.some((p) => p.name === e.name)
    );
    if (candidate) {
      picks.push({ name: candidate.name, muscle, prescription: STRENGTH_PHASE_ACCESSORY[phase] });
    }
  }
  return picks;
}

// ---------- Cardio periodization ----------

export type CardioEmphasis = "aerobic-base" | "specificity";

/** Far from target: build the aerobic engine first. Close to target: sharpen with more quality work. Mirrors the same build→peak logic as the strength side. */
export function cardioEmphasisFromGap(gapFraction: number): CardioEmphasis {
  return gapFraction > 0.15 ? "aerobic-base" : "specificity";
}

/** Same taper logic as the strength side — inside the taper window, sharpen regardless of how far the gap-based logic alone would say to keep building. */
export function cardioEmphasisFromGapAndUrgency(gapFraction: number, daysUntilTarget: number | null): CardioEmphasis {
  if (isTaperWindow(daysUntilTarget)) return "specificity";
  return cardioEmphasisFromGap(gapFraction);
}

/**
 * User feedback: "zone 2 shouldn't just be 1 session a week, according to
 * most training guides zone 2 should be done more than intense training to
 * build up an aerobic base" — agreed, this is the standard 80/20
 * polarized-training principle (Seiler et al.; the same idea behind
 * "80/20 Running" and Jack Daniels' training zones). "At least one easy
 * session" (the previous fix, for a real bug where a 2x/week specificity
 * plan handed back zero easy sessions at all) still isn't the same claim
 * as "easy is the majority" — at 4x/week specificity this was still only
 * 25% easy. QUALITY_FRACTION below is the genuine minority share of the
 * week that's hard (tempo/threshold/interval) — everything else,
 * including the long session, is easy/Zone 2 effort. Even in specificity
 * (close to target, sharpening) real programs still hold the majority of
 * volume easy; they get more precise with the smaller hard share, they
 * don't abandon the base.
 */
const QUALITY_FRACTION: Record<CardioEmphasis, number> = {
  "aerobic-base": 0.2,
  specificity: 0.3,
};

/** Rotation of quality session types once there's room for more than one — keeps variety instead of repeating the identical hard session every quality slot. */
const QUALITY_ROTATION: Record<CardioEmphasis, SessionType[]> = {
  "aerobic-base": ["tempo", "threshold"],
  specificity: ["interval", "threshold", "tempo"],
};

export function cardioSessionTypes(count: number, emphasis: CardioEmphasis): SessionType[] {
  if (count <= 0) return [];
  if (count === 1) return [emphasis === "aerobic-base" ? "easy" : "tempo"];

  const qualityCount = Math.min(count - 1, Math.max(1, Math.round(count * QUALITY_FRACTION[emphasis])));
  const rotation = QUALITY_ROTATION[emphasis];
  const quality: SessionType[] = Array.from({ length: qualityCount }, (_, i) => rotation[i % rotation.length]);

  const easyCount = count - qualityCount;
  const easy: SessionType[] = Array.from({ length: easyCount }, () => "easy" as SessionType);
  // One easy slot becomes the week's long session once there's room for it
  // (3+ total sessions) — same threshold as before this rewrite.
  if (count >= 3) easy[easy.length - 1] = "long";

  return [...easy, ...quality];
}

const SESSION_TYPE_LABEL: Record<SessionType, string> = Object.fromEntries(
  SESSION_TYPES.map((s) => [s.value, s.label])
) as Record<SessionType, string>;

const SESSION_TYPE_GUIDANCE: Record<SessionType, string> = {
  easy: "Zone 2 effort, fully conversational pace — builds your aerobic base without adding fatigue.",
  recovery: "Very light, active recovery only — the point is barely raising your heart rate.",
  tempo: "Comfortably hard, sustained effort — controlled discomfort, not all-out.",
  threshold: "Right at your lactate threshold — hard but sustainable for the whole interval.",
  interval: "Push each rep, actually rest on the recovery — sharpens race-pace speed.",
  fartlek: "Unstructured speed play — mix easy and hard by feel.",
  race: "Race or time-trial effort.",
  long: "Your longest session of the week, at an easy-to-moderate (Zone 2) pace — builds endurance capacity.",
  other: "Cross-training or supplementary work.",
};

// ---------- Top-level dispatcher used by buildWeeklySchedule ----------

export interface SessionContent {
  title: string;
  description: string;
  sessionType?: SessionType;
  /** Gym sessions only — exposed so the scheduler can apply a soft interference-avoidance preference (see buildWeeklySchedule) without re-deriving the pattern itself. */
  movementPattern?: MovementPattern;
}

function gymSessionContent(
  goal: RankedGoal,
  instanceIndex: number,
  totalInstances: number,
  excludeNames: Set<string>,
  daysUntilTarget: number | null
): SessionContent {
  const phase = strengthPhaseFromGapAndUrgency(goal.gapFraction, daysUntilTarget);
  const tapering = isTaperWindow(daysUntilTarget);
  const main = mainLiftPrescription(phase, instanceIndex, totalInstances);
  const variantLabel = dupVariantLabel(instanceIndex, totalInstances);
  const pattern = movementPatternForExercise(goal.targetKey);
  // Taper: cut accessory volume too, not just note the phase — a real
  // taper reduces total work, it isn't just "the same session but heavier."
  const accessories = pickAccessories(goal.targetKey, phase, excludeNames, tapering ? 1 : 3);

  const dayLabel = pattern ? `${PATTERN_DAY_LABEL[pattern]} — ${goal.label} Focus` : `${goal.label} Focus`;
  const suffix = tapering ? "Taper" : variantLabel;
  const title = suffix ? `${dayLabel} (${suffix})` : dayLabel;

  const weightRange = weightRangeFor(main, goal.currentValue);
  const mainLine = weightRange
    ? `${goal.targetKey} ${main.sets}x${main.reps} @ ${weightRange} (${main.intensity})`
    : `${goal.targetKey} ${main.sets}x${main.reps} @ ${main.intensity}`;
  const accessoryLines = accessories.map((a) => `${a.name} ${a.prescription.sets}x${a.prescription.reps}`);
  const taperNote = tapering ? "Tapering into your target date — reduced volume, stay sharp, prioritize recovery." : null;
  const description = [mainLine, ...accessoryLines, ...(taperNote ? [taperNote] : [])].join(" · ");

  return { title, description, movementPattern: pattern ?? undefined };
}

/**
 * Nominal cardio session length used only as a fallback for turning a
 * prescribed pace into a distance below — mirrors training-plan.ts's
 * DEFAULT_SESSION_HOURS.cardio. buildWeeklySchedule always passes the real
 * per-goal-type duration it's actually using for capacity accounting; this
 * only matters for direct callers (tests, anything bypassing the
 * scheduler) that don't pass one.
 */
const DEFAULT_CARDIO_DURATION_HOURS = 0.75;

/**
 * How much slower (>1) or faster (<1) than the athlete's current pace at
 * this goal's distance a session of this type should be run — the same
 * %-of-race-pace zones real endurance coaching uses (easy/long noticeably
 * slower than race effort, threshold close to it, intervals faster).
 * Applied to seconds-per-km so it holds regardless of whether the sport
 * displays as a pace or (cycling) a speed.
 */
const SESSION_PACE_MULTIPLIER: Record<SessionType, number> = {
  recovery: 1.35,
  easy: 1.2,
  fartlek: 1.12,
  long: 1.15,
  tempo: 1.06,
  threshold: 1.02,
  interval: 0.92,
  race: 1.0,
  other: 1.15,
};

/**
 * User feedback (with their own real numbers — 18:30 5K, 39:45 10K PR):
 * a fixed full session duration run continuously at the prescribed pace
 * was producing things like "11.5km at 3:56/km" for a TEMPO run and
 * "13.2km at 3:24/km" framed as a single continuous INTERVAL — neither is
 * something a real training plan would ever ask for, let alone at that
 * athlete's fitness. Real tempo/threshold work is a shorter sustained
 * block inside a longer session (warm-up, the actual hard block, cooldown
 * — not the whole session at that effort); this is the fraction of the
 * session's time that block actually is. Easy/recovery/long/fartlek/race
 * genuinely are continuous for the whole session, so they're left at 1
 * (the full duration) via the `?? 1` fallback below.
 */
const QUALITY_BLOCK_FRACTION: Partial<Record<SessionType, number>> = {
  tempo: 0.45,
  threshold: 0.35,
};

/**
 * Interval work is reps-with-recovery, not a continuous distance — showing
 * "13.2km at 3:24/km" for an interval session was telling the athlete to
 * run over 13km straight at a pace that's only sustainable in short
 * bursts. A real rep distance per sport (short enough that the prescribed
 * pace is actually achievable with real recovery between reps), plus how
 * much of the session's total time is actually spent running (the rest is
 * recovery jogs/rest), gives a genuine "N x distance" prescription instead.
 */
const INTERVAL_REP_METERS_BY_SPORT: Record<string, number> = {
  run: 800,
  walk: 800,
  row: 500,
  ski: 500,
  swim: 100,
  cycle: 1000,
};
const DEFAULT_INTERVAL_REP_METERS = 800;
const INTERVAL_WORK_FRACTION = 0.35;
const MIN_INTERVAL_REPS = 3;

function intervalRepMeters(sport: string | null | undefined): number {
  return (sport ? INTERVAL_REP_METERS_BY_SPORT[sport] : undefined) ?? DEFAULT_INTERVAL_REP_METERS;
}

/**
 * User feedback: "for the runs and swims and cycles be specific on the
 * distance and pace of each activity that you should perform." Derives
 * real, achievable numbers from the goal's own CURRENT pace — not the
 * aspirational target, since prescribing today's session off a
 * not-yet-earned goal pace could ask for something not yet sustainable —
 * and the session type's own realistic structure (see the two constants
 * above), not just "however far you'd go running the whole session at
 * that pace". Returns null whenever there isn't enough data to ground a
 * real number (no distance on the goal, or no current/target time yet),
 * in which case the plain effort-only guidance shows instead, same as
 * before this feature existed.
 */
function cardioPaceAndDistance(goal: RankedGoal, sessionType: SessionType, durationHours: number): string | null {
  const distanceMeters = goal.distanceMeters;
  if (!distanceMeters || distanceMeters <= 0) return null;
  const referenceSeconds = goal.currentValue ?? goal.targetValue;
  if (!referenceSeconds || referenceSeconds <= 0 || durationHours <= 0) return null;

  const basePaceSecPerKm = referenceSeconds / (distanceMeters / 1000);
  if (!Number.isFinite(basePaceSecPerKm) || basePaceSecPerKm <= 0) return null;
  const paceSecPerKm = basePaceSecPerKm * (SESSION_PACE_MULTIPLIER[sessionType] ?? 1.15);
  if (!Number.isFinite(paceSecPerKm) || paceSecPerKm <= 0) return null;
  const paceLabel = goal.sport === "cycle" ? formatSpeed(paceSecPerKm) : formatPace(paceSecPerKm);

  if (sessionType === "interval") {
    const repMeters = intervalRepMeters(goal.sport);
    const repSeconds = (repMeters / 1000) * paceSecPerKm;
    if (!Number.isFinite(repSeconds) || repSeconds <= 0) return null;
    const workSeconds = durationHours * 3600 * INTERVAL_WORK_FRACTION;
    const reps = Math.max(MIN_INTERVAL_REPS, Math.round(workSeconds / repSeconds));
    return `${reps} x ${repMeters}m at ${paceLabel} (jog recovery between reps)`;
  }

  const blockFraction = QUALITY_BLOCK_FRACTION[sessionType] ?? 1;
  const sessionDistanceKm = (durationHours * 3600 * blockFraction) / paceSecPerKm;
  if (!Number.isFinite(sessionDistanceKm) || sessionDistanceKm <= 0) return null;

  const blockSuffix = blockFraction < 1 ? " block (plus an easy warm-up/cooldown)" : "";
  return `${sessionDistanceKm.toFixed(1)}km${blockSuffix} at ${paceLabel}`;
}

function cardioSessionContent(sessionType: SessionType, goal: RankedGoal, tapering: boolean, durationHours: number): SessionContent {
  const sportLabel = goal.label;
  const specifics = cardioPaceAndDistance(goal, sessionType, durationHours);
  const guidanceBase = specifics
    ? `${specifics} — ${SESSION_TYPE_GUIDANCE[sessionType]}`
    : SESSION_TYPE_GUIDANCE[sessionType];
  const guidance = tapering
    ? `${guidanceBase} Tapering into your target date — shorter than usual, stay sharp rather than chasing more volume.`
    : guidanceBase;
  return {
    title: tapering ? `${sportLabel} — ${SESSION_TYPE_LABEL[sessionType]} (Taper)` : `${sportLabel} — ${SESSION_TYPE_LABEL[sessionType]}`,
    description: guidance,
    sessionType,
  };
}

/**
 * One goal's `instanceIndex`-th session out of `totalInstances` this week
 * — the single entry point buildWeeklySchedule calls per session slot.
 * `excludeGymNames` should be every OTHER active gym goal's exercise name
 * in the plan, so accessory picks never duplicate a dedicated goal.
 * `daysUntilTarget` (null when the goal has no deadline) drives the Stage
 * 2 taper behavior above.
 */
export function sessionContentForInstance(
  goal: RankedGoal,
  instanceIndex: number,
  totalInstances: number,
  excludeGymNames: Set<string>,
  daysUntilTarget: number | null = null,
  durationHours: number = DEFAULT_CARDIO_DURATION_HOURS
): SessionContent {
  if (goal.goalType === "gym") {
    return gymSessionContent(goal, instanceIndex, totalInstances, excludeGymNames, daysUntilTarget);
  }
  const emphasis = cardioEmphasisFromGapAndUrgency(goal.gapFraction, daysUntilTarget);
  const types = cardioSessionTypes(totalInstances, emphasis);
  const sessionType = types[instanceIndex] ?? "easy";
  return cardioSessionContent(sessionType, goal, isTaperWindow(daysUntilTarget), durationHours);
}

// ---------- Hybrid-balance maintenance ----------
// User feedback: "As this is a hybrid platform the whole purpose is
// finding a balance between all muscle groups and cardio, and so if the
// training plan doesn't account for this and only focuses on the users
// goals, then please amend as well, these goals should just be
// prioritised." See training-hybrid-balance.ts for how much weekly
// capacity gets reserved for this; these two functions only build the
// CONTENT for whatever gets scheduled into that reserved room.

/** Bodyweight/light-load defaults per pattern — deliberately not tied to any tracked 1RM, since this isn't chasing a specific target, just keeping every movement pattern trained. */
const MAINTENANCE_EXERCISE_BY_PATTERN: Record<MovementPattern, string> = {
  push: "Push Up",
  pull: "Pull Up",
  legs: "Goblet Squat",
  core: "Plank",
};

/**
 * One combined session covering whichever movement patterns the
 * athlete's own gym goals don't touch at all — RPE-based, not
 * periodized, since maintenance isn't progressing toward a specific
 * target the way a real goal is.
 */
export function hybridBalanceGymContent(missingPatterns: MovementPattern[]): SessionContent {
  const patterns = missingPatterns.length > 0 ? missingPatterns : (["push", "pull", "legs", "core"] as MovementPattern[]);
  const lines = patterns.map((p) => `${MAINTENANCE_EXERCISE_BY_PATTERN[p]} 3x10-12 (moderate effort)`);
  return {
    title: "Hybrid Balance — Full-Body Maintenance",
    description: `${lines.join(" · ")} — not tied to a specific goal, keeps every movement pattern trained while your priority lifts get the rest of the week.`,
    movementPattern: patterns.includes("legs") ? "legs" : undefined,
  };
}

/** A generic Zone 2 session for whenever there's no cardio goal at all — no specific sport/pace to prescribe, so it stays deliberately open. */
export function hybridBalanceCardioContent(): SessionContent {
  return {
    title: "Hybrid Balance — Cardio Maintenance",
    description:
      "20-30min Zone 2 effort, any modality you enjoy (run/bike/row/swim) — keeps your aerobic engine and hybrid score from atrophying while your gym goals get the rest of the week.",
    sessionType: "easy",
  };
}

// ---------- Feasibility (Stage 2) ----------

/**
 * A deliberately conservative, clearly-labeled ESTIMATE of achievable
 * weekly improvement — never used to block or silently change the plan,
 * only to flag "this deadline looks tight" the same way a reputable coach
 * would say so upfront rather than let an athlete find out at the finish
 * line. Real rates vary hugely by individual, training age, and recovery;
 * this is a sanity check, not a guarantee.
 */
const ASSUMED_WEEKLY_IMPROVEMENT_RATE_PER_SESSION = 0.01;

export interface FeasibilityResult {
  feasible: boolean;
  message: string | null;
}

export function estimateFeasibility(
  gapFraction: number,
  weeklySessions: number,
  daysUntilTarget: number | null
): FeasibilityResult {
  if (daysUntilTarget === null || daysUntilTarget < 0 || gapFraction <= 0 || weeklySessions <= 0) {
    return { feasible: true, message: null };
  }
  const weeksRemaining = daysUntilTarget / 7;
  const achievableFraction = ASSUMED_WEEKLY_IMPROVEMENT_RATE_PER_SESSION * weeklySessions * weeksRemaining;
  if (achievableFraction >= gapFraction) return { feasible: true, message: null };
  const weeksLabel = Math.max(1, Math.round(weeksRemaining));
  return {
    feasible: false,
    message: `Ambitious for the time left — closing a ${Math.round(gapFraction * 100)}% gap in ${weeksLabel} week${weeksLabel === 1 ? "" : "s"} at ${weeklySessions}x/week is a stretch. Treat it as a stretch goal, or add more weekly sessions toward it.`,
  };
}
