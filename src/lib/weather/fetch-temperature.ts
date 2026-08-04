/**
 * Auto-captures temperature for GPS-tracked outdoor sessions so the user
 * never has to type it in manually — Open-Meteo is free, needs no API key
 * or signup, and returns current conditions for any lat/lon worldwide.
 * Fails soft: temperature is a nice-to-have annotation on an activity, never
 * something that should block saving a run if the network call is slow or
 * the service is briefly down.
 */
export async function fetchCurrentTemperatureCelsius(
  latitude: number,
  longitude: number
): Promise<number | null> {
  try {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", latitude.toFixed(4));
    url.searchParams.set("longitude", longitude.toFixed(4));
    url.searchParams.set("current", "temperature_2m");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(url.toString(), { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) return null;
    const data = (await res.json()) as { current?: { temperature_2m?: number } };
    const temp = data.current?.temperature_2m;
    return typeof temp === "number" ? Math.round(temp * 10) / 10 : null;
  } catch {
    return null;
  }
}
