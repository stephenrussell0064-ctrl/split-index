import { describe, expect, it } from "vitest";
import { isSubmittableOtp, sanitizeOtpInput } from "./auth-form";

/**
 * The confirmation-code field silently ate the last two digits of every code.
 *
 * Supabase issues codes at the length the project is configured for. This
 * project issues 8. The field hard-coded 6 — `maxLength={6}` and a
 * `.slice(0, 6)` in the change handler — so someone typing 12345678 ended up
 * with 123456 in the box and no indication anything had been dropped. The form
 * submitted that, Supabase rejected it, and the screen said "That code didn't
 * work. Please check it and try again."
 *
 * That message is the part worth remembering. It blamed the person typing for
 * a number they had copied correctly, and re-reading the email could never have
 * helped them. Nobody could have got past this screen.
 */

describe("sanitizeOtpInput", () => {
  it("keeps all 8 digits of a code this project actually issues", () => {
    // The regression. Before the fix this returned "123456".
    expect(sanitizeOtpInput("12345678")).toBe("12345678");
  });

  it("keeps a 6-digit code intact too, which is the default length", () => {
    expect(sanitizeOtpInput("123456")).toBe("123456");
  });

  it("accepts the longest code Supabase can be configured to issue", () => {
    expect(sanitizeOtpInput("1234567890")).toBe("1234567890");
  });

  it("still strips whatever a paste drags in with it", () => {
    // Copying from an email client routinely brings spaces or a stray newline.
    expect(sanitizeOtpInput(" 1234 5678 \n")).toBe("12345678");
    expect(sanitizeOtpInput("code: 12345678")).toBe("12345678");
  });

  it("still refuses to grow without bound", () => {
    // The cap is not the bug — dropping digits below the issued length was.
    expect(sanitizeOtpInput("123456789012345")).toBe("1234567890");
  });
});

describe("isSubmittableOtp", () => {
  it("does not enable the button for a code that is too short to be one", () => {
    expect(isSubmittableOtp("")).toBe(false);
    expect(isSubmittableOtp("12345")).toBe(false);
  });

  it("enables it at 6 digits and stays enabled past that", () => {
    // The old gate was `otp.length !== 6`, so at 7 or 8 digits the button went
    // BACK to disabled. Length is Supabase's business, not the button's.
    expect(isSubmittableOtp("123456")).toBe(true);
    expect(isSubmittableOtp("1234567")).toBe(true);
    expect(isSubmittableOtp("12345678")).toBe(true);
    expect(isSubmittableOtp("1234567890")).toBe(true);
  });
});
