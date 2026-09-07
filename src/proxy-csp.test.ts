import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * M9 — the CSP as the browser actually receives it.
 *
 * csp.test.ts proves the two policies are right. This proves the proxy picks
 * the right one, sends exactly one of it, and puts the nonce where Next can
 * find it — which is the half that is easy to get subtly wrong and impossible
 * to notice, because a page with a broken CSP still returns 200.
 */

const { updateSessionMock } = vi.hoisted(() => ({ updateSessionMock: vi.fn() }));

vi.mock("@/lib/supabase/proxy", () => ({
  USER_ID_HEADER: "x-si-user",
  updateSession: (req: unknown, extra?: Record<string, string>) =>
    updateSessionMock(req, extra),
}));

function request(path: string, method = "GET", ip = "203.0.113.9") {
  return {
    nextUrl: new URL(`http://localhost${path}`),
    method,
    headers: new Headers({ "x-forwarded-for": ip }),
    cookies: { getAll: () => [] },
  } as never;
}

/** The header values `updateSession` was asked to put on the REQUEST. */
function requestHeadersFor(call: number): Record<string, string> | undefined {
  return updateSessionMock.mock.calls[call]?.[1];
}

describe("the proxy chooses a policy per path", () => {
  beforeEach(() => {
    vi.resetModules();
    updateSessionMock.mockReset();
    updateSessionMock.mockImplementation(
      async () => new Response(null, { status: 200 })
    );
  });

  afterEach(() => vi.restoreAllMocks());

  /**
   * THE FINDING. Before this change every response carried
   * `script-src 'self' 'unsafe-inline'`, including /dashboard.
   */
  it("sends a nonce policy, with no inline allowance, on the app surface", async () => {
    const { proxy } = await import("@/proxy");
    const res = await proxy(request("/dashboard"));

    const csp = res.headers.get("Content-Security-Policy")!;
    const scriptSrc = csp.match(/script-src([^;]*);/)![1];

    expect(scriptSrc).not.toContain("unsafe-inline");
    expect(scriptSrc).toMatch(/'nonce-[^']+'/);
    expect(scriptSrc).toContain("'strict-dynamic'");
  });

  it("leaves the landing page on the policy it had", async () => {
    const { proxy } = await import("@/proxy");
    const res = await proxy(request("/"));

    const csp = res.headers.get("Content-Security-Policy")!;
    expect(csp).toContain("'unsafe-inline'");
    expect(csp).not.toContain("nonce-");
  });

  it.each(["/privacy", "/terms", "/accessibility", "/how-scoring-works"])(
    "leaves %s static-friendly",
    async (path) => {
      const { proxy } = await import("@/proxy");
      const csp = (await proxy(request(path))).headers.get(
        "Content-Security-Policy"
      )!;
      expect(csp).not.toContain("nonce-");
    }
  );

  /**
   * The nonce must reach the REQUEST headers, not just the response. Next
   * injects it into its own script tags by reading the CSP header off the
   * request during rendering — set it only on the response and the header
   * ships, nothing is nonced, and 'strict-dynamic' blocks the page's own
   * JavaScript. A 200 with a blank screen.
   */
  it("passes the nonce to the renderer, not only to the browser", async () => {
    const { proxy } = await import("@/proxy");
    const res = await proxy(request("/dashboard"));

    const sent = requestHeadersFor(0)!;
    expect(sent, "updateSession was given no request headers").toBeDefined();
    expect(sent["x-nonce"]).toBeTruthy();

    // The same nonce in both places, or the tags are stamped with one value
    // and the browser is enforcing another.
    const responseCsp = res.headers.get("Content-Security-Policy")!;
    expect(responseCsp).toContain(`'nonce-${sent["x-nonce"]}'`);
    expect(sent["Content-Security-Policy"]).toBe(responseCsp);
  });

  it("does not bother the renderer on public paths", async () => {
    const { proxy } = await import("@/proxy");
    await proxy(request("/"));
    expect(requestHeadersFor(0)).toBeUndefined();
  });

  /**
   * Two CSP headers on one response are enforced TOGETHER — the intersection,
   * not the last one written. Leaving the old header in next.config.ts while
   * adding this one would have meant every script had to satisfy both, so the
   * inline blocks the public policy exists to permit would have been blocked
   * anyway. That is why the header left next.config.ts entirely.
   */
  it("sends exactly one policy", async () => {
    const { proxy } = await import("@/proxy");
    const res = await proxy(request("/dashboard"));

    /*
     * The Headers API folds repeated names into one comma-joined value, so it
     * cannot count duplicates and this only proves the header is present. The
     * assertion that actually holds the line is the one below: next.config.ts
     * must not set a CSP, because that is the only way a second one could be
     * added to the same response.
     */
    expect(res.headers.get("Content-Security-Policy")).toBeTruthy();

    const config = await import("../next.config");
    const groups = await config.default.headers!();
    const keys = groups.flatMap((g) => g.headers.map((h) => h.key));
    expect(
      keys,
      "next.config.ts is setting a CSP again — two policies are enforced as " +
        "their intersection, which is neither of the ones we wrote"
    ).not.toContain("Content-Security-Policy");
  });

  it("keeps the other security headers in next.config.ts", async () => {
    // Only the CSP moved. Losing HSTS to a refactor would be a quiet undoing
    // of M8, committed two commits earlier.
    const config = await import("../next.config");
    const keys = (await config.default.headers!()).flatMap((g) =>
      g.headers.map((h) => h.key)
    );
    for (const key of [
      "Strict-Transport-Security",
      "X-Frame-Options",
      "X-Content-Type-Options",
      "Referrer-Policy",
      "Permissions-Policy",
    ]) {
      expect(keys).toContain(key);
    }
  });

  it("gives every request its own nonce", async () => {
    const { proxy } = await import("@/proxy");
    await proxy(request("/dashboard"));
    await proxy(request("/dashboard"));

    const first = requestHeadersFor(0)!["x-nonce"];
    const second = requestHeadersFor(1)!["x-nonce"];
    // A nonce reused across requests is a nonce an attacker can read off one
    // page and use on the next.
    expect(first).not.toBe(second);
  });

  /**
   * Every exit from proxy() carries the header, including the 429s. A rate
   * limited response has no scripts, so this buys nothing directly — it buys
   * not having to remember which exits render HTML.
   */
  it("sets it on a rate-limited response too", async () => {
    const { RATE_LIMIT_BURST_PER_WINDOW } = await import("@/lib/security/config");
    const { proxy } = await import("@/proxy");

    let last: Response | undefined;
    for (let i = 0; i <= RATE_LIMIT_BURST_PER_WINDOW; i++) {
      last = await proxy(request("/api/activities/logbook", "GET", "198.51.100.9"));
    }
    expect(last!.status).toBe(429);
    expect(last!.headers.get("Content-Security-Policy")).toBeTruthy();
  });
});
