/**
 * The range a date of birth is allowed to imply.
 *
 * 150 was the old ceiling, which let `1900-01-01` resolve to 126 and be
 * accepted everywhere. That is not a hypothetical: age drives the endurance
 * age-grading factor, which divides the benchmark-equivalent time, so the SAME
 * 5 km in 25:00 scored 627 at age 30 and 988 at age 80 — and `date_of_birth`
 * is an ordinary editable profile field while the leaderboards read
 * `sport_index` directly.
 *
 * The ceiling does not stop someone claiming to be 85, and it is not meant to:
 * age-grading a masters athlete is legitimate and standard practice. What it
 * stops is a number no living person has, which the app had no reason to
 * accept and no way to distinguish from a typo.
 */
const MAX_PLAUSIBLE_AGE = 110;
const MIN_PLAUSIBLE_AGE = 0;

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
  return age >= MIN_PLAUSIBLE_AGE && age <= MAX_PLAUSIBLE_AGE ? age : null;
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
