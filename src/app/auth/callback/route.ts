import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ensureProfileForUser } from "@/lib/supabase/ensure-profile";
import { getPublicOrigin } from "@/lib/app-url";

function authFailureRedirect(
  request: Request,
  reason: string,
  detail?: string
) {
  const origin = getPublicOrigin(request);
  const params = new URLSearchParams({ error: "auth", reason });
  if (detail) params.set("detail", detail.slice(0, 200));

  console.error("[auth/callback] Sign-in failed:", { reason, detail });

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
      oauthErrorDescription ?? oauthError
    );
  }

  if (!code) {
    return authFailureRedirect(request, "missing_code");
  }

  const supabase = await createClient();
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

  if (exchangeError) {
    return authFailureRedirect(
      request,
      "exchange_failed",
      exchangeError.message
    );
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) {
    return authFailureRedirect(request, "user_lookup_failed", userError.message);
  }

  if (!user) {
    return authFailureRedirect(request, "no_user");
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
