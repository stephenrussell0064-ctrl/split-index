import { describe, expect, it } from "vitest";
import { AUTH_ERROR_MESSAGES_FOR_TEST, authErrorMessage } from "./auth-errors";

/**
 * THE ORACLE WAS OPEN, AND THIS FILE IS WHY IT WAS NOT NOTICED.
 *
 * `auth-errors.ts` says: "auth-errors.test.ts asserts the two are
 * byte-identical, so splitting them again fails the build rather than quietly
 * reopening the oracle." There was no such file, and `AUTH_ERROR_MESSAGES_FOR_TEST`
 * was exported for it — a hole shaped exactly like a test that was never
 * written.
 *
 * The two map entries had not drifted. What had happened is worse and the map
 * could not show it: `authErrorMessage` only consulted the map when the
 * provider had said nothing useful, and a real AuthError always carries a
 * message. So sign-in answered with Supabase's own wording — "Invalid login
 * credentials" for a wrong password and "User not found" for an address with
 * no account — and the map that makes those one sentence was decoration.
 *
 * The first block is the security property. It is written against
 * `authErrorMessage`, the function the sign-in form actually calls, precisely
 * because asserting on the map alone is what would have kept passing.
 */
describe("sign-in does not say whether the account exists", () => {
  /** What Supabase really sends, message and all. */
  const wrongPassword = {
    code: "invalid_credentials",
    message: "Invalid login credentials",
    status: 400,
  };
  const noSuchAccount = {
    code: "user_not_found",
    message: "User not found",
    status: 400,
  };

  it("gives the same answer to a wrong password and an unknown address", () => {
    expect(authErrorMessage(wrongPassword)).toBe(authErrorMessage(noSuchAccount));
  });

  it("gives that answer through the function, not just in the map", () => {
    // The distinction this test exists for. The map agreed with itself the
    // whole time the oracle was open.
    expect(authErrorMessage(wrongPassword)).toBe("Email or password is incorrect.");
    expect(authErrorMessage(noSuchAccount)).toBe("Email or password is incorrect.");
  });

  it("keeps the two map entries byte-identical", () => {
    // The assertion the docblock promised, kept as well: the function-level
    // one above would still pass if both codes were remapped to two identical
    // copies of some other sentence, and this says they are one message.
    expect(AUTH_ERROR_MESSAGES_FOR_TEST.invalid_credentials).toBe(
      AUTH_ERROR_MESSAGES_FOR_TEST.user_not_found
    );
  });

  it("says nothing about the account in the words themselves", () => {
    const answer = authErrorMessage(wrongPassword).toLowerCase();
    for (const tell of ["not found", "no account", "does not exist", "unknown", "unregistered"]) {
      expect(answer, `the neutral answer says "${tell}"`).not.toContain(tell);
    }
  });

  it("still tells the truth at signup, which is a different trade", () => {
    /*
      Deliberately NOT neutral, and the module says why: `email_exists` has to
      tell the truth or the flow dead-ends on an address the person cannot use,
      and every signup form in existence leaks the same bit.
    */
    expect(
      authErrorMessage({ code: "email_exists", message: "User already registered", status: 422 })
    ).toContain("already exists");
  });
});

describe("the athlete reads the mapped message, not the provider's", () => {
  it("prefers the map for a code that has an entry", () => {
    // The bug in one line: every message in the map was written to be read by
    // an athlete, and the raw provider strings were preferred to all of them.
    expect(
      authErrorMessage({ code: "weak_password", message: "Password is too weak", status: 422 })
    ).toContain("at least 8 characters");
    expect(
      authErrorMessage({ code: "email_not_confirmed", message: "Email not confirmed", status: 400 })
    ).toContain("6-digit code");
  });

  it("maps a rate limit by status when no code came with it", () => {
    expect(authErrorMessage({ message: "too many requests", status: 429 })).toBe(
      AUTH_ERROR_MESSAGES_FOR_TEST.over_request_rate_limit
    );
  });

  it("passes through a message for a code it does not know", () => {
    // The map is not a filter. An unmapped provider error still says what it
    // said, because a vague answer to an unanticipated failure helps nobody.
    expect(
      authErrorMessage({ code: "mfa_challenge_expired", message: "That challenge expired.", status: 401 })
    ).toBe("That challenge expired.");
  });
});

describe("an error that says nothing useful", () => {
  it("does not put {} or [object Object] in front of an athlete", () => {
    // A 500 from Supabase Auth arrives as an empty object, which is how these
    // strings reached the screen in the first place.
    for (const useless of ["{}", "[object Object]", "undefined", "   ", ""]) {
      const answer = authErrorMessage({ message: useless, status: 500 });
      expect(answer).not.toContain("object Object");
      expect(answer.trim()).not.toBe("{}");
      expect(answer.length).toBeGreaterThan(10);
    }
  });

  it("translates a signup trigger failure into something an athlete can act on", () => {
    // "Database error saving new user" is the provider's sentence for the
    // handle_new_user trigger failing. It is true and unusable.
    const answer = authErrorMessage({
      message: "Database error saving new user",
      status: 500,
    });
    expect(answer.toLowerCase()).not.toContain("database error");
    expect(answer).toContain("our side");
  });

  it("falls back rather than returning nothing at all", () => {
    expect(authErrorMessage(null)).toBe("Something went wrong. Please try again.");
    expect(authErrorMessage(undefined, "Custom fallback.")).toBe("Custom fallback.");
    expect(authErrorMessage("{}")).toBe("Something went wrong. Please try again.");
  });

  it("takes a plain string error at its word", () => {
    expect(authErrorMessage("Your session expired.")).toBe("Your session expired.");
  });
});
