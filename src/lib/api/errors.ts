import { NextResponse } from "next/server";

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
const UNIQUE_VIOLATION_MESSAGES: Record<string, string> = {
  profiles_username_key: "That username is taken.",
  profiles_user_id_key: "That profile already exists.",
  profiles_stripe_customer_id_key: "That billing account is already linked.",
  activities_user_id_source_external_id_key:
    "That session has already been imported.",
  activity_reactions_activity_id_user_id_key: "You have already scored this session.",
  squad_members_squad_id_user_id_key: "You are already in that squad.",
  friends_user_id_friend_id_key: "You are already connected to that athlete.",
  leaderboard_entries_period_period_start_user_id_key:
    "That leaderboard entry already exists.",
  hpe_intake_pkey: "Your intake answers already exist.",
};

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
 * Turn a database error into a message it is safe to send.
 *
 * Returns null when there is nothing specific to say, which the caller turns
 * into a generic 500. Never returns any part of `error.message`.
 */
export function safeDatabaseMessage(error: DatabaseErrorLike): string | null {
  if (error.code === "23505") {
    // The constraint name appears in `details` or `message`; we only ever read
    // it to look up OUR mapping, and never pass either string on.
    const haystack = `${error.message ?? ""} ${error.details ?? ""}`;
    for (const [constraint, message] of Object.entries(UNIQUE_VIOLATION_MESSAGES)) {
      if (haystack.includes(constraint)) return message;
    }
    return "That already exists.";
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
    return NextResponse.json({ error: specific, ref }, { status: 409 });
  }

  return serverError({ ...options, cause: error });
}
