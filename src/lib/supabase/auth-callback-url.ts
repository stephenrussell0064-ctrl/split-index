import { getAppUrl } from "@/lib/app-url";

/**
 * Build the auth callback URL on the same origin the user is actually on.
 * PKCE stores code_verifier in a cookie scoped to that origin — using
 * NEXT_PUBLIC_APP_URL when the user is on www (or vice versa) breaks
 * email confirmation and password-reset links.
 *
 * `nextPath: null` omits the `?next=` query param entirely — Supabase's
 * OAuth `redirectTo` allowlist match is exact (no query string) unless the
 * allowed entry itself uses a wildcard, so a bare `redirectTo` (as used for
 * Google sign-in below) has to match the bare allowlisted URL exactly.
 * `/auth/callback`'s own redirect logic already defaults to `/dashboard`
 * and overrides to `/onboarding` whenever onboarding isn't complete
 * regardless of `next`, so omitting it costs nothing for that path.
 */
export function buildAuthCallbackUrl(
  browserOrigin?: string,
  nextPath: string | null = "/dashboard"
): string {
  const origin =
    typeof window !== "undefined" && window.location?.origin
      ? window.location.origin.replace(/\/$/, "")
      : getAppUrl(browserOrigin);

  const url = new URL(`${origin}/auth/callback`);
  if (nextPath !== null) {
    const safeNext = nextPath.startsWith("/") ? nextPath : "/dashboard";
    url.searchParams.set("next", safeNext);
  }
  return url.toString();
}
