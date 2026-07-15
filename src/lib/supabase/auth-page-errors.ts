export const AUTH_PAGE_ERROR_MESSAGES: Record<string, string> = {
  auth: "Sign-in failed. Please try again.",
  oauth_denied:
    "Sign-in was cancelled or the redirect was rejected. If you were confirming email, open the link in the same browser you signed up in, or request a new confirmation email.",
  email_confirmation_failed:
    "We could not confirm your email. The link may have expired or already been used — sign up again or sign in if you already confirmed.",
  link_expired:
    "This link has expired. Request a new confirmation or reset email and try again.",
  missing_code:
    "Sign-in did not complete. Open the email link in the same browser you used to sign up.",
  exchange_failed:
    "Could not finish sign-in. Open the link on the same site address you used to sign up (with or without www), or try again in the same browser.",
  user_lookup_failed:
    "Sign-in succeeded but the session could not be loaded. Please try again.",
  no_user: "Sign-in succeeded but no user account was found. Please try again.",
};

export function resolveAuthPageError(
  error?: string,
  reason?: string,
  detail?: string
): string | undefined {
  if (error !== "auth") return undefined;

  const base =
    AUTH_PAGE_ERROR_MESSAGES[reason ?? "auth"] ?? AUTH_PAGE_ERROR_MESSAGES.auth;

  if (process.env.NODE_ENV === "development" && detail) {
    return `${base} (${detail})`;
  }

  return base;
}
