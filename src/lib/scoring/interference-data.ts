import type { SupabaseClient } from "@supabase/supabase-js";
import { getCrossDomainTimeline } from "./timeline";
import { computeInterferenceReport, type InterferenceReport } from "./interference";

/** Wide enough to give the pairing algorithm a real shot at MIN_PAIRED_SESSIONS without diluting recency too much. */
export const INTERFERENCE_LOOKBACK_DAYS = 90;

export async function fetchInterferenceReport(
  supabase: SupabaseClient,
  userId: string
): Promise<InterferenceReport> {
  const since = new Date(Date.now() - INTERFERENCE_LOOKBACK_DAYS * 86400000).toISOString();
  const sessions = await getCrossDomainTimeline(supabase, userId, { since });
  return computeInterferenceReport(sessions);
}
