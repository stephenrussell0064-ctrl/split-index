import type { AuthError } from "@supabase/supabase-js";

const AUTH_CODE_MESSAGES: Record<string, string> = {
  email_exists:
    "An account with this email already exists. Try signing in instead.",
  user_already_exists:
    "An account with this email already exists. Try signing in instead.",
  weak_password:
    "Password is too weak. Use at least 8 characters with a mix of letters and numbers.",
  over_request_rate_limit:
    "Too many attempts. Please wait a few minutes and try again.",
  rate_limit_exceeded:
    "Too many attempts. Please wait a few minutes and try again.",
  invalid_credentials: "Email or password is incorrect.",
  signup_disabled: "New sign-ups are temporarily disabled. Please try again later.",
  email_not_confirmed:
    "Please confirm your email before signing in. Check your inbox for the link.",
  user_not_found: "No account found for that email.",
  validation_failed: "Please check your email and password and try again.",
  unexpected_failure:
    "We couldn't complete sign-up right now. Please try again in a moment.",
};

function isUselessMessage(message: string | undefined): boolean {
  if (!message) return true;
  const trimmed = message.trim();
  return (
    trimmed === "" ||
    trimmed === "{}" ||
    trimmed === "[object Object]" ||
    trimmed === "undefined"
  );
}

function messageForAuthCode(code: string | undefined, status?: number): string | undefined {
  if (code && AUTH_CODE_MESSAGES[code]) return AUTH_CODE_MESSAGES[code];

  if (status === 429) return AUTH_CODE_MESSAGES.over_request_rate_limit;
  if (status === 500 || status === 503) {
    return "Something went wrong on our side. Please try again in a moment.";
  }

  return undefined;
}

/** Human-readable message from Supabase Auth errors (handles `{}` from 500 responses). */
export function authErrorMessage(
  error: unknown,
  fallback = "Something went wrong. Please try again."
): string {
  if (!error) return fallback;

  if (typeof error === "string") {
    return isUselessMessage(error) ? fallback : error.trim();
  }

  const authError = error as AuthError;
  const code =
    typeof authError.code === "string" ? authError.code : undefined;
  const status = typeof authError.status === "number" ? authError.status : undefined;
  const mapped = messageForAuthCode(code, status);
  const message =
    typeof authError.message === "string" ? authError.message.trim() : "";

  if (!isUselessMessage(message)) {
    if (mapped && (status === 500 || message === "{}")) return mapped;
    return message;
  }

  if (mapped) return mapped;

  if (error instanceof Error && !isUselessMessage(error.message)) {
    return error.message.trim();
  }

  if (typeof error === "object" && error !== null) {
    const record = error as Record<string, unknown>;
    for (const key of ["msg", "message", "error_description", "error"] as const) {
      const value = record[key];
      if (typeof value === "string" && !isUselessMessage(value)) return value.trim();
    }
  }

  return fallback;
}
