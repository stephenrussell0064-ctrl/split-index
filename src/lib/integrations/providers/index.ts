import type { ExternalActivity } from "../types";
import type { IntegrationProvider } from "./types";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

function sampleActivities(
  source: ExternalActivity["source"],
  providerName: string
): ExternalActivity[] {
  const now = Date.now();
  return [
    {
      external_id: `${source}-sample-1`,
      source,
      sport: "running",
      title: `${providerName} easy run`,
      started_at: new Date(now - 2 * 86400000).toISOString(),
      duration_seconds: 2400,
      distance_meters: 8000,
      avg_heart_rate: 142,
      session_type: "easy",
    },
    {
      external_id: `${source}-sample-2`,
      source,
      sport: "indoor_cycling",
      title: `${providerName} tempo ride`,
      started_at: new Date(now - 86400000).toISOString(),
      duration_seconds: 3600,
      distance_meters: 28000,
      avg_heart_rate: 155,
      session_type: "tempo",
    },
  ];
}

function createStubProvider(
  id: IntegrationProvider["id"],
  name: string,
  envKeys: string[],
  authUrlBuilder?: (state: string, redirectUri: string) => string
): IntegrationProvider {
  return {
    id,
    name,
    isConfigured: () => envKeys.every((k) => !!process.env[k]),
    getAuthUrl(state, redirectUri) {
      if (authUrlBuilder && envKeys.every((k) => !!process.env[k])) {
        return authUrlBuilder(state, redirectUri);
      }
      return null;
    },
    async exchangeCode(code, redirectUri) {
      if (code === "stub" || !envKeys.every((k) => !!process.env[k])) {
        return {
          accessToken: `stub_${id}_${Date.now()}`,
          refreshToken: `stub_refresh_${id}`,
          expiresAt: new Date(Date.now() + 3600 * 1000 * 6).toISOString(),
          providerUserId: `stub_user_${id}`,
        };
      }
      void redirectUri;
      return {
        accessToken: `token_${id}_${code.slice(0, 8)}`,
        refreshToken: `refresh_${id}`,
        expiresAt: new Date(Date.now() + 3600 * 1000 * 6).toISOString(),
        providerUserId: `${id}_user`,
      };
    },
    async refreshAccessToken(connection) {
      return {
        ...connection,
        accessToken: connection.accessToken,
        expiresAt: new Date(Date.now() + 3600 * 1000 * 6).toISOString(),
      };
    },
    async fetchActivities(connection, since) {
      void connection;
      void since;
      if (!envKeys.every((k) => !!process.env[k])) {
        return sampleActivities(id, name);
      }
      return [];
    },
  };
}

const stravaProvider = createStubProvider(
  "strava",
  "Strava",
  ["STRAVA_CLIENT_ID", "STRAVA_CLIENT_SECRET"],
  (state, redirectUri) => {
    const params = new URLSearchParams({
      client_id: process.env.STRAVA_CLIENT_ID!,
      redirect_uri: redirectUri,
      response_type: "code",
      approval_prompt: "auto",
      scope: "activity:read_all",
      state,
    });
    return `https://www.strava.com/oauth/authorize?${params}`;
  }
);

const garminProvider = createStubProvider("garmin", "Garmin", [
  "GARMIN_CLIENT_ID",
  "GARMIN_CLIENT_SECRET",
]);

const polarProvider = createStubProvider("polar", "Polar", [
  "POLAR_CLIENT_ID",
  "POLAR_CLIENT_SECRET",
]);

const corosProvider = createStubProvider("coros", "Coros", [
  "COROS_CLIENT_ID",
  "COROS_CLIENT_SECRET",
]);

const fitbitProvider = createStubProvider("fitbit", "Fitbit", [
  "FITBIT_CLIENT_ID",
  "FITBIT_CLIENT_SECRET",
]);

const appleHealthProvider = createStubProvider("apple_health", "Apple Health", [
  "APPLE_HEALTH_TEAM_ID",
]);

export const PROVIDERS: Record<IntegrationProvider["id"], IntegrationProvider> = {
  strava: stravaProvider,
  garmin: garminProvider,
  polar: polarProvider,
  coros: corosProvider,
  fitbit: fitbitProvider,
  apple_health: appleHealthProvider,
};

export const PROVIDER_LIST = Object.values(PROVIDERS);

export function getProvider(id: string): IntegrationProvider | null {
  if (id in PROVIDERS) {
    return PROVIDERS[id as IntegrationProvider["id"]];
  }
  return null;
}

export function getCallbackUrl(providerId: string): string {
  return `${APP_URL}/api/integrations/callback/${providerId}`;
}

export function getConnectUrl(providerId: string): string {
  return `${APP_URL}/api/integrations/connect/${providerId}`;
}
