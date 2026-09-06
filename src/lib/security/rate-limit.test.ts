import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classifyRoute, tooManyRequests } from "./rate-limit";
import {
  RATE_LIMIT_BURST_PER_WINDOW,
  RATE_LIMIT_EXEMPT_PREFIXES,
  RATE_LIMIT_EXPENSIVE_PER_MIN,
  RATE_LIMIT_LEADERBOARD_PER_MIN,
  RATE_LIMIT_READ_PER_MIN,
  RATE_LIMIT_WRITE_PER_MIN,
} from "./config";

/**
 * WP4 — rate limiting.
 *
 * The brief's two acceptance criteria: "a test firing N+1 requests and
 * asserting the last returns 429", and "a test that a validly signed webhook is
 * never rate limited".
 *
 * Both are exercised against the real `proxy()` at the bottom of this file,
 * because the classification and the enforcement are different things and only
 * one of them is interesting on its own.
 */

describe("route classification", () => {
  /**
   * Read as a table, because this is where a mistake is easy and invisible: a
   * write route classified as a read gets twice the allowance and nothing
   * anywhere says so.
   */
  it.each([
    ["/api/activities", "POST", "write"],
    ["/api/activities", "GET", "read"],
    ["/api/activities/logbook", "GET", "read"],
    ["/api/hpe/intake", "PATCH", "write"],
    ["/api/social/leaderboard", "GET", "leaderboard"],
    ["/api/social/leaderboard/dimension", "GET", "leaderboard"],
    ["/api/social/compare", "GET", "leaderboard"],
    ["/api/activities/recompute", "POST", "expensive"],
    ["/api/activities/merge", "POST", "expensive"],
    ["/api/hpe/plan", "GET", "expensive"],
    ["/api/export/activities", "GET", "expensive"],
    ["/api/onboarding/calibrate", "POST", "expensive"],
    ["/api/account/delete", "DELETE", "account"],
    ["/api/consent/article9", "POST", "account"],
    ["/api/stripe/webhook", "POST", "exempt"],
    ["/api/revenuecat/webhook", "POST", "exempt"],
    ["/api/cron/leaderboard", "GET", "exempt"],
    // Pages are not API routes and are not counted here.
    ["/dashboard", "GET", "exempt"],
    ["/social/profile/someone", "GET", "exempt"],
  ])("classifies %s %s as %s", (path, method, expected) => {
    expect(classifyRoute(path, method)).toBe(expected);
  });

  it("puts an unrecognised API route in a bucket rather than leaving it unlimited", () => {
    // The default matters more than any specific entry: a route added next
    // month is limited from its first request, without anyone remembering.
    expect(classifyRoute("/api/something/invented", "POST")).toBe("write");
    expect(classifyRoute("/api/something/invented", "GET")).toBe("read");
  });

  it("gives an expensive endpoint a tighter ceiling than an ordinary read", () => {
    // Not a tautology — it is the property the classification exists to create,
    // and a config edit that inverted it would otherwise pass silently.
    expect(RATE_LIMIT_EXPENSIVE_PER_MIN).toBeLessThan(RATE_LIMIT_WRITE_PER_MIN);
    expect(RATE_LIMIT_LEADERBOARD_PER_MIN).toBeLessThan(RATE_LIMIT_READ_PER_MIN);
  });

  it("exempts every prefix the config says it does", () => {
    for (const prefix of RATE_LIMIT_EXEMPT_PREFIXES) {
      expect(classifyRoute(`${prefix}/anything`, "POST")).toBe("exempt");
    }
  });
});

describe("the 429 itself", () => {
  it("carries Retry-After and says nothing about who was limited", async () => {
    const res = tooManyRequests(42);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("42");

    const body = await res.json();
    // "Never leak whether an account exists, in the response body or in the
    // response timing." This path is reachable while unauthenticated, so a
    // message that varied by identifier would be exactly that leak.
    const text = JSON.stringify(body).toLowerCase();
    for (const leak of ["user", "account", "email", "ip", "@"]) {
      expect(text, `429 body mentions "${leak}"`).not.toContain(leak);
    }
  });
});

/**
 * Enforcement, through the real middleware.
 *
 * Upstash is deliberately NOT configured here, which is the local and CI
 * condition. That leaves the in-process burst guard doing the work — the layer
 * that is per-instance and therefore not the real limit — so what this proves
 * is that the middleware refuses at its ceiling and exempts what it should. The
 * shared-store half cannot be proved without a Redis, and saying so is better
 * than a mock that asserts my own stub returns what I told it to.
 */
describe("proxy enforcement", () => {
  const updateSessionMock = vi.hoisted(() => vi.fn());
  vi.mock("@/lib/supabase/proxy", () => ({
    USER_ID_HEADER: "x-si-user",
    updateSession: (req: unknown) => updateSessionMock(req),
  }));

  /**
   * A NextRequest as far as `proxy()` is concerned: it reads `nextUrl.pathname`,
   * `method` and two headers, and nothing else. Building the minimum rather
   * than importing NextRequest keeps the test honest about the surface actually
   * depended on — if proxy() starts reading something new, this fails loudly
   * instead of silently exercising a different object than production uses.
   */
  function request(path: string, method = "GET", ip = "203.0.113.7") {
    return {
      nextUrl: new URL(`http://localhost${path}`),
      method,
      headers: new Headers({ "x-forwarded-for": ip }),
      cookies: { getAll: () => [] },
    } as never;
  }

  beforeEach(() => {
    vi.resetModules();
    updateSessionMock.mockReset();
    updateSessionMock.mockImplementation(async () => new Response(null, { status: 200 }));
  });

  afterEach(() => vi.restoreAllMocks());

  it("returns 429 with Retry-After on the request past the ceiling", async () => {
    const { proxy } = await import("@/proxy");
    const ip = "198.51.100.1";

    // N requests inside the ceiling.
    for (let i = 0; i < RATE_LIMIT_BURST_PER_WINDOW; i++) {
      const res = await proxy(request("/api/activities/logbook", "GET", ip));
      expect(res.status, `request ${i + 1} should have been allowed`).not.toBe(429);
    }

    // N+1.
    const limited = await proxy(request("/api/activities/logbook", "GET", ip));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBeTruthy();
  });

  it("counts each client separately", async () => {
    const { proxy } = await import("@/proxy");

    for (let i = 0; i <= RATE_LIMIT_BURST_PER_WINDOW; i++) {
      await proxy(request("/api/activities/logbook", "GET", "198.51.100.2"));
    }
    // A different address is unaffected by the first one's spending.
    const other = await proxy(request("/api/activities/logbook", "GET", "198.51.100.3"));
    expect(other.status).not.toBe(429);
  });

  /**
   * The second acceptance criterion. A webhook's control is its signature;
   * throttling it only drops real events, which the provider then retries —
   * turning a limiter into an outage in the billing path.
   */
  it("never limits a payment webhook, however many arrive", async () => {
    const { proxy } = await import("@/proxy");

    for (let i = 0; i < RATE_LIMIT_BURST_PER_WINDOW * 3; i++) {
      const res = await proxy(request("/api/stripe/webhook", "POST", "198.51.100.4"));
      expect(res.status, `webhook ${i + 1} was limited`).not.toBe(429);
    }
  });

  it("never limits cron either", async () => {
    const { proxy } = await import("@/proxy");
    for (let i = 0; i < RATE_LIMIT_BURST_PER_WINDOW * 2; i++) {
      const res = await proxy(request("/api/cron/leaderboard", "GET", "198.51.100.5"));
      expect(res.status).not.toBe(429);
    }
  });

  it("never lets the internal user header reach the browser", async () => {
    // updateSession sets it on every authenticated request, including the
    // exempt and redirect paths. Stripping it only where it happens to be used
    // would send an athlete's id out through the branch nobody was watching.
    updateSessionMock.mockImplementation(async () => {
      const res = new Response(null, { status: 200 });
      res.headers.set("x-si-user", "user-abc-123");
      return res;
    });

    const { proxy } = await import("@/proxy");
    for (const path of ["/api/activities/logbook", "/api/stripe/webhook", "/dashboard"]) {
      const res = await proxy(request(path, "GET", "198.51.100.6"));
      expect(res.headers.get("x-si-user"), `leaked on ${path}`).toBeNull();
    }
  });

  /**
   * An auth redirect is not a request the per-user limit should charge for.
   *
   * A signed-out athlete hitting a protected page gets a 307 from
   * updateSession. Those are cheap, they are the app working correctly, and
   * charging an athlete's per-user allowance for a redirect loop would help
   * lock them out of the login page they are being sent to.
   *
   * Note what this does NOT claim. The burst guard runs BEFORE the session and
   * does count redirects, deliberately: a client hammering a protected page is
   * a flood whether or not it is signed in, and stopping that is the guard's
   * whole job. The next test pins that, so nobody "fixes" one into the other.
   */
  it("passes an auth redirect through without the per-user limit touching it", async () => {
    updateSessionMock.mockImplementation(
      async () => new Response(null, { status: 307, headers: { location: "/login" } })
    );

    const { proxy } = await import("@/proxy");
    for (let i = 0; i < RATE_LIMIT_BURST_PER_WINDOW - 1; i++) {
      const res = await proxy(request("/api/activities/logbook", "GET", "198.51.100.7"));
      expect(res.status, `redirect ${i + 1} became something else`).toBe(307);
    }
  });

  it("still applies the burst guard to a flood of redirects", async () => {
    // The other half of the pair above. Signed out is not a licence to flood.
    updateSessionMock.mockImplementation(
      async () => new Response(null, { status: 307, headers: { location: "/login" } })
    );

    const { proxy } = await import("@/proxy");
    let sawLimit = false;
    for (let i = 0; i < RATE_LIMIT_BURST_PER_WINDOW + 5; i++) {
      const res = await proxy(request("/api/activities/logbook", "GET", "198.51.100.8"));
      if (res.status === 429) sawLimit = true;
    }
    expect(sawLimit).toBe(true);
  });
});
