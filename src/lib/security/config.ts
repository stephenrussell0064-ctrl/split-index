/**
 * Every tunable security and plausibility value, in one place.
 *
 * The rule the hardening brief sets is "nothing from this list hard-coded
 * anywhere else in the codebase". The reason is not tidiness: a limit that
 * exists in three files is a limit that disagrees with itself the first time
 * one of them is edited, and a bound nobody can find is a bound nobody revises
 * when the product changes.
 *
 * Every number below carries the reason it is that number. A constant with no
 * justification is a magic number that has been promoted rather than removed.
 *
 * RECONCILED AGAINST THE DATABASE, NOT COPIED FROM THE BRIEF
 * ---------------------------------------------------------
 * Several of these already exist as CHECK constraints in migrations 001 and
 * 002. Where the brief's suggested bound and the shipped constraint disagreed,
 * the constraint won and the difference is noted — a schema that accepts a
 * narrower range than the API validates turns a 400 with a field message into
 * a 500 with a Postgres constraint name, which is the exact failure WP5 is
 * about. The API bound must never be wider than the column's.
 *
 * THERE IS A SECOND SET OF BOUNDS, AND IT IS NOT A MISTAKE
 * -------------------------------------------------------
 * src/lib/scoring/input-guards.ts has its own plausibility limits, and they do
 * not all match these. That is deliberate and the two are not merged here,
 * because they answer different questions:
 *
 *   * These are "could an athlete have entered this", checked at the API
 *     boundary before anything happens, and they reject with a 400 and a field
 *     message.
 *   * The guard's are "can the scoring engine make sense of this", checked
 *     against the athlete's own bodyweight and the exercise's leverage — a
 *     700kg leg press is real and a 700kg bench press is not, which is a
 *     judgement no fixed bound can make.
 *
 * The guard's limits were tuned against real sessions (read the leg-press
 * comment in that file). Rewriting them to match these would reject workouts
 * that actually happened, so they stay where they are. Unifying the pair — one
 * source for the flat bounds, the guard keeping only the relational checks —
 * is worth doing and is recorded as an open finding rather than done blind.
 */

// ── Rate limiting ────────────────────────────────────────────────────────────
// Consumed by src/proxy.ts today. The per-route and per-account limits the
// brief specifies need a shared store to be meaningful on a serverless
// deployment — the current limiter is an in-process Map, which is audit
// finding H3 and belongs to WP4. These two are the ones that exist now.
export const RATE_LIMIT_WINDOW_MS = 60_000;
/** Generous: a logging session legitimately fires a burst of set writes. */
export const RATE_LIMIT_REQUESTS_PER_WINDOW = 60;
/** Signature verification is the control on a webhook; a limiter would only drop real events. */
export const RATE_LIMIT_EXEMPT_PREFIXES = ["/api/stripe/webhook", "/api/cron"] as const;

// ── Payload limits ───────────────────────────────────────────────────────────
/** One session's worth of sets. Above this is an import, not a workout. */
export const MAX_SETS_PER_SESSION = 200;
/** Distinct exercises in one gym session. */
export const MAX_EXERCISES_PER_SESSION = 60;
/** Bytes of JSON accepted on any API route. Roughly 30x the largest real session payload. */
export const MAX_REQUEST_BODY_BYTES = 256 * 1024;
/** Free-text notes, titles, squad names — long enough to be useful, short enough not to be a payload. */
export const MAX_NOTES_LEN = 2_000;
export const MAX_TITLE_LEN = 120;
export const MAX_NAME_LEN = 60;
/** Matches the shipped USERNAME_PATTERN in src/lib/utils/username.ts (3-20). The brief suggested 24; shipped code wins. */
export const MIN_USERNAME_LEN = 3;
export const MAX_USERNAME_LEN = 20;

// ── Plausibility bounds ──────────────────────────────────────────────────────
// Rejected with a 400 and a field-level message, NEVER silently clamped.
// Clamping is the tempting option and the wrong one: the adaptive 1RM walk and
// the fitted Riegel exponent both read the athlete's own history, so a clamped
// value is a fabricated data point that quietly biases every later estimate.
// A rejected value costs one retry; a clamped one corrupts a curve.
//
// Each is [min, max] and inclusive at both ends.

/** Below 25kg is not an adult athlete; above 300kg is outside every reference table the scoring engine has. */
export const BOUND_BODYWEIGHT_KG = [25, 300] as const;
/** 0 allows bodyweight movements to be logged with no external load. The world record total is under 600kg for a single lift. */
export const BOUND_LIFT_LOAD_KG = [0, 600] as const;
/** Above 100 reps in one set is a typo or a different exercise. */
export const BOUND_REPS = [1, 100] as const;
export const BOUND_SETS = [1, 50] as const;
/**
 * Matches activities.avg_heart_rate's CHECK (40..230) rather than the brief's
 * suggested floor of 25. A 25bpm reading is physiologically possible at rest
 * and impossible as a session average, and the column would reject it anyway.
 */
export const BOUND_HR_BPM = [40, 230] as const;
/** profiles.max_hr CHECK (100..230). */
export const BOUND_MAX_HR_BPM = [100, 230] as const;
/** Resting heart rate — not constrained in the schema, so this is the only gate. */
export const BOUND_RESTING_HR_BPM = [25, 120] as const;
/** 500km covers every ultra anyone will log as a single activity. */
export const BOUND_DISTANCE_M = [0, 500_000] as const;
/** 24h. A longer single activity is a tracker that was left running. */
export const BOUND_DURATION_S = [1, 86_400] as const;
/** profiles.age CHECK (13..120). 13 is also the floor for an account. */
export const BOUND_AGE_YEARS = [13, 120] as const;
/** profiles.height_cm is only CHECK (> 0); this is the real bound. */
export const BOUND_HEIGHT_CM = [90, 260] as const;
/** activities.rpe CHECK (1..10). */
export const BOUND_RPE = [1, 10] as const;
/** Every index in this app is 0-999 by construction. */
export const BOUND_INDEX = [0, 999] as const;
/** rMSSD in ms. Outside this is not a heart-rate-variability reading. */
export const BOUND_HRV_MS = [1, 500] as const;
/** sleep_logs.sleep_hours CHECK (0..24). */
export const BOUND_SLEEP_HOURS = [0, 24] as const;
/** Metres of elevation gain in one activity. Everest is 8,849m from sea level. */
export const BOUND_ELEVATION_M = [-500, 12_000] as const;
/** Cycling power. Above 2500W is a track sprinter's peak, not an average. */
export const BOUND_POWER_WATTS = [0, 2_500] as const;
/** Steps or strokes per minute. */
export const BOUND_CADENCE = [0, 300] as const;
/** Degrees Celsius, for logged conditions. */
export const BOUND_TEMPERATURE_C = [-60, 60] as const;

// ── Session and token lifetimes ──────────────────────────────────────────────
// Declared here per the brief so the values are visible and reviewable in one
// place. They are NOT yet applied — Supabase Auth's dashboard settings govern
// today, which is audit finding M7 and belongs to WP13. Listed rather than
// omitted so the next run can tell "decided, not yet enforced" from "never
// considered".
export const SESSION_MAX_AGE_S = 60 * 60 * 24 * 7;
export const REFRESH_ROTATE = true;
export const RESET_TOKEN_TTL_S = 60 * 15;
export const OTP_TTL_S = 60 * 10;
export const OTP_MAX_ATTEMPTS = 5;

// ── Logging retention ────────────────────────────────────────────────────────
// Also declared-not-yet-applied: there is no structured logger to retain
// anything (audit finding H6, WP7). Health-adjacent audit entries keep the
// longer period, which is why these are two numbers and not one.
export const AUDIT_LOG_RETENTION_DAYS = 365;
export const SECURITY_LOG_RETENTION_DAYS = 90;
