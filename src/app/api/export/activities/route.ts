import { NextResponse } from "next/server";
import { databaseError } from "@/lib/api/errors";
import { createClient } from "@/lib/supabase/server";
import { PREMIUM_REQUIRED, allows, getEntitlements } from "@/lib/premium/entitlements";

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
    return NextResponse.json(PREMIUM_REQUIRED, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const format = searchParams.get("format") ?? "json";

  const { data: activities, error } = await supabase
    .from("activities")
    .select(
      "id, sport, title, started_at, duration_seconds, distance_meters, elevation_meters, avg_heart_rate, max_heart_rate, avg_power_watts, avg_pace_seconds_per_km, session_type, rpe, notes, source, created_at, workout_scores(sport_index, load_score, endurance_component, strength_component)"
    )
    .eq("user_id", user.id)
    .eq("is_draft", false)
    .order("started_at", { ascending: false });

  if (error) {
    return databaseError(error, { operation: "GET /api/export/activities" });
  }

  const exportRows = (activities ?? []).map((a) => {
    const ws = Array.isArray(a.workout_scores)
      ? a.workout_scores[0]
      : a.workout_scores;
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
