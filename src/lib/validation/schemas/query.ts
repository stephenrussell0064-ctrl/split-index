import { z } from "@/lib/validation/boundary";
import { sportSchema } from "@/lib/validation/schemas/activity";

/**
 * N1 — the read routes' query parameters.
 *
 * TWO RULES THAT ARE THE OPPOSITE OF THE BODY SCHEMAS, AND BOTH MATTER
 *
 * 1. NOT `.strict()`. A body with an unknown key means the caller and the
 *    server disagree about a contract. A URL with an unknown key means somebody
 *    shared a link: `utm_source`, `fbclid`, `gclid` and friends are appended by
 *    mail clients, ad platforms and social apps to URLs nobody controls.
 *    Rejecting those would turn a shared logbook link into a 400, so unknown
 *    query keys are ignored exactly as they were before.
 *
 * 2. Bad values FALL BACK rather than reject, wherever the route already had a
 *    default. `Number(searchParams.get("limit")) || LOGBOOK_PAGE_SIZE` answers a
 *    junk limit with the page size, and a schema that started returning 400
 *    instead would break a link that works today. `.catch()` keeps that
 *    behaviour and fixes what was wrong with it.
 *
 * WHAT WAS ACTUALLY WRONG, since "no schema" undersells it again:
 *
 *   `Number(x) || DEFAULT` treats 0 as absent — so `?limit=0` silently became a
 *   full page — and passes NEGATIVES straight through, because -5 is truthy.
 *   `?limit=-5` reached the query builder.
 *
 *   `social/compare` did `Number(searchParams.get("days") ?? 30)` with no `||`
 *   at all, so `?days=abc` produced NaN and NaN reached a date computation.
 *
 *   `searchParams.get("sport") as SportType` is the same type assertion the
 *   body routes had: any string reached a query filter.
 *
 * Ids are the exception to rule 2 and DO reject. A malformed uuid in a WHERE
 * clause is a Postgres cast error, not a miss — so the honest answer is a 400
 * that names the parameter rather than a 500 from the driver.
 */

/** A uuid path/query parameter. Rejects, because a bad one cannot succeed later. */
export const idParam = z.string().uuid("That is not a valid id.");

/**
 * A bounded integer with a fallback.
 *
 * `z.coerce.number()` turns "" into 0 and "abc" into NaN; both then fail the
 * bounds and land on `fallback`, which is what the old `|| DEFAULT` did for
 * junk and did NOT do for negatives or for an explicit zero.
 */
export function intParam(fallback: number, min: number, max: number) {
  return z.coerce
    .number()
    .int()
    .min(min)
    .max(max)
    .catch(fallback);
}

/**
 * A bounded integer that CLAMPS, mirroring `Math.min(max, Math.max(min, ...))`.
 *
 * Several routes clamp rather than default, and the difference is visible:
 * `?days=500` currently answers with 365, and a schema that fell back to 30
 * instead would quietly change what a bookmarked link returns. Where the route
 * clamps, this clamps.
 */
export function clampedIntParam(fallback: number, min: number, max: number) {
  return z.coerce
    .number()
    .catch(fallback)
    .transform((v) => {
      if (!Number.isFinite(v) || v === 0) return fallback;
      return Math.min(max, Math.max(min, Math.round(v)));
    });
}

/** An optional enum that falls back to the route's existing default. */
export function enumParam<const T extends readonly [string, ...string[]]>(
  values: T,
  fallback: T[number]
): z.ZodCatch<z.ZodEnum<{ [K in T[number]]: K }>> {
  return z.enum(values).catch(fallback as never) as never;
}

// ─── Logbook and recent ─────────────────────────────────────────────────────

/*
 * Factories rather than constants, so each route passes its OWN default —
 * LOGBOOK_PAGE_SIZE, DEFAULT_LIMIT, DEFAULT_WINDOW_DAYS. Restating those
 * numbers here would be a second set of values to drift, which is the N2
 * mistake this pass has already nearly made once.
 *
 * `zone` and `sort` stay loose strings on purpose: `parseZone` and `parseSort`
 * in logbook-query.ts already map anything unrecognised to "all" and "recent",
 * and they are what the handler calls. Duplicating those rules here would give
 * two answers to the same question.
 */
export function logbookQuerySchema(pageSize: number, maxLimit = 100) {
  return z.object({
    /*
      A loose string, NOT sportSchema — and this is the trap in this file.

      The logbook filters against `SPORTS` from constants/sports.ts, which
      carries `all`, `legs`, `arms`, `chest`, `back`, `core` and `shoulders`
      alongside the nine real sports: it is the FILTER catalog, not the sport
      enum. `sportSchema` is the nine, so putting it here would have started
      answering `?sport=all` with a 400 — the logbook's default view.

      The route keeps its own `SPORTS.some(...)` check, for the same reason
      `zone` and `sort` keep parseZone and parseSort: the catalog is the
      authority and a second copy here would give two answers.
    */
    sport: z.string().optional(),
    zone: z.string().optional(),
    sort: z.string().optional(),
    offset: clampedIntParam(0, 0, 100_000),
    /*
      The one deliberate behaviour change in this file. `Number(x) ||
      LOGBOOK_PAGE_SIZE` had no upper bound at all, so `?limit=100000` was
      passed to the query builder as written. It is capped now.
    */
    limit: clampedIntParam(pageSize, 1, maxLimit),
  });
}

export function recentQuerySchema(defaultLimit: number, maxLimit = 20) {
  return z.object({
    // Was `searchParams.get("sport") as SportType` — an assertion, so any
    // string reached the query filter. The handler still rejects an absent one.
    sport: sportSchema,
    limit: clampedIntParam(defaultLimit, 1, maxLimit),
  });
}

/**
 * The draft routes' sport filter.
 *
 * Optional on GET (absent means "every draft"), required on DELETE — the
 * handler still enforces that difference, because "which drafts" and "delete
 * which draft" are different questions about the same parameter.
 */
export const draftQuerySchema = z.object({ sport: sportSchema.optional() });

export const offsetQuerySchema = z.object({ offset: clampedIntParam(0, 0, 100_000) });

// ─── Single-id lookups ──────────────────────────────────────────────────────

export const idQuerySchema = z.object({ id: idParam });
export const userIdQuerySchema = z.object({ userId: idParam });
export const commentIdQuerySchema = z.object({ commentId: idParam });

// ─── Everything else ────────────────────────────────────────────────────────

export const exportQuerySchema = z.object({
  format: enumParam(["json", "csv"], "json"),
});

export const reportPeriodQuerySchema = z.object({
  period: enumParam(["monthly", "quarterly"], "monthly"),
});

export function windowDaysQuerySchema(defaultDays: number) {
  // Clamped, not defaulted: `?days=500` answered 365 before and still does.
  return z.object({ days: clampedIntParam(defaultDays, 7, 365) });
}

export const compareQuerySchema = z.object({
  // One of the two identifies the other athlete; the handler decides which,
  // and still rejects the request when neither is given.
  username: z.string().trim().min(1).max(32).optional(),
  userId: idParam.optional(),
  days: clampedIntParam(30, 1, 365),
  metric: enumParam(["split", "endurance", "strength"], "split"),
});

export const usernameCheckQuerySchema = z.object({
  // Deliberately loose: this endpoint's whole job is to answer "is this
  // available", and the format rules live in validateUsernameFormat, which the
  // handler calls. A schema that rejected a malformed username would stop the
  // form telling the athlete WHY it is malformed.
  u: z.string().trim().max(64).optional().catch(undefined),
});

export const gymHistoryQuerySchema = z.object({
  name: z.string().trim().min(1, "Which exercise?").max(80),
});
