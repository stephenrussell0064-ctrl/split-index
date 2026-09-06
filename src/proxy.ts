import { NextResponse, type NextRequest } from "next/server";
import { USER_ID_HEADER, updateSession } from "@/lib/supabase/proxy";
import {
  RATE_LIMIT_BURST_PER_WINDOW,
  RATE_LIMIT_WINDOW_MS,
} from "@/lib/security/config";
import {
  checkRateLimit,
  classifyRoute,
  isDistributedLimitingEnabled,
  tooManyRequests,
} from "@/lib/security/rate-limit";

/**
 * WP4 — rate limiting, in two layers.
 *
 * LAYER 1: the in-memory burst guard, unchanged in shape from what was here
 * before. Per-instance and therefore not a real limit — that was the whole
 * finding — but it costs nothing, needs no network, and rejects a pathological
 * flood without spending a Redis round trip on every request. It is the
 * doorman, not the limit, and its ceiling is deliberately loose.
 *
 * LAYER 2: Upstash, in lib/security/rate-limit.ts. Counts shared across every
 * serverless instance, per-route-class ceilings, keyed by the authenticated
 * user where there is one and by IP where there is not.
 *
 * WHY THE USER KEY COMES AFTER updateSession
 * ------------------------------------------
 * Keying by user is the point — one athlete on a train sharing a NAT with a
 * hundred others should not be throttled by their neighbours, and an attacker
 * with a botnet should not get a fresh allowance per IP. But the user id is
 * only trustworthy after `updateSession` has verified the session with
 * Supabase, so the ordering is forced: burst guard, then session, then the real
 * limit. Reading the id out of the cookie ourselves would be faster and would
 * mean a forged cookie could spend somebody else's allowance.
 *
 * WHAT IS NOT LIMITED HERE
 * ------------------------
 * Sign-in, sign-up, OTP and password reset. `createBrowserClient` calls
 * Supabase directly, so those requests never reach this origin. See
 * SUPABASE_AUTH_RATE_LIMITS in lib/security/config.ts for the values to set in
 * the dashboard, and why one mechanism is better than two that disagree.
 */

const burstHits = new Map<string, { count: number; resetAt: number }>();

function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

function isBursting(ip: string): boolean {
  const now = Date.now();
  const entry = burstHits.get(ip);

  if (!entry || now > entry.resetAt) {
    burstHits.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }

  entry.count += 1;
  if (burstHits.size > 5000) {
    for (const [key, val] of burstHits) {
      if (now > val.resetAt) burstHits.delete(key);
    }
  }
  return entry.count > RATE_LIMIT_BURST_PER_WINDOW;
}

/**
 * Warn once per instance rather than per request when the shared store is
 * missing. Locally that is the normal state and the noise would be constant;
 * in production it means the limits are advisory and somebody needs to know,
 * which one line per cold start says adequately.
 */
let warnedAboutMissingStore = false;
function warnIfAdvisoryOnly(): void {
  if (warnedAboutMissingStore || isDistributedLimitingEnabled()) return;
  warnedAboutMissingStore = true;
  if (process.env.NODE_ENV === "production") {
    console.warn(
      "[rate-limit] UPSTASH_REDIS_REST_URL/TOKEN are not set. Per-user limits " +
        "are not being enforced; only the per-instance burst guard applies."
    );
  }
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const method = request.method;
  const cls = classifyRoute(pathname, method);

  if (cls !== "exempt") {
    const ip = clientIp(request);

    // Layer 1 — free, no network, catches the pathological case.
    if (isBursting(ip)) {
      return tooManyRequests(Math.ceil(RATE_LIMIT_WINDOW_MS / 1000));
    }
  }

  // Session first, so the real limit can be keyed by a VERIFIED user id.
  const sessionResponse = await updateSession(request);

  /*
   * Read and strip the internal user header FIRST, unconditionally.
   *
   * updateSession sets it on every authenticated request, including the exempt
   * and redirect paths below. Stripping it only on the path that happens to
   * use it would send an athlete's user id to the browser on every webhook,
   * cron call and login redirect — an internal detail escaping through the one
   * branch nobody was looking at.
   */
  const identifier = takeUserId(sessionResponse) ?? `ip:${clientIp(request)}`;

  /*
   * A redirect from updateSession is an auth decision — signed out of a
   * protected page, or signed in and bounced off /login. The PER-USER limit has
   * nothing to add to it, and charging for it would help a redirect loop lock
   * an athlete out of the login page they are being sent to.
   *
   * The burst guard above has already run and does count these, deliberately:
   * a client hammering a protected page is a flood whether or not it is signed
   * in. The two layers differ here on purpose.
   */
  if (cls === "exempt" || sessionResponse.status >= 300) {
    return sessionResponse;
  }

  warnIfAdvisoryOnly();

  // Layer 2 — the real limit.
  const verdict = await checkRateLimit(cls, identifier);

  if (!verdict.allowed) {
    return tooManyRequests(verdict.retryAfterSeconds);
  }

  return sessionResponse;
}

/**
 * Take the verified user id off the response, removing it as we go.
 *
 * Named `take` rather than `get` because the removal is the important half: a
 * user id echoed to the browser is a user id somebody eventually starts
 * relying on.
 */
function takeUserId(response: NextResponse): string | null {
  const id = response.headers.get(USER_ID_HEADER);
  if (!id) return null;
  response.headers.delete(USER_ID_HEADER);
  return `user:${id}`;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
