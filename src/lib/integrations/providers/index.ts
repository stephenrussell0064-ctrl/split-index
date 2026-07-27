import type { SportType, SessionType } from "@/types";
import type { ExternalActivity } from "../types";
import type { IntegrationProvider, ProviderConnection } from "./types";

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

const STRAVA_TOKEN_URL = "https://www.strava.com/oauth/token";
const STRAVA_API_BASE = "https://www.strava.com/api/v3";

/**
 * Strava's `type` field (their older, coarser activity classification —
 * still always present, unlike the newer `sport_type` which is a superset).
 * Only mapped where a real, non-guessed SportType exists on our side —
 * anything unmapped (Strava has ~30 types: yoga, surfing, alpine skiing...)
 * is skipped rather than forced into the wrong bucket, since a wrong sport
 * assignment corrupts scoring worse than just not importing that session.
 * Genuinely outdoor ride types (Ride/GravelRide/MountainBikeRide/EBikeRide)
 * map to outdoor_cycling (Slice F: sport-coverage gaps) — VirtualRide stays
 * on indoor_cycling since it's simulated/stationary (Zwift etc.), matching
 * the trainer-context assumption indoor_cycling's scoring already makes.
 */
export const STRAVA_TYPE_TO_SPORT: Partial<Record<string, SportType>> = {
  Run: "running",
  TrailRun: "running",
  VirtualRun: "running",
  Walk: "walking",
  Hike: "walking",
  Swim: "swimming",
  Rowing: "rowing",
  VirtualRow: "rowing",
  Ride: "outdoor_cycling",
  VirtualRide: "indoor_cycling",
  GravelRide: "outdoor_cycling",
  MountainBikeRide: "outdoor_cycling",
  EBikeRide: "outdoor_cycling",
  WeightTraining: "gym",
  Workout: "gym",
  Crossfit: "gym",
};

/** Strava's numeric workout_type (run: 0=default,1=race,2=long run,3=workout; ride: 10/11/12/13 mirror the same meaning) — mapped where it unambiguously implies one of our SessionTypes. */
export function stravaWorkoutTypeToSessionType(workoutType: number | null | undefined): SessionType | undefined {
  switch (workoutType) {
    case 1:
    case 11:
      return "race";
    case 2:
    case 13:
      return "long";
    case 3:
    case 12:
      return "interval";
    default:
      return undefined;
  }
}

interface StravaSummaryActivity {
  id: number;
  name: string;
  type: string;
  start_date: string;
  elapsed_time: number;
  moving_time: number;
  distance: number;
  total_elevation_gain: number | null;
  average_heartrate?: number | null;
  max_heartrate?: number | null;
  average_watts?: number | null;
  average_cadence?: number | null;
  average_temp?: number | null;
  workout_type?: number | null;
}

export function mapStravaActivity(a: StravaSummaryActivity): ExternalActivity | null {
  const sport = STRAVA_TYPE_TO_SPORT[a.type];
  if (!sport) return null;
  return {
    external_id: String(a.id),
    source: "strava",
    sport,
    title: a.name,
    started_at: a.start_date,
    // moving_time (excludes stopped time) rather than elapsed_time — closer
    // to what a user would report by hand for "how long was my session."
    duration_seconds: a.moving_time,
    distance_meters: a.distance > 0 ? a.distance : undefined,
    elevation_meters: a.total_elevation_gain ?? undefined,
    avg_heart_rate: a.average_heartrate ?? undefined,
    max_heart_rate: a.max_heartrate ?? undefined,
    avg_power_watts: a.average_watts ?? undefined,
    avg_cadence: a.average_cadence ?? undefined,
    temperature_celsius: a.average_temp ?? undefined,
    session_type: stravaWorkoutTypeToSessionType(a.workout_type),
  };
}

function stravaConfigured(): boolean {
  return !!process.env.STRAVA_CLIENT_ID && !!process.env.STRAVA_CLIENT_SECRET;
}

interface StravaTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_at: number; // unix seconds
  athlete?: { id: number };
}

async function stravaTokenRequest(body: Record<string, string>): Promise<ProviderConnection> {
  const res = await fetch(STRAVA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.STRAVA_CLIENT_ID!,
      client_secret: process.env.STRAVA_CLIENT_SECRET!,
      ...body,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Strava token request failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as StravaTokenResponse;
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(data.expires_at * 1000).toISOString(),
    providerUserId: data.athlete?.id != null ? String(data.athlete.id) : null,
  };
}

const stravaProvider: IntegrationProvider = {
  id: "strava",
  name: "Strava",
  isConfigured: stravaConfigured,

  getAuthUrl(state, redirectUri) {
    if (!stravaConfigured()) return null;
    const params = new URLSearchParams({
      client_id: process.env.STRAVA_CLIENT_ID!,
      redirect_uri: redirectUri,
      response_type: "code",
      approval_prompt: "auto",
      scope: "activity:read_all",
      state,
    });
    return `https://www.strava.com/oauth/authorize?${params}`;
  },

  async exchangeCode(code, _redirectUri) {
    void _redirectUri; // Strava's token endpoint doesn't require redirect_uri on exchange, unlike some OAuth providers
    if (!stravaConfigured() || code === "stub") {
      return {
        accessToken: `stub_strava_${Date.now()}`,
        refreshToken: "stub_refresh_strava",
        expiresAt: new Date(Date.now() + 3600 * 1000 * 6).toISOString(),
        providerUserId: "stub_user_strava",
      };
    }
    return stravaTokenRequest({ code, grant_type: "authorization_code" });
  },

  async refreshAccessToken(connection) {
    if (!stravaConfigured() || !connection.refreshToken) {
      return {
        ...connection,
        expiresAt: new Date(Date.now() + 3600 * 1000 * 6).toISOString(),
      };
    }
    return stravaTokenRequest({
      refresh_token: connection.refreshToken,
      grant_type: "refresh_token",
    });
  },

  async fetchActivities(connection, since) {
    if (!stravaConfigured()) return [];

    const after = Math.floor(since.getTime() / 1000);
    const activities: ExternalActivity[] = [];
    let page = 1;
    const perPage = 100;
    const maxPages = 10; // hard cap — 1000 activities per sync is generous for a periodic job

    while (page <= maxPages) {
      const url = `${STRAVA_API_BASE}/athlete/activities?after=${after}&per_page=${perPage}&page=${page}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${connection.accessToken}` },
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Strava activities request failed (${res.status}): ${text.slice(0, 200)}`);
      }
      const batch = (await res.json()) as StravaSummaryActivity[];
      for (const raw of batch) {
        const mapped = mapStravaActivity(raw);
        if (mapped) activities.push(mapped);
      }
      if (batch.length < perPage) break;
      page += 1;
    }

    return activities;
  },
};

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
