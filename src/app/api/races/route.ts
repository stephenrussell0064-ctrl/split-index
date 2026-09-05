import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { geocodeLocation, fetchDailyForecast } from "@/lib/external/open-meteo";
import { applyRaceConditionAdjustments } from "@/lib/scoring/cardio/race-conditions";

const MIN_DISTANCE_METERS = 100;
const MAX_DISTANCE_METERS = 250_000; // generous ultra-distance ceiling
/** Open-Meteo's forecast only actually covers roughly this many days out — beyond it, fetchDailyForecast returns null and the race just shows an unadjusted prediction. */
const FORECAST_WINDOW_DAYS = 16;
const DEFAULT_RIEGEL_K = 1.06; // intermediate default, matches cardio-activity.ts's riegelPredictions

/**
 * User feedback: "i want this to take the data from as many online racing
 * venues found as possible with their recorded elevation gain and the
 * level of difficulty runners find from these venues." No free, universal
 * database of crowd race-difficulty reviews exists to scrape reliably —
 * this builds the same idea from Split Index's own first-party data
 * instead, which no external review site can offer: how much *this app's*
 * users' actual times deviated from their own flat, condition-blind
 * predictions on the same course, averaged across every other user who's
 * logged that race. That's a real difficulty signal (terrain, footing,
 * crowding, anything a scraped elevation number can't capture) and it
 * improves automatically as more people log the same race — no manual
 * curation, no scraping, no third-party dependency.
 *
 * Matched by event name with year tokens stripped ("London Marathon
 * 2026" and "London Marathon 2025" both normalize to "london marathon")
 * so a recurring annual race pools data across every year it's been run,
 * not just exact-date matches — useful for an *upcoming* race, where no
 * one else could possibly have logged that exact future date yet.
 */
function normalizeEventName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(19|20)\d{2}\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Never surface an aggregate built from just one other person — that would just be their time with extra steps. */
const MIN_CROWD_SAMPLE_SIZE = 2;
/** How far a logged "race" activity's own date may drift from the athlete's *own* planned race_date — same-day is the common case, a day either side covers timezone edges. */
const RACE_ACTIVITY_DATE_TOLERANCE_DAYS = 1;
/** How far a candidate activity's distance may drift from the planned distance and still count as "the same race" (5K vs 5K fun-run-that's-actually-5.2K, etc). */
const DISTANCE_MATCH_TOLERANCE_FRACTION = 0.1;

export interface CrowdDifficulty {
  averageDeltaPct: number;
  sampleCount: number;
}

async function computeCrowdDifficulty(
  admin: ReturnType<typeof createAdminClient>,
  currentUserId: string,
  eventName: string,
  distanceMeters: number
): Promise<CrowdDifficulty | null> {
  const normalizedTarget = normalizeEventName(eventName);
  if (!normalizedTarget) return null;

  const { data: candidatePlans } = await admin
    .from("planned_races")
    .select("user_id, race_date, distance_meters, event_name")
    .neq("user_id", currentUserId);

  // Same event name doesn't always mean the same distance — a "Marathon
  // Weekend" often hosts a 5K/10K/half/full on the same day under
  // near-identical names, and pooling those would corrupt the average.
  const matchingPlans = (candidatePlans ?? []).filter((p) => {
    if (normalizeEventName(p.event_name as string) !== normalizedTarget) return false;
    const otherDistance = p.distance_meters as number;
    return Math.abs(otherDistance - distanceMeters) / distanceMeters <= DISTANCE_MATCH_TOLERANCE_FRACTION;
  });
  if (matchingPlans.length === 0) return null;

  const deltas: number[] = [];

  for (const plan of matchingPlans) {
    const planDate = new Date(plan.race_date as string);
    const windowStart = new Date(planDate.getTime() - RACE_ACTIVITY_DATE_TOLERANCE_DAYS * 86400000)
      .toISOString()
      .slice(0, 10);
    const windowEnd = new Date(planDate.getTime() + RACE_ACTIVITY_DATE_TOLERANCE_DAYS * 86400000)
      .toISOString()
      .slice(0, 10);

    const { data: activities } = await admin
      .from("activities")
      .select("id, distance_meters, duration_seconds, started_at")
      .eq("user_id", plan.user_id)
      .eq("sport", "running")
      .eq("session_type", "race")
      .eq("is_draft", false)
      .gte("started_at", `${windowStart}T00:00:00`)
      .lte("started_at", `${windowEnd}T23:59:59`);

    const planDistance = plan.distance_meters as number;
    const match = (activities ?? []).find((a) => {
      const d = a.distance_meters as number | null;
      if (d == null) return false;
      return Math.abs(d - planDistance) / planDistance <= DISTANCE_MATCH_TOLERANCE_FRACTION;
    });
    if (!match || match.duration_seconds == null) continue;

    const { data: theirBenchmark } = await admin
      .from("predicted_benchmarks")
      .select("benchmark_seconds, riegel_k")
      .eq("user_id", plan.user_id)
      .eq("sport", "run")
      .maybeSingle();
    if (!theirBenchmark?.benchmark_seconds) continue;

    const predicted =
      (theirBenchmark.benchmark_seconds as number) *
      Math.pow(planDistance / 5000, (theirBenchmark.riegel_k as number | null) ?? DEFAULT_RIEGEL_K);
    if (predicted <= 0) continue;

    deltas.push(((match.duration_seconds as number) - predicted) / predicted);
  }

  if (deltas.length < MIN_CROWD_SAMPLE_SIZE) return null;

  const averageDeltaPct =
    Math.round((deltas.reduce((sum, d) => sum + d, 0) / deltas.length) * 1000) / 10;

  return { averageDeltaPct, sampleCount: deltas.length };
}

/**
 * Postgres check-constraint violation. Supabase surfaces the raw SQLSTATE,
 * which is the only reliable way to tell "the athlete typed something
 * impossible" apart from "this database is a migration behind".
 */
const CHECK_VIOLATION = "23514";

interface PlannedRaceInsert {
  user_id: string;
  event_name: string;
  location_name: string;
  latitude: number | null;
  longitude: number | null;
  race_date: string;
  distance_meters: number;
  elevation_gain_meters: number | null;
  elevation_source: "manual" | "gpx" | "known" | null;
  notes: string | null;
}

interface InsertFailure {
  code?: string;
  message?: string;
  details?: string | null;
}

/**
 * Migration 037 widened planned_races.elevation_source to allow 'known'
 * (elevation taken from the curated known-race dropdown). A database that
 * hasn't had 037 applied yet still only allows ('manual','gpx') and rejects
 * the insert outright — which silently killed *every* race saved through
 * that dropdown, the first and most prominent control in the Add-race form.
 */
function isElevationSourceCheckViolation(error: InsertFailure | null): boolean {
  if (!error || error.code !== CHECK_VIOLATION) return false;
  const text = `${error.message ?? ""} ${error.details ?? ""}`;
  return text.includes("elevation_source");
}

async function insertPlannedRace(
  supabase: Awaited<ReturnType<typeof createClient>>,
  row: PlannedRaceInsert
) {
  const { data, error } = await supabase.from("planned_races").insert(row).select().single();
  return { race: data, error: error as InsertFailure | null };
}

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
  const elevationSource =
    body.elevationSource === "gpx" || body.elevationSource === "manual" || body.elevationSource === "known"
      ? body.elevationSource
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

  const row: PlannedRaceInsert = {
    user_id: user.id,
    event_name: eventName,
    location_name: locationName || geocoded?.resolvedName || "Unknown location",
    latitude: geocoded?.latitude ?? null,
    longitude: geocoded?.longitude ?? null,
    race_date: raceDate,
    distance_meters: Math.round(distanceMeters),
    elevation_gain_meters: elevationGainMeters != null ? Math.round(elevationGainMeters) : null,
    elevation_source: elevationGainMeters != null ? (elevationSource ?? "manual") : null,
    notes,
  };

  let { race, error } = await insertPlannedRace(supabase, row);

  // The elevation figure itself is real whichever database this lands in —
  // only the label describing where it came from is unknown to a pre-037
  // schema. Losing the athlete's whole race entry over a provenance label
  // is the worse outcome, so downgrade the label, keep the race, and say so
  // in the response. Self-heals the moment migration 037 is applied.
  let elevationSourceDegraded = false;
  if (isElevationSourceCheckViolation(error) && row.elevation_source === "known") {
    console.warn(
      "[api/races] planned_races.elevation_source rejected 'known' — migration 037 " +
        "is not applied to this database. Saving with 'manual' instead."
    );
    ({ race, error } = await insertPlannedRace(supabase, { ...row, elevation_source: "manual" }));
    elevationSourceDegraded = !error;
  }

  if (error || !race) {
    // Never hand a raw Postgres sentence to an athlete, but never swallow it
    // either — `detail` is what turns "it just doesn't work" into something
    // anyone can act on.
    console.error("[api/races] planned_races insert failed", error);
    return NextResponse.json(
      {
        error: "Could not save this race. Nothing was saved — please try again.",
        detail: error?.message ?? "The database accepted the request but returned no race.",
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    race,
    geocodeFailed: !!locationName && !geocoded,
    elevationSourceDegraded,
  });
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
  const admin = createAdminClient();

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

      const crowdDifficulty = await computeCrowdDifficulty(
        admin,
        user.id,
        race.event_name as string,
        race.distance_meters as number
      );

      return {
        ...race,
        daysOut,
        basePredictionSeconds,
        forecast,
        adjustment,
        crowdDifficulty,
      };
    })
  );

  return NextResponse.json({ races: enriched });
}
