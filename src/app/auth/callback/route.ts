import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ensureProfileForUser } from "@/lib/supabase/ensure-profile";
import { getPublicOrigin } from "@/lib/app-url";

function authFailureRedirect(
  request: Request,
  reason: string,
  detail?: string,
  next?: string
) {
  const origin = getPublicOrigin(request);
  console.error("[auth/callback] Sign-in failed:", { reason, detail, next });

  // A password-reset link that's expired, already used (a common cause:
  // email clients/security scanners "click" links to prescan them before
  // the user does, burning the one-time code), or otherwise fails to
  // exchange isn't a "sign-in was cancelled" event — send it to the reset
  // page, which already has a clear "this link is invalid or expired,
  // request a new one" state for exactly this case, instead of the
  // generic OAuth-flavored login error.
  if (next === "/reset-password") {
    return NextResponse.redirect(`${origin}/reset-password`);
  }

  const params = new URLSearchParams({ error: "auth", reason });
  if (detail) params.set("detail", detail.slice(0, 200));

  return NextResponse.redirect(`${origin}/login?${params.toString()}`);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const oauthError = searchParams.get("error");
  const oauthErrorDescription = searchParams.get("error_description");
  let next = searchParams.get("next") ?? "/dashboard";
  // Guard against open redirects: only allow relative paths.
  if (!next.startsWith("/")) next = "/dashboard";

  if (oauthError) {
    return authFailureRedirect(
      request,
      "oauth_denied",
      oauthErrorDescription ?? oauthError,
      next
    );
  }

  if (!code) {
    return authFailureRedirect(request, "missing_code", undefined, next);
  }

  const supabase = await createClient();
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

  if (exchangeError) {
    return authFailureRedirect(
      request,
      "exchange_failed",
      exchangeError.message,
      next
    );
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) {
    return authFailureRedirect(request, "user_lookup_failed", userError.message, next);
  }

  if (!user) {
    return authFailureRedirect(request, "no_user", undefined, next);
  }

  const { error: profileError } = await ensureProfileForUser(user);
  if (profileError) {
    console.error("[auth/callback] Profile ensure failed:", profileError);
    // Session is valid; continue so onboarding can retry via /api/profile/ensure.
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("onboarding_completed")
    .eq("user_id", user.id)
    .single();

  const redirectPath =
    next === "/reset-password"
      ? next
      : profile?.onboarding_completed
        ? next
        : "/onboarding";
  const origin = getPublicOrigin(request);

  return NextResponse.redirect(`${origin}${redirectPath}`);
}
