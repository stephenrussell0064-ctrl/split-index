import type { AuthError } from "@supabase/supabase-js";

const GENERIC_SERVER_ERROR =
  "Something went wrong on our side. Please try again in a moment.";

const DEV_SERVER_ERROR_HINT =
  "Likely cause: handle_new_user trigger failed (missing search_path or trigger). " +
  "Run supabase/diagnostics/signup_trigger_check.sql in Supabase SQL Editor, " +
  "then apply migration 007. Check Dashboard → Logs → Auth for the Postgres error.";

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
  if (status === 500 || status === 503) return GENERIC_SERVER_ERROR;

  return undefined;
}

function authErrorStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const status = (error as AuthError).status;
  return typeof status === "number" ? status : undefined;
}

function withDevAuthDetails(message: string, error: unknown): string {
  if (process.env.NODE_ENV !== "development") return message;

  console.error("[auth]", error);

  const status = authErrorStatus(error);
  const parts = [message];

  if (message === GENERIC_SERVER_ERROR) {
    parts.push(DEV_SERVER_ERROR_HINT);
  }

  if (status !== undefined) {
    parts.push(`HTTP ${status}`);
  }

  const authError = error as AuthError;
  if (typeof authError.code === "string" && authError.code) {
    parts.push(`code=${authError.code}`);
  }

  const rawMessage =
    typeof authError.message === "string" ? authError.message.trim() : "";
  if (!isUselessMessage(rawMessage) && rawMessage !== message) {
    parts.push(`message=${rawMessage}`);
  }

  return parts.join(" — ");
}

/** Human-readable message from Supabase Auth errors (handles `{}` from 500 responses). */
export function authErrorMessage(
  error: unknown,
  fallback = "Something went wrong. Please try again."
): string {
  if (!error) return fallback;

  if (typeof error === "string") {
    const trimmed = error.trim();
    if (isUselessMessage(trimmed)) return withDevAuthDetails(fallback, error);
    return trimmed;
  }

  const authError = error as AuthError;
  const code =
    typeof authError.code === "string" ? authError.code : undefined;
  const status = authErrorStatus(error);
  const mapped = messageForAuthCode(code, status);
  const message =
    typeof authError.message === "string" ? authError.message.trim() : "";

  if (!isUselessMessage(message)) {
    if (mapped && (status === 500 || message === "{}")) {
      return withDevAuthDetails(mapped, error);
    }
    return message;
  }

  if (mapped) return withDevAuthDetails(mapped, error);

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

  return withDevAuthDetails(fallback, error);
}
