/**
 * Age from a date of birth. We store the raw date_of_birth (so age stays
 * accurate over time) and derive age wherever it's needed — the scoring
 * engine, max-HR estimates, etc. — rather than persisting a snapshot that
 * silently goes stale.
 *
 * Accepts a `YYYY-MM-DD` string (the HTML date-input / Postgres DATE format)
 * or a Date. Returns null for missing/unparseable input so callers can fall
 * back to a stored `age` column for legacy profiles with no DOB on file.
 */
export function ageFromDateOfBirth(
  dob: string | Date | null | undefined,
  now: Date = new Date()
): number | null {
  if (!dob) return null;
  const birth = typeof dob === "string" ? new Date(dob) : dob;
  if (!(birth instanceof Date) || Number.isNaN(birth.getTime())) return null;

  let age = now.getFullYear() - birth.getFullYear();
  const monthDiff = now.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birth.getDate())) {
    age -= 1;
  }
  return age >= 0 && age <= 150 ? age : null;
}

/** Latest date of birth allowed for a given minimum age (for a date input's `max`). */
export function maxDobForMinAge(minAge: number, now: Date = new Date()): string {
  const d = new Date(now.getFullYear() - minAge, now.getMonth(), now.getDate());
  return d.toISOString().slice(0, 10);
}

/** Earliest date of birth allowed for a given maximum age (for a date input's `min`). */
export function minDobForMaxAge(maxAge: number, now: Date = new Date()): string {
  const d = new Date(now.getFullYear() - maxAge, now.getMonth(), now.getDate());
  return d.toISOString().slice(0, 10);
}
