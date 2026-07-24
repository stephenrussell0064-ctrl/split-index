import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { ensureProfileForUser } from "@/lib/supabase/ensure-profile";
import { getPublicOrigin } from "@/lib/app-url";

function failurePath(next: string, reason: string): string {
  if (next === "/reset-password") return "/reset-password";
  if (next === "/onboarding" || next === "/email-confirmed" || next.startsWith("/signup")) {
    return "/signup";
  }
  return "/login";
}

function authFailureRedirect(
  request: Request,
  reason: string,
  detail?: string,
  next?: string
) {
  const origin = getPublicOrigin(request);
  console.error("[auth/callback] Sign-in failed:", { reason, detail, next });

  const path = failurePath(next ?? "/dashboard", reason);
  const params = new URLSearchParams({ error: "auth", reason });
  if (detail) params.set("detail", detail.slice(0, 200));

  return NextResponse.redirect(`${origin}${path}?${params.toString()}`);
}

function mapOAuthErrorReason(
  oauthError: string,
  errorCode: string | null,
  otpType: string | null
): string {
  if (errorCode === "otp_expired" || errorCode === "expired_token") {
    return "link_expired";
  }
  if (
    otpType === "signup" ||
    otpType === "email" ||
    errorCode === "email_not_confirmed"
  ) {
    return "email_confirmation_failed";
  }
  if (oauthError === "access_denied") {
    return "email_confirmation_failed";
  }
  return "oauth_denied";
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const otpType = searchParams.get("type");
  const oauthError = searchParams.get("error");
  const oauthErrorDescription = searchParams.get("error_description");
  const errorCode = searchParams.get("error_code");
  let next = searchParams.get("next") ?? "/dashboard";
  if (!next.startsWith("/")) next = "/dashboard";

  if (oauthError) {
    return authFailureRedirect(
      request,
      mapOAuthErrorReason(oauthError, errorCode, otpType),
      oauthErrorDescription ?? oauthError,
      next
    );
  }

  const supabase = await createClient();

  if (tokenHash && otpType) {
    const { error: verifyError } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: otpType as EmailOtpType,
    });

    if (verifyError) {
      const reason =
        verifyError.message.toLowerCase().includes("expired") ||
        verifyError.message.toLowerCase().includes("invalid")
          ? "link_expired"
          : "email_confirmation_failed";
      return authFailureRedirect(request, reason, verifyError.message, next);
    }
  } else if (code) {
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

    if (exchangeError) {
      const lower = exchangeError.message.toLowerCase();
      const reason =
        lower.includes("code verifier") ||
        lower.includes("pkce") ||
        lower.includes("invalid flow state")
          ? "exchange_failed"
          : lower.includes("expired") || lower.includes("already been used")
            ? "link_expired"
            : "exchange_failed";
      return authFailureRedirect(request, reason, exchangeError.message, next);
    }
  } else {
    return authFailureRedirect(request, "missing_code", undefined, next);
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
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("onboarding_completed")
    .eq("user_id", user.id)
    .single();

  // The email-confirmation landing page is a standalone "you're verified"
  // screen, not an onboarding entry point — the account is now active, but
  // the user explicitly signs in from there rather than being silently
  // carried into a session created by clicking an email link.
  if (next === "/email-confirmed") {
    await supabase.auth.signOut();
    const origin = getPublicOrigin(request);
    console.log("[auth/callback] Email confirmed, signed out for explicit sign-in:", {
      userId: user.id,
    });
    return NextResponse.redirect(`${origin}/email-confirmed`);
  }

  const redirectPath =
    next === "/reset-password"
      ? next
      : profile?.onboarding_completed
        ? next === "/onboarding"
          ? "/dashboard"
          : next
        : "/onboarding";
  const origin = getPublicOrigin(request);

  console.log("[auth/callback] Sign-in succeeded:", {
    userId: user.id,
    onboardingCompleted: !!profile?.onboarding_completed,
    next,
    redirectPath,
  });

  return NextResponse.redirect(`${origin}${redirectPath}`);
}
