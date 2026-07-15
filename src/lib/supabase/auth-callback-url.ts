import { getAppUrl } from "@/lib/app-url";

/**
 * Build the auth callback URL on the same origin the user is actually on.
 * PKCE stores code_verifier in a cookie scoped to that origin — using
 * NEXT_PUBLIC_APP_URL when the user is on www (or vice versa) breaks
 * email confirmation and password-reset links.
 */
export function buildAuthCallbackUrl(
  browserOrigin?: string,
  nextPath = "/dashboard"
): string {
  const origin =
    typeof window !== "undefined" && window.location?.origin
      ? window.location.origin.replace(/\/$/, "")
      : getAppUrl(browserOrigin);

  const safeNext = nextPath.startsWith("/") ? nextPath : "/dashboard";
  const url = new URL(`${origin}/auth/callback`);
  url.searchParams.set("next", safeNext);
  return url.toString();
}
