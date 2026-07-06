import type { ExternalActivity, IntegrationProviderId } from "../types";

export interface ProviderConnection {
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: string | null;
  providerUserId?: string | null;
}

export interface IntegrationProvider {
  id: IntegrationProviderId;
  name: string;
  getAuthUrl(state: string, redirectUri: string): string | null;
  exchangeCode(code: string, redirectUri: string): Promise<ProviderConnection>;
  refreshAccessToken(connection: ProviderConnection): Promise<ProviderConnection>;
  fetchActivities(
    connection: ProviderConnection,
    since: Date
  ): Promise<ExternalActivity[]>;
  isConfigured(): boolean;
}

export function providerSource(id: IntegrationProviderId): ExternalActivity["source"] {
  return id;
}
