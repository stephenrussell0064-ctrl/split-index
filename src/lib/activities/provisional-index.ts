import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Remove the onboarding estimate once the athlete has a real scored session.
 *
 * Onboarding writes one `split_index_history` row from self-reported bests so a
 * new user sees a number before they have logged anything. It is the only row
 * in that table with no activity behind it, and that made it immortal: every
 * other writer deletes and re-inserts BY activity_id, so nothing the app did
 * could ever find it again. Migration 059 marks it `is_provisional` and ranks
 * it below every scored session; this is what actually clears it.
 *
 * Called after a real history row is written. Two reasons it is worth doing
 * rather than relying on the ranking alone:
 *
 *   * The trend charts read every history row, so an estimate left in the table
 *     puts a made-up point on the athlete's chart for the life of the account —
 *     stamped at signup, which is usually a discontinuity next to the
 *     back-dated sessions around it.
 *   * A row nothing can delete is a row nobody can correct. The estimate has
 *     served its purpose the moment there is something real to replace it.
 *
 * Best-effort: a failure here must never fail the save that triggered it. The
 * athlete's session is the thing that matters and it is already written; a
 * lingering estimate is untidy, not harmful, and migration 059's own DELETE
 * sweeps up anything this misses.
 */
export async function clearProvisionalIndexHistory(
  supabase: SupabaseClient,
  userId: string
): Promise<void> {
  try {
    await supabase
      .from("split_index_history")
      .delete()
      .eq("user_id", userId)
      .eq("is_provisional", true);
  } catch {
    // Deliberately silent — see above.
  }
}
