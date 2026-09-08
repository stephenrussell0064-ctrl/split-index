import { describe, expect, it } from "vitest";
import { authErrorMessage } from "./auth-errors";

/**
 * This module had no tests, which is a gap worth naming: every authentication
 * failure a user ever sees comes out of it, and its final branch returns the
 * provider's own message verbatim. That branch is the one that leaks internal
 * strings to people, and nothing was holding it.
 */

describe("a provider that is offered but not switched on", () => {
  /*
   * The App Review case. Sign in with Apple has to appear wherever Google does
   * (guideline 4.8), so the button ships whether or not the provider is
   * configured. Before this, a reviewer pressing it read Supabase's own string.
   */
  it("does not show the reviewer an internal error string", () => {
    const message = authErrorMessage({
      message: "Unsupported provider: provider is not enabled",
      status: 400,
    });
    expect(message).not.toMatch(/unsupported provider/i);
    expect(message).not.toMatch(/provider is not enabled/i);
  });

  it("does not tell them to try again, because it cannot work", () => {
    // The generic fallback says "please try again". Trying again fails
    // identically, and saying otherwise wastes their time and their trust.
    const message = authErrorMessage({
      message: "Unsupported provider: provider is not enabled",
      status: 400,
    });
    expect(message).not.toMatch(/try again/i);
    expect(message).toMatch(/not available/i);
  });

  it("offers a route that actually works", () => {
    const message = authErrorMessage({ message: "provider is not enabled", status: 400 });
    expect(message).toMatch(/email/i);
  });
});

describe("everything else still behaves", () => {
  it("passes through a specific message the user can act on", () => {
    expect(authErrorMessage({ message: "Invalid login credentials", status: 400 })).toMatch(
      /invalid login credentials/i,
    );
  });

  it("falls back when there is no error", () => {
    expect(authErrorMessage(null, "Sign-in failed.")).toBe("Sign-in failed.");
  });

  it("uses the caller's fallback for an empty message", () => {
    expect(authErrorMessage({ message: "" }, "Apple sign-in failed.")).toContain(
      "Apple sign-in failed.",
    );
  });

  it("hides a database error behind something a person can read", () => {
    const message = authErrorMessage({
      message: "Database error saving new user",
      status: 500,
    });
    expect(message).not.toMatch(/database error/i);
  });
});
