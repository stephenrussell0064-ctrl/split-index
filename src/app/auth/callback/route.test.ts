import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * WP13.7 — the OAuth callback establishes a session.
 *
 * This is a regression test for an incident, not a hypothetical. Split Index
 * has been through two auth failures: an OAuth callback that created the user
 * row but never established a session, and an email confirmation flow replaced
 * with a six-digit OTP after link scanners pre-consumed the tokens. The fix for
 * the first is in place; what was missing is anything that would notice it
 * breaking again.
 *
 * The shape of that original bug is what these assert against. It was not a
 * crash — the callback ran, the profile appeared, and the athlete was returned
 * to a page that then bounced them back to /login. So "did it redirect
 * somewhere" proves nothing on its own; what matters is that the code was
 * exchanged for a session before the redirect, and that a FAILED exchange never
 * lands on a signed-in page.
 */

const { getUserMock, exchangeMock, verifyOtpMock, signOutMock, fromMock, ensureProfileMock } =
  vi.hoisted(() => ({
    getUserMock: vi.fn(),
    exchangeMock: vi.fn(),
    verifyOtpMock: vi.fn(),
    signOutMock: vi.fn(),
    fromMock: vi.fn(),
    ensureProfileMock: vi.fn(),
  }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: getUserMock,
      exchangeCodeForSession: exchangeMock,
      verifyOtp: verifyOtpMock,
      signOut: signOutMock,
    },
    from: fromMock,
  }),
}));

vi.mock("@/lib/supabase/ensure-profile", () => ({
  ensureProfileForUser: (...args: unknown[]) => ensureProfileMock(...args),
}));

vi.mock("@/lib/app-url", () => ({
  getPublicOrigin: () => "https://www.splitindex.co.uk",
}));

function callback(query: string): Request {
  return new Request(`https://www.splitindex.co.uk/auth/callback?${query}`);
}

/** The profile lookup the callback makes after the exchange. */
function profileReturning(onboardingCompleted: boolean) {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    single: async () => ({ data: { onboarding_completed: onboardingCompleted }, error: null }),
  };
  return () => chain;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});

  exchangeMock.mockResolvedValue({ error: null });
  verifyOtpMock.mockResolvedValue({ error: null });
  signOutMock.mockResolvedValue({ error: null });
  getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
  ensureProfileMock.mockResolvedValue({ error: null });
  fromMock.mockImplementation(profileReturning(true));
});

describe("a valid OAuth callback", () => {
  it("exchanges the code for a session before redirecting anywhere", async () => {
    const { GET } = await import("./route");
    const res = await GET(callback("code=valid-auth-code&next=%2Fdashboard"));

    // The exchange is the bug. A callback that redirects without it produces
    // exactly the original incident: a user row, no session, and a bounce.
    expect(exchangeMock).toHaveBeenCalledWith("valid-auth-code");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://www.splitindex.co.uk/dashboard");
  });

  it("confirms the session actually resolves to a user", async () => {
    const { GET } = await import("./route");
    await GET(callback("code=valid-auth-code"));

    // getUser() after the exchange is what distinguishes "the exchange
    // returned no error" from "there is a session".
    expect(getUserMock).toHaveBeenCalled();
  });

  it("ensures the profile row exists, which is the half that already worked", async () => {
    const { GET } = await import("./route");
    await GET(callback("code=valid-auth-code"));
    expect(ensureProfileMock).toHaveBeenCalledWith({ id: "user-1" });
  });

  it("sends an athlete who has not onboarded to onboarding, not the dashboard", async () => {
    fromMock.mockImplementation(profileReturning(false));
    const { GET } = await import("./route");
    const res = await GET(callback("code=valid-auth-code&next=%2Fdashboard"));
    expect(res.headers.get("location")).toBe("https://www.splitindex.co.uk/onboarding");
  });
});

describe("an email confirmation link", () => {
  it("verifies the OTP token rather than exchanging a code", async () => {
    const { GET } = await import("./route");
    await GET(callback("token_hash=abc123&type=signup&next=%2Femail-confirmed"));

    expect(verifyOtpMock).toHaveBeenCalledWith({ token_hash: "abc123", type: "signup" });
    expect(exchangeMock).not.toHaveBeenCalled();
  });

  /**
   * The deliberate sign-out on the email-confirmed path.
   *
   * Clicking a link in an email must not silently produce a signed-in session —
   * link scanners follow those links, and the OTP flow exists because scanners
   * were pre-consuming tokens. The account is activated; the athlete then signs
   * in themselves.
   */
  it("signs out again rather than carrying the athlete into a session", async () => {
    const { GET } = await import("./route");
    const res = await GET(callback("token_hash=abc123&type=signup&next=%2Femail-confirmed"));

    expect(signOutMock).toHaveBeenCalled();
    expect(res.headers.get("location")).toBe("https://www.splitindex.co.uk/email-confirmed");
  });
});

describe("a failed callback never lands on a signed-in page", () => {
  it("redirects to login when the exchange fails", async () => {
    exchangeMock.mockResolvedValue({ error: { message: "invalid flow state" } });
    const { GET } = await import("./route");
    const res = await GET(callback("code=stale-code&next=%2Fdashboard"));

    const location = res.headers.get("location")!;
    expect(location).toContain("/login");
    expect(location).not.toContain("/dashboard");
  });

  it("redirects to login when there is no session afterwards", async () => {
    // The original incident in one assertion: the exchange reported no error,
    // and there was still no user.
    getUserMock.mockResolvedValue({ data: { user: null }, error: null });
    const { GET } = await import("./route");
    const res = await GET(callback("code=valid-auth-code&next=%2Fdashboard"));

    expect(res.headers.get("location")).toContain("/login");
  });

  it("refuses a callback carrying neither a code nor a token", async () => {
    const { GET } = await import("./route");
    const res = await GET(callback("next=%2Fdashboard"));
    expect(res.headers.get("location")).toContain("reason=missing_code");
  });

  it("keeps the provider's error text out of the redirect URL in production", async () => {
    // WP5/M2. The detail is only useful to a developer and only safe locally;
    // in production it would sit in browser history and the Referer header.
    const previous = process.env.NODE_ENV;
    vi.stubEnv("NODE_ENV", "production");

    exchangeMock.mockResolvedValue({
      error: { message: 'relation "flow_state" does not exist' },
    });
    const { GET } = await import("./route");
    const res = await GET(callback("code=stale-code"));

    const location = res.headers.get("location")!;
    expect(location).not.toContain("detail");
    expect(location).not.toContain("flow_state");

    vi.unstubAllEnvs();
    if (previous) vi.stubEnv("NODE_ENV", previous);
    vi.unstubAllEnvs();
  });
});

describe("the callback cannot be used as an open redirect", () => {
  it("ignores an absolute URL in next", async () => {
    // `next` comes off the query string, and it decides where somebody lands
    // immediately after authenticating — the one moment they are least likely
    // to check the address bar.
    const { GET } = await import("./route");
    const res = await GET(callback("code=valid-auth-code&next=https%3A%2F%2Fevil.example%2Fsteal"));

    const location = res.headers.get("location")!;
    expect(location.startsWith("https://www.splitindex.co.uk/")).toBe(true);
    expect(location).not.toContain("evil.example");
  });
});
