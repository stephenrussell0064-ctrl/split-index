/**
 * Apple Health → the onboarding form.
 *
 * HealthKit holds the four things onboarding used to make everyone type:
 * date of birth and biological sex are characteristics the user entered once
 * in the Health app; height and weight are the latest samples. Resting heart
 * rate comes from a watch. All of it is read in one call
 * (`fetchHealthProfile`) after the same permission sheet the workout import
 * already shows.
 *
 * This module is the mapping, kept pure so the bounds can be tested. Anything
 * outside the plausible range is dropped, not clamped: a 9 kg "weight" in
 * Health is a toddler's entry on a shared phone, not a value to round up.
 */

export interface HealthProfileCharacteristics {
  /** `YYYY-MM-DD`, or null when not set or not granted. */
  dateOfBirth: string | null;
  biologicalSex: "male" | "female" | "other" | null;
  heightCm: number | null;
  weightKg: number | null;
  restingHr: number | null;
}

export interface PrefillableFields {
  date_of_birth: string;
  gender: string;
  height_cm: string;
  weight_kg: string;
  resting_hr: string;
}

export const PREFILL_BOUNDS = {
  height_cm: { min: 100, max: 250 },
  weight_kg: { min: 30, max: 300 },
  resting_hr: { min: 30, max: 120 },
} as const;

const DOB_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function inBounds(value: number | null, { min, max }: { min: number; max: number }): value is number {
  return value !== null && Number.isFinite(value) && value >= min && value <= max;
}

/** Round to the precision the profile columns store (one decimal, whole bpm). */
function oneDecimal(n: number): string {
  return (Math.round(n * 10) / 10).toString();
}

/**
 * Fill only the fields the athlete has not already typed into, and say which.
 * `filled` drives the "Filled height, weight and date of birth from Apple
 * Health" line — a prefilled form that does not say it was prefilled looks
 * like a bug.
 */
export function applyHealthProfile<T extends PrefillableFields>(
  form: T,
  data: HealthProfileCharacteristics | null
): { form: T; filled: (keyof PrefillableFields)[] } {
  if (!data) return { form, filled: [] };
  const next = { ...form };
  const filled: (keyof PrefillableFields)[] = [];

  if (!form.date_of_birth && data.dateOfBirth && DOB_PATTERN.test(data.dateOfBirth)) {
    next.date_of_birth = data.dateOfBirth;
    filled.push("date_of_birth");
  }
  if (!form.gender && (data.biologicalSex === "male" || data.biologicalSex === "female")) {
    next.gender = data.biologicalSex;
    filled.push("gender");
  }
  if (!form.height_cm && inBounds(data.heightCm, PREFILL_BOUNDS.height_cm)) {
    next.height_cm = oneDecimal(data.heightCm);
    filled.push("height_cm");
  }
  if (!form.weight_kg && inBounds(data.weightKg, PREFILL_BOUNDS.weight_kg)) {
    next.weight_kg = oneDecimal(data.weightKg);
    filled.push("weight_kg");
  }
  if (!form.resting_hr && inBounds(data.restingHr, PREFILL_BOUNDS.resting_hr)) {
    next.resting_hr = String(Math.round(data.restingHr));
    filled.push("resting_hr");
  }

  return { form: next, filled };
}

const FIELD_WORDS: Record<keyof PrefillableFields, string> = {
  date_of_birth: "date of birth",
  gender: "sex",
  height_cm: "height",
  weight_kg: "weight",
  resting_hr: "resting heart rate",
};

/** "Filled height, weight and date of birth from Apple Health." */
export function describePrefill(filled: (keyof PrefillableFields)[]): string | null {
  if (filled.length === 0) return null;
  const words = filled.map((f) => FIELD_WORDS[f]);
  const list =
    words.length === 1
      ? words[0]
      : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
  return `Filled ${list} from Apple Health.`;
}
