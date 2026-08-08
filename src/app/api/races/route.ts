import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { geocodeLocation, fetchDailyForecast } from "@/lib/external/open-meteo";
import { applyRaceConditionAdjustments } from "@/lib/scoring/cardio/race-conditions";

const MIN_DISTANCE_METERS = 100;
const MAX_DISTANCE_METERS = 250_000; // generous ultra-distance ceiling
/** Open-Meteo's forecast only actually covers roughly this many days out — beyond it, fetchDailyForecast returns null and the race just shows an unadjusted prediction. */
const FORECAST_WINDOW_DAYS = 16;
const DEFAULT_RIEGEL_K = 1.06; // intermediate default, matches cardio-activity.ts's riegelPredictions

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const eventName = String(body.eventName ?? "").trim();
  const locationName = String(body.locationName ?? "").trim();
  const raceDate = String(body.raceDate ?? "");
  const distanceMeters = Number(body.distanceMeters);
  const elevationGainMeters =
    body.elevationGainMeters != null && body.elevationGainMeters !== ""
      ? Number(body.elevationGainMeters)
      : null;
  const notes = body.notes ? String(body.notes).trim() : null;

  if (!eventName) {
    return NextResponse.json({ error: "Event name is required" }, { status: 400 });
  }
  if (!raceDate || Number.isNaN(new Date(raceDate).getTime())) {
    return NextResponse.json({ error: "A valid race date is required" }, { status: 400 });
  }
  if (
    !Number.isFinite(distanceMeters) ||
    distanceMeters < MIN_DISTANCE_METERS ||
    distanceMeters > MAX_DISTANCE_METERS
  ) {
    return NextResponse.json({ error: "Distance must be a realistic race distance" }, { status: 400 });
  }
  if (elevationGainMeters != null && (!Number.isFinite(elevationGainMeters) || elevationGainMeters < 0)) {
    return NextResponse.json({ error: "Elevation gain must be a positive number" }, { status: 400 });
  }

  // Best-effort — a failed/unresolved geocode still lets the race be saved,
  // it just won't get a weather-based adjustment later (see GET below).
  const geocoded = locationName ? await geocodeLocation(locationName) : null;

  const { data: race, error } = await supabase
    .from("planned_races")
    .insert({
      user_id: user.id,
      event_name: eventName,
      location_name: locationName || geocoded?.resolvedName || "Unknown location",
      latitude: geocoded?.latitude ?? null,
      longitude: geocoded?.longitude ?? null,
      race_date: raceDate,
      distance_meters: Math.round(distanceMeters),
      elevation_gain_meters: elevationGainMeters != null ? Math.round(elevationGainMeters) : null,
      notes,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ race, geocodeFailed: !!locationName && !geocoded });
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const today = new Date().toISOString().slice(0, 10);

  const [{ data: races, error }, { data: benchmark }] = await Promise.all([
    supabase
      .from("planned_races")
      .select("*")
      .eq("user_id", user.id)
      .gte("race_date", today)
      .order("race_date", { ascending: true }),
    supabase
      .from("predicted_benchmarks")
      .select("benchmark_seconds, riegel_k")
      .eq("user_id", user.id)
      .eq("sport", "run")
      .maybeSingle(),
  ]);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const base5kSeconds = benchmark?.benchmark_seconds ?? null;
  const riegelK = benchmark?.riegel_k ?? DEFAULT_RIEGEL_K;

  const enriched = await Promise.all(
    (races ?? []).map(async (race) => {
      let basePredictionSeconds: number | null = null;
      if (base5kSeconds) {
        basePredictionSeconds =
          base5kSeconds * Math.pow(race.distance_meters / 5000, riegelK);
      }

      const daysOut = Math.round(
        (new Date(race.race_date as string).getTime() - Date.now()) / 86400000
      );
      const forecast =
        daysOut <= FORECAST_WINDOW_DAYS && race.latitude != null && race.longitude != null
          ? await fetchDailyForecast(
              race.latitude as number,
              race.longitude as number,
              race.race_date as string
            )
          : null;

      const adjustment =
        basePredictionSeconds != null
          ? applyRaceConditionAdjustments({
              distanceMeters: race.distance_meters as number,
              baseSeconds: basePredictionSeconds,
              elevationGainMeters: race.elevation_gain_meters as number | null,
              forecastTempCelsius: forecast?.tempMaxCelsius ?? null,
              forecastWindKph: forecast?.windMaxKph ?? null,
            })
          : null;

      return {
        ...race,
        daysOut,
        basePredictionSeconds,
        forecast,
        adjustment,
      };
    })
  );

  return NextResponse.json({ races: enriched });
}
