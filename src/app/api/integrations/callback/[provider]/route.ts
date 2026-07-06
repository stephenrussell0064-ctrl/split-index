import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getProvider, getCallbackUrl } from "@/lib/integrations/providers";
import { encodeToken, parseOAuthState } from "@/lib/integrations/tokens";

const VALID_PROVIDERS = new Set([
  "strava",
  "garmin",
  "apple_health",
  "polar",
  "coros",
  "fitbit",
]);

export async function GET(
  request: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider: providerId } = await params;
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  if (!VALID_PROVIDERS.has(providerId)) {
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/settings/integrations?error=unknown_provider`
    );
  }

  if (error) {
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/settings/integrations?error=${encodeURIComponent(error)}`
    );
  }

  if (!code || !state) {
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/settings/integrations?error=missing_code`
    );
  }

  const cookieStore = await cookies();
  const storedState = cookieStore.get("integration_oauth_state")?.value;
  const parsedState = parseOAuthState(state);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !parsedState || parsedState.userId !== user.id) {
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/settings/integrations?error=invalid_state`
    );
  }

  if (storedState && storedState !== state) {
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/settings/integrations?error=state_mismatch`
    );
  }

  const provider = getProvider(providerId)!;
  const redirectUri = getCallbackUrl(providerId);

  try {
    const tokens = await provider.exchangeCode(code, redirectUri);

    const { error: upsertError } = await supabase.from("integration_connections").upsert(
      {
        user_id: user.id,
        provider: providerId,
        access_token: encodeToken(tokens.accessToken),
        refresh_token: tokens.refreshToken ? encodeToken(tokens.refreshToken) : null,
        token_expires_at: tokens.expiresAt,
        provider_user_id: tokens.providerUserId,
        sync_status: "idle",
        sync_error: null,
        connected_at: new Date().toISOString(),
        metadata: {
          demo: code === "stub" || !provider.isConfigured(),
          configured: provider.isConfigured(),
        },
      },
      { onConflict: "user_id,provider" }
    );

    if (upsertError) {
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/settings/integrations?error=${encodeURIComponent(upsertError.message)}`
      );
    }

    const response = NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/settings/integrations?connected=${providerId}`
    );
    response.cookies.delete("integration_oauth_state");
    return response;
  } catch (err) {
    const message = err instanceof Error ? err.message : "oauth_failed";
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/settings/integrations?error=${encodeURIComponent(message)}`
    );
  }
}
