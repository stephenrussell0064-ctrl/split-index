import { NextResponse } from "next/server";
import { logSecurityEvent } from "@/lib/observability/security-log";
import {
  UNIQUE_VIOLATION,
  uniqueViolationMessage,
} from "@/lib/api/unique-violations";

/**
 * WP5 — one place where a server-side failure becomes a response.
 *
 * WHAT WAS WRONG
 * --------------
 * Twenty-three route files did this:
 *
 *   if (error) return NextResponse.json({ error: error.message }, { status: 500 });
 *
 * `error.message` from PostgREST is not a sentence written for an athlete. It
 * carries the constraint that failed, the column, sometimes the value, and
 * enough of the schema shape to map the backend from the outside. One route
 * interpolated it into a message that also named the table being purged.
 *
 * THE TRADE THIS MAKES
 * --------------------
 * The detail is genuinely useful — to us. So it is not discarded, it is moved:
 * the client gets a sentence and a correlation ID, the server log gets the same
 * ID with everything else attached. "Something went wrong (ref a3f9c2e1)" is a
 * support conversation that can actually be resolved; a constraint name in a
 * toast is neither useful to the athlete nor safe.
 *
 * WHAT IS NOT GENERIC
 * -------------------
 * A unique violation on a username is not a server error and must not read like
 * one — "that username is taken" is the truth, it is actionable, and it reveals
 * nothing the signup form would not tell you anyway. Known constraint failures
 * are mapped to real sentences; everything else is generic. Mapping by
 * CONSTRAINT NAME rather than by parsing the message text, because the text is
 * a Postgres implementation detail and the constraint name is ours.
 */

/**
 * A short, readable, unguessable-enough id shared between the response and the
 * log line. Not a security token: it exists so a person can quote it, so it is
 * short enough to read down a phone.
 */
export function correlationId(): string {
  return Math.random().toString(16).slice(2, 10);
}

export const GENERIC_ERROR_MESSAGE =
  "Something went wrong on our side. Please try again in a moment.";

/** The shape PostgREST hands back. Narrowed rather than imported to keep this dependency-free. */
export interface DatabaseErrorLike {
  message?: string;
  code?: string;
  details?: string | null;
  hint?: string | null;
}

/**
 * Constraint name → what to tell the athlete.
 *
 * Keyed on the constraint because that is a name this repository chose and can
 * grep for. Matching on message text would break the first time Postgres
 * rewords an error, and would silently fall through to a generic message
 * rather than failing loudly.
 */

/** Postgres SQLSTATEs worth distinguishing from "something went wrong". */
const CODE_MESSAGES: Record<string, string> = {
  // Foreign key violation — pointing at something that is gone.
  "23503": "That no longer exists. Refresh and try again.",
  // Check constraint — a value the schema refuses. WP3's boundary validation
  // should catch these first; reaching here means one slipped past a schema.
  "23514": "One of those values is outside what we can store.",
  // Not-null violation.
  "23502": "Something required was missing. Please try again.",
  // Insufficient privilege — an RLS policy said no.
  "42501": "You do not have access to that.",
};

/**
 * The status that matches what actually happened.
 *
 * `databaseError` used to answer 409 for every recognised code, which is right
 * for the unique violation it was written around and wrong for the rest. A
 * permission denial in particular is neither a conflict nor a server fault: RLS
 * did exactly its job, and answering 409 — or worse, letting it fall through to
 * a 500 — makes the error dashboard lie in the opposite direction from the one
 * the 409 was introduced to fix.
 *
 * 409 stays the default so anything unlisted behaves as it did before.
 */
const CODE_STATUS: Record<string, number> = {
  // An RLS policy refused the row. The caller is authenticated but not allowed.
  "42501": 403,
  // Pointing at a row that is gone.
  "23503": 409,
  // Values the schema refuses: the request is malformed, not conflicting.
  "23514": 400,
  "23502": 400,
  // Unique violation — the case this helper was written for.
  "23505": 409,
};

/**
 * Turn a database error into a message it is safe to send.
 *
 * Returns null when there is nothing specific to say, which the caller turns
 * into a generic 500. Never returns any part of `error.message`.
 */
export function safeDatabaseMessage(error: DatabaseErrorLike): string | null {
  if (error.code === UNIQUE_VIOLATION) {
    // Shared with the browser path, so the same conflict cannot produce two
    // different answers depending on which client wrote the row. The helper
    // reads the constraint NAME and discards the error text, which carries the
    // conflicting value.
    return uniqueViolationMessage(error);
  }

  return error.code ? (CODE_MESSAGES[error.code] ?? null) : null;
}

interface FailOptions {
  /** What the user was trying to do, for the log line. "saving a session". */
  operation: string;
  /** The underlying error. Logged, never returned. */
  cause?: unknown;
  /** Extra context for the log. Must not contain health data or tokens — see WP7. */
  context?: Record<string, unknown>;
  status?: number;
}

/**
 * The one way an API route reports a server-side failure.
 *
 * Logs the full detail against a correlation id and returns a response that
 * carries the id and nothing else.
 */
export function serverError({
  operation,
  cause,
  context,
  status = 500,
}: FailOptions): NextResponse {
  const ref = correlationId();

  /*
   * WP7 — every 5xx is a security event, and the structured record is what an
   * alert or a log drain can actually group on.
   *
   * The stack trace stays on a separate console.error rather than going into
   * the structured record: a stack is unbounded free text and the one place a
   * health value could realistically arrive in a log line is inside a message
   * from a failed write to hpe_intake. The structured record carries the
   * operation and the correlation id, which is what an alert needs; the stack
   * carries the detail, which is what a person needs, and only one of those has
   * to be safe to aggregate.
   */
  logSecurityEvent({
    type: "server_error",
    correlationId: ref,
    source: operation,
    outcome: "error",
    detail: { status },
  });

  console.error(`[api] ${operation} failed`, {
    ref,
    ...context,
    // Stringified here rather than passed raw so a logger that serialises
    // objects cannot decide to include something unexpected.
    cause: cause instanceof Error ? cause.stack : JSON.stringify(cause ?? null),
  });

  return NextResponse.json(
    { error: `${GENERIC_ERROR_MESSAGE} (ref ${ref})`, ref },
    { status }
  );
}

/**
 * Report a database failure: a real sentence when the constraint is one we
 * know, a generic 500 with a correlation id when it is not.
 *
 * A recognised constraint returns 409 rather than 500 — "that username is
 * taken" is a conflict the caller can resolve, not a server fault, and
 * reporting it as 5xx makes error dashboards lie.
 */
export function databaseError(
  error: DatabaseErrorLike,
  options: Omit<FailOptions, "cause" | "status">
): NextResponse {
  const specific = safeDatabaseMessage(error);

  if (specific) {
    // Still logged: a spike in unique violations is a real signal, and the
    // correlation id keeps the response tied to it.
    const ref = correlationId();
    console.warn(`[api] ${options.operation} rejected`, {
      ref,
      code: error.code,
      ...options.context,
    });
    return NextResponse.json(
      { error: specific, ref },
      { status: (error.code && CODE_STATUS[error.code]) || 409 }
    );
  }

  return serverError({ ...options, cause: error });
}
