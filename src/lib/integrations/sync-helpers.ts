import type { SupabaseClient } from "@supabase/supabase-js";
import { encodeToken, decodeToken } from "@/lib/integrations/tokens";
import { getProvider } from "@/lib/integrations/providers";
import type { IntegrationProviderId } from "@/lib/integrations/types";
import type { ExternalActivity } from "@/lib/integrations/types";
import type { ProviderConnection } from "@/lib/integrations/providers/types";

const DEDUPE_WINDOW_MS = 5 * 60 * 1000;
const DURATION_TOLERANCE_SEC = 90;

export async function ensureFreshTokens(
  supabase: SupabaseClient,
  connectionId: string,
  connection: {
    access_token: string;
    refresh_token: string | null;
    token_expires_at: string | null;
    provider_user_id: string | null;
  },
  providerId: IntegrationProviderId
): Promise<ProviderConnection> {
  const provider = getProvider(providerId);
  if (!provider) {
    throw new Error("Unknown provider");
  }

  const expiresAt = connection.token_expires_at
    ? new Date(connection.token_expires_at).getTime()
    : null;
  const needsRefresh = !expiresAt || expiresAt <= Date.now() + 60_000;

  if (!needsRefresh) {
    return {
      accessToken: decodeToken(connection.access_token) ?? "",
      refreshToken: decodeToken(connection.refresh_token),
      expiresAt: connection.token_expires_at,
      providerUserId: connection.provider_user_id,
    };
  }

  const current: ProviderConnection = {
    accessToken: decodeToken(connection.access_token) ?? "",
    refreshToken: decodeToken(connection.refresh_token),
    expiresAt: connection.token_expires_at,
    providerUserId: connection.provider_user_id,
  };

  const refreshed = await provider.refreshAccessToken(current);

  await supabase
    .from("integration_connections")
    .update({
      access_token: encodeToken(refreshed.accessToken),
      refresh_token: refreshed.refreshToken
        ? encodeToken(refreshed.refreshToken)
        : connection.refresh_token,
      token_expires_at: refreshed.expiresAt,
    })
    .eq("id", connectionId);

  return refreshed;
}

/** Skip sync import when user already logged the same session manually. */
export async function findManualDuplicateActivity(
  supabase: SupabaseClient,
  userId: string,
  activity: ExternalActivity
): Promise<string | null> {
  const started = new Date(activity.started_at).getTime();
  const windowStart = new Date(started - DEDUPE_WINDOW_MS).toISOString();
  const windowEnd = new Date(started + DEDUPE_WINDOW_MS).toISOString();
  const minDuration = Math.max(1, activity.duration_seconds - DURATION_TOLERANCE_SEC);
  const maxDuration = activity.duration_seconds + DURATION_TOLERANCE_SEC;

  const { data } = await supabase
    .from("activities")
    .select("id")
    .eq("user_id", userId)
    .eq("source", "manual")
    .eq("sport", activity.sport)
    .gte("started_at", windowStart)
    .lte("started_at", windowEnd)
    .gte("duration_seconds", minDuration)
    .lte("duration_seconds", maxDuration)
    .limit(1)
    .maybeSingle();

  return data?.id ?? null;
}
