import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canAccessProfile } from "@/lib/premium/features";
import { getProvider, getCallbackUrl } from "@/lib/integrations/providers";
import { generateOAuthState } from "@/lib/integrations/tokens";

const VALID_PROVIDERS = new Set([
  "strava",
  "garmin",
  "apple_health",
  "polar",
  "coros",
  "fitbit",
]);

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider: providerId } = await params;

  if (!VALID_PROVIDERS.has(providerId)) {
    return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
  }

  const provider = getProvider(providerId);
  if (!provider) {
    return NextResponse.json({ error: "Provider not found" }, { status: 404 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("subscription_tier, subscription_status")
    .eq("user_id", user.id)
    .single();

  if (!profile || !canAccessProfile("oauth_sync", profile)) {
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/settings/integrations?error=premium_required`
    );
  }

  const state = generateOAuthState(user.id);
  const redirectUri = getCallbackUrl(providerId);
  const authUrl = provider.getAuthUrl(state, redirectUri);

  const response = authUrl
    ? NextResponse.redirect(authUrl)
    : NextResponse.redirect(
        `${redirectUri}?code=stub&state=${encodeURIComponent(state)}&mode=demo`
      );

  response.cookies.set("integration_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });

  return response;
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ provider: string }> }
) {
  return GET(request, ctx);
}
