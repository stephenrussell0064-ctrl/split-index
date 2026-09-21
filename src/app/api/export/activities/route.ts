import { parseQuery } from "@/lib/validation/boundary";
import { exportQuerySchema } from "@/lib/validation/schemas/query";
import { NextResponse } from "next/server";
import { databaseError } from "@/lib/api/errors";
import { missingColumn } from "@/lib/activities/degradable-write";
import { createClient } from "@/lib/supabase/server";
import {
  PREMIUM_REQUIRED,
  allows,
  getEntitlements,
  logEntitlementDenial,
} from "@/lib/premium/entitlements";

function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return s.includes(",") || s.includes('"') || s.includes("\n")
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };
  const lines = [
    headers.join(","),
    ...rows.map((row) => headers.map((h) => escape(row[h])).join(",")),
  ];
  return lines.join("\n");
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  /*
   * One resolver, not a per-route profile query. getEntitlements reads only
   * state the payment webhooks write and fails closed on anything it cannot
   * read — including the "no profile" case this route used to handle with its
   * own 404, which was a different answer to the same question.
   */
  const entitlements = await getEntitlements(supabase, user.id);

  if (!allows(entitlements, "data_export")) {
    logEntitlementDenial(entitlements, "data_export", "/api/export/activities");
    return NextResponse.json(PREMIUM_REQUIRED, { status: 403 });
  }

  // N1. Was `?? "json"`, so `?format=xml` fell through as "xml" and whatever
  // read it decided what that meant. The enum falls back to json instead.
  const q = parseQuery(request, exportQuerySchema);
  if (q.response) return q.response;
  const format = q.data.format;

  // Two literal selects rather than one interpolated string: the Supabase
  // client parses the column list at the TYPE level, and a template literal
  // defeats that parser, turning every field on the result into an error type.
  //
  // personal_index arrived with migration 077. An export is the athlete's own
  // copy of their data and must not fail wholesale because one column is not
  // there yet — it comes back without that field instead.
  const withPersonal = await supabase
    .from("activities")
    .select(
      "id, sport, title, started_at, duration_seconds, distance_meters, elevation_meters, avg_heart_rate, max_heart_rate, avg_power_watts, avg_pace_seconds_per_km, session_type, rpe, notes, source, created_at, workout_scores(sport_index, personal_index, load_score, endurance_component, strength_component)"
    )
    .eq("user_id", user.id)
    .eq("is_draft", false)
    .order("started_at", { ascending: false });

  let activities = withPersonal.data as Record<string, unknown>[] | null;
  let error = withPersonal.error;

  if (error && missingColumn(error, ["personal_index"])) {
    const fallback = await supabase
      .from("activities")
      .select(
        "id, sport, title, started_at, duration_seconds, distance_meters, elevation_meters, avg_heart_rate, max_heart_rate, avg_power_watts, avg_pace_seconds_per_km, session_type, rpe, notes, source, created_at, workout_scores(sport_index, load_score, endurance_component, strength_component)"
      )
      .eq("user_id", user.id)
      .eq("is_draft", false)
      .order("started_at", { ascending: false });
    activities = fallback.data as Record<string, unknown>[] | null;
    error = fallback.error;
  }

  if (error) {
    return databaseError(error, { operation: "GET /api/export/activities" });
  }

  type ScoreRow = {
    sport_index?: number | null;
    personal_index?: number | null;
    load_score?: number | null;
    endurance_component?: number | null;
    strength_component?: number | null;
  };

  const exportRows = (activities ?? []).map((a) => {
    const raw = a.workout_scores;
    const ws = (Array.isArray(raw) ? raw[0] : raw) as ScoreRow | undefined;
    return {
      id: a.id,
      sport: a.sport,
      title: a.title,
      started_at: a.started_at,
      duration_seconds: a.duration_seconds,
      distance_meters: a.distance_meters,
      elevation_meters: a.elevation_meters,
      avg_heart_rate: a.avg_heart_rate,
      max_heart_rate: a.max_heart_rate,
      avg_power_watts: a.avg_power_watts,
      avg_pace_seconds_per_km: a.avg_pace_seconds_per_km,
      session_type: a.session_type,
      rpe: a.rpe,
      notes: a.notes,
      source: a.source,
      sport_index: ws?.sport_index ?? null,
      personal_index: ws?.personal_index ?? null,
      load_score: ws?.load_score ?? null,
      endurance_component: ws?.endurance_component ?? null,
      strength_component: ws?.strength_component ?? null,
    };
  });

  if (format === "csv") {
    const csv = toCsv(exportRows as Record<string, unknown>[]);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="split-index-activities.csv"`,
      },
    });
  }

  return NextResponse.json({
    exported_at: new Date().toISOString(),
    count: exportRows.length,
    // From the same resolver that authorised the export, so the tier reported
    // in the file cannot disagree with the tier that allowed it.
    tier: entitlements.plan,
    activities: exportRows,
  });
}
