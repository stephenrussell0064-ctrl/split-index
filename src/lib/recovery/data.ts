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
  /**
   * Which instrument today's reading came from. The baseline is built from
   * readings of the SAME source only: Apple reports SDNN, the manual entry is
   * rMSSD, and a baseline that mixed them would compare today against a
   * number measured a different way. Null when there is no reading.
   */
  hrvSource: "manual" | "apple_health" | null;
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
      /*
       * More than the window, because the window is per SOURCE: the newest
       * reading decides which instrument today's number is from, and only
       * readings from that instrument form its baseline (migration 089). A
       * fortnight of Apple readings with one typed rMSSD among them must not
       * put that typed value in the baseline.
       */
      supabase
        .from("recovery_snapshots")
        .select("hrv_ms, recorded_at, source")
        .eq("user_id", userId)
        .not("hrv_ms", "is", null)
        .order("recorded_at", { ascending: false })
        .limit((HRV_BASELINE_READINGS + 1) * 2),
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

  const { hrvToday, hrvBaseline, hrvSource } = hrvFromReadings(
    (hrvRows ?? []).map((r) => ({
      hrv_ms: r.hrv_ms as number | string | null,
      // Rows written before 089 carry no column; they were all typed.
      source: (r as { source?: string | null }).source ?? "manual",
    }))
  );

  return {
    drinks: (drinks ?? []) as DrinkRow[],
    hrvToday,
    hrvBaseline,
    hrvSource,
    recentSessionDates: (sessions ?? []).map((s) => s.started_at as string),
    bodyweightKg:
      (bodyMetric?.weight_kg != null ? Number(bodyMetric.weight_kg) : null) ??
      (options.profileWeightKg != null ? Number(options.profileWeightKg) : null),
  };
}

/**
 * Today's reading and its baseline from rows newest-first, per source.
 *
 * The newest reading is today's. Its baseline is the mean of up to
 * HRV_BASELINE_READINGS EARLIER readings from the same source — a baseline
 * cannot include itself, and it cannot mix instruments. Exported for the
 * test; the page calls fetchRecoveryInputs.
 */
export function hrvFromReadings(
  rows: { hrv_ms: number | string | null; source?: string | null }[]
): { hrvToday: number | null; hrvBaseline: number | null; hrvSource: "manual" | "apple_health" | null } {
  const readings = rows
    .map((r) => ({
      value: Number(r.hrv_ms),
      source: r.source === "apple_health" ? ("apple_health" as const) : ("manual" as const),
    }))
    .filter((r) => Number.isFinite(r.value) && r.value > 0);
  const today = readings[0];
  if (!today) return { hrvToday: null, hrvBaseline: null, hrvSource: null };
  const prior = readings
    .slice(1)
    .filter((r) => r.source === today.source)
    .slice(0, HRV_BASELINE_READINGS);
  return {
    hrvToday: today.value,
    hrvBaseline: prior.length > 0 ? prior.reduce((sum, r) => sum + r.value, 0) / prior.length : null,
    hrvSource: today.source,
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
