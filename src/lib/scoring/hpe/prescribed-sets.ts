import { COMMON_EXERCISES, getExerciseTracking } from "@/lib/constants/sports";

/**
 * The structured half of a strength prescription, recovered from its text.
 *
 * `prescribeLift` writes a strength session as ONE string — exercises joined
 * with " · ", each in the shape
 *
 *   "Back squat 4x3-5 @ 120-135kg (80-90% 1RM), RIR 2-3"
 *   "Leg press 3x10-15 @ 145-165kg"
 *   "Pull-up or lat pulldown 3x8-12"
 *   "Weighted plank 3x45s"
 *
 * and nothing downstream has ever read it back as data: the day view splits it
 * into lines and the athlete transcribes those lines into the gym form by hand,
 * about three fields per set. This module is the inverse of that string so the
 * form can be filled from the prescription and the athlete only edits what
 * differed.
 *
 * Parsing the TEXT rather than changing what the engine emits is deliberate.
 * Every stored plan in production carries text only (`hpe_sessions.prescription`;
 * the `lift_sets` column from migration 076 was never written), the engine's
 * own `exerciseCount` already does arithmetic on the separator, and
 * session-content.test.ts asserts on the string. A structured emit can come
 * later without disturbing this; until then the string is the contract and
 * this file reads it.
 *
 * Everything here is pure. Nothing is invented: a line with no kilogram band
 * yields `loadKg: null`, and the callers decide what that means (the form
 * leaves the weight blank; the one-tap path declines to log it).
 */

export interface PrescribedExercise {
  /** The exercise as the engine named it, e.g. "Back squat". */
  name: string;
  /** Muscle group in the form's own vocabulary (MUSCLE_GROUPS), or "" when it could not be placed. */
  muscleGroup: string;
  sets: number;
  /** Rep range; equal when the line gave a single number. Null for a timed hold. */
  repsLo: number | null;
  repsHi: number | null;
  /** Hold length for "3x45s" lines. Null for rep work. */
  holdSeconds: number | null;
  /** Kilogram band from "@ 120-135kg"; equal when a single load was given. Null when the line gave a percentage or a qualitative load only. */
  loadLoKg: number | null;
  loadHiKg: number | null;
  /** Reps-in-reserve band from ", RIR 2-3". Null for lines that carry none (every accessory). */
  rirLo: number | null;
  rirHi: number | null;
  /** The line exactly as the engine wrote it. */
  raw: string;
}

export const PRESCRIPTION_SEPARATOR = " · ";

const LINE = /^(.*?)\s(\d+)\s*x\s*(\d+)(?:\s*-\s*(\d+))?(s)?\b(.*)$/i;
const LOAD_BAND = /@\s*(\d+(?:\.\d+)?)(?:\s*-\s*(\d+(?:\.\d+)?))?\s*kg\b/i;
const RIR_BAND = /\bRIR\s*(\d+)(?:\s*-\s*(\d+))?/i;

function num(value: string | undefined): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** One line of a prescription, or null when it does not carry a set scheme (a note that leaked in, say). */
export function parsePrescribedLine(line: string): PrescribedExercise | null {
  const trimmed = line.trim();
  const match = LINE.exec(trimmed);
  if (!match) return null;
  const [, rawName, setsText, countLo, countHi, secondsFlag, rest] = match;
  const name = rawName.trim();
  const sets = num(setsText);
  const lo = num(countLo);
  if (!name || sets == null || sets <= 0 || lo == null || lo <= 0) return null;

  const isTimed = secondsFlag != null;
  const load = LOAD_BAND.exec(rest);
  const rir = RIR_BAND.exec(rest);

  const loadLo = load ? num(load[1]) : null;
  const loadHi = load ? (num(load[2]) ?? loadLo) : null;
  const rirLo = rir ? num(rir[1]) : null;
  const rirHi = rir ? (num(rir[2]) ?? rirLo) : null;

  return {
    name,
    muscleGroup: muscleGroupForExercise(name),
    sets,
    repsLo: isTimed ? null : lo,
    repsHi: isTimed ? null : (num(countHi) ?? lo),
    holdSeconds: isTimed ? lo : null,
    loadLoKg: loadLo,
    loadHiKg: loadHi,
    rirLo,
    rirHi,
    raw: trimmed,
  };
}

/** Every exercise line of a strength prescription, in the order the engine wrote them. Lines that do not parse are dropped rather than guessed at. */
export function parsePrescribedExercises(text: string): PrescribedExercise[] {
  return text
    .split(PRESCRIPTION_SEPARATOR)
    .map(parsePrescribedLine)
    .filter((ex): ex is PrescribedExercise => ex !== null);
}

/**
 * The single load and rep count a set is filled in with.
 *
 * A prescription is a BAND — "120-135kg", "3-5 reps" — and a logged set is a
 * number. The midpoint is the honest default: it is what "do this" means when
 * nothing in the session pulled the athlete to either end, and it is equally
 * one edit away from both. Load rounds to the nearest 2.5 kg because that is
 * what a bar can actually hold; reps round down because a rep range is "at
 * least the low end, up to the high end" and a half-rep is not a rep.
 */
export function prescribedSetValues(ex: PrescribedExercise): {
  weightKg: number | null;
  reps: number | null;
  holdSeconds: number | null;
} {
  const weightKg =
    ex.loadLoKg != null && ex.loadHiKg != null
      ? Math.round(((ex.loadLoKg + ex.loadHiKg) / 2) / 2.5) * 2.5
      : null;
  const reps =
    ex.repsLo != null && ex.repsHi != null ? Math.floor((ex.repsLo + ex.repsHi) / 2) : null;
  return { weightKg, reps, holdSeconds: ex.holdSeconds };
}

/**
 * Keyword fallbacks for names the exercise table does not carry verbatim —
 * the engine writes "Pull-up or lat pulldown" and "Cable fly or pec deck",
 * which are two exercises in one line. Ordered most specific first; the first
 * hit wins.
 */
const MUSCLE_BY_KEYWORD: [RegExp, string][] = [
  [/\bplank\b|\bdead bug\b|\bab\b|\bcrunch|\bpallof\b|\bcarry\b|\bfarmer'?s\b/i, "Core"],
  [/\bcalf\b|\bcalves\b/i, "Calves"],
  [/\bhip thrust\b|\bglute\b/i, "Glutes"],
  [/\bromanian\b|\bhamstring\b|\bleg curl\b|\bgood morning\b|\bnordic\b/i, "Hamstrings"],
  [/\bdeadlift\b/i, "Hamstrings"],
  [/\bsquat\b|\bleg press\b|\blunge\b|\bleg extension\b|\bsplit squat\b|\bstep[- ]up\b/i, "Quads"],
  [/\bcurl\b/i, "Biceps"],
  [/\bpushdown\b|\bskull|\bdip\b|\bdips\b|\btriceps\b|\bclose[- ]grip\b/i, "Triceps"],
  [/\blateral raise\b|\boverhead\b|\bshoulder\b|\bface pull\b|\brear delt\b|\bupright row\b/i, "Shoulders"],
  [/\brow\b|\bpull[- ]?up\b|\bpulldown\b|\bchin[- ]?up\b|\blat\b|\bback\b/i, "Back"],
  [/\bbench\b|\bpress\b|\bfly\b|\bflye\b|\bpec\b|\bpush[- ]?up\b|\bchest\b/i, "Chest"],
];

/** The form's muscle group for an exercise name, or "" when nothing fits — the form then asks, as it would for any custom name. */
export function muscleGroupForExercise(name: string): string {
  const needle = name.trim().toLowerCase();
  if (!needle) return "";
  const exact = COMMON_EXERCISES.find((ex) => ex.name.toLowerCase() === needle);
  if (exact) return exact.muscle;
  // "A or B": either half may be a known exercise.
  for (const part of needle.split(/\s+or\s+/)) {
    const hit = COMMON_EXERCISES.find((ex) => ex.name.toLowerCase() === part.trim());
    if (hit) return hit.muscle;
  }
  for (const [pattern, muscle] of MUSCLE_BY_KEYWORD) {
    if (pattern.test(needle)) return muscle;
  }
  return "";
}

/**
 * Whether every exercise carries enough to be logged without the athlete
 * typing anything: a muscle group the form accepts, and either a kilogram
 * load, a hold length, or a movement the form logs at bodyweight.
 *
 * This is the gate on the one-tap path. A prescription that says "80-90% 1RM
 * (no logged 1RM yet)" has no number to log, and logging it as 0 kg would be
 * the invented-data failure the gym form was rebuilt to avoid; that session
 * opens in the form with reps filled and the weight left for the athlete.
 */
export function canLogAsPrescribed(exercises: PrescribedExercise[]): boolean {
  if (exercises.length === 0) return false;
  return exercises.every((ex) => {
    if (!ex.muscleGroup) return false;
    const tracking = getExerciseTracking(ex.name);
    if (tracking === "time" || ex.holdSeconds != null) return ex.holdSeconds != null;
    if (tracking === "distance") return false;
    if (ex.loadLoKg != null) return true;
    return isBodyweightMovement(ex.name);
  });
}

/** Pull-ups, dips, push-ups: the form logs these at 0 kg added and scores them off reps at bodyweight. */
export function isBodyweightMovement(name: string): boolean {
  return /\b(pull[- ]?ups?|chin[- ]?ups?|dips?|push[- ]?ups?|muscle[- ]?ups?)\b/i.test(name) &&
    !/\bweighted\b|\bmachine\b|\bassisted\b/i.test(name);
}

/*
 * RIR and RPE are deliberately NOT filled in from the prescription. The band
 * the engine writes ("RIR 2-3") is a target, and the set's effort rating is a
 * report — the two values most likely to differ set to set, and a target
 * logged as a report is the quietly-wrong data the gym form's blank-start
 * rule exists to keep out (see createSetRow in form-state.ts). Load and reps
 * are what was prescribed; effort is what happened, and only the athlete
 * knows it.
 */
