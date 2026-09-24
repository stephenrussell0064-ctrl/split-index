import type { SupabaseClient } from "@supabase/supabase-js";
import { ALCOHOL_LOOKBACK_HOURS, gramsToUnits, type DrinkEntry } from "./alcohol";

/**
 * The reads behind the Recovery score, in one place.
 *
 * The dashboard and the Recovery page both need exactly this data and they
 * must not disagree about it — two pages showing two different Recovery scores
 * for the same athlete on the same morning is the failure mode this file
 * exists to make impossible.
 */

/** A drink as it comes back out of the database. */
export interface DrinkRow {
  id: string;
  drank_at: string;
  grams_ethanol: number;
  preset_id: string | null;
  label: string;
  volume_ml: number | null;
  abv_percent: number | null;
  quantity: number;
  note: string | null;
}

export interface RecoveryInputs {
  drinks: DrinkRow[];
  /** Most recent HRV reading, if there is one. */
  hrvToday: number | null;
  /** Mean of the readings BEFORE today's — a baseline cannot include itself. */
  hrvBaseline: number | null;
  /** Session start times in the trailing 7 days. */
  recentSessionDates: string[];
  bodyweightKg: number | null;
}

/** How much drink history the page needs: enough for the weekly total and a month of trend. */
const DRINK_HISTORY_DAYS = 30;
const HRV_BASELINE_READINGS = 14;
const MS_PER_DAY = 86_400_000;

export async function fetchRecoveryInputs(
  supabase: SupabaseClient,
  userId: string,
  options: { profileWeightKg?: number | null } = {}
): Promise<RecoveryInputs> {
  const [{ data: drinks }, { data: hrvRows }, { data: sessions }, { data: bodyMetric }] =
    await Promise.all([
      supabase
        .from("drink_logs")
        .select("id, drank_at, grams_ethanol, preset_id, label, volume_ml, abv_percent, quantity, note")
        .eq("user_id", userId)
        .gte("drank_at", new Date(Date.now() - DRINK_HISTORY_DAYS * MS_PER_DAY).toISOString())
        .order("drank_at", { ascending: false })
        .limit(500),
      supabase
        .from("recovery_snapshots")
        .select("hrv_ms, recorded_at")
        .eq("user_id", userId)
        .not("hrv_ms", "is", null)
        .order("recorded_at", { ascending: false })
        .limit(HRV_BASELINE_READINGS + 1),
      supabase
        .from("activities")
        .select("started_at")
        .eq("user_id", userId)
        .eq("is_draft", false)
        .gte("started_at", new Date(Date.now() - 7 * MS_PER_DAY).toISOString())
        .order("started_at", { ascending: false })
        .limit(60),
      /*
       * Bodyweight drives grams-per-kilogram, which is the whole dose model, so
       * the freshest number wins: body_metrics is updated every time the athlete
       * weighs in, while profiles.weight_kg is whatever they typed at signup and
       * can be years stale. The profile value is the fallback, not the source.
       */
      supabase
        .from("body_metrics")
        .select("weight_kg")
        .eq("user_id", userId)
        .order("recorded_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  const hrvReadings = (hrvRows ?? [])
    .map((r) => Number(r.hrv_ms))
    .filter((v) => Number.isFinite(v) && v > 0);
  const hrvToday = hrvReadings[0] ?? null;
  const priorReadings = hrvReadings.slice(1);
  const hrvBaseline =
    priorReadings.length > 0
      ? priorReadings.reduce((sum, v) => sum + v, 0) / priorReadings.length
      : null;

  return {
    drinks: (drinks ?? []) as DrinkRow[],
    hrvToday,
    hrvBaseline,
    recentSessionDates: (sessions ?? []).map((s) => s.started_at as string),
    bodyweightKg:
      (bodyMetric?.weight_kg != null ? Number(bodyMetric.weight_kg) : null) ??
      (options.profileWeightKg != null ? Number(options.profileWeightKg) : null),
  };
}

/** Database rows to the shape the model reads. */
export function toDrinkEntries(rows: DrinkRow[]): DrinkEntry[] {
  return rows
    .map((r) => ({ drankAt: new Date(r.drank_at), gramsEthanol: Number(r.grams_ethanol) }))
    .filter((d) => !Number.isNaN(d.drankAt.getTime()) && Number.isFinite(d.gramsEthanol));
}

/** Units per local calendar day, newest last — the weekly chart's series. */
export function dailyUnits(
  rows: DrinkRow[],
  days: number,
  now: Date = new Date()
): { date: string; units: number }[] {
  const buckets = new Map<string, number>();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * MS_PER_DAY);
    buckets.set(d.toISOString().slice(0, 10), 0);
  }
  for (const row of rows) {
    const key = new Date(row.drank_at).toISOString().slice(0, 10);
    if (buckets.has(key)) {
      buckets.set(key, (buckets.get(key) ?? 0) + gramsToUnits(Number(row.grams_ethanol)));
    }
  }
  return [...buckets.entries()].map(([date, units]) => ({
    date,
    units: Math.round(units * 10) / 10,
  }));
}

/** Drinks inside the window the acute model reads, newest first. */
export function drinksInRecoveryWindow(rows: DrinkRow[], now: Date = new Date()): DrinkRow[] {
  const cutoff = now.getTime() - ALCOHOL_LOOKBACK_HOURS * 3_600_000;
  return rows.filter((r) => new Date(r.drank_at).getTime() >= cutoff);
}
