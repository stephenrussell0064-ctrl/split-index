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
}

const STRENGTH_PHASE_MAIN: Record<StrengthPhase, StrengthPrescription> = {
  build: { sets: 4, reps: "8-10", intensity: "~70-75% 1RM" },
  strength: { sets: 5, reps: "4-6", intensity: "~80-85% 1RM" },
  peak: { sets: 4, reps: "2-4", intensity: "~88-93% 1RM" },
};

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
 * Real distributed structure for N weekly sessions of one cardio goal —
 * easy/aerobic + quality (tempo/threshold/interval) + a long session, not
 * N repeats of the same effort. Mirrors standard polarized-training
 * structure (most volume easy, some genuinely hard) rather than
 * everything at one middling pace.
 */
export function cardioSessionTypes(count: number, emphasis: CardioEmphasis): SessionType[] {
  if (count <= 0) return [];
  if (count === 1) return [emphasis === "aerobic-base" ? "easy" : "tempo"];
  if (count === 2) return emphasis === "aerobic-base" ? ["easy", "tempo"] : ["tempo", "interval"];
  if (count === 3) return emphasis === "aerobic-base" ? ["easy", "tempo", "long"] : ["easy", "interval", "long"];
  const base: SessionType[] =
    emphasis === "aerobic-base" ? ["easy", "easy", "tempo", "long"] : ["easy", "interval", "threshold", "long"];
  while (base.length < count) base.push("easy");
  return base.slice(0, count);
}

const SESSION_TYPE_LABEL: Record<SessionType, string> = Object.fromEntries(
  SESSION_TYPES.map((s) => [s.value, s.label])
) as Record<SessionType, string>;

const SESSION_TYPE_GUIDANCE: Record<SessionType, string> = {
  easy: "Easy aerobic effort, fully conversational pace — builds your base without adding fatigue.",
  recovery: "Very light, active recovery only — the point is barely raising your heart rate.",
  tempo: "Comfortably hard, sustained effort — controlled discomfort, not all-out.",
  threshold: "Right at your lactate threshold — hard but sustainable for the whole interval.",
  interval: "Short hard efforts with full recovery between reps — sharpens race-pace speed.",
  fartlek: "Unstructured speed play — mix easy and hard by feel.",
  race: "Race or time-trial effort.",
  long: "Your longest session of the week, at an easy-to-moderate pace — builds endurance capacity.",
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

  const mainLine = `${goal.targetKey} ${main.sets}x${main.reps} @ ${main.intensity}`;
  const accessoryLines = accessories.map((a) => `${a.name} ${a.prescription.sets}x${a.prescription.reps}`);
  const taperNote = tapering ? "Tapering into your target date — reduced volume, stay sharp, prioritize recovery." : null;
  const description = [mainLine, ...accessoryLines, ...(taperNote ? [taperNote] : [])].join(" · ");

  return { title, description, movementPattern: pattern ?? undefined };
}

function cardioSessionContent(sessionType: SessionType, sportLabel: string, tapering: boolean): SessionContent {
  const guidance = tapering
    ? `${SESSION_TYPE_GUIDANCE[sessionType]} Tapering into your target date — shorter than usual, stay sharp rather than chasing more volume.`
    : SESSION_TYPE_GUIDANCE[sessionType];
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
  daysUntilTarget: number | null = null
): SessionContent {
  if (goal.goalType === "gym") {
    return gymSessionContent(goal, instanceIndex, totalInstances, excludeGymNames, daysUntilTarget);
  }
  const emphasis = cardioEmphasisFromGapAndUrgency(goal.gapFraction, daysUntilTarget);
  const types = cardioSessionTypes(totalInstances, emphasis);
  const sessionType = types[instanceIndex] ?? "easy";
  return cardioSessionContent(sessionType, goal.label, isTaperWindow(daysUntilTarget));
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
