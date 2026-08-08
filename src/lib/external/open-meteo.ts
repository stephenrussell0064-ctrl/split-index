/**
 * Open-Meteo (open-meteo.com) — free, no-API-key weather forecast and
 * geocoding service, used for race-day condition adjustments (see
 * scoring/cardio/race-conditions.ts). No account, key, or payment method
 * needed for this non-commercial usage tier — deliberately chosen over
 * any provider that would require setting one up.
 *
 * Both functions fail soft: a network error, timeout, or "no data for
 * this date" (the forecast API only covers roughly the next ~16 days —
 * further-out races simply get no adjustment yet) returns null rather
 * than throwing, since a missing weather adjustment should never block
 * saving or viewing a planned race.
 */

const FETCH_TIMEOUT_MS = 5000;

async function fetchWithTimeout(url: string): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    return res;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export interface GeocodedLocation {
  latitude: number;
  longitude: number;
  /** Resolved place name, for display confirmation — may differ slightly from what was typed. */
  resolvedName: string;
}

export async function geocodeLocation(query: string): Promise<GeocodedLocation | null> {
  const trimmed = query.trim();
  if (!trimmed) return null;

  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(trimmed)}&count=1&language=en&format=json`;
  const res = await fetchWithTimeout(url);
  if (!res) return null;

  try {
    const data = (await res.json()) as {
      results?: Array<{ latitude: number; longitude: number; name: string; country?: string; admin1?: string }>;
    };
    const top = data.results?.[0];
    if (!top) return null;
    const parts = [top.name, top.admin1, top.country].filter(Boolean);
    return { latitude: top.latitude, longitude: top.longitude, resolvedName: parts.join(", ") };
  } catch {
    return null;
  }
}

export interface DailyForecast {
  tempMaxCelsius: number;
  windMaxKph: number;
}

/** dateIso: "YYYY-MM-DD". Only returns data for dates within the forecast's actual coverage window (~16 days out). */
export async function fetchDailyForecast(
  latitude: number,
  longitude: number,
  dateIso: string
): Promise<DailyForecast | null> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
    `&daily=temperature_2m_max,wind_speed_10m_max&timezone=auto&start_date=${dateIso}&end_date=${dateIso}`;
  const res = await fetchWithTimeout(url);
  if (!res) return null;

  try {
    const data = (await res.json()) as {
      daily?: { temperature_2m_max?: number[]; wind_speed_10m_max?: number[] };
    };
    const tempMaxCelsius = data.daily?.temperature_2m_max?.[0];
    const windMaxKph = data.daily?.wind_speed_10m_max?.[0];
    if (tempMaxCelsius == null || windMaxKph == null) return null;
    return { tempMaxCelsius, windMaxKph };
  } catch {
    return null;
  }
}
