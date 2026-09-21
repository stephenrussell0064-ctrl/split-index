import type { SportType } from "@/types";

/**
 * The onboarding calibration form's state, extracted from score-reveal.tsx so
 * the rules about what counts as "entered" can be tested without rendering.
 * Same split as activities/form-state.ts.
 *
 * Two defects this module exists to fix, both reported as "onboarding won't
 * let me leave my running and strength level blank".
 *
 * FIRST, the cardio row arrived PRE-FILLED with 5 km in 25:00. Nobody typed
 * that. An athlete who tapped straight through was calibrated on a run they
 * never did, and the calibration route writes to personal_records and
 * predicted_benchmarks — so a fabricated 25:00 5K became their personal best
 * and seeded every race prediction that followed. A default that silently
 * becomes data is worse than an empty field, so the example now lives in the
 * placeholder where it belongs.
 *
 * SECOND, and the reason the first was hard to escape: clearing those fields
 * left the only button on the screen disabled, with no other way forward. Both
 * sections are labelled "optional", the profile is already saved by the time
 * this screen appears, and yet entering nothing was the one thing the screen
 * would not accept. Optional has to mean a way out, which is what
 * `canSkipCalibration` below asserts is always true.
 */

export interface CardioEntry {
  id: string;
  sport: SportType;
  distanceKm: string;
  minutes: string;
  seconds: string;
}

export type LiftKey = "squat" | "bench" | "deadlift";

export type SbdState = Record<LiftKey, { weightKg: string; reps: string }>;

export const SBD_LIFTS: { key: LiftKey; label: string }[] = [
  { key: "squat", label: "Squat" },
  { key: "bench", label: "Bench Press" },
  { key: "deadlift", label: "Deadlift" },
];

/**
 * Reps default to 5 and weight starts empty. That asymmetry is deliberate: a
 * rep count is a unit the athlete is being asked to confirm, not a claim about
 * their strength, and a lift only counts once a weight is typed (see
 * `filledLifts`). So the prefilled 5 can never become data on its own, which
 * is precisely what was wrong with the prefilled 5 km.
 */
export function newSbdState(): SbdState {
  return {
    squat: { weightKg: "", reps: "5" },
    bench: { weightKg: "", reps: "5" },
    deadlift: { weightKg: "", reps: "5" },
  };
}

let cardioEntryCounter = 0;

/** A blank row. The 5 km / 25:00 example that used to live here is now placeholder text — see this module's header. */
export function newCardioEntry(sport: SportType = "running"): CardioEntry {
  cardioEntryCounter += 1;
  return { id: `cardio-${cardioEntryCounter}`, sport, distanceKm: "", minutes: "", seconds: "" };
}

/** Lifts the athlete actually typed a weight for. */
export function filledLifts(sbd: SbdState): LiftKey[] {
  return SBD_LIFTS.filter(({ key }) => Number(sbd[key].weightKg) > 0 && Number(sbd[key].reps) > 0).map(
    ({ key }) => key
  );
}

/** Cardio rows carrying both a distance and a time — either alone cannot be scored. */
export function completeCardioEntries(entries: readonly CardioEntry[]): CardioEntry[] {
  return entries.filter(
    (c) => Number(c.distanceKm) > 0 && Number(c.minutes) * 60 + Number(c.seconds) > 0
  );
}

/** Whether there is anything to compute a first score from. */
export function canSubmitCalibration(sbd: SbdState, entries: readonly CardioEntry[]): boolean {
  return filledLifts(sbd).length > 0 || completeCardioEntries(entries).length > 0;
}

/**
 * Always true, and a function rather than a constant so the intent is testable
 * and cannot be quietly removed: this screen must never be a dead end.
 * Onboarding has already written the profile and set onboarding_completed by
 * the time it renders, so nothing downstream needs a calibration result — the
 * athlete simply starts with no score until their first real session.
 */
export function canSkipCalibration(): boolean {
  return true;
}

export interface CalibrationPayload {
  sbd: Record<string, { weightKg: number; reps: number }>;
  cardio: { sport: SportType; distanceMeters: number; durationSeconds: number }[];
}

/** What gets POSTed to /api/onboarding/calibrate — only what the athlete actually entered. */
export function buildCalibrationPayload(
  sbd: SbdState,
  entries: readonly CardioEntry[]
): CalibrationPayload {
  const lifts: CalibrationPayload["sbd"] = {};
  for (const key of filledLifts(sbd)) {
    lifts[key] = { weightKg: Number(sbd[key].weightKg), reps: Number(sbd[key].reps) };
  }
  return {
    sbd: lifts,
    cardio: completeCardioEntries(entries).map((c) => ({
      sport: c.sport,
      distanceMeters: Number(c.distanceKm) * 1000,
      durationSeconds: Number(c.minutes) * 60 + Number(c.seconds),
    })),
  };
}
