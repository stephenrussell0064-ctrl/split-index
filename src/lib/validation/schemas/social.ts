import { numberFields, text, z } from "@/lib/validation/boundary";
import type { DuelMetric } from "@/lib/social/types";
import type { SportType } from "@/types";

/**
 * N1 — schemas for the routes that carry one athlete's words to another.
 *
 * These routes were not unchecked. Each had ad-hoc guards that mostly worked,
 * and the ways they did not are worth naming, because "mostly" is exactly what
 * a schema is for:
 *
 *   `String(body.name ?? "")` — an object becomes "[object Object]", an array
 *   becomes its comma-joined contents, and both then pass a non-empty check and
 *   get stored. A schema asks whether the value IS a string rather than what it
 *   looks like once coerced into one.
 *
 *   `.slice(0, MAX_NAME_LENGTH)` — silently truncates. Somebody who types a long
 *   squad name gets a shorter one back with no explanation. Rejecting with a
 *   field-level message is not stricter, it is more honest.
 *
 *   Clamping and defaulting — `days` clamped into range, `metric` and `sport`
 *   silently replaced when unrecognised. That accepts a malformed request and
 *   invents an answer, so a client bug looks like a working feature until
 *   somebody notices their duel is the wrong length.
 *
 * `.strict()` throughout: an unknown key means the caller and the server
 * disagree about the contract, and the useful moment to discover that is now.
 *
 * EVERY LIMIT HERE IS THE ONE THAT ALREADY SHIPPED. The first draft of this
 * file invented its own — 500 characters for a comment, 50 for a squad name —
 * against the 1000 and 40 the routes were using. That would have created a
 * second set of bounds disagreeing with the first, which is finding N2 in this
 * very audit, introduced by the fix for N1. The constants move here so there is
 * one definition, and the routes import them.
 */

/** Was `MAX_COMMENT_LENGTH` in the comments route. */
export const MAX_COMMENT_LENGTH = 1000;
/** Was `MAX_NAME_LENGTH` in the squads route. */
export const MAX_SQUAD_NAME_LENGTH = 40;

/*
 * These four lived inside the duels route, where a schema could not reach them
 * without importing a route module. They move here so the validator and the
 * handler cannot disagree about what a valid duel is — which was already
 * possible, since the handler clamped `days` to a range the caller was never
 * told about.
 */
export const DUEL_METRICS: DuelMetric[] = ["sessions", "load", "speed", "strength"];
export const DUEL_SPORTS: SportType[] = [
  "running",
  "walking",
  "swimming",
  "rowing",
  "bike_erg",
  "indoor_cycling",
  "outdoor_cycling",
  "ski_erg",
  "gym",
];
export const MIN_DURATION_DAYS = 1;
export const MAX_DURATION_DAYS = 30;
export const DEFAULT_DURATION_DAYS = 7;

/** A comment on a session. */
export const commentSchema = z
  .object({
    body: text(MAX_COMMENT_LENGTH, "Comment").min(1, "Comment can't be empty."),
  })
  .strict();

/** A new squad. */
export const createSquadSchema = z
  .object({
    name: text(MAX_SQUAD_NAME_LENGTH, "Squad name").min(1, "Squad name is required."),
  })
  .strict();

/** Joining a squad by its invite code. */
export const joinSquadSchema = z
  .object({
    // Codes are generated, never typed from memory, so the shape is known and
    // there is no reason to accept anything else into a lookup.
    inviteCode: z
      .string({ message: "An invite code is required." })
      .trim()
      .min(4, "That invite code is too short.")
      .max(32, "That invite code is too long."),
  })
  .strict();

/** A challenge between two athletes. */
export const createDuelSchema = z
  .object({
    friendId: z.string().uuid("Choose an athlete to challenge."),
    metric: z
      .enum(DUEL_METRICS as unknown as [string, ...string[]], {
        message: "Choose something to compete on.",
      })
      .optional(),
    sport: z
      .enum(DUEL_SPORTS as unknown as [string, ...string[]], {
        message: "That is not a sport we track.",
      })
      .nullable()
      .optional(),
    // Bounded rather than clamped. A request for a 900-day duel is a bug
    // somewhere, and answering it with a 30-day duel hides the bug.
    days: z
      .number({ message: "Enter a number of days." })
      .int("Days must be a whole number.")
      .min(MIN_DURATION_DAYS, `A duel runs for at least ${MIN_DURATION_DAYS} days.`)
      .max(MAX_DURATION_DAYS, `A duel runs for at most ${MAX_DURATION_DAYS} days.`)
      .optional(),
  })
  .strict();

/**
 * A single HRV reading.
 *
 * `numberFields.hrvMs` is BOUND_HRV_MS, [1, 500], which is exactly the range
 * the route already enforced by hand (`> 0 && <= 500`). Checked before
 * switching: a schema that quietly widened or narrowed a plausibility bound
 * would be a worse outcome than the ad-hoc check it replaced.
 */
export const hrvSchema = z
  .object({
    hrvMs: numberFields.hrvMs,
  })
  .strict();

/**
 * The athlete's time zone.
 *
 * The route already rejects an unknown zone, and for a good reason recorded
 * there: `Intl.DateTimeFormat` throws on one, and a single bad POST used to
 * 500 the athlete's own dashboard permanently. This adds what a hand-rolled
 * check cannot — a body size cap and refusal of unknown keys — and leaves the
 * zone lookup itself where it is, because `isValidTimezone` asks the runtime
 * and a regex would only approximate it.
 */
export const timezoneSchema = z
  .object({
    timezone: z.string({ message: "Time zone must be text." }).trim().max(64),
  })
  .strict();
