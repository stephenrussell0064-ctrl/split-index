import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import {
  RATE_LIMIT_ACCOUNT_PER_HOUR,
  RATE_LIMIT_EXEMPT_PREFIXES,
  RATE_LIMIT_EXPENSIVE_PER_MIN,
  RATE_LIMIT_LEADERBOARD_PER_MIN,
  RATE_LIMIT_READ_PER_MIN,
  RATE_LIMIT_WRITE_PER_MIN,
} from "./config";

/**
 * WP4 — rate limiting that survives the deployment model.
 *
 * WHAT WAS WRONG
 * --------------
 * The limiter was a `Map` in module scope. On Vercel every serverless instance
 * has its own, instances scale out under exactly the load that matters, and a
 * cold start resets the counter — so the effective limit was 60/min multiplied
 * by however many instances happened to be warm, and an attacker's request
 * distribution across them is not something we control. The comment called it
 * "best-effort per-instance", which was accurate and was the problem.
 *
 * Counts now live in Upstash Redis, shared by every instance.
 *
 * WHY IT FAILS OPEN
 * -----------------
 * If Redis is unreachable, requests are allowed and the failure is logged
 * loudly. That is a deliberate trade and it is the wrong one in some threat
 * models, so here is the reasoning: this limiter guards ordinary application
 * routes, all of which are already behind authentication and row level
 * security. Failing closed would convert an Upstash outage into a total outage
 * of a paid product, which is a self-inflicted incident far more likely than
 * the one it would prevent.
 *
 * The things where failing open WOULD be dangerous — sign-in, OTP, password
 * reset — are not limited here at all. They never reach this origin. See
 * SUPABASE_AUTH_RATE_LIMITS in config.ts.
 *
 * WHY THE IN-MEMORY GUARD SURVIVES
 * --------------------------------
 * It is kept, in proxy.ts, ahead of this. It costs nothing, needs no network,
 * and rejects a pathological flood without a Redis round trip per request. It
 * is not the limit; it is the doorman before the limit.
 */

/** Which bucket a request falls into. Different work deserves different ceilings. */
export type RateLimitClass =
  | "write"
  | "read"
  | "leaderboard"
  | "expensive"
  | "account"
  | "exempt";

export interface RateLimitVerdict {
  allowed: boolean;
  /** Seconds until the caller may retry. Only meaningful when `allowed` is false. */
  retryAfterSeconds: number;
  limit: number;
  remaining: number;
  /** True when the limiter could not reach Redis and allowed the request by default. */
  degraded: boolean;
}

const ALLOWED: RateLimitVerdict = {
  allowed: true,
  retryAfterSeconds: 0,
  limit: Number.POSITIVE_INFINITY,
  remaining: Number.POSITIVE_INFINITY,
  degraded: false,
};

/**
 * Route classification, in order — the first prefix that matches wins, so the
 * specific entries must precede the general ones.
 *
 * Kept as data rather than a chain of ifs so the whole policy can be read at
 * once and tested as a table.
 */
const ROUTE_CLASSES: { prefix: string; cls: RateLimitClass }[] = [
  ...RATE_LIMIT_EXEMPT_PREFIXES.map((prefix) => ({ prefix, cls: "exempt" as const })),

  // Rare by nature, and expensive to get wrong.
  { prefix: "/api/account/delete", cls: "account" },
  { prefix: "/api/profile/ensure", cls: "account" },
  { prefix: "/api/consent/article9", cls: "account" },

  // Walks an athlete's entire history, or generates a whole training block.
  { prefix: "/api/activities/recompute", cls: "expensive" },
  { prefix: "/api/activities/merge", cls: "expensive" },
  { prefix: "/api/hpe/plan", cls: "expensive" },
  { prefix: "/api/reports", cls: "expensive" },
  { prefix: "/api/interference", cls: "expensive" },
  { prefix: "/api/export", cls: "expensive" },
  { prefix: "/api/onboarding/calibrate", cls: "expensive" },

  // Scraping targets.
  { prefix: "/api/social/leaderboard", cls: "leaderboard" },
  { prefix: "/api/social/compare", cls: "leaderboard" },

  // Everything else under /api is classified by method at the call site.
];

const CLASS_LIMITS: Record<Exclude<RateLimitClass, "exempt">, { tokens: number; window: `${number} ${"m" | "h"}` }> = {
  write: { tokens: RATE_LIMIT_WRITE_PER_MIN, window: "1 m" },
  read: { tokens: RATE_LIMIT_READ_PER_MIN, window: "1 m" },
  leaderboard: { tokens: RATE_LIMIT_LEADERBOARD_PER_MIN, window: "1 m" },
  expensive: { tokens: RATE_LIMIT_EXPENSIVE_PER_MIN, window: "1 m" },
  account: { tokens: RATE_LIMIT_ACCOUNT_PER_HOUR, window: "1 h" },
};

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Classify a request.
 *
 * Exported so the policy is testable as a table rather than only through a
 * live limiter — the classification is where a mistake is most likely and
 * least visible.
 */
export function classifyRoute(pathname: string, method: string): RateLimitClass {
  if (!pathname.startsWith("/api/")) return "exempt";

  for (const { prefix, cls } of ROUTE_CLASSES) {
    if (pathname.startsWith(prefix)) return cls;
  }

  return READ_METHODS.has(method.toUpperCase()) ? "read" : "write";
}

let redis: Redis | null | undefined;
const limiters = new Map<string, Ratelimit>();

/** Null when Upstash is not configured, which is the normal state locally. */
function getRedis(): Redis | null {
  if (redis !== undefined) return redis;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  redis = url && token ? new Redis({ url, token }) : null;
  return redis;
}

function limiterFor(cls: Exclude<RateLimitClass, "exempt">): Ratelimit | null {
  const client = getRedis();
  if (!client) return null;

  const existing = limiters.get(cls);
  if (existing) return existing;

  const { tokens, window } = CLASS_LIMITS[cls];
  const limiter = new Ratelimit({
    redis: client,
    // Sliding window rather than fixed: a fixed window lets a caller spend a
    // full allowance at 11:59:59 and another at 12:00:00, which is twice the
    // limit in two seconds at exactly the moment a limit matters.
    limiter: Ratelimit.slidingWindow(tokens, window),
    prefix: `si:rl:${cls}`,
    analytics: false,
  });

  limiters.set(cls, limiter);
  return limiter;
}

/** True when a shared store is configured. False means limits are advisory. */
export function isDistributedLimitingEnabled(): boolean {
  return getRedis() !== null;
}

/**
 * Check one request against its class limit.
 *
 * `identifier` should be the authenticated user id where there is one and the
 * client IP where there is not — per-user is the meaningful unit for a signed-in
 * athlete, and IP is the only thing available for anyone else.
 */
export async function checkRateLimit(
  cls: RateLimitClass,
  identifier: string
): Promise<RateLimitVerdict> {
  if (cls === "exempt") return ALLOWED;

  const limiter = limiterFor(cls);
  if (!limiter) {
    // Not configured. Locally this is normal and silent-by-design would be
    // wrong in production, so proxy.ts warns once rather than per request.
    return { ...ALLOWED, degraded: true };
  }

  try {
    const { success, limit, remaining, reset } = await limiter.limit(identifier);
    return {
      allowed: success,
      // `reset` is an epoch in ms. Always at least 1, because Retry-After: 0
      // reads as "immediately" and invites a tight retry loop.
      retryAfterSeconds: Math.max(1, Math.ceil((reset - Date.now()) / 1000)),
      limit,
      remaining,
      degraded: false,
    };
  } catch (error) {
    // Fail open, loudly. See the module note.
    console.error("[rate-limit] Upstash unreachable — allowing the request", {
      cls,
      cause: error instanceof Error ? error.message : String(error),
    });
    return { ...ALLOWED, degraded: true };
  }
}

/**
 * The 429 body.
 *
 * Says nothing about who was limited or which bucket they hit. "Never leak
 * whether an account exists, in the response body or in the response timing" —
 * a message that varied by identifier would do exactly that, and this path is
 * reachable while unauthenticated.
 */
export function tooManyRequests(retryAfterSeconds: number): Response {
  return new Response(
    JSON.stringify({ error: "Too many requests. Please slow down and try again shortly." }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(retryAfterSeconds),
      },
    }
  );
}
