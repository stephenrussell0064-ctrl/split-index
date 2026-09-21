import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __testing, verifyCronRequest } from "./cron-auth";
import { stripComments } from "@/lib/testing/source-scan";

/**
 * M6 — `CRON_SECRET` is accepted from the query string.
 *
 * A secret in a URL is a secret in the access log, the proxy log, any error
 * report that captures the URL, and the browser history of anyone who pastes
 * it. Nothing ever asked for it: `.env.example` and `README.md` document the
 * Bearer header and only that, Vercel Cron sends it unprompted, and no config
 * or script in the repository references `?secret=`.
 */

const SECRET = "s3cret-value-that-is-long-enough";

function req(url: string, headers: Record<string, string> = {}): Request {
  return new Request(url, { headers });
}

describe("verifyCronRequest", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", SECRET);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("accepts the documented Bearer header", () => {
    expect(
      verifyCronRequest(req("https://x/api/cron/leaderboard", {
        authorization: `Bearer ${SECRET}`,
      }), "/api/cron/leaderboard")
    ).toBe(true);
  });

  /**
   * THE FINDING. This returned true before the change.
   */
  it("refuses the secret in the query string", () => {
    expect(
      verifyCronRequest(
        req(`https://x/api/cron/leaderboard?secret=${SECRET}`),
        "/api/cron/leaderboard"
      )
    ).toBe(false);
  });

  it("refuses it even when the value is correct and a header is absent", () => {
    // The value being right is exactly why this used to work, and exactly why
    // removing it is the fix rather than validating it harder.
    expect(
      verifyCronRequest(
        req(`https://x/api/cron/hybrid-reports?period=quarterly&secret=${SECRET}`),
        "/api/cron/hybrid-reports"
      )
    ).toBe(false);
  });

  /**
   * A job that silently stops running looks like nothing at all until somebody
   * notices a stale leaderboard. The 401 is correct; the log line is what makes
   * it diagnosable.
   */
  it("records the attempt, without recording the secret", () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((l) => lines.push(String(l)));
    vi.spyOn(console, "warn").mockImplementation((l) => lines.push(String(l)));
    vi.spyOn(console, "error").mockImplementation((l) => lines.push(String(l)));

    verifyCronRequest(
      req(`https://x/api/cron/leaderboard?secret=${SECRET}`),
      "/api/cron/leaderboard"
    );

    const all = lines.join("\n");
    expect(all, "nothing was logged").toContain("cron_secret_in_query_string");
    // The whole point of the change would be undone by logging the value.
    expect(all, "the secret reached the log").not.toContain(SECRET);
  });

  /**
   * The one branch where a refactor is catastrophic rather than merely wrong:
   * an unset variable must not make a job that reads every athlete's row public.
   */
  it("fails closed when CRON_SECRET is not configured", () => {
    vi.stubEnv("CRON_SECRET", "");
    expect(
      verifyCronRequest(req("https://x/api/cron/leaderboard", {
        authorization: "Bearer ",
      }), "/api/cron/leaderboard")
    ).toBe(false);
    // And an empty presented value must not match an empty expected one.
    expect(
      verifyCronRequest(req("https://x/api/cron/leaderboard"), "/api/cron/leaderboard")
    ).toBe(false);
  });

  it("rejects a wrong secret, a missing header and a bare token", () => {
    const cases: Record<string, string>[] = [
      {},
      { authorization: "Bearer wrong" },
      { authorization: SECRET },
      { authorization: "Basic " + SECRET },
    ];
    for (const headers of cases) {
      expect(
        verifyCronRequest(req("https://x/api/cron/leaderboard", headers), "/x"),
        JSON.stringify(headers)
      ).toBe(false);
    }
  });
});

describe("bearerToken", () => {
  const { bearerToken } = __testing;

  it("refuses a header that only contains the scheme somewhere", () => {
    // Worth stating precisely: the old `.replace("Bearer ", "")` ALSO refused
    // this, turning it into "xabc". It was never a bypass, and this test is
    // here to keep the anchoring, not to mark a fixed hole.
    expect(bearerToken(new Request("https://x", {
      headers: { authorization: "xBearer abc" },
    }))).toBeNull();
  });

  /**
   * The two cases that are a real change in behaviour, both of them requests
   * the old code REFUSED and should not have. HTTP defines the scheme token as
   * case-insensitive, and allows more than one space before the credential.
   */
  it("accepts the casing and spacing HTTP allows, which the old code rejected", () => {
    expect(bearerToken(new Request("https://x", {
      headers: { authorization: "bearer abc" },
    }))).toBe("abc");
    expect(bearerToken(new Request("https://x", {
      headers: { authorization: "Bearer   abc" },
    }))).toBe("abc");
  });

  it("keeps a token that contains the scheme name intact", () => {
    expect(bearerToken(new Request("https://x", {
      headers: { authorization: "Bearer myBearer token" },
    }))).toBe("myBearer token");
  });
});

describe("constantTimeEquals", () => {
  const { constantTimeEquals } = __testing;

  it("agrees with === on the answer", () => {
    expect(constantTimeEquals("abc", "abc")).toBe(true);
    expect(constantTimeEquals("abc", "abd")).toBe(false);
    expect(constantTimeEquals("abc", "abcd")).toBe(false);
    expect(constantTimeEquals("", "")).toBe(true);
    expect(constantTimeEquals("", "a")).toBe(false);
  });

  it("does not throw on differing lengths", () => {
    // crypto.timingSafeEqual does, which is why it is not used here.
    expect(() => constantTimeEquals("a", "aaaaaaaaaaaaaaaa")).not.toThrow();
  });
});

describe("no route reads a secret from a query string", () => {
  /**
   * The regression guard, and the reason it scans rather than tests: the two
   * cron routes each had their own copy of the old verifier, so fixing one
   * would have left the other. Comments are stripped first because cron-auth.ts
   * quotes the defective line in order to explain it.
   */
  const ROOT = fileURLToPath(new URL("../../..", import.meta.url));

  function routeFiles(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = `${dir}/${entry.name}`;
      if (entry.isDirectory()) routeFiles(full, out);
      else if (/route\.tsx?$/.test(entry.name)) out.push(full);
    }
    return out;
  }

  it("finds routes to scan", () => {
    expect(routeFiles(`${ROOT}/src/app/api`).length).toBeGreaterThan(30);
  });

  it.each(["leaderboard", "hybrid-reports"])(
    "cron/%s uses the shared header-only verifier",
    (name) => {
      const code = stripComments(
        readFileSync(`${ROOT}/src/app/api/cron/${name}/route.ts`, "utf8")
      );
      expect(code).toContain("verifyCronRequest(request");
      // The local copies are gone, not merely bypassed.
      expect(code).not.toContain("function verifyCronSecret");
      expect(code).not.toContain("CRON_SECRET");
    }
  );

  it("no API route pulls a secret out of the URL", () => {
    const offenders: string[] = [];
    for (const file of routeFiles(`${ROOT}/src/app/api`)) {
      const code = stripComments(readFileSync(file, "utf8"));
      if (/searchParams\.get\(\s*["'](secret|token|key|password)["']\s*\)/.test(code)) {
        offenders.push(file.slice(ROOT.length + 1));
      }
    }
    expect(
      offenders,
      "a credential read from the query string ends up in access logs, proxy " +
        "logs and error reports. Send it in a header:\n  " + offenders.join("\n  ")
    ).toEqual([]);
  });
});
