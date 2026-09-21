import "server-only";

import { logSecurityEvent } from "@/lib/observability/security-log";
import { correlationId } from "@/lib/api/errors";

/**
 * M6 — the scheduled jobs authenticate by header, and only by header.
 *
 * WHAT WAS WRONG
 * --------------
 * Both cron routes carried their own copy of this:
 *
 *   const secret =
 *     searchParams.get("secret") ??
 *     request.headers.get("authorization")?.replace("Bearer ", "");
 *
 * A secret in a query string is a secret in the access log. It is also in the
 * proxy log, in any error report that captures the request URL, in the browser
 * history if anyone ever pastes the URL into a browser, and in the `Referer`
 * header of anything the response links to. Rotating `CRON_SECRET` is cheap;
 * knowing whether it leaked, once it is spread across four log stores with
 * different retention, is not.
 *
 * Nothing asked for the query parameter. `.env.example:32` and `README.md:265`
 * both document `Authorization: Bearer $CRON_SECRET` and nothing else, Vercel
 * Cron sends exactly that header on its own, and no scheduler config, script or
 * document in this repository references `?secret=`. It was an undocumented
 * fallback that undid the documented mechanism.
 *
 * FAILING CLOSED, LOUDLY
 * ----------------------
 * A caller still using the query parameter now gets a 401, which is the correct
 * answer and an unhelpful one on its own — a scheduled job that quietly stops
 * running looks like nothing at all until somebody notices a stale leaderboard.
 * So a request carrying `?secret=` is recorded as a security event before it is
 * refused, with the parameter's VALUE never touched. That turns a silent
 * breakage into a line in the log that says what to change.
 *
 * WHY THE COMPARISON IS CONSTANT-TIME
 * -----------------------------------
 * Marginal over a network, and the audit said so. It is two lines, it removes a
 * class of argument rather than a measured risk, and the alternative is
 * explaining every year why the obvious `===` is fine here.
 */

/**
 * Length-independent, content-independent comparison.
 *
 * Deliberately not `crypto.timingSafeEqual`: that throws when the two buffers
 * differ in length, so guarding it with a length check leaks the length anyway
 * and the throw becomes its own branch to get wrong. Comparing a fixed number
 * of characters with XOR accumulation leaks neither.
 */
function constantTimeEquals(a: string, b: string): boolean {
  const length = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < length; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

/** The bearer token, or null when the header is absent or malformed. */
function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;

  /*
   * Anchored, and case-insensitive on the scheme.
   *
   * The old code used `.replace("Bearer ", "")`. Being exact about what that
   * cost, because it is easy to overstate and I did on the first draft: it was
   * NOT a bypass. `xBearer <token>` became `x<token>` and failed to match, so
   * it was refused. Measured, the whole difference is requests it should have
   * ACCEPTED and did not — `bearer <token>` lowercased, which HTTP explicitly
   * permits since the scheme token is case-insensitive, and `Bearer  <token>`
   * with two spaces, which becomes a token with a leading space.
   *
   * So this is a correctness fix wearing security clothing. It is here because
   * the function was being rewritten anyway, not because it was letting anyone
   * in.
   */
  const match = /^Bearer[ ]+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

/**
 * Whether a request is a genuine scheduled invocation.
 *
 * Returns false when `CRON_SECRET` is unset. That is the important half: an
 * unset variable must not make a job that walks every athlete's data public.
 * The previous code got this right too, via `&& !!process.env.CRON_SECRET`, and
 * it is restated here because it is the one branch where a refactor is
 * catastrophic rather than merely wrong.
 */
export function verifyCronRequest(request: Request, source: string): boolean {
  const expected = process.env.CRON_SECRET;

  const url = new URL(request.url);
  if (url.searchParams.has("secret")) {
    /*
     * The value is never read and never logged. Recording that the shape was
     * used is the whole point; recording what was in it would put the secret in
     * the log this change exists to keep it out of.
     */
    logSecurityEvent({
      type: "auth.failure",
      correlationId: correlationId(),
      source,
      outcome: "denied",
      retention: "audit",
      detail: {
        reason: "cron_secret_in_query_string",
        action:
          "This caller must send Authorization: Bearer $CRON_SECRET instead. " +
          "The query parameter was removed in M6 because it writes the secret " +
          "into access, proxy and error logs.",
      },
    });
  }

  if (!expected) {
    logSecurityEvent({
      type: "auth.failure",
      correlationId: correlationId(),
      source,
      outcome: "denied",
      retention: "audit",
      detail: { reason: "cron_secret_not_configured" },
    });
    return false;
  }

  const presented = bearerToken(request);
  if (!presented) return false;

  return constantTimeEquals(presented, expected);
}

export const __testing = { constantTimeEquals, bearerToken };
